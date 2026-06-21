# Remove Realtime Voice + Migrate Turn-Based Reasoning to Flue — Plan

*Co-developed by Claude (Opus 4.8) × `pi` — an architecture-consult pass and a review pass on this
doc, both folded in. Grounded in a file/symbol map of the current code (2026-06-21).*

---

## 0. Decision record (read this first)

Two goals were requested: **(1) remove realtime voice**, and **(2) move off the OpenAI Agents SDK
to Flue**. The grounding work surfaced a reframe and a recorded tradeoff:

- **Removing realtime _is_ removing the OpenAI Agents SDK.** `@openai/agents` is imported in exactly
  one file — the realtime client adapter. The turn-based pipeline never used the SDK; it calls OpenAI
  via raw `fetch`. So goal (2)'s literal phrasing ("move off the Agents SDK") is **fully satisfied by
  Phase 1** with no Flue involved.
- **Flue addresses a separate goal:** making the three raw-`fetch` reasoning calls
  (tutor / gate-checker / verifier) **provider/model-swappable** (OpenAI → OpenRouter, etc.).
- **Honest tradeoff (recorded, both reviewers converged):** for *stateless, single-shot,
  structured-output* completions on a latency-sensitive voice loop, Flue is heavier than the swap
  goal strictly needs — a thin in-worker provider port would also achieve the swap with no new
  infrastructure, and the merged test guardrails (`test/helpers/fake-voice-providers.ts`) were
  designed precisely to make a port sufficient (guardrails plan §13). **The user chose Flue anyway**,
  accepting the cost, for the agent-harness future it unlocks (tool-using tutor, durable sessions,
  run-inspection, one-string model swap). This plan therefore commits to Flue and spends its effort
  on **minimizing Flue's downside**.

