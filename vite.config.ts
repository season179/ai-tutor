import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// Vite replaces esbuild as the client bundler and powers TanStack Start SSR.
// Plugin order matters: cloudflare → tanstackStart → viteReact (per the CF + Start docs).
export default defineConfig({
  server: {
    // Honour the PORT that Portless injects; fall back to Vite's default for bare `vite dev`.
    port: Number(process.env.PORT) || 3000,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
});
