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
    // No manual chunks. There WAS a `graph: ["d3-force"]` split here, left over from the
    // force-layout design that §6.6 abandoned: the premise lattice is laid out
    // deterministically (columns by premise type, decisions at the barycentre of their
    // premises), so d3-force was never imported and the split produced an empty chunk on
    // every build. The dependency went with it.
  },
});
