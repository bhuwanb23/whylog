/**
 * Nogoods — 2.6.
 *
 * Phase 2 · sub-phase 2.6
 * Plan: plan/phase-2-truth-maintenance.md §2.6
 * Docs: docs/02-truth-maintenance-theory.md §3
 *
 * ---------------------------------------------------------------------------
 * A NOGOOD IS THE EXPLANATION, NOT BOOKKEEPING
 *
 * In Doyle's TMS a nogood is an internal record that stops the label propagator from
 * re-deriving a combination it has already ruled out. Nobody ever sees it.
 *
 * Here it is the single most useful sentence the system can produce:
 *
 *   "These two assumptions cannot both hold:
 *      · the app has one user, single machine
 *      · two people edit concurrently
 *    WLD-0001 was accepted assuming both. One of them is now false."
 *
 * That is what makes the proposal legible. "WLD-0001 is unsound" tells a user a
 * label changed. "These two things cannot both be true" tells them what to think
 * about — and it is checkable without trusting the system.
 *
 * ---------------------------------------------------------------------------
 * TWO JOBS, ONE RECORD
 *
 *  1. EXPLAIN — the sentence above, quoted verbatim in the proposal.
 *  2. BLOCK — if the same conjunction is ever re-asserted, the system says "we have
 *     already established these cannot both hold" instead of re-labelling from
 *     scratch and producing the same unsoundness again.
 *
 * Job 2 is why nogoods are appended to the log rather than recomputed. A recomputed
 * nogood disappears when the state that produced it is revised; a recorded one is a
 * fact about the log's history and survives the revision that motivated it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THEY COME FROM
 *
 * Three sources, all deterministic:
 *
 *  · gate (a) — two decisions on the same variable with antonym values, each with an
 *    IN-list. The conjunction of both IN-lists is impossible.
 *  · gate (c) — a decision's IN-list contains a world-observable premise that has
 *    been retracted, or its OUT-list contains a premise that has been asserted.
 *  · gate (b) — a model-adjudicated contradiction. Recorded, but flagged as
 *    engine-derived, because a nogood the user cannot verify from the graph is weaker
 *    than one they can.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, NogoodId, PremiseId } from "@/types/common";
import type { GraphState } from "@/substrate/graph-state";
import { formatNogoodId } from "@/lib/ids";
import type { NogoodRecord } from "@/types/reasoning";
import type { ContradictionGate } from "@/types/retrieval";
import { assumptionSetOf } from "./backtracking";
import type { Labelled, NodeId } from "./labeller";
import type { GateFinding } from "./gates";

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export interface NogoodDraft {
  /** The premises that cannot all hold. Sorted, de-duplicated, never empty. */
  readonly premiseIds: readonly PremiseId[];
  readonly explanation: string;
  readonly gate: ContradictionGate;
  readonly decisionIds: readonly DecisionId[];
  /** A model produced this. Shown as such — see the header. */
  readonly engineDerived: boolean;
}

/**
 * Build the nogood for one gate finding.
 *
 * Returns `null` when there is no conjunction to record: a finding whose decisions
 * carry no IN-list premises has nothing to say beyond "these conflict", and an empty
 * nogood would be worse than none because it would look like a recorded impossibility.
 */
export function nogoodForFinding(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  finding: GateFinding,
): NogoodDraft | null {
  if (finding.gate === "premise") return nogoodForPremiseFinding(state, labels, finding);

  const decisionIds =
    finding.otherDecisionId === null
      ? [finding.decisionId]
      : [finding.decisionId, finding.otherDecisionId];

  const premises: PremiseId[] = [];
  for (const decisionId of decisionIds) {
    const assumptionSet = assumptionSetOf(state, labels, decisionId);
    premises.push(...assumptionSet.inList);
    premises.push(...assumptionSet.outList);
  }

  const premiseIds = [...new Set(premises)];
  if (premiseIds.length === 0) return null;

  return {
    premiseIds: sortPremises(premiseIds),
    explanation: explainConjunction(state, premiseIds, decisionIds, finding.explanation),
    gate: finding.gate,
    decisionIds,
    engineDerived: !finding.deterministic,
  };
}

/**
 * A premise-invalidation finding names its premise directly; the nogood is that
 * premise together with the rest of the decision's assumption set, because the set as
 * a whole is what cannot hold.
 */
