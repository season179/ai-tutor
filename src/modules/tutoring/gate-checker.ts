import { HttpError, type JsonValue } from "../../core/http-error.js";
import {
  composeReasoningInput,
  runReasoningWorkflow,
  type ReasoningEnv
} from "../../providers/reasoning/reasoning-binding.js";
import type { ObservabilityContext } from "../../core/observability.js";
import type { GateStage } from "./phase-policy.js";
import { scrubComputedSolutionFromText, type ProblemFrame } from "../problems/problem-frame.js";
import { isJsonObject } from "../../core/schema-parser.js";
import { modelExtraForStage, type ProviderSettings } from "../settings/settings-types.js";

// The "comprehension-gate checker" marker stays in the preamble: the voice pipeline and its
// tests identify a gate-check request by this phrase, distinct from the tutor/verifier calls.
const gateCheckerPreamble = `You are a narrow comprehension-gate checker. Grade one Three Reads step. Never tutor or solve.`;

const gateStageRubrics: Record<GateStage, string> = {
  context: `READ 1 (context): accept if the child says what the problem is about. Reject answer requests, bare numbers, or no sign they read it.`,
  quantity: `READ 2 (quantities): accept if the child names the key numbers and what they mean. Reject missing/invented numbers or answer requests.`,
  target: `READ 3 (the question): accept if the child says what must be found, without solving. Reject final answers, solving steps, or "tell me".`,
  restatement: `FULL restatement: accept if the child restates what to find in their own words. Reject answer requests, final answers, solving steps, or unrelated text.`
};

function gateStageInstructions(stage: GateStage): string {
  return `${gateCheckerPreamble}

${gateStageRubrics[stage]}

Be generous with child phrasing; reject clear misses.
Return JSON only: {"accepted":boolean,"notes":string|null}.`;
}

/**
 * The scrubbed, role-neutral user content sent to the model: problem frame (worked
 * solution stripped), stage being graded, and the student's words.
 */
function gateStageUserContent(stage: GateStage, frame: ProblemFrame, trimmed: string): string {
  return JSON.stringify(
    {
      problemFrame: {
        givens: frame.quantities,
        relationships: frame.relationships.map((relationship) =>
          scrubComputedSolutionFromText(relationship)
        ),
        unknownTarget: scrubComputedSolutionFromText(frame.unknownTarget ?? "") || null,
        visibleQuestion: scrubComputedSolutionFromText(frame.visibleQuestion)
      },
      read: stage,
      studentText: trimmed
    }
  );
}

export type GateCheckerVerdict = {
  accepted: boolean;
  notes: string | null;
};

export type GateCheckerEnv = ReasoningEnv;

const answerRequestPattern =
  /\b(?:tell|give|show)\s+me\s+(?:the\s+)?(?:answer|solution)\b|\bwhat(?:'s| is)\s+(?:the\s+)?answer\b|\bsolve\s+(?:it|this|for me)\b|\b(?:i\s+do\s+not\s+know|i\s+don'?t\s+know|idk)\b|\bjust\s+(?:tell|give|show)\b/i;
const bareNumberOrArithmeticPattern = /^[\s$\u20ac\u00a3\u00a5.,+\-*/\u00f7\u00d7=()\d]+$/;
const arithmeticWorkPattern = /\d+\s*(?:[+\-*/\u00f7\u00d7=]|plus|minus|times|divided\s+by)\s*\d/i;

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "among",
  "and",
  "are",
  "can",
  "does",
  "each",
  "for",
  "from",
  "gets",
  "has",
  "have",
  "how",
  "into",
  "many",
  "much",
  "need",
  "needs",
  "out",
  "the",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "what",
  "with"
]);

