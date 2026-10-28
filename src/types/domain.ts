/**
 * The domain model: decisions, premises, justifications, labels.
 *
 * Phase 0 · sub-phase 0.7 (ontology) and Phase 1 (extraction output)
 * Plan:     plan/phase-0-foundation.md §0.7
 *           plan/phase-1-extraction-pipeline.md §1.3–1.6
 * Research: docs/02-truth-maintenance-theory.md §4.1–4.3
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I2 — premises are SHARED NODES, not per-decision strings.
 *
 * "single-user" is ONE premise node that three decisions point at. Invalidate
 * it once and all three flip, via an exact graph traversal. If premises were
 * strings inside each decision's rationale, invalidation would require fuzzy
 * matching every decision — and cascade would be impossible.
 *
 * This is the structural difference between a truth-maintenance system and a
 * notes app with tags. It is also the invariant most likely to be quietly
 * abandoned under time pressure. Do not abandon it.
 * ---------------------------------------------------------------------------
 */

import type {
  AlternativeId,
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  EventId,
  GuardId,
  ISODateString,
  JustificationId,
  PremiseId,
  SourceSpan,
  TranscriptId,
  ValidityWindow,
} from "./common";

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * JTMS label. Note: IN does not mean TRUE — it means SUPPORTED.
 * A decision can be IN and wrong, or OUT and still worth reading.
 * See docs/02-truth-maintenance-theory.md §2.
 */
export type DecisionLabel =
  /** Has >= 1 valid, well-founded justification. */
  | "IN"
  /** Every justification is invalid. Retained, never deleted (I1). */
  | "OUT"
  /** Premises neither confirmed nor refuted. */
  | "UNKNOWN"
  /** Justification chain is circular, or never reaches a premise node.
   *  A DATA-QUALITY warning, not a truth claim. An LLM extractor will produce
   *  these; labelling them is more honest than silently marking them IN. */
  | "UNFOUNDED";

/** Lifecycle state, orthogonal to the label. */
export type DecisionStatus = "proposed" | "active" | "contested" | "superseded" | "archived";

/* -------------------------------------------------------------------------- */
/* The decision variable ontology                                             */
/* -------------------------------------------------------------------------- */

/**
 * The 14 typed slots from Phase 0.7 table A, plus OTHER.
 *
 * `OTHER` is an escape hatch, not a category. Its usage rate is tracked: if it
 * exceeds ~15% of the fixture corpus the ontology needs extending before
 * Phase 1's output can be trusted.
 */
export type DecisionVariable =
  | "DATABASE"
  | "AUTH"
  | "HOSTING"
  | "FRAMEWORK"
  | "LANGUAGE"
  | "STORAGE"
  | "API_STYLE"
  | "STATE"
  | "TESTING"
  | "UI_KIT"
  | "PAYMENTS"
  | "RETRIEVAL"
  | "ARCHITECTURE"
  | "SCOPE"
  | "OTHER";

export const DECISION_VARIABLES: readonly DecisionVariable[] = [
  "DATABASE",
  "AUTH",
  "HOSTING",
  "FRAMEWORK",
  "LANGUAGE",
  "STORAGE",
  "API_STYLE",
  "STATE",
  "TESTING",
  "UI_KIT",
  "PAYMENTS",
  "RETRIEVAL",
  "ARCHITECTURE",
  "SCOPE",
  "OTHER",
] as const;

/**
 * Premise types: a CLOSED SET OF 8.
 *
 * Bounded recovery beats open-ended recovery. RAAM's own precision problem is
 * unbounded assumption discovery — see docs/05-rationale-mining-literature.md
 * §2.1. Do not add a ninth type casually.
 */
export type PremiseType =
  | "scale"
  | "team"
  | "budget"
  | "time"
  | "deployment"
  | "capability"
  | "requirement"
  | "external";

