/**
 * The append-only log.
 *
 * Phase 0 · sub-phase 0.1
 * Plan: plan/phase-0-foundation.md §0.1
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I1 — NOTHING IS DELETED, EVERYTHING IS AN EVENT
 *
 * This module exposes `append` and `load`. It does not expose `set`, `update`,
 * `remove`, `splice`, `clear` or `truncate`, and there is no code path by which
 * a caller can obtain a mutable reference to the stored array. The absence of a
 * mutation API is the enforcement; a lint rule or a code review is not.
 *
 * The one operation that looks like removal — rejecting a decision, deleting a
 * guard, superseding a premise — is an APPEND of a closing event. The node stays
 * in every projection with its interval shown.
 * ---------------------------------------------------------------------------
 */

import { formatEventId } from "@/lib/ids";
import type { Actor, EngineId, EventId, ISODateString } from "@/types/common";
import type {
  AnyEvent,
  DomainEvent,
  EventPayloadMap,
  EventType,
  NewEvent,
  ValidationResult,
} from "@/types/events";
import { type ValidationContext, validateEvent } from "./event-validation";
import { type ChainVerification, GENESIS_HASH, hashEvent, linkHash, verifyChain } from "./hash-chain";
import { SCHEMA_VERSION } from "./schema";

/* -------------------------------------------------------------------------- */
/* The log                                                                    */
/* -------------------------------------------------------------------------- */

export interface EventLog {
  /** Sealed, hash-chained, in learned-time order. */
  readonly events: readonly AnyEvent[];
  readonly headHash: string;
  readonly lastEventId: EventId | null;
  /** Learned time of the last event; the monotonicity floor for the next one. */
  readonly lastAt: ISODateString | null;
  readonly schemaVersion: number;
}

