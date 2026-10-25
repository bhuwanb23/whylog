/**
 * The shell.
 *
 * Phase 0 · sub-phase 0.10 — boots empty, renders, survives reload
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

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useWhyLog, persistenceAvailable } from "@/store/whylog";
import { FoundationView } from "@/views/FoundationView";
import { ReviewView } from "@/views/ReviewView";
import { ReasoningView } from "@/views/ReasoningView";
import { AskView } from "@/views/AskView";
import { GuardsView } from "@/views/GuardsView";
import { ExportView } from "@/views/ExportView";
import { GraphView } from "@/views/GraphView";
import { HealthView } from "@/views/HealthView";
import { SettingsView } from "@/views/SettingsView";
import { TimeMachineView } from "@/views/TimeMachineView";
import { TimelineView } from "@/views/TimelineView";
import { MODE_BADGE } from "@/theme";
import { describeKeybinds, useKeybinds, type KeybindAction } from "@/components/common";
import { useExtraction } from "@/store/extraction";
/* Bundled rather than fetched: the sandboxed preview has no network, and §6.9 requires the demo to
 * be one click from a cold start. */
import demoTranscript from "../fixtures/demo-transcript.txt?raw";

type ViewId =
  | "review"
  | "reasoning"
  | "foundation"
  | "timeline"
  | "graph"
  | "ask"
  | "guards"
  | "export"
  | "time-machine"
  | "health"
  | "settings";

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
  // 6.6 — the signature visual. Bipartite: assumptions are the load-bearing nodes and decisions
  // hang off them. Nobody in the category has this picture, because nobody stores that structure.
  { id: "graph", label: "Lattice", phase: "6.6" },
  // `conflict` is deliberately ABSENT. §6.5's seven-part revision proposal surface is already
  // rendered by ReasoningView, which Phase 2 built as the gate-G2 surface. A second Conflict view
  // would be a second implementation of one screen — the same duplication this codebase keeps
  // removing — and the two would drift apart about what a proposal says.
  { id: "time-machine", label: "Time machine", phase: "6.7" },
  // THIRD: gate G3 — "it answers". Retrieval, the evidence contract and the Ask surface all
  // land in Phase 3, so the view belongs to it rather than to the presentation phase that
  // originally held the slot.
  { id: "ask", label: "Ask", phase: "3" },
  // Gate G4 — "it verifies". Synthesis, the interpreter, the metrics and the feedback loop all
  // land in Phase 4.
  { id: "guards", label: "Guards", phase: "4" },
  // Gate G5 — "it closes the loop". The compiler, the gate and the stamp all land in Phase 5.
  { id: "export", label: "Export", phase: "5" },
  { id: "health", label: "Health", phase: "6.4" },
  { id: "settings", label: "Settings", phase: "6.8" },
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

  /**
   * Load the demo fixture and land on the review queue.
   *
   * §6.9: "the demo path must be one click from a cold start." A judge will not paste their own
   * transcript, and if the fixture is not one click away the product is never seen. It goes through
   * `importText`, which is the same entry point a real paste uses — so the demo exercises extraction,
   * resolution and the review queue rather than a pre-seeded state that skips them.
   */
  const loadDemo = (): void => {
    setView("review");
    void useExtraction.getState().importText(demoTranscript, "demo-transcript");
  };

  /* ---- 6.9 keyboard ---- */
  const keybinds: readonly KeybindAction[] = [
    { key: "k", meta: true, label: "ask the log", run: () => setView("ask") },
    { key: "n", label: "quick-log a decision", run: () => setView("timeline") },
    { key: "p", label: "paste a transcript", run: () => setView("review") },
    { key: "g", label: "the premise lattice", run: () => setView("graph") },
    { key: "Escape", label: "back to the timeline", run: () => setView("timeline") },
  ];

  useKeybinds(keybinds);

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
          {state.decisions.size === 0 ? (
            <button type="button" className="badge" onClick={loadDemo} title="Load fixtures/demo-transcript.txt and extract it — the same path a real paste takes.">
              load demo
            </button>
          ) : null}
          <span className="faint" style={{ fontSize: 10 }} title={describeKeybinds(keybinds)}>
            ⌘K ask · N log · P paste · G lattice
          </span>
        </div>
      </header>

      <main className="shell-main">
        {view === "review" ? (
          <ReviewView />
        ) : view === "reasoning" ? (
          <ReasoningView />
        ) : view === "foundation" ? (
          <FoundationView />
        ) : view === "ask" ? (
          <AskView />
        ) : view === "guards" ? (
          <GuardsView />
        ) : view === "export" ? (
          <ExportView />
        ) : view === "timeline" ? (
          <TimelineView />
        ) : view === "graph" ? (
          <GraphView />
        ) : view === "time-machine" ? (
          <TimeMachineView />
        ) : view === "health" ? (
          <HealthView />
        ) : view === "settings" ? (
          <SettingsView />
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
      <span className="badge" style={{ color: "var(--action)" }} title="The hash chain failed verification on load. The log is read-only.">
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
        append-only log, the fold, the bi-temporal projections and the hash chain — is built and
        is what the Foundation view reports on.
      </p>
    </section>
  );
}
