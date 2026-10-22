import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

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
    // d3-force is only needed by the premise lattice (Phase 6.6) — keep it
    // out of the initial bundle so first paint stays fast.
    rollupOptions: {
      output: {
        manualChunks: {
          graph: ["d3-force"],
        },
      },
    },
  },
});
