import type { ExtractionOutcome } from "./problem-context-types.js";

export const problemTypes = ["word_problem", "equation", "geometry", "science", "other"] as const;

export type ProblemType = (typeof problemTypes)[number];

export type ProblemQuantity = {
  label: string;
  raw: string;
  unit?: string | undefined;
};

/**
 * The problem *frame* — givens, unknown, and task language. Never the computed answer.
 * Stored in `problem_contexts` after vision extraction (M3).
 */
export type ProblemFrame = {
  diagramDescription: string | null;
  extractedText: string;
  languageIsSubject: boolean;
  likelySkillKeys: string[];
  problemType: ProblemType;
  quantities: ProblemQuantity[];
  relationships: string[];
  taskLanguage: string;
  unknownTarget: string | null;
  visibleQuestion: string;
};

export type ProblemContextRecord = ProblemFrame & {
  confirmedQuestion: string | null;
  createdAt: string;
  extractionConfidence: "high" | "low" | "medium" | null;
  extractionOutcome: ExtractionOutcome;
  id: string;
  r2ObjectKey: string | null;
  sessionId: string;
  updatedAt: string;
};

const quantityUnitPattern = "%|cm|mm|km|kg|ml|m|g|l";
const quantityPattern = new RegExp(
  `(?:RM|MYR|USD|SGD|AUD|[$\\u20ac\\u00a3\\u00a5])?\\s*\\d(?:[\\d\\s,]*\\d)?(?:\\.\\d+)?(?:\\s*(?:${quantityUnitPattern}))?`,
  "gi"
);
const sentenceBoundaryPattern = /[.!?\n;\u3002\uff01\uff1f\uff1b]/;
const labelTrimPattern =
  /^[\s:\uff1a,\uff0c.\u3002;\uff1b\-\u2013\u2014=+*/()\uff08\uff09\u3001]+|[\s:\uff1a,\uff0c.\u3002;\uff1b\-\u2013\u2014=+*/()\uff08\uff09\u3001]+$/g;

export function augmentProblemQuantities(
  parsedQuantities: readonly ProblemQuantity[],
  sourceText: string
): ProblemQuantity[] {
  const quantities: ProblemQuantity[] = parsedQuantities.map((quantity) => ({
    label: quantity.label.trim(),
    raw: quantity.raw.trim(),
    ...(quantity.unit?.trim() ? { unit: quantity.unit.trim() } : {})
  }));
  const seen = new Set(quantities.map((quantity) => quantityKey(quantity.raw)));

  for (const inferred of inferQuantitiesFromText(sourceText)) {
    const key = quantityKey(inferred.raw);
    if (!key || seen.has(key)) {
      continue;
    }
    quantities.push(inferred);
    seen.add(key);
  }

  return quantities;
}

export function withInferredProblemFrameQuantities(frame: ProblemFrame): ProblemFrame {
  const sourceText = [frame.extractedText, frame.visibleQuestion, frame.diagramDescription]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  const quantities = augmentProblemQuantities(frame.quantities, sourceText);
  return quantities.length === frame.quantities.length ? frame : { ...frame, quantities };
}

// A worked-answer "= N" is a computed result, e.g. "24 ÷ 4 = 6" or a "… = 6" scrawled after
// the prompt. The `(?<![A-Za-z]\s*)` guard keeps a genuine equation problem ("Solve 2x = 14",
// where a variable precedes "="), so it is detected/stripped only when the left side isn't a
// variable. No `$` anchor — a worked answer mid-text or on an earlier line must still match.
const computedAnswerEquationPattern = /(?<![A-Za-z]\s*)=\s*[-+]?\$?\d+(?:\.\d+)?/;

const computedSolutionPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer is\s+[-+]?\$?\d/i,
  /\bthe answer['’]s\s+[-+]?\$?\d/i,
  computedAnswerEquationPattern
];

const numericOnlyPattern = /^[-+]?\$?\d+(?:\.\d+)?$/;

