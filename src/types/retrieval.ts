/**
 * Retrieval contracts — the four-level index, fusion, reranking, and the
 * evidence contract.
 *
 * Phase 3 · sub-phases 3.1-3.10
 * Plan:     plan/phase-3-retrieval.md
 * Research: docs/03-retrieval-and-contradiction.md
 */

import type {
  Confidence,
  DecisionId,
  EngineId,
  ISODateString,
  PremiseId,
  SourceSpan,
} from "./common";
import type { Decision, DecisionLabel, Premise } from "./domain";

/* -------------------------------------------------------------------------- */
/* Index levels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The four-level index. All levels are computed ONCE at extraction time.
 *
 * L1 statement embedding   — baseline; short-text vectors are noisy
 * L2 inverted questions    — HyPE. The query is ALREADY a question, so
 *                            question->question matching removes the asymmetry.
 *                            Costs zero extra LLM calls.
 * L3 sparse keywords       — technology names are where dense embeddings are
 *                            weakest and lexical matching strongest. Carries the
 *                            whole system when no key is present.
 * L4 structural            — variable -> value -> premise ids. Exact, O(1),
 *                            deterministic, and the only level that can see
 *                            negation and modality.
 * L5 premise inverted      — premiseId -> dependent decisions. Makes cascade O(1).
 */
export type IndexLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export interface DenseIndexEntry {
  readonly decisionId: DecisionId;
  readonly level: "L1" | "L2";
  readonly vector: Float32Array;
  /** L2 only: the synthetic question this vector encodes. */
  readonly question?: string;
}

export interface SparseIndexEntry {
  readonly decisionId: DecisionId;
  /** term -> term frequency, already alias-folded via the ontology. */
  readonly terms: Readonly<Record<string, number>>;
  readonly length: number;
}

export interface StructuralIndex {
  readonly variableIndex: ReadonlyMap<string, readonly DecisionId[]>;
  readonly valueIndex: ReadonlyMap<string, readonly DecisionId[]>;
}

export interface PremiseIndex {
  readonly premiseToDecisions: ReadonlyMap<PremiseId, readonly DecisionId[]>;
  readonly decisionToPremises: ReadonlyMap<DecisionId, readonly PremiseId[]>;
}

/** Vectors live OUTSIDE the event log (Phase 0.8). Tagged with the engine and
 *  model that produced them: cosine similarity across embedding spaces is
 *  meaningless, so switching engines marks the index STALE rather than quietly
 *  mixing vector spaces. */
export interface IndexArtifacts {
  readonly engine: EngineId;
  readonly dimensions: number;
  readonly computedAt: ISODateString;
  readonly stale: boolean;
  readonly dense: readonly DenseIndexEntry[];
  readonly sparse: readonly SparseIndexEntry[];
  readonly structural: StructuralIndex;
  readonly premises: PremiseIndex;
}

/* -------------------------------------------------------------------------- */
/* Ranked hits & fusion                                                       */
/* -------------------------------------------------------------------------- */

export interface RankedHit {
  readonly decisionId: DecisionId;
  readonly rank: number;
  readonly score: number;
  readonly source: IndexLevel | "fused";
}

export interface FusedHit {
  readonly decisionId: DecisionId;
  /** RRF score: sum over retrievers of 1 / (k + rank). k = 60. */
  readonly rrf: number;
  readonly contributedBy: readonly IndexLevel[];
  readonly bestRank: number;
}

