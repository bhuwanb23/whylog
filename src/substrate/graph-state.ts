/**
 * The materialised graph state.
 *
 * Phase 0 · sub-phase 0.2
 * Plan: plan/phase-0-foundation.md §0.2
 *
 * ---------------------------------------------------------------------------
 * THIS IS A CACHE, NOT THE DATABASE
 *
 * The event log is the only authoritative artifact. `GraphState` is what you get
 * when you fold the log, and it can be thrown away and rebuilt at any moment
 * without losing anything. Every field here is derived; none is written by hand.
 *
 * The discipline that keeps this true:
 *   1. `applyEvent` is the ONLY function that produces a new state.
 *   2. Nothing outside src/substrate constructs a GraphState.
 *   3. Nothing mutates a state in place — the maps are exposed as ReadonlyMap.
 *
 * If any of those three slips, the log stops being the source of truth and the
 * round-trip guarantee (export -> import -> identical head hash) goes with it.
 * ---------------------------------------------------------------------------
 */

import type {
  AlternativeId,
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
  TranscriptId,
} from "@/types/common";
import type {
  Decision,
  DecisionLabel,
  DecisionVariable,
  Episode,
  Justification,
  Nogood,
  Premise,
  PremiseType,
  RejectedAlternative,
  Transcript,
} from "@/types/domain";
import type { AnyEvent } from "@/types/events";
import type { ExportStats, IntegrityStamp } from "@/types/export";
import type { Guard } from "@/types/guards";
import type { RevisionProposal } from "@/types/reasoning";
import type { ContradictionGate, ContradictionVerdict, IndexLevel } from "@/types/retrieval";
import { GENESIS_HASH } from "./hash-chain";
import { SCHEMA_VERSION } from "./schema";

/* -------------------------------------------------------------------------- */
/* Derived records that live only in projections                              */
/* -------------------------------------------------------------------------- */

/**
 * A detected contradiction, as projected from `ContradictionDetected` events.
 *
 * Kept separate from the reasoning layer's live detection result: this is the
 * RECORD of a detection that happened, with the gate and verdict that produced
 * it. The conflict view (Phase 6.4) and the false-positive metric (Phase 7.3)
 * both read this, and the metric needs the history, not the current state.
 */
export interface ContradictionRecord {
  readonly id: EventId;
  readonly gate: ContradictionGate;
  readonly verdict: ContradictionVerdict;
  readonly decisionA: DecisionId;
  readonly decisionB?: DecisionId;
  readonly premiseId?: PremiseId;
  readonly explanation: string;
  readonly diagnostic?: "M1" | "M2";
  readonly engine: EngineId;
  readonly detectedAt: ISODateString;
  readonly validAt: ISODateString;
  /** Set once a human has accepted or dismissed it — the denominator of the
   *  precision metric. Never deleted (I1). */
  readonly resolution?: "accepted" | "dismissed";
  readonly resolvedBy?: EventId;
}

/**
 * Everything the system knows about an export.
 *
 * The log records `ExportCompiled`, then `ExportStamped`, then optionally
 * `ExportIntegrityMismatch`. This joins them into one row for the export view.
 */
export interface ExportRecordState {
  readonly id: ExportId;
  readonly stats: ExportStats;
  readonly stamp?: IntegrityStamp;
  readonly mismatches: readonly { path: string; expectedHead: string; foundHead: string | null }[];
  readonly compiledAt: ISODateString;
}

/** Counters that keep ids monotonic across a fold. Persisted implicitly by the
 *  event log — replaying the log reproduces them exactly, which is why they are
 *  here rather than in a side table. */
export interface Counters {
  readonly decisions: number;
  readonly premises: number;
  readonly justifications: number;
  readonly transcripts: number;
  readonly episodes: number;
  readonly nogoods: number;
  readonly proposals: number;
  readonly exports: number;
  readonly events: number;
}

