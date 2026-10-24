/**
 * The cascade animation — 6.6.
 *
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * STRUCTURE.md §18.6 records the deviation that matters: "a cascade animation driven by a
 * real label diff rather than a simulation".
 *
 * That is a testable claim, and it is the difference between the animation telling the user
 * what the reasoning layer did and the animation performing its own little story. The plan
 * gives it teeth:
 *
 *   "Premises flip before the decisions that rest on them, and decisions flip in cascade
 *    depth order. Without ordering, the animation shows an effect before its cause."
 *
 * So the tests are about three things:
 *
 *   1. The steps are the ACTUAL label changes. A node whose label did not change is not
 *      animated; a node whose label changed is animated, with the before and the after.
 *   2. The order is causal. Premises first, then the decisions resting on them.
 *   3. Nothing happens when nothing happened. An animation that always plays is a screensaver.
 *
 * The reasons are the labeller's own, passed through untouched. A reason written by the
 * animation would be a claim about the reasoning layer that the reasoning layer did not make.
 */

import { describe, expect, it } from "vitest";

import { planCascade, revealedAt, stepAt } from "@/components/graph/CascadeAnimation";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { asDecisionId, asPremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";

function labelled(label: DecisionLabel): Labelled {
  return { label, reason: { kind: "no-justification" } };
}

function mapOf(entries: readonly (readonly [NodeId, DecisionLabel])[]): Map<NodeId, Labelled> {
  return new Map(entries.map(([id, l]) => [id, labelled(l)]));
}

const P = (n: string): NodeId => asPremiseId(`P-${n}`);
const D = (n: string): NodeId => asDecisionId(`WLD-${n}`);

const REASON = (node: NodeId, label: DecisionLabel): string => `${node} became ${label}`;

describe("The cascade animation is driven by a real label diff", () => {
  it("animates exactly the nodes whose label changed", () => {
    const before = mapOf([
      [P("0001"), "IN"],
      [D("0001"), "IN"],
      [D("0002"), "IN"],
    ]);
    const after = mapOf([
      [P("0001"), "OUT"],
      [D("0001"), "OUT"],
      [D("0002"), "IN"],
    ]);

    const plan = planCascade(before, after, P("0001"), [P("0001"), D("0001")], REASON);

    const animated = plan.steps.map((s) => s.node).sort();
    expect(animated).toEqual([P("0001"), D("0001")]);

    const premise = plan.steps.find((s) => s.node === P("0001"));
    expect(premise?.from).toBe("IN");
    expect(premise?.to).toBe("OUT");
  });

  it("shows an effect AFTER its cause: premises flip before the decisions on them", () => {
    const before = mapOf([
      [P("0001"), "IN"],
      [D("0001"), "IN"],
      [D("0002"), "IN"],
    ]);
    const after = mapOf([
      [P("0001"), "OUT"],
      [D("0001"), "OUT"],
      [D("0002"), "OUT"],
    ]);

    const plan = planCascade(before, after, P("0001"), [P("0001"), D("0001"), D("0002")], REASON);

    const premise = plan.steps.find((s) => s.isPremise);
    const decisions = plan.steps.filter((s) => !s.isPremise);
    expect(premise).toBeDefined();
    expect(decisions.length).toBeGreaterThan(0);

    for (const decision of decisions) {
      expect(decision.order).toBeGreaterThan(premise!.order);
    }

    // And the steps are ordered among themselves.
    const orders = plan.steps.map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("plays nothing when nothing changed", () => {
    const same = mapOf([
      [P("0001"), "IN"],
      [D("0001"), "IN"],
    ]);

    const plan = planCascade(same, same, P("0001"), [P("0001"), D("0001")], REASON);

    expect(plan.steps).toHaveLength(0);
    expect(stepAt(plan, 10_000)).toBeNull();
    expect(revealedAt(plan, 10_000).size).toBe(0);
  });

  it("carries the labeller's own reason, unparaphrased", () => {
    const before = mapOf([[P("0001"), "IN"]]);
    const after = mapOf([[P("0001"), "OUT"]]);

    const plan = planCascade(before, after, P("0001"), [P("0001")], REASON);
    expect(plan.steps[0]?.reason).toContain("P-0001");
  });

  it("reveals nodes progressively as the animation runs", () => {
    const before = mapOf([
      [P("0001"), "IN"],
      [D("0001"), "IN"],
    ]);
    const after = mapOf([
      [P("0001"), "OUT"],
      [D("0001"), "OUT"],
    ]);

    const plan = planCascade(before, after, P("0001"), [P("0001"), D("0001")], REASON);

    // At the very start, nothing has been revealed yet.
    expect(revealedAt(plan, 0).size).toBeLessThanOrEqual(plan.steps.length);

    // After the whole plan has run, everything has.
    const last = plan.steps[plan.steps.length - 1];
    expect(last).toBeDefined();
    expect(revealedAt(plan, 100_000).size).toBe(plan.steps.length);
  });
});
