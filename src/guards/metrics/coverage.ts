/**
 * Verifiable Coverage — 4.4.
 *
 * Phase 4 · sub-phase 4.4
 * Plan: plan/phase-4-executable-guards.md §4.4
 *
 *       IN decisions with ≥1 accepted guard
 *       ────────────────────────────────────
 *              all IN decisions
 *
 * Low coverage means most of the log is unfalsifiable prose. This is the number that stops
 * compliance from flattering itself, and the reason `unverifiable` is a visible state rather
 * than a silent omission.
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { UnverifiableDecision } from "@/types/guards";

export interface CoverageResult {
  readonly score: number;
  readonly covered: number;
  readonly inDecisions: number;
  /** IN decisions with no accepted guard, and why — from synthesis where it said. */
  readonly uncovered: readonly DecisionId[];
  readonly unverifiable: readonly UnverifiableDecision[];
  /** Decisions that have PROPOSED guards but none accepted. Distinct from uncovered: these are
   *  one review click away from being checkable, and saying so is more useful than listing them
   *  as gaps. */
  readonly awaitingAcceptance: readonly DecisionId[];
}

export function coverage(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  unverifiable: readonly UnverifiableDecision[],
): CoverageResult {
  const inDecisions: DecisionId[] = [];

  for (const decision of state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") continue;
    const label = labels.get(decision.id)?.label ?? decision.label;
    if (label !== "IN") continue;
    inDecisions.push(decision.id);
  }

  const covered: DecisionId[] = [];
  const awaiting: DecisionId[] = [];

  for (const decisionId of inDecisions) {
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;

    let accepted = 0;
    let proposed = 0;

    for (const guardId of decision.guardIds) {
      const guard = state.guards.get(guardId);
      if (guard === undefined) continue;
      if (guard.lifecycle === "accepted") accepted += 1;
      else if (guard.lifecycle === "proposed") proposed += 1;
    }

    if (accepted > 0) covered.push(decisionId);
    else if (proposed > 0) awaiting.push(decisionId);
  }

  const uncovered = inDecisions.filter((id) => !covered.includes(id) && !awaiting.includes(id));

  return {
    score: inDecisions.length === 0 ? 0 : covered.length / inDecisions.length,
    covered: covered.length,
    inDecisions: inDecisions.length,
    uncovered,
    unverifiable,
    awaitingAcceptance: awaiting,
  };
}

export function describeCoverage(result: CoverageResult): string {
  if (result.inDecisions === 0) {
    return "No IN decisions, so there is nothing to cover.";
  }

  const lines = [
    "Verifiable coverage: " +
      result.covered +
      " of " +
      result.inDecisions +
      " IN decisions have at least one accepted guard.",
  ];

  if (result.awaitingAcceptance.length > 0) {
    lines.push(
      "  " +
        result.awaitingAcceptance.length +
        " more have PROPOSED guards awaiting acceptance: " +
        result.awaitingAcceptance.join(", ") +
        ". One review click each.",
    );
  }

  if (result.uncovered.length > 0) {
    lines.push(
      "  " + result.uncovered.length + " have nothing proposed: " + result.uncovered.join(", "),
    );
  }

  if (result.unverifiable.length > 0) {
    lines.push("");
    lines.push("Unverifiable — no guard could be synthesised, and the reason is recorded:");
    for (const entry of result.unverifiable) {
      lines.push("  " + entry.decisionId + " — " + entry.reason);
    }
  }

  lines.push("");
  lines.push(
    "Unverifiable decisions are SHOWN, never skipped. They are exactly the ones most likely to",
    "drift, because nothing would tell you if they did — and a compliance score computed only",
    "over the decisions that happened to be checkable is a score that flatters itself.",
  );

  return lines.join("\n");
}
