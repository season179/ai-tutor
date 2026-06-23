import { chat, type AnyTextAdapter, type ContentPart, type ModelMessage } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { z } from "zod";

import { HttpError, type JsonValue } from "../../core/http-error.js";
import {
  observeStage,
  type ObservabilityAttributes,
  type ObservabilityContext,
} from "../../core/observability.js";
import {
  defaultReasoningModelSpecifier,
} from "../../modules/settings/reasoning-model-options.js";
import type { ReasoningStage } from "../../modules/settings/settings-types.js";

const reasoningWorkflowTimeoutMs = 60_000;

export type ReasoningEnv = {
  OPENAI_API_KEY?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
  REASONING_TEST_TRANSPORT?: ReasoningTestTransport | undefined;
};

export type ReasoningWorkflowOptions = {
  attributes?: ObservabilityAttributes | undefined;
  observability?: ObservabilityContext | undefined;
};

export type PromptImageInput = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ReasoningWorkflowPayload = {
  stage: ReasoningStage;
  input: string;
  model?: string | undefined;
  image?: PromptImageInput | undefined;
  imageUrl?: string | undefined;
  allowedMoves?: string[] | undefined;
  allowedNextPhases?: string[] | undefined;
};

export type ReasoningTestTransport = {
  runReasoningWorkflow(
    payload: ReasoningWorkflowPayload,
    options?: ReasoningWorkflowOptions,
  ): Promise<JsonValue>;
};

/**
 * Combines a stage's dynamic instructions and user input into one prompt string.
 *
 * The stage-specific prompt builders already scrub and order the instructions, frame,
 * history, and student text. Keeping this helper stable lets the rest of the tutor pipeline
 * stay unchanged now that the executor lives in the app worker.
 */
export function composeReasoningInput(instructions: string, input: string): string {
  return `${instructions}\n\n${input}`;
}

export async function runReasoningWorkflow(
  stage: ReasoningStage,
  input: string,
  env: ReasoningEnv,
  extra?: Record<string, JsonValue>,
  options?: ReasoningWorkflowOptions,
): Promise<JsonValue> {
  return observeStage(
    options?.observability,
    "reasoning.workflow",
    {
      workflow: stage,
      model: workflowModelSpecifier(stage, extra),
      timeoutMs: reasoningWorkflowTimeoutMs,
      ...options?.attributes,
    },
    () => runReasoningWorkflowUnobserved(stage, input, env, extra, options),
  );
}

async function runReasoningWorkflowUnobserved(
  stage: ReasoningStage,
  input: string,
  env: ReasoningEnv,
  extra?: Record<string, JsonValue>,
  options?: ReasoningWorkflowOptions,
): Promise<JsonValue> {
  const payload = buildWorkflowPayload(stage, input, extra);
  if (env.REASONING_TEST_TRANSPORT) {
    return env.REASONING_TEST_TRANSPORT.runReasoningWorkflow(payload, options);
  }

  const modelSpecifier = payload.model ?? defaultReasoningModelSpecifier(stage);
  const { adapter, modelOptions } = createReasoningAdapter(stage, modelSpecifier, env);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), reasoningWorkflowTimeoutMs);

  try {
    return (await chat({
      adapter,
      messages: [await buildUserMessage(payload)],
      outputSchema: outputSchemaForPayload(payload),
      abortController,
      modelOptions,
    })) as JsonValue;
  } catch (error) {
    throw mapReasoningError(stage, error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildWorkflowPayload(
  stage: ReasoningStage,
  input: string,
  extra?: Record<string, JsonValue>,
): ReasoningWorkflowPayload {
  const image = parsePromptImage(extra?.image);
  const imageUrl = typeof extra?.imageUrl === "string" ? extra.imageUrl : undefined;
  return {
    stage,
    input,
    model: typeof extra?.model === "string" ? extra.model : undefined,
    image,
    imageUrl,
    allowedMoves: parseStringList(extra?.allowedMoves),
    allowedNextPhases: parseStringList(extra?.allowedNextPhases),
  };
}

function createReasoningAdapter(
  stage: ReasoningStage,
  specifier: string,
  env: ReasoningEnv,
): { adapter: AnyTextAdapter; modelOptions: Record<string, unknown> } {
  const parsed = parseModelSpecifier(specifier);
  if (parsed.provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new HttpError(502, `Reasoning workflow "${stage}" needs OPENAI_API_KEY.`);
    }
    return {
      adapter: createOpenaiChat(parsed.model as Parameters<typeof createOpenaiChat>[0], env.OPENAI_API_KEY),
      modelOptions: {
        reasoning: { effort: openAiReasoningEffort(stage, parsed.model) },
        max_output_tokens: maxOutputTokens(stage),
      },
    };
  }

  if (parsed.provider === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      throw new HttpError(502, `Reasoning workflow "${stage}" needs OPENROUTER_API_KEY.`);
    }
    return {
      adapter: createOpenRouterText(
        parsed.model as Parameters<typeof createOpenRouterText>[0],
        env.OPENROUTER_API_KEY,
      ),
      modelOptions: {
        reasoning: openRouterReasoning(stage, parsed.model),
        maxCompletionTokens: maxOutputTokens(stage),
      },
    };
  }

  throw new HttpError(
    400,
    `Reasoning workflow "${stage}" cannot use unsupported provider "${parsed.provider}".`,
  );
}

