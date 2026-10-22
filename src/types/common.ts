/**
 * Shared primitives.
 *
 * Phase 0 · sub-phase 0.1
 * Plan:     plan/phase-0-foundation.md
 * Research: docs/02-truth-maintenance-theory.md §4
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I1 — nothing is deleted, everything is an event.
 * Every type in this file is designed so that state changes are expressible
 * as an append-only event rather than a mutation. If you find yourself adding
 * a mutable field to a node, you probably want an event instead.
 * ---------------------------------------------------------------------------
 */

/** A nominal string type. Prevents passing a `PremiseId` where a `DecisionId`
 *  is expected, which matters because both are opaque strings at runtime. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type EventId = Brand<string, "EventId">;
export type TranscriptId = Brand<string, "TranscriptId">;
export type EpisodeId = Brand<string, "EpisodeId">;
export type PremiseId = Brand<string, "PremiseId">;
export type DecisionId = Brand<string, "DecisionId">;
export type AlternativeId = Brand<string, "AlternativeId">;
export type JustificationId = Brand<string, "JustificationId">;
export type GuardId = Brand<string, "GuardId">;
export type NogoodId = Brand<string, "NogoodId">;
export type ProposalId = Brand<string, "ProposalId">;
export type ExportId = Brand<string, "ExportId">;

/** ISO-8601 string. Always UTC-normalised on write, localised on render. */
export type ISODateString = Brand<string, "ISODateString">;

/**
 * Which engine produced a result.
 *
 * Stored ON THE NODE, not merely displayed — a decision extracted six months
 * ago by a different engine must still report its origin honestly.
 * See plan/OVERVIEW.md §8 (the AI seam) and invariant "badged, never mixed".
 */
export type EngineKind = "llm" | "local";

/** Identifies the exact engine + model that produced a derived artifact.
 *  Two vectors from different `EngineId`s must never be compared by cosine —
 *  see src/substrate/index-artifacts.ts. */
export interface EngineId {
  readonly kind: EngineKind;
  /** e.g. "gpt-4o-mini", "hashed-ngram-v1". Empty string for `local`. */
  readonly model: string;
}

/**
 * Who caused an event.
 *
 * Drives the `source_authority` term of the entrenchment function
 * (docs/02-truth-maintenance-theory.md §3.4) and the agency ledger
 * (plan/phase-6-presentation.md §6.4).
 */
export type Actor =
  | { readonly kind: "human" }
  | { readonly kind: "engine"; readonly engine: EngineId }
  | { readonly kind: "guard"; readonly guardId: GuardId }
  | { readonly kind: "system" };

/**
 * Bi-temporal pair. Graphiti's model, adopted wholesale.
 *
 * `valid`   — when it became true IN THE WORLD   (t1 axis)
 * `learned` — when WhyLog FOUND OUT about it     (t2 axis)
 *
 * These diverge constantly in WhyLog's real workflow: you paste a three-week
 * old transcript, so the system learns today about a decision made on the 3rd.
 * A single-timestamp model orders that graph wrongly and the timeline lies.
 *
 * RULE: ordering, chronology and recency-entrenchment use `valid`.
 *       the audit trail uses `learned`.
 * See plan/phase-0-foundation.md §0.3.
 */
export interface BiTemporal {
  readonly valid: ISODateString;
  readonly learned: ISODateString;
}

/** A closed validity window. Nodes are closed out, never deleted (I1). */
export interface ValidityWindow extends BiTemporal {
  /** Absent while the node is still current. */
  readonly invalidFrom?: ISODateString;
  /** The event that closed the window. Absent iff `invalidFrom` is absent. */
  readonly invalidatedBy?: EventId;
  /** Human-readable reason. MANDATORY for every state-changing event. */
  readonly reason?: string;
}

/** Confidence in [0, 1]. Extraction assigns it; see src/extraction/confidence.ts */
export type Confidence = number & { readonly __confidence: unique symbol };

/** A verbatim slice of source text, with its offset back into the raw input.
 *  Without `span`, citations cannot resolve and the evidence contract
 *  (docs/03-retrieval-and-contradiction.md §5) collapses. */
export interface SourceSpan {
  readonly transcriptId: TranscriptId;
  /** Inclusive start, exclusive end, in characters of the RAW input. */
  readonly start: number;
  readonly end: number;
  /** VERBATIM text. On the LLM path every snippet is validated as a literal
   *  substring of the input and discarded if it is not — paraphrased snippets
   *  rot the evidence contract silently. See src/extraction/provenance.ts. */
  readonly text: string;
}

/** Frozen, serialisable record marker. Every persisted shape extends this. */
export interface Record_ {
  readonly id: string;
}

/** Runtime brand constructors. Keep them here so ids are minted one way. */
export const asEventId = (s: string): EventId => s as EventId;
export const asDecisionId = (s: string): DecisionId => s as DecisionId;
export const asPremiseId = (s: string): PremiseId => s as PremiseId;
export const asGuardId = (s: string): GuardId => s as GuardId;
export const asISO = (s: string): ISODateString => s as ISODateString;
export const asConfidence = (n: number): Confidence => Math.min(1, Math.max(0, n)) as Confidence;

/**
 * The engine used for every operation is reported. Never let the UI imply a
 * capability it does not have. See plan/phase-6-presentation.md §6.8.
 */
export interface EngineStamped {
  readonly engine: EngineId;
}