export function emptyLog(): EventLog {
  return {
    events: [],
    headHash: GENESIS_HASH,
    lastEventId: null,
    lastAt: null,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Rebuild a log handle from a stored or imported array. Verifies the chain and
 *  reports — it does not silently accept a broken one. */
export function loadLog(
  events: readonly AnyEvent[],
  schemaVersion: number = SCHEMA_VERSION,
): { log: EventLog; verification: ChainVerification } {
  const verification = verifyChain(events);
  const last = events.at(-1);
  return {
    log: {
      events,
      headHash: verification.headHash,
      lastEventId: last?.id ?? null,
      lastAt: last?.at ?? null,
      schemaVersion,
    },
    verification,
  };
}

/* -------------------------------------------------------------------------- */
/* Appending                                                                  */
/* -------------------------------------------------------------------------- */

export type AppendOutcome<T extends EventType> =
  | { readonly ok: true; readonly log: EventLog; readonly event: AnyEvent }
  | {
      readonly ok: false;
      readonly log: EventLog;
      readonly validation: ValidationResult;
      readonly attempted: T;
    };

export interface AppendContext {
  readonly now: ISODateString;
  readonly actor: Actor;
  /** Valid time. Defaults to `now`; set it when importing history. */
  readonly occurredAt?: ISODateString;
  readonly reason: string;
}

/**
 * The event as the caller supplies it: type, payload, actor, reason, and the two
 * clocks. `id`, `prevHash` and `schemaVersion` are minted here — a caller that
 * could choose its own `prevHash` could fork the chain.
 */
export type EventDraft<T extends EventType> = Omit<NewEvent<T>, "at" | "occurredAt"> & {
  readonly at?: ISODateString;
  readonly occurredAt?: ISODateString;
};

function mintId(log: EventLog, at: ISODateString): EventId {
  // Time-ordered and unique within a millisecond via the sequence counter. The
  // counter is the log length, which is monotonic because the log only grows.
  return formatEventId(Date.parse(at) || 0, log.events.length + 1);
}

function seal<T extends EventType>(
  log: EventLog,
  draft: EventDraft<T>,
  context: AppendContext,
): AnyEvent {
  const rawAt = draft.at ?? context.now;
  const at = log.lastAt !== null && rawAt < log.lastAt ? log.lastAt : rawAt;
  const occurredAt = draft.occurredAt ?? context.occurredAt ?? at;

  const event = {
    id: mintId(log, at),
    type: draft.type,
    at,
    occurredAt,
    actor: draft.actor ?? context.actor,
    payload: draft.payload,
    reason: draft.reason ?? context.reason,
    prevHash: log.headHash,
    selfHash: "",
    schemaVersion: log.schemaVersion,
  } as unknown as DomainEvent<T, EventPayloadMap[T]>;

  (event as unknown as { selfHash: string }).selfHash = hashEvent(event as unknown as DomainEvent);

  return event as AnyEvent;
}

function contextFor(log: EventLog): ValidationContext {
  // `knownIds` is left null on the append path: ids are minted here from a
  // monotonic counter, so a collision would mean the counter broke, and scanning
  // ten thousand ids on every append to prove otherwise is the wrong trade.
  // Imports DO scan, because those ids came from somewhere else.
  return {
    expectedPrevHash: log.headHash,
    lastLearnedAt: log.lastAt,
    knownIds: null,
  };
}

/**
 * Validate, seal and append one event.
 *
 * On failure the log is returned UNCHANGED. There is no partial append: a log
 * that can be half-written cannot be reasoned about, and the fold would have to
 * guess.
 */
export function append<T extends EventType>(
  log: EventLog,
  draft: EventDraft<T>,
  context: AppendContext,
): AppendOutcome<T> {
  const event = seal(log, draft, context);
  const validation = validateEvent(event, contextFor(log));

  if (!validation.ok) {
    return { ok: false, log, validation, attempted: draft.type };
  }

  return {
    ok: true,
    log: {
      events: [...log.events, event],
      headHash: linkHash(log.headHash, event),
      lastEventId: event.id,
      lastAt: event.at,
      schemaVersion: log.schemaVersion,
    },
    event,
  };
}

/**
 * Append a batch, all-or-nothing.
 *
 * Used by the extraction commit path (Phase 1.10), where a decision and its
 * premises, alternatives and justification must land together or not at all. A
 * half-committed extraction produces a decision resting on premises that do not
 * exist, which the fold would have to label UNFOUNDED.
 */
export function appendBatch(
  log: EventLog,
  drafts: readonly { draft: EventDraft<EventType>; context: AppendContext }[],
):
  | { ok: true; log: EventLog; events: AnyEvent[] }
  | { ok: false; log: EventLog; validation: ValidationResult; failedAt: number } {
  let current = log;
  const sealed: AnyEvent[] = [];

  for (let i = 0; i < drafts.length; i += 1) {
    const entry = drafts[i];
    if (!entry) continue;
    const outcome = append(current, entry.draft, entry.context);
    if (!outcome.ok) {
      return { ok: false, log, validation: outcome.validation, failedAt: i };
    }
    current = outcome.log;
    sealed.push(outcome.event);
  }

  return { ok: true, log: current, events: sealed };
}

/**
 * Append events that are ALREADY sealed — the import path.
 *
 * Skips id minting and re-linking, because an imported event's `prevHash` is part
 * of its identity and rewriting it would change the head hash the export was
 * stamped with. The chain is verified by the caller before this is reached; see
 * src/substrate/portability.ts.
 */
export function appendSealed(log: EventLog, events: readonly AnyEvent[]): EventLog {
  if (events.length === 0) return log;

  let head = log.headHash;
  let lastEventId = log.lastEventId;
  let lastAt = log.lastAt;
  let schemaVersion = log.schemaVersion;

  for (const event of events) {
    head = linkHash(head, event);
    lastEventId = event.id;
    if (lastAt === null || event.at > lastAt) lastAt = event.at;
    schemaVersion = Math.max(schemaVersion, event.schemaVersion ?? schemaVersion);
  }

  return {
    events: [...log.events, ...events],
    headHash: head,
    lastEventId,
    lastAt,
    schemaVersion,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** Iterate in log order. The only sanctioned way to walk the log. */
export function* iterate(log: EventLog): Generator<AnyEvent> {
  for (const event of log.events) yield event;
}

/** Filter by type, preserving log order. */
export function eventsOfType<T extends EventType>(log: EventLog, type: T): readonly AnyEvent[] {
  return log.events.filter((e): e is Extract<AnyEvent, { type: T }> => e.type === type);
}

/**
 * Every event touching a given node id, in learned-time order.
 *
 * This is the audit trail for one node, and it is complete by construction —
 * nothing about a node can change without an event, and nothing can be removed
 * from the log.
 *
 * Implemented as a structural walk over known id-bearing payload keys rather than
 * a substring search of the serialised payload: a substring scan would match an
 * id appearing inside a free-text `reason`, which would put unrelated events in
 * a node's history and quietly destroy the one view that has to be exact.
 */
const ID_BEARING_KEYS = [
  "decisionId",
  "premiseId",
  "justificationId",
  "guardId",
  "nogoodId",
  "proposalId",
  "transcriptId",
  "episodeId",
  "alternativeId",
  "exportId",
  "nodeId",
  "consequent",
  "unsoundDecisionId",
  "failedPremiseId",
  "newPremiseId",
  "newJustificationId",
  "overriddenDecisionId",
  "oldDecisionId",
  "newDecisionId",
  "decisionA",
  "decisionB",
  "from",
  "to",
] as const;

export function historyOf(log: EventLog, nodeId: string): readonly AnyEvent[] {
  const mentions = (payload: unknown): boolean => {
    if (typeof payload !== "object" || payload === null) return false;
    const record = payload as Record<string, unknown>;

    for (const key of ID_BEARING_KEYS) {
      if (record[key] === nodeId) return true;
    }

    // Array-valued references: inList, outList, premiseIds, guardIds, cascade.
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === nodeId) return true;
          if (typeof item === "object" && item !== null) {
            const inner = item as Record<string, unknown>;
            if (inner["decisionId"] === nodeId || inner["premiseId"] === nodeId) return true;
          }
        }
      }
    }

    return false;
  };

  return log.events.filter((e) => mentions(e.payload));
}

