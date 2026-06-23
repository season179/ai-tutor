/**
 * Provider-swap proof for the single-worker reasoning path.
 *
 * The app worker now owns provider adapters, so it is allowed to name provider packages.
 * The invariant is narrower: stage code stays provider-neutral, model choices come from
 * settings/registry, and raw provider HTTP wire stays out of the domain modules.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const stageFiles = [
  "src/modules/tutoring/gate-checker.ts",
  "src/modules/tutoring/verifier-agent.ts",
  "src/modules/problems/question-extraction-service.ts",
  "src/modules/voice/voice-pipeline-service.ts"
].map((relative) => resolve(repoRoot, relative));

const rawProviderWire = [
  "api.openai.com",
  "/v1/responses",
  "/v1/chat/completions",
  "Authorization",
  "Bearer "
];

test("stage code does not contain raw provider HTTP wire", () => {
  const offenders: string[] = [];
  for (const file of stageFiles) {
    const source = readFileSync(file, "utf8");
    for (const token of rawProviderWire) {
      if (source.includes(token)) {
        offenders.push(`${file}: contains "${token}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], "stage files must route through the reasoning adapter");
});

test("the reasoning adapter uses TanStack provider adapters instead of raw provider URLs", () => {
  const source = readFileSync(resolve(repoRoot, "src/providers/reasoning/reasoning-binding.ts"), "utf8");
  assert.match(source, /@tanstack\/ai-openai/);
  assert.match(source, /@tanstack\/ai-openrouter/);
  assert.doesNotMatch(source, /api\.openai\.com/);
  assert.doesNotMatch(source, /\/v1\/responses/);
  assert.doesNotMatch(source, /\/v1\/chat\/completions/);
});

test("reasoning model choices live in the local settings registry, not a Worker B env", () => {
  const registrySource = readFileSync(
    resolve(repoRoot, "src/modules/settings/reasoning-model-options.ts"),
    "utf8"
  );
  assert.match(registrySource, /gpt-5\.4-mini/);
  assert.match(registrySource, /google\/gemini-3\.5-flash/);

  const wranglerSource = readFileSync(resolve(repoRoot, "wrangler.jsonc"), "utf8");
  assert.doesNotMatch(wranglerSource, /"REASONING"/);
  assert.doesNotMatch(wranglerSource, /ai-tutor-reasoning/);
  assert.equal(existsSync(resolve(repoRoot, "reasoning-worker")), false);
});