export const PREMISE_TYPES: readonly PremiseType[] = [
  "scale",
  "team",
  "budget",
  "time",
  "deployment",
  "capability",
  "requirement",
  "external",
] as const;

/**
 * World-observable premises can be falsified by a guard or a repo scan.
 * Intent-based premises can only be retracted by a human.
 *
 * This flag drives Phase 2's cascade behaviour and Phase 4's guard synthesis:
 * there is no point synthesising a guard for `budget`.
 */
export const WORLD_OBSERVABLE_PREMISE_TYPES: readonly PremiseType[] = [
  "scale",
  "deployment",
  "capability",
  "external",
] as const;

export function isWorldObservable(type: PremiseType): boolean {
  return (WORLD_OBSERVABLE_PREMISE_TYPES as readonly PremiseType[]).includes(type);
}

/* -------------------------------------------------------------------------- */
/* Provenance & origin                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Who originated the decision. Derived from speaker attribution (Phase 1.1)
 * plus modality (Phase 1.3).
 *
 * Maps directly onto the `source_authority` term of the entrenchment function
 * (docs/02 §3.4) and onto the agency ledger (plan/phase-6 §6.4).
 */
export type DecisionOrigin =
  | "human_stated"
  | "agent_proposed_human_accepted"
  | "agent_inferred"
  | "human_override";

export const ORIGIN_AUTHORITY: Readonly<Record<DecisionOrigin, number>> = {
  human_stated: 1.0,
  human_override: 0.9,
  agent_proposed_human_accepted: 0.8,
  agent_inferred: 0.4,
};

/**
 * Modality. ONLY `asserted` creates an IN-labelled node.
 *
 * "what if we used Redis?" and "you could consider Redis" must never become
 * decisions. This single field prevents most extraction-driven false
 * contradictions. Rationale Miner found negation terms in only 12% of
 * rationale sentences — polarity is rarely explicit, so modality must be
 * inferred and enforced here.
 */
export type Modality = "asserted" | "proposed" | "hypothetical" | "reported";

export interface Provenance {
  readonly transcriptId: TranscriptId;
  readonly episodeId: EpisodeId;
  /** VERBATIM. Validated as a literal substring on the LLM path. */
  readonly snippet: SourceSpan;
  readonly origin: DecisionOrigin;
  readonly extractedBy: EngineId;
  readonly confidence: Confidence;
}

/* -------------------------------------------------------------------------- */
/* Premise                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An assumption about the world that a decision rests on.
 *
 * Premises are SHARED (invariant I2) and are the nodes that gate (c) —
 * premise invalidation — operates on. Gate (c) is the case where nothing
 * contradicts you and the world simply moved.
 */
export interface Premise {
  readonly id: PremiseId;
  readonly type: PremiseType;
  /** Namespaced: "scale.max_users", "deployment.model", "budget.monthly_usd".
   *  Identity resolution is PREDICATE-FIRST — see src/substrate/identity.ts. */
  readonly predicate: string;
  readonly value?: string | number | boolean | undefined;
  /** The natural-language form, e.g. "the app has a single user". */
  readonly text: string;

  readonly label: DecisionLabel;

  /** Every independent observation supporting or refuting this premise. */
  readonly evidence: readonly PremiseEvidence[];

  readonly temporal: ValidityWindow;

  /** Log-scaled count of independent justifications referencing this node. */
  readonly corroboration: number;
  readonly confidence: Confidence;

  /** Merging across premise TYPES is forbidden regardless of text similarity:
   *  "single user" (scale) and "single sign-on user flow" (requirement) are
   *  never the same node. A false merge produces a spectacular wrong cascade. */
  readonly resolvedFrom: readonly EventId[];
}

