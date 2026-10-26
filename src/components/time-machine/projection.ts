/**
 * Bi-temporal replay — 6.7.
 *
 * Phase 6 · sub-phase 6.7
 * Plan: plan/phase-6-presentation.md §6.7
 *
 * ---------------------------------------------------------------------------
 * THE PAYOFF FOR PHASE 0.3, AND NEARLY FREE
 *
 * The fold is pure and total, so replaying a PREFIX of the log is not a feature to build — it is a
 * call to `materializeAsOf` that has been sitting in the substrate since Phase 0. This module is
 * mostly about presenting it honestly.
 *
 * ---------------------------------------------------------------------------
 * TWO SLIDERS, BECAUSE TWO TIMELINES, AND THEY DIVERGE CONSTANTLY
 *
 *   valid time    "what was true then"      — filter by `isValidAt(window, T)` over a full fold
 *   learned time  "what did we know then"   — fold only the events with `at <= T`
 *
 * They are not two views of one ordering. In this product's actual workflow they diverge every time:
 * you paste a three-week-old transcript, so the system LEARNS today about a decision MADE on the 3rd.
 * Sliding learned time back to last week hides that decision entirely; sliding valid time back to the
 * 3rd shows it. Both are correct answers to different questions.
 *
 * The plan's risk is "time machine confuses two timelines", and the mitigation is to label them
 * explicitly and never show one without naming it. So every rendering in this module carries the
 * phrase "when it happened" or "when we learned", and the diff strip says which axis it measured
 * along.
 *
 * ---------------------------------------------------------------------------
 * THE DIFF STRIP IS THE PART THAT MAKES IT USEFUL
 *
 * A frozen picture of the past is a curiosity. What changed between then and now — decisions added,
 * premises invalidated, labels flipped, reversals — is the thing worth looking at, because it is the
 * log's own account of how the project's beliefs moved.
 * ---------------------------------------------------------------------------
 */

