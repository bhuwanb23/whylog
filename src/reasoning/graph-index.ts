/**
 * A one-pass index over the justification graph — Phase 2.
 *
 * Plan: plan/phase-2-truth-maintenance.md §2.2 (the 500-node criterion)
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF THIS GRAPH, WHICH IS NOT THE TEXTBOOK SHAPE
 *
 * `Justification.consequent` is a `DecisionId` and its IN/OUT lists are `PremiseId`s.
 * A premise is therefore NEVER a consequent: **the justification graph is bipartite.**
 * Decisions are supported by premises; premises are supported by nothing, because in
 * this formalism a premise IS an assumption.
 *
 * That has a consequence for §2.6 that is easy to get wrong. Doyle's backtracking
 * traces "antecedents of antecedents" and stops at nodes with no incoming arcs. Here
 * every premise has no incoming arcs, so backtracking through justifications reaches
 * bedrock in ONE hop. There is no derived-premise layer to walk through.
 *
 * Depth in this graph comes from somewhere else: `Decision.edges.dependsOn`. That is
 * where "antecedents of antecedents" actually lives, and it is what backtracking and
 * the cascade walk when they need to go deeper than one hop.
 *
 * Phase 1 does create premises it calls "derived" — the OUT-list exclusions produced by
 * `ontology/data/exclusions.ts`. But they are derived in the EXTRACTION sense (their
 * text was composed from a rule) and stored as ordinary assumption nodes. They are
 * recognised by the text marker `"— excluded by"`, never by a graph arc.
 *
 * ---------------------------------------------------------------------------
 * WHY AN INDEX AT ALL
 *
 * The naive implementation of every traversal here scans `state.justifications` per
 * decision, which is `O(D × J)` per hop and `O(D² × J)` for a cascade. Invisible at
 * demo scale; tens of millions of comparisons at the 500 nodes §2.2 names. Both indexes
 * cost one pass and every later lookup is `O(1)`.
 *
 * NOT A CACHE. Built per run, thrown away. The graph changes between runs — that is the
 * point of the cycle — and invalidating a memoised index on every event is a correctness
 * risk bought for a saving that does not exist.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, JustificationId, PremiseId } from "@/types/common";
import type { Justification } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";

export interface ReasoningIndex {
  /** decision → its justifications, from `decision.justificationIds`. */
  readonly byConsequent: ReadonlyMap<DecisionId, readonly Justification[]>;
  /** premise → the decisions that rest on it. Inverted from `state.premiseToDecisions`,
   *  which is the same relation and already maintained by the fold. */
  readonly decisionsOfPremise: ReadonlyMap<PremiseId, readonly DecisionId[]>;
  /** decision → the premises named by its justifications. The cascade's second hop:
   *  when a decision falls, these are the premises whose support it was contributing. */
  readonly premisesOfDecision: ReadonlyMap<DecisionId, readonly PremiseId[]>;
}

const EMPTY_JUSTIFICATIONS: readonly Justification[] = [];
const EMPTY_IDS: readonly never[] = [];

export function indexGraph(state: GraphState): ReasoningIndex {
  const byConsequent = new Map<DecisionId, readonly Justification[]>();
  const premisesOfDecision = new Map<DecisionId, readonly PremiseId[]>();

  for (const decision of state.decisions.values()) {
    const justifications: Justification[] = [];
    const premises = new Set<PremiseId>();

    for (const justificationId of decision.justificationIds) {
      const justification: Justification | undefined = state.justifications.get(justificationId);
      if (justification === undefined) continue;
      justifications.push(justification);
      for (const premiseId of justification.inList) premises.add(premiseId);
      for (const premiseId of justification.outList) premises.add(premiseId);
    }

    byConsequent.set(decision.id, justifications);
    premisesOfDecision.set(decision.id, [...premises]);
  }

  return {
    byConsequent,
    decisionsOfPremise: state.premiseToDecisions,
    premisesOfDecision,
  };
}

/** The justifications holding a decision up. `[]` when it has none — which is itself a
 *  finding: a decision with no justification is an unsupported assertion. */
export function justificationsFor(
  index: ReasoningIndex,
  decisionId: DecisionId,
): readonly Justification[] {
  return index.byConsequent.get(decisionId) ?? EMPTY_JUSTIFICATIONS;
}

/** The decisions resting on a premise. This is the shared-premise edge the cascade is
 *  allowed to follow, and the ONLY edge it is allowed to follow. */
export function decisionsRestingOn(
  index: ReasoningIndex,
  premiseId: PremiseId,
): readonly DecisionId[] {
  return index.decisionsOfPremise.get(premiseId) ?? (EMPTY_IDS as readonly DecisionId[]);
}

/** Every premise a decision's justifications name, IN-list and OUT-list together. */
export function premisesNamedBy(
  index: ReasoningIndex,
  decisionId: DecisionId,
): readonly PremiseId[] {
  return index.premisesOfDecision.get(decisionId) ?? (EMPTY_IDS as readonly PremiseId[]);
}

/**
 * Is this premise one of Phase 1's derived OUT-list exclusions?
 *
 * Recognised by the TEXT MARKER, because that is how Phase 1 stores it and there is no
 * graph arc to follow — a premise is never a consequent. Testing `hasExclusion(predicate)`
 * instead would not distinguish a supporting premise from the exclusion derived from it,
 * since both carry the same predicate.
 */
export const DERIVED_PREMISE_MARKER = "— excluded by";

export function isDerivedPremiseText(text: string): boolean {
  return text.includes(DERIVED_PREMISE_MARKER);
}

/** A justification by id, for callers that hold one. */
export function justificationById(
  state: GraphState,
  id: JustificationId,
): Justification | undefined {
  return state.justifications.get(id);
}
