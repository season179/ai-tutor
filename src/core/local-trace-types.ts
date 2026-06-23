import type { JsonValue } from "./http-error.js";

export type LocalTraceEvent = {
  id: string;
  recordedAt: string;
  traceId: string | null;
  sessionId: string | null;
  operation: string | null;
  route: string | null;
  stage: string;
  status: "ok" | "error";
  durationMs: number;
  workflow: string | null;
  model: string | null;
  payload: Record<string, JsonValue>;
};

export type LocalTraceRun = {
  traceId: string;
  sessionId: string | null;
  operation: string | null;
  route: string | null;
  status: "ok" | "error";
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  slowestStage: string | null;
  slowestDurationMs: number;
  events: LocalTraceEvent[];
};

export type LocalTraceSnapshot = {
  enabled: boolean;
  events: LocalTraceEvent[];
  runs: LocalTraceRun[];
  limit: number;
  error?: string;
};

export function createLocalTraceEvent(
  entry: Record<string, unknown>,
  options: { id?: string; recordedAt?: string } = {}
): LocalTraceEvent {
  const payload = toJsonRecord(entry);
  const durationMs = numberValue(payload.durationMs) ?? 0;
  const stage = stringValue(payload.stage) ?? "unknown";
  const status = payload.status === "error" ? "error" : "ok";

  return {
    id: options.id ?? crypto.randomUUID(),
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    traceId: stringValue(payload.turnId) ?? stringValue(payload.requestId),
    sessionId: stringValue(payload.sessionId),
    operation: stringValue(payload.operation),
    route: stringValue(payload.route),
    stage,
    status,
    durationMs,
    workflow: stringValue(payload.workflow),
    model: stringValue(payload.model),
    payload
  };
}

export function summarizeLocalTraceRuns(events: LocalTraceEvent[]): LocalTraceRun[] {
  const groups = new Map<string, LocalTraceEvent[]>();
  for (const event of events) {
    const key = event.traceId ?? event.id;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()]
    .map(([traceId, groupedEvents]) => {
      const sortedEvents = groupedEvents.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const rootEvent =
        sortedEvents.find((event) => event.stage === "voice.turn") ??
        sortedEvents.find((event) => event.stage === "problem.extract_request");
      const stageEvents = sortedEvents.filter((event) => !isRootStage(event.stage));
      const slowest = stageEvents.reduce<LocalTraceEvent | null>(
        (current, event) => (!current || event.durationMs > current.durationMs ? event : current),
        null
      );
      const status: LocalTraceRun["status"] = sortedEvents.some((event) => event.status === "error")
        ? "error"
        : "ok";

      return {
        traceId,
        sessionId: sortedEvents.find((event) => event.sessionId)?.sessionId ?? null,
        operation: sortedEvents.find((event) => event.operation)?.operation ?? null,
        route: sortedEvents.find((event) => event.route)?.route ?? null,
        status,
        startedAt: sortedEvents[0]?.recordedAt ?? "",
        endedAt: sortedEvents.at(-1)?.recordedAt ?? "",
        totalDurationMs: rootEvent?.durationMs ?? sumDurations(sortedEvents),
        slowestStage: slowest?.stage ?? null,
        slowestDurationMs: slowest?.durationMs ?? 0,
        events: sortedEvents
      };
    })
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

function sumDurations(events: LocalTraceEvent[]): number {
  return Math.round(events.reduce((total, event) => total + event.durationMs, 0) * 100) / 100;
}

function isRootStage(stage: string): boolean {
  return stage === "voice.turn" || stage === "problem.extract_request";
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJsonRecord(entry: Record<string, unknown>): Record<string, JsonValue> {
  const record: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(entry)) {
    const json = toJsonValue(value);
    if (json !== undefined) {
      record[key] = json;
    }
  }
  return record;
}

function toJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (depth >= 3) {
      return [];
    }
    return value
      .map((item) => toJsonValue(item, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value === "object") {
    if (depth >= 3) {
      return {};
    }
    const record: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      const json = toJsonValue(child, depth + 1);
      if (json !== undefined) {
        record[key] = json;
      }
    }
    return record;
  }
  return undefined;
}
