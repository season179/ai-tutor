/**
 * Fake voice providers — the fetch harness for the voice-pipeline tests.
 *
 * ALL provider wire knowledge (audio URLs + response shapes, the `instructions`-substring
 * routing, and the reasoning-test routing) is quarantined in
 * THIS file. Tier-1 test bodies import only the domain-facing surface
 * (`installVoiceProviders`, `VoiceProviderFakeConfig`, `CallLog`) and never name a URL, a
 * wire shape, a provider token, or a workflow path. Swapping providers later means rewriting
 * this layer only.
 *
 * The five named slots are transport-agnostic — they name a *reasoning/audio role*, not a
 * wire. Each slot can be served by either transport:
 *   transcribe  → POST /v1/audio/transcriptions  (FormData body)           [fetch only]
 *   gateChecker → reasoning payload stage "gate-check"
 *   verifier    → reasoning payload stage "verifier"
 *   tutor       → reasoning payload stage "tutor-turn"
 *   tts         → POST /v1/audio/speech                                     [fetch only]
 *
 * Two routers, one per transport, both write to the SAME slot counters — so a Tier-1 test
 * asserts the same `counts.gateChecker` and `tutorBodies()` regardless of which transport
 * a migrated stage used. `routeVoiceProviderCall` routes the audio fetch transport;
 * the reasoning transport records payload stages directly.
 *
 * The matcher precedence within `/responses` (gateChecker → verifier → tutor-else) is
 * load-bearing and is pinned in `test/adapters/voice-provider-router.test.ts`.
 */

import assert from "node:assert/strict";

import { HttpError, type JsonValue } from "../../src/core/http-error.js";
import type {
  ReasoningTestTransport,
  ReasoningWorkflowPayload
} from "../../src/providers/reasoning/reasoning-binding.js";

/** The five slots a voice-pipeline turn can hit. */
export type VoiceProviderSlot = "transcribe" | "gateChecker" | "verifier" | "tutor" | "tts";

/**
 * Routes a captured OpenAI-wire fetch call to its slot, or null if it isn't a
 * voice-pipeline call. This is the explicit ordered matcher for the fetch transport.
 * Priority within `/responses`: gateChecker → verifier → tutor (else).
 *
 * The discriminator is the `instructions` preamble ONLY, never the `input` field: a
 * future tutor prompt that quotes the marker inside the student-facing input must still
 * route to the tutor slot. That invariant is pinned in the router's unit test.
 *
 * Exported (and unit-tested directly) so the precedence can never drift silently.
 */
export function routeVoiceProviderCall(input: RequestInfo | URL, init?: RequestInit): VoiceProviderSlot | null {
  const url = String(input);

  if (url.includes("/audio/transcriptions")) {
    return "transcribe";
  }

  if (url.includes("/audio/speech")) {
    return "tts";
  }

  if (url.includes("/responses")) {
    const body = init?.body;
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as { instructions?: unknown };
        const instructions = typeof parsed.instructions === "string" ? parsed.instructions : "";
        // Order matters: gate first, then verifier, else tutor.
        if (instructions.includes("comprehension-gate checker")) {
          return "gateChecker";
        }
        if (instructions.includes("narrow answer verifier")) {
          return "verifier";
        }
      } catch {
        // Not JSON — falls through to the tutor (else) branch.
      }
    }
    return "tutor";
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Domain-facing slot configuration
//
// These types express *domain intent*, never wire shapes. The harness translates each
// into the OpenAI request/response format internally — that translation is the only
// OpenAI knowledge in the system, and it lives here.
// ──────────────────────────────────────────────────────────────────────────────

/** A tutor action the model might propose — the domain shape tests reason about. */
export type FakeTutorAction = {
  move: string;
  nextPhase?: string;
  spokenUtterance: string;
};

/**
 * One tutor generation attempt. The tutor generator re-asks on two distinct failure
 * modes (§5b), and can also hard-fail the turn — the `kind` names the failure in
 * DOMAIN terms (never the OpenAI wire field):
 *
 * - `"legal"`        — a usable action; the generator accepts it.
 * - `"throws"`       — well-formed JSON the parser rejects (bad enum / missing field); the
 *                      generator re-asks (path i: `proposedTutorActionFromJson` throws).
 * - `"illegal"`      — legal shape but a move the phase forbids (e.g. `solve` in the gate);
 *                      the generator re-asks (path ii: `validateTutorAction` returns not-ok).
 * - `"emptyBody"`    — the response body carries no text to parse; the turn dies (502),
 *                      not caught by the retry loop.
 * - `"malformedBody"` — the response body's text isn't valid JSON; the turn dies (502),
 *                      not caught by the retry loop.
 */
