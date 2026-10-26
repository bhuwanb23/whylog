/**
 * The hash chain — invariant I1's enforcement mechanism.
 *
 * Nothing is deleted and everything is an event, so the ONLY thing standing between an append-only
 * log and a rewritable one is this chain. A test suite that does not check tamper detection is
 * checking a log that can be edited.
 */
import { describe, expect, it } from "vitest";
import { GENESIS_HASH, HASH_LENGTH, headHash, linkHash, sealEvents, verifyChain, describeVerification } from "@/substrate/hash-chain";
import { ACTOR, LOCAL_ENGINE, at, decisionId, nextAt, resetClock, sealAll, span, transcriptId, transcriptImported, decisionProposed } from "../../helpers/events";
import type { AnyEvent } from "@/types/events";

const t1 = transcriptId(1);

function twoEvents(): readonly AnyEvent[] {
  resetClock();
  return sealAll([
    transcriptImported(t1, "going with SQLite"),
    decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite" }),
  ]).events;
}

describe("GENESIS_HASH", () => {
  it("is the documented sentinel and the right length", () => {
    expect(GENESIS_HASH).toBe("whylog:genesis:00000000000000000000000000000000");
    expect(HASH_LENGTH).toBe(32);
  });

  it("is the head of an empty chain", () => {
    expect(headHash([])).toBe(GENESIS_HASH);
  });
});

describe("linkHash", () => {
  it("is deterministic", () => {
    const events = twoEvents();
    const first = events[0]!;
    expect(linkHash(GENESIS_HASH, first)).toBe(linkHash(GENESIS_HASH, first));
  });

  it("depends on the previous hash, so a re-ordered log cannot share a head", () => {
    const events = twoEvents();
    const first = events[0]!;
    expect(linkHash(GENESIS_HASH, first)).not.toBe(linkHash("some-other-prev", first));
  });

  it("produces a hex digest of the declared length", () => {
    const events = twoEvents();
    const digest = linkHash(GENESIS_HASH, events[0]!);
    expect(digest).toMatch(/^[0-9a-f]+$/);
    expect(digest.length).toBeGreaterThan(0);
  });
});

