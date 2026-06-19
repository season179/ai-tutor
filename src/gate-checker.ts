import { HttpError, type JsonValue } from "./http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "./openai-responses.js";
import { isJsonObject } from "./schema-parser.js";
import type { ProblemFrame } from "./problem-context/problem-frame.js";

export const defaultGateCheckerModel = "gpt-5.5";

const gateCheckerInstructions = `You are a narrow comprehension-gate checker for a children's homework tutor.

The child must restate what the problem is asking them to FIND — in their own words — before solving is allowed.

Accept when:
- They identify the same unknown target as the problem frame (paraphrases and child language are fine).
- They use a blank or question form ("how many stickers each friend gets", "we need to find ___").

Reject when:
- They only ask you to solve it or give the answer ("just tell me", "what is it").
- They state a final numeric answer instead of the goal.
- They describe unrelated content with no sign they know what to find.

Return JSON only. Be generous with age-appropriate paraphrases; only reject clear misses.`;

const gateCheckerJsonSchema = {
  additionalProperties: false,
  properties: {
    accepted: { type: "boolean" },
    notes: { type: ["string", "null"] }
  },
  required: ["accepted", "notes"],
  type: "object"
} as const;

export type GateCheckerVerdict = {
  accepted: boolean;
  notes: string | null;
};

export type GateCheckerEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_GATE_CHECKER_MODEL?: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
};

type GateCheckerOptions = {
  apiKey: string | undefined;
  model: string;
};

export function createGateCheckerOptions(env: GateCheckerEnv): GateCheckerOptions {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_GATE_CHECKER_MODEL ?? env.OPENAI_TUTOR_MODEL ?? defaultGateCheckerModel
  };
}

export async function checkGateRestatement(
  frame: ProblemFrame,
  studentText: string,
  env: GateCheckerEnv
): Promise<GateCheckerVerdict> {
  const options = createGateCheckerOptions(env);
  const apiKey = requireOpenAiApiKey(options.apiKey);
  const trimmed = studentText.trim();

  if (!trimmed) {
    return { accepted: false, notes: "No student text to evaluate." };
  }

  if (!frame.unknownTarget?.trim()) {
    return { accepted: false, notes: "Problem frame has no unknown target yet." };
  }

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey,
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: JSON.stringify(
                {
                  problemFrame: {
                    givens: frame.quantities,
                    relationships: frame.relationships,
                    unknownTarget: frame.unknownTarget,
                    visibleQuestion: frame.visibleQuestion
                  },
                  studentText: trimmed
                },
                null,
                2
              ),
              type: "input_text"
            }
          ],
          role: "user"
        }
      ],
      instructions: gateCheckerInstructions,
      model: options.model,
      text: {
        format: {
          name: "gate_checker_verdict",
          schema: gateCheckerJsonSchema,
          strict: true,
          type: "json_schema"
        }
      }
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new HttpError(502, "OpenAI gate-checker response did not include output text.", payload);
  }

  try {
    return parseGateCheckerVerdict(JSON.parse(outputText) as JsonValue);
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI gate-checker response was not valid JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
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
