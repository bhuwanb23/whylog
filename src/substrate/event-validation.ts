/**
 * The six append rules.
 *
 * Phase 0 · sub-phase 0.1
 * Plan: plan/phase-0-foundation.md §0.1 · contract declared in src/types/events.ts
 *
 * ---------------------------------------------------------------------------
 * WHY VALIDATION LIVES ON THE WRITE PATH
 *
 * A closed vocabulary is only closed if something refuses to write outside it.
 * Checking on read means a bad event is already sealed into the hash chain, and
 * removing it would break every hash after it — so it stays forever. Checking on
 * write means the log can be trusted unconditionally thereafter, which is what
 * lets the fold be total without being defensive about its inputs.
 *
 * Consequence: `validateEvent` is called exactly once per event, in `append`,
 * and its failure is FATAL to that append. The log is never partially written.
 * ---------------------------------------------------------------------------
 */

import type { EventId, ISODateString } from "@/types/common";
import {
  STATE_CHANGING_EVENTS,
  type AnyEvent,
  type EventType,
  type ValidationResult,
} from "@/types/events";
import type { EventPayloadMap } from "@/types/events";

/**
 * The closed vocabulary, as a runtime set.
 *
 * Derived from `STATE_CHANGING_EVENTS` would be wrong — that is a subset. This
 * list must stay in sync with `EventType` by hand, and the `satisfies` clause on
 * the constant in events.ts is what makes a missing entry a compile error there.
 */
export const EVENT_TYPES: readonly EventType[] = [
  "TranscriptImported",
  "DecisionProposed",
  "PremiseAsserted",
  "AlternativeRejected",
  "ExtractionDiscarded",
  "DecisionApproved",
  "DecisionEdited",
  "DecisionRejected",
  "PremiseConfirmed",
  "PremiseCorrected",
  "JustificationAttached",
  "LabelChanged",
  "ContradictionDetected",
  "PremiseInvalidated",
  "NogoodRecorded",
  "CascadePropagated",
  "RevisionProposed",
  "DecisionReversed",
  "DecisionRejustified",
  "PremiseContested",
  "DecisionSuperseded",
  "HumanOverride",
  "GuardSynthesised",
  "GuardAccepted",
  "GuardRan",
  "GuardFailed",
  "GuardSuppressed",
  "GuardDeleted",
  "ExportCompiled",
  "ExportStamped",
  "ExportIntegrityMismatch",
  "EngineSwitched",
  "IndexRebuilt",
  "IndexStale",
  "LogImported",
  "SchemaMigrated",
];

/** 36 entries: the 35 named in the plan plus the split GuardRan/GuardFailed
 *  pair. Kept as a constant so a test can assert the vocabulary has not drifted. */
export const EVENT_TYPE_COUNT = EVENT_TYPES.length;

const TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

/**
 * Required payload keys per event type.
 *
 * A structural check, not a full schema validator: it catches the failure mode
 * that actually occurs (an extractor emitting `decision_id` instead of
 * `decisionId`, or omitting `engine`), which is enough to keep the fold total.
 * Deeper validation belongs to the extraction layer, which knows what a
 * plausible `confidence` looks like.
 */
