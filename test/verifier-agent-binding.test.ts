/**
 * Verifier reasoning failure — the fail-soft half of the asymmetry.
 *
 * The main verifier tests already exercise the reasoning transport. This file keeps the ONE
 * load-bearing assertion: a transient reasoning failure
 * is SURVIVED by the verifier — it degrades to `unknown` (the ONLY fail-soft stage), the
 * deliberate counterpart to the gate, where the same failure kills the turn at 502 (see
 * gate-checker-binding.test.ts). Both halves are the Phase 3 DoD contract.
 */

import assert from "node:assert/strict";

import { MemorySessionStore } from "../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import { context, ownerKey, seedNonSharingStepLoop, voiceServiceEnv } from "./helpers/voice-fixtures.ts";

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("a reasoning failure is SURVIVED by the verifier — fails soft to unknown (the asymmetry)", async () => {
  // THE ASYMMETRY: a transient reasoning failure must degrade the
  // verifier to `unknown` (never kill the turn), because the verifier is the ONLY fail-soft
  // stage. This is the deliberate counterpart to the gate, where the same 5xx kills the turn.
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Binding verifier down" });
  await seedNonSharingStepLoop(store, session.id);

  // Silence the fail-safe log to keep test output clean.
  const consoleError = console.error;
  console.error = () => undefined;
  try {
    fake = installVoiceProviders({
      verifier: { status: 500 },
      tutor: { move: "elicit", nextPhase: "step_loop", spokenUtterance: "Tell me how you worked that out." },
      tts: new Uint8Array([1])
    });

    const response = await handleVoicePipelineTurnWithStore(
      { sessionId: session.id, text: "I think it's twenty pencils" },
      voiceServiceEnv,
      store,
      context
    );

    // The verifier degraded to unknown (NOT a thrown 502), and the turn completed.
    assert.equal(response.lesson.studentStatus, "unknown");
    assert.match(fake.calls.tutorBodies()[0] ?? "", /could NOT confirm/i);

    const detail = await store.getSession(ownerKey, session.id);
    const verifyEvent = detail?.events.find((event) => event.message === "Step verify");
    assert.ok(verifyEvent);
    assert.equal((verifyEvent.value as { studentStatus?: string }).studentStatus, "unknown");
    // Unknown never advances the phase.
    assert.equal(detail?.session.currentPhase, "step_loop");
  } finally {
    console.error = consoleError;
  }
});
