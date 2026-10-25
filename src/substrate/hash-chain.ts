/**
 * Append-only hash chain.
 *
 * Phase 0 · sub-phase 0.5
 * Plan: plan/phase-0-foundation.md §0.5
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 *
 * This is a tamper-EVIDENCE mechanism, not a security one. The chain is computed
 * with a synchronous non-cryptographic hash (see src/lib/hash.ts) because the
 * fold must stay pure and synchronous, and because the threat model is
 * "did an event get silently edited or reordered?", not "can a determined
 * adversary forge history?". Nobody is signing this log.
 *
 * What it buys: if one event in ten thousand is altered — a decision statement
 * rewritten, an `occurredAt` nudged, an event dropped from the middle — every
 * hash after it changes, and load-time verification reports the exact index.
 * That is the entire point. A decision memory that cannot prove its own history
 * is not a memory, it is a mutable document.
 * ---------------------------------------------------------------------------
 */

import { canonicalJson, hashStable } from "@/lib/hash";
import type { AnyEvent, DomainEvent, EventType } from "@/types/events";

/**
 * The genesis constant. h_0.
 *
 * Frozen. If this ever changes, every previously exported log fails
 * verification, so it is treated as part of the wire format rather than as
 * configuration. The value spells the product name in hex-ish ASCII and is
 * padded to the chain's digest width.
 */
export const GENESIS_HASH = "whylog:genesis:00000000000000000000000000000000" as const;

/** Digest width, for display and validation. */
export const HASH_LENGTH = 32;

/**
 * Hash one event, excluding its own `prevHash` field.
 *
 * `prevHash` is excluded from the hash input so that the chain link is a
 * function of the event's CONTENT and the previous hash, not of a self-
 * reference. Every other field is included — id, type, both timestamps, actor,
 * reason and payload — so editing any of them breaks the chain.
 *
 * `canonicalJson` sorts object keys, which is what makes export -> import
 * reproduce a byte-identical head hash regardless of key insertion order.
 */
export function hashEvent(event: DomainEvent): string {
  const { prevHash: _prev, selfHash: _self, ...content } = event;
  return hashStable(canonicalJson(content));
}

/** h_n = hash(h_{n-1} || e_n). */
export function linkHash(prevHash: string, event: DomainEvent): string {
  return hashStable(`${prevHash}:${hashEvent(event)}`);
}

/** Hash of the last event in a chain, or GENESIS_HASH for an empty one. */
export function headHash(events: readonly AnyEvent[]): string {
  let head: string = GENESIS_HASH;
  for (const event of events) {
    head = linkHash(head, event);
  }
  return head;
}

export interface ChainViolation {
  /** 0-based position in the array. */
  readonly index: number;
  readonly eventId: string;
  readonly kind: "prev-hash-mismatch" | "self-hash-mismatch" | "duplicate-id" | "out-of-order-at";
  readonly expected: string;
  readonly found: string;
  readonly message: string;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly headHash: string;
  readonly eventCount: number;
  readonly violations: readonly ChainViolation[];
  /** First broken index, or null. Everything after this is untrustworthy. */
  readonly firstBadIndex: number | null;
}

const MAX_VIOLATIONS_REPORTED = 20;

/**
 * Verify a chain end to end.
 *
 * Reports up to {@link MAX_VIOLATIONS_REPORTED} problems rather than failing
 * fast: when an import is rejected the user needs to know whether one event is
 * damaged or the whole file was reassembled from two different logs.
 */
export function verifyChain(events: readonly AnyEvent[]): ChainVerification {
  const violations: ChainViolation[] = [];
  const seenIds = new Set<string>();
  let expectedPrev: string = GENESIS_HASH;
  let firstBadIndex: number | null = null;
  let previousAt: string | null = null;

  const report = (v: ChainViolation): void => {
    if (violations.length < MAX_VIOLATIONS_REPORTED) violations.push(v);
    if (firstBadIndex === null) firstBadIndex = v.index;
  };

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;

    if (event.prevHash !== expectedPrev) {
      report({
        index: i,
        eventId: event.id,
        kind: "prev-hash-mismatch",
        expected: expectedPrev,
        found: event.prevHash,
        message: `Event ${event.id} claims prevHash ${event.prevHash.slice(0, 8)}… but the chain was at ${expectedPrev.slice(0, 8)}…`,
      });
    }

    // Per-event content hash: detects a tampered event at its own index, not at
    // the next one. `selfHash` is the hash of everything except prevHash/selfHash.
    const computedSelf = hashEvent(event);
    if (event.selfHash !== computedSelf) {
      report({
        index: i,
        eventId: event.id,
        kind: "self-hash-mismatch",
        expected: computedSelf,
        found: event.selfHash,
        message: `Event ${event.id} self-hash does not match its content.`,
      });
    }

    if (seenIds.has(event.id)) {
      report({
        index: i,
        eventId: event.id,
        kind: "duplicate-id",
        expected: "unique id",
        found: event.id,
        message: `Event id ${event.id} appears more than once.`,
      });
    }
    seenIds.add(event.id);

    // Learned time must be monotonically non-decreasing. Valid time must NOT be:
    // back-dating a decision to when it was actually made is legitimate and
    // common (see src/substrate/bi-temporal.ts).
    if (previousAt !== null && event.at < previousAt) {
      report({
        index: i,
        eventId: event.id,
        kind: "out-of-order-at",
        expected: previousAt,
        found: event.at,
        message: `Event ${event.id} was learned at ${event.at}, before the previous event's ${previousAt}.`,
      });
    }
    previousAt = event.at;

    expectedPrev = linkHash(expectedPrev, event);
  }

  return {
    valid: violations.length === 0,
    headHash: expectedPrev,
    eventCount: events.length,
    violations,
    firstBadIndex,
  };
}

