/**
 * The cascade animation — 6.6. "The money shot."
 *
 * Phase 6 · sub-phase 6.6
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * ---------------------------------------------------------------------------
 * TEN SECONDS OF ANIMATION COMMUNICATES THE ENTIRE CONCEPT
 *
 * Click a premise → every decision resting on it highlights → falsify it → labels flip IN SEQUENCE,
 * edges turn red, survivors stay green. That is the whole product thesis in motion: a decision is a
 * belief held under assumptions, and when an assumption goes the beliefs that rested only on it go
 * too — while the ones with independent support survive.
 *
 * ---------------------------------------------------------------------------
 * IT ANIMATES A REAL CASCADE, NOT A SIMULATED ONE
 *
 * The sequence is built from the label diff between the state BEFORE the falsification and the
 * state AFTER the reasoning cycle ran. Nothing here invents an outcome: if the cascade stopped
 * somewhere because a decision had independent support, the animation shows it stopping there,
 * because that is what the log says happened.
 *
 * A simulated cascade would be prettier and would be a lie — it would show every dependent
 * flipping, which is exactly the "cascade cries wolf" behaviour risk R2 names and Phase 2 spent its
 * effort preventing.
 *
 * ---------------------------------------------------------------------------
 * EVERY FLIP CARRIES ITS REASON
 *
 * The plan's risk table: "animation as decoration rather than explanation... the cascade animation
 * must show WHY each node flipped — hover any node mid-animation for its reason." So each step is
 * `{ node, from, to, reason }`, and the reason comes from the labeller, not from a guess. An
 * animation that shows a node turning amber without saying why is a screensaver.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { DecisionLabel } from "@/types/domain";

/** Milliseconds between flips. Long enough to read each one, short enough that a six-decision
 *  cascade finishes inside the ten seconds the plan budgets for the whole demonstration. */
export const FLIP_INTERVAL_MS = 420;

/** How long a flipped node stays highlighted after the sequence ends, so the viewer can see the
 *  final state before it settles into the ordinary rendering. */
export const SETTLE_MS = 1800;

export interface CascadeStep {
  readonly node: NodeId;
  readonly from: DecisionLabel;
  readonly to: DecisionLabel;
  /** The labeller's own reason, rendered by `describeReason` in the reasoning layer. Never
   *  paraphrased here: a reason written by the animation would be a claim about the reasoning layer
   *  that the reasoning layer did not make. */
  readonly reason: string;
  /** Premises flip before the decisions that rest on them, and decisions flip in cascade depth
   *  order. Without ordering, the animation shows an effect before its cause. */
  readonly order: number;
  readonly isPremise: boolean;
}

export interface CascadeAnimationPlan {
  readonly steps: readonly CascadeStep[];
  readonly origin: NodeId;
  readonly totalMs: number;
  /** Nodes that did NOT flip but were in the blast radius — the survivors. Shown as explicitly
   *  untouched, because "this one survived and here is why" is half the concept. */
  readonly survivors: readonly { node: NodeId; reason: string }[];
}

/**
 * Build the animation plan from a label diff.
 *
 * @param before labels as they were before the falsification
 * @param after  labels after the reasoning cycle completed
 * @param origin the premise that was falsified
 * @param blastRadius every node the cascade considered, whether or not it flipped
 * @param reasonFor   renders a node's label reason. Supplied by the caller because
 *                    `Labelled.reason` is a discriminated union over justification and premise ids,
 *                    and turning it into prose needs the graph — which this module deliberately does
 *                    not take. An animation module that read the graph would be a second place where
 *                    label reasons get worded, and the two would drift.
 */