const REQUIRED_PAYLOAD_KEYS: Readonly<Record<EventType, readonly string[]>> = {
  TranscriptImported: ["transcriptId", "rawChars", "engine"],
  DecisionProposed: [
    "decisionId",
    "transcriptId",
    "episodeId",
    "variable",
    "value",
    "statement",
    "origin",
    "modality",
    "confidence",
    "engine",
    "snippet",
    "premiseIds",
    "alternativeIds",
  ],
  PremiseAsserted: [
    "premiseId",
    "transcriptId",
    "type",
    "predicate",
    "text",
    "confidence",
    "engine",
    "snippet",
  ],
  AlternativeRejected: [
    "alternativeId",
    "decisionId",
    "variable",
    "value",
    "confidence",
    "engine",
    "snippet",
  ],
  ExtractionDiscarded: ["candidateKind", "discardedBy", "rawText", "confidence"],
  DecisionApproved: ["decisionId", "viaBulkApprove"],
  DecisionEdited: ["decisionId", "fields"],
  DecisionRejected: ["decisionId"],
  PremiseConfirmed: ["premiseId"],
  PremiseCorrected: ["premiseId", "fields"],
  JustificationAttached: ["justificationId", "consequent", "justification"],
  LabelChanged: ["nodeId", "from", "to"],
  ContradictionDetected: ["gate", "verdict", "decisionA", "explanation", "engine"],
  PremiseInvalidated: ["premiseId", "invalidatedBy"],
  NogoodRecorded: ["nogoodId", "premiseIds", "derivedFrom"],
  CascadePropagated: ["from", "to", "depth", "stoppedAtIndependentSupport"],
  RevisionProposed: [
    "proposalId",
    "unsoundDecisionId",
    "failedPremiseId",
    "cascade",
    "survivors",
    "entrenchment",
    "availableActions",
  ],
  DecisionReversed: ["decisionId", "newValue", "supersedesEventId"],
  DecisionRejustified: ["decisionId", "newPremiseId", "newJustificationId"],
  PremiseContested: ["premiseId"],
  DecisionSuperseded: ["oldDecisionId", "newDecisionId"],
  HumanOverride: ["proposalId", "overriddenDecisionId"],
  GuardSynthesised: ["guardId", "decisionId", "kind", "spec", "severity", "rationale", "generatedBy"],
  GuardAccepted: ["guardId"],
  GuardRan: ["guardId", "result", "evidence", "ranAt"],
  GuardFailed: ["guardId", "result", "evidence", "ranAt", "firstFailedAt"],
  GuardSuppressed: ["guardId", "suppressionReason"],
  GuardDeleted: ["guardId"],
  ExportCompiled: ["exportId", "targets", "decisionsIncluded", "decisionsLinkedOut", "lineCount"],
  ExportStamped: ["exportId", "stamp"],
  ExportIntegrityMismatch: ["path", "expectedHead"],
  EngineSwitched: ["from", "to"],
  IndexRebuilt: ["engine", "decisionsIndexed", "levels"],
  IndexStale: ["staleEngine", "currentEngine"],
  LogImported: ["sourceHeadHash", "eventsImported", "merged", "created"],
  SchemaMigrated: ["fromVersion", "toVersion"],
};

/** Rule 1 — the type is a member of the closed vocabulary. */
export function isKnownEventType(value: unknown): value is EventType {
  return typeof value === "string" && TYPE_SET.has(value);
}

/** Rule 2 — every state-changing event carries a non-empty reason. */
export function hasReason(type: EventType, reason: unknown): boolean {
  if (!(STATE_CHANGING_EVENTS as readonly EventType[]).includes(type)) {
    // Non-state-changing events still record a reason by convention, but an
    // empty one is not a violation — `IndexRebuilt` has nothing to justify.
    return typeof reason === "string";
  }
  return typeof reason === "string" && reason.trim().length > 0;
}