function frameTextFields(frame: ProblemFrame): string[] {
  return [
    frame.extractedText,
    frame.visibleQuestion,
    frame.unknownTarget,
    frame.diagramDescription,
    ...frame.relationships,
    ...frame.quantities.map((quantity) => `${quantity.label} ${quantity.raw} ${quantity.unit ?? ""}`.trim())
  ].filter((value): value is string => Boolean(value?.trim()));
}

/** True when the frame appears to include a computed final answer (§9.4 guard). */
export function frameContainsComputedSolution(frame: ProblemFrame): boolean {
  if (frame.unknownTarget && numericOnlyPattern.test(frame.unknownTarget.trim())) {
    return true;
  }

  return frameTextFields(frame).some((text) =>
    computedSolutionPatterns.some((pattern) => pattern.test(text))
  );
}

// Global variants of the detection patterns, for stripping every occurrence of a
// worked answer out of free text. Givens are deliberately NOT touched (a "24" in
// "24 stickers" is an input the child needs, not the answer) — only explicit
// "the answer is N" and computed "= N" fragments are removed. The "= N" pattern shares
// the variable guard above so it scrubs worked answers anywhere in the text without
// corrupting a "Solve 2x = 14" equation.
const computedSolutionStripPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer(?:['’]s| is)\s+[-+]?\$?\d+(?:\.\d+)?/gi,
  new RegExp(computedAnswerEquationPattern.source, "g")
];

/**
 * Remove explicit worked-answer fragments from a single text field, leaving the
 * question and its givens intact. Returns the cleaned string (possibly empty).
 */
export function scrubComputedSolutionFromText(text: string): string {
  let cleaned = text;
  for (const pattern of computedSolutionStripPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Return a copy of the frame with any computed answer scrubbed from its free-text
 * fields. A numeric-only `unknownTarget` (e.g. "6") is the answer masquerading as the
 * goal, so it is dropped entirely. Quantities (the givens) are never altered.
 */
export function scrubComputedSolutionFromFrame(frame: ProblemFrame): ProblemFrame {
  const unknownTarget =
    frame.unknownTarget && numericOnlyPattern.test(frame.unknownTarget.trim())
      ? null
      : frame.unknownTarget
        ? scrubComputedSolutionFromText(frame.unknownTarget) || null
        : null;

  return {
    ...frame,
    extractedText: scrubComputedSolutionFromText(frame.extractedText),
    visibleQuestion: scrubComputedSolutionFromText(frame.visibleQuestion),
    unknownTarget,
    relationships: frame.relationships
      .map((relationship) => scrubComputedSolutionFromText(relationship))
      .filter(Boolean),
    diagramDescription: frame.diagramDescription
      ? scrubComputedSolutionFromText(frame.diagramDescription) || null
      : null
  };
}

export function defaultProblemFrame(visibleQuestion = ""): ProblemFrame {
  return {
    diagramDescription: null,
    extractedText: visibleQuestion,
    languageIsSubject: false,
    likelySkillKeys: [],
    problemType: "other",
    quantities: [],
    relationships: [],
    taskLanguage: "en",
    unknownTarget: null,
    visibleQuestion
  };
}

/** Minimal frame when the child/parent confirms a typed question without vision extraction. */
export function problemFrameFromConfirmedPrompt(question: string): ProblemFrame {
  const trimmed = question.trim();

  return {
    ...defaultProblemFrame(trimmed),
    unknownTarget: trimmed || null,
    visibleQuestion: trimmed
  };
}

function inferQuantitiesFromText(text: string): ProblemQuantity[] {
  const quantities: ProblemQuantity[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(quantityPattern)) {
    const matched = match[0];
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }

    const raw = normalizeQuantityRaw(matched);
    const key = quantityKey(raw);
    if (!key || seen.has(key)) {
      continue;
    }

    const unit = inferQuantityUnit(raw);
    const label = inferQuantityLabel(text, start, start + matched.length, quantities.length + 1);
    quantities.push({
      label,
      raw,
      ...(unit ? { unit } : {})
    });
    seen.add(key);
  }

  return quantities;
}

function normalizeQuantityRaw(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^(rm|myr|usd|sgd|aud)/i, (prefix) =>
    prefix.toUpperCase()
  );
}

function quantityKey(value: string): string {
  return normalizeQuantityRaw(value).replace(/[\s,]/g, "").toUpperCase();
}

function inferQuantityUnit(raw: string): string | null {
  const trimmed = raw.trim();
  const currency = trimmed.match(/^(RM|MYR|USD|SGD|AUD|[$\u20ac\u00a3\u00a5])/i)?.[1];
  if (currency) {
    return currency.toUpperCase();
  }

  const unit = trimmed.match(new RegExp(`(?:^|\\d)\\s*(${quantityUnitPattern})$`, "i"))?.[1];
  return unit ? unit.toLowerCase() : null;
}

function inferQuantityLabel(text: string, start: number, end: number, ordinal: number): string {
  const context = quantitySentenceContext(text, start, end);
  const relativeStart = start - context.start;
  const relativeEnd = end - context.start;
  const before = cleanQuantityLabel(context.text.slice(0, relativeStart));
  const after = cleanQuantityLabel(context.text.slice(relativeEnd));

  if (/[\u3400-\u9fff]/.test(after)) {
    const cjkAfter = trimLeadingCjkParticles(firstCjkPhrase(after));
    if (/[\u3400-\u9fff]/.test(before) && /(?:\u5355\u4ef7|\u4ef7\u683c)/.test(before) && cjkAfter) {
      return `${cjkAfter}\u5355\u4ef7`;
    }
    if (cjkAfter) {
      return cjkAfter;
    }
  }

  const latinAfter = firstLatinLabel(after);
  if (latinAfter) {
    return latinAfter;
  }

  const cjkBefore = lastCjkPhrase(before);
  if (cjkBefore) {
    return cjkBefore;
  }

  const latinBefore = lastLatinLabel(before);
  return latinBefore || `quantity ${ordinal}`;
}

function quantitySentenceContext(
  text: string,
  start: number,
  end: number
): { start: number; text: string } {
  let contextStart = start;
  while (contextStart > 0 && !sentenceBoundaryPattern.test(text[contextStart - 1] ?? "")) {
    contextStart -= 1;
  }

  let contextEnd = end;
  while (contextEnd < text.length && !sentenceBoundaryPattern.test(text[contextEnd] ?? "")) {
    contextEnd += 1;
  }

  return { start: contextStart, text: text.slice(contextStart, contextEnd) };
}

function cleanQuantityLabel(value: string): string {
  return value
    .replace(quantityPattern, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(labelTrimPattern, "")
    .trim();
}

function firstCjkPhrase(value: string): string {
  const match = value.match(/[\u3400-\u9fff][\u3400-\u9fff\s\u7684\u7ed9]*/);
  return trimCjkPhrase(match?.[0] ?? "");
}

function lastCjkPhrase(value: string): string {
  const matches = value.match(/[\u3400-\u9fff][\u3400-\u9fff\s\u7684\u7ed9]*/g);
  return trimCjkPhrase(matches?.[matches.length - 1] ?? "");
}

function trimLeadingCjkParticles(value: string): string {
  return value.replace(/^[\u7684\u7ed9\s]+/, "").trim();
}

function trimCjkPhrase(value: string): string {
  return trimLeadingCjkParticles(value).replace(/\s+/g, "").slice(0, 18);
}

function firstLatinLabel(value: string): string | null {
  const words = labelWords(value);
  return words.length ? words.slice(0, 4).join(" ") : null;
}

function lastLatinLabel(value: string): string | null {
  const words = labelWords(value);
  return words.length ? words.slice(-4).join(" ") : null;
}

function labelWords(value: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "of",
    "the",
    "to",
    "was",
    "were",
    "with"
  ]);

  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 1 && !stopWords.has(word));
}
