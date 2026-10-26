import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * WhyLog is client-only by design.
 *
 * There is no backend. The event log lives in localStorage, the graph is
 * materialised in the browser, and the only outbound request the app can make
 * is the optional LLM call behind the engine seam (src/ai/).
 *
 * `host: 0.0.0.0` is required so the dev server is reachable from a preview
 * proxy rather than only from localhost.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },

  preview: {
    host: "0.0.0.0",
    port: 4173,
  },

  build: {
    target: "es2022",
    sourcemap: true,
    /*
     * No manualChunks.
     *
     * This used to split `d3-force` into a `graph` chunk for the premise lattice. Phase 6 rejected force
     * simulation: the lattice layout is DETERMINISTIC — columns by premise type, decisions at the
     * barycentre of their premises — because a cascade animation is only legible if nodes stay where they
     * were, and a force layout gives different positions on every run.
     *
     * So `d3-force` is imported nowhere, and a manualChunks entry naming an unimported module is dead
     * build config that fails or warns depending on the Rollup version. The dependency is removed from
     * package.json alongside it. If chunking is ever wanted, it should be derived from the real module
     * graph rather than from a library that was considered and rejected.
     */
  },
});
