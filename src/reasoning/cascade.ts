/**
 * Cascade — 2.7.
 *
 * Phase 2 · sub-phase 2.7
 * Plan: plan/phase-2-truth-maintenance.md §2.7
 * Docs: docs/02-truth-maintenance-theory.md §3
 *
 * ---------------------------------------------------------------------------
 * ONE PREMISE FALLS. WHAT ELSE BECOMES UNSOUND?
 *
 * Not "everything downstream". That is the naive answer and it is the one that gets a
 * tool switched off.
 *
 * A decision whose justification loses an IN-list premise becomes unsound ONLY IF that
 * justification was its only support. A decision with two independent IN justifications
 * keeps one, and stays IN. Propagation STOPS there.
 *
 * This is the difference between a truth-maintenance system and a notification spam
 * cannon, and it is why risk R2 ("the cascade cries wolf") is the second-largest risk
 * in the plan. Over-retraction is worse than under-retraction: a missed dependency is
 * recoverable on the next run, but a user who is told that eleven of their decisions
 * are unsound when one premise changed will stop reading the list.
 *
 * ---------------------------------------------------------------------------
 * THE STOP CONDITION IS LOAD-BEARING, NOT AN OPTIMISATION
 *
 * `stoppedAtIndependentSupport: true` is recorded on the step where propagation ended
 * because the node had surviving support. It is surfaced in the UI as a deliberate
 * non-event:
 *
 *   "WLD-0004 also rests on `single-user`, but it has a second independent
 *    justification that still holds. It stays IN. Propagation stopped here."
 *
 * Showing WHY something was not retracted is as important as showing what was. Without
 * it the user cannot tell "we checked and it is fine" from "we did not look".
 *
 * ---------------------------------------------------------------------------
 * DEPTH CAP
 *
 * Six levels. Beyond that the chain is no longer something a human can follow in one
 * reading, and `truncated` plus `potentiallyAffectedBeyondCap` report that there is
 * more rather than silently pretending the walk finished.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { DecisionLabel, Justification } from "@/types/domain";
import type { CascadeResult, CascadeStep } from "@/types/reasoning";
import type { Labelled, NodeId } from "./labeller";

export const MAX_CASCADE_DEPTH = 6;

/**
 * Propagate one retraction.
 *
 * @param retractedPremises the premises that just became false. Propagation starts
 *   from every justification that named one of them.
 */
export function cascade(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  retractedPremises: readonly PremiseId[],
): CascadeResult {
  const steps: CascadeStep[] = [];
  const flipped: DecisionId[] = [];
  const survivors: DecisionId[] = [];
  const visited = new Set<NodeId>();
  let truncated = false;
  let beyondCap = 0;

  const retractedSet = new Set<PremiseId>(retractedPremises);

  /* Seed: every decision whose IN justification names a retracted premise. */
  const seeds: DecisionId[] = [];
  for (const decisionId of decisionIdsOf(state)) {
    if (justificationsNaming(state, decisionId, retractedSet).length > 0) seeds.push(decisionId);
  }

  const propagate = (decisionId: DecisionId, from: DecisionId | PremiseId, depth: number): void => {
    if (visited.has(decisionId)) return;
    visited.add(decisionId);

    if (depth > MAX_CASCADE_DEPTH) {
      truncated = true;
      beyondCap += 1;
      return;
    }

    const decision = state.decisions.get(decisionId);
    if (decision === undefined) return;

    const current: DecisionLabel = labels.get(decisionId)?.label ?? decision.label;

    /* ---- THE STOP CONDITION ---- */
    if (hasIndependentSupport(state, labels, decisionId, retractedSet)) {
      steps.push({
        from,
        to: decisionId,
        depth,
        became: current,
        stoppedAtIndependentSupport: true,
        reason:
          "Another justification for this decision does not depend on any retracted premise. It still holds, so the decision stays as it is. Propagation stops here.",
      });
      survivors.push(decisionId);
      return;
    }

    const became: DecisionLabel = current === "IN" ? "OUT" : current;
    steps.push({
      from,
      to: decisionId,
      depth,
      became,
      stoppedAtIndependentSupport: false,
      reason:
        became === "OUT"
          ? "Every justification for this decision named a premise that is no longer true. Without them it has no support."
          : `Already ${current}; no support was lost.`,
    });

    if (became !== current) flipped.push(decisionId);

    /* Premises that are conclusions of this decision now lose their support too, and
     * anything resting on them is next in line. */
    for (const premiseId of conclusionsOf(state, decisionId)) {
      retractedSet.add(premiseId);
      for (const dependent of decisionIdsOf(state)) {
        if (visited.has(dependent)) continue;
        if (justificationsNaming(state, dependent, new Set([premiseId])).length > 0) {
          propagate(dependent, premiseId, depth + 1);
        }
      }
    }
  };

  for (const seed of seeds) {
    /* `from` names the NODE the propagation came through. The first retracted premise
     * this seed depends on is the honest answer; the justification id is not a node. */
    const via = firstRetractedPremiseOf(state, seed, retractedSet);
    propagate(seed, via ?? seed, 0);
  }

  return { steps, flipped, survivors, truncated, potentiallyAffectedBeyondCap: beyondCap };
}

/* -------------------------------------------------------------------------- */
/* The stop condition                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Does this decision have a justification that survives the retraction?
 *
 * A justification survives when every one of its IN-list premises is still supported
 * and none of its OUT-list premises has become true. That is exactly the
 * well-foundedness condition from `labeller.ts`, evaluated against the post-retraction
 * world rather than the current one.
 */