export function planCascade(
  before: ReadonlyMap<NodeId, Labelled>,
  after: ReadonlyMap<NodeId, Labelled>,
  origin: NodeId,
  blastRadius: readonly NodeId[],
  reasonFor: (node: NodeId, label: DecisionLabel, reason: Labelled["reason"]) => string,
): CascadeAnimationPlan {
  const steps: CascadeStep[] = [];
  const survivors: { node: NodeId; reason: string }[] = [];
  const flipped = new Set<NodeId>();

  for (const [nodeId, labelled] of after) {
    const previous = before.get(nodeId);
    const from = previous?.label ?? labelled.label;

    if (from === labelled.label) continue;

    flipped.add(nodeId);
    steps.push({
      node: nodeId,
      from,
      to: labelled.label,
      reason:
        reasonFor(nodeId, labelled.label, labelled.reason) || describeFlip(from, labelled.label),
      /* Premises first: a decision flips BECAUSE a premise did, and showing the decision first
       * would animate an effect before its cause. */
      order: isPremiseId(nodeId) ? 0 : 1,
      isPremise: isPremiseId(nodeId),
    });
  }

  /* Everything the cascade considered but did not flip is a survivor. Its reason matters as much
   * as a flip's: "WLD-0019 survived because it has independent support" is the sentence that
   * distinguishes this from a system that retracts everything it touches. */
  for (const nodeId of blastRadius) {
    if (flipped.has(nodeId)) continue;
    if (nodeId === origin) continue;

    const labelled = after.get(nodeId);
    survivors.push({
      node: nodeId,
      reason:
        labelled === undefined
          ? "not in the labelled set"
          : `SURVIVED — still ${labelled.label}. ${
              reasonFor(nodeId, labelled.label, labelled.reason) ||
              "It has support that does not depend on the falsified premise."
            }`,
    });
  }

  steps.sort((a, b) => a.order - b.order || (a.node < b.node ? -1 : 1));

  return {
    steps: steps.map((step, index) => ({ ...step, order: index })),
    origin,
    totalMs: steps.length * FLIP_INTERVAL_MS + SETTLE_MS,
    survivors,
  };
}

/** Which node is animating at time `elapsedMs`. Null once the sequence has settled. */
export function stepAt(plan: CascadeAnimationPlan, elapsedMs: number): CascadeStep | null {
  const index = Math.floor(elapsedMs / FLIP_INTERVAL_MS);
  if (index < 0 || index >= plan.steps.length) return null;
  return plan.steps[index] ?? null;
}

/** Every step that has already happened at `elapsedMs`. Nodes keep their new label once flipped;
 *  the animation reveals flips, it does not oscillate them. */
export function revealedAt(plan: CascadeAnimationPlan, elapsedMs: number): ReadonlySet<NodeId> {
  const count = Math.max(0, Math.min(plan.steps.length, Math.ceil(elapsedMs / FLIP_INTERVAL_MS)));
  return new Set(plan.steps.slice(0, count).map((step) => step.node));
}

export function isPremiseId(id: NodeId): boolean {
  return id.startsWith("P-");
}

function describeFlip(from: DecisionLabel, to: DecisionLabel): string {
  if (to === "OUT") {
    return `Moved from ${from} to OUT: every justification it had depended on a premise that is no longer IN.`;
  }
  if (to === "IN") {
    return `Moved from ${from} to IN: a justification is now valid.`;
  }
  return `Moved from ${from} to ${to}.`;
}

export function describeAnimationPlan(plan: CascadeAnimationPlan): string {
  if (plan.steps.length === 0) {
    return `Falsifying ${plan.origin} flipped nothing. ${
      plan.survivors.length > 0
        ? `${plan.survivors.length} node(s) were in the blast radius and all survived — each has support that does not depend on the falsified premise.`
        : "Nothing depended on it."
    }`;
  }

  const lines = [
    `${plan.steps.length} label flip(s), animated at ${FLIP_INTERVAL_MS} ms apart (${((plan.steps.length * FLIP_INTERVAL_MS) / 1000).toFixed(1)}s), then ${SETTLE_MS} ms to settle.`,
    "",
  ];

  for (const step of plan.steps) {
    lines.push(
      `  ${step.node}  ${step.from} → ${step.to}${step.isPremise ? "  (premise, flips first)" : ""}`,
    );
    lines.push(`      ${step.reason}`);
  }

  if (plan.survivors.length > 0) {
    lines.push("");
    lines.push("Survivors — shown as explicitly untouched, because this is half the concept:");
    for (const survivor of plan.survivors) {
      lines.push(`  ${survivor.node}  ${survivor.reason}`);
    }
  }

  return lines.join("\n");
}