function nogoodForPremiseFinding(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  finding: GateFinding,
): NogoodDraft | null {
  if (finding.premiseId === null) return null;

  const assumptionSet = assumptionSetOf(state, labels, finding.decisionId);
  const premiseIds = sortPremises(
    [...new Set<PremiseId>([finding.premiseId, ...assumptionSet.inList, ...assumptionSet.outList])],
  );

  if (premiseIds.length === 0) return null;

  return {
    premiseIds,
    explanation: explainConjunction(
      state,
      premiseIds,
      [finding.decisionId],
      finding.explanation,
    ),
    gate: finding.gate,
    decisionIds: [finding.decisionId],
    engineDerived: false,
  };
}

/* -------------------------------------------------------------------------- */
/* The sentence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * "These assumptions cannot all hold" plus the finding that established it.
 *
 * The premises are quoted as recorded text, not paraphrased. A user has to be able to
 * read the nogood and check it against their own memory of the conversation without
 * first trusting that the system described the premise correctly.
 */
export function explainConjunction(
  state: GraphState,
  premiseIds: readonly PremiseId[],
  decisionIds: readonly DecisionId[],
  findingExplanation: string,
): string {
  const quoted = premiseIds
    .map((premiseId) => {
      const premise = state.premises.get(premiseId);
      return `  · ${premise?.text ?? premiseId} (${premiseId})`;
    })
    .join("\n");

  const decisions =
    decisionIds.length === 0
      ? ""
      : `\n${decisionIds.join(", ")} ${decisionIds.length === 1 ? "was" : "were"} accepted assuming this conjunction.`;

  return [
    `These assumptions cannot all hold:\n${quoted}`,
    findingExplanation,
    decisions,
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Blocking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Does the log already contain a nogood covering this conjunction?
 *
 * A stored nogood blocks a candidate when the stored set is a SUBSET of the
 * candidate's: if {A, B} cannot both hold, then {A, B, C} cannot either. The reverse
 * does not follow, and treating it as though it did would let a two-premise nogood be
 * evaded by adding a third premise.
 */
export function blocksConjunction(
  state: GraphState,
  candidate: readonly PremiseId[],
): NogoodRecord | null {
  const candidateSet = new Set(candidate);

  for (const nogood of state.nogoods.values()) {
    if (nogood.premiseIds.length === 0) continue;
    const covered = nogood.premiseIds.every((premiseId) => candidateSet.has(premiseId));
    if (covered) return nogood;
  }

  return null;
}

/**
 * Nogoods that involve a given premise.
 *
 * Used by the premise detail view: "this assumption has already been shown
 * incompatible with two others" is context a user needs before deciding whether to
 * retract it.
 */
export function nogoodsInvolving(state: GraphState, premiseId: PremiseId): readonly NogoodRecord[] {
  const out: NogoodRecord[] = [];
  for (const nogood of state.nogoods.values()) {
    if (nogood.premiseIds.includes(premiseId)) out.push(nogood);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The next nogood id, from the counter.
 *
 * Never a module-level counter: the log is append-only and its ids must survive a
 * reload, which only a counter folded from the events can guarantee.
 */
export function nextNogoodId(state: GraphState): NogoodId {
  return formatNogoodId(state.counters.nogoods + 1);
}

/** A canonical key for a conjunction, so the same set is never recorded twice. */
export function nogoodKey(premiseIds: readonly PremiseId[]): string {
  return sortPremises([...new Set(premiseIds)]).join("|");
}

function sortPremises(premiseIds: readonly PremiseId[]): readonly PremiseId[] {
  return [...premiseIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether a stored nogood duplicates a draft. */
export function isDuplicate(state: GraphState, draft: NogoodDraft): boolean {
  const key = nogoodKey(draft.premiseIds);
  for (const nogood of state.nogoods.values()) {
    if (nogoodKey(nogood.premiseIds) === key) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function countNogoods(state: GraphState): number {
  return state.nogoods.size;
}

/* NOTE: `NogoodRecord` carries no provenance field, so whether a nogood came from a
 * deterministic gate or from gate (b) is NOT recoverable from the log. `NogoodDraft`
 * keeps `engineDerived` for the proposal, which is built in the same run and can show
 * it while the finding is still in hand. If provenance has to survive a reload it
 * belongs on the event payload, not on a heuristic over the explanation string. */
