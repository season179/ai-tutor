import {
  createLocalTraceEvent,
  summarizeLocalTraceRuns,
  type LocalTraceEvent,
  type LocalTraceSnapshot
} from "./local-trace-types.js";

export type LocalTraceEnv = {
  DB?: D1Database | undefined;
  LOCAL_TRACE_DEBUG?: string | undefined;
  LOCAL_TRACE_LIMIT?: string | undefined;
};

const defaultTraceLimit = 500;
const maxTraceLimit = 2_000;
let initPromise: Promise<void> | null = null;
let writesSincePrune = 0;

export function isLocalTraceEnabled(env: LocalTraceEnv | undefined): boolean {
  const value = env?.LOCAL_TRACE_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function recordLocalTraceEntry(
  env: LocalTraceEnv | undefined,
  entry: Record<string, unknown>
): Promise<void> {
  if (!isLocalTraceEnabled(env) || !env?.DB) {
    return;
  }

  try {
    const event = createLocalTraceEvent(entry);
    await ensureLocalTraceTable(env.DB);
    await env.DB.prepare(
      `INSERT INTO local_trace_events (
         id, recorded_at, trace_id, session_id, operation, route, stage, status,
         duration_ms, workflow, model, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        event.id,
        event.recordedAt,
        event.traceId,
        event.sessionId,
        event.operation,
        event.route,
        event.stage,
        event.status,
        event.durationMs,
        event.workflow,
        event.model,
        JSON.stringify(event.payload)
      )
      .run();

    writesSincePrune += 1;
    if (writesSincePrune >= 25) {
      writesSincePrune = 0;
      await pruneLocalTraceEvents(env.DB, traceLimit(env));
    }
  } catch (error) {
    console.error("local trace write failed", error instanceof Error ? error.message : String(error));
  }
}

export async function readLocalTraceSnapshot(
  env: LocalTraceEnv | undefined,
  requestedLimit = defaultTraceLimit
): Promise<LocalTraceSnapshot> {
  const limit = clampLimit(requestedLimit);
  if (!isLocalTraceEnabled(env)) {
    return { enabled: false, events: [], runs: [], limit };
  }
  if (!env?.DB) {
    return { enabled: true, events: [], runs: [], limit, error: "D1 binding is unavailable." };
  }

  try {
    await ensureLocalTraceTable(env.DB);
    const result = await env.DB.prepare(
      `SELECT id, recorded_at, trace_id, session_id, operation, route, stage, status,
              duration_ms, workflow, model, payload_json
         FROM local_trace_events
        ORDER BY recorded_at DESC
        LIMIT ?`
    )
      .bind(limit)
      .all<LocalTraceRow>();
    const events = (result.results ?? []).map(rowToEvent);
    return { enabled: true, events, runs: summarizeLocalTraceRuns(events), limit };
  } catch (error) {
    return {
      enabled: true,
      events: [],
      runs: [],
      limit,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function clearLocalTraceEvents(env: LocalTraceEnv | undefined): Promise<number> {
  if (!isLocalTraceEnabled(env) || !env?.DB) {
    return 0;
  }

  try {
    await ensureLocalTraceTable(env.DB);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM local_trace_events")
      .first<{ count: number }>("count");
    await env.DB.prepare("DELETE FROM local_trace_events").run();
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.error("local trace clear failed", error instanceof Error ? error.message : String(error));
    return 0;
  }
}

function traceLimit(env: LocalTraceEnv): number {
  return clampLimit(Number(env.LOCAL_TRACE_LIMIT ?? defaultTraceLimit));
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultTraceLimit;
  }
  return Math.max(1, Math.min(maxTraceLimit, Math.floor(value)));
}

async function ensureLocalTraceTable(db: D1Database): Promise<void> {
  initPromise ??= (async () => {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS local_trace_events (
       id TEXT PRIMARY KEY,
       recorded_at TEXT NOT NULL,
       trace_id TEXT,
       session_id TEXT,
       operation TEXT,
       route TEXT,
       stage TEXT NOT NULL,
       status TEXT NOT NULL,
       duration_ms REAL NOT NULL,
       workflow TEXT,
       model TEXT,
       payload_json TEXT NOT NULL
     )`
    ).run();
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS local_trace_events_recorded_at_idx
         ON local_trace_events(recorded_at)`
    ).run();
    await db.prepare(
      `CREATE INDEX IF NOT EXISTS local_trace_events_session_id_idx
         ON local_trace_events(session_id)`
    ).run();
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

async function pruneLocalTraceEvents(db: D1Database, limit: number): Promise<void> {
  await db.prepare(
    `DELETE FROM local_trace_events
      WHERE id IN (
        SELECT id
          FROM local_trace_events
         ORDER BY recorded_at DESC
         LIMIT -1 OFFSET ?
      )`
  )
    .bind(limit)
    .run();
}

type LocalTraceRow = {
  id: string;
  recorded_at: string;
  trace_id: string | null;
  session_id: string | null;
  operation: string | null;
  route: string | null;
  stage: string;
  status: string;
  duration_ms: number;
  workflow: string | null;
  model: string | null;
  payload_json: string;
};

function rowToEvent(row: LocalTraceRow): LocalTraceEvent {
  return {
    id: row.id,
    recordedAt: row.recorded_at,
    traceId: row.trace_id,
    sessionId: row.session_id,
    operation: row.operation,
    route: row.route,
    stage: row.stage,
    status: row.status === "error" ? "error" : "ok",
    durationMs: row.duration_ms,
    workflow: row.workflow,
    model: row.model,
    payload: parsePayload(row.payload_json)
  };
}

function parsePayload(value: string): LocalTraceEvent["payload"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LocalTraceEvent["payload"])
      : {};
  } catch {
    return {};
  }
}