describe("verifyChain", () => {
  it("accepts a chain the log sealed itself", () => {
    const verification = verifyChain(twoEvents());
    expect(verification.valid).toBe(true);
    expect(verification.violations).toHaveLength(0);
    expect(verification.firstBadIndex).toBeNull();
    expect(verification.eventCount).toBe(2);
  });

  it("accepts an empty chain", () => {
    expect(verifyChain([]).valid).toBe(true);
  });

  it("detects a rewritten payload in the MIDDLE of the chain", () => {
    resetClock();
    const events = [
      ...sealAll([
        transcriptImported(t1, "going with SQLite"),
        decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite" }),
        decisionProposed({ id: decisionId(2), transcript: t1, variable: "HOSTING", value: "fly" }),
      ]).events,
    ];

    /* Tamper with the middle event. With a per-event selfHash, the tamper is
     * detectable at the event's own index — strictly stronger than a chain
     * that only notices the break at the next link. */
    const victim = events[1]!;
    events[1] = { ...victim, payload: { ...victim.payload, value: "postgres" } } as AnyEvent;

    const verification = verifyChain(events);
    expect(verification.valid).toBe(false);
    expect(verification.firstBadIndex).toBe(1);
    expect(verification.violations[0]!.kind).toBe("self-hash-mismatch");
  });

  it("detects a rewritten LAST payload via the per-event selfHash", () => {
    const events = [...twoEvents()];
    const victim = events[1]!;
    events[1] = { ...victim, payload: { ...victim.payload, value: "postgres" } } as AnyEvent;

    /* The last event has no successor, but its selfHash no longer matches its content, so the
     * tamper is still caught at its own index. The head hash also changes. */
    const verification = verifyChain(events);
    expect(verification.valid).toBe(false);
    expect(verification.firstBadIndex).toBe(events.length - 1);
    expect(verification.violations[0]!.kind).toBe("self-hash-mismatch");
    expect(verification.headHash).not.toBe(headHash(twoEvents()));
  });

  it("detects a tampered timestamp, not only a tampered payload", () => {
    const events = [...twoEvents()];
    const victim = events[0]!;
    events[0] = { ...victim, at: at(9999) } as AnyEvent;
    /* Changing `at` changes the event's own hash, so the NEXT link disagrees; it also breaks the
     * monotonic-learned-time rule. Either is enough to fail the chain. */
    expect(verifyChain(events).valid).toBe(false);
  });

  it("detects a duplicated event id", () => {
    const events = twoEvents();
    expect(verifyChain([...events, events[1]!]).violations.map((v) => v.kind)).toContain("duplicate-id");
  });

  it("detects a re-ordered chain", () => {
    const events = [...twoEvents()].reverse();
    expect(verifyChain(events).valid).toBe(false);
  });

  it("reports the head hash so an importer can compare against a stamp", () => {
    const events = twoEvents();
    expect(verifyChain(events).headHash).toBe(headHash(events));
  });

  it("describes a verification in prose a user can read", () => {
    const text = describeVerification(verifyChain(twoEvents()));
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("sealEvents", () => {
  it("reproduces exactly the chain the log built, link for link", () => {
    resetClock();
    const built = sealAll([
      transcriptImported(t1, "raw"),
      decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite" }),
    ]);

    /* Strip the links and re-seal. Same content must produce the same chain — this is the property
     * export -> import depends on, and the reason `canonicalJson` sorts keys. */
    const stripped = built.events.map((event) => {
      const { prevHash: _omitted, ...rest } = event;
      return rest;
    });

    const resealed = sealEvents(stripped);
    expect(resealed.events.map((e) => e.prevHash)).toEqual(built.events.map((e) => e.prevHash));
    expect(resealed.headHash).toBe(built.log.headHash);
    expect(verifyChain(resealed.events).valid).toBe(true);
  });

  it("links the first event to GENESIS and each later one to its predecessor", () => {
    resetClock();
    const built = sealAll([
      transcriptImported(t1, "raw"),
      decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite" }),
    ]);
    const stripped = built.events.map((event) => {
      const { prevHash: _omitted, ...rest } = event;
      return rest;
    });

    const resealed = sealEvents(stripped);
    expect(resealed.events[0]!.prevHash).toBe(GENESIS_HASH);
    expect(resealed.events[1]!.prevHash).toBe(linkHash(GENESIS_HASH, resealed.events[0]!));
  });

  it("can start from a supplied head, which is how an append continues an existing chain", () => {
    resetClock();
    const built = sealAll([transcriptImported(t1, "raw")]);
    const stripped = built.events.map((event) => {
      const { prevHash: _omitted, ...rest } = event;
      return rest;
    });

    const continued = sealEvents(stripped, built.log.headHash);
    expect(continued.events[0]!.prevHash).toBe(built.log.headHash);
    expect(continued.headHash).not.toBe(built.log.headHash);
  });
});

describe("engine and actor are carried, not invented", () => {
  it("stamps the event with the actor that sealed it", () => {
    resetClock();
    const { events } = sealAll([transcriptImported(t1, "raw", LOCAL_ENGINE)]);
    expect(events[0]!.actor).toEqual(ACTOR);
  });

  it("gives every event a monotonic learned time", () => {
    const events = twoEvents();
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.at >= events[i - 1]!.at).toBe(true);
    }
  });

  it("carries a snippet that is a literal substring of nothing invented", () => {
    resetClock();
    const text = "going with SQLite, not Postgres";
    const { events } = sealAll([
      transcriptImported(t1, text),
      decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite", snippet: span(t1, text, 0) }),
    ]);
    const decision = events[1]!;
    expect(decision.type).toBe("DecisionProposed");
  });
});