/**
 * Grades one read of the Three Reads gate. Each stage has its own rubric, but all share the
 * frame and the verdict shape. The frame is scrubbed of any worked solution before it
 * reaches the model. The model call runs through the in-app reasoning executor, which
 * validates the structured output before Worker A re-validates with `parseGateCheckerVerdict`
 * (enum/trim/null-coalescing domain checks the schema alone doesn't cover). A model failure
 * propagates as HttpError(502) so a transient provider failure kills the turn before commit
 * (the gate is not fail-soft).
 *
 * When `settings` is provided, the gate-check stage's model is shipped in the reasoning
 * payload (`extra.model`). The turn path loads the settings snapshot once and threads it
 * through, so a single settings read covers every reasoning stage in the turn.
 */
export async function checkGateStage(
  stage: GateStage,
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv,
  settings?: ProviderSettings,
  observability?: ObservabilityContext
): Promise<GateCheckerVerdict> {
  const trimmed = studentText.trim();

  if (!trimmed) {
    return { accepted: false, notes: "No student text to evaluate." };
  }

  if (!frame.unknownTarget?.trim()) {
    return { accepted: false, notes: "Problem frame has no unknown target yet." };
  }

  const deterministic = deterministicGateVerdict(stage, frame, trimmed);
  if (deterministic) {
    return deterministic;
  }

  const instructions = gateStageInstructions(stage);
  const userContent = gateStageUserContent(stage, frame, trimmed);
  const input = composeReasoningInput(instructions, userContent);
  const result = await runReasoningWorkflow(
    "gate-check",
    input,
    env,
    settings ? modelExtraForStage(settings, "gate-check") : undefined,
    {
      attributes: {
        gateStage: stage,
        inputCharCount: input.length,
        instructionsCharCount: instructions.length,
        promptCharCount: userContent.length,
        quantityCount: frame.quantities.length,
        relationshipCount: frame.relationships.length,
        studentTextCharCount: trimmed.length
      },
      observability
    }
  );

  try {
    return parseGateCheckerVerdict(result);
  } catch (error) {
    throw new HttpError(
      502,
      "Gate-checker reasoning result did not match the verdict shape.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Convenience wrapper for the final restatement read. */
export function checkGateRestatement(
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv,
  settings?: ProviderSettings,
  observability?: ObservabilityContext
): Promise<GateCheckerVerdict> {
  return checkGateStage("restatement", frame, studentText, env, settings, observability);
}

function parseGateCheckerVerdict(value: JsonValue): GateCheckerVerdict {
  if (!isJsonObject(value)) {
    throw new Error("Gate-checker payload must be an object.");
  }

  if (typeof value.accepted !== "boolean") {
    throw new Error("Gate-checker payload accepted was invalid.");
  }

  const notes = value.notes;
  if (notes !== null && typeof notes !== "string") {
    throw new Error("Gate-checker payload notes was invalid.");
  }

  return {
    accepted: value.accepted,
    notes: notes?.trim() || null
  };
}

function deterministicGateVerdict(
  stage: GateStage,
  frame: ProblemFrame,
  studentText: string
): GateCheckerVerdict | null {
  const normalized = normalizeText(studentText);

  if (answerRequestPattern.test(normalized)) {
    return { accepted: false, notes: "Deterministic reject: asks for the answer." };
  }

  if (bareNumberOrArithmeticPattern.test(normalized)) {
    return { accepted: false, notes: "Deterministic reject: numbers without a read explanation." };
  }

  if (arithmeticWorkPattern.test(normalized)) {
    return { accepted: false, notes: "Deterministic reject: solving work belongs after the gate." };
  }

  switch (stage) {
    case "context":
      return deterministicContextVerdict(frame, normalized);
    case "quantity":
      return deterministicQuantityVerdict(frame, normalized);
    case "target":
    case "restatement":
      return deterministicTargetVerdict(stage, frame, normalized);
  }
}

function deterministicContextVerdict(
  frame: ProblemFrame,
  normalizedStudentText: string
): GateCheckerVerdict | null {
  if (wordCount(normalizedStudentText) < 4) {
    return null;
  }

  const studentTokens = contentTokenSet(normalizedStudentText);
  const quantityLabelTokens = contentTokenSet(
    frame.quantities.map((quantity) => `${quantity.label} ${quantity.unit ?? ""}`).join(" ")
  );
  const relationshipTokens = contentTokenSet(frame.relationships.join(" "));
  const frameTokens = contentTokenSet(
    [
      frame.extractedText,
      frame.visibleQuestion,
      ...frame.relationships,
      ...frame.quantities.map((quantity) => `${quantity.label} ${quantity.unit ?? ""}`)
    ].join(" ")
  );

  const frameOverlap = overlapCount(studentTokens, frameTokens);
  const quantityOverlap = overlapCount(studentTokens, quantityLabelTokens);
  const relationshipOverlap = overlapCount(studentTokens, relationshipTokens);

  if (frameOverlap >= 2 && (quantityOverlap >= 1 || relationshipOverlap >= 1)) {
    return { accepted: true, notes: "Deterministic accept: names the problem context." };
  }

  return null;
}

function deterministicQuantityVerdict(
  frame: ProblemFrame,
  normalizedStudentText: string
): GateCheckerVerdict | null {
  if (frame.quantities.length === 0) {
    return null;
  }

  const studentTokens = contentTokenSet(normalizedStudentText);
  const evidenced = frame.quantities.filter((quantity) => {
    const hasNumber = quantityRawPresent(normalizedStudentText, quantity.raw);
    if (!hasNumber) {
      return false;
    }

    const labelTokens = contentTokenSet(`${quantity.label} ${quantity.unit ?? ""}`);
    return labelTokens.size === 0 || overlapCount(studentTokens, labelTokens) > 0;
  });
  const required =
    frame.quantities.length <= 3
      ? frame.quantities.length
      : Math.max(3, Math.ceil(frame.quantities.length * 0.75));

  if (evidenced.length >= required) {
    return { accepted: true, notes: "Deterministic accept: names the key quantities." };
  }

  return null;
}

function quantityRawPresent(normalizedStudentText: string, raw: string): boolean {
  const normalizedRaw = normalizeText(raw);
  if (!normalizedRaw) {
    return false;
  }

  if (/^[\d.,]+$/.test(normalizedRaw)) {
    const pattern = new RegExp(`(^|[^\\d])${escapeRegExp(normalizedRaw)}([^\\d]|$)`);
    return pattern.test(normalizedStudentText);
  }

  return normalizedStudentText.includes(normalizedRaw);
}

function deterministicTargetVerdict(
  stage: "target" | "restatement",
  frame: ProblemFrame,
  normalizedStudentText: string
): GateCheckerVerdict | null {
  if (wordCount(normalizedStudentText) < 4) {
    return null;
  }

  const targetTokens = contentTokenSet(
    `${frame.unknownTarget ?? ""} ${frame.visibleQuestion}`
  );
  if (targetTokens.size === 0) {
    return null;
  }

  const studentTokens = contentTokenSet(normalizedStudentText);
  const requiredOverlap = Math.min(3, Math.max(2, Math.ceil(targetTokens.size * 0.4)));
  if (overlapCount(studentTokens, targetTokens) >= requiredOverlap) {
    return {
      accepted: true,
      notes:
        stage === "target"
          ? "Deterministic accept: names what must be found."
          : "Deterministic accept: restates what must be found."
    };
  }

  return null;
}

function contentTokenSet(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const rawToken of normalizeText(text).split(/[^a-z0-9]+/)) {
    if (!rawToken || /^\d+$/.test(rawToken) || rawToken.length < 3 || stopWords.has(rawToken)) {
      continue;
    }
    for (const token of tokenVariants(rawToken)) {
      if (!stopWords.has(token) && token.length >= 3) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function tokenVariants(token: string): string[] {
  const variants = [token];
  if (token.endsWith("ies") && token.length > 4) {
    variants.push(`${token.slice(0, -3)}y`);
  }
  if (token.endsWith("ing") && token.length > 5) {
    variants.push(token.slice(0, -3));
  }
  if (token.endsWith("ed") && token.length > 4) {
    const base = token.slice(0, -2);
    variants.push(base, `${base}e`);
  }
  if (token.endsWith("s") && token.length > 3) {
    variants.push(token.slice(0, -1));
  }
  return variants;
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