import { type Labelled, type NodeId, label as labelGraph } from "@/reasoning/labeller";
import { isKnownAt, isValidAt } from "@/substrate/bi-temporal";
import type { GraphState } from "@/substrate/graph-state";
import { materializeAsOf } from "@/substrate/materialize";
import type { DecisionId, EngineId, ISODateString, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { AnyEvent } from "@/types/events";

export type TimeAxis = "valid" | "learned";

export const AXIS_LABEL: Readonly<
  Record<TimeAxis, { short: string; question: string; long: string }>
> = {
  valid: {
    short: "when it happened",
    question: "What was TRUE at this point?",
    long:
      "Valid time. Filters the current graph to the nodes whose validity window covers T, so a " +
      "decision made before T and not yet withdrawn is shown, whether or not the system had heard " +
      "of it. This is the axis the timeline, the lattice and the exports all use.",
  },
  learned: {
    short: "when we learned",
    question: "What did the system KNOW at this point?",
    long:
      "Learned time. Replays only the events recorded at or before T, so a transcript pasted today " +
      "about a decision made three weeks ago is invisible until today. This is the axis the audit " +
      "trail uses, because an audit is about the system's reasoning history.",
  },
};

/** The graph as it stood at T on one axis. */
export function graphAt(
  events: readonly AnyEvent[],
  current: GraphState,
  at: ISODateString,
  axis: TimeAxis,
  engine: EngineId,
): GraphState {
  if (axis === "learned") {
    /* A prefix replay. `materializeAsOf` filters on `event.at`, which is learned time — exactly the
     * axis being asked for. */
    return materializeAsOf(events, at, { engine, now: at });
  }

  /* Valid time cannot be produced by a prefix fold: the events are in learned order, so cutting by
   * index would drop a decision made in January but recorded in October. Instead the CURRENT graph
   * is filtered by validity window, which is the definition of "true at T". */
  return current;
}

/** The nodes visible at T on the valid-time axis. */
export interface VisibleAt {
  readonly decisions: readonly DecisionId[];
  readonly premises: readonly PremiseId[];
  readonly hiddenDecisions: readonly DecisionId[];
  readonly hiddenPremises: readonly PremiseId[];
}

export function visibleAt(state: GraphState, at: ISODateString, axis: TimeAxis): VisibleAt {
  const decisions: DecisionId[] = [];
  const premises: PremiseId[] = [];
  const hiddenDecisions: DecisionId[] = [];
  const hiddenPremises: PremiseId[] = [];

  for (const decision of state.decisions.values()) {
    const visible =
      axis === "valid" ? isValidAt(decision.temporal, at) : isKnownAt(decision.temporal, at);
    if (visible) decisions.push(decision.id);
    else hiddenDecisions.push(decision.id);
  }

  for (const premise of state.premises.values()) {
    const visible =
      axis === "valid" ? isValidAt(premise.temporal, at) : isKnownAt(premise.temporal, at);
    if (visible) premises.push(premise.id);
    else hiddenPremises.push(premise.id);
  }

  return { decisions, premises, hiddenDecisions, hiddenPremises };
}

/* -------------------------------------------------------------------------- */
/* The diff strip                                                             */
/* -------------------------------------------------------------------------- */

export type DiffKind =
  | "decision-added"
  | "premise-invalidated"
  | "label-flipped"
  | "reversal"
  | "guard-failed";

export interface DiffEntry {
  readonly kind: DiffKind;
  readonly node: string;
  readonly detail: string;
}

export interface TimelineDiff {
  readonly entries: readonly DiffEntry[];
  readonly axis: TimeAxis;
  readonly from: ISODateString;
  readonly to: ISODateString;
}

/**
 * What changed between two graphs.
 *
 * `from` is the replayed graph and `to` the current one. Label flips are computed from both
 * labellings, because a label is derived from the graph and comparing the stored fields would miss
 * every flip caused by a change elsewhere.
 */
export function diffGraphs(
  from: GraphState,
  to: GraphState,
  axis: TimeAxis,
  fromAt: ISODateString,
  toAt: ISODateString,
): TimelineDiff {
  const entries: DiffEntry[] = [];
  const labelsBefore = labelGraph(from).labels;
  const labelsAfter = labelGraph(to).labels;

  for (const decision of to.decisions.values()) {
    if (!from.decisions.has(decision.id)) {
      entries.push({
        kind: "decision-added",
        node: decision.id,
        detail: '"' + decision.statement + '" (' + decision.variable + " = " + decision.value + ")",
      });
    }
  }

  for (const premise of to.premises.values()) {
    const before = from.premises.get(premise.id);
    if (before !== undefined && before.label !== "OUT" && premise.label === "OUT") {
      entries.push({
        kind: "premise-invalidated",
        node: premise.id,
        detail:
          '"' +
          premise.text +
          '" went OUT' +
          (premise.temporal.reason === undefined ? "" : " — " + premise.temporal.reason),
      });
    }
  }

  for (const [nodeId, labelled] of labelsAfter) {
    const previous = labelsBefore.get(nodeId);
    const fromLabel: DecisionLabel = previous?.label ?? "UNKNOWN";
    if (fromLabel === labelled.label) continue;

    entries.push({
      kind: "label-flipped",
      node: nodeId,
      detail: fromLabel + " → " + labelled.label,
    });
  }

  for (const decision of to.decisions.values()) {
    const before = from.decisions.get(decision.id);
    if (before === undefined) continue;
    if (before.status !== "superseded" && decision.status === "superseded") {
      entries.push({
        kind: "reversal",
        node: decision.id,
        detail:
          '"' +
          decision.statement +
          '" was superseded by ' +
          (decision.edges.supersededBy[0] ?? "a later decision"),
      });
    }
  }

  for (const guard of to.guards.values()) {
    const before = from.guards.get(guard.id);
    if (before?.lastRun?.outcome === "fail") continue;
    if (guard.lastRun?.outcome === "fail") {
      entries.push({ kind: "guard-failed", node: guard.id, detail: guard.lastRun.evidence });
    }
  }

  return { entries, axis, from: fromAt, to: toAt };
}

export const DIFF_KIND_LABEL: Readonly<Record<DiffKind, string>> = {
  "decision-added": "decisions added",
  "premise-invalidated": "premises invalidated",
  "label-flipped": "labels flipped",
  reversal: "reversals",
  "guard-failed": "guards started failing",
};

export function describeDiff(diff: TimelineDiff): string {
  const axis = AXIS_LABEL[diff.axis];

  if (diff.entries.length === 0) {
    return (
      "Nothing changed between " +
      diff.from.slice(0, 10) +
      " and " +
      diff.to.slice(0, 10) +
      " on the " +
      axis.short +
      " axis."
    );
  }

  const counts = new Map<DiffKind, number>();
  for (const entry of diff.entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);

  const lines = [
    "Between " +
      diff.from.slice(0, 10) +
      " and " +
      diff.to.slice(0, 10) +
      ", measured along " +
      axis.short +
      " (" +
      axis.question +
      "):",
    "",
  ];

  for (const [kind, count] of counts) {
    lines.push("  " + String(count).padStart(3) + "  " + DIFF_KIND_LABEL[kind]);
  }

  lines.push("");
  for (const entry of diff.entries.slice(0, 24)) {
    lines.push("  " + entry.node.padEnd(10) + " " + entry.detail);
  }
  if (diff.entries.length > 24) lines.push("  … " + (diff.entries.length - 24) + " more");

  return lines.join("\n");
}

/** The slider's bounds, from the log itself. */
export function timeRange(
  events: readonly AnyEvent[],
  state: GraphState,
): {
  earliest: ISODateString;
  latest: ISODateString;
} {
  let earliest: ISODateString | null = null;
  let latest: ISODateString | null = null;

  const consider = (value: ISODateString): void => {
    if (value.length === 0) return;
    if (earliest === null || value < earliest) earliest = value;
    if (latest === null || value > latest) latest = value;
  };

  for (const event of events) {
    consider(event.at);
    if (event.occurredAt !== undefined) consider(event.occurredAt);
  }

  for (const decision of state.decisions.values()) {
    consider(decision.temporal.valid);
    consider(decision.temporal.learned);
  }

  return {
    earliest: earliest ?? ("" as ISODateString),
    latest: latest ?? ("" as ISODateString),
  };
}

export type { Labelled, NodeId };
