/**
 * The visual language.
 *
 * Phase 6 · authored in Phase 0 so every component reads one source
 * Plan: plan/phase-6-presentation.md §6.0
 *
 * ---------------------------------------------------------------------------
 * THE RULE: COLOUR ENCODES EPISTEMIC STATUS, NEVER SEVERITY
 *
 * A red badge in most tools means "bad". In WhyLog it would be ambiguous, because
 * three different things need to look different and none of them is an error:
 *
 *   IN          the decision is supported by at least one valid justification
 *   OUT         every justification failed — RETRACTED, not wrong, not deleted
 *   UNKNOWN     the premises are neither confirmed nor refuted
 *   UNFOUNDED   a DATA-QUALITY warning: the justification chain never reaches a
 *               premise. Not a truth claim, and it must not look like one.
 *
 * So: green for supported, slate for retracted (present, closed, at rest — not
 * alarming), amber for unknown, and a distinct violet for unfounded, because
 * "we could not ground this" is a different kind of statement from "we are not
 * sure yet". Red is reserved for ONE thing: a decision that is currently being
 * contradicted or is drifting, i.e. an action is available.
 *
 * Anything that recolours a label by "importance" breaks this file's contract.
 * ---------------------------------------------------------------------------
 */

import type { DecisionLabel, DecisionStatus } from "@/types/domain";

export const LABEL_COLOUR: Readonly<Record<DecisionLabel, string>> = {
  IN: "var(--label-in)",
  OUT: "var(--label-out)",
  UNKNOWN: "var(--label-unknown)",
  UNFOUNDED: "var(--label-unfounded)",
};

export const LABEL_BACKGROUND: Readonly<Record<DecisionLabel, string>> = {
  IN: "var(--label-in-bg)",
  OUT: "var(--label-out-bg)",
  UNKNOWN: "var(--label-unknown-bg)",
  UNFOUNDED: "var(--label-unfounded-bg)",
};

export const LABEL_MEANING: Readonly<Record<DecisionLabel, string>> = {
  IN: "Supported — at least one justification is valid. IN does not mean TRUE; it means the decision currently rests on something.",
  OUT: "Retracted — every justification failed. Kept, never deleted, and still searchable.",
  UNKNOWN: "Unresolved — the premises are neither confirmed nor refuted.",
  UNFOUNDED: "Data-quality warning — the justification chain never reaches a premise node. Not a claim that the decision is wrong.",
};

export const STATUS_COLOUR: Readonly<Record<DecisionStatus, string>> = {
  proposed: "var(--status-proposed)",
  active: "var(--status-active)",
  contested: "var(--status-contested)",
  superseded: "var(--status-superseded)",
  archived: "var(--status-archived)",
};

export const STATUS_MEANING: Readonly<Record<DecisionStatus, string>> = {
  proposed: "Extracted, awaiting your review. Not yet part of the graph's conclusions.",
  active: "Approved and live.",
  contested: "Screened out by non-prioritized revision: the new information could not outrank what it contradicts. Waiting for you, never silently applied.",
  superseded: "Replaced by a later decision on the same variable. Excluded from exports by default.",
  archived: "Rejected or closed out. Retained for the audit trail.",
};

/** The four edge kinds the lattice draws, in four different styles. A cascade
 *  path and a conflict must never look alike: one propagates, one does not. */
export const EDGE_STYLE = {
  sharesPremiseWith: { stroke: "var(--edge-cascade)", width: 2, dash: "", label: "shares a premise — CASCADE PATH" },
  dependsOn: { stroke: "var(--edge-cascade)", width: 2, dash: "", label: "depends on — CASCADE PATH" },
  conflictsWith: { stroke: "var(--edge-conflict)", width: 1.5, dash: "5 3", label: "conflicts — never a cascade path" },
  supersedes: { stroke: "var(--edge-supersede)", width: 1.5, dash: "2 3", label: "supersedes" },
  supersededBy: { stroke: "var(--edge-supersede)", width: 1.5, dash: "2 3", label: "superseded by" },
  related: { stroke: "var(--edge-related)", width: 1, dash: "1 4", label: "topically related — logically compatible" },
} as const;

/** Premise-type columns in the lattice. Fixed order so the layout is stable
 *  across renders and screenshots. */
export const PREMISE_COLUMN_ORDER = [
  "scale",
  "deployment",
  "capability",
  "external",
  "team",
  "budget",
  "time",
  "requirement",
] as const;

/** World-observable types are drawn with a solid ring (a guard could check them);
 *  intent-based types with a dashed one (only a human can retract them). */
export const PREMISE_RING: Readonly<Record<string, string>> = {
  scale: "solid",
  deployment: "solid",
  capability: "solid",
  external: "solid",
  team: "dashed",
  budget: "dashed",
  time: "dashed",
  requirement: "dashed",
};

/** The mode badge. It says what is running BEFORE you act, not after. */
export const MODE_BADGE = {
  local: { label: "local engine", colour: "var(--mode-local)", meaning: "Deterministic, offline, no API key. Nothing leaves this browser." },
  llm: { label: "llm engine", colour: "var(--mode-llm)", meaning: "Your transcript is sent to the configured provider. Every produced node is stamped with this engine." },
  stale: { label: "index stale", colour: "var(--mode-stale)", meaning: "Semantic retrieval is disabled: the stored vectors came from a different embedding space." },
  unavailable: { label: "no engine", colour: "var(--mode-stale)", meaning: "No engine could be constructed. The log, graph and exports still work." },
} as const;

/** Confidence is drawn as a bar, never as a colour. A low-confidence extraction
 *  is not "red"; it is short, and the review UI is built around rejecting it fast
 *  because false positives outnumber false negatives roughly 13:1. */
export function confidenceWidth(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

export const CONFIDENCE_TIERS = [
  { min: 0.85, label: "high", action: "pre-expanded in the review queue" },
  { min: 0.6, label: "medium", action: "collapsed, one click to expand" },
  { min: 0, label: "low", action: "grouped, reject-all in one click" },
] as const;

export function confidenceTier(confidence: number): (typeof CONFIDENCE_TIERS)[number] {
  return CONFIDENCE_TIERS.find((tier) => confidence >= tier.min) ?? CONFIDENCE_TIERS[2]!;
}
