import { HttpError } from "./http-error.js";
import {
  createVoiceSessionService,
  type VoiceSessionContext,
  type VoiceSessionServiceEnv
} from "./voice-session-service.js";
import { serializeVoiceSessionDescriptor } from "./voice-session-schema.js";
import type { CreateVoiceSessionRequest, VoiceSessionDescriptor } from "./voice-types.js";

export function parseCreateVoiceSessionRequest(value: unknown): CreateVoiceSessionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Voice session request must be a JSON object");
  }

  const intent = (value as { intent?: unknown }).intent;
  if (intent !== "tutor") {
    throw new HttpError(400, `Unsupported voice session intent: ${String(intent)}`);
  }

  return { intent };
}

export async function createVoiceSession(
  body: unknown,
  env: VoiceSessionServiceEnv,
  context: VoiceSessionContext = {}
): Promise<VoiceSessionDescriptor> {
  const request = parseCreateVoiceSessionRequest(body);
  const voiceSessionService = createVoiceSessionService(env);
  const descriptor = await voiceSessionService.createSession(request, context);

  return serializeVoiceSessionDescriptor(descriptor);
}
