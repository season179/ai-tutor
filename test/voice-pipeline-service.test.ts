import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionStore } from "../dist/memory-session-store.js";
import { handleVoicePipelineTurnWithStore } from "../dist/voice-pipeline-service.js";
import type { RequestContext } from "../src/request-context.ts";

const ownerKey = "access:test-user";

test("handleVoicePipelineTurnWithStore accepts empty lesson safety notes", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const context: RequestContext = {
    identity: { userId: "test-user" },
    ownerKey
  };
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const lesson = {
    hiddenState: "",
    phase: "orient",
    safetyNotes: "",
    spokenUtterance: "What is the problem asking you to find?",
    studentStatus: "unknown",
    tutorAction: "ask"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output_text: JSON.stringify(lesson)
      });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, lesson.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      {
        image: {
          dataUrl: "data:image/jpeg;base64,abc",
          height: 960,
          mimeType: "image/jpeg",
          name: "problem.jpg",
          size: 112298,
          width: 1280
        },
        sessionId: session.id,
        text: "Help me understand this problem step by step."
      },
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_TRANSCRIBE_MODEL: undefined,
        OPENAI_TTS_MODEL: undefined,
        OPENAI_TTS_VOICE: undefined,
        OPENAI_TUTOR_MODEL: undefined
      },
      store,
      context
    );

    assert.equal(response.tutorText, lesson.spokenUtterance);
    assert.equal("safetyNotes" in response.lesson, false);
    assert.equal("hiddenState" in response.lesson, false);
    assert.equal(response.audio.mimeType, "audio/mpeg");
    assert.equal(response.audio.size, speechBytes.byteLength);

    const detail = await store.getSession(ownerKey, session.id);
    const tutorTurn = detail?.events.find((event) => event.message === "Tutor turn");
    assert.ok(tutorTurn);
    assert.equal(JSON.stringify(tutorTurn.value).includes("hiddenState"), false);
    assert.equal(JSON.stringify(tutorTurn.value).includes("safetyNotes"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleVoicePipelineTurnWithStore reads lesson JSON from response output content", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline test" });
  const context: RequestContext = {
    identity: { userId: "test-user" },
    ownerKey
  };
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([1, 2, 3, 4]);
  const lesson = {
    hiddenState: "look for the first operation",
    phase: "ask_step",
    safetyNotes: "",
    spokenUtterance: "What number should we start with?",
    studentStatus: "unknown",
    tutorAction: "ask"
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url === "https://api.openai.com/v1/responses") {
      return Response.json({
        output: [
          {
            content: [
              {
                text: JSON.stringify(lesson),
                type: "output_text"
              }
            ],
            role: "assistant",
            type: "message"
          }
        ]
      });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, lesson.spokenUtterance);
      return new Response(speechBytes);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleVoicePipelineTurnWithStore(
      {
        image: {
          dataUrl: "data:image/jpeg;base64,abc",
          height: 960,
          mimeType: "image/jpeg",
          name: "problem.jpg",
          size: 112298,
          width: 1280
        },
        sessionId: session.id,
        text: "Help me understand this problem step by step."
      },
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_TRANSCRIBE_MODEL: undefined,
        OPENAI_TTS_MODEL: undefined,
        OPENAI_TTS_VOICE: undefined,
        OPENAI_TUTOR_MODEL: undefined
      },
      store,
      context
    );

    assert.equal(response.tutorText, lesson.spokenUtterance);
    assert.deepEqual(response.lesson, {
      phase: lesson.phase,
      spokenUtterance: lesson.spokenUtterance,
      studentStatus: lesson.studentStatus,
      tutorAction: lesson.tutorAction
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleVoicePipelineTurnWithStore accepts recorder audio data URLs with codecs", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Pipeline audio test" });
  const context: RequestContext = {
    identity: { userId: "test-user" },
    ownerKey
  };
  const originalFetch = globalThis.fetch;
  const speechBytes = new Uint8Array([5, 6, 7, 8]);
  const lesson = {
    hiddenState: "",
    phase: "check_answer",
    safetyNotes: "",
    spokenUtterance: "Yes, that subtraction is the right first step.",
    studentStatus: "correct",
    tutorAction: "confirm"
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
      return Response.json({
        output_text: JSON.stringify(lesson)
      });
    }

    if (url === "https://api.openai.com/v1/audio/speech") {
      assert.equal(JSON.parse(String(init?.body)).input, lesson.spokenUtterance);
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
        image: {
          dataUrl: "data:image/jpeg;base64,abc",
          height: 960,
          mimeType: "image/jpeg",
          name: "problem.jpg",
          size: 112298,
          width: 1280
        },
        sessionId: session.id
      },
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_TRANSCRIBE_MODEL: undefined,
        OPENAI_TTS_MODEL: undefined,
        OPENAI_TTS_VOICE: undefined,
        OPENAI_TUTOR_MODEL: undefined
      },
      store,
      context
    );

    assert.equal(response.transcript, "Subtract the library amount from the total.");
    assert.equal(response.tutorText, lesson.spokenUtterance);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
