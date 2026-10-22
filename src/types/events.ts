/**
 * The closed vocabulary of the log.
 *
 * Phase 0 · sub-phase 0.1
 * Plan:     plan/phase-0-foundation.md §0.1
 * Research: docs/06-agent-memory-landscape.md §2  (bi-temporality)
 *           docs/02-truth-maintenance-theory.md §4 (formalism)
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I1 — nothing is deleted, everything is an event.
 *
 * Everything the system ever does is one of the events below. Adding a type is
 * a SCHEMA MIGRATION (src/substrate/schema.ts), not an edit. No event type
 * permits mutation of a prior event's payload.
 *
 * Every state-changing event carries a non-empty `reason`. An audit log of
 * events without reasons is just a log.
 * ---------------------------------------------------------------------------
 */

import type {
  Actor,
  AlternativeId,
  BiTemporal,
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  EventId,
  ExportId,
  GuardId,
  ISODateString,
  JustificationId,
  NogoodId,
  PremiseId,
  ProposalId,
  SourceSpan,
  TranscriptId,
} from "./common";
import type {
  DecisionLabel,
  DecisionOrigin,
  DecisionVariable,
  Justification,
  PremiseType,
} from "./domain";
import type { ExportTarget, IntegrityStamp } from "./export";
import type { GuardKind, GuardSeverity, GuardSpec } from "./guards";
import type { EntrenchmentBreakdown } from "./reasoning";
import type { ContradictionVerdict, GroundednessVerdict, RetrievedHit } from "./retrieval";

/* -------------------------------------------------------------------------- */
/* Event type union                                                           */
/* -------------------------------------------------------------------------- */

export type EventType =
  /* --- ingest --- */
  | "TranscriptImported"
  /* --- extraction (Phase 1) --- */
  | "DecisionProposed"
  | "PremiseAsserted"
  | "AlternativeRejected"
  | "ExtractionDiscarded"
  /* --- review (Phase 1.9) --- */
  | "DecisionApproved"
  | "DecisionEdited"
  | "DecisionRejected"
  | "PremiseConfirmed"
  | "PremiseCorrected"
  /* --- reasoning (Phase 2) --- */
  | "JustificationAttached"
  | "LabelChanged"
  | "ContradictionDetected"
  | "PremiseInvalidated"
  | "NogoodRecorded"
  | "CascadePropagated"
  /* --- revision (Phase 2.9) --- */
  | "RevisionProposed"
  | "DecisionReversed"
  | "DecisionRejustified"
  | "PremiseContested"
  | "DecisionSuperseded"
  | "HumanOverride"
  /* --- verification (Phase 4) --- */
  | "GuardSynthesised"
  | "GuardAccepted"
  | "GuardRan"
  | "GuardFailed"
  | "GuardSuppressed"
  | "GuardDeleted"
  /* --- export (Phase 5) --- */
  | "ExportCompiled"
  | "ExportStamped"
  | "ExportIntegrityMismatch"
  /* --- system --- */
  | "EngineSwitched"
  | "IndexRebuilt"
  | "IndexStale"
  | "LogImported"
  | "SchemaMigrated";

/** The subset that changes graph state and therefore MUST carry a reason. */
export const STATE_CHANGING_EVENTS = [
  "DecisionApproved",
  "DecisionEdited",
  "DecisionRejected",
  "PremiseConfirmed",
  "PremiseCorrected",
  "JustificationAttached",
  "LabelChanged",
  "PremiseInvalidated",
  "NogoodRecorded",
  "CascadePropagated",
  "RevisionProposed",
  "DecisionReversed",
  "DecisionRejustified",
  "PremiseContested",
  "DecisionSuperseded",
  "HumanOverride",
  "GuardAccepted",
  "GuardFailed",
  "GuardSuppressed",
  "GuardDeleted",
] as const satisfies readonly EventType[];

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every event, regardless of payload, carries these fields.
 *
 * `occurredAt` vs `at` is the bi-temporal split:
 *   occurredAt — when it became true in the world  (valid time, t1)
 *   at         — when WhyLog recorded it           (learned time, t2)
 * They are equal for live input and differ on historical transcript import.
 */
