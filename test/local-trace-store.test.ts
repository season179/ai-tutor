import assert from "node:assert/strict";

import {
  clearLocalTraceEvents,
  readLocalTraceSnapshot,
  recordLocalTraceEntry
} from "../src/core/local-trace-store.ts";

test("recordLocalTraceEntry writes enabled local trace events and reads them back", async () => {
  const env = {
    LOCAL_TRACE_DEBUG: "1",
    DB: makeTraceD1Stub()
  };

  await recordLocalTraceEntry(env, {
    message: "ai_tutor_stage_timing",
    durationMs: 42,
    route: "durable_object",
    sessionId: "session-1",
    stage: "voice.stt",
    status: "ok",
    turnId: "turn-1"
  });

  const snapshot = await readLocalTraceSnapshot(env, 10);

  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0]?.stage, "voice.stt");
  assert.equal(snapshot.events[0]?.traceId, "turn-1");
  assert.equal(snapshot.runs[0]?.slowestStage, "voice.stt");

  assert.equal(await clearLocalTraceEvents(env), 1);
  assert.equal((await readLocalTraceSnapshot(env, 10)).events.length, 0);
});

function makeTraceD1Stub(): D1Database {
  const rows: Record<string, unknown>[] = [];

  function prepare(query: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...bound: unknown[]) => {
        values = bound;
        return statement;
      },
      first: async () => rows.length,
      all: async () => {
        const limit = typeof values[0] === "number" ? values[0] : rows.length;
        return {
          results: rows.slice(0, limit),
          success: true,
          meta: {}
        } as D1Result;
      },
      run: async () => {
        if (/INSERT INTO local_trace_events/i.test(query)) {
          rows.unshift({
            id: values[0],
            recorded_at: values[1],
            trace_id: values[2],
            session_id: values[3],
            operation: values[4],
            route: values[5],
            stage: values[6],
            status: values[7],
            duration_ms: values[8],
            workflow: values[9],
            model: values[10],
            payload_json: values[11]
          });
        } else if (/DELETE FROM local_trace_events$/i.test(query.trim())) {
          rows.length = 0;
        }
        return { success: true, meta: {} } as D1Result;
      },
      raw: async () => []
    } as unknown as D1PreparedStatement;
    return statement;
  }

  return {
    exec: async () => ({ count: 0, duration: 0 }) as D1ExecResult,
    prepare,
    batch: async (statements) => statements.map(() => ({ success: true, meta: {} }) as D1Result),
    withDatabase: () => null as unknown as D1Database
  } as unknown as D1Database;
}