export type FakeTutorAttempt =
  | (FakeTutorAction & { kind?: "legal" })
  | { kind: "throws"; action: FakeTutorAction }
  | { kind: "illegal"; action: FakeTutorAction }
  | { kind: "emptyBody" }
  | { kind: "malformedBody"; text: string };

/** A bare action is treated as a single legal attempt — keeps call sites terse. */
export type TutorSlot = FakeTutorAttempt | FakeTutorAttempt[];

export type TranscribeSlot = { text: string } | { status: number };

export type GateCheckerSlot =
  | { accepted: boolean; notes?: string | null }
  | { status: number }
  | { emptyBody: true };

export type VerifierSlot =
  | {
      studentStatus: string;
      confidence?: string;
      correctionHint?: string | null;
      misconceptionKey?: string | null;
    }
  | { status: number }
  | { emptyBody: true };

export type TtsSlot = Uint8Array | { status: number };

export type VoiceProviderFakeConfig = {
  transcribe?: TranscribeSlot;
  gateChecker?: GateCheckerSlot;
  verifier?: VerifierSlot;
  tutor?: TutorSlot;
  tts?: TtsSlot;
};

/** The captured call log. Domain-facing: no wire tokens (`url`/`init` stay internal). */
export type CallLog = {
  /** Per-slot call counts (summed across both transports). */
  readonly counts: Record<VoiceProviderSlot, number>;
  /**
   * The full prompt the tutor model received, one string per tutor call. Over the
   * OpenAI-fetch transport this is the request body (`instructions` + `input`); over the
   * reasoning transport it is the payload's `input` (which carries the same scrubbed prompt).
   * Tests match
   * against substrings ("separate verifier already graded", absence of "expectedAnswers").
   *
   * TRIPWIRE: this string includes the request envelope (keys like `instructions`,
   * `input`, `text.format`), not just prompt prose. Tier-1 tests MUST match only on
   * prompt content that is provider-neutral — never on envelope keys or the wire
   * envelope's structure. A Tier-1 assertion on an envelope key would silently
   * re-couple the suite to the OpenAI wire.
   */
  tutorBodies(): string[];
  /** The `input` text sent to each TTS call (what the tutor will speak aloud). */
  ttsInputs(): string[];
  /**
   * The workflow `input` strings sent to a given reasoning slot, in call order.
   */
  workflowInputs(slot: VoiceProviderSlot): string[];
};

export type VoiceProviderFake = {
  /** Replaces `globalThis.fetch`. Call in `beforeEach` or per-test. */
  install(): void;
  /** Restores the original `fetch`. Always called in `afterEach`. */
  restore(): void;
  readonly calls: CallLog;
  /** In-app reasoning executor fake. Install on `env.REASONING_TEST_TRANSPORT`. */
  readonly reasoningTransport: ReasoningTestTransport;
};

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI wire encoding (Tier 2 — the ONLY place these shapes exist)
// ──────────────────────────────────────────────────────────────────────────────

function encodeTutorResponse(attempt: FakeTutorAttempt): Response {
  // `emptyBody` / `malformedBody` are response-shape failures that kill the turn.
  if (attempt.kind === "emptyBody") {
    return Response.json({});
  }
  if (attempt.kind === "malformedBody") {
    return Response.json({ output_text: attempt.text });
  }
  // `throws` and `illegal` both return well-formed JSON the model "said"; the generator
  // decides downstream whether the parser rejects it (`throws`) or the validator does (`illegal`).
  const action =
    attempt.kind === "legal" || attempt.kind === undefined ? attempt : attempt.action;
  return Response.json({ output_text: JSON.stringify(action) });
}

function encodeGateCheckerResponse(slot: GateCheckerSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return Response.json({});
  }
  return Response.json({ output_text: JSON.stringify({ accepted: slot.accepted, notes: slot.notes ?? null }) });
}