function parseModelSpecifier(specifier: string): { provider: string; model: string } {
  const slash = specifier.indexOf("/");
  if (slash < 1 || slash === specifier.length - 1) {
    throw new HttpError(400, `Invalid reasoning model specifier "${specifier}".`);
  }
  return {
    provider: specifier.slice(0, slash),
    model: specifier.slice(slash + 1),
  };
}

async function buildUserMessage(payload: ReasoningWorkflowPayload): Promise<ModelMessage> {
  const image = payload.image
    ? promptImageToContentPart(payload.image)
    : payload.imageUrl
      ? await imageUrlToContentPart(payload.imageUrl)
      : undefined;

  if (!image) {
    return { role: "user", content: payload.input };
  }

  return {
    role: "user",
    content: [
      { type: "text", content: payload.input },
      image,
    ],
  };
}

function promptImageToContentPart(image: PromptImageInput): ContentPart {
  return {
    type: "image",
    source: {
      type: "data",
      value: image.data,
      mimeType: image.mimeType,
    },
  };
}

async function imageUrlToContentPart(url: string): Promise<ContentPart> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(reasoningWorkflowTimeoutMs) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, `extract-question could not fetch the problem image: ${message}`);
  }
  if (!response.ok) {
    throw new HttpError(
      502,
      `extract-question could not fetch the problem image (HTTP ${response.status}).`,
    );
  }
  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  const buffer = await response.arrayBuffer();
  return {
    type: "image",
    source: {
      type: "data",
      value: bytesToBase64(new Uint8Array(buffer)),
      mimeType,
    },
  };
}

const gateCheckSchema = z.object({
  accepted: z.boolean(),
  notes: z.string().nullable(),
});

const verifierSchema = z.object({
  studentStatus: z.enum(["correct", "partial", "incorrect", "stuck", "off_task", "unknown"]),
  confidence: z.enum(["low", "medium", "high"]),
  correctionHint: z.string().nullable(),
  misconceptionKey: z.string().nullable(),
});

const extractQuestionSchema = z.object({
  question: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().nullable(),
  outcome: z.enum(["extracted", "multiple_questions", "none", "not_a_problem", "partial"]),
  extractedText: z.string(),
  problemType: z.enum(["word_problem", "equation", "geometry", "science", "other"]),
  likelySkillKeys: z.array(z.string()),
  quantities: z.array(
    z.object({
      label: z.string(),
      raw: z.string(),
      unit: z.string().nullable(),
    }),
  ),
  relationships: z.array(z.string()),
  unknownTarget: z.string().nullable(),
  diagramDescription: z.string().nullable(),
  taskLanguage: z.string(),
  languageIsSubject: z.boolean(),
});

function outputSchemaForPayload(payload: ReasoningWorkflowPayload): z.ZodType {
  switch (payload.stage) {
    case "gate-check":
      return gateCheckSchema;
    case "verifier":
      return verifierSchema;
    case "extract-question":
      return extractQuestionSchema;
    case "tutor-turn":
      return tutorSchema(payload);
  }
}

function tutorSchema(payload: ReasoningWorkflowPayload): z.ZodType {
  const moveSchema = enumOrString(payload.allowedMoves);
  const phaseSchema = enumOrString(payload.allowedNextPhases);
  return z.object({
    move: moveSchema,
    nextPhase: phaseSchema,
    spokenUtterance: z.string(),
  });
}

function enumOrString(values: string[] | undefined): z.ZodType<string> {
  if (!values?.length) {
    return z.string();
  }
  return z.enum(values as [string, ...string[]]);
}

function openAiReasoningEffort(stage: ReasoningStage, model: string): string {
  if (!model.startsWith("gpt-5")) {
    return "low";
  }
  if (stage === "tutor-turn") {
    return "none";
  }
  if (stage === "gate-check") {
    return "low";
  }
  return "low";
}

function openRouterReasoning(
  stage: ReasoningStage,
  model: string,
): { effort: string } | undefined {
  if (model.includes("gemini-3.5-flash")) {
    return undefined;
  }
  return { effort: stage === "tutor-turn" ? "low" : "low" };
}

function maxOutputTokens(stage: ReasoningStage): number {
  switch (stage) {
    case "gate-check":
      return 256;
    case "verifier":
      return 512;
    case "tutor-turn":
      return 512;
    case "extract-question":
      return 1_200;
  }
}

function workflowModelSpecifier(
  stage: ReasoningStage,
  extra: Record<string, JsonValue> | undefined,
): string {
  return typeof extra?.model === "string" ? extra.model : defaultReasoningModelSpecifier(stage);
}

function parsePromptImage(value: JsonValue | undefined): PromptImageInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.type !== "image" ||
    typeof value.data !== "string" ||
    typeof value.mimeType !== "string"
  ) {
    return undefined;
  }
  return { type: "image", data: value.data, mimeType: value.mimeType };
}

function parseStringList(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === "string") ? value : undefined;
}

function mapReasoningError(stage: ReasoningStage, error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /tim(?:e|ed) out|abort/i.test(`${message} ${name}`)) {
    return new HttpError(
      502,
      `Reasoning workflow "${stage}" timed out after ${reasoningWorkflowTimeoutMs / 1000}s.`,
      { stage, error: message, timeoutMs: reasoningWorkflowTimeoutMs },
    );
  }

  return new HttpError(
    502,
    `Reasoning workflow "${stage}" failed: ${message}`,
    { stage, error: message },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
