/**
 * Progressive disclosure — 6.2 / 6.9.
 *
 * Phase 6
 * Plan: plan/phase-6-presentation.md §6.2 (risk: "decision card too dense to read")
 *
 * The decision card is the most information-dense screen in the product, and density is the
 * mitigation's whole subject: the Y-statement and status are always visible, everything else is
 * collapsed by default. That only works if collapsing is one component used everywhere, so the
 * affordance looks and behaves the same on every section of every screen.
 */

import { type ReactElement, type ReactNode, useState } from "react";

export interface CollapsibleProps {
  readonly title: string;
  /** Always visible beside the title — a count, a status, a one-line summary. This is what makes
   *  a collapsed section informative rather than merely hidden. */
  readonly summary?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  /** Rendered when open, at the top. For the sentence that explains why this section exists. */
  readonly note?: ReactNode;
}

export function Collapsible(props: CollapsibleProps): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          cursor: "pointer",
          /* A real button, not a div with role="button": the native element brings the
           * keyboard behaviour (Enter and Space activate it) and the focus ring for free,
           * which is exactly what the hand-rolled onKeyDown was re-implementing badly. */
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
        }}
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
      >
        <span className="mono faint" style={{ fontSize: 11, width: 12 }}>
          {open ? "▾" : "▸"}
        </span>
        <span
          className="faint"
          style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}
        >
          {props.title}
        </span>
        {props.summary !== undefined ? (
          <span className="dim" style={{ fontSize: 11, marginLeft: "auto", textAlign: "right" }}>
            {props.summary}
          </span>
        ) : null}
      </button>

      {open ? (
        <div style={{ marginTop: 8, paddingLeft: 20 }}>
          {props.note !== undefined ? (
            <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
              {props.note}
            </div>
          ) : null}
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
