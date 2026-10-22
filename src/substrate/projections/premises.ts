/**
 * Premise projection.
 *
 * Phase 0 · sub-phase 0.2
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I2 — PREMISES ARE SHARED NODES
 *
 * A premise is not a property of a decision. "It's one person, one machine, one
 * log" is ONE node that three decisions rest on, and when it dies all three are
 * affected at once. That sharing is the entire mechanism behind the cascade, and
 * it is why this projection is indexed premise -> decisions rather than the other
 * way round.
 *
 * The read side here is where gate (c) looks: which premises are world-observable
 * and therefore falsifiable by a guard, and which decisions would fall if one of
 * them died.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import { type Decision, type Premise, type PremiseType, isWorldObservable } from "@/types/domain";
import { byIdAsc, byTemporalValidDesc, compare, isOpen } from "../bi-temporal";
import type { GraphState } from "../graph-state";

const BY_VALID_TIME = compare(byTemporalValidDesc, byIdAsc);

export function getPremise(state: GraphState, id: PremiseId): Premise | null {
  return state.premises.get(id) ?? null;
}

export function allPremises(state: GraphState): readonly Premise[] {
  return [...state.premises.values()].sort(BY_VALID_TIME);
}

export function openPremises(state: GraphState): readonly Premise[] {
  return allPremises(state).filter((p) => isOpen(p.temporal));
}

/** Invalidated premises, newest death first. This is the "reality moved" list,
 *  and it is the view that makes WhyLog different from a memory tool: it shows
 *  what stopped being true, not just what was said. */
export function deadPremises(state: GraphState): readonly Premise[] {
  return allPremises(state)
    .filter((p) => !isOpen(p.temporal))
    .sort((a, b) => {
      const ai = a.temporal.invalidFrom ?? "";
      const bi = b.temporal.invalidFrom ?? "";
      if (ai === bi) return 0;
      return ai < bi ? 1 : -1;
    });
}

export function premisesByType(state: GraphState, type: PremiseType): readonly Premise[] {
  return allPremises(state).filter((p) => p.type === type);
}

/**
 * Premises a guard or repo scan could falsify.
 *
 * Phase 4 only synthesises guards for these. There is no point checking `budget`:
 * no file in the repository records it, so any check would either always pass
 * (useless) or always fail (noise).
 */
export function worldObservablePremises(state: GraphState): readonly Premise[] {
  return openPremises(state).filter((p) => isWorldObservable(p.type));
}

/** Premises only a human can retract. Shown in the review UI with an explicit
 *  "is this still true?" prompt, because nothing else will ever tell us. */
export function intentBasedPremises(state: GraphState): readonly Premise[] {
  return openPremises(state).filter((p) => !isWorldObservable(p.type));
}

/** Premises still awaiting confirmation. */
export function pendingPremises(state: GraphState): readonly Premise[] {
  const out: Premise[] = [];
  for (const id of state.pendingPremises) {
    const premise = state.premises.get(id);
    if (premise) out.push(premise);
  }
  return out.sort(BY_VALID_TIME);
}

/**
 * Load-bearing premises: those that more than one decision rests on.
 *
 * Sorted by blast radius. This is the list to review first, because invalidating
 * the top entry changes the most, and it is the honest answer to "which of my
 * assumptions matter?".
 */
export function loadBearingPremises(state: GraphState): readonly {
  premise: Premise;
  decisions: readonly DecisionId[];
}[] {
  const out: { premise: Premise; decisions: readonly DecisionId[] }[] = [];

  for (const [premiseId, decisionIds] of state.premiseToDecisions) {
    if (decisionIds.length < 2) continue;
    const premise = state.premises.get(premiseId);
    if (!premise || !isOpen(premise.temporal)) continue;
    out.push({ premise, decisions: decisionIds });
  }

  out.sort((a, b) => b.decisions.length - a.decisions.length || byIdAsc(a.premise, b.premise));
  return out;
}

/** Decisions resting on a premise. O(1) lookup, materialised by the fold. */
export function dependentsOf(state: GraphState, premiseId: PremiseId): readonly DecisionId[] {
  return state.premiseToDecisions.get(premiseId) ?? [];
}

export function dependentDecisions(state: GraphState, premiseId: PremiseId): readonly Decision[] {
  const out: Decision[] = [];
  for (const id of dependentsOf(state, premiseId)) {
    const decision = state.decisions.get(id);
    if (decision) out.push(decision);
  }
  return out.sort(BY_VALID_TIME);
}

/** Premises a decision rests on, split the way Doyle's justification does.
 *  The OUT-list is the excluded condition, and it is the half nobody extracts. */
export function premisesOf(
  state: GraphState,
  decisionId: DecisionId,
): { inList: readonly Premise[]; outList: readonly Premise[] } {
  const inList: Premise[] = [];
  const outList: Premise[] = [];
  const seen = new Set<PremiseId>();

  for (const justificationId of state.decisions.get(decisionId)?.justificationIds ?? []) {
    const justification = state.justifications.get(justificationId);
    if (!justification) continue;

    for (const id of justification.inList) {
      if (seen.has(id)) continue;
      seen.add(id);
      const premise = state.premises.get(id);
      if (premise) inList.push(premise);
    }
    for (const id of justification.outList) {
      if (seen.has(id)) continue;
      seen.add(id);
      const premise = state.premises.get(id);
      if (premise) outList.push(premise);
    }
  }

  return {
    inList: inList.sort(byIdAsc),
    outList: outList.sort(byIdAsc),
  };
}

/** Premises with more than one independent observation. Corroboration is the
 *  term in entrenchment that a single transcript cannot inflate. */
export function corroboratedPremises(state: GraphState, minReferences = 2): readonly Premise[] {
  return allPremises(state).filter(
    (p) => (state.premiseToDecisions.get(p.id)?.length ?? 0) >= minReferences,
  );
}

/** Premises whose evidence disagrees with itself — one observation supporting and
 *  one refuting. The system's own uncertainty, surfaced rather than averaged
 *  away. */
export function contestedPremises(state: GraphState): readonly Premise[] {
  return allPremises(state).filter((p) => {
    let supporting = 0;
    let refuting = 0;
    for (const evidence of p.evidence) {
      if (evidence.supports) supporting += 1;
      else refuting += 1;
    }
    return supporting > 0 && refuting > 0;
  });
}

/** What was true at a given VALID time. */
export function premisesAsOf(state: GraphState, at: ISODateString): readonly Premise[] {
  return allPremises(state).filter((p) => {
    if (p.temporal.valid > at) return false;
    if (p.temporal.invalidFrom !== undefined && p.temporal.invalidFrom <= at) return false;
    return true;
  });
}

export function describePremise(premise: Premise): string {
  const value = premise.value === undefined ? "" : ` = ${String(premise.value)}`;
  return `${premise.id} [${premise.label}] ${premise.predicate}${value} — "${premise.text}"`;
}
