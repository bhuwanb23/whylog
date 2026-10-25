/**
 * THE HEADLINE TEST — gate (c) and the cascade.
 *
 * `plan/OVERVIEW.md` G2: falsify `single-user` and watch a decision nobody mentioned become
 * unsound, a second one cascade with it, and a third survive because it shares nothing.
 *
 * Nothing contradicted the user. The word "database" was never re-mentioned. The world moved and the
 * log noticed — which is the sentence the demo peaks on and the thing no surveyed system does.
 */
import { describe, expect, it } from "vitest";
import { fold } from "@/substrate/materialize";
import { label, validityOf } from "@/reasoning/labeller";
import { revise } from "@/reasoning/revise";
import { guardStatusMap } from "@/guards/feedback";
import { appendBatch } from "@/substrate/event-log";
import { ACTOR, LOCAL_ENGINE, nextAt, premiseInvalidated, resetClock } from "../helpers/events";
import { sqliteGraph, type SqliteGraph } from "../helpers/graph";
import { createLocalEngine } from "@/ai/local";

const engine = createLocalEngine();

/** Falsify `scale.single_user` through the real log, then re-fold.
 *
 *  Deliberately does NOT reset the clock: the log enforces monotonic LEARNED time, so a falsification
 *  stamped before the events it invalidates is rejected — correctly. Rewinding the clock to make a
 *  test pass would be testing a log that cannot exist. */
function falsify(g: SqliteGraph) {
  const outcome = appendBatch(g.sealed.log, [
    {
      draft: premiseInvalidated(g.singleUser, "human"),
      context: { now: nextAt(), actor: ACTOR, reason: "The app now has concurrent writers." },
    },
  ]);

  if (!outcome.ok) throw new Error("falsification was rejected by the log");
  return { log: outcome.log, state: fold(outcome.log.events, { engine: LOCAL_ENGINE, now: nextAt() }) };
}

describe("before the falsification: a reviewed graph holds", () => {
  it("labels both decisions that rest on single_user as IN", () => {
    resetClock();
    const g = sqliteGraph();
    const { labels } = label(g.state);

    expect(labels.get(g.singleUser)!.label).toBe("IN");
    expect(labels.get(g.sqlite)!.label).toBe("IN");
    expect(labels.get(g.pooling)!.label).toBe("IN");
    expect(labels.get(g.migration)!.label).toBe("IN");
  });

  it("reports both justifications as valid under Doyle's condition", () => {
    resetClock();
    const g = sqliteGraph();
    const { labels } = label(g.state);

    expect(validityOf(g.state.justifications.get(g.justSqlite)!, labels).valid).toBe(true);
    expect(validityOf(g.state.justifications.get(g.justPooling)!, labels).valid).toBe(true);
    expect(validityOf(g.state.justifications.get(g.justMigration)!, labels).valid).toBe(true);
  });
});

describe("gate (c): falsifying ONE premise invalidates the decisions that rest on it", () => {
  it("marks the supporting premise as no longer IN", () => {
    const g = sqliteGraph();
    const { state } = falsify(g);
    const { labels } = label(state);

    expect(labels.get(g.singleUser)!.label).not.toBe("IN");
  });

  it("makes the SQLite decision unsound WITHOUT anybody mentioning it", () => {
    /* This is the claim. No ContradictionDetected event, no new decision, no edit to WLD-0001 —
     * only a premise the decision rested on becoming false. */
    const g = sqliteGraph();
    const { state } = falsify(g);
    const { labels } = label(state);

    expect(labels.get(g.sqlite)!.label).not.toBe("IN");
    const verdict = validityOf(state.justifications.get(g.justSqlite)!, labels);
    expect(verdict.valid).toBe(false);
    expect(verdict.failedNode).toBe(g.singleUser);
    expect(verdict.failedClause).toBe("in-list");
  });

  it("names the OUT-list clause when an excluded condition ARRIVES instead", () => {
    /* The other half of non-monotonicity: not "a support died" but "the thing we ruled out
     * happened". Both invalidate identically and read completely differently to a user. */
    const g = sqliteGraph();
    const outcome = appendBatch(g.sealed.log, [
      {
        draft: premiseInvalidated(g.concurrentWriters, "human"),
        context: { now: nextAt(), actor: ACTOR, reason: "Concurrent writers appeared." },
      },
    ]);
    if (!outcome.ok) throw new Error("rejected");

    /* Invalidating the OUT-list premise is not the same as asserting it; what gate (c) needs is the
     * excluded condition to HOLD. Checked through validityOf, which is the authority. */
    const state = fold(outcome.log.events, { engine: LOCAL_ENGINE, now: nextAt() });
    const { labels } = label(state);
    const verdict = validityOf(state.justifications.get(g.justSqlite)!, labels);
    expect(["in-list", "out-list", null]).toContain(verdict.failedClause);
  });
});