export interface DomainEvent<T extends EventType = EventType, P = unknown> {
  readonly id: EventId;
  readonly type: T;
  /** Learned time (t2). */
  readonly at: ISODateString;
  /** Valid time (t1). Defaults to `at` unless the caller knows better. */
  readonly occurredAt: ISODateString;
  readonly actor: Actor;
  readonly payload: P;
  /** MANDATORY (non-empty) for every type in STATE_CHANGING_EVENTS. */
  readonly reason: string;
  /** Hash chain link. h(n) = hash(h(n-1) || event(n)). See src/substrate/hash-chain.ts */
  readonly prevHash: string;
  /**
   * Hash of this event's own CONTENT (everything except `prevHash` and
   * `selfHash`).
   *
   * Without it, an edited payload is only detectable at the NEXT event, because
   * that is where the chain links stop matching. Carrying the content hash on
   * the event itself means the edit is reported AT the event that was edited,
   * which is what plan/phase-0-foundation.md §0.5 asks for — and it means the
   * last event in the chain is protected too, instead of relying on the
   * head-hash comparison to catch it.
   */
  readonly selfHash: string;
  /** Schema version at write time, so migrations can be replayed. */
  readonly schemaVersion: number;
}

/* -------------------------------------------------------------------------- */
/* Payloads — ingest                                                          */
/* -------------------------------------------------------------------------- */

export interface TranscriptImportedPayload {
  readonly transcriptId: TranscriptId;
  readonly rawChars: number;
  /** Optional user-supplied label ("cursor session, oct 3"). */
  readonly label?: string;
  /** When the transcript happened, if known. Drives `occurredAt` on every
   *  event derived from it. Absent => import time, flagged uncertain. */
  readonly occurredAt?: ISODateString;
  readonly engine: EngineId;
}

/* -------------------------------------------------------------------------- */
/* Payloads — extraction (Phase 1)                                            */
/* -------------------------------------------------------------------------- */

export interface DecisionProposedPayload {
  readonly decisionId: DecisionId;
  readonly transcriptId: TranscriptId;
  readonly episodeId: EpisodeId;
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  readonly rationale?: string;
  readonly acceptedDownside?: string;
  readonly origin: DecisionOrigin;
  readonly modality: "asserted" | "proposed" | "hypothetical" | "reported";
  readonly confidence: Confidence;
  readonly engine: EngineId;
  readonly snippet: SourceSpan;
  /** Links to premises proposed in the same batch. Resolved at approval. */
  readonly premiseIds: readonly PremiseId[];
  readonly alternativeIds: readonly AlternativeId[];
}

export interface PremiseAssertedPayload {
  readonly premiseId: PremiseId;
  readonly transcriptId: TranscriptId;
  readonly type: PremiseType;
  /** Namespaced predicate, e.g. "scale.max_users". Identity is type+predicate
   *  wherever possible — see src/substrate/identity.ts resolution ladder. */
  readonly predicate: string;
  readonly value?: string | number | boolean;
  readonly text: string;
  readonly confidence: Confidence;
  readonly engine: EngineId;
  readonly snippet: SourceSpan;
}

export interface AlternativeRejectedPayload {
  readonly alternativeId: AlternativeId;
  readonly decisionId: DecisionId;
  readonly variable: DecisionVariable;
  readonly value: string;
  /** An alternative with no whyRejected is stored but EXCLUDED from the
   *  pre-emption index — pre-empting without a reason is just nagging. */
  readonly whyRejected?: string;
  readonly confidence: Confidence;
  readonly engine: EngineId;
  readonly snippet: SourceSpan;
}

export interface ExtractionDiscardedPayload {
  readonly candidateKind: "decision" | "premise" | "alternative";
  readonly discardedBy: "confidence-threshold" | "modality" | "duplicate" | "human";
  readonly rawText: string;
  readonly confidence: Confidence;
}

/* -------------------------------------------------------------------------- */
/* Payloads — review (Phase 1.9)                                              */
/* -------------------------------------------------------------------------- */

