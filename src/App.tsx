/**
 * The shell.
 *
 * Phase 0 ú sub-phase 0.10 — boots empty, renders, survives reload
 * Extended by Phase 6 into the six-view product.
 *
 * ---------------------------------------------------------------------------
 * THE MODE BADGE IS IN THE HEADER, ALWAYS VISIBLE
 *
 * Not in Settings, not in a tooltip on the results. Which engine is running is the
 * first thing a user needs to know, because it determines whether their transcript
 * left the browser. A badge you have to go looking for is a badge that gets
 * misread, and "badged, never mixed" is worth nothing if the badge is hidden.
 * ---------------------------------------------------------------------------
 */

import { persistenceAvailable, useWhyLog } from "@/store/whylog";
import { MODE_BADGE } from "@/theme";
import { FoundationView } from "@/views/FoundationView";
import { ReasoningView } from "@/views/ReasoningView";
import { ReviewView } from "@/views/ReviewView";
import { type ReactElement, useEffect, useState } from "react";

type ViewId =
  | "review"
  | "reasoning"
  | "foundation"
  | "timeline"
  | "conflict"
  | "ask"
  | "guards"
  | "export"
  | "health";

const VIEWS: readonly { id: ViewId; label: string; phase: string }[] = [
  // FIRST, and the default view: gate G1 is "a messy transcript becomes reviewed,
  // structured, persisted decisions with premises". A product whose entry point is
  // an empty graph is a product nobody reaches the point of.
  { id: "review", label: "Import & review", phase: "1" },
  // SECOND, because gate G2 — "it reasons" — is the critical gate. Everything after it
  // is a surface over a reasoning engine; without this view there is no way to see the
  // thing the whole project is actually about.
  { id: "reasoning", label: "Reasoning", phase: "2" },
  { id: "foundation", label: "Foundation", phase: "0" },
  { id: "timeline", label: "Timeline", phase: "6.1" },
  { id: "conflict", label: "Conflict", phase: "6.5" },
  // THIRD: gate G3 — "it answers". Retrieval, the evidence contract and the Ask surface all
  // land in Phase 3, so the view belongs to it rather than to the presentation phase that
  // originally held the slot.
  { id: "ask", label: "Ask", phase: "3" },
  { id: "guards", label: "Guards", phase: "6.8" },
  { id: "export", label: "Export", phase: "6.11" },
  { id: "health", label: "Health", phase: "6.9" },
];

export function App(): ReactElement {
  const status = useWhyLog((s) => s.status);
  const engine = useWhyLog((s) => s.engine);
  const state = useWhyLog((s) => s.state);
  const [view, setView] = useState<ViewId>("review");

  // StrictMode mounts twice in development; boot is idempotent so this only
  // matters if the store was reset between mounts.
  useEffect(() => {
    if (status === "booting") useWhyLog.getState().boot();
  }, [status]);

  const mode = modeOf(engine?.id.kind, state.index.stale);

  return (
    <div className="shell">
      <header className="shell-header">
        <div>
          <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>WhyLog</strong>
          <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>
            decision truth maintenance
          </span>
        </div>

        <nav className="nav" aria-label="Views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="nav-item"
              aria-current={view === entry.id ? "page" : undefined}
              onClick={() => setView(entry.id)}
              title={`Phase ${entry.phase}`}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ModeBadge mode={mode} />
          <ChainBadge status={status} />
        </div>
      </header>

      <main className="shell-main">
        {view === "review" ? (
          <ReviewView />
        ) : view === "reasoning" ? (
          <ReasoningView />
        ) : view === "foundation" ? (
          <FoundationView />
        ) : (
          <NotYet view={VIEWS.find((v) => v.id === view)} />
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                     */
/* -------------------------------------------------------------------------- */

function ModeBadge({ mode }: { mode: keyof typeof MODE_BADGE }): ReactElement {
  const config = MODE_BADGE[mode];
  return (
    <span className="badge" title={config.meaning} style={{ color: config.colour }}>
      <span aria-hidden="true">●</span>
      {config.label}
    </span>
  );
}

function modeOf(
  engineKind: "local" | "llm" | undefined,
  indexStale: boolean,
): keyof typeof MODE_BADGE {
  if (engineKind === undefined) return "unavailable";
  if (indexStale) return "stale";
  return engineKind === "llm" ? "llm" : "local";
}

function ChainBadge({ status }: { status: string }): ReactElement {
  if (!persistenceAvailable()) {
    return (
      <span
        className="badge"
        style={{ color: "var(--label-unknown)" }}
        title="This browser will not remember the log across a reload — private mode, a sandboxed frame, or storage is blocked. Export to a file to keep it."
      >
        memory only
      </span>
    );
  }
  if (status === "degraded") {
    return (
      <span
        className="badge"
        style={{ color: "var(--action)" }}
        title="The hash chain failed verification on load. The log is read-only."
      >
        chain broken
      </span>
    );
  }
  return (
    <span className="badge faint" title="The append-only hash chain verified on load.">
      chain ok
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Placeholder for views that arrive in Phase 6                               */
/* -------------------------------------------------------------------------- */

function NotYet({ view }: { view: { label: string; phase: string } | undefined }): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">{view?.label ?? "View"}</h2>
      <p className="dim">
        This view arrives in Phase {view?.phase ?? "6"}. The substrate underneath it — the
        append-only log, the fold, the bi-temporal projections and the hash chain — is built and is
        what the Foundation view reports on.
      </p>
    </section>
  );
}
