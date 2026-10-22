/**
 * React entry.
 *
 * Phase 0 · sub-phase 0.10
 *
 * The imports of "@/ai/local" and "@/ai/llm" are SIDE EFFECTS: they register the
 * engines in the registry. That must happen before the store boots, because
 * `getEngine()` resolves against the registry and a registry with no `local` entry
 * would leave the app with no engine at all — in the one configuration that is
 * supposed to always work.
 *
 * `@/ai/llm` registers three providers that all require a key. Registering them
 * with no key saved is harmless and is what lets Settings show the row greyed with
 * a reason instead of not showing it at all.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/ai/local";
import "@/ai/llm";
import "./index.css";

import { bootOnce } from "@/store/whylog";
import { App } from "./App";

const container = document.getElementById("root");

if (container === null) {
  // index.html is part of this repo and contains #root, so reaching this line
  // means the HTML was edited. Say so rather than failing silently.
  throw new Error("WhyLog: no #root element in index.html");
}

// Boot before the first render so the initial paint already knows whether a log
// exists. Booting inside an effect would render the empty state and then swap it
// for the loaded one, which is a visible flash on every reload.
bootOnce();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