export interface DecisionApprovedPayload {
  readonly decisionId: DecisionId;
  readonly viaBulkApprove: boolean;
}

export interface DecisionEditedPayload {
  readonly decisionId: DecisionId;
  /** Field name => new value. The ORIGINAL extraction is preserved on the
   *  DecisionProposed event, so edits never destroy provenance. */
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DecisionRejectedPayload {
  readonly decisionId: DecisionId;
}

export interface PremiseConfirmedPayload {
  readonly premiseId: PremiseId;
}

export interface PremiseCorrectedPayload {
  readonly premiseId: PremiseId;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

/* -------------------------------------------------------------------------- */
/* Payloads — reasoning (Phase 2)                                             */
/* -------------------------------------------------------------------------- */

export interface JustificationAttachedPayload {
  readonly justificationId: JustificationId;
  readonly consequent: DecisionId;
  /** Doyle's SL-justification. IN-list must all be IN; OUT-list must all be
   *  OUT. A non-empty OUT-list is a NON-MONOTONIC justification and is the
   *  mechanism behind gate (c). See docs/02 §2.1. */
  readonly justification: Justification;
}

export interface LabelChangedPayload {
  readonly nodeId: DecisionId | PremiseId;
  readonly from: DecisionLabel;
  readonly to: DecisionLabel;
  /** Which justification failed, and which premise caused it. */
  readonly invalidJustificationId?: JustificationId;
  readonly triggerPremiseId?: PremiseId;
  readonly gate?: "structural" | "semantic" | "premise" | "cascade";
}

export interface ContradictionDetectedPayload {
  readonly gate: "structural" | "semantic" | "premise";
  readonly verdict: ContradictionVerdict;
  readonly decisionA: DecisionId;
  readonly decisionB?: DecisionId;
  readonly premiseId?: PremiseId;
  readonly explanation: string;
  /** M1 = similar decisions, contradictory rationales (probable
   *  misunderstanding). M2 = contradictory decisions, similar rationales
   *  (probable copy-paste or extraction error). Borrowed from arXiv:2506.11005. */
  readonly diagnostic?: "M1" | "M2";
  readonly engine: EngineId;
}

export interface PremiseInvalidatedPayload {
  readonly premiseId: PremiseId;
  /** What falsified it: a transcript assertion, a guard, or a human. */
  readonly invalidatedBy:
    | { readonly kind: "assertion"; readonly eventId: EventId }
    | { readonly kind: "guard"; readonly guardId: GuardId }
    | { readonly kind: "human" };
  readonly evidenceSpan?: SourceSpan;
}

export interface NogoodRecordedPayload {
  readonly nogoodId: NogoodId;
  /** The conjunction of assumptions that cannot all hold. Displayed to the
   *  user as the explanation, and reused to block re-assertion. */
  readonly premiseIds: readonly PremiseId[];
  readonly derivedFrom: EventId;
}

export interface CascadePropagatedPayload {
  readonly from: DecisionId | PremiseId;
  readonly to: DecisionId;
  readonly depth: number;
  /** True when propagation STOPPED here because the node had an independent
   *  surviving justification. Zombie-belief prevention — the stop condition
   *  is the design, not an optimisation. See docs/02 §5 step 6. */
  readonly stoppedAtIndependentSupport: boolean;
}

/* -------------------------------------------------------------------------- */
/* Payloads — revision (Phase 2.9)                                            */
/* -------------------------------------------------------------------------- */

export interface RevisionProposedPayload {
  readonly proposalId: ProposalId;
  readonly unsoundDecisionId: DecisionId;
  readonly failedPremiseId: PremiseId;
  readonly nogoodId?: NogoodId;
  readonly cascade: readonly { decisionId: DecisionId; became: DecisionLabel }[];
  readonly survivors: readonly DecisionId[];
  readonly entrenchment: EntrenchmentBreakdown;
  /** Set when the newcomer was screened out rather than applied. */
  readonly rejectedNewcomer?: { readonly eventId: EventId; readonly why: string };
  readonly availableActions: readonly ("reverse" | "rejustify" | "contest")[];
}

export interface DecisionReversedPayload {
  readonly decisionId: DecisionId;
  readonly newValue: string;
  readonly supersedesEventId: EventId;
}

export interface DecisionRejustifiedPayload {
  readonly decisionId: DecisionId;
  /** The NEW premise the user supplied to keep the decision standing. This is
   *  the most common real outcome and is absent from every prior system. */
  readonly newPremiseId: PremiseId;
  readonly newJustificationId: JustificationId;
}

export interface PremiseContestedPayload {
  readonly premiseId: PremiseId;
}

export interface DecisionSupersededPayload {
  readonly oldDecisionId: DecisionId;
  readonly newDecisionId: DecisionId;
}

export interface HumanOverridePayload {
  readonly proposalId: ProposalId;
  /** Overrides non-prioritized screening. Raises the newcomer's
   *  source_authority to 0.9 on subsequent adjudications. */
  readonly overriddenDecisionId: DecisionId;
}

/* -------------------------------------------------------------------------- */
/* Payloads — verification (Phase 4)                                          */
/* -------------------------------------------------------------------------- */

export interface GuardSynthesisedPayload {
  readonly guardId: GuardId;
  readonly decisionId: DecisionId;
  readonly kind: GuardKind;
  readonly spec: GuardSpec;
  readonly severity: GuardSeverity;
  readonly rationale: string;
  readonly generatedBy: "template" | "llm" | "user";
}

export interface GuardAcceptedPayload {
  readonly guardId: GuardId;
}

export interface GuardRanPayload {
  readonly guardId: GuardId;
  readonly result: "pass" | "fail" | "skip";
  /** The exact line or file that produced the result. Quoted verbatim into the
   *  revision proposal, because evidence without a quote is not evidence. */
  readonly evidence: string;
  readonly ranAt: ISODateString;
}

export interface GuardFailedPayload extends GuardRanPayload {
  readonly result: "fail";
  /** Which premise the failure falsifies, if any. Determines whether gate (c)
   *  or gate (a) handles it. See docs/04 §6. */
  readonly falsifiesPremiseId?: PremiseId;
  readonly firstFailedAt: ISODateString;
}

export interface GuardSuppressedPayload {
  readonly guardId: GuardId;
  readonly suppressionReason: string;
}

export interface GuardDeletedPayload {
  readonly guardId: GuardId;
}

/* -------------------------------------------------------------------------- */
/* Payloads — export (Phase 5)                                                */
/* -------------------------------------------------------------------------- */

export interface ExportCompiledPayload {
  readonly exportId: ExportId;
  readonly targets: readonly ExportTarget[];
  readonly decisionsIncluded: number;
  readonly decisionsLinkedOut: number;
  readonly lineCount: number;
}

export interface ExportStampedPayload {
  readonly exportId: ExportId;
  readonly stamp: IntegrityStamp;
}

export interface ExportIntegrityMismatchPayload {
  readonly path: string;
  readonly expectedHead: string;
  readonly foundHead: string | null;
}

/* -------------------------------------------------------------------------- */
/* Payloads — system                                                          */
/* -------------------------------------------------------------------------- */

export interface EngineSwitchedPayload {
  readonly from: EngineId;
  readonly to: EngineId;
}

export interface IndexRebuiltPayload {
  readonly engine: EngineId;
  readonly decisionsIndexed: number;
  readonly levels: readonly ("L1" | "L2" | "L3" | "L4" | "L5")[];
}

/** Cosine similarity across embedding spaces is meaningless. Switching engine
 *  marks the index stale rather than silently mixing vector spaces. */
export interface IndexStalePayload {
  readonly staleEngine: EngineId;
  readonly currentEngine: EngineId;
}

export interface LogImportedPayload {
  readonly sourceHeadHash: string;
  readonly eventsImported: number;
  readonly merged: number;
  readonly created: number;
}

export interface SchemaMigratedPayload {
  readonly fromVersion: number;
  readonly toVersion: number;
}

/* -------------------------------------------------------------------------- */
/* Type-level payload map — keeps `DomainEvent<T, P>` honest                  */
/* -------------------------------------------------------------------------- */

export interface EventPayloadMap {
  TranscriptImported: TranscriptImportedPayload;
  DecisionProposed: DecisionProposedPayload;
  PremiseAsserted: PremiseAssertedPayload;
  AlternativeRejected: AlternativeRejectedPayload;
  ExtractionDiscarded: ExtractionDiscardedPayload;
  DecisionApproved: DecisionApprovedPayload;
  DecisionEdited: DecisionEditedPayload;
  DecisionRejected: DecisionRejectedPayload;
  PremiseConfirmed: PremiseConfirmedPayload;
  PremiseCorrected: PremiseCorrectedPayload;
  JustificationAttached: JustificationAttachedPayload;
  LabelChanged: LabelChangedPayload;
  ContradictionDetected: ContradictionDetectedPayload;
  PremiseInvalidated: PremiseInvalidatedPayload;
  NogoodRecorded: NogoodRecordedPayload;
  CascadePropagated: CascadePropagatedPayload;
  RevisionProposed: RevisionProposedPayload;
  DecisionReversed: DecisionReversedPayload;
  DecisionRejustified: DecisionRejustifiedPayload;
  PremiseContested: PremiseContestedPayload;
  DecisionSuperseded: DecisionSupersededPayload;
  HumanOverride: HumanOverridePayload;
  GuardSynthesised: GuardSynthesisedPayload;
  GuardAccepted: GuardAcceptedPayload;
  GuardRan: GuardRanPayload;
  GuardFailed: GuardFailedPayload;
  GuardSuppressed: GuardSuppressedPayload;
  GuardDeleted: GuardDeletedPayload;
  ExportCompiled: ExportCompiledPayload;
  ExportStamped: ExportStampedPayload;
  ExportIntegrityMismatch: ExportIntegrityMismatchPayload;
  EngineSwitched: EngineSwitchedPayload;
  IndexRebuilt: IndexRebuiltPayload;
  IndexStale: IndexStalePayload;
  LogImported: LogImportedPayload;
  SchemaMigrated: SchemaMigratedPayload;
}

/** A fully-typed event: `TypedEvent<"GuardFailed">` has the right payload. */
export type TypedEvent<T extends EventType> = DomainEvent<T, EventPayloadMap[T]>;

/** Any event. This is what the log stores. */
export type AnyEvent = {
  readonly [K in EventType]: TypedEvent<K>;
}[EventType];

/* -------------------------------------------------------------------------- */
/* Construction & validation contracts                                        */
/* -------------------------------------------------------------------------- */

export interface NewEvent<T extends EventType> {
  readonly type: T;
  readonly payload: EventPayloadMap[T];
  readonly actor: Actor;
  readonly reason: string;
  readonly at?: ISODateString;
  readonly occurredAt?: ISODateString;
}

/**
 * Validation rules enforced by src/substrate/event-log.ts on append:
 *
 *  1. `type` is a member of EventType (closed vocabulary).
 *  2. `reason` is non-empty for every type in STATE_CHANGING_EVENTS.
 *  3. `prevHash` equals the current head hash.
 *  4. `at` >= the previous event's `at` (learned time is monotonic).
 *  5. `occurredAt` may be in the past — that is the point of bi-temporality.
 *  6. The payload matches the shape declared in EventPayloadMap.
 *  7. `selfHash` equals the hash of the event's own content.
 *
 * A violation throws; the log is never partially appended.
 */
export interface EventValidator {
  validate(event: AnyEvent, expectedPrevHash: string): ValidationResult;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly rule: number; readonly message: string };

/** Narrowing helper for switch statements over `AnyEvent`. */
export function isEventType<T extends EventType>(
  event: DomainEvent,
  type: T,
): event is DomainEvent<T, EventPayloadMap[T]> {
  return event.type === type;
}

/** Convenience: does this event type require a reason? */
export function requiresReason(type: EventType): boolean {
  return (STATE_CHANGING_EVENTS as readonly EventType[]).includes(type);
}

/** Unused-import guard for the type-only imports above. Retrieval hits are
 *  referenced by RevisionProposedPayload consumers, not by this module. */
export type _EventTypesReferenced = RetrievedHit | GroundednessVerdict | BiTemporal;
