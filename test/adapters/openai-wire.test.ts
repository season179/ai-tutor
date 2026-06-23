/**
 * Audio wire + reasoning payload conformance — Tier 2.
 *
 * Deliberately provider/transport-specific. Two concerns:
 *  (a) The shared `extractOutputText` parser (`src/providers/openai/openai-responses.ts`),
 *      which the tutor path still uses to unwrap the synthetic `{ output_text }` envelope the
 *      reasoning helper returns.
 *  (b) Wire shapes that still live in Worker A: STT/TTS now cross OpenRouter's audio endpoints
 *      (`/audio/transcriptions` JSON with `input_audio: { data, format }`, `/audio/speech` JSON
 *      returning binary), and the tutor prompt content / image attachment cross the in-app
 *      reasoning payload.
 *
 * The integration tests below assert the prompt content + image ride the reasoning payload.
 */

import assert from "node:assert/strict";

import { extractOutputText } from "../../src/providers/openai/openai-responses.ts";
import { MemorySessionStore } from "../../src/modules/sessions/memory-session-store.ts";
import { handleVoicePipelineTurnWithStore } from "../../src/modules/voice/voice-pipeline-service.ts";
import { installVoiceProviders, makeOpenAiProviderFake, type VoiceProviderFake } from "../helpers/fake-voice-providers.ts";
import {
  context,
  ownerKey,
  problemImage,
  seedKickoffSession,
  sharingFrame,
  voiceServiceEnv
} from "../helpers/voice-fixtures.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Response parsing: extractOutputText (still used by the tutor path's synthetic envelope)
// ──────────────────────────────────────────────────────────────────────────────

test("extractOutputText prefers the top-level output_text when present", () => {
  assert.equal(extractOutputText({ output_text: "hello" }), "hello");
});

test("extractOutputText falls back to output[].content[].text joined by newlines", () => {
  assert.equal(
    extractOutputText({
      output: [
        {
          content: [
            { text: "first", type: "output_text" },
            { text: "second", type: "output_text" }
          ],
          role: "assistant",
          type: "message"
        }
      ]
    }),
    "first\nsecond"
  );
});

test("extractOutputText returns empty string when no text is present anywhere", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ type: "output_text" }] }] }), "");
  assert.equal(extractOutputText({ unrelated: true }), "");
});

// ──────────────────────────────────────────────────────────────────────────────
// Request encoding: STT/TTS over OpenRouter (fetch transport) + tutor prompt/image
//
// The reasoning stages use the in-app reasoning transport; STT/TTS cross globalThis.fetch to
// OpenRouter's audio endpoints. These install the harness fake so both transports are
// exercised in one turn.
// ──────────────────────────────────────────────────────────────────────────────

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

test("transcription is sent to OpenRouter as JSON with bare-base64 input_audio", async () => {
  // STT + TTS stay on globalThis.fetch (OpenRouter); reasoning uses a separate fake
  // transport.
  // To assert the raw OpenRouter STT JSON shape (which the domain harness hides), this test
  // sets its OWN globalThis.fetch for STT/TTS and builds the reasoning fake WITHOUT
  // installing it as globalThis.fetch (so the two don't fight over globalThis.fetch).
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Audio encoding" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });

  let transcribeBody: { model?: string; input_audio?: { data?: string; format?: string } } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/audio/transcriptions")) {
      // OpenRouter STT is JSON (NOT multipart): { model, input_audio: { data, format } }.
      assert.ok(typeof init?.body === "string", "OpenRouter transcription body must be JSON");
      transcribeBody = JSON.parse(init.body as string) as typeof transcribeBody;
      return Response.json({ text: "What the student said." });
    }
    if (url.endsWith("/audio/speech")) {
      return new Response(new Uint8Array([1]));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  // Build (do NOT install) the provider fake so its reasoning transport serves gate/tutor
  // while globalThis.fetch stays this test's STT/TTS double.
  const providerFake = makeOpenAiProviderFake({
    gateChecker: { accepted: true, notes: null },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "Read it once." }
  });
  const env = { ...voiceServiceEnv, REASONING_TEST_TRANSPORT: providerFake.reasoningTransport };

  try {
    await handleVoicePipelineTurnWithStore(
      {
        audio: {
          dataUrl: "data:audio/webm;codecs=opus;base64,AQIDBA==",
          mimeType: "audio/webm;codecs=opus",
          name: "student-turn.webm",
          size: 4
        },
        sessionId: session.id
      },
      env,
      store,
      context
    );

    assert.ok(transcribeBody, "an OpenRouter transcription call must have been made");
    // The `data` URL prefix is stripped — OpenRouter wants BARE base64, and rejects a data URL.
    assert.equal(transcribeBody!.input_audio?.data, "AQIDBA==");
    // The format token is derived from the audio MIME; webm (incl. ;codecs=opus) → "webm".
    assert.equal(transcribeBody!.input_audio?.format, "webm");
    assert.equal(transcribeBody!.model, "qwen/qwen3-asr-flash-2026-02-10");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the tutor prompt over reasoning carries the student utterance", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Tutor encoding" });
  await store.saveProblemContext(ownerKey, {
    extractionConfidence: "high",
    extractionOutcome: "extracted",
    frame: sharingFrame,
    r2ObjectKey: "session/image.jpg",
    sessionId: session.id
  });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_context_read",
    supportLevel: 0
  });

  const utterance = "I think we share the stickers out equally.";
  fake = installVoiceProviders({
    gateChecker: { accepted: true, notes: null },
    tutor: { move: "three_reads_1", nextPhase: "frame_task", spokenUtterance: "What's this problem about?" },
    tts: new Uint8Array([1])
  });

  await handleVoicePipelineTurnWithStore(
    { sessionId: session.id, text: utterance },
    voiceServiceEnv,
    store,
    context
  );

  const tutorInput = fake.calls.workflowInputs("tutor")[0] ?? "";
  assert.ok(tutorInput.includes(utterance), "the student utterance must travel in the workflow input");
});

test("an image turn embeds the image fields in the tutor reasoning payload", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Image encoding" });

  // Capture the raw reasoning payload to inspect the image field directly (the harness hides
  // wire shape; this Tier-2 test looks at it on purpose).
  let capturedImage: { type?: string; data?: string; mimeType?: string } | null = null;

  fake = installVoiceProviders({ tts: new Uint8Array([1]) });
  const env = {
    ...voiceServiceEnv,
    REASONING_TEST_TRANSPORT: {
      async runReasoningWorkflow(payload: { image?: typeof capturedImage }) {
        capturedImage = payload.image ?? null;
        return { move: "rapport_check", nextPhase: "frame_task", spokenUtterance: "Let's look." };
      }
    }
  };

  await handleVoicePipelineTurnWithStore(
    { image: problemImage, sessionId: session.id, text: "Help me understand this problem." },
    env,
    store,
    context
  );

  assert.ok(capturedImage, "the tutor reasoning payload must carry the image");
  assert.equal(capturedImage!.type, "image");
  assert.equal(capturedImage!.mimeType, "image/jpeg");
  // The data is the base64 portion of the data URL (the prefix is stripped).
  assert.equal(capturedImage!.data, problemImage.dataUrl.split(",")[1]);
});