/** The last N events, newest first. For the activity strip. */
export function recent(log: EventLog, count: number): readonly AnyEvent[] {
  return log.events.slice(Math.max(0, log.events.length - count)).reverse();
}

/** Events learned within a window. Inclusive of `from`, exclusive of `to`. */
export function learnedBetween(
  log: EventLog,
  from: ISODateString,
  to: ISODateString,
): readonly AnyEvent[] {
  return log.events.filter((e) => e.at >= from && e.at < to);
}

/** Events whose VALID time falls in a window. Different question, different
 *  answer — see src/substrate/bi-temporal.ts. */
export function occurredBetween(
  log: EventLog,
  from: ISODateString,
  to: ISODateString,
): readonly AnyEvent[] {
  return log.events.filter((e) => e.occurredAt >= from && e.occurredAt < to);
}

/** Who did what. Counts per actor kind, for the agency ledger (Phase 6.4). */
export function actorTally(log: EventLog): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const event of log.events) {
    const key = describeActor(event.actor);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function describeActor(actor: Actor): string {
  switch (actor.kind) {
    case "human":
      return "human";
    case "engine":
      return `engine:${actor.engine.kind}:${actor.engine.model}`;
    case "guard":
      return `guard:${actor.guardId}`;
    case "system":
      return "system";
    default:
      return "unknown";
  }
}

/** Tally per event type — the shape of a log at a glance. */
export function typeTally(log: EventLog): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const event of log.events) {
    out[event.type] = (out[event.type] ?? 0) + 1;
  }
  return out;
}

/** Verify the whole chain. Called on load and on import (sub-phase 0.5). */
export function verify(log: EventLog): ChainVerification {
  return verifyChain(log.events);
}

/** The engine recorded on the most recent `EngineSwitched`, or a default. */
export function currentEngine(log: EventLog, fallback: EngineId): EngineId {
  for (let i = log.events.length - 1; i >= 0; i -= 1) {
    const event = log.events[i];
    if (event && event.type === "EngineSwitched") return event.payload.to;
  }
  return fallback;
}