function encodeVerifierResponse(slot: VerifierSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  if ("emptyBody" in slot) {
    return Response.json({});
  }
  return Response.json({
    output_text: JSON.stringify({
      confidence: slot.confidence ?? "high",
      correctionHint: slot.correctionHint ?? null,
      misconceptionKey: slot.misconceptionKey ?? null,
      studentStatus: slot.studentStatus
    })
  });
}

function encodeTranscribeResponse(slot: TranscribeSlot): Response {
  if ("status" in slot) {
    return new Response("upstream error", { status: slot.status });
  }
  return Response.json({ text: slot.text });
}

function encodeTtsResponse(slot: TtsSlot): Response {
  if (slot instanceof Uint8Array) {
    return new Response(slot);
  }
  return new Response("upstream error", { status: slot.status });
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy REASONING-binding transport encoding (Tier 2).
//
function gateCheckerWorkflowResult(slot: GateCheckerSlot): JsonValue {
  if ("status" in slot) {
    throw new HttpError(502, `Reasoning workflow "gate-check" failed: upstream error`, {
      status: slot.status
    });
  }
  if ("emptyBody" in slot) {
    return {};
  }
  return { accepted: slot.accepted, notes: slot.notes ?? null };
}

function verifierWorkflowResult(slot: VerifierSlot): JsonValue {
  if ("status" in slot) {
    throw new HttpError(502, `Reasoning workflow "verifier" failed: upstream error`, {
      status: slot.status
    });
  }
  if ("emptyBody" in slot) {
    return {};
  }
  return {
    confidence: slot.confidence ?? "high",
    correctionHint: slot.correctionHint ?? null,
    misconceptionKey: slot.misconceptionKey ?? null,
    studentStatus: slot.studentStatus
  };
}

function tutorWorkflowResult(attempt: FakeTutorAttempt): JsonValue {
  if (attempt.kind === "emptyBody") {
    throw new HttpError(502, `Reasoning workflow "tutor-turn" returned no structured output.`);
  }
  if (attempt.kind === "malformedBody") {
    throw new HttpError(502, `Reasoning workflow "tutor-turn" returned invalid structured output.`);
  }
  const action = attempt.kind === "legal" || attempt.kind === undefined ? attempt : attempt.action;
  return action as JsonValue;
}

function slotForReasoningPayload(payload: ReasoningWorkflowPayload): VoiceProviderSlot | null {
  switch (payload.stage) {
    case "gate-check":
      return "gateChecker";
    case "verifier":
      return "verifier";
    case "tutor-turn":
      return "tutor";
    case "extract-question":
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Harness
// ──────────────────────────────────────────────────────────────────────────────

function asAttemptList(tutor: TutorSlot | undefined): FakeTutorAttempt[] {
  if (!tutor) {
    return [{ kind: "legal", move: "elicit", spokenUtterance: "What do you think?" }];
  }
  return Array.isArray(tutor) ? tutor : [tutor];
}

function normalizeAttempt(attempt: FakeTutorAttempt): FakeTutorAttempt {
  // A bare action object (no `kind`) is a legal attempt.
  if (!("kind" in attempt) || attempt.kind === undefined) {
    return { ...attempt, kind: "legal" } as FakeTutorAttempt;
  }
  return attempt;
}

export function makeOpenAiProviderFake(config: VoiceProviderFakeConfig): VoiceProviderFake {
  const tutorAttempts = asAttemptList(config.tutor).map(normalizeAttempt);
  let tutorIndex = 0;

  // Both transports record into the SAME counters and body log so Tier-1 assertions are
  // transport-agnostic. `rawCalls` holds STT/TTS fetch captures; `reasoningCalls` holds
  // in-app reasoning payloads.
  const rawCalls: { url: string; init?: RequestInit }[] = [];
  const reasoningCalls: ReasoningWorkflowPayload[] = [];
  const countBySlot: Record<VoiceProviderSlot, number> = {
    transcribe: 0,
    gateChecker: 0,
    verifier: 0,
    tutor: 0,
    tts: 0
  };

  let originalFetch: typeof globalThis.fetch | null = null;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const slot = routeVoiceProviderCall(input, init);
    const url = String(input);
    rawCalls.push({ url, init });
    if (slot) {
      countBySlot[slot] += 1;
    }

    if (slot === "transcribe") {
      assert.ok(config.transcribe, "transcribe call made but no transcribe slot configured");
      return encodeTranscribeResponse(config.transcribe);
    }
    if (slot === "gateChecker") {
      assert.ok(config.gateChecker, "gateChecker call made but no gateChecker slot configured");
      return encodeGateCheckerResponse(config.gateChecker);
    }
    if (slot === "verifier") {
      assert.ok(config.verifier, "verifier call made but no verifier slot configured");
      return encodeVerifierResponse(config.verifier);
    }
    if (slot === "tutor") {
      const attempt = tutorAttempts[Math.min(tutorIndex, tutorAttempts.length - 1)];
      tutorIndex += 1;
      return encodeTutorResponse(attempt);
    }
    if (slot === "tts") {
      assert.ok(config.tts !== undefined, "tts call made but no tts slot configured");
      return encodeTtsResponse(config.tts as TtsSlot);
    }

    throw new Error(`fake-voice-providers: unmatched fetch ${url}`);
  }) as typeof fetch;

  const reasoningTransport: ReasoningTestTransport = {
    async runReasoningWorkflow(payload) {
      const slot = slotForReasoningPayload(payload);
      reasoningCalls.push(payload);
      if (slot) {
        countBySlot[slot] += 1;
      }

      if (slot === "gateChecker") {
        assert.ok(config.gateChecker, "gateChecker reasoning call made but no gateChecker slot configured");
        return gateCheckerWorkflowResult(config.gateChecker);
      }
      if (slot === "verifier") {
        assert.ok(config.verifier, "verifier reasoning call made but no verifier slot configured");
        return verifierWorkflowResult(config.verifier);
      }
      if (slot === "tutor") {
        const attempt = tutorAttempts[Math.min(tutorIndex, tutorAttempts.length - 1)];
        tutorIndex += 1;
        return tutorWorkflowResult(attempt);
      }

      throw new Error(`fake-voice-providers: unmatched reasoning stage ${payload.stage}`);
    }
  };

  const calls: CallLog = {
    counts: countBySlot,
    tutorBodies() {
      // The OpenAI-fetch transport: the body is the full request envelope
      // (instructions + input + text.format).
      const fetchBodies = rawCalls
        .filter((captured) => routeVoiceProviderCall(captured.url, captured.init) === "tutor")
        .map((captured) => (captured.init?.body !== undefined ? String(captured.init.body) : ""));
      const reasoningBodies = reasoningCalls
        .filter((captured) => slotForReasoningPayload(captured) === "tutor")
        .map((captured) => captured.input);
      return [...fetchBodies, ...reasoningBodies];
    },
    ttsInputs() {
      const inputs: string[] = [];
      for (const captured of rawCalls) {
        if (routeVoiceProviderCall(captured.url, captured.init) !== "tts") {
          continue;
        }
        const body = captured.init?.body;
        if (typeof body === "string") {
          try {
            inputs.push((JSON.parse(body) as { input?: string }).input ?? "");
          } catch {
            inputs.push("");
          }
        }
      }
      return inputs;
    },
    workflowInputs(slot: VoiceProviderSlot): string[] {
      return reasoningCalls
        .filter((captured) => slotForReasoningPayload(captured) === slot)
        .map((captured) => captured.input);
    }
  };

  return {
    install() {
      if (originalFetch !== null) {
        // Double-install would lose the real fetch reference and break restore().
        throw new Error("fake-voice-providers: install() called twice without restore()");
      }
      originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;
      activeReasoningTransport = reasoningTransport;
    },
    restore() {
      if (originalFetch !== null) {
        globalThis.fetch = originalFetch;
        originalFetch = null;
        activeReasoningTransport = null;
      }
    },
    calls,
    reasoningTransport
  };
}

let activeReasoningTransport: ReasoningTestTransport | null = null;

export function currentReasoningTransport(): ReasoningTestTransport | undefined {
  return activeReasoningTransport ?? undefined;
}

/**
 * Selects and installs the active provider fake. Today only the OpenAI wire exists; when
 * a second impl lands this becomes the provider-selecting seam (a provider arg or env
 * read), and because Tier-1 tests pass the SAME domain config and assert only domain
 * behavior, running them against either wire is the real decoupling proof (not a grep).
 * The OpenRouter impl itself is out of scope here (§13) — it belongs to the later ADR.
 */
export function installVoiceProviders(config: VoiceProviderFakeConfig): VoiceProviderFake {
  const fake = makeOpenAiProviderFake(config);
  fake.install();
  return fake;
}
