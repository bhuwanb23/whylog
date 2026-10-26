import {
  EVENT_TYPES,
  EVENT_TYPE_COUNT,
  hasReason,
  isKnownEventType,
  payloadShapeOk,
  validateEvent,
  validateLoose,
  validationMessage,
} from "@/substrate/event-validation";
import { GENESIS_HASH } from "@/substrate/hash-chain";
import { STATE_CHANGING_EVENTS } from "@/types/events";
import type { AnyEvent } from "@/types/events";
/**
 * Event validation — the seven rules the append path enforces.
 *
 * Rule 2 (a non-empty reason on every state-changing event) is the one that mattered most: five of
 * six drafts in `extraction/commit.ts` shipped without a reason, so every commit was rejected and
 * nothing could ever be recorded. It type-checked, because `reason` was simply absent from an object
 * literal typed loosely enough to allow it. This test exists so that class of bug cannot return.
 */
import { describe, expect, it } from "vitest";
import {
  ACTOR,
  LOCAL_ENGINE,
  decisionId,
  decisionProposed,
  nextAt,
  resetClock,
  sealAll,
  transcriptId,
  transcriptImported,
} from "../../helpers/events";

const t1 = transcriptId(1);

function sealed(): readonly AnyEvent[] {
  resetClock();
  return sealAll([
    transcriptImported(t1, "going with SQLite"),
    decisionProposed({ id: decisionId(1), transcript: t1, variable: "DATABASE", value: "sqlite" }),
  ]).events;
}

describe("the event vocabulary", () => {
  it("declares the count it advertises, and every member is PascalCase", () => {
    expect(EVENT_TYPE_COUNT).toBe(EVENT_TYPES.length);
    expect(EVENT_TYPES.length).toBeGreaterThan(30);
    for (const type of EVENT_TYPES) {
      expect(type[0]).toBe(type[0]!.toUpperCase());
      expect(isKnownEventType(type)).toBe(true);
    }
  });

  it("rejects an unknown type", () => {
    expect(isKnownEventType("decision-proposed")).toBe(false);
    expect(isKnownEventType("")).toBe(false);
    expect(isKnownEventType(42)).toBe(false);
  });
});

describe("rule 2 — every state-changing event carries a non-empty reason", () => {
  const stateChanging = STATE_CHANGING_EVENTS[0]!;
  const recordOnly = EVENT_TYPES.find(
    (t) => !(STATE_CHANGING_EVENTS as readonly string[]).includes(t),
  )!;

  it("declares a non-trivial set of state-changing events, all of them in the vocabulary", () => {
    expect(STATE_CHANGING_EVENTS.length).toBeGreaterThan(5);
    for (const type of STATE_CHANGING_EVENTS) expect(isKnownEventType(type)).toBe(true);
  });

  it("accepts a real reason", () => {
    expect(hasReason(stateChanging, "the human chose SQLite")).toBe(true);
  });

  it("rejects an empty, whitespace or ABSENT reason on a state-changing event", () => {
    expect(hasReason(stateChanging, "")).toBe(false);
    expect(hasReason(stateChanging, "   ")).toBe(false);
    expect(hasReason(stateChanging, undefined)).toBe(false);
    expect(hasReason(stateChanging, null)).toBe(false);
  });

  it("tolerates an EMPTY reason on a record-only event but never an absent one", () => {
    /* `IndexRebuilt` has nothing to justify, so an empty reason is not a violation — but a reason
     * that is not a string at all is, because the audit trail renders it. This distinction is the
     * whole commit.ts regression: the five drafts omitted `reason` entirely rather than leaving it
     * blank, which fails for EVERY event type, state-changing or not. */
    expect(hasReason(recordOnly, "")).toBe(true);
    expect(hasReason(recordOnly, undefined)).toBe(false);
    expect(hasReason(recordOnly, null)).toBe(false);
  });
});

