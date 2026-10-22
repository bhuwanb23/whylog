import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test configuration.
 *
 * `jsdom` is the environment because the substrate persists to localStorage.
 * Everything under src/ is plain TypeScript apart from the React views, so the
 * majority of tests (Phases 0-5, 7) need no DOM at all.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.d.ts", "src/components/**", "src/views/**"],
    },
    // Reasoning tests are pure graph traversal and should be fast. A slow test
    // here means an accidental O(n^2) in the cascade (Phase 2.7).
    testTimeout: 10_000,
  },
});
