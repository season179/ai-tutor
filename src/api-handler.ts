import { type Auth } from "./auth.js";
import { HttpError, type JsonValue } from "./http-error.js";
import type { SessionStore } from "./session-store.js";
import { handleSessionsRequest, readJsonBody } from "./session-handler.js";
import { sessionsPath } from "./session-types.js";
import { createVoiceSessionWithStore } from "./voice-session-handler.js";
import { handleVoicePipelineTurnWithStore } from "./voice-pipeline-service.js";
import { type VoiceSessionServiceEnv } from "./voice-session-service.js";
import { maxVoiceTurnBodyBytes, voiceSessionPath, voiceTurnPath } from "./voice-types.js";
import { buildOwnerKey, type AuthIdentity, type RequestContext } from "./request-context.js";

export type ApiHandlerEnv = VoiceSessionServiceEnv;

export type ApiHandlerEnvSource = {
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_MODEL?: string;
  OPENAI_REALTIME_VOICE?: string;
  OPENAI_SAFETY_IDENTIFIER?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  OPENAI_TUTOR_MODEL?: string;
  VOICE_BACKEND?: string;
};

export type ApiHandlerOptions = {
  auth: Auth;
  store: SessionStore;
};

export function createApiHandlerEnv(source: ApiHandlerEnvSource): ApiHandlerEnv {
  return {
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: source.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: source.OPENAI_REALTIME_VOICE,
    OPENAI_SAFETY_IDENTIFIER: source.OPENAI_SAFETY_IDENTIFIER,
    OPENAI_TRANSCRIBE_MODEL: source.OPENAI_TRANSCRIBE_MODEL,
    OPENAI_TTS_MODEL: source.OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE: source.OPENAI_TTS_VOICE,
    OPENAI_TUTOR_MODEL: source.OPENAI_TUTOR_MODEL,
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
  return (
    pathname === voiceSessionPath ||
    pathname === voiceTurnPath ||
    pathname === sessionsPath ||
    pathname.startsWith(`${sessionsPath}/`)
  );
}

function unauthorized(): HttpError {
  return new HttpError(401, "Unauthorized");
}

/**
 * Resolves the authenticated user from the better-auth session cookie.
 * Returns a RequestContext whose ownerKey is the better-auth user id, or
 * throws 401 if there is no valid session.
 */
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

      const response = await handleVoicePipelineTurnWithStore(
        await readJsonBody(request, maxVoiceTurnBodyBytes),
        env,
        options.store,
        context
      );

      return json(response, 200);
    }

    const payload = await handleSessionsRequest(request, context, options.store);
    return json(payload as JsonValue, 200);
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
