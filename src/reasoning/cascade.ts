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
import type { DecisionLabel } from "@/types/domain";
import type { CascadeResult, CascadeStep } from "@/types/reasoning";
import {
  type ReasoningIndex,
  decisionsRestingOn,
  indexGraph,
  justificationsFor,
  premisesNamedBy,
} from "./graph-index";
import type { Labelled, NodeId } from "./labeller";

/** Fallback when no cap is supplied. The store passes `settings.cascadeDepthCap`. */
export const MAX_CASCADE_DEPTH = 4;

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
  depthCap: number = MAX_CASCADE_DEPTH,
): CascadeResult {
  /* A cap of 0 would mean "do not propagate at all", which is a legitimate setting —
   * but a NEGATIVE cap would make every step truncated and report the whole graph as
   * unexamined. Clamped, not trusted. */
  const cap = Math.max(0, Math.floor(Number.isFinite(depthCap) ? depthCap : MAX_CASCADE_DEPTH));
  const steps: CascadeStep[] = [];
  const flipped: DecisionId[] = [];
  const survivors: DecisionId[] = [];
  const visited = new Set<NodeId>();
  let truncated = false;
  let beyondCap = 0;

  const retractedSet = new Set<PremiseId>(retractedPremises);
  const index = indexGraph(state);

  /* Seed: every decision resting on a retracted premise, via the shared-premise index.
   * This is the ONLY edge the cascade follows — never `related`, never topical
   * similarity. §2.7: "Cascade follows shared-premise edges only." */
  const seeds: DecisionId[] = [];
  for (const premiseId of retractedSet) {
    for (const decisionId of decisionsRestingOn(index, premiseId)) {
      if (!seeds.includes(decisionId)) seeds.push(decisionId);
    }
  }

  const propagate = (decisionId: DecisionId, from: DecisionId | PremiseId, depth: number): void => {
    if (visited.has(decisionId)) return;
    visited.add(decisionId);

    if (depth > cap) {
      truncated = true;
      beyondCap += 1;
      return;
    }

    const decision = state.decisions.get(decisionId);
    if (decision === undefined) return;

    const current: DecisionLabel = labels.get(decisionId)?.label ?? decision.label;

    /* ---- THE STOP CONDITION ---- */
    if (hasIndependentSupport(index, labels, decisionId, retractedSet)) {
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

    /* ---- the second hop ----
     * This decision was contributing support to the premises it names. Anything ELSE
     * resting on those premises is next in line — but only if this decision was their
     * last support, which `hasIndependentSupport` decides at the next level. Following
     * the shared premise is following a shared-premise edge; following `dependsOn` or
     * `related` here would be exactly the over-retraction §2.7 forbids. */
    for (const premiseId of premisesNamedBy(index, decisionId)) {
      for (const dependent of decisionsRestingOn(index, premiseId)) {
        if (visited.has(dependent)) continue;
        propagate(dependent, premiseId, depth + 1);
      }
    }
  };

  for (const seed of seeds) {
    /* `from` names the NODE the propagation came through. The first retracted premise
     * this seed rests on is the honest answer; a justification id is not a node. */
    const via = firstRetractedPremiseOf(index, seed, retractedSet);
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
  index: ReasoningIndex,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
  retracted: ReadonlySet<PremiseId>,
): boolean {
  for (const justification of justificationsFor(index, decisionId)) {
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

function firstRetractedPremiseOf(
  index: ReasoningIndex,
  decisionId: DecisionId,
  retracted: ReadonlySet<PremiseId>,
): PremiseId | null {
  for (const justification of justificationsFor(index, decisionId)) {
    for (const premiseId of justification.inList) {
      if (retracted.has(premiseId)) return premiseId;
    }
    for (const premiseId of justification.outList) {
      if (retracted.has(premiseId)) return premiseId;
    }
  }
  return null;
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
export function describeCascade(_state: GraphState, result: CascadeResult): string {
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
      `Propagation stopped at the depth cap with ${result.potentiallyAffectedBeyondCap} decision(s) not examined. There may be more downstream than this shows.`,
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

/** The cap in force, for the health panel — a truncated cascade is only interpretable
 *  next to the number that truncated it. */
export function describeCap(depthCap: number = MAX_CASCADE_DEPTH): string {
  return `cascade depth cap ${depthCap} (shared-premise edges only, never topical similarity)`;
}
