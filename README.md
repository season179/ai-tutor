# AI Tutor

Small TypeScript AI tutor app for turn-controlled voice tutoring. A student shares a homework screenshot, hears one small prompt from the tutor, records an answer, and gets the next short spoken hint only after that answer.

## Requirements

- Node.js 24
- pnpm 11
- An OpenAI API key

This repo pins `pnpm@11.6.0` in `package.json` and includes `.node-version` / `.nvmrc` with Node 24. It uses Portless so you do not need to pick or remember a port.

## Setup

```bash
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

`VOICE_BACKEND` defaults to `openai-voice-pipeline`, which uses speech-to-text, a structured lesson-controller LLM turn, and text-to-speech. `openai-realtime` remains available as a fallback by setting `VOICE_BACKEND=openai-realtime`. The `livekit-agents` backend is typed in the codebase for the future, but it intentionally returns a clear not-implemented error until the LiveKit room token service and agent worker are added.

## Run

```bash
pnpm dev
```

Portless prints a stable local URL, normally `https://ai-tutor.localhost`. Open that URL, choose a problem image, wait for it to be prepared, and click **Ask about image**. The tutor will speak one short next step. Use **Record answer** after each prompt, then **Stop and send** to let the tutor check that answer before moving on.

## How it works

- The server keeps provider secrets private and creates a normalized voice session descriptor at `POST /api/voice/session`.
- The default `openai-voice-pipeline` backend accepts one turn at a time at `POST /api/voice/turn`.
- Student audio is transcribed with `gpt-4o-transcribe`, the lesson controller uses `gpt-5.5` with strict structured output, and the spoken reply is generated with `gpt-4o-mini-tts` using the `marin` voice by default.
- The lesson controller is constrained to one small question, hint, or confirmation per turn and returns only the structured tutor action that should be spoken aloud.
- The browser uses a provider-neutral `VoiceClientAdapter`; the pipeline adapter records one answer clip at a time and plays the returned tutor audio.
- The `openai-realtime` fallback still wraps OpenAI Realtime client-secret creation behind the same `VoiceSessionService`.
- Image files are decoded in the browser, resized to a 2048px maximum side, flattened onto a white background, encoded as bounded JPEG data URLs, and sent through a provider-neutral user-turn shape.
- Portless maps the app to a named `.localhost` URL and manages local routing behind the scenes.

## Cloudflare Workers

The production deployment uses a Worker-native entrypoint in `src/worker.ts` plus Workers Static Assets for `public/`. The Worker handles `POST /api/voice/session` and `POST /api/voice/turn`, reads `OPENAI_API_KEY` from Cloudflare secrets, rate-limits voice API requests, sends OpenAI a hashed per-caller safety identifier for the Realtime fallback, and serves static assets through the `ASSETS` binding.

For local Worker development:

```bash
cp .dev.vars.example .dev.vars
```

Set `OPENAI_API_KEY` in `.dev.vars`, then run:

```bash
pnpm dev:worker
```

For deployment:

```bash
pnpm wrangler secret put OPENAI_API_KEY
pnpm deploy:dry-run
pnpm deploy
```

`wrangler.jsonc` stores only non-secret defaults like model and voice. If this Worker shares a Cloudflare account with other Workers using rate limiting bindings, keep the `REALTIME_TOKEN_RATE_LIMITER.namespace_id` unique within the account.

## Scripts

```bash
pnpm dev
pnpm dev:worker
pnpm check:worker-types
pnpm typecheck
pnpm build
pnpm deploy:dry-run
pnpm deploy
pnpm start
```
