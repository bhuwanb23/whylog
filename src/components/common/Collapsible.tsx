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

import { useState, type ReactElement, type ReactNode } from "react";

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
      <div
        style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((previous) => !previous);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <span className="mono faint" style={{ fontSize: 11, width: 12 }}>
          {open ? "▾" : "▸"}
        </span>
        <span className="faint" style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>
          {props.title}
        </span>
        {props.summary !== undefined ? (
          <span className="dim" style={{ fontSize: 11, marginLeft: "auto", textAlign: "right" }}>
            {props.summary}
          </span>
        ) : null}
      </div>

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
