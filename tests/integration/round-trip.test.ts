/**
 * Gate G5 — export then import reproduces the same log.
 *
 * Portability is what makes the log a record rather than a cache: a user must be able to leave,
 * clear the browser, come back, and get the SAME graph with the SAME head hash. `canonicalJson`
 * sorting object keys is what makes that reproducible rather than dependent on insertion order.
 */
import { describe, expect, it } from "vitest";
import { exportLog, importLog, describeRejection } from "@/substrate/portability";
import { GENESIS_HASH, headHash, verifyChain } from "@/substrate/hash-chain";
import { fold } from "@/substrate/materialize";
import { LOCAL_ENGINE, nextAt, resetClock } from "../helpers/events";
import type { EventId } from "@/types/common";
import { sqliteGraph } from "../helpers/graph";

function statsOf(g: ReturnType<typeof sqliteGraph>) {
  return {
    events: g.events.length,
    decisions: g.state.decisions.size,
    premises: g.state.premises.size,
    guards: g.state.guards.size,
    transcripts: g.state.transcripts.size,
  };
}

describe("export produces a portable, self-describing file", () => {
  it("succeeds on a real log and carries the head hash", () => {
    resetClock();
    const g = sqliteGraph();
    const result = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toHaveLength(g.events.length);
  });

  it("serialises to JSON a stranger could read", () => {
    resetClock();
    const g = sqliteGraph();
    const result = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());
    if (!result.ok) throw new Error(result.error);

    const raw = JSON.stringify(result.value, null, 2);
    expect(raw).toContain("WLD-0001");
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe("import reproduces the SAME chain", () => {
  it("yields an identical head hash", () => {
    resetClock();
    const g = sqliteGraph();
    const exported = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());
    if (!exported.ok) throw new Error(exported.error);

    const imported = importLog(JSON.stringify(exported.value), { existingIds: null, existingHeadHash: GENESIS_HASH });

    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      throw new Error(describeRejection(imported.rejection));
    }

    expect(imported.outcome.headHashAfter).toBe(g.sealed.log.headHash);
    expect(imported.outcome.newEvents).toHaveLength(g.events.length);
    expect(imported.outcome.duplicates).toBe(0);
  });

  it("re-folds to an identical graph", () => {
    resetClock();
    const g = sqliteGraph();
    const exported = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());
    if (!exported.ok) throw new Error(exported.error);

    const imported = importLog(JSON.stringify(exported.value), { existingIds: null, existingHeadHash: GENESIS_HASH });
    if (!imported.ok) throw new Error(describeRejection(imported.rejection));

    const before = fold(g.events, { engine: LOCAL_ENGINE, now: nextAt() });
    const after = fold(imported.outcome.newEvents, { engine: LOCAL_ENGINE, now: nextAt() });

    expect(after.decisions.size).toBe(before.decisions.size);
    expect(after.premises.size).toBe(before.premises.size);
    expect(after.justifications.size).toBe(before.justifications.size);
    expect(headHash(imported.outcome.newEvents)).toBe(headHash(g.events));
  });

  it("is idempotent: importing into a log that already has the events duplicates nothing", () => {
    resetClock();
    const g = sqliteGraph();
    const exported = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());
    if (!exported.ok) throw new Error(exported.error);

    const existingIds = new Set(g.events.map((event) => event.id)) as ReadonlySet<EventId>;
    const imported = importLog(JSON.stringify(exported.value), {
      existingIds,
      existingHeadHash: g.sealed.log.headHash,
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.outcome.newEvents).toHaveLength(0);
    expect(imported.outcome.duplicates).toBe(g.events.length);
  });
});

describe("import REFUSES a damaged file rather than repairing it", () => {
  it("rejects a log whose chain does not verify", () => {
    resetClock();
    const g = sqliteGraph();
    const exported = exportLog(g.events, g.sealed.log.headHash, statsOf(g), LOCAL_ENGINE, nextAt());
    if (!exported.ok) throw new Error(exported.error);

    /* Tamper with a middle event's payload. The chain recomputes, so the link after it disagrees. */
    const tampered = JSON.parse(JSON.stringify(exported.value)) as typeof exported.value;
    const victim = tampered.events[1] as unknown as Record<string, unknown>;
    victim["payload"] = { ...(victim["payload"] as object), value: "postgres" };

    const imported = importLog(JSON.stringify(tampered), { existingIds: null, existingHeadHash: GENESIS_HASH });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(describeRejection(imported.rejection).length).toBeGreaterThan(0);
  });

  it("rejects malformed JSON with a reason a person can act on", () => {
    const imported = importLog("{ not json", { existingIds: null, existingHeadHash: GENESIS_HASH });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(describeRejection(imported.rejection)).toBeTruthy();
  });

  it("verifies the chain it was given before trusting it", () => {
    resetClock();
    const g = sqliteGraph();
    expect(verifyChain(g.events).valid).toBe(true);
    expect(verifyChain(g.events).headHash).toBe(g.sealed.log.headHash);
  });
});
