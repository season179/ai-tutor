# AI Tutor

Small TypeScript AI tutor app powered by the OpenAI Agents SDK for Realtime voice agents. It lets a student talk through homework, upload a problem image, and get short step-by-step help from a voice tutor.

## Requirements

- Node.js 24
- pnpm 11
- An OpenAI API key with Realtime API access

This repo pins `pnpm@11.6.0` in `package.json` and includes `.node-version` / `.nvmrc` with Node 24. It uses Portless so you do not need to pick or remember a port.

## Setup

```bash
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

## Run

```bash
pnpm dev
```

Portless prints a stable local URL, normally `https://ai-tutor.localhost`. Open that URL, click **Start tutoring**, allow microphone access, and ask a question. You can also choose a problem image, wait for it to be prepared, and click **Ask about image**; if the tutoring session is not connected yet, the app starts it first.

## How it works

- The server keeps `OPENAI_API_KEY` private and creates a short-lived Realtime client secret at `/token`.
- The browser uses `@openai/agents/realtime` to create a `RealtimeAgent` and `RealtimeSession`.
- The Agents SDK WebRTC transport uses the client secret, manages the microphone/audio connection, and exposes raw Realtime events for the session log.
- The session is configured for `gpt-realtime-2` with the `marin` voice and a patient tutor persona by default.
- Image files are decoded in the browser, resized to a 2048px maximum side, flattened onto a white background, encoded as bounded JPEG data URLs, and sent as `input_image` content parts.
- Portless maps the app to a named `.localhost` URL and manages local routing behind the scenes.

## Cloudflare Workers

The production deployment uses a Worker-native entrypoint in `src/worker.ts` plus Workers Static Assets for `public/`. The Worker handles `POST /token`, reads `OPENAI_API_KEY` from Cloudflare secrets, rate-limits token minting, sends OpenAI a hashed per-caller safety identifier, and serves static assets through the `ASSETS` binding.

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
