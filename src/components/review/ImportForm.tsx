/**
 * The import form — the entry point to the whole product.
 *
 * Phase 1 · sub-phase 1.9
 *
 * This is the first thing a new user sees, so it states the two things that decide
 * whether they paste anything at all: the transcript is read LOCALLY, and nothing
 * enters the log until they review it. A tool that asks for a conversation with an
 * AI assistant without saying where it goes will not get one.
 *
 * The shape list is real rather than aspirational — every shape named here is
 * detected by `extraction/lines.ts:detectShape`, and an unmarked transcript still
 * works, falling back to the lowest authority rather than guessing who spoke.
 */

import { useMemo, type ReactElement } from "react";

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export function ImportForm({
  paste,
  label,
  busy,
  degraded,
  onPaste,
  onLabel,
  onImport,
}: {
  readonly paste: string;
  readonly label: string;
  readonly busy: string | null;
  readonly degraded: boolean;
  readonly onPaste: (value: string) => void;
  readonly onLabel: (value: string) => void;
  readonly onImport: () => void;
}): ReactElement {
  const chars = useMemo(() => paste.length, [paste]);

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
      {degraded && (
        <p className="notice notice-error" style={{ margin: 0 }}>
          The log is read-only because its hash chain is broken. Export what is readable, then start
          a fresh log before importing anything new.
        </p>
      )}

      <input
        value={label}
        onChange={(event) => onLabel(event.target.value)}
        placeholder="label — “cursor session, oct 3”"
        aria-label="Transcript label"
        style={{ fontSize: 13, padding: "6px 10px" }}
      />

      <textarea
        className="mono"
        rows={14}
        value={paste}
        onChange={(event) => onPaste(event.target.value)}
        placeholder={"User: let's use sqlite instead of postgres\nAssistant: …"}
        aria-label="Transcript text"
        style={{ fontSize: 12, width: "100%", resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" onClick={onImport} disabled={busy !== null || degraded || chars === 0}>
          {busy ?? "Extract"}
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          {chars === 0 ? "nothing pasted yet" : `${chars.toLocaleString("en-IN")} characters`}
        </span>
      </div>

      <p className="faint" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
        Recognised shapes: Claude Code, Cursor chat, Copilot chat, Codex CLI, any
        <span className="mono"> Speaker: </span>marked transcript, and JSONL exports. An unmarked
        transcript is still read — attribution falls back to the lowest authority rather than
        guessing that you said something the agent said.
      </p>
    </div>
  );
}
