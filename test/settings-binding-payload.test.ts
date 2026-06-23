/**
 * Proves the per-stage model from the DB-backed settings snapshot is actually shipped into
 * the reasoning payload — the core wiring of the settings → model feature.
 *
 * The 4 reasoning stages all use the same `modelExtraForStage(settings, stage)` helper to
 * build `{ model }` in the reasoning `extra` payload; the gate-check stage stands in for all
 * four (the helper's per-stage mapping is pinned in settings-store.test.ts). This test
 * captures the raw reasoning payload and asserts the settings model survived the hop, so a
 * regression that drops the `extra.model` plumbing (in voice-pipeline-service OR in
 * provider call handoff) fails here rather than silently falling back to the stage default.
 */

import assert from "node:assert/strict";

import { checkGateStage } from "../src/modules/tutoring/gate-checker.ts";
import type { ProviderSettings } from "../src/modules/settings/settings-types.ts";

const frame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem" as const,
  quantities: [
    { label: "stickers", raw: "24" },
    { label: "friends", raw: "4" }
  ],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

const customGateModel = { provider: "anthropic", model: "claude-test-model" } as const;
const customGateModelSpecifier = "anthropic/claude-test-model";

const settings: ProviderSettings = {
  stt_model: { provider: "openrouter", model: "qwen/stt" },
  tts_model: { provider: "openrouter", model: "google/tts" },
  tts_voice: "Aoede",
  gate_check_model: customGateModel,
  verifier_model: { provider: "openai", model: "verifier" },
  tutor_model: { provider: "openai", model: "tutor" },
  extract_model: { provider: "openai", model: "extract" }
};

test("checkGateStage ships the settings gate_check_model in the reasoning payload", async () => {
  const capturedModels: (string | undefined)[] = [];
  const capturedInputs: string[] = [];

  await checkGateStage(
    "context",
    frame,
    "my words about it",
    {
      REASONING_TEST_TRANSPORT: {
        async runReasoningWorkflow(payload) {
          capturedModels.push(payload.model);
          capturedInputs.push(payload.input);
          return { accepted: true, notes: null };
        }
      }
    },
    settings
  );

  assert.equal(capturedModels.length, 1, "one reasoning call expected");
  assert.equal(
    capturedModels[0],
    customGateModelSpecifier,
    "the split gate_check_model from settings must travel in the reasoning payload as provider/model"
  );
  assert.ok(capturedInputs[0] && capturedInputs[0].length > 0, "input still travels");
});

test("checkGateStage omits `model` from the payload when no settings are passed", async () => {
  const capturedModels: (string | undefined)[] = [];

  await checkGateStage(
    "context",
    frame,
    "my words about it",
    {
      REASONING_TEST_TRANSPORT: {
        async runReasoningWorkflow(payload) {
          capturedModels.push(payload.model);
          return { accepted: true, notes: null };
        }
      }
    }
    // no settings -> the executor uses its stage default
  );

  assert.equal(capturedModels[0], undefined, "`model` must be undefined when no settings are passed");
});
