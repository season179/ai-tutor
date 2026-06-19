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

const computedSolutionPatterns: readonly RegExp[] = [
  /\bthe (?:final )?answer is\s+[-+]?\$?\d/i,
  /\bthe answer['’]s\s+[-+]?\$?\d/i,
  /\b=\s*[-+]?\$?\d+(?:\.\d+)?\s*$/i
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