export const ZERO_COUNTERS: Counters = {
  decisions: 0,
  premises: 0,
  justifications: 0,
  transcripts: 0,
  episodes: 0,
  nogoods: 0,
  proposals: 0,
  exports: 0,
  events: 0,
};

/** Where the retrieval index stands. Derived data lives OUTSIDE the log
 *  (sub-phase 0.8); only these two flags and the event ids live inside it. */
export interface IndexStatus {
  /** Levels built in the last `IndexRebuilt`. */
  readonly levels: readonly IndexLevel[];
  /** How many decisions were embedded. */
  readonly decisionsIndexed: number;
  /** Which engine produced the vectors currently in the blob. */
  readonly builtBy?: EngineId;
  readonly builtAt?: ISODateString;
  /** True when the engine changed after the last build. While stale, semantic
   *  retrieval is DISABLED — comparing vectors across embedding spaces is
   *  meaningless, and silently returning garbage would be worse than saying so. */
  readonly stale: boolean;
  readonly staleSince?: ISODateString | undefined;
  readonly lastEventId?: EventId;
}

export const INDEX_UNBUILT: IndexStatus = {
  levels: [],
  decisionsIndexed: 0,
  stale: false,
};

/* -------------------------------------------------------------------------- */
/* The state                                                                  */
/* -------------------------------------------------------------------------- */

export interface GraphState {
  /* --- the log itself --- */
  readonly events: readonly AnyEvent[];
  readonly headHash: string;
  readonly lastEventId: EventId | null;
  readonly schemaVersion: number;

  /* --- K = < D, P, J, L, N > --- */
  readonly decisions: ReadonlyMap<DecisionId, Decision>;
  readonly premises: ReadonlyMap<PremiseId, Premise>;
  readonly justifications: ReadonlyMap<JustificationId, Justification>;
  readonly nogoods: ReadonlyMap<NogoodId, Nogood>;

  /* --- provenance --- */
  readonly transcripts: ReadonlyMap<TranscriptId, Transcript>;
  readonly episodes: ReadonlyMap<EpisodeId, Episode>;
  readonly alternatives: ReadonlyMap<AlternativeId, RejectedAlternative>;

  /* --- verification (Phase 4) --- */
  readonly guards: ReadonlyMap<GuardId, Guard>;

  /* --- revision (Phase 2.9) --- */
  readonly proposals: ReadonlyMap<ProposalId, RevisionProposal>;
  readonly contradictions: readonly ContradictionRecord[];

  /* --- export (Phase 5) --- */
  readonly exports: ReadonlyMap<ExportId, ExportRecordState>;

  /* --- indexes: disposable, rebuilt on demand --- */
  /** variable -> live decision ids. The structural gate's first lookup. */
  readonly byVariable: ReadonlyMap<DecisionVariable, readonly DecisionId[]>;
  /** fingerprint(variable||canonicalValue) -> decision id. Dedup only; identity
   *  resolution is predicate-first, see src/substrate/identity.ts. */
  readonly byFingerprint: ReadonlyMap<string, DecisionId>;
  /** premise fingerprint(type||predicate) -> premise id. */
  readonly premiseByFingerprint: ReadonlyMap<string, PremiseId>;
  /** premise id -> decision ids resting on it. The CASCADE index — without it,
   *  premise invalidation is a full scan of every justification. */
  readonly premiseToDecisions: ReadonlyMap<PremiseId, readonly DecisionId[]>;
  /** guard id -> decision id. Reverse of Decision.guardIds. */
  readonly guardIndex: ReadonlyMap<GuardId, DecisionId>;

  /* --- review queues (Phase 1.9) --- */
  readonly pendingReview: readonly DecisionId[];
  readonly pendingPremises: readonly PremiseId[];
  /** HumanOverride count per decision id — feeds `source_authority` at 0.9. */
  readonly overrides: ReadonlyMap<DecisionId, number>;

  /* --- system --- */
  readonly engine: EngineId;
  readonly index: IndexStatus;
  readonly counters: Counters;

