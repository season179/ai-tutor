import {
  createRealtimeClientSecret,
  defaultSafetyIdentifier,
  HttpError,
  tutorInstructions,
  type JsonValue
} from "./realtime-token.js";

const tokenPath = "/token";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === tokenPath) {
      return handleTokenRequest(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

async function handleTokenRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const baseHeaders = {
    "Cache-Control": "no-store"
  };

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, {
      ...baseHeaders,
      Allow: "POST"
    });
  }

  if (!isAllowedOrigin(request, url)) {
    return json({ error: "Forbidden" }, 403, baseHeaders);
  }

  const callerKey = readCallerKey(request);
  const rateLimitResponse = await limitTokenRequest(env, callerKey);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const token = await createRealtimeClientSecret({
      apiKey: env.OPENAI_API_KEY,
      instructions: tutorInstructions,
      model: env.OPENAI_REALTIME_MODEL,
      safetyIdentifierSeed: `${env.OPENAI_SAFETY_IDENTIFIER ?? defaultSafetyIdentifier}:${callerKey}`,
      voice: env.OPENAI_REALTIME_VOICE
    });

    return json(token, 200, baseHeaders);
  } catch (error) {
    return handleTokenError(error, url);
  }
}

async function limitTokenRequest(env: Env, key: string): Promise<Response | undefined> {
  const limiter = env.REALTIME_TOKEN_RATE_LIMITER;

  if (!limiter) {
    return undefined;
  }

  const { success } = await limiter.limit({ key });

  if (success) {
    return undefined;
  }

  return json(
    { error: "Too many session requests. Please wait a moment and try again." },
    429,
    {
      "Cache-Control": "no-store",
      "Retry-After": "60"
    }
  );
}

function isAllowedOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");

  return !origin || origin === url.origin;
}

function readCallerKey(request: Request): string {
  const connectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (connectingIp) {
    return `ip:${connectingIp}`;
  }

  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",").at(0)?.trim();
  if (forwardedFor) {
    return `ip:${forwardedFor}`;
  }

  return "anonymous";
}

function handleTokenError(error: unknown, url: URL): Response {
  if (error instanceof HttpError) {
    console.error(
      JSON.stringify({
        message: "realtime client secret request failed",
        path: url.pathname,
        status: error.status,
        details: error.payload ?? null
      })
    );

    if (error.message === "Missing OPENAI_API_KEY") {
      return json({ error: "Server is missing OPENAI_API_KEY." }, 500, {
        "Cache-Control": "no-store"
      });
    }

    const status = error.status >= 400 && error.status < 500 ? error.status : 502;

    return json({ error: "Failed to create Realtime session." }, status, {
      "Cache-Control": "no-store"
    });
  }

  console.error(
    JSON.stringify({
      message: "unexpected token request failure",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error)
    })
  );

  return json({ error: "Internal server error" }, 500, {
    "Cache-Control": "no-store"
  });
}

function json(payload: JsonValue, status: number, headers: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
