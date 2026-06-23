import type { JsonValue } from "../../core/http-error.js";
import { isJsonObject } from "../../core/schema-parser.js";

// This module once owned the shared OpenAI fetch helper. Only `extractOutputText`
// survives: the tutor-turn reasoning path wraps its structured result in a synthetic
// `{ output_text }` envelope so the existing parse/validate pipeline in
// voice-pipeline-service.ts is reused unchanged.

/**
 * Extracts the model's text output from an OpenAI-style response envelope.
 *
 * Used today only to unwrap the synthetic `{ output_text }` envelope the tutor-turn
 * reasoning path builds around a structured result. Handles both the flat `output_text`
 * shape and the older `output[].content[].text` nested shape for back-compat.
 */
export function extractOutputText(payload: JsonValue): string {
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

function asRecord(value: unknown): Record<string, JsonValue> {
  return isJsonObject(value) ? (value as Record<string, JsonValue>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
