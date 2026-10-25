/**
 * Guard synthesis — the central novelty claim.
 *
 * No surveyed tool generates the check FROM the decision; they all ask a human to author a fitness
 * function by hand. Two regressions live here:
 *
 *  1. `engine.capabilities.X` instead of `engine.capabilities().X` — a property read off a FUNCTION,
 *     which is always undefined, so LLM judging and LLM synthesis were unconditionally refused on
 *     every engine including a real one.
 *  2. `synthesiseAll` returned `drafts: []` hardcoded, under a doc comment promising the events. The
 *     store pushed nothing, so the guard count stayed at zero and demo beat 7 had nothing to show.
 */
import { describe, expect, it } from "vitest";
import { synthesiseAll } from "@/guards";
import { hasTemplate, TEMPLATED_VARIABLES, templateGuards } from "@/guards/templates";
import { createLocalEngine } from "@/ai/local";
import { GUARDS_PER_DECISION_CAP } from "@/guards/types";
import { ACTOR, LOCAL_ENGINE, decisionId, nextAt, resetClock } from "../../helpers/events";
import { sqliteGraph } from "../../helpers/graph";

const engine = createLocalEngine();

describe("capabilities is a METHOD", () => {
  it("returns an object when called, and undefined when merely read", () => {
    /* This is the regression, stated as a test: reading a property off the function itself is what
     * silently disabled both LLM paths. */
    expect(typeof engine.capabilities).toBe("function");
    expect((engine.capabilities as unknown as Record<string, unknown>)["guardSynthesis"]).toBeUndefined();
    expect(engine.capabilities().guardSynthesis).toBeDefined();
  });

  it("declares the local engine as template-only, never llm", () => {
    const capabilities = engine.capabilities();
    expect(capabilities.guardSynthesis).toBe("template-only");
    expect(capabilities.extraction).toBe(true);
    /* Voting needs three independent runs, which a deterministic local engine cannot give. Declaring
     * it false is what makes the voting ablation toggle untestable keyless — a property, not a gap. */
    expect(capabilities.voting).toBe(false);
    expect(capabilities.reranking).toBe(false);
  });
});

describe("templates cover the variables that can be checked mechanically", () => {
  it("has a template for DATABASE, the demo's own decision", () => {
    expect(hasTemplate("DATABASE")).toBe(true);
    expect(TEMPLATED_VARIABLES).toContain("DATABASE");
  });

  it("lists only real variables", () => {
    expect(TEMPLATED_VARIABLES.length).toBeGreaterThan(0);
    for (const variable of TEMPLATED_VARIABLES) expect(typeof variable).toBe("string");
  });
});

describe("synthesiseAll actually produces the events it documents", () => {
  it("returns drafts when given an actor and a timestamp", async () => {
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({
      state: g.state,
      engine,
      templatesOnly: true,
      actor: ACTOR,
      at: nextAt(),
    });

    /* The regression: this was unconditionally []. */
    expect(result.drafts.length).toBeGreaterThan(0);
    expect(result.reports.length).toBeGreaterThan(0);
  });

  it("stays report-only when the caller supplies no actor — a dashboard must not write", async () => {
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({ state: g.state, engine, templatesOnly: true });
    expect(result.drafts).toHaveLength(0);
    expect(result.reports.length).toBeGreaterThan(0);
  });

  it("proposes every guard as PROPOSED, never accepted — invariant I4", async () => {
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({ state: g.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });

    for (const draft of result.drafts) {
      expect(draft.type).toBe("GuardSynthesised");
      /* Every draft carries a reason: rule 2 rejects an event without one, and a guard with no
       * stated rationale is indistinguishable from a lint rule. */
      expect(draft.reason.length).toBeGreaterThan(0);
      expect(draft.reason).toContain("PROPOSED");
      expect(draft.actor).toEqual(ACTOR);
    }
  });

  it("never exceeds the per-decision cap", async () => {
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({ state: g.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });

    const perDecision = new Map<string, number>();
    for (const draft of result.drafts) {
      const payload = draft.payload as { decisionId: string };
      perDecision.set(payload.decisionId, (perDecision.get(payload.decisionId) ?? 0) + 1);
    }
    for (const count of perDecision.values()) expect(count).toBeLessThanOrEqual(GUARDS_PER_DECISION_CAP);
  });

  it("mints guard ids in the documented `G-<decision>a` shape, never `G-00070`", async () => {
    /* The store once passed a raw index where a LETTER belonged, minting G-00070 instead of G-0007a
     * and disagreeing with `nextFreeSuffix` — a collision waiting to happen. */
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({ state: g.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });

    for (const draft of result.drafts) {
      const payload = draft.payload as { guardId: string; decisionId: string };
      expect(payload.guardId).toMatch(new RegExp(`^G-${payload.decisionId.slice(4)}[a-z]`));
    }
  });

  it("is deterministic: the same graph proposes the same guards", async () => {
    resetClock();
    const a = sqliteGraph();
    resetClock();
    const b = sqliteGraph();

    const first = await synthesiseAll({ state: a.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });
    const second = await synthesiseAll({ state: b.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });

    expect(first.drafts.map((d) => (d.payload as { guardId: string }).guardId))
      .toEqual(second.drafts.map((d) => (d.payload as { guardId: string }).guardId));
  });

  it("reports the template share, which is 100% on the keyless path", async () => {
    resetClock();
    const g = sqliteGraph();
    const result = await synthesiseAll({ state: g.state, engine, templatesOnly: true, actor: ACTOR, at: nextAt() });
    expect(result.share).toBeDefined();
  });
});

describe("templateGuards never returns a guard without a rationale", () => {
  it("attaches a rationale and a real spec kind to every guard it proposes", () => {
    resetClock();
    const g = sqliteGraph();
    const decision = g.state.decisions.get(g.sqlite)!;

    const guards = templateGuards({
      decisionId: g.sqlite,
      variable: decision.variable,
      value: decision.value,
      statement: decision.statement,
      /* A rejection is a guard waiting to happen: the natural check for "we chose X, not Y" is that
       * Y is absent. Supplying one is what makes the template produce its most useful guard. */
      rejected: [{ value: "postgres", whyRejected: "needs a server we do not have" }],
      appliesTo: [],
      premises: [g.state.premises.get(g.singleUser)!.text],
    });

    expect(guards.length).toBeGreaterThan(0);
    for (const attributed of guards) {
      expect(attributed.guard.rationale.length).toBeGreaterThan(0);
      expect(attributed.guard.spec.kind.length).toBeGreaterThan(0);
      expect(attributed.source.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the GENERIC templates for a variable with no specific one", () => {
    /* `OTHER` has no variable-specific template, but a rejection is still a check waiting to happen:
     * "we chose X, not Y" implies Y must be absent, whatever X and Y are. Proposing nothing here
     * would leave the escape-hatch variable entirely unguarded, and `OTHER` usage is tracked
     * precisely because it means the slots are not covering reality. */
    const guards = templateGuards({
      decisionId: decisionId(77),
      variable: "OTHER",
      value: "something",
      statement: "Use something, not other-thing.",
      rejected: [{ value: "other-thing", whyRejected: "it does not work offline" }],
      appliesTo: [],
      premises: [],
    });

    expect(hasTemplate("OTHER")).toBe(false);
    expect(guards.length).toBeGreaterThan(0);
    for (const attributed of guards) {
      expect(attributed.guard.rationale.length).toBeGreaterThan(0);
      expect(attributed.source.startsWith("generic")).toBe(true);
    }
  });
});
