/**
 * The engine badge — 6.8.
 *
 * Phase 6 · sub-phase 6.8
 * Plan: plan/phase-6-presentation.md §6.8
 *
 * ---------------------------------------------------------------------------
 * NEVER LET THE UI IMPLY A CAPABILITY IT DOES NOT HAVE
 *
 * The badge is stamped from the NODE, not from the current session. `provenance.extractedBy` is
 * stored on the decision, so a node extracted six months ago by an LLM still reports the LLM even
 * though the local engine is active now. Rendering the session's engine instead would be a small
 * lie repeated on every card, and it is the kind of lie that makes a provenance feature worthless.
 *
 * ---------------------------------------------------------------------------
 * LOCAL IS FILLED, LLM IS OUTLINED — AND LOCAL IS THE DEFAULT, NOT THE FALLBACK
 *
 * The local engine is a real implementation: extraction, classification, embedding and composition
 * all work with no key and no network. The badge reflects that by giving it the same visual weight
 * as the LLM one rather than greying it out, because a greyed-out badge reads as "degraded" and
 * would misdescribe the mode the product ships in.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { ReactElement } from "react";

export function EngineBadge({ engine, title }: { engine: EngineId; title?: string }): ReactElement {
  const isLocal = engine.kind === "local";

  return (
    <span
      className="badge mono"
      title={
        title ??
        (isLocal
          ? "Produced by the local engine: deterministic, offline, no API key. Nothing left this browser."
          : `Produced by an LLM engine (${engine.model}). The transcript was sent to the configured provider.`)
      }
      style={{
        color: isLocal ? "var(--mode-local)" : "var(--mode-llm)",
        border: `1px solid ${isLocal ? "var(--mode-local)" : "var(--mode-llm)"}`,
        background: isLocal
          ? "color-mix(in srgb, var(--mode-local) 14%, transparent)"
          : "transparent",
        fontSize: 10,
        letterSpacing: 0.4,
      }}
    >
      {isLocal ? "LOCAL" : `LLM${engine.model.length > 0 ? ` · ${engine.model}` : ""}`}
    </span>
  );
}

/** The session-level mode badge, shown in the header. Distinct from the node badge above: this one
 *  says what is running NOW, before you act. */
export function ModeBadge({
  mode,
  meaning,
}: {
  mode: string;
  meaning: string;
}): ReactElement {
  return (
    <span className="badge" title={meaning} style={{ fontSize: 10 }}>
      {mode}
    </span>
  );
}
