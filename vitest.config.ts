import { defineConfig } from "vitest/config";

// Vitest replaces the old `tsc -p tsconfig.server.json && node --test` loop. It
// compiles TypeScript on the fly, so tests import directly from `src/` — no more
// `dist/` emit and no `src/server.ts` test barrel. The suite is pure unit tests
// (in-memory store + mocked `fetch`); nothing under test touches Cloudflare
// bindings, so this config deliberately does NOT load `@cloudflare/vite-plugin`
// (which has an open Vitest 4 incompat, workers-sdk#10170) and runs on the plain
// Node pool instead. `node:assert` stays — Vitest supports it natively.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The suite was written against `node:test`'s global `test`. Expose the same
    // name (plus `expect`/`vi`) as globals so the test bodies stay unchanged.
    globals: true,
    // `node:assert/strict` deepEqual formatting and the existing assertion style
    // are part of the suite's contract; keep the Node assert module usable.
    environment: "node",
    reporters: "default"
  }
});
