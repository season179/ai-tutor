#!/usr/bin/env node
// Derive `worker-configuration.client.d.ts` from the `wrangler types`-generated
// `worker-configuration.d.ts`, with the workerd HTMLRewriter globals removed.
//
// Why: the client tsconfig needs the generated bindings (Env, D1Database, R2Bucket,
// the `cloudflare:workers` module …) so tsc can follow server-function imports it
// only *calls*. But the generated file also declares global interfaces that mirror
// DOM names — `Element`, `Comment`, `Text`, `Document`, `Doctype` — as workerd's
// HTMLRewriter types. Interface merging means those widen the real DOM types:
// `Element.append()` silently accepts `ReadableStream`/`Response`. TypeScript can't
// "override" an interface merge (overloads only accumulate), and loading both DOM
// and workerd types in one compilation is a known conflict (cloudflare/workers-types
// #25, #164). So we produce a client-only copy with the conflicting block stripped.
//
// The server/worker tsconfigs still load the original `worker-configuration.d.ts`
// in full. Run this whenever `wrangler types` is run (it's wired into the type
// generation step; `check:worker-types` regenerates the source first).
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "worker-configuration.d.ts";
const DEST = "worker-configuration.client.d.ts";

// Top-level declarations whose global names collide with the DOM lib. Each spans a
// balanced `{ … }` block starting on its header line.
const DOM_COLLIDING = new Set([
  "ContentOptions",
  "HTMLRewriter",
  "HTMLRewriterElementContentHandlers",
  "HTMLRewriterDocumentContentHandlers",
  "Doctype",
  "Element",
  "EndTag",
  "Comment",
  "Text",
  "DocumentEnd"
]);

const headerRe = /^(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type)\s+([A-Za-z_$][\w$]*)/;

const lines = readFileSync(SOURCE, "utf8").split(/\r?\n/);
const out = [];
let removed = 0;

for (let i = 0; i < lines.length; ) {
  const match = lines[i].match(headerRe);
  if (match && DOM_COLLIDING.has(match[1])) {
    // Consume the full balanced block rooted at this declaration.
    let depth = 0;
    let seenBrace = false;
    while (i < lines.length) {
      const line = lines[i++];
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          seenBrace = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (seenBrace && depth <= 0) {
        // `type X = …;` has no braces; a braced decl ends when braces close.
        break;
      }
      if (!seenBrace && (line.includes(";") || line.trim() === "")) {
        // Braceless type alias terminated by `;`.
        break;
      }
    }
    removed++;
    continue;
  }
  out.push(lines[i++]);
}

writeFileSync(DEST, `${out.join("\n")}\n`);
console.log(`strip-worker-types: ${SOURCE} → ${DEST} (${removed} DOM-colliding declarations removed, ${out.length} lines kept)`);
