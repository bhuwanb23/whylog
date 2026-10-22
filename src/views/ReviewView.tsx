/**
 * The review view — gate G1's interface.
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN CONSTRAINT IS A RATIO, NOT A TASTE
 *
 * ARGUS measured 155 false positives against 12 false negatives — 13:1
 * (docs/05 §4). So this screen is optimised for FAST REJECTION:
 *
 *   • low-tier items render COLLAPSED, one line, one click to discard
 *   • alternatives are collapsed at every tier (published precision 15.4%)
 *   • derived OUT-list premises are collapsed and labelled, because they are
 *     inferences rather than quotes
 *   • `Shift+D` discards everything collapsed in one action
 *   • the commit preview names the conflicts before the batch is written
 *
 * Acceptance is still one key, but it is not the thing the layout is built around.
 * A review surface that made saying yes easy and saying no tedious would produce a
 * log full of machine guesses, and then the cascade would fire on all of them.
 *
 * ---------------------------------------------------------------------------
 * COLOUR ENCODES EPISTEMIC STATUS, NEVER SEVERITY
 *
 * The tier colours are the confidence tiers. Red is used for exactly one thing: an
 * action is available. A conflict is not "red because it is bad" — it is marked
 * because there is something for the user to do about it.
 * ---------------------------------------------------------------------------
 */

import { ImportForm } from "@/components/review/ImportForm";
import { ReviewRow } from "@/components/review/ReviewRow";
import { TIER_COLOUR } from "@/components/review/tier-colour";
import {
  REVIEW_FILTERS,
  approve,
  contest,
  describeCommit,
  describeKeys,
  describeMergeTargets,
  describeQueue,
  discard,
  summariseCommit,
} from "@/extraction";
import { useExtraction } from "@/store/extraction";
import { useWhyLog } from "@/store/whylog";
import { type ReactElement, useEffect, useState } from "react";