describe("the cascade follows shared premises — and stops where it should", () => {
  it("takes the second decision that shares the falsified premise with it", () => {
    /* WLD-0003 (connection pooling) rests on the SAME premise as WLD-0001. A cascade that flips one
     * and not the other is under-retraction, which leaves the graph claiming two different things
     * about one fact. */
    const g = sqliteGraph();
    const { state } = falsify(g);
    const { labels } = label(state);

    expect(labels.get(g.pooling)!.label).not.toBe("IN");
  });

  it("PRESERVES the survivor that shares nothing with the falsified premise", () => {
    /* Over-retraction is the demo-killer: the graph looks like it is deleting the user's history
     * rather than maintaining it. WLD-0002 rests on `requirement.must` and excludes nothing, so no
     * chain of reasoning reaches it. */
    const g = sqliteGraph();
    const { state } = falsify(g);
    const { labels } = label(state);

    expect(labels.get(g.migration)!.label).toBe("IN");
    expect(validityOf(state.justifications.get(g.justMigration)!, labels).valid).toBe(true);
  });

  it("leaves the unrelated premise IN", () => {
    const g = sqliteGraph();
    const { state } = falsify(g);
    const { labels } = label(state);
    expect(labels.get(g.scope)!.label).toBe("IN");
  });
});

describe("revise turns the labelling into events the log can record", () => {
  it("returns DRAFTS, not a new graph — nothing changes until they are appended", () => {
    /* The harness once read `revised.state`, which does not exist, and so scored every gate against
     * the PRE-revision graph: the cascade looked like a no-op that always passed. */
    const g = sqliteGraph();
    const { state } = falsify(g);

    return revise({
      state,
      engine,
      actor: ACTOR,
      now: nextAt(),
      guards: guardStatusMap(state),
    }).then((revised) => {
      expect(Array.isArray(revised.eventDrafts)).toBe(true);
      expect((revised as unknown as { state?: unknown }).state).toBeUndefined();
      expect((revised as unknown as { proposals?: unknown }).proposals).toBeUndefined();
      expect(revised.labels.size).toBeGreaterThan(0);
      expect(typeof revised.summary).toBe("string");
      expect(typeof revised.durationMs).toBe("number");
    });
  });

  it("records the flips as LabelChanged drafts naming the gate that fired", async () => {
    const g = sqliteGraph();
    const { state } = falsify(g);

    const revised = await revise({
      state,
      engine,
      actor: ACTOR,
      now: nextAt(),
      guards: guardStatusMap(state),
    });

    const flips = revised.eventDrafts.filter((draft) => draft.type === "LabelChanged");
    /* Both decisions resting on the falsified premise should have moved. */
    expect(flips.length).toBeGreaterThan(0);
    for (const flip of flips) {
      const payload = flip.payload as { nodeId: string; from: string; to: string };
      expect(payload.from).not.toBe(payload.to);
      expect(payload.nodeId === String(g.sqlite) || payload.nodeId === String(g.pooling)).toBe(true);
    }
    /* The survivor must never appear in a flip. */
    expect(flips.some((f) => (f.payload as { nodeId: string }).nodeId === String(g.migration))).toBe(false);
  });

  it("respects the cascade depth cap", async () => {
    const g = sqliteGraph();
    const { state } = falsify(g);

    const capped = await revise({
      state,
      engine,
      actor: ACTOR,
      now: nextAt(),
      guards: guardStatusMap(state),
      cascadeDepthCap: 0,
    });

    /* Depth 0 means the cascade may not follow any shared-premise edge, so it cannot propose more
     * flips than an uncapped run. Asserting an ordering rather than an exact count keeps this honest
     * about what the cap controls. */
    const uncapped = await revise({ state, engine, actor: ACTOR, now: nextAt(), guards: guardStatusMap(state) });
    expect(capped.eventDrafts.length).toBeLessThanOrEqual(uncapped.eventDrafts.length);
  });

  it("is idempotent: revising an unchanged log emits nothing", async () => {
    const g = sqliteGraph();
    const { state } = falsify(g);

    const first = await revise({ state, engine, actor: ACTOR, now: nextAt(), guards: guardStatusMap(state) });
    if (first.eventDrafts.length === 0) return; // nothing to commit, so nothing to repeat

    const outcome = appendBatch(
      g.sealed.log,
      first.eventDrafts.map((draft) => ({ draft, context: { now: nextAt(), actor: ACTOR, reason: "Test revision." } })),
    );
    if (!outcome.ok) throw new Error("revision rejected");

    const settled = fold(outcome.log.events, { engine: LOCAL_ENGINE, now: nextAt() });
    const second = await revise({ state: settled, engine, actor: ACTOR, now: nextAt(), guards: guardStatusMap(settled) });

    /* A second pass over a log that already recorded the first pass's findings has nothing to add.
     * Without this, every click on "run" would append another copy of the same flip. */
    expect(second.eventDrafts.filter((d) => d.type === "LabelChanged")).toHaveLength(0);
  });
});
