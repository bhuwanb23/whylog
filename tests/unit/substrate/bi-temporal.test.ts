/**
 * Bi-temporality — the two clocks.
 *
 * VALID time is when it became true in the world; LEARNED time is when WhyLog found out. Reversing
 * them shows decisions before they were made. `byValidDesc` and `byValidAsc` are also regression
 * tests: both were constrained on a top-level `valid` field that no node has, so the canonical
 * timeline order did not typecheck against a `Decision` or a `Premise` at all.
 */
import { describe, expect, it } from "vitest";
import { byIdAsc, byValidAsc, byValidDesc, compare, formatInterval, isOpen, isValidAt } from "@/substrate/bi-temporal";
import { fold, materializeAsOf } from "@/substrate/materialize";
import { at, decisionId, LOCAL_ENGINE, nextAt, premiseId, resetClock, transcriptId } from "../../helpers/events";
import { buildGraph, sqliteGraph } from "../../helpers/graph";
import type { Decision, Premise } from "@/types/domain";
import type { ValidityWindow } from "@/types/common";

/** A validity window. `learned` is set to the same instant because these tests are about the VALID
 *  axis; the two clocks are exercised separately in the `materializeAsOf` block below. */
function window(valid: string, invalidFrom?: string): ValidityWindow {
  const validAt = valid as ValidityWindow["valid"];
  /* Two explicit returns rather than a conditional spread: the spread types the result as
   * `invalidFrom?: X | undefined`, which `exactOptionalPropertyTypes` refuses to put into a domain
   * type that declares a bare optional. Widening `ValidityWindow` to suit a test helper would be
   * changing the domain for the convenience of the thing that is supposed to check it. */
  if (invalidFrom === undefined) return { valid: validAt, learned: validAt };
    /* `ValidityWindow["invalidFrom"]` is `ISODateString | undefined` — an indexed access on an optional
   * property includes undefined — so the cast target has to be the non-nullable form. */
  return { valid: validAt, learned: validAt, invalidFrom: invalidFrom as NonNullable<ValidityWindow["invalidFrom"]> };
}

describe("isValidAt filters the WHOLE window, it is not a prefix fold", () => {
  it("is false before the fact became true", () => {
    expect(isValidAt(window("2026-03-01T00:00:00.000Z"), "2026-02-01T00:00:00.000Z" as never)).toBe(false);
  });

  it("is true inside the window", () => {
    expect(isValidAt(window("2026-03-01T00:00:00.000Z"), "2026-04-01T00:00:00.000Z" as never)).toBe(true);
  });

  it("is false from invalidFrom onwards — a closed window never reopens", () => {
    const w = window("2026-03-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    expect(isValidAt(w, "2026-04-01T00:00:00.000Z" as never)).toBe(true);
    expect(isValidAt(w, "2026-05-01T00:00:00.000Z" as never)).toBe(false);
    expect(isValidAt(w, "2026-06-01T00:00:00.000Z" as never)).toBe(false);
  });

  it("treats an open window as still current", () => {
    expect(isOpen(window("2026-03-01T00:00:00.000Z"))).toBe(true);
    expect(isOpen(window("2026-03-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("materializeAsOf folds LEARNED time as a prefix", () => {
  it("hides events the system had not yet learned", () => {
    resetClock();
    const g = sqliteGraph();
    const cutoff = g.events[3]!.at; // partway through the import

    const past = materializeAsOf(g.events, cutoff, { engine: LOCAL_ENGINE, now: nextAt() });
    const present = fold(g.events, { engine: LOCAL_ENGINE, now: nextAt() });

    expect(past.decisions.size).toBeLessThan(present.decisions.size);
    expect(past.events.length).toBeLessThanOrEqual(present.events.length);
  });

  it("reproduces the full graph when the cutoff is after everything", () => {
    resetClock();
    const g = sqliteGraph();
    const future = at(10_000_000);
    const asOf = materializeAsOf(g.events, future, { engine: LOCAL_ENGINE, now: nextAt() });
    expect(asOf.decisions.size).toBe(g.state.decisions.size);
  });

  it("never shows a decision before the event that proposed it", () => {
    resetClock();
    const g = sqliteGraph();
    const proposing = g.events.find((e) => e.type === "DecisionProposed")!;
    const justBefore = materializeAsOf(g.events, at(0), { engine: LOCAL_ENGINE, now: nextAt() });
    expect(justBefore.decisions.has(proposing.payload.decisionId as never)).toBe(false);
  });
});

describe("the comparators read temporal.valid — nodes have no top-level `valid`", () => {
  it("orders decisions newest-first by VALID time", () => {
    const g = sqliteGraph();
    const decisions = [...g.state.decisions.values()];
    const sorted = [...decisions].sort(compare<Decision>(byValidDesc, byIdAsc));

    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.temporal.valid >= sorted[i]!.temporal.valid).toBe(true);
    }
  });

  it("orders oldest-first with byValidAsc, the order an export narrates in", () => {
    const g = sqliteGraph();
    const sorted = [...g.state.decisions.values()].sort(compare<Decision>(byValidAsc, byIdAsc));
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.temporal.valid <= sorted[i]!.temporal.valid).toBe(true);
    }
  });

  it("breaks ties by id, so identical timestamps never render in run order", () => {
    const g = sqliteGraph();
    const premises = [...g.state.premises.values()];
    const a = [...premises].sort(compare<Premise>(byValidDesc, byIdAsc));
    const b = [...premises].reverse().sort(compare<Premise>(byValidDesc, byIdAsc));
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it("byIdAsc alone is a total order over premises", () => {
    const g = sqliteGraph();
    const sorted = [...g.state.premises.values()].sort(byIdAsc);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.id <= sorted[i]!.id).toBe(true);
    }
  });
});

describe("formatInterval renders a window a person can read", () => {
  it("shows an open window as still current", () => {
    const text = formatInterval(window("2026-03-01T00:00:00.000Z"));
    expect(text.length).toBeGreaterThan(0);
  });

  it("shows a closed window with both ends", () => {
    const open = formatInterval(window("2026-03-01T00:00:00.000Z"));
    const closed = formatInterval(window("2026-03-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"));
    expect(closed).not.toBe(open);
  });
});

describe("the graph builders agree with the fixtures they claim to build", () => {
  it("sqliteGraph holds three decisions, three premises and three justifications", () => {
    const g = sqliteGraph();
    expect(g.state.decisions.size).toBe(3);
    expect(g.state.premises.size).toBe(3);
    expect(g.state.justifications.size).toBe(3);
  });

  it("buildGraph on an empty draft list yields an empty graph rather than throwing", () => {
    resetClock();
    const g = buildGraph([]);
    expect(g.state.decisions.size).toBe(0);
    expect(g.state.premises.size).toBe(0);
  });
});
