import assert from "node:assert/strict";

import {
  createLocalTraceEvent,
  summarizeLocalTraceRuns
} from "../src/core/local-trace-types.ts";

test("summarizeLocalTraceRuns groups stages by turn id and identifies the slowest stage", () => {
  const events = [
    createLocalTraceEvent(
      {
        message: "ai_tutor_stage_timing",
        operation: "voice_turn",
        route: "durable_object",
        sessionId: "session-a",
        stage: "voice.stt",
        status: "ok",
        durationMs: 120,
        turnId: "turn-a"
      },
      { id: "event-1", recordedAt: "2026-06-23T00:00:01.000Z" }
    ),
    createLocalTraceEvent(
      {
        message: "ai_tutor_stage_timing",
        operation: "voice_turn",
        route: "durable_object",
        sessionId: "session-a",
        stage: "reasoning.workflow",
        workflow: "tutor-turn",
        status: "ok",
        durationMs: 900,
        turnId: "turn-a"
      },
      { id: "event-2", recordedAt: "2026-06-23T00:00:02.000Z" }
    ),
    createLocalTraceEvent(
      {
        message: "ai_tutor_stage_timing",
        operation: "voice_turn",
        route: "durable_object",
        sessionId: "session-a",
        stage: "voice.turn",
        status: "ok",
        durationMs: 1400,
        turnId: "turn-a"
      },
      { id: "event-3", recordedAt: "2026-06-23T00:00:03.000Z" }
    )
  ];

  const runs = summarizeLocalTraceRuns(events);

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.traceId, "turn-a");
  assert.equal(runs[0]?.totalDurationMs, 1400);
  assert.equal(runs[0]?.slowestStage, "reasoning.workflow");
  assert.deepEqual(
    runs[0]?.events.map((event) => event.stage),
    ["voice.stt", "reasoning.workflow", "voice.turn"]
  );
});
