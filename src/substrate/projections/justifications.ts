/**
 * Justification projection.
 *
 * Phase 0 · sub-phase 0.2 · docs/02 §2.1 (Doyle's SL-justifications)
 *
 * ---------------------------------------------------------------------------
 * THE EVALUATION RULE
 *
 * A support-list justification `<consequent, IN-list, OUT-list, informant>` is
 * VALID iff every node in the IN-list is IN **and no node in the OUT-list is IN**.
 *
 * A decision is IN iff at least one of its justifications is valid. Otherwise it
 * is OUT — RELABELLED, never deleted.
 *
 * The OUT-list is what makes this non-monotonic, and it is the mechanism behind
 * gate (c): "we chose SQLite GIVEN that there is no server" is a justification
 * whose OUT-list contains `deployment.has_server`. When a repo scan finds a
 * server, the justification becomes invalid without anybody contradicting
 * anything. Extracting EXCLUDED conditions is as important as extracting
 * supporting ones, and almost no rationale miner does it.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, JustificationId, PremiseId } from "@/types/common";
import type { Decision, DecisionLabel, Justification, Premise } from "@/types/domain";
import { byIdAsc } from "../bi-temporal";
import type { GraphState } from "../graph-state";

export interface JustificationEvaluation {
  readonly justification: Justification;
  readonly valid: boolean;
  /** IN-list premises that are not IN. */
  readonly failingIn: readonly PremiseId[];
  /** OUT-list premises that have become IN — the non-monotonic failure. */
  readonly violatingOut: readonly PremiseId[];
  /** IN-list premises that are UNKNOWN rather than IN or OUT. */
  readonly unresolved: readonly PremiseId[];
  readonly nonMonotonic: boolean;
}

export function getJustification(state: GraphState, id: JustificationId): Justification | null {
  return state.justifications.get(id) ?? null;
}

export function allJustifications(state: GraphState): readonly Justification[] {
  return [...state.justifications.values()].sort(byIdAsc);
}

/** Evaluate one justification against the CURRENT labels. */
export function evaluate(state: GraphState, justification: Justification): JustificationEvaluation {
  const failingIn: PremiseId[] = [];
  const violatingOut: PremiseId[] = [];
  const unresolved: PremiseId[] = [];

  for (const id of justification.inList) {
    const label = state.premises.get(id)?.label;
    if (label === undefined)
      failingIn.push(id); // a missing premise cannot support
    else if (label === "UNKNOWN" || label === "UNFOUNDED") unresolved.push(id);
    else if (label !== "IN") failingIn.push(id);
  }

  for (const id of justification.outList) {
    const label = state.premises.get(id)?.label;
    // An OUT-list entry must NOT be IN. A missing premise does not violate it.
    if (label === "IN") violatingOut.push(id);
  }

  return {
    justification,
    valid: failingIn.length === 0 && violatingOut.length === 0 && unresolved.length === 0,
    failingIn,
    violatingOut,
    unresolved,
    nonMonotonic: justification.outList.length > 0,
  };
}

/** Every justification for a decision, evaluated. */
export function evaluateFor(
  state: GraphState,
  decisionId: DecisionId,
): readonly JustificationEvaluation[] {
  const decision = state.decisions.get(decisionId);
  if (!decision) return [];

  const out: JustificationEvaluation[] = [];
  for (const id of decision.justificationIds) {
    const justification = state.justifications.get(id);
    if (justification) out.push(evaluate(state, justification));
  }
  return out;
}

/**
 * The label a decision SHOULD carry, computed from scratch.
 *
 * This is the check that keeps the stored label honest. Phase 2 recomputes labels
 * incrementally as premises change; this recomputes them from the whole graph.
 * When the two disagree, the incremental path has a bug, and the health panel
 * says so rather than showing a wrong label with confidence.
 */
export function deriveLabel(state: GraphState, decision: Decision): DecisionLabel {
  if (decision.justificationIds.length === 0) {
    // No justification at all. A decision with a value but no support is not
    // false — it is UNFOUNDED, which is a data-quality statement rather than a
    // truth claim.
    return decision.label === "OUT" ? "OUT" : "UNFOUNDED";
  }

  const evaluations = evaluateFor(state, decision.id);
  if (evaluations.length === 0) return "UNFOUNDED";

  if (evaluations.some((e) => e.valid)) return "IN";

  // Every justification fails. If any fails only because a premise is UNKNOWN,
  // the honest label is UNKNOWN, not OUT: we have not refuted it, we have not
  // confirmed it.
  if (evaluations.some((e) => e.unresolved.length > 0 && e.failingIn.length === 0)) {
    return "UNKNOWN";
  }

  return "OUT";
}

export interface LabelDrift {
  readonly decisionId: DecisionId;
  readonly stored: DecisionLabel;
  readonly derived: DecisionLabel;
}

/** Every decision whose stored label disagrees with the derived one. */
export function labelDrift(state: GraphState): readonly LabelDrift[] {
  const out: LabelDrift[] = [];
  for (const decision of state.decisions.values()) {
    const derived = deriveLabel(state, decision);
    if (derived !== decision.label) {
      out.push({ decisionId: decision.id, stored: decision.label, derived });
    }
  }
  return out.sort((a, b) => byIdAsc({ id: a.decisionId }, { id: b.decisionId }));
}

/** Justifications with a non-empty OUT-list. The count is reported in the health
 *  panel because it is the single best proxy for whether premise extraction is
 *  finding EXCLUDED conditions — the half of the job that makes gate (c) work. */
export function nonMonotonicJustifications(state: GraphState): readonly Justification[] {
  return allJustifications(state).filter((j) => j.outList.length > 0);
}

/** Circular justification chains: a decision whose support path returns to
 *  itself. Detected by a bounded DFS rather than a full SCC algorithm — the
 *  graph is small and the check only needs a yes/no per decision. */
export function findCircular(state: GraphState, decisionId: DecisionId): readonly DecisionId[] {
  const path: DecisionId[] = [];
  const seen = new Set<DecisionId>();

  const walk = (id: DecisionId): readonly DecisionId[] | null => {
    if (path.includes(id)) return [...path, id];
    if (seen.has(id)) return null;
    seen.add(id);
    path.push(id);

    for (const justificationId of state.decisions.get(id)?.justificationIds ?? []) {
      const justification = state.justifications.get(justificationId);
      if (!justification) continue;
      for (const premiseId of justification.inList) {
        for (const dependent of state.premiseToDecisions.get(premiseId) ?? []) {
          const found = walk(dependent);
          if (found) return found;
        }
      }
    }

    path.pop();
    return null;
  };

  return walk(decisionId) ?? [];
}

/** Premises that appear in some OUT-list. These are the excluded conditions the
 *  system recovered — worth counting, because the number is usually zero until
 *  the prompt is right. */
export function excludedConditions(state: GraphState): readonly Premise[] {
  const ids = new Set<PremiseId>();
  for (const justification of state.justifications.values()) {
    for (const id of justification.outList) ids.add(id);
  }
  const out: Premise[] = [];
  for (const id of ids) {
    const premise = state.premises.get(id);
    if (premise) out.push(premise);
  }
  return out.sort(byIdAsc);
}

/** Who produced a justification. The agency ledger's reasoning half: an
 *  extraction-informed justification is weaker evidence than a human one, and the
 *  UI says so rather than showing both in the same voice. */
export function informants(state: GraphState): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const justification of state.justifications.values()) {
    const key = justification.informant.kind;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