  /* --- derived metrics (Phase 7 reads these; rebuilt on demand) --- */
  readonly metrics: ReadonlyMap<string, number>;
  readonly computedAt: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* The identity element                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The empty state.
 *
 * This is what `fold([])` returns, what the app renders on first boot
 * (sub-phase 0.10), and what every "did the projection change?" comparison is
 * measured against. It must be cheap to construct and free of side effects.
 */
export function emptyState(
  engine: EngineId,
  at: ISODateString,
  schemaVersion: number = SCHEMA_VERSION,
): GraphState {
  return {
    events: [],
    headHash: GENESIS_HASH,
    lastEventId: null,
    schemaVersion,

    decisions: new Map(),
    premises: new Map(),
    justifications: new Map(),
    nogoods: new Map(),

    transcripts: new Map(),
    episodes: new Map(),
    alternatives: new Map(),

    guards: new Map(),
    proposals: new Map(),
    contradictions: [],
    exports: new Map(),

    byVariable: new Map(),
    byFingerprint: new Map(),
    premiseByFingerprint: new Map(),
    premiseToDecisions: new Map(),
    guardIndex: new Map(),

    pendingReview: [],
    pendingPremises: [],
    overrides: new Map(),

    engine,
    index: INDEX_UNBUILT,
    counters: ZERO_COUNTERS,

    metrics: new Map(),
    computedAt: at,
  };
}

/** A fresh state for the local engine, which is the DEFAULT rather than the
 *  fallback (see plan/OVERVIEW.md §8). */
export function emptyLocalState(at: ISODateString): GraphState {
  return emptyState({ kind: "local", model: "deterministic-v1" }, at);
}

/* -------------------------------------------------------------------------- */
/* Narrowing helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Live = not closed out. Every user-facing list filters on this. */
export function isLive(label: DecisionLabel, invalidFrom?: ISODateString): boolean {
  return invalidFrom === undefined && label !== "OUT";
}

export function decisionIds(state: GraphState): readonly DecisionId[] {
  return [...state.decisions.keys()];
}

export function premiseIds(state: GraphState): readonly PremiseId[] {
  return [...state.premises.keys()];
}

/** Label histogram, for the health panel. Always sums to the decision count. */
export function labelHistogram(state: GraphState): Readonly<Record<DecisionLabel, number>> {
  const out: Record<DecisionLabel, number> = { IN: 0, OUT: 0, UNKNOWN: 0, UNFOUNDED: 0 };
  for (const decision of state.decisions.values()) {
    out[decision.label] += 1;
  }
  return out;
}

/** Premise-type histogram. A spike in one type usually means the extractor is
 *  over-firing there — the first thing to look at when precision drops. */
export function premiseTypeHistogram(state: GraphState): Readonly<Record<PremiseType, number>> {
  const out: Record<PremiseType, number> = {
    scale: 0,
    team: 0,
    budget: 0,
    time: 0,
    deployment: 0,
    capability: 0,
    requirement: 0,
    external: 0,
  };
  for (const premise of state.premises.values()) {
    out[premise.type] += 1;
  }
  return out;
}

/**
 * The OTHER-variable usage rate.
 *
 * The ontology's health check (sub-phase 0.7). Above ~15% the 14 typed slots are
 * not covering the corpus and Phase 1's numbers cannot be trusted until the
 * ontology is extended. Surfaced in the health panel rather than buried in a
 * test, because it degrades silently.
 */
export function otherVariableRate(state: GraphState): number {
  const total = state.decisions.size;
  if (total === 0) return 0;
  const other = state.byVariable.get("OTHER")?.length ?? 0;
  return other / total;
}

export const OTHER_VARIABLE_THRESHOLD = 0.15;

export function ontologyNeedsExtension(state: GraphState): boolean {
  return otherVariableRate(state) > OTHER_VARIABLE_THRESHOLD;
}
