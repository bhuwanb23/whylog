/**
 * The evidence contract — at most N searches, each recorded, refusal reachable.
 *
 * Regression test for `MAX_SEARCHES` being a module constant with no per-run override: the ablation
 * declared a `maxSearches` sweep that the code could not accept, so the sweep measured nothing. The
 * budget is now a constructor argument, CLAMPED to [1, MAX_SEARCHES] — a caller may spend less than
 * the contract allows but never more, and a zero budget would refuse every question before
 * searching, which measures nothing.
 */
import { describe, expect, it } from "vitest";
import { MAX_SEARCHES, SearchTrace, assessSufficiency, searchStep, stopReason } from "@/retrieval/evidence-contract";
import { decisionId } from "../../helpers/events";
import type { SearchStep } from "@/types/retrieval";

function step(why: string): SearchStep {
  return searchStep("a query", [], 0, 0, why);
}

describe("the ceiling is the contract", () => {
  it("is three searches", () => {
    expect(MAX_SEARCHES).toBe(3);
  });

  it("defaults to the ceiling", () => {
    const trace = new SearchTrace();
    expect(trace.maxSearches).toBe(MAX_SEARCHES);
  });
});

describe("the budget can be lowered, never raised", () => {
  it("honours a lower budget", () => {
    expect(new SearchTrace(1).maxSearches).toBe(1);
    expect(new SearchTrace(2).maxSearches).toBe(2);
  });

  it("clamps a budget above the ceiling back down to it", () => {
    /* The ceiling IS the contract. A caller that could raise it could make refusal unreachable, and
     * a system that can always look again never has to say it does not know. */
    expect(new SearchTrace(99).maxSearches).toBe(MAX_SEARCHES);
    expect(new SearchTrace(MAX_SEARCHES + 1).maxSearches).toBe(MAX_SEARCHES);
  });

  it("clamps a zero or negative budget up to one", () => {
    /* Zero would refuse every question before searching, which is not a measurement of anything. */
    expect(new SearchTrace(0).maxSearches).toBe(1);
    expect(new SearchTrace(-5).maxSearches).toBe(1);
  });

  it("truncates a fractional budget", () => {
    expect(new SearchTrace(2.9).maxSearches).toBe(2);
  });
});

describe("record() returns false when the budget is spent, rather than throwing", () => {
  it("accepts exactly `budget` searches and refuses the next", () => {
    const trace = new SearchTrace(2);
    expect(trace.record(step("the question"))).toBe(true);
    expect(trace.record(step("expansion by shared premise"))).toBe(true);
    expect(trace.record(step("premise questions"))).toBe(false);
    expect(trace.searchCount).toBe(2);
    expect(trace.isBoundedOut).toBe(true);
  });

  it("refuses the fourth search at the default ceiling", () => {
    const trace = new SearchTrace();
    expect(trace.record(step("one"))).toBe(true);
    expect(trace.record(step("two"))).toBe(true);
    expect(trace.record(step("three"))).toBe(true);
    expect(trace.record(step("four"))).toBe(false);
  });

  it("marks bounded-out explicitly, which is distinct from a search that returned nothing", () => {
    const trace = new SearchTrace(1);
    expect(trace.isBoundedOut).toBe(false);
    trace.markBoundedOut();
    expect(trace.isBoundedOut).toBe(true);
    expect(trace.searchCount).toBe(0);
  });
});

describe("the frozen trace reports the budget actually in force", () => {
  it("carries the lowered budget, not the module constant", () => {
    /* Without this the answer text said "2 of 3 searches used" on a run whose budget was 2, so an
     * ablated budget was invisible in the output and the sweep could not be read. */
    const trace = new SearchTrace(2);
    trace.record(step("the question"));
    const frozen = trace.freeze("sufficient");

    expect(frozen.maxSearches).toBe(2);
    expect(frozen.searches).toHaveLength(1);
    expect(frozen.sufficiencyAssessment).toBe("sufficient");
  });

  it("reports the ceiling when the budget was not lowered", () => {
    const trace = new SearchTrace();
    expect(trace.freeze("sufficient").maxSearches).toBe(MAX_SEARCHES);
  });
});

describe("citation resolution is the trace's own retrieved set", () => {
  it("remembers every id it saw, across searches, de-duplicated", () => {
    const trace = new SearchTrace();
    const a = decisionId(1);
    const b = decisionId(2);
    trace.note([a, b]);
    trace.note([b]);

    expect(trace.retrievedIds.size).toBe(2);
    expect(trace.retrievedIds.has(a)).toBe(true);
    expect(trace.retrievedIds.has(b)).toBe(true);
  });

  it("does not resolve an id it never retrieved — a citation must exist in the run", () => {
    const trace = new SearchTrace();
    trace.note([decisionId(1)]);
    expect(trace.retrievedIds.has(decisionId(999))).toBe(false);
  });
});

describe("assessSufficiency reads the trace, not the constant", () => {
  it("names the budget in force", () => {
    const trace = new SearchTrace(2);
    trace.record(step("the question"));
    const text = assessSufficiency("STOPPED_SUFFICIENT", trace, 0.9, 3);
    expect(text).toContain("of 2 searches");
    expect(text).not.toContain("of 3 searches");
  });

  it("names the ceiling when the budget was not lowered", () => {
    const trace = new SearchTrace();
    trace.record(step("the question"));
    expect(assessSufficiency("STOPPED_SUFFICIENT", trace, 0.9, 3)).toContain(`of ${MAX_SEARCHES} searches`);
  });
});

describe("stopReason classifies why the run ended, in a fixed precedence", () => {
  const anId = decisionId(1);

  it("1. reports an empty log before anything else", () => {
    expect(stopReason(new SearchTrace(), 0, 0.5, 0)).toBe("STOPPED_NO_LOG");
  });

  it("2. reports EMPTY when nothing was retrieved, even if the budget ran out", () => {
    /* Precedence matters: a run that searched and found NOTHING is a different failure from one that
     * found something thin and was cut off, and the two have different fixes. */
    const trace = new SearchTrace(1);
    trace.record(step("the question"));
    trace.markBoundedOut();
    expect(stopReason(trace, 0.2, 0.5, 10)).toBe("STOPPED_EMPTY");
  });

  it("3. reports SUFFICIENT once groundedness clears the floor", () => {
    const trace = new SearchTrace();
    trace.record(step("the question"));
    trace.note([anId]);
    expect(stopReason(trace, 0.95, 0.5, 10)).toBe("STOPPED_SUFFICIENT");
  });

  it("4. reports BOUNDED when the answer is thin AND the budget ran out", () => {
    const trace = new SearchTrace(1);
    trace.record(step("the question"));
    trace.note([anId]);
    trace.markBoundedOut();
    expect(stopReason(trace, 0.2, 0.5, 10)).toBe("STOPPED_BOUNDED");
  });

  it("4b. reports EMPTY when the answer is thin but the budget was NOT spent", () => {
    /* Thin-and-not-exhausted means the retrieval stopped early on its own, which is a different
     * defect from being cut off by the contract. */
    const trace = new SearchTrace(3);
    trace.record(step("the question"));
    trace.note([anId]);
    expect(stopReason(trace, 0.2, 0.5, 10)).toBe("STOPPED_EMPTY");
  });
});

