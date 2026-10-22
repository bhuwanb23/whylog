/**
 * L5 ΓÇö premise inverted index. 3.3
 *
 * Phase 3 ┬╖ sub-phase 3.3
 * Plan: plan/phase-3-retrieval.md ┬º3.3
 *
 * ---------------------------------------------------------------------------
 * THE LEVEL NOBODY ELSE HAS, BECAUSE NOBODY ELSE STORES PREMISES
 *
 *   premiseIndex   premiseId ΓåÆ [decisionIds]     Phase 2 gate (c) and the cascade
 *
 * Two consumers, and they want opposite things from the same index:
 *
 *   ┬╖ RETRIEVAL ΓÇö "what assumes a single user?" should return every decision resting on
 *     that premise. This is a question shape the other four levels cannot answer at all:
 *     the premise text may not appear in any decision's statement, so L1 and L3 both miss
 *     it, and L4 only knows variables and values.
 *
 *   ┬╖ REASONING ΓÇö gate (c) and the cascade need premise ΓåÆ dependents in O(1). Before this
 *     index they scanned every justification, which is what made `reasoning/graph-index.ts`
 *     necessary as a per-run workaround. L5 is the same relation, maintained by the fold
 *     instead of rebuilt per run.
 *
 * ---------------------------------------------------------------------------
 * PROMOTED, NOT FUSED ΓÇö SAME RULE AS L4
 *
 * A premise match is exact: either the decision's justification names that premise id or
 * it does not. There is no score to normalise and nothing to blend, so it promotes to the
 * top of the candidate list rather than entering RRF.
 *
 * The distinction from L4 is what it promotes ON. L4 matches the query's slot and value;
 * L5 matches a premise the query named or that a retrieved decision rests on, which is how
 * "what breaks if we add a second user?" reaches the decisions that never mention users.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { IndexArtifacts } from "@/types/retrieval";

export interface PremiseMatch {
  readonly decisionId: DecisionId;
  readonly premiseId: PremiseId;
  readonly via: "query-named" | "shared-with-retrieved";
  readonly explanation: string;
}

/**
 * Decisions resting on a named premise.
 *
 * `via` distinguishes a premise the QUERY named from one shared with an already-retrieved
 * decision. The second is graph expansion ΓÇö following one hop from a good hit ΓÇö and it is
 * promoted more weakly, because it is one step removed from what was actually asked.
 */
export function searchL5(
  artifacts: IndexArtifacts,
  premiseIds: readonly PremiseId[],
  via: PremiseMatch["via"] = "query-named",
  premiseText?: (id: PremiseId) => string,
): readonly PremiseMatch[] {
  const out: PremiseMatch[] = [];
  const seen = new Set<DecisionId>();

  for (const premiseId of premiseIds) {
    for (const decisionId of artifacts.premises.premiseToDecisions.get(premiseId) ?? []) {
      if (seen.has(decisionId)) continue;
      seen.add(decisionId);

      const named = premiseText === undefined ? premiseId : premiseText(premiseId);

      out.push({
        decisionId,
        premiseId,
        via,
        explanation:
          via === "query-named"
            ? "rests on " + premiseId + ' "' + named + '", which the query named'
            : "shares premise " + premiseId + ' "' + named + '" with a decision already retrieved',
      });
    }
  }

  return out;
}

/** The premises a decision rests on, for the reranker's premise-overlap component. */
export function premisesOfDecision(
  artifacts: IndexArtifacts,
  decisionId: DecisionId,
): readonly PremiseId[] {
  return artifacts.premises.decisionToPremises.get(decisionId) ?? [];
}

/**
 * Premise overlap between two decisions, as a fraction.
 *
 * Jaccard over premise ids. Used by the local reranker at weight 0.10 ΓÇö deliberately the
 * second-lowest component, because shared premises indicate graph proximity, not
 * relevance to the question. Two decisions can rest on the same premise and answer
 * completely different questions.
 */
export function premiseOverlap(a: readonly PremiseId[], b: readonly PremiseId[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const setB = new Set(b);
  let intersection = 0;
  for (const id of a) if (setB.has(id)) intersection += 1;

  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** One hop out from a set of decisions: every decision sharing a premise with any of them.
 *  This is the graph-expansion step, and it follows SHARED PREMISES only ΓÇö the same edge
 *  the cascade is allowed to follow, and for the same reason. */
export function expandBySharedPremise(
  artifacts: IndexArtifacts,
  seeds: readonly DecisionId[],
): readonly DecisionId[] {
  const premises = new Set<PremiseId>();
  for (const decisionId of seeds) {
    for (const premiseId of premisesOfDecision(artifacts, decisionId)) premises.add(premiseId);
  }

  const seedSet = new Set(seeds);
  const out = new Set<DecisionId>();

  for (const premiseId of premises) {
    for (const decisionId of artifacts.premises.premiseToDecisions.get(premiseId) ?? []) {
      if (seedSet.has(decisionId)) continue;
      out.add(decisionId);
    }
  }

  return [...out].sort();
}

export function l5Count(artifacts: IndexArtifacts): number {
  return artifacts.premises.premiseToDecisions.size;
}

export function describeL5(artifacts: IndexArtifacts): string {
  const premises = artifacts.premises.premiseToDecisions.size;
  const decisions = artifacts.premises.decisionToPremises.size;
  return (
    `L5 premise inverted ΓÇö ${premises} premise(s) indexed across ${decisions} decision(s). ` +
    `Serves "what assumes X?" (a shape no other level can answer) and gives Phase 2 gate (c) ` +
    `and the cascade O(1) premise-to-dependents lookup. Promoted, not fused.`
  );
}
