/**
 * Phase 0 — the app boots, records, and survives a reload.
 *
 * Plan: plan/phase-0-foundation.md §0.10 acceptance criteria
 *   "The app boots with an empty log, renders an empty state, and survives a
 *    reload."
 *
 * The substrate test (tests/unit/substrate/round-trip.test.ts) proves the LOG
 * round-trips. This proves the APP does: the store reads the log back out of
 * localStorage and rebuilds the state by folding it, which is the path a
 * browser reload actually takes.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { nowISO } from "@/lib/format";
import { useWhyLog } from "@/store/whylog";
import { emptyLog } from "@/substrate/event-log";
import { emptyState } from "@/substrate/graph-state";
import { STORAGE_KEY } from "@/substrate/schema";
import type { Actor, ISODateString } from "@/types/common";

const HUMAN: Actor = { kind: "human" };

/** Put the store back the way a fresh page load would find it. */
function simulateReload(): void {
  useWhyLog.setState({
    log: emptyLog(),
    state: emptyState(useWhyLog.getState().engineId, nowISO() as ISODateString),
    status: "booting",
    pristine: true,
    notices: [],
    verification: null,
  });
  useWhyLog.getState().boot();
}

describe("Phase 0 · the app boots and survives a reload", () => {
  beforeEach(() => {
    localStorage.clear();
    simulateReload();
  });

  it("boots empty with nothing in storage", () => {
    const state = useWhyLog.getState();
    expect(state.status).toBe("empty");
    expect(state.pristine).toBe(true);
    expect(state.log.events.length).toBe(0);
    expect(state.state.decisions.size).toBe(0);
  });

  it("records a decision, persists it, and reads it back after a reload", () => {
    const before = useWhyLog.getState();
    expect(before.status).toBe("empty");

    const result = before.record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId: "T-0001" as never,
          rawChars: 64,
          engine: before.engineId,
        },
        actor: HUMAN,
        reason: "pasted a transcript",
      },
      { reason: "pasted a transcript" },
    );
    expect(result.ok).toBe(true);

    const recorded = useWhyLog.getState();
    expect(recorded.log.events.length).toBe(1);
    expect(recorded.status).toBe("loaded");

    // The log is on disk, not just in memory.
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    simulateReload();

    const after = useWhyLog.getState();
    expect(after.status).toBe("loaded");
    expect(after.log.events.length).toBe(1);
    expect(after.log.headHash).toBe(recorded.log.headHash);
    expect(after.state.events.length).toBe(1);
  });

  it("boots read-only and reports the damage when the chain is broken", () => {
    const store = useWhyLog.getState();
    store.record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId: "T-0001" as never,
          rawChars: 64,
          engine: store.engineId,
        },
        actor: HUMAN,
        reason: "pasted a transcript",
      },
      { reason: "pasted a transcript" },
    );

    // Corrupt the stored log the way a silent edit would: change an event's
    // payload without touching its hash.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as {
      events: { payload: Record<string, unknown> }[];
    };
    const first = parsed.events[0];
    expect(first).toBeDefined();
    if (first) first.payload["rawChars"] = 999999;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));

    simulateReload();

    const after = useWhyLog.getState();
    expect(after.status).toBe("degraded");
    expect(after.verification?.valid).toBe(false);
    expect(after.notices.some((n) => n.tone === "error")).toBe(true);

    // And the degraded log is read-only: recording is refused, not silently
    // extending a chain that no longer proves anything.
    const refused = after.record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId: "T-0002" as never,
          rawChars: 1,
          engine: after.engineId,
        },
        actor: HUMAN,
        reason: "another transcript",
      },
      { reason: "another transcript" },
    );
    expect(refused.ok).toBe(false);
  });
});
