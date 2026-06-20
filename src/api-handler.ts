import { type Auth } from "./modules/auth/auth.js";
import { HttpError, type JsonValue } from "./core/http-error.js";
import type { SessionStore } from "./modules/sessions/session-store.js";
import { readJsonBody } from "./modules/sessions/session-handler.js";
import type { ProcessTurnPayload, SessionRuntimeDO } from "./modules/sessions/session-runtime-do.js";
import { createVoiceSessionWithStore } from "./modules/voice/voice-session-handler.js";
import { handleVoicePipelineTurnWithStore } from "./modules/voice/voice-pipeline-service.js";
import { parseVoicePipelineTurnRequest } from "./modules/voice/voice-session-schema.js";
import { type VoiceSessionServiceEnv } from "./modules/voice/voice-session-service.js";
import { maxVoiceTurnBodyBytes, voiceSessionPath, voiceTurnPath, type VoicePipelineTurnResponse } from "./modules/voice/voice-types.js";
import { buildOwnerKey, type AuthIdentity, type RequestContext } from "./core/request-context.js";

export type ApiHandlerEnv = VoiceSessionServiceEnv;

export type ApiHandlerEnvSource = VoiceSessionServiceEnv;

export type ApiHandlerOptions = {
  auth: Auth;
  sessionRuntime?: DurableObjectNamespace<SessionRuntimeDO> | undefined;
  store: SessionStore;
};

export function createApiHandlerEnv(source: ApiHandlerEnvSource): ApiHandlerEnv {
  return {
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    OPENAI_GATE_CHECKER_MODEL: source.OPENAI_GATE_CHECKER_MODEL,
    OPENAI_REALTIME_MODEL: source.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: source.OPENAI_REALTIME_VOICE,
    OPENAI_SAFETY_IDENTIFIER: source.OPENAI_SAFETY_IDENTIFIER,
    OPENAI_TRANSCRIBE_MODEL: source.OPENAI_TRANSCRIBE_MODEL,
    OPENAI_TTS_MODEL: source.OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE: source.OPENAI_TTS_VOICE,
    OPENAI_TUTOR_MODEL: source.OPENAI_TUTOR_MODEL,
    OPENAI_VERIFIER_MODEL: source.OPENAI_VERIFIER_MODEL,
    VOICE_BACKEND: source.VOICE_BACKEND
  };
}

function json(payload: JsonValue, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function isApiPath(pathname: string): boolean {
  return pathname === voiceSessionPath || pathname === voiceTurnPath;
}

function unauthorized(): HttpError {
  return new HttpError(401, "Unauthorized");
}

async function authenticate(request: Request, auth: Auth): Promise<RequestContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw unauthorized();
  }

  const userId = session.user.id;
  const identity: AuthIdentity = {
    userId,
    ...(session.user.email ? { email: session.user.email } : {})
  };

  return {
    identity,
    ownerKey: buildOwnerKey(userId)
  };
}

export async function handleApiRequest(
  request: Request,
  env: ApiHandlerEnv,
  options: ApiHandlerOptions
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isApiPath(url.pathname)) {
    return null;
  }

  try {
    const context = await authenticate(request, options.auth);

    if (url.pathname === voiceSessionPath) {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }

      const descriptor = await createVoiceSessionWithStore(
        await readJsonBody(request),
        env,
        options.store,
        context
      );

      return json(descriptor, 200);
    }

    if (url.pathname === voiceTurnPath) {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }

      const body = await readJsonBody(request, maxVoiceTurnBodyBytes);

      if (options.sessionRuntime) {
        const parsed = parseVoicePipelineTurnRequest(body);
        const stub = options.sessionRuntime.getByName(parsed.sessionId) as DurableObjectStub & {
          processTurn(payload: ProcessTurnPayload): Promise<VoicePipelineTurnResponse>;
        };
        const response = await stub.processTurn({ body, context });
        return json(response, 200);
      }

      const response = await handleVoicePipelineTurnWithStore(body, env, options.store, context);

      return json(response, 200);
    }

    // isApiPath only admits the voice endpoints handled above; sessions and
    // problem-context now run through TanStack Start server functions, not /api/*.
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return handleApiError(error, url);
  }
}

function handleApiError(error: unknown, url: URL): Response {
  if (error instanceof HttpError) {
    if (error.message === "Missing OPENAI_API_KEY") {
      return json({ error: "Server is missing OPENAI_API_KEY." }, 500);
    }

    if (
      error.message.startsWith("Unsupported VOICE_BACKEND") ||
      error.message.startsWith("VOICE_BACKEND=")
    ) {
      return json({ error: error.message }, error.status);
    }

    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    return json({ error: error.message || "Request failed." }, status);
  }

  console.error(
    JSON.stringify({
      message: "unexpected api request failure",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  return json({ error: "Internal server error" }, 500);
}