export function ReviewView(): ReactElement {
  const status = useExtraction((s) => s.status);
  const error = useExtraction((s) => s.error);
  const options = useExtraction((s) => s.options);
  const setOptions = useExtraction((s) => s.setOptions);
  const importText = useExtraction((s) => s.importText);
  const commit = useExtraction((s) => s.commit);
  const clear = useExtraction((s) => s.clear);
  const restore = useExtraction((s) => s.restore);
  const lastSummary = useExtraction((s) => s.lastSummary);
  const degraded = useWhyLog((s) => s.status === "degraded");

  const items = useExtraction((s) => s.visible());
  const summary = useExtraction((s) => s.summary());
  const preview = useExtraction((s) => s.preview());

  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [paste, setPaste] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // An unfinished review survives a reload; offering it is the difference between
  // "the app remembers" and "the app lost five minutes of my work".
  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (selected === null && items.length > 0) setSelected(items[0]?.key ?? null);
  }, [items, selected]);

  /* ---- keyboard: j/k/a/d/e/c ---- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (items.length === 0) return;

      const index = items.findIndex((item) => item.key === selected);
      const act = useExtraction.getState().act;

      switch (event.key) {
        case "j":
          setSelected(items[Math.min(items.length - 1, index + 1)]?.key ?? selected);
          break;
        case "k":
          setSelected(items[Math.max(0, index - 1)]?.key ?? selected);
          break;
        case "a":
          if (selected !== null) act(selected, approve(event.shiftKey));
          break;
        case "d":
          if (selected !== null) act(selected, discard("discarded from the keyboard"));
          break;
        case "c":
          if (selected !== null) act(selected, contest("not sure yet — parked"));
          break;
        case "e":
          setEditing(selected);
          break;
        case "Enter":
          if (selected !== null) {
            act(selected, approve(false));
            setSelected(items[Math.min(items.length - 1, index + 1)]?.key ?? null);
          }
          break;
        case "Escape":
          setEditing(null);
          setConfirming(false);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected]);

  const unreviewed = summary.total - summary.reviewed;

  /* ---------------- nothing imported yet ---------------- */
  if (status === "idle" && summary.total === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Import a transcript</h2>
        <p className="faint" style={{ maxWidth: 620, lineHeight: 1.6 }}>
          Paste a conversation with an AI coding agent. WhyLog reads it locally — nothing is sent
          anywhere unless you add an API key in Settings — and proposes decisions, the premises they
          rest on, and what was rejected. Nothing enters the log until you review it.
        </p>

        {lastSummary !== null && (
          <p className="notice notice-info" style={{ marginTop: 12 }}>
            {lastSummary}
          </p>
        )}
        {error !== null && <p className="notice notice-error">{error}</p>}

        <ImportForm
          paste={paste}
          label={label}
          busy={busy}
          degraded={degraded}
          onPaste={setPaste}
          onLabel={setLabel}
          onImport={async () => {
            setBusy("Extracting…");
            const result = await importText(
              paste,
              label.trim().length > 0 ? label.trim() : undefined,
            );
            setBusy(null);
            if (result.ok) {
              setPaste("");
              setLabel("");
            }
          }}
        />

        <details style={{ marginTop: 20 }}>
          <summary className="faint">Keyboard</summary>
          <p className="mono faint" style={{ fontSize: 12, marginTop: 8 }}>
            {describeKeys()}
          </p>
        </details>
      </section>
    );
  }

  /* ---------------- the queue ---------------- */
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header className="card" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong>Review</strong>
          <span className="faint" style={{ fontSize: 13 }}>
            {describeQueue(summary)}
          </span>
          {status === "committing" && <span className="faint">committing…</span>}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {REVIEW_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="nav-item"
              aria-pressed={options.filter === filter.id}
              style={options.filter === filter.id ? { borderColor: TIER_COLOUR.medium } : undefined}
              onClick={() => setOptions({ filter: filter.id })}
            >
              {filter.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <input
            className="mono"
            value={options.search}
            onChange={(event) => setOptions({ search: event.target.value })}
            placeholder="filter…"
            aria-label="Filter the queue"
            style={{ fontSize: 12, padding: "4px 8px", minWidth: 140 }}
          />
        </div>

        {error !== null && (
          <p className="notice notice-error" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </header>

      {items.map((item) => (
        <ReviewRow
          key={item.key}
          item={item}
          selected={item.key === selected}
          editing={item.key === editing}
          onSelect={() => setSelected(item.key)}
          onCloseEdit={() => setEditing(null)}
        />
      ))}

      {items.length === 0 && <p className="card faint">Nothing matches this filter.</p>}

      <footer className="card" style={{ padding: "14px 18px", display: "grid", gap: 10 }}>
        <div className="mono faint" style={{ fontSize: 12, whiteSpace: "pre-line" }}>
          {describeCommit(preview, unreviewed)}
        </div>

        {preview.mergeTargets.length > 0 && (
          <div className="faint" style={{ fontSize: 12 }}>
            Merges onto: {describeMergeTargets(preview)}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => useExtraction.getState().approveAllExpanded()}>
            Approve all expanded <span className="faint">(bulk — stays UNKNOWN)</span>
          </button>
          <button type="button" onClick={() => useExtraction.getState().discardAllCollapsed()}>
            Discard all collapsed
          </button>
          {unreviewed > 0 && (
            <button type="button" onClick={() => useExtraction.getState().discardUnreviewed()}>
              Discard the {unreviewed} unreviewed
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="faint" onClick={clear}>
            Throw this run away
          </button>
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(false)}>
                Back
              </button>
              <button
                type="button"
                style={{ borderColor: TIER_COLOUR.high }}
                onClick={() => {
                  const result = commit();
                  setConfirming(false);
                  if (!result.ok) useExtraction.setState({ error: result.error });
                }}
              >
                Yes — append {preview.events} events
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={preview.events <= 1}
            >
              Commit ({summariseCommit(preview)})
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One row                                                                    */
