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
 * THIS GRAPH IS BIPARTITE, WHICH CHANGES WHAT "BACKWARDS" MEANS
 *
 * `Justification.consequent` is a `DecisionId` and its lists are `PremiseId`s, so a
 * premise is never a consequent: **every premise is an assumption.** Doyle's
 * "antecedents of antecedents, stopping at nodes with no incoming arcs" reaches bedrock
 * in ONE hop here, because there is no derived-premise layer to walk through.
 *
 * So the culprit set is not found by depth. It is found by asking which premises
 * actually broke the justification:
 *
 *   · an IN-list premise that is no longer IN   — the support was withdrawn
 *   · an OUT-list premise that is now IN        — an excluded condition arrived
 *
 * That set is minimal BY CONSTRUCTION, which is what §2.6's ATMS borrowing asks for.
 * Premises that still hold are examined and cleared, and the explanation says so —
 * "the other three still hold" is the half of the diagnosis that makes it actionable.
 *
 * Depth does exist in this graph, but it comes from `Decision.edges.dependsOn`, not from
 * the justification arcs. That is what the walk follows when it needs to go deeper than
 * one hop, and it is the only way a failure reaches an assumption belonging to a
 * DIFFERENT decision.
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

import type { DecisionId, PremiseId } from "@/types/common";
import type { Justification } from "@/types/domain";
import type { BacktrackResult } from "@/types/reasoning";
import type { GraphState } from "@/substrate/graph-state";
import { indexGraph, justificationsFor } from "./graph-index";
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
  const index = indexGraph(state);
  const path: (DecisionId | PremiseId)[] = [];
  const culprits = new Set<PremiseId>();
  const visited = new Set<DecisionId>();
  let deepest = 0;
  let truncated = false;

  const walk = (nodeId: DecisionId, depth: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    if (depth > deepest) deepest = depth;
    if (depth > MAX_BACKTRACK_DEPTH) {
      truncated = true;
      return;
    }

    path.push(nodeId);

    /* ---- the culprit test: which premises actually broke the justification ---- */
    for (const justification of justificationsFor(index, nodeId)) {
      for (const premiseId of justification.inList) {
        const label = labels.get(premiseId)?.label;
        /* An unlabelled premise is an assumption presumed true. Only a premise that
         * has been actively labelled something other than IN withdrew its support. */
        if (label !== undefined && label !== "IN") {
          culprits.add(premiseId);
          path.push(premiseId);
        }
      }

      /* The non-monotonic half, and the one gate (c) exists for: an EXCLUDED condition
       * that arrived. This premise being IN is what invalidates the justification. */
      for (const premiseId of justification.outList) {
        if (labels.get(premiseId)?.label === "IN") {
          culprits.add(premiseId);
          path.push(premiseId);
        }
      }
    }

    /* ---- depth: `dependsOn`, the only arc that goes deeper in a bipartite graph ---- */
    const decision = state.decisions.get(nodeId);
    if (decision === undefined) return;

    for (const dependency of decision.edges.dependsOn) {
      if (visited.has(dependency)) continue;
      /* Only follow a dependency that is itself in trouble. Walking a sound dependency
       * would import its premises into the culprit set and inflate it, which is the one
       * thing minimality forbids. */
      if (labels.get(dependency)?.label === "IN") continue;
      walk(dependency, depth + 1);
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
  const index = indexGraph(state);
  const inList = new Set<PremiseId>();
  const outList = new Set<PremiseId>();

  for (const justification of justificationsFor(index, decisionId)) {
    /* Only the justifications that were HOLDING the decision up. Including an already
     * invalid one would put premises into the nogood that the decision never actually
     * relied on, and a nogood that overstates the conjunction blocks re-assertions it
     * has no business blocking. */
    if (labels.get(justification.id)?.label !== "IN") continue;
    for (const premiseId of justification.inList) inList.add(premiseId);
    for (const premiseId of justification.outList) outList.add(premiseId);
  }

  /* A decision whose every justification has already failed has no IN-labelled one to
   * read, and its nogood would come back empty. Fall back to all of them: the
   * conjunction that WAS believed is still the conjunction that cannot hold. */
  if (inList.size === 0 && outList.size === 0) {
    for (const justification of justificationsFor(index, decisionId)) {
      for (const premiseId of justification.inList) inList.add(premiseId);
      for (const premiseId of justification.outList) outList.add(premiseId);
    }
  }

  return { inList: [...inList], outList: [...outList] };
}

/**
 * The derived premises the walk could not get underneath.
 *
 * In a bipartite graph this is only ever non-empty when the DEPTH CAP bound a
 * `dependsOn` chain — there is no derived-premise layer to fail to reach. Kept because
 * §2.6 requires a partial result to be labelled partial rather than presented as
 * complete, and the cap is the one way this walk can come up short.
 */
export function partialCulprits(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): readonly PremiseId[] {
  const result = backtrack(state, labels, decisionId);
  if (!result.truncated) return [];

  const culprits = new Set(result.culpritPremises);
  return result.path.filter((nodeId) => {
    const asPremise = nodeId as PremiseId;
    return state.premises.has(asPremise) && !culprits.has(asPremise);
  });
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

  /* Minimality is stated explicitly: it is the difference between a diagnosis and a
   * list, and the user has to be told that the other premises were examined and cleared
   * rather than never looked at. */

  const singular = result.culpritPremises.length === 1;

  return [
    `${singular ? "One assumption is" : `${result.culpritPremises.length} assumptions are`} responsible: ${named}.`,
    singular
      ? "Retracting it alone is enough. Every other premise this decision rests on was examined and still holds."
      : "This is the smallest set that resolves it — give up as little of it as the new evidence requires. The other premises were examined and still hold.",
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
