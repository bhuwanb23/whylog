/**
 * Gate (c) — Doyle's SL-justification validity, and the non-monotonic OUT-list.
 *
 * This is the mechanism the project exists for. A justification is valid iff every IN-list node is
 * IN **and** no OUT-list node is IN. A non-empty OUT-list is what makes it non-monotonic: the
 * decision can be invalidated by the WORLD arriving, not only by somebody contradicting themselves.
 *
 * Also a regression test for `labels.get(justification.id)`: a justification is not a node — the
 * graph is bipartite over decisions and premises (I2) — so that lookup was always undefined and the
 * filter skipped every justification. Audit found nothing and nogoods blocked nothing.
 */
import { describe, expect, it } from "vitest";
import { label, validityOf, type NodeId } from "@/reasoning/labeller";
import { isDerivedPremise } from "@/extraction/review";
import { decisionId, premiseId, resetClock } from "../../helpers/events";
import { sqliteGraph } from "../../helpers/graph";

describe("the graph is bipartite: justifications are edges, not nodes", () => {
  it("labels only decisions and premises", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);

    for (const nodeId of labels.keys()) {
      const isDecision = g.state.decisions.has(nodeId as never);
      const isPremise = g.state.premises.has(nodeId as never);
      expect(isDecision || isPremise).toBe(true);
    }

    /* No justification id is ever a key — which is precisely why looking one up returned undefined
     * and silently disabled every filter that depended on it. */
    for (const justification of g.state.justifications.values()) {
      expect(labels.has(justification.id as unknown as NodeId)).toBe(false);
    }
  });

  it("labels every decision and every premise", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);
    for (const id of g.state.decisions.keys()) expect(labels.has(id)).toBe(true);
    for (const id of g.state.premises.keys()) expect(labels.has(id)).toBe(true);
  });
});

describe("validityOf evaluates Doyle's condition over the labels a justification DOES have", () => {
  it("holds while every IN-list premise is IN and no OUT-list premise is IN", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);
    const verdict = validityOf(g.state.justifications.get(g.justSqlite)!, labels);

    expect(verdict.valid).toBe(true);
  });

  it("fails, naming the IN-list clause, when a supporting premise dies", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);
    const justification = g.state.justifications.get(g.justSqlite)!;

    /* Simulate the falsification by re-labelling the premise the justification rests on. */
    const broken = new Map(labels);
    broken.set(g.singleUser, { label: "OUT", reason: { kind: "invalidated", at: g.events[0]!.at } });

    const verdict = validityOf(justification, broken);
    expect(verdict.valid).toBe(false);
    expect(verdict.failedClause).toBe("in-list");
    expect(verdict.failedNode).toBe(g.singleUser);
    expect(verdict.explanation.length).toBeGreaterThan(0);
  });

  it("fails, naming the OUT-list clause, when an excluded condition ARRIVES", () => {
    /* This is gate (c) proper: nobody contradicted the decision, the world moved. The OUT-list
     * clause is what makes that detectable, and the explanation reads completely differently from an
     * IN-list failure — which is why the verdict names the clause rather than just saying "invalid". */
    const g = sqliteGraph();
    const { labels } = label(g.state);
    const justification = g.state.justifications.get(g.justSqlite)!;
    expect(justification.outList).toEqual([g.concurrentWriters]);

    const arrived = new Map(labels);
    arrived.set(g.concurrentWriters, { label: "IN", reason: { kind: "asserted-premise" } });

    const verdict = validityOf(justification, arrived);
    expect(verdict.valid).toBe(false);
    expect(verdict.failedClause).toBe("out-list");
    expect(verdict.failedNode).toBe(g.concurrentWriters);
  });

  it("treats a premise missing from the graph as a failure, not as a pass", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);
    const justification = g.state.justifications.get(g.justSqlite)!;

    const emptied = new Map(labels);
    emptied.delete(g.singleUser);

    expect(validityOf(justification, emptied).valid).toBe(false);
  });

  it("reports a monotonic justification as valid even when unrelated premises die", () => {
    /* The survivor. Its justification rests on `scope` and excludes nothing, so falsifying
     * `single_user` cannot touch it — and a cascade that retracts it anyway is over-retraction, the
     * demo-killer that makes the graph look like it is deleting the user's history. */
    const g = sqliteGraph();
    const { labels } = label(g.state);
    const migration = g.state.justifications.get(g.justMigration)!;
    expect(migration.outList).toHaveLength(0);

    const broken = new Map(labels);
    broken.set(g.singleUser, { label: "OUT", reason: { kind: "invalidated", at: g.events[0]!.at } });
    broken.set(g.concurrentWriters, { label: "IN", reason: { kind: "asserted-premise" } });

    expect(validityOf(migration, broken).valid).toBe(true);
  });
});

describe("the fixture really is non-monotonic", () => {
  it("has at least one justification with a non-empty OUT-list", () => {
    const g = sqliteGraph();
    const nonMonotonic = [...g.state.justifications.values()].filter((j) => j.outList.length > 0);
    expect(nonMonotonic.length).toBeGreaterThan(0);
  });

  it("puts the DERIVED premise in the OUT-list and the quoted one in the IN-list", () => {
    const g = sqliteGraph();
    const justification = g.state.justifications.get(g.justSqlite)!;

    expect(justification.inList).toContain(g.singleUser);
    expect(justification.outList).toContain(g.concurrentWriters);

    const derived = g.state.premises.get(g.concurrentWriters)!;
    const quoted = g.state.premises.get(g.singleUser)!;
    expect(isDerivedPremise(derived.predicate, derived.text)).toBe(true);
    expect(isDerivedPremise(quoted.predicate, quoted.text)).toBe(false);
  });

  it("gives the two decisions that share p1 the same OUT-list, and the survivor a different one", () => {
    const g = sqliteGraph();
    const sqlite = g.state.justifications.get(g.justSqlite)!;
    const pooling = g.state.justifications.get(g.justPooling)!;
    const migration = g.state.justifications.get(g.justMigration)!;

    expect(sqlite.outList).toEqual(pooling.outList);
    expect(sqlite.inList).toEqual(pooling.inList);
    expect(migration.inList).not.toEqual(sqlite.inList);
  });
});

describe("an unknown id is not a node", () => {
  it("returns undefined rather than throwing for an id the graph never minted", () => {
    const g = sqliteGraph();
    const { labels } = label(g.state);
    expect(labels.get(decisionId(9999))).toBeUndefined();
    expect(labels.get(premiseId(9999))).toBeUndefined();
    resetClock();
  });
});
