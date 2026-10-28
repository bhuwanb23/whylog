import { isDerivedPremise } from "@/extraction/review";
import {
  exclusionCount,
  exclusionsFor,
  hasExclusion,
  primaryExclusion,
} from "@/ontology/data/exclusions";
import { PREMISE_TYPE_META } from "@/ontology/data/premise-types";
import { DERIVED_PREMISE_MARKER, isDerivedPremiseText } from "@/reasoning/graph-index";
/**
 * OUT-list recovery — the mechanism the whole non-monotonic thesis rests on.
 *
 * A premise the transcript STATES goes in the IN-list. A condition INFERRED from it goes in the
 * OUT-list, and a non-empty OUT-list is what makes a justification non-monotonic, which is what
 * lets gate (c) fire when the world moves rather than only when somebody contradicts themselves.
 */
import { describe, expect, it } from "vitest";
import { DERIVED_MARKER, sqliteGraph } from "../../helpers/graph";

describe("the derived-premise marker", () => {
  it("is the same string in both places that read it", () => {
    /* Two copies of a marker that must agree is how a premise ends up in the IN-list that the
     * reasoner believes is in the OUT-list. */
    expect(DERIVED_MARKER).toBe(DERIVED_PREMISE_MARKER);
    expect(isDerivedPremiseText(DERIVED_PREMISE_MARKER)).toBe(true);
  });

  it("recognises a derived premise by its text, not by its predicate", () => {
    /* `hasExclusion(predicate)` is deliberately NOT part of the test: a SUPPORTING premise can also
     * have an exclusion rule, since that is how its OUT-list entry is derived. Only the marker can
     * distinguish the two. */
    expect(
      isDerivedPremise(
        "scale.concurrent_writers",
        `more than one writer ${DERIVED_MARKER} "single user"`,
      ),
    ).toBe(true);
    expect(isDerivedPremise("scale.concurrent_writers", "more than one writer at a time")).toBe(
      false,
    );
    expect(isDerivedPremise("scale.single_user", "the app has a single user")).toBe(false);
  });
});

describe("the exclusion table", () => {
  it("has rules, and every breaks-predicate is a real predicate in the type table", () => {
    expect(exclusionCount()).toBeGreaterThan(0);

    /* `PremisePredicate.name` is the LOCAL part; a full predicate is `namespace.name`, and the
     * namespace is part of a premise's identity rather than decoration — rung 1 of the ladder
     * matches on it. */
    const declared = new Set<string>();
    for (const meta of Object.values(PREMISE_TYPE_META)) {
      for (const predicate of meta.predicates) declared.add(`${meta.namespace}.${predicate.name}`);
    }
    expect(declared.size).toBeGreaterThan(20);

    for (const rule of exclusionsFor("scale.single_user")) {
      /* An OUT-list node whose predicate is not in the type table cannot be resolved by rung 1 of
       * the identity ladder, so it would create a fresh node on every import — the exact failure the
       * closed vocabulary exists to prevent. */
      expect(declared.has(rule.breaksPredicate)).toBe(true);
    }
  });

  it("maps single_user to the concurrent-writers condition that would break it", () => {
    expect(hasExclusion("scale.single_user")).toBe(true);
    const rule = primaryExclusion("scale.single_user");
    expect(rule).not.toBeNull();
    expect(rule?.breaksPredicate).toBe("scale.concurrent_writers");
    expect(rule?.text.length).toBeGreaterThan(0);
  });

  it("returns null for a predicate with no rule, so the linker falls back to mechanical negation", () => {
    expect(primaryExclusion("not.a.real.predicate")).toBeNull();
    expect(hasExclusion("not.a.real.predicate")).toBe(false);
  });
});

describe("a graph built with an OUT-list is non-monotonic", () => {
  it("produces justifications with non-empty OUT-lists", () => {
    const g = sqliteGraph();
    const withOut = [...g.state.justifications.values()].filter((j) => j.outList.length > 0);
    expect(withOut.length).toBeGreaterThan(0);
  });

  it("keeps the survivor's justification monotonic, so it cannot be invalidated by p1", () => {
    const g = sqliteGraph();
    const migration = g.state.justifications.get(g.justMigration)!;
    expect(migration.outList).toHaveLength(0);
    expect(migration.inList).toEqual([g.scope]);
    expect(migration.inList).not.toContain(g.singleUser);
  });

  it("stores the derived premise as a real node, not as a field on its source", () => {
    const g = sqliteGraph();
    const derived = g.state.premises.get(g.concurrentWriters);
    expect(derived).toBeDefined();
    expect(isDerivedPremise(derived!.predicate, derived!.text)).toBe(true);
  });
});
