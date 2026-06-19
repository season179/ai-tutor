import { HttpError, type JsonValue } from "./http-error.js";
import { allowedMoves, canTransition, forbiddenMoves } from "./phase-policy.js";
import type { RequestContext } from "./request-context.js";
import type { SessionStore } from "./session-store.js";
import type { TutorSessionDetail } from "./session-types.js";
import { isJsonObject } from "./schema-parser.js";
import {
  gateForbiddenMoves,
  sessionPhases,
  tutorMoves,
  type ProposedMove,
  type ProposedTutorAction,
  type SessionPhase
} from "./tutor-action.js";
import { validateTutorAction } from "./tutor-action-validator.js";
import { tutorPolicy } from "./tutor-policy.js";
import {
  serializeVoicePipelineTurnResponse,
  parseVoicePipelineTurnRequest
} from "./voice-session-schema.js";
import type {
  LessonPhase,
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
// How many times the generator may be re-asked when its proposed turn fails the
// phase rules before we give up. The gate must never be talked past, so a turn that
// keeps proposing illegal moves fails rather than reaching TTS.
const maxTutorAttempts = 2;

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

type TutorTurnInput = {
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
  const fromPhase = detail.session.currentPhase;

  // The server owns the phase; the generator only proposes a move within it, and the
  // validator must accept that move before anything is spoken.
  const action = await proposeTutorAction({ detail, image: request.image ?? null, studentText }, options);

  const audio = await createTutorSpeech(action.spokenUtterance, options);
  const publicLesson = projectToPublicLesson(action);
  const response = serializeVoicePipelineTurnResponse({
    audio,
    lesson: publicLesson,
    transcript: studentText,
    tutorText: action.spokenUtterance
  });

  const toPhase = nextPhaseFor(fromPhase, action);
  // Optimistic lock on the phase we read. A null result means a concurrent turn already
  // moved the session off `fromPhase`, so this turn is stale: bail rather than recording a
  // transition that never happened or speaking over the turn that won the race.
  const advanced = await store.advanceSessionPhase(requestContext.ownerKey, request.sessionId, fromPhase, {
    currentPhase: toPhase,
    gateStatus: detail.session.gateStatus,
    supportLevel: detail.session.supportLevel
  });
  if (!advanced) {
    throw new HttpError(409, "This session was advanced by another turn. Please retry.");
  }
  // Only the first turn flips draft → active; skip the write once it already is.
  if (detail.session.status !== "active") {
    await store.updateSession(requestContext.ownerKey, request.sessionId, { status: "active" });
  }
  await store.appendEvent(requestContext.ownerKey, request.sessionId, {
    message: request.image && !request.audio ? "Problem image submitted" : "Student turn",
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
      move: action.move,
      phase: fromPhase,
      nextPhase: toPhase,
      text: action.spokenUtterance
    }
  });

  return response;
}