export interface PremiseEvidence {
  readonly kind: "transcript" | "guard" | "human" | "repo-scan";
  readonly supports: boolean;
  readonly span?: SourceSpan;
  readonly eventId: EventId;
  readonly at: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* Rejected alternative                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The road not taken.
 *
 * ARGUS measured 15.4% precision on Alternatives — the worst of any rationale
 * component — but also found that alternatives occur almost exclusively in
 * DISCUSSION. A transcript is continuous discussion, so it is the richest
 * available source. See docs/05 §4.
 *
 * Alternatives are indexed FIRST-CLASS (src/retrieval/preemption.ts) so that
 * proposing one triggers a warning BEFORE the decision rather than after.
 */
export interface RejectedAlternative {
  readonly id: AlternativeId;
  readonly decisionId: DecisionId;
  readonly variable: DecisionVariable;
  readonly value: string;
  /** Without this the alternative is stored but EXCLUDED from the
   *  pre-emption index. */
  readonly whyRejected?: string;
  readonly snippet: SourceSpan;
  readonly confidence: Confidence;
  /** Alternatives require explicit confirmation before entering the
   *  pre-emption index. A false pre-emption is worse than none. */
  readonly confirmedByHuman: boolean;
}

/* -------------------------------------------------------------------------- */
/* Decision                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A decision node.
 *
 * Formally: a belief held under a set of assumptions. NOT a fact. The whole
 * product follows from that distinction.
 */
export interface Decision {
  /** Stable, addressable, never renumbered, never reused: "WLD-0007". */
  readonly id: DecisionId;

  readonly variable: DecisionVariable;
  /** Canonicalised via the ontology alias table. */
  readonly value: string;
  /** Short imperative form: "Use SQLite, not Postgres". */
  readonly statement: string;
  /** Full Y-statement form where recoverable:
   *  "In the context of <premises>, facing <concern>, we decided for <value>
   *   to achieve <quality>, accepting <downside>."
   *  Named slots are extractable and the output is self-justifying in export. */
  readonly yStatement?: string | undefined;
  readonly rationale?: string | undefined;
  /** Nobody stores this, and it is precisely what a future you needs when the
   *  downside arrives. */
  readonly acceptedDownside?: string | undefined;

  readonly label: DecisionLabel;
  readonly status: DecisionStatus;
  readonly modality: Modality;

  readonly justificationIds: readonly JustificationId[];
  readonly alternativeIds: readonly AlternativeId[];
  readonly guardIds: readonly GuardId[];

  readonly edges: DecisionEdges;
  readonly provenance: Provenance;
  readonly temporal: ValidityWindow;

  readonly entrenchment: number;
  readonly corroboration: number;

  /** File globs this decision governs. Drives `applies_to` in export
   *  (plan/phase-5 §5.3) and guard scoping (plan/phase-4 §4.2). */
  readonly appliesTo: readonly string[];

