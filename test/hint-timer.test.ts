import assert from "node:assert/strict";
import test from "node:test";

import {
  hintNudgeForSupportLevel,
  hintTimerEventMessage,
  hintWaitMs,
  shouldArmHintTimer
} from "../src/session-runtime/hint-timer.ts";

test("hintWaitMs is one minute", () => {
  assert.equal(hintWaitMs, 60_000);
});

test("shouldArmHintTimer only in step_loop", () => {
  assert.equal(shouldArmHintTimer("step_loop"), true);
  assert.equal(shouldArmHintTimer("answer_check"), false);
  assert.equal(shouldArmHintTimer("memory_write"), false);
});

test("hintNudgeForSupportLevel escalates with support level", () => {
  assert.match(hintNudgeForSupportLevel(0), /take your time/i);
  assert.match(hintNudgeForSupportLevel(1), /hint:/i);
  assert.match(hintNudgeForSupportLevel(4), /hint:/i);
});

test("hintTimerEventMessage is stable for client polling", () => {
  assert.equal(hintTimerEventMessage, "Hint timer");
});