**Chosen architecture:** **two Cloudflare Workers + a service binding.** The existing TanStack Start
worker stays the front door (UI, auth, `SessionRuntimeDO`, orchestration, STT, TTS, scrubbing,
re-ask loop, commit). A **second, Flue-generated worker** exposes the reasoning stages as Flue
*workflows*. The voice path calls it over a service binding instead of fetching OpenAI directly.
Flue cannot be embedded as a library — it generates its own worker — so two workers is the only
correct shape; making Flue *primary* (mounting TanStack/better-auth inside Flue's Hono `app.ts`) was
rejected (it inverts the dependency for a feature we barely use and re-risks the hard-won
better-auth-on-Workers setup).

**Scope folded in (per decision):** cut the dead LiveKit arm; dedupe the inlined OpenAI client;
include vision/question-extraction in the provider treatment.

---

## 1. Current state (ground truth)

*Line numbers below are illustrative anchors, not exact — locate symbols by name.*

### 1a. The reasoning calls (Flue migration targets — all `/v1/responses`, raw `fetch`)
| Function | File | Role |
|---|---|---|
| `proposeTutorAction` | `src/modules/voice/voice-pipeline-service.ts` (~627) | Generates the next tutor move; runs a `maxTutorAttempts = 2` **re-ask loop** that feeds rejection reasons back into the prompt on malformed JSON or illegal move. |
| `checkGateStage` | `src/modules/tutoring/gate-checker.ts` (~74) | Grades comprehension gate (Three Reads). |
| `runVerifierAgent` | `src/modules/tutoring/verifier-agent.ts` (~92) | Grades step/final answer; wrapped by `gradeStudentTurn` (`src/modules/tutoring/verifier.ts` ~44), which tries a deterministic numeric check first. |
| `extractQuestion` (vision) | `src/modules/.../question-extraction-service.ts` (`OPENAI_VISION_MODEL`) | **4th** `/v1/responses` call, image input, **session-creation time** (not per-turn → latency-tolerant). Folded into scope. |

Each builds a **scrubbed** prompt (`toPublicActiveStep`, `scrubComputedSolutionFromText`), posts a
strict JSON-schema request, and parses with `extractOutputText` → `proposedTutorActionFromJson` /
`parseGateCheckerVerdict` / `parseVerifierVerdict`. Models come from env vars
(`OPENAI_TUTOR_MODEL`/`OPENAI_GATE_CHECKER_MODEL`/`OPENAI_VERIFIER_MODEL`/`OPENAI_VISION_MODEL`,
all `gpt-5.5`).

### 1b. Audio — NOT LLM, stays direct (Flue is LLM-only)
- `transcribeAudio` → `/v1/audio/transcriptions` (`gpt-4o-transcribe`).
- `createTutorSpeech` → `/v1/audio/speech` (`gpt-4o-mini-tts`, voice `marin`).
These keep their direct OpenAI calls. Provider-swapping STT/TTS is a separate, non-Flue effort.

### 1c. Orchestration + Durable Object
`src/modules/voice/server/voice-fns.ts` rate-limits, then routes a turn to `SESSION_RUNTIME`
(`SessionRuntimeDO.processTurn`) when bound, else runs the pipeline directly.
`handleVoicePipelineTurnWithStore` (`voice-pipeline-service.ts` 113–370) runs
**STT → gate → grade/verifier → tutor (×re-ask) → TTS → `commitTurn`** serially, inside the DO's
request handler. `commitTurn({ expectedPhase })` is an optimistic-lock commit (returns null → `409`).

### 1d. Realtime surface (Phase-1 removal target)
- `src/client/lib/voice-client-adapter.ts` — `OpenAIRealtimeClientAdapter` (~419–546), the **only**
  `@openai/agents/realtime` consumer (`RealtimeAgent`, `RealtimeSession`, `OpenAIRealtimeWebRTC`, …).
- `src/modules/auth/realtime-token.ts` — ephemeral `client_secret` mint (entire file).
- `src/modules/voice/voice-session-service.ts` — `OpenAIRealtimeSessionService` (~131–185).
- `src/modules/voice/voice-types.ts` — `OpenAIRealtimeSessionDescriptor`, `"openai-realtime"` in the
  `VoiceBackend` union.
- `src/modules/voice/voice-session-schema.ts` — `openAIRealtimeSessionDescriptorSchema` +
  `serializeOpenAIRealtimeSessionDescriptor`.
- `src/client/hooks/use-voice-session.ts` — realtime branches (getUserMedia, `requestReply` greeting,
  text-turn nudge).
- `src/client/components/UnifiedComposer.tsx` — `canRecordAudioTurn` mic gating differs by provider.
- `wrangler.jsonc` — `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `OPENAI_SAFETY_IDENTIFIER`.
- `package.json` — `@openai/agents` dependency.

### 1e. Three corrections from the review (don't get these wrong)
1. **`REALTIME_TOKEN_RATE_LIMITER` is misnamed and load-bearing.** `enforceVoiceRateLimit()` gates
   **both** `createVoiceSessionFn` and `voicePipelineTurnFn` — it is the only per-IP throttle on the
   pipeline. **Keep and RENAME** (binding name + `ratelimits[].name` + the `workerEnv()` access);
   do not delete.
2. **`OPENAI_SAFETY_IDENTIFIER` is realtime-only** (only `realtime-token.ts` + the realtime session
   service) → safe to delete with realtime.
3. **The OpenAI client is duplicated in *one* place only — and it is not a clean swap.** `gate-checker.ts`,
   `verifier-agent.ts`, and `question-extraction-service.ts` **already** import `fetchOpenAiJson` /
   `extractOutputText` / `requireOpenAiApiKey` from `src/providers/openai/openai-responses.ts`. Only
   `voice-pipeline-service.ts` keeps local copies (`fetchOpenAiJson` ~973 etc.), and its signature
   differs: the local `fetchOpenAiJson` takes `RequestInit & { apiKey; headers? }` (it threads
   `signal`), whereas the shared `OpenAiFetchOptions` is `{ apiKey; body?; headers?; method? }` and
   does **not** accept a `signal`. Also: `transcribeAudio` posts `FormData` with a *custom* "no text →
   `HttpError(502)`" path, and `createTutorSpeech` reads a **binary** `arrayBuffer()` and never uses
   `fetchOpenAiJson` at all. So §1a is a *narrow* refactor (move `proposeTutorAction` onto the shared
   helper; reconcile the `signal`/options shape; leave the two audio calls direct or lightly
   refactored), **not** a blanket dedupe — and not a "pure refactor, nothing changes" claim.

### 1f. Tests in scope
`test/voice-pipeline-guardrails.test.ts`, `test/voice-pipeline-service.test.ts`,
`test/gate-checker.test.ts`, `test/verifier-agent.test.ts`, the harness
`test/helpers/fake-voice-providers.ts`, plus realtime-touching
`test/voice-session-schema.test.ts` / `test/session-store.test.ts`.

---

## 2. Goals & non-goals

**Goals.** (1) Delete the realtime/WebRTC path and the `@openai/agents` dependency. (2) Re-platform
the four reasoning calls onto a Flue worker so model/provider is a config change. (3) Keep current
turn behavior **byte-for-byte** per the merged guardrail suite. (4) Cut LiveKit; dedupe the OpenAI
client.

**Non-goals.** Swapping STT/TTS providers; LLM quality changes; streaming responses; durable Flue
workflow resumption; touching auth/D1/R2/the DO's turn FSM. Realtime is deleted, not ported.

---

## 3. Architecture (Flue, two-worker + service binding)

```
┌─────────────────────────── Worker A: ai-tutor (existing) ───────────────────────────┐
│ src/worker.ts  ·  better-auth (/api/auth/*)  ·  TanStack Start (/_serverFn/*)         │
│ SessionRuntimeDO  ·  D1  ·  R2  ·  rate limiter                                       │
│ voice-pipeline-service: STT, TTS, scrubbing, re-ask loop, phase logic, commitTurn    │
│                                                                                       │
│   reasoning call ──────────────► env.REASONING.fetch(/workflows/<stage>?wait=result) │
└──────────────────────────────────────────────────│──────────────────────────────────┘
                                                     │  Cloudflare service binding (in-PoP)
┌────────────────────────────────────────────────── ▼ ─ Worker B: ai-tutor-reasoning ─┐
│ Flue-generated worker, sources in `.flue/`                                            │
│ .flue/workflows/{gate-check,verifier,tutor-turn,extract-question}.ts                  │
│   run(ctx): init(agent) → session.prompt(payload.input, { result: valibotSchema })    │
│ Provider keys + model specifiers in THIS worker's env/secrets                          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Boundary contract (load-bearing):**
- **Worker A owns all domain logic.** Scrubbing happens in A *before* building the prompt; the
  workflow payload carries already-scrubbed text. The `maxTutorAttempts` re-ask loop stays in A —
  one Flue call **per attempt**, with accumulated `rejectionReasons` threaded into each payload
  (Flue workflows are stateless across invocations). A's `gradeStudentTurn` deterministic-first
  logic stays in A; only `runVerifierAgent`'s model call crosses the binding.
- **The dynamic prompt crosses the binding — B holds NO stage prompt of its own.** The current
  tutor/gate/verifier behavior lives in *dynamic* `instructions` (phase, gate status, verifier
  verdict, rejection reasons are all baked in per call). To preserve behavior byte-for-byte (Goal 3),
  A keeps building the full scrubbed `instructions` and ships it in the payload; B is a **pure model
  executor**: `createAgent(() => ({ model: <env specifier> }))`, then `session.prompt(payload.input,
  { instructions: payload.instructions, result })`. No stable stage system prompt in B, no tools, no
  sandbox (virtual default), no multi-turn. (The exact `instructions` threading — per-call vs.
  agent-level — is the Phase-2 spike; confirm against live `flue docs`.)
- **valibot `result` ≠ the domain parser.** The valibot `result` schema **replaces the current strict
  JSON schema** and is the single source of truth shared across the binding (define once, import both
  sides). It does **not** replace A's `proposedTutorActionFromJson` / `parseGateCheckerVerdict` /
  `parseVerifierVerdict` — those do *extra* domain validation (enum membership, trim, null-coalescing)
  and **stay in A**, applied to B's structured output. Don't delete them thinking valibot covers it.
- **Error/timeout semantics reuse A's *existing* mappers — do not add a second layer.** The
  verifier's fail-soft is **already implemented**: `gradeStudentTurn` (`verifier.ts`) wraps
  `runVerifierAgent` in a `try/catch` → `unknownStepVerdict()`. So let a binding-call failure
  *propagate* into that existing catch; do not wrap a new mapper around it (double-mapping risk). For
  gate/tutor, `checkGateStage`/`proposeTutorAction` already throw `HttpError(502)`; a binding 5xx/
  timeout must map to that same throw so the turn dies *before* `commitTurn`. Commit conflict → `409`
  unchanged. Net mapping: **verifier fail-soft → `unknown` (the only fail-soft stage); gate/tutor →
  `502`; commit → `409`.** A Flue error must never silently downgrade gate/tutor to a soft verdict.
- **Env-type plumbing (CF-specific).** A service binding declared on Worker A *is* visible inside
  `SessionRuntimeDO` via `this.env` — so the per-turn reasoning calls (which run **inside the DO**)
  can reach it. But the binding must be added to the types it flows through:
  `VoicePipelineServiceEnv`, `VerifierAgentEnv`, `GateCheckerEnv`, **and** the DO's
  `SessionRuntimeEnv` all gain `REASONING: Fetcher`. Note the two call contexts differ — prewarm runs
  in the server-fn handler (`createVoiceSessionFn`, full `workerEnv()`); per-turn runs inside the DO
  (`this.env`) — confirm the binding is present in both.
- **Auth between workers = platform identity** (service binding). No shared-secret header unless
  Worker B is ever exposed publicly; if so, HMAC-sign and verify in `.flue/app.ts` before `run`.
- **Secrets:** `OPENAI_API_KEY` stays in A (for STT/TTS) **and** lives in B (for reasoning) — plus
  `OPENROUTER_API_KEY` etc. in B. Rotation now touches both workers (noted as a risk).
- **`.flue/` isolation:** Flue's source-dir precedence is `.flue/` > `src/` > root; placing Flue
  sources in `.flue/` means Flue discovers *only* from there and never collides with the TanStack
  `src/` tree.

---

## Phase 1 — Realtime removal + cleanups (no Flue)

Self-contained, low-risk, highest immediate payoff (drops the SDK + a client bundle). Do first.

- **1a. Narrow the OpenAI-client duplication (prerequisite).** Only `voice-pipeline-service.ts`
  duplicates the helper (the tutoring/problem files already share it — see §1e.3). Route
  **`proposeTutorAction`** onto `src/providers/openai/openai-responses.ts`, reconciling the
  `signal`/`OpenAiFetchOptions` shape difference; collapse the local `fetchOpenAiJson`/`readOpenAiJson`/
  `extractOutputText` copies. **Leave `transcribeAudio` (FormData + custom 502) and `createTutorSpeech`
  (binary `arrayBuffer`) direct** — they stay in Worker A regardless and have no shared binary helper.
  This is *not* a behavior-free swap: the guardrail harness routes by `init.body`/`init.headers`
  shapes, so after the move re-run the suite and confirm the slot router still matches
  `proposeTutorAction`'s request.
- **1b. Delete realtime.** Remove the symbols/files in §1d. Narrow the `VoiceBackend` union and the
  descriptor union/schema; remove realtime branches from `use-voice-session.ts` and the mic gating in
  `UnifiedComposer.tsx`. Drop `@openai/agents` from `package.json`. Delete `OPENAI_REALTIME_*` and
  `OPENAI_SAFETY_IDENTIFIER` from `wrangler.jsonc`.
- **1c. RENAME the rate limiter** (e.g. `VOICE_RATE_LIMITER`): the binding, `ratelimits[].name`, and
  the `workerEnv()` access in `voice-fns.ts`. **Do not delete it.**
- **1d. Cut LiveKit and collapse the backend switch.** Remove `"livekit-agents"` from the union,
  `throwLiveKitAgentsUnavailable`, the schema branch, and the service stub. With realtime also gone,
  `VoiceBackend` is single-valued — **delete the union and inline the one backend** rather than keep a
  single-valued switch (dead config rots). This also retires `readVoiceBackend`'s now-dead validation
  and the `if/else if` chain in `createVoiceSessionService`, and the `VOICE_BACKEND` var in
  `wrangler.jsonc`. Note the cascade: `serializeOpenAIRealtimeSessionDescriptor` is imported by
  `voice-session-service.ts`, so its deletion (1b) and this collapse must land together.
- **1e. Tests.** Update `voice-session-schema.test.ts` / `session-store.test.ts` realtime fixtures.
  All turn-based guardrail tests must stay green untouched.

**DoD:** `@openai/agents` gone from `node_modules`/lockfile; `pnpm typecheck` + `pnpm test` green;
`vite build` + `wrangler deploy --dry-run` green; manual voice-loop smoke (kickoff → audio turn →
gate → tutor reply → TTS) verified in `pnpm dev`.

---

## Phase 2 — Flue worker scaffold + ONE stage end-to-end (the GATE)

Prove the riskiest mechanic before fanning out (house "gate-first" rule). Riskiest here is the
**A↔B round-trip with correct error-mapping and a working two-worker dev loop**, not the prompts.

- Scaffold `.flue/` (`flue init`), `flue.config.ts`, provider env, name the worker
  `ai-tutor-reasoning`. Add `services: [{ binding: "REASONING", service: "ai-tutor-reasoning" }]`
  to the root `wrangler.jsonc` and declare Flue's DO migrations in B's generated config.
- Implement **one** workflow end-to-end — `gate-check` — with its valibot `result` schema, exporting
  `route`. Wire `checkGateStage` in A to call `env.REASONING.fetch('/workflows/gate-check?wait=result', …)`
  behind a feature flag (env toggle: binding vs. legacy fetch), so Phase 2 ships dark.
- **Resolve the payload contract first (the §3 spike).** Decide and lock how the full dynamic scrubbed
  `instructions` + `input` cross the binding and how Flue threads `instructions` (per-call vs.
  agent-level) — this is the contract every later stage reuses, so it must be settled before fanning
  out.
- Prove: structured result round-trips; **a B 5xx/timeout propagates into gate's existing
  `HttpError(502)` throw** (not a new mapper); the **two-worker local dev loop works** — and pin the
  exact invocation, because the breaking part is specifically a **DO `fetch` to a service binding**:
  `wrangler dev` does not auto-resolve a binding to a separate `wrangler dev`, so a DO call to an
  unbound service fails opaquely. Verify the chosen setup (multi-worker `wrangler dev`, or
  `--remote`) actually resolves `env.REASONING` *from inside `SessionRuntimeDO`*, not just from the
  fn handler. Both workers deploy.

**DoD:** gate stage works through the binding with the flag on, falls back with it off; gate guardrail
tests pass against the (rewritten, transport-aware) router — see Phase 3's harness note; the **exact**
two-worker dev command + dual-deploy script are checked in and documented in AGENTS; the
`instructions`/payload contract is written down. **Gate review here before Phase 3.**

---

## Phase 3 — Migrate the remaining per-turn stages

Per stage (`runVerifierAgent`, then `proposeTutorAction`), repeat the Phase-2 surgical pattern:
keep prompt-building/scrubbing/parsing/re-ask in A, replace only the model call with the binding
call, map errors to existing shapes, share the valibot schema.

- **Tutor re-ask:** loop stays in A; one binding call per attempt; thread `rejectionReasons` into the
  payload each attempt; **never retry past a successful `commitTurn`** (TTS may have played — fail
  closed).
- **Prewarm the *workflow path*, not just the isolate.** A bare health-check `fetch` warms B's worker
  but not Flue's per-call machinery (`createAgent`, valibot compile). Fire a throwaway workflow
  invocation (a dedicated `/workflows/_warmup`, or a discarded `gate-check`) from
  `createVoiceSessionFn` so the first real turn doesn't pay workflow init on the critical path.
- **Subrequest budget:** 3 stages × up to 2 tutor attempts ⇒ up to ~4 binding subrequests/turn from
  inside the DO. Confirm expected turns/min/session against the DO subrequest ceiling before launch.

**Test-harness migration (bigger than "split transports" — the *router* is rewritten):** the harness's
`routeVoiceProviderCall` (and its unit test `test/adapters/voice-provider-router.test.ts`) currently
sniffs `globalThis.fetch` by URL + an `instructions`-substring discriminator (gate vs. verifier). Once
reasoning travels over the binding:
- `globalThis.fetch` is no longer hit for gate/verifier/tutor — that `/responses` branch goes dead for
  those three slots.
- the gate-vs-verifier discriminator must be **re-expressed as a workflow-path match**
  (`/workflows/gate-check` vs `/workflows/verifier` vs `/workflows/tutor-turn`) — a new
  transport-aware router with a new unit test, not a transport tweak.
- `CallLog.tutorBodies()` reads `captured.init.body`; over the binding the captured shape is
  `REASONING.fetch(url, init)` where `init.body` is the workflow payload — confirm the §3 payload
  (carrying the full scrubbed `instructions`/`input`) still lets the binding-fake expose the prompt
  prose the Tier-1 answer-scrubbing assertions slice out.

So the harness work is: rewrite the router to dispatch `fetch → {transcribe, tts}` and
`env.REASONING.fetch → {gate, verifier, tutor} by path`, and add a `VoiceProviderFake` impl that fakes
the `REASONING` binding. **Tier-1 bodies stay unchanged** (the `installVoiceProviders` swap-interface,
guardrails §5c, is exactly the seam that makes this localized) — but budget it as real work.

**DoD:** all per-turn reasoning runs through Flue with the flag on; full guardrail suite green on the
binding path; the error-mapping cases are covered by **explicit** tests — including the deliberate
asymmetry that a transient B failure **kills the turn on the gate (502)** but is **survived on the
verifier (`unknown`)**, since gate runs first and is safety-critical; manual full-lesson smoke.

---

## Phase 4 — Vision/question-extraction + provider-swap proof

- Migrate `extractQuestion` (`OPENAI_VISION_MODEL`) onto a B workflow (image input; session-creation
  time, so latency-tolerant). Removes the last OpenAI-only reasoning straggler.
- **Decoupling proof (scope it precisely):** flip one stage's model specifier to OpenRouter in B's env
  and run the Tier-1 guardrail suite unchanged (mirrors guardrails §5c "second-impl run"). That run —
  not a grep — proves **the reasoning swap in Worker B** works without touching domain code. It does
  **not** prove "Worker A is provider-agnostic": A still hardcodes OpenAI for STT/TTS (out of scope),
  and A's reasoning code is now just a binding call. State it as "B's model is swappable," nothing
  broader. Remove the Phase-2 feature flag once stable.

**DoD:** all four reasoning calls on Flue; an OpenRouter run of the Tier-1 suite passes; flag removed;
docs/AGENTS updated with the two-worker deploy + dev story.

---

## 4. Risks & mitigations (from the joint review)

| Risk | Mitigation |
|---|---|
| **Dual build/config/deploy/observability drift** (the real day-to-day tax) | Pin matching `compatibility_date`/flags; one deploy script that builds + deploys both; document secret rotation across A+B; multi-worker dev config checked in. |
| Cold start on the voice critical path | Prewarm B from `createVoiceSessionFn`. |
| DO subrequest budget | Count ~4 binding calls/turn; verify against ceiling; the single-workflow-per-turn consolidation is a fallback lever if needed. |
| Error semantics changing turn behavior | Map all B failures to existing `HttpError`/verdict shapes in A's wrapper; explicit tests; verifier is the only fail-soft stage. |
| Schema drift between Flue `result:` and A's parsers | One shared valibot definition per stage, imported both sides. |
| Retry duplicating effects past commit | Fail closed after `commitTurn`; rely on optimistic-lock `expectedPhase` for races. |
| Test harness transport change | Split harness: reasoning→binding double, audio→fetch double; Tier-1 bodies untouched. |

---

## 5. Out of scope / open questions

- **Out:** STT/TTS provider swap; streaming + structured-output (a tension Flue's final-output
  `result:` validation makes harder — revisit only if first-token TTS becomes a goal); LiveKit
  (deleted, not ported).
- **Open / spike in Phase 2 (the payload contract):** exact `instructions` threading in Flue
  (per-call `session.prompt({ instructions })` vs. agent-level) — confirm against live `flue docs` at
  scaffold time; this locks the cross-binding payload shape. *(Resolved already: VOICE_BACKEND is
  inlined in Phase 1d, not kept as a switch.)* Final names for the renamed rate limiter
  (e.g. `VOICE_RATE_LIMITER`) and the reasoning worker (e.g. `ai-tutor-reasoning`).
- **ADR:** the guardrails plan §13 calls for a provider-port ADR. File a short ADR recording the
  Flue-vs-port decision and this plan's rationale, so the choice is auditable against the guardrail
  contract.
