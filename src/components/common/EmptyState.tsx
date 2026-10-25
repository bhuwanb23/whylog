/**
 * The empty state — 6.9.
 *
 * Phase 6 · sub-phase 6.9
 * Plan: plan/phase-6-presentation.md §6.9
 *
 * ---------------------------------------------------------------------------
 * NOT A BLANK PAGE
 *
 * "First run is the most common drop-off point in every tool in this category." A blank screen says
 * nothing about whether the tool is broken, empty, or waiting for you — and the user resolves that
 * ambiguity by leaving.
 *
 * So every empty state says three things: what is missing, what to do about it, and where to do it.
 * An optional action makes the third one clickable rather than descriptive.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, NOT TEN COPY STRINGS
 *
 * Empty states are the easiest thing in a UI to let rot, because each one is written once and read
 * rarely. A single component with a required `action` prop means a new empty state cannot be added
 * without saying what the user should do — the prop is the discipline.
 * ---------------------------------------------------------------------------
 */

import type { ReactElement, ReactNode } from "react";

export interface EmptyStateProps {
  readonly title: string;
  /** What is missing. One sentence, naming the thing rather than the feeling. */
  readonly what: string;
  /** What to do about it. Required: an empty state with no next step is a dead end. */
  readonly action: string;
  readonly onAction?: () => void;
  readonly actionLabel?: string;
  /** Secondary routes, rendered as plain links below the primary action. */
  readonly also?: readonly { label: string; onClick: () => void }[];
  readonly children?: ReactNode;
}

export function EmptyState(props: EmptyStateProps): ReactElement {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: 6,
        padding: "28px 24px",
        textAlign: "center",
        background: "var(--surface-sunken)",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{props.title}</div>

      <div className="dim" style={{ fontSize: 13, maxWidth: 520, margin: "0 auto" }}>
        {props.what}
      </div>

      <div style={{ fontSize: 13, marginTop: 10, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
        {props.action}
      </div>

      {props.onAction !== undefined ? (
        <button
          type="button"
          className="badge"
          style={{ marginTop: 14, fontSize: 13, padding: "6px 14px" }}
          onClick={props.onAction}
        >
          {props.actionLabel ?? "Do it"}
        </button>
      ) : null}

      {props.also !== undefined && props.also.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {props.also.map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="badge faint"
              style={{ fontSize: 11 }}
              onClick={entry.onClick}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.children !== undefined ? <div style={{ marginTop: 16, textAlign: "left" }}>{props.children}</div> : null}
    </div>
  );
}

/**
 * The first-run state, which is its own thing rather than a generic empty state.
 *
 * §6.9: "a paste target, one sentence of explanation, and a 'load the demo transcript' button that
 * seeds the fixture. The demo path must be one click from a cold start." A judge at a hackathon
 * will not paste their own transcript; if the demo is not one click away, the product is not seen.
 */
export function FirstRunState({
  onPaste,
  onDemo,
}: {
  onPaste: () => void;
  onDemo: () => void;
}): ReactElement {
  return (
    <EmptyState
      title="Nothing has been recorded yet"
      what="WhyLog turns conversations with a coding agent into a decision log — what you decided, what you assumed, what you turned down, and what would have to change for it to stop being true."
      action="Paste a transcript and the decisions in it are extracted, reviewed by you, and committed to an append-only log."
      onAction={onPaste}
      actionLabel="Paste a transcript"
      also={[{ label: "Load the demo transcript (one click)", onClick: onDemo }]}
    />
  );
}