function nextPhaseFor(fromPhase: SessionPhase, action: ProposedTutorAction): SessionPhase {
  const proposed = action.statePatch?.nextPhase;
  return proposed && canTransition(fromPhase, proposed) ? proposed : fromPhase;
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

async function proposeTutorAction(
  input: TutorTurnInput,
  options: VoicePipelineOptions
): Promise<ProposedTutorAction> {
  const phase = input.detail.session.currentPhase;
  let rejectionReasons: string[] = [];

  for (let attempt = 0; attempt < maxTutorAttempts; attempt += 1) {
    const payload = await fetchOpenAiJson("https://api.openai.com/v1/responses", {
      apiKey: requireOpenAiApiKey(options),
      body: JSON.stringify({
        input: createTutorInput(input),
        instructions: tutorActionInstructions(phase, rejectionReasons),
        model: options.tutorModel,
        text: {
          format: {
            name: "tutor_action",
            schema: proposedTutorActionJsonSchema(phase),
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

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(outputText) as JsonValue;
    } catch (error) {
      throw new HttpError(
        502,
        "OpenAI tutor response was not valid JSON.",
        error instanceof Error ? error.message : String(error)
      );
    }

    let proposed: ProposedTutorAction;
    try {
      proposed = proposedTutorActionFromJson(parsed, phase);
    } catch (error) {
      // A well-formed JSON object with an unusable move or shape is the model misbehaving —
      // the same class the validator catches — so re-ask rather than failing the whole turn.
      rejectionReasons = [error instanceof Error ? error.message : String(error)];
      continue;
    }

    const verdict = validateTutorAction(proposed, { phase });
    if (verdict.ok) {
      return proposed;
    }

    rejectionReasons = verdict.reasons;
  }

  throw new HttpError(502, "Tutor could not produce a valid turn within the phase rules.", {
    phase,
    reasons: rejectionReasons
  });
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

function createTutorInput(input: TutorTurnInput): Array<Record<string, JsonValue>> {
  const content: Array<Record<string, JsonValue>> = [
    {
      text: createTutorPrompt(input),
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

function createTutorPrompt(input: TutorTurnInput): string {
  return JSON.stringify(
    {
      currentPhase: input.detail.session.currentPhase,
      currentStudentTurn: input.studentText,
      currentSession: {
        imageName: input.detail.session.imageName,
        imagePrompt: input.detail.session.imagePrompt,
        status: input.detail.session.status
      },
      // Events are stored newest-first; take the 14 most recent and present them
      // oldest-to-newest so the model reads the conversation in order.
      recentHistory: input.detail.events
        .slice(0, 14)
        .reverse()
        .map((event) => ({
          message: event.message,
          value: event.value
        }))
    },
    null,
    2
  );
}

function tutorActionInstructions(phase: SessionPhase, rejectionReasons: string[]): string {
  const allowed = allowedMoves(phase).join(", ");
  const forbidden = forbiddenMoves(phase).join(", ");
  const retry = rejectionReasons.length
    ? `\n\nYour previous attempt was rejected for these reasons:\n- ${rejectionReasons.join("\n- ")}\nChoose a different move or rephrase so it passes.`
    : "";

  return `${tutorPolicy.instructions}

You are the move generator for a server-enforced tutoring state machine. The server owns the phase; you only choose the next move and phrase it.

Current phase: "${phase}".
Moves you may use this phase: ${allowed}.
Never use these moves: ${forbidden} — they solve or reveal the answer.

Hard rules:
- Return only the requested JSON schema.
- "move" must be one of the allowed moves above.
- "spokenUtterance" is the exact words spoken aloud: at most 32 words, exactly one cognitive demand (one question or one small step), ending so it clearly waits for the student. Never reveal the final answer.
- "nextPhase" is where the session should go next; keep it at "${phase}" unless the student is ready to move on.${retry}`;
}

function proposedTutorActionJsonSchema(phase: SessionPhase): Record<string, JsonValue> {
  return {
    additionalProperties: false,
    properties: {
      move: { enum: [...allowedMoves(phase)], type: "string" },
      nextPhase: { enum: sessionPhases.filter((candidate) => canTransition(phase, candidate)), type: "string" },
      spokenUtterance: { type: "string" }
    },
    required: ["move", "nextPhase", "spokenUtterance"],
    type: "object"
  };
}

const proposableMoves: readonly ProposedMove[] = [...tutorMoves, ...gateForbiddenMoves];

function proposedTutorActionFromJson(value: JsonValue, phase: SessionPhase): ProposedTutorAction {
  const record = asRecord(value);
  const move = asProposedMove(record.move);
  const spokenUtterance = asRequiredText(record.spokenUtterance, "spokenUtterance");
  const nextPhase = asOptionalSessionPhase(record.nextPhase);

  const action: ProposedTutorAction = { move, phase, spokenUtterance };
  if (nextPhase) {
    action.statePatch = { nextPhase };
  }

  return action;
}

function asProposedMove(value: JsonValue | undefined): ProposedMove {
  if (typeof value === "string" && proposableMoves.some((move) => move === value)) {
    return value as ProposedMove;
  }

  throw new Error("Invalid move");
}

function asOptionalSessionPhase(value: JsonValue | undefined): SessionPhase | undefined {
  if (typeof value === "string" && sessionPhases.some((candidate) => candidate === value)) {
    return value as SessionPhase;
  }

  return undefined;
}

// The client renders the legacy six-phase lesson shape; project the canonical turn
// onto it so the existing pipeline keeps working while the contract grows underneath.
// Both maps are typed as exhaustive Records, so adding a phase or move is a compile
// error here until its projection is declared — no silent fall-through to a default.
const lessonPhaseBySessionPhase: Record<SessionPhase, LessonPhase> = {
  session_open: "orient",
  capture_parse: "orient",
  frame_task: "orient",
  activate_prior: "orient",
  plan_first_step: "ask_step",
  step_loop: "ask_step",
  answer_check: "check_answer",
  memory_write: "wrap",
  transfer_check: "advance",
  wrap_up: "wrap"
};

const legacyTutorActionByMove: Record<ProposedMove, PublicLessonTurn["tutorAction"]> = {
  rapport_check: "orient",
  recall_prior: "orient",
  clarify_context: "orient",
  three_reads_1: "ask",
  three_reads_2: "ask",
  three_reads_3: "ask",
  restate_prompt: "ask",
  elicit: "ask",
  scaffold_hint: "hint",
  precision_check: "ask",
  feedback_with_why: "confirm",
  model_micro_step: "hint",
  fade: "hint",
  transfer_check: "ask",
  wrap: "wrap",
  reset: "orient",
  safety_boundary: "orient",
  escalate: "orient",
  // Leak markers never reach a validated turn, but the map must stay exhaustive.
  solve: "ask",
  final_answer: "ask",
  calculation_hint: "ask",
  check_answer: "ask"
};

function projectToPublicLesson(action: ProposedTutorAction): PublicLessonTurn {
  return {
    phase: lessonPhaseBySessionPhase[action.phase],
    spokenUtterance: action.spokenUtterance,
    // No assessment until the separate verifier (M4); the tutor never self-grades.
    studentStatus: "unknown",
    tutorAction: legacyTutorActionByMove[action.move]
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

function asRequiredText(value: JsonValue | undefined, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}
