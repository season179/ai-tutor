# ADR-0002: Collapse reasoning into the main Worker with TanStack AI

Date: 2026-06-23
Status: Accepted
Supersedes: `docs/adr/0001-flue-reasoning-worker.md`

## Context

The Flue Worker B made reasoning provider-swappable, but it added local-dev friction,
service-binding failures, two deploys, duplicated secrets, and extra latency/debug surface.
The app is local-first while performance is being tuned, so the reasoning traces need to be
easy to collect from one process.

## Decision

Run the four reasoning stages inside the main TanStack Start Worker through
`src/providers/reasoning/reasoning-binding.ts`.

The adapter uses TanStack AI:

- `@tanstack/ai-openai` for OpenAI reasoning models.
- `@tanstack/ai-openrouter` for OpenRouter reasoning models.
- Zod schemas in Worker A for structured outputs.

The stage prompt builders and parsers remain in Worker A:

- gate-check: `src/modules/tutoring/gate-checker.ts`
- verifier: `src/modules/tutoring/verifier-agent.ts`
- tutor-turn: `src/modules/voice/voice-pipeline-service.ts`
- extract-question: `src/modules/problems/question-extraction-service.ts`

## Consequences

`pnpm dev` starts only the main app. The root worker now needs both `OPENAI_API_KEY` and
`OPENROUTER_API_KEY`, because OpenAI reasoning and OpenRouter audio/reasoning can all run in
the same worker.

The `/settings` page no longer polls Worker B for model options. It reads the local supported
model registry in `src/modules/settings/reasoning-model-options.ts`; the save validator uses
the same registry so the dropdown and backend cannot drift.

The generated `reasoning-worker/` tree is no longer on the runtime path. It was left in place
during the collapse to avoid deleting existing local edits, but the root `wrangler.jsonc`,
`package.json`, and generated Worker env no longer bind or start it.
