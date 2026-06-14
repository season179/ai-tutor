export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RealtimeClientSecretOptions = {
  apiKey: string | undefined;
  instructions: string | undefined;
  model: string | undefined;
  safetyIdentifierSeed: string | undefined;
  timeoutMs?: number;
  voice: string | undefined;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: JsonValue
  ) {
    super(message);
  }
}

export const defaultRealtimeModel = "gpt-realtime-2";
export const defaultRealtimeVoice = "marin";
export const defaultSafetyIdentifier = "local-ai-tutor-user";
const maxOpenAiResponseBytes = 64_000;
export const tutorInstructions =
  "You are AI Tutor, a patient realtime voice tutor. Help students reason through homework step by step, ask a clarifying question when the goal is unclear, and guide learning instead of only giving final answers. Keep spoken replies concise unless the student asks for detail.";

export async function createRealtimeClientSecret(options: RealtimeClientSecretOptions): Promise<JsonValue> {
  const apiKey = options.apiKey;

  if (!apiKey) {
    throw new HttpError(500, "Missing OPENAI_API_KEY");
  }

  const safetyIdentifier = await hashSafetyIdentifier(options.safetyIdentifierSeed ?? defaultSafetyIdentifier);
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: options.model ?? defaultRealtimeModel,
        instructions: options.instructions ?? tutorInstructions,
        audio: {
          output: {
            voice: options.voice ?? defaultRealtimeVoice
          }
        }
      }
    })
  });

  const rawBody = await readResponseText(response, maxOpenAiResponseBytes);
  let payload: JsonValue;

  try {
    payload = JSON.parse(rawBody) as JsonValue;
  } catch {
    payload = { error: rawBody };
  }

  if (!response.ok) {
    throw new HttpError(response.status, "OpenAI client secret request failed", payload);
  }

  return payload;
}

async function hashSafetyIdentifier(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return text + decoder.decode();
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new HttpError(502, "OpenAI response was too large");
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
