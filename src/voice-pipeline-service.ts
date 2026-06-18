import { HttpError, type JsonValue } from "./http-error.js";
import type { RequestContext } from "./request-context.js";
import type { SessionStore } from "./session-store.js";
import type { TutorSessionDetail } from "./session-types.js";
import { isJsonObject } from "./schema-parser.js";
import { tutorPolicy } from "./tutor-policy.js";
import {
  serializeVoicePipelineTurnResponse,
  parseVoicePipelineTurnRequest
} from "./voice-session-schema.js";
import type {
  LessonControllerTurn,
  PublicLessonTurn,
  VoicePipelineAudioInput,
  VoicePipelineAudioOutput,
  VoicePipelineTurnRequest,
  VoicePipelineTurnResponse,
  VoicePreparedImage
} from "./voice-types.js";

export const defaultTutorModel = "gpt-5.5";
export const defaultTranscribeModel = "gpt-4o-transcribe";
export const defaultTtsModel = "gpt-4o-mini-tts";
export const defaultTtsVoice = "marin";

const maxOpenAiJsonResponseBytes = 256_000;
const openAiRequestTimeoutMs = 30_000;
const speechMimeType = "audio/mpeg";

export type VoicePipelineServiceEnv = {
  OPENAI_API_KEY: string | undefined;
  OPENAI_TRANSCRIBE_MODEL: string | undefined;
  OPENAI_TTS_MODEL: string | undefined;
  OPENAI_TTS_VOICE: string | undefined;
  OPENAI_TUTOR_MODEL: string | undefined;
};

type VoicePipelineOptions = {
  apiKey: string | undefined;
  transcribeModel: string;
  ttsModel: string;
  tutorModel: string;
  voice: string;
};

type CreateLessonTurnInput = {
  detail: TutorSessionDetail;
  image: VoicePreparedImage | null;
  studentText: string;
};

export function createVoicePipelineOptions(env: VoicePipelineServiceEnv): VoicePipelineOptions {
  return {
    apiKey: env.OPENAI_API_KEY,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL ?? defaultTranscribeModel,
    ttsModel: env.OPENAI_TTS_MODEL ?? defaultTtsModel,
    tutorModel: env.OPENAI_TUTOR_MODEL ?? defaultTutorModel,
    voice: env.OPENAI_TTS_VOICE ?? defaultTtsVoice
  };
}

export async function handleVoicePipelineTurnWithStore(
  body: unknown,
  env: VoicePipelineServiceEnv,
  store: SessionStore,
  requestContext: RequestContext
): Promise<VoicePipelineTurnResponse> {
  const request = parseVoicePipelineTurnRequest(body);
  const detail = await store.getSession(requestContext.ownerKey, request.sessionId);

  if (!detail) {
    throw new HttpError(404, "Session not found");
  }

  const options = createVoicePipelineOptions(env);
  const studentText = await readStudentText(request, options);
  const lesson = await createLessonTurn(
    {
      detail,
      image: request.image ?? null,
      studentText
    },
    options
  );
  const audio = await createTutorSpeech(lesson.spokenUtterance, options);
  const publicLesson = toPublicLessonTurn(lesson);
  const response = serializeVoicePipelineTurnResponse({
    audio,
    lesson: publicLesson,
    transcript: studentText,
    tutorText: lesson.spokenUtterance
  });

  await store.updateSession(requestContext.ownerKey, request.sessionId, { status: "active" });
  await store.appendEvent(requestContext.ownerKey, request.sessionId, {
    message: request.audio ? "Student turn" : request.image ? "Problem image submitted" : "Student turn",
    value: {
      hasAudio: Boolean(request.audio),
      hasImage: Boolean(request.image),
      text: studentText
    }
  });
  await store.appendEvent(requestContext.ownerKey, request.sessionId, {
    message: "Tutor turn",
    value: {
      lesson: publicLesson,
      text: lesson.spokenUtterance
    }
  });

  return response;
}

async function readStudentText(
  request: VoicePipelineTurnRequest,
  options: VoicePipelineOptions
): Promise<string> {
  const typedText = request.text?.trim() ?? "";

  if (!request.audio) {
    return typedText;
  }

  const transcript = await transcribeAudio(request.audio, options);
  return transcript || typedText;
}

