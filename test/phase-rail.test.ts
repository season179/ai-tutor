import assert from "node:assert/strict";

import { railStations } from "../src/client/lib/phase-rail.ts";

function states(currentPhase: Parameters<typeof railStations>[0], gateStatus?: Parameters<typeof railStations>[1]) {
  return railStations(currentPhase, gateStatus).map((station) => station.state);
}

test("railStations collapses the ten phases into the four child-facing stations", () => {
  const stations = railStations("session_open");
  assert.deepEqual(
    stations.map((station) => station.label),
    ["Warm-up", "Understand", "Work it out", "Wrap"]
  );
});

test("railStations marks earlier stations done and later ones next", () => {
  // step_loop sits in "Work it out" (index 2): the first two are done, the last is still next.
  assert.deepEqual(states("step_loop"), ["done", "done", "active", "next"]);
  assert.deepEqual(states("session_open"), ["active", "next", "next", "next"]);
  assert.deepEqual(states("wrap_up"), ["done", "done", "done", "active"]);
});

test("railStations keeps the child in Understand through the comprehension gate", () => {
  // During frame_task the gate is open: still on station 1 (Understand), not yet solving.
  assert.deepEqual(states("frame_task", "needs_context_read"), ["done", "active", "next", "next"]);
  assert.deepEqual(states("frame_task", "needs_restatement"), ["done", "active", "next", "next"]);
});

test("railStations advances to Work it out once the gate completes", () => {
  // A completed gate moves the active station to "Work it out" even while still in frame_task.
  assert.deepEqual(states("frame_task", "complete"), ["done", "done", "active", "next"]);
});
