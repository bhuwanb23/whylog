/**
 * Dependency-directed backtracking — 2.6.
 *
 * Phase 2 · sub-phase 2.6
 * Plan: plan/phase-2-truth-maintenance.md §2.6
 * Docs: docs/02-truth-maintenance-theory.md §3
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A GRAPH SEARCH
 *
 * The naive move is to walk the justification graph from the failed decision and
 * report everything reachable. That answers "what depends on this?" — which the
 * cascade in `cascade.ts` already does — and not the question backtracking exists to
 * answer: **which assumptions, minimally, are responsible for this belief being
 * unsound?**
 *
 * The distinction is visible in the demo fixture.
 *
 *   WLD-0001 "SQLite, not Postgres" is justified by four IN-list premises.
 *   New information arrives: two users.
 *
 * Reachability says: "all four premises, plus the decision, plus everything below".
 * Backtracking says: "ONE premise — `single-user` — is the culprit. The other three
 * still hold. Give up that one and nothing else."
 *
 * Minimal retraction is the entire point of dependency-directed backtracking, and it
 * is what makes the proposal actionable. "Everything you believed is now suspect" is
 * not a proposal.
 *
 * ---------------------------------------------------------------------------
 * DOYLE'S LABEL PROPAGATION, RUN BACKWARDS
 *
 * `labeller.ts` propagates IN/OUT forward from premises to conclusions. Here we
 * propagate the failure backwards: from an unsound decision, to the justification
 * that held it up, to the IN-list premises of that justification, and down through
 * premises that are themselves conclusions.
 *
 * A premise that is a CONCLUSION has its own justifications, and those get the same
 * treatment — which is how a failure reaches an assumption several levels down rather
 * than stopping at the first layer of derived beliefs.
 *
 * ---------------------------------------------------------------------------
 * THE TRUNCATION FLAG IS NOT COSMETIC
 *
 * Depth is capped because a cyclic justification set can loop forever (a cycle cannot
 * be well-founded, but a log can still CONTAIN one if events arrive in an order that
 * defeats the check). `truncated: true` must reach the user: a backtracking result
 * that stopped early is a different answer from one that finished, and presenting
 * them identically would make an incomplete diagnosis look complete.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { Justification } from "@/types/domain";
import type { BacktrackResult } from "@/types/reasoning";
import type { Labelled, NodeId } from "./labeller";

/** Deeper than this and the graph is almost certainly cyclic or the diagnosis has
 *  stopped being useful to a human. */
export const MAX_BACKTRACK_DEPTH = 6;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Find the minimal set of assumptions responsible for `decisionId` being unsound.
 *
 * Returns premises, not decisions. A decision is a conclusion; you do not fix a
 * broken conclusion by removing it, you fix it by removing the assumption that no
 * longer holds and letting the label propagate.
 */
export function backtrack(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): BacktrackResult {
  const path: (DecisionId | PremiseId)[] = [];
  const culprits = new Set<PremiseId>();
  const visitedNodes = new Set<NodeId>();
  let deepest = 0;
  let truncated = false;

  // The walk visits DECISIONS and PREMISES. Justifications are what it FOLLOWS,
  // not what it lands on: the path is the chain of beliefs, and a justification
  // is the argument between two of them.
  const walk = (nodeId: DecisionId | PremiseId, depth: number): void => {
    if (visitedNodes.has(nodeId)) return;
    visitedNodes.add(nodeId);

    if (depth > deepest) deepest = depth;
    if (depth > MAX_BACKTRACK_DEPTH) {
      truncated = true;
      return;
    }

    path.push(nodeId);

    const supporting = supportingJustificationsFor(state, labels, nodeId);

    for (const justification of supporting) {
      for (const premiseId of justification.inList) {
        if (culprits.has(premiseId)) continue;

        const premiseLabel = labels.get(premiseId);

        /* An OUT-labelled premise inside an IN justification is exactly the
         * unsoundness we are chasing. It is the culprit. */
        if (premiseLabel !== undefined && premiseLabel.label === "OUT") {
          culprits.add(premiseId);
          continue;
        }

        /* A premise that is itself a conclusion gets walked: its own assumptions are
         * the real culprits, and stopping here would blame a derived belief for
         * something an assumption underneath it caused. */
        const premise = state.premises.get(premiseId);
        const isConclusion = premise !== undefined && premise.justifications.length > 0;

        if (isConclusion) {
          culprits.add(premiseId);
          walk(premiseId, depth + 1);
        } else {
          /* An assumption. This is bedrock — there is nothing underneath to blame. */
          culprits.add(premiseId);
        }
      }
    }
  };

  walk(decisionId, 0);

  return {
    culpritPremises: [...culprits],
    path,
    depthReached: deepest,
    truncated,
  };
}

