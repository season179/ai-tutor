Use deepwiki for package/library docs.
Use agent-browser to test it.
No flaky tests; every test must protect something real.

## Single-worker reasoning architecture
The four reasoning calls (gate-check, verifier, tutor-turn, extract-question) run inside the
main TanStack Start Cloudflare Worker through `src/providers/reasoning/reasoning-binding.ts`.
That adapter uses TanStack AI provider adapters (`@tanstack/ai-openai`,
`@tanstack/ai-openrouter`) and keeps the existing stage prompts/parsers in Worker A. The old
Flue Worker B is superseded; see `docs/adr/0002-single-worker-reasoning.md`.

The main worker owns all domain logic: scrubbing, the re-ask loop, deterministic verifier
track, phase logic, `commitTurn`, STT, TTS, and reasoning. STT/TTS still use OpenRouter audio
(`src/providers/openrouter/openrouter-audio.ts`). Reasoning provider credentials now also live
on the main worker: `OPENAI_API_KEY` for OpenAI reasoning models and `OPENROUTER_API_KEY` for
OpenRouter audio/reasoning models.

### Provider/model settings (DB-backed)
STT, TTS, and the four reasoning-stage models live in the `provider_settings` keyed-rows
table (`migrations/0011_provider_settings.sql` + `0014_provider_settings_provider_column.sql`),
NOT env vars — editable from the `/settings` page
(`src/client/components/settings/SettingsPage.tsx`) so models can be swapped and tested
without a redeploy. Model rows store `provider` separately from the bare `value`: Worker A
passes bare `value` to OpenRouter audio, and recomposes `provider/value` for reasoning via
`modelExtraForStage(settings, stage)`. Worker A reads the snapshot once per
turn/extraction via `loadProviderSettings(env)` (`src/modules/settings/settings-loader.ts`)
and threads it through `createVoicePipelineOptions` (STT/TTS) and `modelExtraForStage`
(reasoning payload). The supported reasoning dropdown options live in
`src/modules/settings/reasoning-model-options.ts`, and save validation uses the same registry.
Adding a slot is a new row + a `SettingType` union member + a `SETTING_FIELDS` entry — never a
schema migration. The provider *credentials* stay Wrangler secrets (never the DB).

### Local dev

```bash
pnpm dev
```

Root `.dev.vars` must contain the main-worker secrets needed by the selected models:
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, auth secrets, R2 credentials, and local trace toggles.
There is no local Worker B process to start.

### Deploy

Deploy the main worker from the repo root with `pnpm deploy`. Secret rotation touches only the
main worker. Set both `OPENAI_API_KEY` and `OPENROUTER_API_KEY` there; model provider/value
settings stay in the `provider_settings` DB table.

### Tests
The voice-pipeline test harness (`test/helpers/fake-voice-providers.ts`) is transport-aware:
`routeVoiceProviderCall` routes the OpenRouter-fetch transport (STT/TTS),
and `REASONING_TEST_TRANSPORT` fakes the in-app reasoning executor (gate/verifier/tutor). Both
write to the same slot counters, so Tier-1 tests assert domain behavior without naming provider
wire details.

## pi (collaborating coding agent)
`pi` is preconfigured — never set `--model`/`--thinking`/`--provider`/`--api-key`. Flags: `--tools read,grep,find,ls` (read-only), `--session-id <id>` (continuity), `--wt` (worktree).
- Put any non-trivial prompt in a file: `pi -p @/abs/prompt.txt`. Inline `pi -p "…"` with symbols (`{} <> [] '' "" => ~ $`) hangs (shell mangles it); only bare prose is safe inline.
- Output buffers until exit, so an empty output file ≠ stalled. For long runs use plain text + a `timeout` cap.
