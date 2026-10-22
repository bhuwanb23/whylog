/**
 * Log Soundness — 4.4. The truth-maintenance counterpart.
 *
 * Phase 4 · sub-phase 4.4
 *
 *       IN decisions
 *       ────────────────────────────
 *       all non-superseded decisions
 *
 * Compliance asks whether the CODE still honours the log. Soundness asks whether the LOG still
 * supports itself: how much of what you believe is currently justified by premises that hold.
 * A log can be perfectly compliant and unsound — every guard passing, half the decisions resting
 * on premises that went OUT — and the two numbers answer different questions, so neither
 * substitutes for the other.
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";

export interface SoundnessResult {
  readonly score: number;
  readonly inCount: number;
  readonly denominator: number;
  readonly byLabel: Readonly<Record<DecisionLabel, number>>;
  /** Decisions that are not IN and not superseded — the gap this metric measures. */
  readonly unsound: readonly DecisionId[];
}

export function soundness(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): SoundnessResult {
  const byLabel: Record<DecisionLabel, number> = {
    IN: 0,
    OUT: 0,
    UNKNOWN: 0,
    UNFOUNDED: 0,
  };

  const unsound: DecisionId[] = [];
  let denominator = 0;

  for (const decision of state.decisions.values()) {
    /* Superseded decisions are excluded from BOTH sides: they are history, and counting them in
     * the denominator would make soundness fall every time you correctly reverse a decision. */
    if (decision.status === "superseded" || decision.status === "archived") continue;

    denominator += 1;
    const label = labels.get(decision.id)?.label ?? decision.label;
    byLabel[label] += 1;

    if (label !== "IN") unsound.push(decision.id);
  }

  return {
    score: denominator === 0 ? 0 : byLabel.IN / denominator,
    inCount: byLabel.IN,
    denominator,
    byLabel,
    unsound,
  };
}

export function describeSoundness(result: SoundnessResult): string {
  if (result.denominator === 0) return "No live decisions to assess.";

  const parts = [
    `Log soundness: ${result.inCount} of ${result.denominator} live decisions are IN.`,
  ];

  for (const label of ["OUT", "UNKNOWN", "UNFOUNDED"] as const) {
    const count = result.byLabel[label];
    if (count === 0) continue;
    parts.push(`  ${label}: ${count} — ${meaningOf(label)}`);
  }

  parts.push("");
  parts.push(
    "Soundness is the truth-maintenance counterpart to compliance, and they answer different",
    "questions. A log can be perfectly compliant and unsound: every guard passing while half the",
    "decisions rest on premises that went OUT. Neither number substitutes for the other.",
  );

  return parts.join("\n");
}

function meaningOf(label: DecisionLabel): string {
  switch (label) {
    case "OUT":
      return "a premise it rests on has been falsified, or something it excludes has become true.";
    case "UNKNOWN":
      return "its justification is incomplete — a premise it needs has no label yet.";
    case "UNFOUNDED":
      return "its justification chain is circular or never reaches a premise. A DATA-QUALITY warning, not a truth claim.";
    case "IN":
      return "";
  }
}
