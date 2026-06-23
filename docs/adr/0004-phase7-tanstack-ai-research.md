# Phase 7 research: deeper TanStack AI, guardrails intact

Date: 2026-06-23
Branch: `main` (research note only — no runtime changes)

Phase 7 of the TanStack adoption handoff is explicitly **research-only** with
hard guardrails (no Code Mode, no arbitrary tools, no removing
`phase-policy`/`tutor-action-validator`/verifier, no revealing hidden solution
state). This note records the audit of the current TanStack AI usage against the
current library API and a go/no-go on each allowed workstream. **No runtime code
changed.**

## Currency check

| Package | Installed | Latest | Note |
|---|---|---|---|
| `@tanstack/ai` | 0.33.0 (core 0.32.0 resolved) | 0.34.0 | one minor behind |
| `@tanstack/ai-openai` | 0.15.3 | — | current adapter |
| `@tanstack/ai-openrouter` | 0.14.1 | — | current adapter |

## Current usage (already correct)

`src/providers/reasoning/reasoning-binding.ts` already uses the **current**
TanStack AI structured-output API: `chat({ adapter, messages, outputSchema,
abortController, modelOptions })`. The `@tanstack/ai` core confirms
`outputSchema` (types.d.ts lines 468, 674) is the recommended structured-output
path; there is no cleaner replacement. Four strict Zod schemas pin the outputs:

- `gate-check` — `{ accepted, notes }`
- `verifier` — `{ studentStatus(enum), confidence(enum), correctionHint,
  misconceptionKey }`
- `extract-question` — typed enums for `outcome`, `problemType`, `confidence`, etc.
- `tutor-turn` — `move` and `nextPhase` constrained to the **runtime-allowed**
  move/phase lists passed in by `phase-policy` (never a free string).

Observability is already present: every reasoning call is wrapped by
`observeStage(..., "reasoning.workflow", { workflow: stage, model, timeoutMs })`,
feeding the local trace buffer.

## Go/no-go on each allowed workstream

1. **Improve structured-output handling** — **NO-GO (nothing to do).** The code
   already uses `chat({ outputSchema })`, which is the current API. Outputs are
   already strict (Zod enums, constrained move/nextPhase). No cleaner API exists.

2. **Add narrow observability around AI calls** — **NO-GO (already present).**
   `observeStage` already records model time, timeout, and stage per call, and
   the local trace buffer separates `voice.stt` / `voice.tts` / `voice.gate_check`
   / `voice.tutor_action` / `voice.verifier` into distinct stages (verified in
   Phase 1 browser QA: the trace timeline rendered each stage separately).
   `@tanstack/react-ai-devtools` is a client panel, not server observability, and
   was already deferred in Phase 3.

3. **Stream tutor text to start TTS earlier** — **NO-GO (would break
   validation).** The tutor turn's spoken utterance must clear the verifier and
   `phase-policy` before it is spoken; streaming the utterance to TTS before
   validation would risk speaking unvalidated/leaked content. The handoff itself
   says keep the flow if "streaming cannot be validated before TTS." The win
   (slightly earlier audio) does not justify destabilizing the validated turn
   flow. `chat({ stream: true })` exists in the library if this is ever revisited
   with a validation-gated design.

4. **Typed tools for deterministic safe operations** — **NO-GO (low value, adds
   risk).** The design intentionally constrains the model via output-schema enums
   (validated by `tutor-action-validator`) rather than tool calls. Adding tools
   would create a new surface that must be guarded against revealing hidden
   solution state — exactly the thing the forbidden list warns about.

## Invariants verified (Phase 7 success criteria)

- **Tutor guardrails remain deterministic**: `phase-policy.ts` and
  `tutor-action-validator.ts` are byte-for-byte unchanged on `main`; their test
  suites pass (29 tests across phase-policy, tutor-action-validator, verifier).
- **Structured outputs are at least as strict as today**: the four Zod schemas
  with constrained enums are unchanged.
- **Local traces still separate model/validation/commit/STT/TTS**: trace events
  carry distinct `stage` values (`voice.turn`, `voice.stt`, `voice.tts`,
  `voice.gate_check`, `voice.tutor_action`, etc.), unchanged.

## Recommendation

No Phase 7 changes ship. The current TanStack AI integration is already on the
current structured-output API, observability is already in place, and every
allowed "improvement" either duplicates what exists or risks the validation
contract the phase is sworn to protect. This matches the handoff's stop
condition: "If deeper AI usage weakens guardrails, revert." Revisit only if a
concrete streaming-with-validation-gate design is specced, or if `@tanstack/ai`
adds a structured-output feature clearly stricter than today's Zod schemas.