export interface RetrievedHit {
  readonly decisionId: DecisionId;
  readonly decision: Decision;
  readonly finalScore: number;
  readonly rrf: number;
  readonly rerankScore?: number;
  readonly matchedOn: readonly IndexLevel[];
  /** True when an exact structural or premise hit promoted this candidate
   *  regardless of its statistical rank. Exact evidence outranks statistical
   *  evidence. */
  readonly promoted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Contradiction — five verdicts, not two                                     */
/* -------------------------------------------------------------------------- */

/**
 * INVARIANT I3: retrieval proposes, a classifier disposes.
 *
 * "Use Postgres" and "don't use Postgres" are ~0.9 cosine similar. Embedding
 * models encode TOPIC, not POLARITY. Any code path where a similarity threshold
 * decides a contradiction is a bug, not a tuning problem.
 */
export type ContradictionVerdict =
  /** Two decisions cannot both hold. Full revision cycle. */
  | "contradiction"
  /** The newer deliberately replaces the older on the same variable. Supersede. */
  | "reversal"
  /** Same variable, same value, added or corrected rationale. Merge.
   *  BY FAR the most common relationship between related decisions — a system
   *  that flags it as a conflict gets switched off within a day. */
  | "refinement"
  /** No conflict between decisions; a shared premise became false. Gate (c). */
  | "premise-invalidation"
  /** Topically related, logically compatible. Add a `related` edge; nothing else. */
  | "neutral";

export const CONTRADICTION_VERDICTS: readonly ContradictionVerdict[] = [
  "contradiction",
  "reversal",
  "refinement",
  "premise-invalidation",
  "neutral",
] as const;

/** Which gate produced a verdict. The three gates have complementary failure
 *  profiles, which is the reason for having three. */
export type ContradictionGate = "structural" | "semantic" | "premise";

export interface ClassificationResult {
  readonly verdict: ContradictionVerdict;
  readonly gate: ContradictionGate;
  readonly explanation: string;
  readonly confidence: Confidence;
  readonly engine: EngineId;
  /**
   * M1 — similar decisions with CONTRADICTORY rationales: probable
   * misunderstanding. The decision may be fine; the reason is broken.
   * M2 — contradictory decisions with SIMILAR rationales: probable copy-paste
   * or an extraction error. A data-quality problem, not a reasoning problem.
   * Borrowed from arXiv:2506.11005. Surfaced separately because they mean
   * different things.
   */
  readonly diagnostic?: "M1" | "M2";
}

/** Polarity of a statement. Only `asserted` creates an IN-labelled node —
 *  "what if we used Redis?" must never become a decision. */
export type Polarity = "positive" | "negative" | "unknown";

/* -------------------------------------------------------------------------- */
/* The evidence contract                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Adopted from RepoRationale: at most three searches; every citation must
 * resolve to evidence retrieved during the current run; insufficient evidence is
 * an explicit outcome, not a fallback.
 *
 * These controls do not make hallucination impossible. They make retrieval,
 * grounding, citation and answer failures DISTINGUISHABLE AND TESTABLE.
 */
export type GroundednessVerdict =
  /** Every claim maps to >=1 retrieved decision; all citations resolve. */
  | "GROUNDED"
  /** Some claims grounded, some inferred. The inferred part is marked. */
  | "PARTIAL"
  /** Nothing above threshold, or nothing on-topic. REFUSE and say what is
   *  missing, then offer the nearest related decisions. */
  | "INSUFFICIENT_EVIDENCE";

export interface Claim {
  readonly text: string;
  readonly citations: readonly DecisionId[];
  readonly grounded: boolean;
}

export interface Answer {
  readonly question: string;
  readonly verdict: GroundednessVerdict;
  readonly text: string;
  readonly claims: readonly Claim[];
  /** |claims with >=1 resolving citation| / |total claims| */
  readonly groundedness: number;
  readonly citations: readonly Citation[];
  readonly retrieved: readonly RetrievedHit[];
  readonly trace: RunTrace;
  readonly engine: EngineId;
  readonly answeredAt: ISODateString;
  /** Present only for INSUFFICIENT_EVIDENCE and PARTIAL. */
  readonly nearestRelated?: readonly RetrievedHit[];
  /** Present only for PARTIAL: which claims are not grounded and why. */
  readonly ungroundedNotes?: readonly string[];
  /** A note about HOW the answer was composed, not a claim about the log. It is kept
   *  out of `claims` on purpose: it carries no decision id, so counting it as a
   *  claim would score a fully-sourced answer as ungrounded. */
  readonly disclosure?: string;
}

export interface Citation {
  readonly decisionId: DecisionId;
  readonly claimIndex: number;
  /** A citation is valid ONLY if it points to a decision retrieved in THIS run.
   *  Citations to nodes the retrieval never surfaced are rejected, not rendered. */
  readonly resolvedInRun: boolean;
}

/** Bounded retrieval: at most three passes per question, each recorded. */
export interface RunTrace {
  readonly searches: readonly SearchStep[];
  readonly maxSearches: number;
  readonly boundedOut: boolean;
  readonly sufficiencyAssessment: string;
}

export interface SearchStep {
  readonly query: string;
  readonly levels: readonly IndexLevel[];
  readonly returned: number;
  readonly topScore: number;
  readonly why: string;
}

/* -------------------------------------------------------------------------- */
/* Citation expansion — a citation is an ARGUMENT, not a link                 */
/* -------------------------------------------------------------------------- */

/**
 * Showing "rests on P-0002 (IN) and P-0005 (IN)" is qualitatively different
 * from showing a source link, and no competitor can display it because no
 * competitor stores it.
 */
export interface ExpandedCitation {
  readonly decision: Decision;
  readonly label: DecisionLabel;
  readonly restsOn: readonly { premise: Premise; label: DecisionLabel }[];
  readonly excludes: readonly { premise: Premise; label: DecisionLabel }[];
  readonly rejected: readonly { value: string; whyRejected?: string }[];
  readonly guardsPassing: number;
  readonly guardsTotal: number;
  readonly snippet: SourceSpan;
  readonly decidedAt: ISODateString;
  readonly learnedAt: ISODateString;
  readonly engine: EngineId;
}

/* -------------------------------------------------------------------------- */
/* Pre-emption — the highest-value sentence retrieval can produce             */
/* -------------------------------------------------------------------------- */

/**
 * Fired when a query or proposal matches a REJECTED alternative rather than an
 * accepted decision. Catches the mistake BEFORE the decision instead of after.
 *
 * Only alternatives with a `whyRejected` AND explicit human confirmation enter
 * this index: a false pre-emption is worse than no pre-emption.
 */
export interface PreemptionNotice {
  readonly alternativeValue: string;
  readonly rejectedByDecisionId: DecisionId;
  readonly whyRejected: string;
  readonly rejectedAt: ISODateString;
  /** The premises the rejection rests on, with live labels — so the notice can
   *  say whether the reason still holds. */
  readonly restsOn: readonly { premiseId: PremiseId; text: string; label: DecisionLabel }[];
  readonly stillHolds: boolean;
}

/* -------------------------------------------------------------------------- */
/* Query interface                                                            */
/* -------------------------------------------------------------------------- */

export interface QueryOptions {
  readonly topK?: number;
  readonly recallK?: number;
  readonly rrfK?: number;
  readonly useHyde?: boolean;
  readonly levels?: readonly IndexLevel[];
  readonly includeSuperseded?: boolean;
}

export const DEFAULT_QUERY_OPTIONS: Required<
  Pick<QueryOptions, "topK" | "recallK" | "rrfK" | "useHyde" | "includeSuperseded">
> = {
  topK: 5,
  recallK: 20,
  rrfK: 60,
  useHyde: false,
  includeSuperseded: false,
};
