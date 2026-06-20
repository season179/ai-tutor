import assert from "node:assert/strict";

import { HttpError } from "../src/core/http-error.ts";
import { parseCreateVoiceSessionRequest } from "../src/modules/voice/voice-session-handler.ts";

test("parseCreateVoiceSessionRequest accepts tutor intent with sessionId", () => {
  assert.deepEqual(parseCreateVoiceSessionRequest({ intent: "tutor", sessionId: "session-123" }), {
    intent: "tutor",
    sessionId: "session-123"
  });
});

test("parseCreateVoiceSessionRequest trims sessionId", () => {
  assert.deepEqual(parseCreateVoiceSessionRequest({ intent: "tutor", sessionId: "  session-123  " }), {
    intent: "tutor",
    sessionId: "session-123"
  });
});

test("parseCreateVoiceSessionRequest rejects missing sessionId", () => {
  assert.throws(() => parseCreateVoiceSessionRequest({ intent: "tutor" }), HttpError);
});

test("parseCreateVoiceSessionRequest rejects unsupported intent", () => {
  assert.throws(
    () => parseCreateVoiceSessionRequest({ intent: "other", sessionId: "session-123" }),
    HttpError
  );
});
