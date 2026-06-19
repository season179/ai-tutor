import { HttpError, type JsonValue } from "../http-error.js";
import { extractOutputText, fetchOpenAiJson, requireOpenAiApiKey } from "../openai-responses.js";
import { isJsonObject } from "../schema-parser.js";
import type { ExtractQuestionResponse } from "./problem-context-types.js";

export const defaultVisionModel = "gpt-5.5";

export type QuestionExtractionServiceEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_VISION_MODEL: string | undefined;
};

const extractionInstructions =
  "Extract the main homework, math, or science problem question from this image. Return the question as plain text the student would read. If multiple problems exist, return the first complete one. If no question is visible, set confidence to low and explain in notes.";

const extractedQuestionJsonSchema = {
  additionalProperties: false,
  properties: {
    confidence: {
      enum: ["high", "low", "medium"],
      type: "string"
    },
    notes: {
      type: ["string", "null"]
    },
    question: {
      type: "string"
    }
  },
  required: ["question", "confidence", "notes"],
  type: "object"
} as const;

export function createQuestionExtractionOptions(env: QuestionExtractionServiceEnv): {
  apiKey: string | undefined;
  visionModel: string;
} {
  return {
    apiKey: env.OPENAI_API_KEY,
    visionModel: env.OPENAI_VISION_MODEL ?? defaultVisionModel
  };
}

export async function extractQuestionFromImageUrl(
  imageUrl: string,
  env: QuestionExtractionServiceEnv
): Promise<ExtractQuestionResponse> {
  const options = createQuestionExtractionOptions(env);
  const apiKey = requireOpenAiApiKey(options.apiKey);

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey,
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: extractionInstructions,
              type: "input_text"
            },
            {
              image_url: imageUrl,
              type: "input_image"
            }
          ],
          role: "user"
        }
      ],
      model: options.visionModel,
      text: {
        format: {
          name: "extracted_question",
          schema: extractedQuestionJsonSchema,
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
    throw new HttpError(502, "OpenAI vision response did not include output text.", payload);
  }

  try {
    return parseExtractQuestionResponse(JSON.parse(outputText) as JsonValue);
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI vision response was not valid extraction JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function parseExtractQuestionResponse(value: JsonValue): ExtractQuestionResponse {
  if (!isJsonObject(value)) {
    throw new Error("Extraction payload must be an object.");
  }

  const confidence = value.confidence;
  const question = value.question;
  const notes = value.notes;

  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new Error("Extraction payload confidence was invalid.");
  }

  if (typeof question !== "string") {
    throw new Error("Extraction payload question was invalid.");
  }

  if (notes !== null && typeof notes !== "string") {
    throw new Error("Extraction payload notes was invalid.");
  }

  return {
    confidence,
    notes,
    question: question.trim()
  };
}