describe("validateLoose over events the log actually sealed", () => {
  it("accepts every event in a real chain", () => {
    for (const event of sealed()) {
      expect(validationMessage(validateLoose(event))).toBeDefined();
      expect(validateLoose(event).ok).toBe(true);
    }
  });

  it("rejects an event whose reason was REMOVED — the commit.ts regression", () => {
    /* Removed, not blanked: the five drafts in `commit.ts` had no `reason` key at all. That fails
     * rule 2 for every event type, so the whole commit batch was rejected and nothing could be
     * recorded — while type-checking happily, because the literals were loosely typed. */
    const [event] = sealed();
    const { reason: _dropped, ...rest } = event!;
    const result = validateLoose(rest as AnyEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(validationMessage(result)).toBe(result.message);
    }
  });

  it("rejects an event whose payload lost a required key", () => {
    const events = sealed();
    const decision = events[1]!;
    const gutted = { ...decision, payload: { decisionId: decisionId(1) } } as AnyEvent;
    expect(validateLoose(gutted).ok).toBe(false);
  });
});

describe("validationMessage narrows the union in exactly one place", () => {
  it("returns the rule's message on failure and a fallback on success", () => {
    expect(validationMessage({ ok: true })).toBe("rejected by validation");
    expect(validationMessage({ ok: false, rule: 2, message: "missing reason" })).toBe(
      "missing reason",
    );
  });
});

describe("payloadShapeOk", () => {
  it("accepts a payload carrying every key its type declares", () => {
    const events = sealed();
    expect(payloadShapeOk("TranscriptImported", events[0]!.payload).ok).toBe(true);
    expect(payloadShapeOk("DecisionProposed", events[1]!.payload).ok).toBe(true);
  });

  it("rejects a payload missing a declared key, and NAMES the keys it lost", () => {
    const result = payloadShapeOk("TranscriptImported", { transcriptId: t1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("rawChars");
      expect(result.missing).toContain("engine");
    }
  });

  it("rejects a payload that is not an object at all", () => {
    expect(payloadShapeOk("TranscriptImported", null).ok).toBe(false);
    expect(payloadShapeOk("TranscriptImported", "nope").ok).toBe(false);
  });
});

describe("validateEvent against a chain context", () => {
  it("rejects an event that links to the wrong predecessor", () => {
    const events = sealed();
    const result = validateEvent(events[1]!, {
      expectedPrevHash: GENESIS_HASH, // wrong: event 1 links to event 0, not genesis
      lastLearnedAt: events[0]!.at,
      knownIds: new Set([events[0]!.id]),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate event id", () => {
    const events = sealed();
    const result = validateEvent(events[1]!, {
      expectedPrevHash: events[1]!.prevHash,
      lastLearnedAt: events[0]!.at,
      knownIds: new Set([events[1]!.id]),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an event learned before the one already in the log", () => {
    const events = sealed();
    resetClock();
    const result = validateEvent({ ...events[1]!, at: "2020-01-01T00:00:00.000Z" } as AnyEvent, {
      expectedPrevHash: events[1]!.prevHash,
      lastLearnedAt: events[0]!.at,
      knownIds: new Set([events[0]!.id]),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts the next event in a healthy chain", () => {
    const events = sealed();
    const result = validateEvent(events[1]!, {
      expectedPrevHash: events[1]!.prevHash,
      lastLearnedAt: events[0]!.at,
      knownIds: new Set([events[0]!.id]),
    });
    expect(result.ok).toBe(true);
  });
});

describe("actor is stamped, never defaulted silently", () => {
  it("keeps the actor the caller supplied", () => {
    const events = sealed();
    expect(events[0]!.actor).toEqual(ACTOR);
    expect(validateLoose(events[0]!).ok).toBe(true);
  });

  it("records which engine produced the payload", () => {
    const events = sealed();
    const payload = events[0]!.payload as { engine: typeof LOCAL_ENGINE };
    expect(payload.engine).toEqual(LOCAL_ENGINE);
  });
});

describe("learned time is monotonic", () => {
  it("advances with every append", () => {
    const events = sealed();
    expect(Date.parse(events[1]!.at)).toBeGreaterThan(Date.parse(events[0]!.at));
    expect(nextAt() > events[1]!.at).toBe(true);
  });
});
