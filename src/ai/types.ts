/**
 * The engine seam.
 *
 * Phase 0 ú sub-phase 0.9
 * Plan: plan/phase-0-foundation.md §0.9 ú plan/OVERVIEW.md §8
 *
 * ---------------------------------------------------------------------------
 * ONE INTERFACE, TWO IMPLEMENTATIONS, SELECTED AT RUNTIME
 *
 * `LocalEngine` is the DEFAULT, not the fallback. That is a design commitment
 * with consequences: every capability the product claims must have a local
 * implementation, even a weaker one, or the keyless mode is a demo rather than a
 * product. `LLMEngine` is the higher-recall path for people who want it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MAKES THE TWO PATHS COMPARABLE
 *
 * EVERY RESULT CARRIES THE `engine` THAT PRODUCED IT, AND THAT FIELD IS STORED ON
 * THE NODE — not merely displayed next to it.
 *
 * Two consequences, both deliberate:
 *
 *   1. A graph built by the local engine stays labelled as such after the user
 *      adds a key. Nodes are never silently re-attributed, and the agency ledger
 *      stays honest about which reasoning was machine-made.
 *
 *   2. Phase 7's ablation can compare paths on the SAME corpus, because the
 *      provenance is in the data rather than in a session setting somebody
 *      remembers.
 *
 * What the seam must never do is mix: a vector from one engine compared against a
 * vector from another is a meaningless number, so `embed` results are tagged and
 * the index goes stale on a switch (src/substrate/index-artifacts.ts).
 * ---------------------------------------------------------------------------
 */

import type {
  Confidence,
  DecisionId,
  EngineId,
  ISODateString,
  PremiseId,
  SourceSpan,
  TranscriptId,
} from "@/types/common";
import type { DecisionOrigin, DecisionVariable, Modality, PremiseType } from "@/types/domain";
import type { ProposedGuard } from "@/types/guards";
import type { ClassificationResult, ContradictionGate } from "@/types/retrieval";

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What an engine can do, declared BEFORE any call.
 *
 * The UI reads this to enable and disable controls, so an unsupported operation is
 * never offered. Discovering `unsupported` by catching an error is a worse design:
 * it means a button that appears to work and then fails.
 *
 * The local engine reports `rerank: false` and `guardSynthesis: "template-only"`.
 * Those are the honest gaps, and they are the two things a key actually buys.
 */
export interface EngineCapabilities {
  /** Transcript -> decisions, premises, alternatives. */
  readonly extraction: boolean;
  /** Pair -> one of the five verdicts. */
  readonly classification: boolean;
  readonly embedding: boolean;
  readonly reranking: boolean;
  /** Retrieval-grounded prose. The local engine composes from TEMPLATES, which is
   *  a real implementation with lower fluency, not a stub. */
  readonly composition: boolean;
  readonly guardSynthesis: "none" | "template-only" | "llm";
  /** Three-run majority voting (plan/phase-1 §1.8). Costs 3x; only the LLM path
   *  can afford it. */
  readonly voting: boolean;
  /** HyPE-style index-time questions. */
  readonly questionGeneration: boolean;
  /** The engine's own claim about its quality, for the Settings panel. Never used
   *  for control flow — that would let an engine overstate itself. */
  readonly notes: string;
}

export const LOCAL_CAPABILITIES: EngineCapabilities = {
  extraction: true,
  classification: true,
  embedding: true,
  reranking: false,
  composition: true,
  guardSynthesis: "template-only",
  voting: false,
  questionGeneration: false,
  notes:
    "Deterministic, offline, no key. Cue-driven extraction with lower recall than an LLM; lexical-plus-hashed-n-gram embeddings; template composition. Every result is reproducible byte for byte.",
};