/**
 * The justifications currently holding a node up.
 *
 * A node can have several; one OUT-labelled justification does not make the node
 * unsound if another is IN (multiple independent support), so only the IN ones — or,
 * when none are IN, all of them — are followed.
 */
function supportingJustificationsFor(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  nodeId: NodeId,
): readonly Justification[] {
  /* Decisions and premises live in separate id spaces; ask the graph which one this
   * is rather than pattern-matching the id string. */
  const justifications = state.decisions.has(nodeId as DecisionId)
    ? justificationsOfDecision(state, nodeId as DecisionId)
    : justificationsOfPremise(state, nodeId as PremiseId);

  const inLabelled = justifications.filter(
    (justification) => labels.get(justification.id)?.label === "IN",
  );

  return inLabelled.length > 0 ? inLabelled : justifications;
}

function justificationsOfDecision(
  state: GraphState,
  decisionId: DecisionId,
): readonly Justification[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: Justification[] = [];
  for (const justification of state.justifications.values()) {
    if (justification.consequent === decisionId) out.push(justification);
  }
  return out;
}

function justificationsOfPremise(
  state: GraphState,
  premiseId: PremiseId,
): readonly Justification[] {
  const premise = state.premises.get(premiseId);
  if (premise === undefined) return [];

  const out: Justification[] = [];
  for (const justificationId of premise.justifications) {
    const justification = state.justifications.get(justificationId);
    if (justification !== undefined) out.push(justification);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The premises a single decision rests on                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every premise in any supporting IN-list of a decision, with OUT-list premises kept
 * separate.
 *
 * This is the conjunction that goes into a nogood: "these cannot all hold". It is
 * deliberately NOT filtered to the culprits — a nogood records the whole set that was
 * believed together, because that is what cannot be re-asserted together.
 */
export function assumptionSetOf(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): { readonly inList: readonly PremiseId[]; readonly outList: readonly PremiseId[] } {
  const inList = new Set<PremiseId>();
  const outList = new Set<PremiseId>();

  for (const justification of justificationsOfDecision(state, decisionId)) {
    if (labels.get(justification.id)?.label !== "IN") continue;
    for (const premiseId of justification.inList) inList.add(premiseId);
    for (const premiseId of justification.outList) outList.add(premiseId);
  }

  return { inList: [...inList], outList: [...outList] };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeBacktrack(state: GraphState, result: BacktrackResult): string {
  if (result.culpritPremises.length === 0) {
    return "No culprit found — the decision is supported by assumptions that still hold.";
  }

  const named = result.culpritPremises
    .map((premiseId) => `"${state.premises.get(premiseId)?.text ?? premiseId}"`)
    .join(", ");

  const singular = result.culpritPremises.length === 1;

  return [
    `${singular ? "One assumption is" : `${result.culpritPremises.length} assumptions are`} responsible: ${named}.`,
    singular
      ? "Retracting it alone is enough; nothing else needs to be given up."
      : "Give up as little of this set as the new evidence requires.",
    `Searched to depth ${result.depthReached}.`,
    result.truncated
      ? `TRUNCATED at depth ${MAX_BACKTRACK_DEPTH} — there may be culprits deeper than this result shows.`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * The assumptions a human would recognise as assumptions.
 *
 * `requirement` and `team` premises express intent rather than a state of the world;
 * blaming them for an unsound decision reads as nonsense ("your belief failed because
 * you wanted offline mode"). The diagnosis leads with the world-observable ones and
 * lists the intent-based ones separately, marked as human-only.
 */
export function splitCulprits(
  state: GraphState,
  culprits: readonly PremiseId[],
): { readonly worldObservable: readonly PremiseId[]; readonly intentBased: readonly PremiseId[] } {
  const worldObservable: PremiseId[] = [];
  const intentBased: PremiseId[] = [];

  for (const premiseId of culprits) {
    const premise = state.premises.get(premiseId);
    if (premise === undefined) continue;
    if (premise.type === "requirement" || premise.type === "team") intentBased.push(premiseId);
    else worldObservable.push(premiseId);
  }

  return { worldObservable, intentBased };
}
