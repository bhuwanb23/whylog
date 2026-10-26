/**
 * Status and label badges — 6.0 / 6.9.
 *
 * Phase 6 · the visual language
 * Plan: plan/phase-6-presentation.md §6.0
 *
 * ---------------------------------------------------------------------------
 * EVERY STATUS ALSO CARRIES A TEXT LABEL
 *
 * The plan's own risk table: "never encode meaning in colour alone — every status also has a text
 * label." Colour is for scanning, text is for reading, and a screen reader gets only the text. So
 * `StatusBadge` never renders a dot without a word beside it, and `title` always carries the full
 * meaning from `theme.ts` rather than a paraphrase that could drift from it.
 *
 * ---------------------------------------------------------------------------
 * LABEL AND STATUS ARE DIFFERENT AXES AND ARE NEVER MERGED
 *
 * `label` is epistemic: IN / OUT / UNKNOWN / UNFOUNDED — is this belief currently supported?
 * `status` is lifecycle: proposed / active / contested / superseded / archived — where is it in
 * its life?
 *
 * A decision can be `active` and `OUT`: live in the log, unsupported by its premises. Merging the
 * two into one badge would hide exactly the combination that matters most, which is the one the
 * whole truth-maintenance layer exists to surface.
 * ---------------------------------------------------------------------------
 */

import {
  LABEL_BACKGROUND,
  LABEL_COLOUR,
  LABEL_MEANING,
  STATUS_COLOUR,
  STATUS_MEANING,
} from "@/theme";
import type { DecisionLabel, DecisionStatus } from "@/types/domain";
import type { ReactElement } from "react";

export function LabelBadge({ label }: { label: DecisionLabel }): ReactElement {
  return (
    <span
      className="badge"
      title={LABEL_MEANING[label]}
      style={{
        color: LABEL_COLOUR[label],
        border: "1px solid " + LABEL_COLOUR[label],
        /* UNFOUNDED is a data-quality warning, not a truth claim, and the plan draws it hollow
         * with a dashed border so it cannot be mistaken for a verdict about the world. */
        borderStyle: label === "UNFOUNDED" ? "dashed" : "solid",
        /* UNKNOWN is absence of evidence, drawn as absence of fill. */
        background:
          label === "UNKNOWN" || label === "UNFOUNDED" ? "transparent" : LABEL_BACKGROUND[label],
      }}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: DecisionStatus }): ReactElement {
  return (
    <span
      className="badge"
      title={STATUS_MEANING[status]}
      style={{
        color: STATUS_COLOUR[status],
        /* Superseded is history: retained, muted, and struck through rather than hidden. */
        textDecoration: status === "superseded" || status === "archived" ? "line-through" : "none",
        opacity: status === "superseded" || status === "archived" ? 0.6 : 1,
      }}
    >
      {status}
    </span>
  );
}

/**
 * The six statuses §6.1 requires the timeline to render distinctly.
 *
 * They are a PROJECTION of label and status, not a third axis — which is why this is a function of
 * both rather than a field on the decision. Rendering them from anything else would let the
 * timeline and the card disagree about the same decision.
 */
export type TimelineStatus =
  | "SOUND"
  | "UNSOUND"
  | "UNVERIFIED"
  | "UNFOUNDED"
  | "CONTESTED"
  | "SUPERSEDED";

export function timelineStatusOf(label: DecisionLabel, status: DecisionStatus): TimelineStatus {
  if (status === "superseded" || status === "archived") return "SUPERSEDED";
  if (status === "contested") return "CONTESTED";
  switch (label) {
    case "IN":
      return "SOUND";
    case "OUT":
      return "UNSOUND";
    case "UNKNOWN":
      return "UNVERIFIED";
    case "UNFOUNDED":
      return "UNFOUNDED";
  }
}

/** The colour for each of the six, per the visual-language table.
 *
 *  UNSOUND is AMBER, NOT RED. Unsound is a warning, not an error — the decision was retracted
 *  because a premise failed, which is the system working correctly. Red is reserved for the one
 *  thing that means "an action is available": a live contradiction or drift.
 */
export const TIMELINE_STATUS_COLOUR: Readonly<Record<TimelineStatus, string>> = {
  SOUND: "var(--label-in)",
  UNSOUND: "var(--label-unknown)",
  UNVERIFIED: "var(--text-faint)",
  UNFOUNDED: "var(--label-unfounded)",
  CONTESTED: "var(--label-unknown)",
  SUPERSEDED: "var(--label-out)",
};

export const TIMELINE_STATUS_MEANING: Readonly<Record<TimelineStatus, string>> = {
  SOUND:
    "Labelled IN — at least one justification is valid. The decision currently rests on something.",
  UNSOUND:
    "Labelled OUT — every justification failed. Retracted, not deleted, and still searchable. Amber rather than red because this is the system working, not an error.",
  UNVERIFIED:
    "Labelled UNKNOWN — the premises are neither confirmed nor refuted. Drawn hollow: absence of evidence is rendered as absence of fill.",
  UNFOUNDED:
    "A DATA-QUALITY warning: the justification chain never reaches a premise. Not a claim that the decision is wrong.",
  CONTESTED:
    "Screened out by non-prioritized revision — new information could not outrank what it contradicts. Waiting for you; never silently applied.",
  SUPERSEDED:
    "Replaced by a later decision on the same variable, or archived. Retained as history and excluded from agent exports by default.",
};

export function TimelineStatusBadge({ status }: { status: TimelineStatus }): ReactElement {
  return (
    <span
      className="badge"
      title={TIMELINE_STATUS_MEANING[status]}
      style={{
        color: TIMELINE_STATUS_COLOUR[status],
        border: "1px solid " + TIMELINE_STATUS_COLOUR[status],
        /* Hollow for the two that mean "we do not know", filled for the two that mean "we do". */
        background:
          status === "UNVERIFIED" || status === "UNFOUNDED"
            ? "transparent"
            : "color-mix(in srgb, " + TIMELINE_STATUS_COLOUR[status] + " 12%, transparent)",
        borderStyle: status === "UNFOUNDED" ? "dashed" : "solid",
        textDecoration: status === "SUPERSEDED" ? "line-through" : "none",
      }}
    >
      {status}
    </span>
  );
}

/** The visual language as a legend. Rendered wherever statuses appear, because a colour system
 *  nobody can look up is a colour system nobody can learn. */
export function StatusLegend(): ReactElement {
  const statuses: TimelineStatus[] = [
    "SOUND",
    "UNSOUND",
    "UNVERIFIED",
    "UNFOUNDED",
    "CONTESTED",
    "SUPERSEDED",
  ];

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {statuses.map((status) => (
        <TimelineStatusBadge key={status} status={status} />
      ))}
      <span className="faint" style={{ fontSize: 11 }}>
        Colour encodes epistemic status, never severity. Red is reserved for one thing: a live
        contradiction or drift — that is, an action is available.
      </span>
    </div>
  );
}