async function transcribeAudio(
  audio: VoicePipelineAudioInput,
  options: VoicePipelineOptions
): Promise<string> {
  const apiKey = requireOpenAiApiKey(options);
  const form = new FormData();
  const blob = dataUrlToBlob(audio.dataUrl, audio.mimeType);

  form.append("file", blob, audio.name ?? "student-turn.webm");
  form.append("model", options.transcribeModel);
  form.append("response_format", "json");

  const payload = await fetchOpenAiJson("https://api.openai.com/v1/audio/transcriptions", {
    apiKey,
    body: form,
    method: "POST"
  });
  const text = asString(asRecord(payload).text)?.trim();

  if (!text) {
    throw new HttpError(502, "OpenAI transcription response did not include text.", payload);
  }

  return text;
}

async function createLessonTurn(
  input: CreateLessonTurnInput,
  options: VoicePipelineOptions
): Promise<LessonControllerTurn> {
  const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
    apiKey: requireOpenAiApiKey(options),
    body: JSON.stringify({
      input: createLessonInput(input),
      instructions: lessonControllerInstructions,
      model: options.tutorModel,
      text: {
        format: {
          name: "lesson_controller_turn",
          schema: lessonControllerJsonSchema,
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
    throw new HttpError(502, "OpenAI tutor response did not include output text.", payload);
  }

  try {
    return lessonControllerTurnFromJson(JSON.parse(outputText) as JsonValue);
  } catch (error) {
    throw new HttpError(
      502,
      "OpenAI tutor response was not valid lesson JSON.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function createTutorSpeech(
  text: string,
  options: VoicePipelineOptions
): Promise<VoicePipelineAudioOutput> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    body: JSON.stringify({
      input: text,
      instructions:
        "Speak like a calm tutor. Use a warm, patient tone. Keep the delivery concise and leave space for the student to answer.",
      model: options.ttsModel,
      voice: options.voice
    }),
    headers: {
      Authorization: `Bearer ${requireOpenAiApiKey(options)}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI text-to-speech request failed", await readOpenAiError(response));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    dataUrl: `data:${speechMimeType};base64,${bytesToBase64(bytes)}`,
    mimeType: speechMimeType,
    size: bytes.byteLength
  };
}

function createLessonInput(input: CreateLessonTurnInput): Array<Record<string, JsonValue>> {
  const content: Array<Record<string, JsonValue>> = [
    {
      text: createLessonPrompt(input),
      type: "input_text"
    }
  ];

  if (input.image) {
    content.push({
      image_url: input.image.dataUrl,
      type: "input_image"
    });
  }

  return [
    {
      content,
      role: "user"
    }
  ];
}

function createLessonPrompt(input: CreateLessonTurnInput): string {
  return JSON.stringify(
    {
      currentStudentTurn: input.studentText,
      currentSession: {
        imageName: input.detail.session.imageName,
        imagePrompt: input.detail.session.imagePrompt,
        status: input.detail.session.status
      },
      recentHistory: input.detail.events.slice(-14).map((event) => ({
        message: event.message,
        value: event.value
      })),
      task:
        "Choose the next tutor utterance for a one-step-at-a-time homework tutoring session. If this is the first image turn, orient to what the problem asks, then ask the first tiny question. If the student answered, check only that answer and either confirm, hint, or ask one next question."
    },
    null,
    2
  );
}

const lessonControllerInstructions = `${tutorPolicy.instructions}

You are no longer speaking freely. You are a lesson controller for a voice tutor.

Hard rules:
- Return only the requested JSON schema.
- spokenUtterance is the exact sentence(s) that will be spoken aloud.
- spokenUtterance must be no more than 32 words.
- Give exactly one small next step, one question, or one hint.
- Never reveal the final answer or full solution path upfront.
- If the student is wrong or stuck, give a smaller hint, not the answer.
- If this is the first image turn, briefly name what the problem is asking, then ask the first question.
- End spokenUtterance in a way that clearly waits for the student.
- Keep hiddenState private; it may include your internal estimate of the problem and next step, but never the full final answer unless absolutely needed for safety checking.`;

const lessonControllerJsonSchema = {
  additionalProperties: false,
  properties: {
    hiddenState: { type: "string" },
    phase: {
      enum: ["orient", "ask_step", "check_answer", "hint", "advance", "wrap"],
      type: "string"
    },
    safetyNotes: { type: "string" },
    spokenUtterance: { type: "string" },
    studentStatus: {
      enum: ["unknown", "correct", "partial", "stuck"],
      type: "string"
    },
    tutorAction: {
      enum: ["orient", "ask", "hint", "confirm", "wrap"],
      type: "string"
    }
  },
  required: ["phase", "studentStatus", "spokenUtterance", "tutorAction", "hiddenState", "safetyNotes"],
  type: "object"
};

function lessonControllerTurnFromJson(value: JsonValue): LessonControllerTurn {
  const record = asRecord(value);
  return {
    hiddenState: asStringValue(record.hiddenState, "hiddenState"),
    phase: asLessonPhase(record.phase),
    safetyNotes: asStringValue(record.safetyNotes, "safetyNotes"),
    spokenUtterance: asRequiredText(record.spokenUtterance, "spokenUtterance"),
    studentStatus: asStudentStatus(record.studentStatus),
    tutorAction: asTutorAction(record.tutorAction)
  };
}

function toPublicLessonTurn(lesson: LessonControllerTurn): PublicLessonTurn {
  return {
    phase: lesson.phase,
    spokenUtterance: lesson.spokenUtterance,
    studentStatus: lesson.studentStatus,
    tutorAction: lesson.tutorAction
  };
}

async function fetchOpenAiJson(
  url: string,
  init: RequestInit & { apiKey: string; headers?: Record<string, string> }
): Promise<JsonValue> {
  const { apiKey, headers, ...requestInit } = init;
  const response = await fetch(url, {
    ...requestInit,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...headers
    },
    signal: AbortSignal.timeout(openAiRequestTimeoutMs)
  });
  const payload = await readOpenAiJson(response);

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI request failed", payload);
  }

  return payload;
}

async function readOpenAiJson(response: Response): Promise<JsonValue> {
  const text = await readLimitedResponseText(response, maxOpenAiJsonResponseBytes);

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return { error: text };
  }
}

async function readOpenAiError(response: Response): Promise<JsonValue> {
  return readOpenAiJson(response);
}

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new HttpError(502, "OpenAI response was too large");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function extractOutputText(payload: JsonValue): string {
  const root = asRecord(payload);
  const direct = asString(root.output_text);

  if (direct) {
    return direct;
  }

  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];

  for (const item of output) {
    const content = asRecord(item).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const record = asRecord(part);
      const text = asString(record.text);

      if (text) {
        pieces.push(text);
      }
    }
  }

  return pieces.join("\n").trim();
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Blob {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const metadataParts = metadata.split(";").filter(Boolean);
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");

  if (!isBase64) {
    throw new HttpError(400, "Audio payload must be a base64 data URL.");
  }

  const mimeType = metadataParts[0]?.includes("/") ? metadataParts[0] : fallbackMimeType;
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function requireOpenAiApiKey(options: VoicePipelineOptions): string {
  if (!options.apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  return options.apiKey;
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asStringValue(value: JsonValue | undefined, key: string): string {
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Missing ${key}`);
}

function asRequiredText(value: JsonValue | undefined, key: string): string {
  const text = asStringValue(value, key);

  if (!text.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return text;
}

function asLessonPhase(value: JsonValue | undefined): LessonControllerTurn["phase"] {
  if (
    value === "orient" ||
    value === "ask_step" ||
    value === "check_answer" ||
    value === "hint" ||
    value === "advance" ||
    value === "wrap"
  ) {
    return value;
  }

  throw new Error("Invalid phase");
}

function asStudentStatus(value: JsonValue | undefined): LessonControllerTurn["studentStatus"] {
  if (value === "unknown" || value === "correct" || value === "partial" || value === "stuck") {
    return value;
  }

  throw new Error("Invalid studentStatus");
}

function asTutorAction(value: JsonValue | undefined): LessonControllerTurn["tutorAction"] {
  if (value === "orient" || value === "ask" || value === "hint" || value === "confirm" || value === "wrap") {
    return value;
  }

  throw new Error("Invalid tutorAction");
}
