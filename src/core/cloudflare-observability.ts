import { tracing } from "cloudflare:workers";

import {
  isLocalTraceEnabled,
  recordLocalTraceEntry,
  type LocalTraceEnv
} from "./local-trace-store.js";
import {
  createObservabilityContext,
  type ObservabilityAttributes,
  type ObservabilityContext
} from "./observability.js";

export function createCloudflareObservability(
  base: ObservabilityAttributes,
  options: {
    env?: LocalTraceEnv | undefined;
    waitUntil?: ((promise: Promise<void>) => void) | undefined;
  } = {}
): ObservabilityContext {
  return createObservabilityContext(base, {
    emitLog: (entry, level) => {
      emitStructuredLog(entry, level);
      if (isLocalTraceEnabled(options.env)) {
        const write = recordLocalTraceEntry(options.env, entry);
        if (options.waitUntil) {
          options.waitUntil(write);
        } else {
          void write;
        }
      }
    },
    enterSpan: (name, _attributes, callback) => tracing.enterSpan(name, (span) => callback(span))
  });
}

function emitStructuredLog(entry: Record<string, unknown>, level: "log" | "error"): void {
  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}