/**
 * Build a chain from raw payloads.
 *
 * This is the only place a `prevHash` is ever assigned. Everything upstream
 * supplies content; the chain is a property of the LOG, not of the event.
 */
export function sealEvents(
  events: readonly Omit<DomainEvent, "prevHash">[],
  fromHash: string = GENESIS_HASH,
): { events: AnyEvent[]; headHash: string } {
  const sealed: AnyEvent[] = [];
  let prev = fromHash;

  for (const partial of events) {
    const full = { ...partial, prevHash: prev, selfHash: "" } as AnyEvent;
    (full as { selfHash: string }).selfHash = hashEvent(full);
    sealed.push(full);
    prev = linkHash(prev, full);
  }

  return { events: sealed, headHash: prev };
}

/** Append one event to an existing chain. */
export function appendEvent(
  events: readonly AnyEvent[],
  partial: Omit<DomainEvent, "prevHash">,
): { event: AnyEvent; headHash: string } {
  const prev = events.length === 0 ? GENESIS_HASH : linkHashOf(events);
  const full = { ...partial, prevHash: prev, selfHash: "" } as AnyEvent;
  (full as { selfHash: string }).selfHash = hashEvent(full);
  return { event: full, headHash: linkHash(prev, full) };
}

/** Cached head hash of a non-empty chain. Reads the last event's link rather
 *  than re-hashing the whole log — O(1) instead of O(n) on every append. */
function linkHashOf(events: readonly AnyEvent[]): string {
  let head: string = GENESIS_HASH;
  for (const event of events) {
    head = linkHash(head, event);
  }
  return head;
}

/** Narrow an untyped object to a DomainEvent shape, for import. Returns the
 *  reason it was rejected rather than throwing — import failures are expected. */
export function coerceEvent(
  raw: unknown,
): { ok: true; event: AnyEvent } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not an object" };

  const candidate = raw as Record<string, unknown>;
  const required: [string, (v: unknown) => boolean][] = [
    ["id", (v) => typeof v === "string" && v.length > 0],
    ["type", (v) => typeof v === "string"],
    ["at", (v) => typeof v === "string"],
    ["occurredAt", (v) => typeof v === "string"],
    ["actor", (v) => typeof v === "object" && v !== null],
    ["reason", (v) => typeof v === "string" && v.trim().length > 0],
    ["prevHash", (v) => typeof v === "string"],
    ["payload", (v) => typeof v === "object" && v !== null],
    // `schemaVersion` is required on write but tolerated on import: a log
    // exported by an early build may omit it, and the importer supplies the
    // file-level version instead. See src/substrate/portability.ts.
  ];

  for (const [key, test] of required) {
    if (!test(candidate[key])) {
      return {
        ok: false,
        reason:
          key === "reason"
            ? "missing or empty `reason` — every event must carry one"
            : `missing or malformed \`${key}\``,
      };
    }
  }

   /* The ENVELOPE is validated above; the payload's type-specific shape is not — that is
    * `payloadShapeOk`'s job, and portability runs the imported events through the same validation the
    * append path does. Claiming AnyEvent here states what the log will hold, not what this function
    * proved on its own. */
   const coerced = candidate as unknown as AnyEvent;
   if (typeof coerced.selfHash !== "string" || coerced.selfHash.length === 0) {
     (coerced as { selfHash: string }).selfHash = hashEvent(coerced);
   }
   return { ok: true, event: coerced };
}

/** Human-readable summary of a verification, for the health panel. */
export function describeVerification(verification: ChainVerification): string {
  if (verification.valid) {
    return `chain intact — ${verification.eventCount} event${verification.eventCount === 1 ? "" : "s"}, head ${verification.headHash.slice(0, 12)}…`;
  }
  const first = verification.violations[0];
  const count = verification.eventCount;
  return first
    ? `chain broken at event ${first.index + 1} of ${count}: ${first.message}`
    : `chain broken (${count} events)`;
}

export type { EventType };