  /** "template" | "llm" | none — whether a guard could be synthesised.
   *  A decision with no synthesizable guard is marked `unverifiable`, never
   *  silently skipped. See docs/04 §4.2. */
  readonly verifiability: "verified" | "unverifiable" | "pending";
}

export interface DecisionEdges {
  readonly supersedes: readonly DecisionId[];
  readonly supersededBy: readonly DecisionId[];
  readonly conflictsWith: readonly DecisionId[];
  readonly dependsOn: readonly DecisionId[];
  /** Derived from shared premise membership; materialised for the lattice
   *  view (plan/phase-6 §6.6). */
  readonly sharesPremiseWith: readonly DecisionId[];
  /** Topically related, logically compatible. NEVER a cascade path. */
  readonly related: readonly DecisionId[];
}

/* -------------------------------------------------------------------------- */
/* Justification                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Doyle's support-list justification.
 *
 * VALID iff every node in `inList` is IN **and no node in `outList` is IN**.
 *
 * A non-empty `outList` makes this a NON-MONOTONIC justification — the
 * mechanism that detects invalidation when the user never states a
 * contradiction. Extracting EXCLUDED conditions is as important as extracting
 * supporting conditions. See docs/02 §2.1.
 */
export interface Justification {
  readonly id: JustificationId;
  readonly consequent: DecisionId;
  readonly inList: readonly PremiseId[];
  readonly outList: readonly PremiseId[];
  /** What produced this justification. */
  readonly informant:
    | { readonly kind: "extraction"; readonly engine: EngineId; readonly eventId: EventId }
    | { readonly kind: "human" }
    | { readonly kind: "rejustification"; readonly eventId: EventId };
  readonly createdAt: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* Nogood                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A recorded impossible conjunction of assumptions (ATMS borrowing).
 *
 * In classical TMS a nogood is internal bookkeeping. Here it is THE
 * EXPLANATION: "these two assumptions cannot both hold" is the single most
 * useful sentence the system can produce. Display it prominently, and check
 * new proposals against recorded nogoods before suggesting them.
 */
export interface Nogood {
  readonly id: string;
  readonly premiseIds: readonly PremiseId[];
  readonly derivedFrom: EventId;
  readonly recordedAt: ISODateString;
  readonly explanation: string;
}

/* -------------------------------------------------------------------------- */
/* Transcript & episode                                                       */
/* -------------------------------------------------------------------------- */

export interface Transcript {
  readonly id: TranscriptId;
  readonly label?: string;
  readonly rawChars: number;
  readonly importedAt: ISODateString;
  /** When the conversation happened, if known. Drives `occurredAt` on derived
   *  events; absent => import time, flagged uncertain. */
  readonly occurredAt?: ISODateString;
  readonly episodeIds: readonly EpisodeId[];
}

/**
 * A decision EPISODE: a window of consecutive turns bounded by topic shift,
 * containing at least one decision cue.
 *
 * Deliberate deviation from arXiv:2506.11005, which assumes rationale sits in
 * a SINGLE sentence. That holds for commit messages; it does not hold for
 * dialogue, where a decision is negotiated across four turns and the premise
 * often appears BEFORE the decision it supports.
 * See plan/phase-1-extraction-pipeline.md §1.2.
 */
export interface Episode {
  readonly id: EpisodeId;
  readonly transcriptId: TranscriptId;
  readonly variable?: DecisionVariable;
  readonly turnRange: readonly [start: number, end: number];
  readonly charRange: readonly [start: number, end: number];
}

/* -------------------------------------------------------------------------- */
/* The knowledge base                                                         */
/* -------------------------------------------------------------------------- */

/**
 * K = < D, P, J, L, N >  — docs/02-truth-maintenance-theory.md §4.1
 *
 * This is the MATERIALISED projection, derived from the event log by a pure
 * fold. It is a cache: disposable, rebuildable, never authoritative.
 * See src/substrate/materialize.ts.
 */
export interface DecisionKnowledgeBase {
  readonly decisions: ReadonlyMap<DecisionId, Decision>;
  readonly premises: ReadonlyMap<PremiseId, Premise>;
  readonly justifications: ReadonlyMap<JustificationId, Justification>;
  readonly nogoods: readonly Nogood[];
  readonly transcripts: ReadonlyMap<TranscriptId, Transcript>;
  readonly episodes: ReadonlyMap<EpisodeId, Episode>;
  readonly alternatives: ReadonlyMap<AlternativeId, RejectedAlternative>;
}

/** An empty knowledge base. The fold's identity element. */
export const EMPTY_KB: DecisionKnowledgeBase = {
  decisions: new Map(),
  premises: new Map(),
  justifications: new Map(),
  nogoods: [],
  transcripts: new Map(),
  episodes: new Map(),
  alternatives: new Map(),
};

/* -------------------------------------------------------------------------- */
/* Bi-temporal query support                                                  */
/* -------------------------------------------------------------------------- */

export interface AsOfQuery {
  /** Which timeline to cut on. "valid" = what was true then;
   *  "learned" = what the system knew then. They diverge constantly. */
  readonly axis: "valid" | "learned";
  readonly at: ISODateString;
}
