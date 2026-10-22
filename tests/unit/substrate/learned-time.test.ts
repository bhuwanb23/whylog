/**
 * The learned time is monotonic, and the valid time is not.
 *
 * The substrate validates that the LEARNED time never moves backwards (event-validation
 * rule 4) and rejects the whole batch if it does. The store is the thing that appends, so
 * the store is the thing that has to guarantee it.
 *
 * This file exists because that guarantee was missing, and because its absence was
 * INVISIBLE: the store used to drop each draft's own `at` and `occurredAt` and stamp
 * everything with the append time instead. That made the log monotonic by accident, and it
 * also destroyed the bi-temporality: every event claimed it happened at the moment it was
 * learned, so the time machine's two axes could never diverge.
 *
 * Restoring the valid time exposed the real defect underneath: several layers capture a
 * timestamp BEFORE the work they timestamp, and the work can cross a millisecond boundary.
 * The reasoning cycle is the clearest case - it takes `startedAt`, gate (b) then asks
 * retrieval for candidates, which rebuilds the index and records an `IndexRebuilt` event
 * stamped with a FRESH `nowISO()`, and only then does the cycle record its own drafts
 * stamped with the OLDER `startedAt`. The log then held an event learned a millisecond
 * before its predecessor, and the batch was rejected.
 *
 * The failure was a 1-in-10 flake, which is the worst kind: it would have failed
 * intermittently in CI and looked like a mystery.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useWhyLog } from "@/store/whylog";
import { type TranscriptId, asISO } from "@/types/common";

const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;

function importTranscript(at?: string) {
  return useWhyLog.getState().record(
    {
      type: "TranscriptImported",
      payload: {
        transcriptId: "T-0001" as TranscriptId,
        rawChars: 10,
        engine: ENGINE_ID,
      },
      reason: "imported",
      ...(at === undefined ? {} : { at: asISO(at) }),
    },
    { reason: "imported", actor: { kind: "human" } },
  );
}

describe("Learned time is monotonic; valid time is free", () => {
  beforeEach(() => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("an event stamped in the past is clamped forward, not rejected", () => {
    const first = importTranscript("2026-10-03T15:00:00.000Z");
    expect(first.ok).toBe(true);

    /* Now an event that claims to have been learned BEFORE the one already in the log.
     * The log is append-only: nothing in it can have been learned before its predecessor. */
    const second = importTranscript("2026-10-01T09:00:00.000Z");
    expect(second.ok).toBe(true);

    const events = useWhyLog.getState().log.events;
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.at >= events[i - 1]!.at).toBe(true);
    }
  });

  it("the valid time is NOT clamped: a decision can be older than the record of it", () => {
    const imported = importTranscript("2026-10-03T15:00:00.000Z");
    expect(imported.ok).toBe(true);

    const event = useWhyLog.getState().log.events[0];
    expect(event).toBeDefined();

    /* The valid time is the whole point of the substrate: a decision made on the 3rd and
     * learned today. The learned time and the valid time are DIFFERENT clocks, and only
     * the learned one is constrained to move forwards. */
    const withValid = useWhyLog.getState().record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId: "T-0002" as TranscriptId,
          rawChars: 10,
          engine: ENGINE_ID,
          occurredAt: asISO("2026-10-03T15:00:00.000Z"),
        },
        reason: "imported an old transcript today",
        occurredAt: asISO("2026-10-03T15:00:00.000Z"),
      },
      { reason: "imported an old transcript today", actor: { kind: "human" } },
    );
    expect(withValid.ok).toBe(true);

    const last = useWhyLog.getState().log.events.at(-1);
    expect(last?.occurredAt).toBe("2026-10-03T15:00:00.000Z");
    expect(last?.at).not.toBe("2026-10-03T15:00:00.000Z");
  });
});