function hasIndependentSupport(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
  retracted: ReadonlySet<PremiseId>,
): boolean {
  for (const justification of justificationsOf(state, decisionId)) {
    const namedRetracted = justification.inList.some((premiseId) => retracted.has(premiseId));
    if (namedRetracted) continue;

    const inListHolds = justification.inList.every((premiseId) => {
      if (retracted.has(premiseId)) return false;
      const labelled = labels.get(premiseId);
      /* An unlabelled premise is an assumption: no justification, presumed true. */
      return labelled === undefined ? true : labelled.label === "IN";
    });
    if (!inListHolds) continue;

    const outListClear = justification.outList.every((premiseId) => {
      const labelled = labels.get(premiseId);
      return labelled === undefined ? true : labelled.label !== "IN";
    });
    if (!outListClear) continue;

    return true;
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Graph access                                                               */
/* -------------------------------------------------------------------------- */

function decisionIdsOf(state: GraphState): readonly DecisionId[] {
  return [...state.decisions.keys()];
}

function justificationsOf(state: GraphState, decisionId: DecisionId): readonly Justification[] {
  const out: Justification[] = [];
  for (const justification of state.justifications.values()) {
    if (justification.consequent === decisionId) out.push(justification);
  }
  return out;
}

/** Justifications of a decision that name at least one of `premises`. */
function justificationsNaming(
  state: GraphState,
  decisionId: DecisionId,
  premises: ReadonlySet<PremiseId>,
): readonly Justification[] {
  return justificationsOf(state, decisionId).filter(
    (justification) =>
      justification.inList.some((premiseId) => premises.has(premiseId)) ||
      justification.outList.some((premiseId) => premises.has(premiseId)),
  );
}

/** The first retracted premise a decision depends on, in justification order. */
function firstRetractedPremiseOf(
  state: GraphState,
  decisionId: DecisionId,
  retracted: ReadonlySet<PremiseId>,
): PremiseId | null {
  for (const justification of justificationsOf(state, decisionId)) {
    for (const premiseId of justification.inList) {
      if (retracted.has(premiseId)) return premiseId;
    }
    for (const premiseId of justification.outList) {
      if (retracted.has(premiseId)) return premiseId;
    }
  }
  return null;
}

/**
 * The premises a decision's own justification rests on — they lose their support
 * when the decision goes.
 *
 * A justification's `consequent` is the decision it supports and its
 * `inList` / `outList` are the premises it rests on. So when the decision is
 * retracted, the premises IT rests on lose their support too, and anything
 * resting on THEM is next in line.
 */
function conclusionsOf(state: GraphState, decisionId: DecisionId): readonly PremiseId[] {
  const out: PremiseId[] = [];
  const seen = new Set<PremiseId>();
  for (const justification of state.justifications.values()) {
    if (justification.consequent !== decisionId) continue;
    for (const premiseId of [...justification.inList, ...justification.outList]) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);
      out.push(premiseId);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The cascade as a sentence a user can act on.
 *
 * Leads with the count that matters — decisions that changed — and reports stops and
 * truncation explicitly, because "we checked four and three were fine" is a different
 * message from "we checked one".
 */
export function describeCascade(state: GraphState, result: CascadeResult): string {
  if (result.steps.length === 0) {
    return "Nothing else depended on it. No other decision changed.";
  }

  const parts: string[] = [];

  if (result.flipped.length > 0) {
    parts.push(
      `${result.flipped.length} decision${result.flipped.length === 1 ? "" : "s"} became unsound: ${result.flipped.join(", ")}.`,
    );
  }

  if (result.survivors.length > 0) {
    parts.push(
      `${result.survivors.length} had independent support and ${result.survivors.length === 1 ? "stays" : "stay"} as ${result.survivors.length === 1 ? "it is" : "they are"}: ${result.survivors.join(", ")}.`,
    );
  }

  if (result.truncated) {
    parts.push(
      `Propagation stopped at depth ${MAX_CASCADE_DEPTH} with ${result.potentiallyAffectedBeyondCap} decision(s) not examined. There may be more downstream than this shows.`,
    );
  }

  return parts.join(" ");
}

/** The ordered walk, for the cascade view: `from → to (depth d) — reason`. */
export function cascadeLines(state: GraphState, result: CascadeResult): readonly string[] {
  return result.steps.map((step) => {
    const fromName = nameOf(state, step.from);
    const toName = nameOf(state, step.to);
    const marker = step.stoppedAtIndependentSupport ? "STOPS" : `becomes ${step.became}`;
    return `${"  ".repeat(step.depth)}${fromName} → ${toName} — ${marker}. ${step.reason}`;
  });
}

function nameOf(state: GraphState, nodeId: DecisionId | PremiseId): string {
  const decision = state.decisions.get(nodeId as DecisionId);
  if (decision !== undefined) return `${decision.id} "${decision.value}"`;

  const premise = state.premises.get(nodeId as PremiseId);
  if (premise !== undefined) return `${premise.id} "${premise.text}"`;

  return nodeId;
}

/** Depth actually reached — used by Phase 7 to report whether the cap ever binds. */
export function deepestStep(result: CascadeResult): number {
  return result.steps.reduce((max, step) => (step.depth > max ? step.depth : max), 0);
}