/** Rule 6 — the payload carries every key its type declares. */
export function payloadShapeOk(
  type: EventType,
  payload: unknown,
): { ok: true } | { ok: false; missing: readonly string[] } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, missing: REQUIRED_PAYLOAD_KEYS[type] };
  }
  const record = payload as Record<string, unknown>;
  const missing = REQUIRED_PAYLOAD_KEYS[type].filter((key) => {
    const value = record[key];
    return value === undefined || value === null;
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

function validIso(value: unknown): value is ISODateString {
  if (typeof value !== "string" || value.length === 0) return false;
  return !Number.isNaN(Date.parse(value));
}

export interface ValidationContext {
  /** The chain head the new event must link to. */
  readonly expectedPrevHash: string;
  /** Learned time of the last event in the log, if any. */
  readonly lastLearnedAt: ISODateString | null;
  /** Ids already present, for the uniqueness check. */
  readonly knownIds: ReadonlySet<EventId> | null;
}

/**
 * Validate one event against all six rules.
 *
 * Rule 5 — `occurredAt` may be in the past — is enforced by NOT checking it
 * against the present. That is a deliberate absence, and the comment is here so
 * nobody "fixes" it later: back-dating a decision to when it was actually made
 * is the entire point of the valid-time axis.
 */
export function validateEvent(event: AnyEvent, context: ValidationContext): ValidationResult {
  /* Rule 1 */
  if (!isKnownEventType(event.type)) {
    return {
      ok: false,
      rule: 1,
      message: `Unknown event type "${String(event.type)}". The vocabulary is closed; add the type in src/types/events.ts and a migration in src/substrate/schema.ts.`,
    };
  }

  /* Envelope integrity — not one of the six, but checked first because the rest
     assumes these fields exist. */
  if (typeof event.id !== "string" || event.id.length === 0) {
    return { ok: false, rule: 3, message: "Event has no id." };
  }
  if (!validIso(event.at)) {
    return { ok: false, rule: 4, message: `Event ${event.id} has an unparseable \`at\`.` };
  }
  if (!validIso(event.occurredAt)) {
    return {
      ok: false,
      rule: 5,
      message: `Event ${event.id} has an unparseable \`occurredAt\`.`,
    };
  }
  if (typeof event.actor !== "object" || event.actor === null || !("kind" in event.actor)) {
    return { ok: false, rule: 6, message: `Event ${event.id} has no actor.` };
  }

  /* Rule 2 */
  if (!hasReason(event.type, event.reason)) {
    return {
      ok: false,
      rule: 2,
      message: `Event ${event.id} (${event.type}) changes graph state and must carry a non-empty \`reason\`. An audit log of events without reasons is just a log.`,
    };
  }

  /* Rule 3 */
  if (event.prevHash !== context.expectedPrevHash) {
    return {
      ok: false,
      rule: 3,
      message: `Event ${event.id} links to ${event.prevHash.slice(0, 12)}… but the log is at ${context.expectedPrevHash.slice(0, 12)}…. Appending it would fork the chain.`,
    };
  }

  /* Rule 4 */
  if (context.lastLearnedAt !== null && event.at < context.lastLearnedAt) {
    return {
      ok: false,
      rule: 4,
      message: `Event ${event.id} was learned at ${event.at}, before the previous event's ${context.lastLearnedAt}. Learned time must be monotonic; set \`occurredAt\` instead if the decision is older than the record of it.`,
    };
  }

  /* Uniqueness */
  if (context.knownIds?.has(event.id)) {
    return {
      ok: false,
      rule: 3,
      message: `Event id ${event.id} is already in the log.`,
    };
  }

  /* Rule 6 */
  const shape = payloadShapeOk(event.type, event.payload);
  if (!shape.ok) {
    return {
      ok: false,
      rule: 6,
      message: `Payload of ${event.type} is missing ${shape.missing.map((k) => `\`${k}\``).join(", ")}.`,
    };
  }

  return { ok: true };
}

/** Convenience wrapper for validating an imported event against no context. */
export function validateLoose(event: AnyEvent): ValidationResult {
  return validateEvent(event, {
    expectedPrevHash: event.prevHash,
    lastLearnedAt: null,
    knownIds: null,
  });
}

/** Type-level helper: the payload type for a given event type, for callers
 *  constructing events. */
export type PayloadOf<T extends EventType> = EventPayloadMap[T];

/**
 * The human-readable message from a validation result.
 *
 * Every caller wants this only after an append was REJECTED, so in practice the result is always
 * the `ok: false` branch. The type system cannot see that correlation — `AppendOutcome.ok` and
 * `ValidationResult.ok` are independent discriminants — so the narrowing lives here once rather
 * than as an inline ternary at each of the four call sites. The `ok: true` fallback is a
 * defensive string, not a case the append path can produce.
 */
export function validationMessage(result: ValidationResult): string {
  return result.ok ? "rejected by validation" : result.message;
}