export function llmCapabilities(model: string): EngineCapabilities {
  return {
    extraction: true,
    classification: true,
    embedding: true,
    reranking: true,
    composition: true,
    guardSynthesis: "llm",
    voting: true,
    questionGeneration: true,
    notes: `${model} via API. Higher recall on premises and alternatives; three-run voting available; results are NOT reproducible across runs. Every node is stamped with this engine.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A decision candidate, before it has an id.
 *
 * Ids are minted by the extraction pipeline (Phase 1.10), not by the engine, so
 * that a re-run of the same engine over the same transcript cannot produce a
 * different graph shape. The engine's job is to RECOGNISE; the pipeline's job is
 * to COMMIT.
 */
export interface DecisionCandidate {
  readonly variable: DecisionVariable;
  /** Already alias-folded by the ontology. */
  readonly value: string;
  readonly statement: string;
  readonly yStatement?: string;
  readonly rationale?: string;
  readonly acceptedDownside?: string;
  readonly origin: DecisionOrigin;
  readonly modality: Modality;
  readonly confidence: Confidence;
  readonly snippet: SourceSpan;
  /** Premises recovered in the same episode, by local index. The pipeline turns
   *  these into real ids and resolves them through the ladder. */
  readonly premiseRefs: readonly number[];
  /** Alternatives recovered in the same episode, by local index. */
  readonly alternativeRefs: readonly number[];
  /** File globs the candidate appears to govern, when the transcript says. */
  readonly appliesTo: readonly string[];
}

export interface PremiseCandidate {
  readonly type: PremiseType;
  /** Namespaced, e.g. "scale.single_user". Rung 1 of the identity ladder matches
   *  on this, so an extractor that emits bare prose predicates produces a
   *  duplicate node on every re-import. */
  readonly predicate: string;
  readonly value?: string | number | boolean;
  readonly text: string;
  readonly confidence: Confidence;
  readonly snippet: SourceSpan;
  /** True when the cue was topical rather than explicit, which always means the
   *  candidate goes to the review queue. */
  readonly needsReview: boolean;
}

export interface AlternativeCandidate {
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly whyRejected?: string;
  readonly confidence: Confidence;
  readonly snippet: SourceSpan;
  /** Index into `decisions` of the decision that rejected it. */
  readonly decisionRef: number;
}

export interface ExtractionResult {
  readonly decisions: readonly DecisionCandidate[];
  readonly premises: readonly PremiseCandidate[];
  readonly alternatives: readonly AlternativeCandidate[];
  /** Episodes the transcript was segmented into. Extraction happens per episode,
   *  not per sentence — the deliberate deviation from arXiv:2506.11005. */
  readonly episodes: readonly EpisodeSpan[];
  /** Candidates discarded before return, with the reason. These become
   *  `ExtractionDiscarded` events, which is the denominator of the precision
   *  metric; dropping them silently would make the metric unmeasurable. */
  readonly discarded: readonly DiscardedCandidate[];
  readonly engine: EngineId;
  readonly durationMs: number;
  /** Token usage, when the engine knows it. Reported, never hidden: the LLM path
   *  costs something and the user is entitled to see what. */
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

export interface EpisodeSpan {
  readonly variable?: DecisionVariable;
  readonly turnRange: readonly [start: number, end: number];
  readonly charRange: readonly [start: number, end: number];
}

export interface DiscardedCandidate {
  readonly kind: "decision" | "premise" | "alternative";
  readonly discardedBy: "confidence-threshold" | "modality" | "duplicate" | "human";
  readonly rawText: string;
  readonly confidence: Confidence;
}

export interface ExtractionRequest {
  readonly transcriptId: TranscriptId;
  /** The NORMALISED text, with offsets that map back to the raw input. */
  readonly text: string;
  /** When the conversation happened, if known. Drives `occurredAt`. */
  readonly occurredAt?: ISODateString;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

export interface ClassificationRequest {
  readonly decisionA: DecisionSnapshot;
  readonly decisionB: DecisionSnapshot;
  /** Set when the pair was surfaced by gate (c) rather than (a) or (b). */
  readonly sharedPremises?: readonly PremiseSnapshot[];
  /** The structural gate's answer, when it had one. Passed in so the semantic
   *  classifier cannot contradict a table lookup without saying so. */
  readonly structuralVerdict?: ClassificationResult;
  readonly signal?: AbortSignal;
}

export interface DecisionSnapshot {
  readonly id: DecisionId;
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  readonly rationale?: string;
  readonly validFrom: ISODateString;
}

export interface PremiseSnapshot {
  readonly id: PremiseId;
  readonly type: PremiseType;
  readonly predicate: string;
  readonly text: string;
}

/* -------------------------------------------------------------------------- */
/* Embedding & reranking                                                      */
/* -------------------------------------------------------------------------- */

export interface EmbeddingResult {
  readonly vectors: readonly Float32Array[];
  readonly dimensions: number;
  readonly engine: EngineId;
  readonly durationMs: number;
  readonly usage?: { readonly tokens: number };
}

export interface RerankRequest {
  readonly query: string;
  readonly candidates: readonly { readonly id: string; readonly text: string }[];
  readonly k: number;
  readonly signal?: AbortSignal;
}

export interface RerankResult {
  readonly ranked: readonly { readonly id: string; readonly score: number }[];
  readonly engine: EngineId;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

export type CompositionKind =
  | "answer"
  | "export-narrative"
  | "guard-rationale"
  | "premise-summary"
  | "cascade-explanation";

export interface CompositionRequest {
  readonly kind: CompositionKind;
  /** The structured material to compose FROM. Composition is never asked to
   *  retrieve; retrieval already happened and its results are here. That split is
   *  what makes the evidence contract enforceable (docs/03 §5). */
  readonly material: readonly CompositionFact[];
  readonly question?: string;
  readonly maxLengthChars?: number;
  readonly signal?: AbortSignal;
}

/** One grounded fact. A composition may only use these, and every claim it makes
 *  must cite at least one — the check is in src/retrieval/groundedness.ts. */
export interface CompositionFact {
  readonly decisionId: DecisionId;
  readonly statement: string;
  readonly rationale?: string;
  readonly premises: readonly string[];
  readonly label: string;
  readonly validFrom: ISODateString;
}

export interface CompositionResult {
  readonly text: string;
  /** The decision ids the text actually cites. Compared against `material` to
   *  detect a citation that does not resolve. */
  readonly citedDecisionIds: readonly DecisionId[];
  /** A note about HOW this was composed — a provenance disclosure, not a claim about
   *  the log. It is returned separately so the claim attribution never has to guess
   *  whether a sentence is a claim: a disclosure carries no decision id, so if it
   *  were part of `text` it would be scored as an ungrounded claim and would drag a
   *  perfectly well-sourced answer below the GROUNDED threshold. */
  readonly disclosure?: string;
  readonly engine: EngineId;
  readonly durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Guard synthesis                                                            */
/* -------------------------------------------------------------------------- */

export interface GuardSynthesisRequest {
  readonly decisionId: DecisionId;
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  readonly appliesTo: readonly string[];
  readonly premises: readonly PremiseSnapshot[];
  readonly signal?: AbortSignal;
}

export interface GuardSynthesisResult {
  readonly guards: readonly ProposedGuard[];
  /** A decision with no synthesizable guard is marked `unverifiable` and SHOWN.
   *  Never silently skipped: a compliance score computed only over the decisions
   *  that happened to be checkable is a score that flatters itself. */
  readonly unverifiableReason?: string;
  readonly engine: EngineId;
}

/* -------------------------------------------------------------------------- */
/* The seam                                                                   */
/* -------------------------------------------------------------------------- */

export interface WhyLogEngine {
  /** Stable identity. Stored on every node this engine produces, forever. */
  id(): EngineId;

  /** Declared BEFORE any call, so the UI never offers what cannot be done. */
  capabilities(): EngineCapabilities;

  extract(request: ExtractionRequest): Promise<ExtractionResult>;

  classify(request: ClassificationRequest): Promise<ClassificationResult>;

  embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult>;

  /** Throws `unsupported` when `capabilities().reranking` is false. Callers must
   *  check the flag rather than rely on the throw. */
  rerank(request: RerankRequest): Promise<RerankResult>;

  compose(request: CompositionRequest): Promise<CompositionResult>;

  synthesizeGuards(request: GuardSynthesisRequest): Promise<GuardSynthesisResult>;

  /** Vector width, so the index blob can be allocated and validated. */
  readonly dimensions: number;
}

/** Which gate a classification request came from. Passed through so the result
 *  can be attributed correctly in the false-positive breakdown. */
export type GateOrigin = ContradictionGate;

/** A no-op engine, for tests and for the "engine unavailable" state. Declares no
 *  capabilities, so every control is disabled and nothing can be called. */
export const NULL_CAPABILITIES: EngineCapabilities = {
  extraction: false,
  classification: false,
  embedding: false,
  reranking: false,
  composition: false,
  guardSynthesis: "none",
  voting: false,
  questionGeneration: false,
  notes: "No engine is available.",
};
