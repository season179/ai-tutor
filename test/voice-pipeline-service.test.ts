import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/memory-session-store.js";
import { handleVoicePipelineTurnWithStore } from "../dist/voice-pipeline-service.js";
import type { RequestContext } from "../src/request-context.ts";

const ownerKey = "access:test-user";

const context: RequestContext = {
  identity: { userId: "test-user" },
  ownerKey
};

const env = {
  OPENAI_API_KEY: "test-key",
  OPENAI_TRANSCRIBE_MODEL: undefined,
  OPENAI_TTS_MODEL: undefined,
  OPENAI_TTS_VOICE: undefined,
  OPENAI_TUTOR_MODEL: undefined
};

const problemImage = {
  dataUrl: "data:image/jpeg;base64,abc",
  height: 960,
  mimeType: "image/jpeg",
  name: "problem.jpg",
  size: 112298,
  width: 1280
};

test("projects a validated turn to the legacy public lesson shape and advances the phase", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Hi there! Ready to read this problem together?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(action) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Help me understand this problem step by step." },
      env,
      store,
      context
    );

    assert.equal(response.tutorText, action.spokenUtterance);
    assert.deepEqual(response.lesson, {
      phase: "orient",
      spokenUtterance: action.spokenUtterance,
      studentStatus: "unknown",
      tutorAction: "orient"
    });
    assert.equal("hiddenState" in response.lesson, false);
    assert.equal("safetyNotes" in response.lesson, false);
    assert.equal(response.audio.mimeType, "audio/mpeg");
    assert.equal(response.audio.size, speechBytes.byteLength);

    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.session.currentPhase, "frame_task");
    assert.equal(detail?.session.status, "active");
    const tutorTurn = detail?.events.find((event) => event.message === "Tutor turn");
    assert.ok(tutorTurn);
    assert.equal(JSON.stringify(tutorTurn.value).includes("hiddenState"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads the tutor action from response output content", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const action = {
    move: "recall_prior",
    nextPhase: "session_open",
    spokenUtterance: "Have you solved a sharing problem like this before?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output: [
          {
            content: [{ text: JSON.stringify(action), type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ]
      });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "Help me understand this problem step by step." },
      env,
      store,
      context
    );

    assert.equal(response.tutorText, action.spokenUtterance);
    assert.deepEqual(response.lesson, {
      phase: "orient",
      spokenUtterance: action.spokenUtterance,
      studentStatus: "unknown",
      tutorAction: "orient"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribes recorder audio and runs the turn from the transcript", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline audio test" });
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([5, 6, 7, 8]);
  const action = {
    move: "rapport_check",
    nextPhase: "frame_task",
    spokenUtterance: "Great — shall we read what the problem is asking?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      assert.ok(init?.body instanceof FormData);
      const audioFile = init.body.get("file");
      assert.ok(audioFile instanceof Blob);
      assert.equal(audioFile.type, "audio/webm");
      return Response.json({ text: "Subtract the library amount from the total." });
    }

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(action) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, action.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      {
        audio: {
          dataUrl: "data:audio/webm;codecs=opus;base64,AQIDBA==",
          mimeType: "audio/webm;codecs=opus",
          name: "student-turn.webm",
          size: 4
        },
        image: problemImage,
        sessionId: session.id
      },
      env,
      store,
      context
    );

    assert.equal(response.transcript, "Subtract the library amount from the total.");
    assert.equal(response.tutorText, action.spokenUtterance);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a solving move during the comprehension gate before reaching TTS", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Gate test" });
  const advanced = await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    currentPhase: "frame_task",
    gateStatus: null,
    supportLevel: 0
  });
  assert.ok(advanced);

  const originalFetch = globalThis.fetch;
  let speechCalls = 0;
  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({ output_text: JSON.stringify(solve) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      speechCalls += 1;
      return new Response(new Uint8Array([0]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      handleVoicePipelineTurnWithStore(
        { image: problemImage, sessionId: session.id, text: "Just tell me the answer." },
        env,
        store,
        context
      ),
      /valid turn/
    );

    assert.equal(speechCalls, 0);
    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.session.currentPhase, "frame_task");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("re-asks the generator when the first move is illegal, then accepts a legal one", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Retry test" });
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    currentPhase: "frame_task",
    gateStatus: null,
    supportLevel: 0
  });

  const originalFetch = globalThis.fetch;
  let responsesCalls = 0;
  const solve = { move: "solve", nextPhase: "frame_task", spokenUtterance: "It's 6 sweets each." };
  const restate = {
    move: "restate_prompt",
    nextPhase: "plan_first_step",
    spokenUtterance: "In your own words, what are we trying to find?"
  };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      responsesCalls += 1;
      return Response.json({ output_text: JSON.stringify(responsesCalls === 1 ? solve : restate) });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      return new Response(new Uint8Array([1]));
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      { image: problemImage, sessionId: session.id, text: "I think we share them out." },
      env,
      store,
      context
    );

    assert.equal(responsesCalls, 2);
    assert.equal(response.tutorText, restate.spokenUtterance);
    assert.deepEqual(response.lesson, {
      phase: "orient",
      spokenUtterance: restate.spokenUtterance,
      studentStatus: "unknown",
      tutorAction: "ask"
    });

    const detail = await store.getSession(ownerKey, session.id);
    assert.equal(detail?.session.currentPhase, "plan_first_step");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
