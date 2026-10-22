/**
 * Local reranking — five inspectable components. 3.5
 *
 * Phase 3 · sub-phase 3.5
 * Plan: plan/phase-3-retrieval.md §3.5
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE DEFAULT AND NOT THE FALLBACK
 *
 * When a judge asks "how does your ranking work?", the answer here is five numbers and a
 * sentence each. That is a far stronger position than "the model decides" — not because the
 * model is worse at ranking, but because a number a user can read is a number a user can
 * ARGUE WITH, and an argument is how a wrong ranking gets found.
 *
 * It is also the only reranker that works keyless, which is the configuration the whole
 * product has to survive in.
 *
 * ---------------------------------------------------------------------------
 * THE WEIGHTS
 *
 *   0.35  structural match      exact variable or value hit — decisive, not statistical
 *   0.30  lexical overlap       BM25 plus exact technology-name matches
 *   0.20  dense cosine          L1 and L2 fused — topical relatedness
 *   0.10  premise overlap       Jaccard over shared premise ids — graph proximity
 *   0.05  recency               tie-break ONLY, on valid time
 *
 * Structural and lexical carry 0.65 between them, and both are exact. That is deliberate
 * and it is the mitigation for the risk row "local reranking too weak to demo": the
 * majority of the score comes from components that cannot be wrong in the way an embedding
 * can be wrong.
 *
 * Recency at 0.05 is a tie-break, not a signal. Anything higher would make a fresh
 * irrelevant decision outrank an old exact one, which is the same recency bias the
 * entrenchment function deliberately weights lowest.
 *
 * ---------------------------------------------------------------------------
 * THE HARD RULE
 *
 * The reranker scores against the ORIGINAL QUERY. Never against a HyDE hypothetical.
 *
 * HyDE generates a hypothetical ANSWER and embeds it to improve retrieval. If the reranker
 * then scores candidates against that hypothetical instead of the question, every downstream
 * number measures similarity to something the user never said — and the pipeline is silently
 * broken in the way that is hardest to notice, because the results still look plausible.
 * `rerankAgainst` takes the query and nothing else, so the mistake is not expressible here.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { IndexArtifacts, RetrievedHit } from "@/types/retrieval";
import { exactTermHits } from "../index-levels/l3-sparse";
import type { StructuralMatch } from "../index-levels/l4-structural";
import { type PremiseMatch, premiseOverlap, premisesOfDecision } from "../index-levels/l5-premises";

/** The five weights. Named, exported, and rendered in the UI — a weight the user cannot
 *  see is a weight the user cannot argue with. */
export const RERANK_WEIGHTS = Object.freeze({
  structural: 0.35,
  lexical: 0.3,
  dense: 0.2,
  premise: 0.1,
  recency: 0.05,
} as const);

/** Recency half-life for the tie-break, on VALID time. Long on purpose: recency is not a
 *  relevance signal here, and a short half-life would make it one. */
export const RECENCY_HALF_LIFE_DAYS = 180;

export interface RerankCandidate {
  readonly decisionId: DecisionId;
  /** Fused cosine over L1 and L2, in [-1, 1]. Absent when dense is unavailable. */
  readonly denseScore: number | null;
  /** BM25 score. Unbounded, so it is rank-normalised below rather than used raw. */
  readonly sparseScore: number;
  readonly sparseRank: number;
  readonly structural: StructuralMatch | null;
  readonly premise: PremiseMatch | null;
  readonly promoted: boolean;
}

export interface ScoredCandidate {
  readonly candidate: RerankCandidate;
  readonly total: number;
  readonly components: {
    readonly structural: number;
    readonly lexical: number;
    readonly dense: number;
    readonly premise: number;
    readonly recency: number;
  };
  /** The exact query terms this candidate contains verbatim. The strongest lexical
   *  signal there is, and the one worth showing on its own. */
  readonly exactTerms: readonly string[];
}

export interface LocalRerankInput {
  readonly query: string;
  readonly queryTerms: readonly string[];
  readonly candidates: readonly RerankCandidate[];
  readonly artifacts: IndexArtifacts;
  readonly state: GraphState;
  /** Premises the query named, for the overlap component. */
  readonly queryPremises: readonly PremiseId[];
  readonly now: number;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Score every candidate against the ORIGINAL QUERY.
 *
 * Deterministic: ties break by decision id, so the same corpus and query always produce the
 * same order. Phase 7 cannot measure an improvement against a ranking that moves.
 */
export function rerankLocally(input: LocalRerankInput): readonly ScoredCandidate[] {
  const sparseMax = input.candidates.reduce(
    (max, candidate) => (candidate.sparseScore > max ? candidate.sparseScore : max),
    0,
  );

  const scored = input.candidates.map((candidate): ScoredCandidate => {
    const exactTerms = exactTermHits(input.artifacts, candidate.decisionId, input.queryTerms);

    /* ---- 0.35 structural: exact or not, no gradient ---- */
    /* A value match is more specific than a variable match, so it scores full and a
     * variable-only match scores three quarters. Both are exact; the difference is
     * specificity, not confidence. */
    const structural =
      candidate.structural === null ? 0 : candidate.structural.via === "value" ? 1 : 0.75;

    /* ---- 0.30 lexical: exact names dominate, BM25 fills in ---- */
    /* Exact technology-name matches are worth more than aggregate BM25, because BM25 can
     * be high on stopword-ish overlap with no exact name match at all — and the whole
     * reason L3 exists is that a name in the query must find the name in the decision. */
    const exactComponent = exactTerms.length === 0 ? 0 : Math.min(1, 0.6 + 0.2 * exactTerms.length);
    const bm25Component = sparseMax === 0 ? 0 : candidate.sparseScore / sparseMax;
    const lexical = Math.max(exactComponent, bm25Component);

    /* ---- 0.20 dense: fused L1+L2 cosine, clamped ---- */
    const dense = candidate.denseScore === null ? 0 : clamp01((candidate.denseScore + 1) / 2);

    /* ---- 0.10 premise overlap: graph proximity, deliberately weak ---- */
    const candidatePremises = premisesOfDecision(input.artifacts, candidate.decisionId);
    const premise =
      candidate.premise !== null ? 1 : premiseOverlap(input.queryPremises, candidatePremises);

    /* ---- 0.05 recency: tie-break only ---- */
    const recency = recencyComponent(input.state, candidate.decisionId, input.now);

    const total =
      RERANK_WEIGHTS.structural * structural +
      RERANK_WEIGHTS.lexical * lexical +
      RERANK_WEIGHTS.dense * dense +
      RERANK_WEIGHTS.premise * premise +
      RERANK_WEIGHTS.recency * recency;

    return {
      candidate,
      total: round4(total),
      components: {
        structural: round4(structural),
        lexical: round4(lexical),
        dense: round4(dense),
        premise: round4(premise),
        recency: round4(recency),
      },
      exactTerms,
    };
  });

  scored.sort((a, b) =>
    b.total === a.total
      ? a.candidate.decisionId < b.candidate.decisionId
        ? -1
        : a.candidate.decisionId > b.candidate.decisionId
          ? 1
          : 0
      : b.total - a.total,
  );

  return scored;
}

function recencyComponent(state: GraphState, decisionId: DecisionId, now: number): number {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return 0;

  const ms = Date.parse(decision.temporal.valid);
  if (!Number.isFinite(ms)) return 0.5;

  const ageDays = Math.max(0, (now - ms) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The five components, as arithmetic.
 *
 * This is the answer to "how does your ranking work?" for one specific result. Every term
 * is shown with its weight and its value, so a user who disagrees with a ranking can point
 * at the component they disagree with instead of distrust the whole thing.
 */
export function explainScore(scored: ScoredCandidate): string {
  const c = scored.components;
  const w = RERANK_WEIGHTS;

  return [
    `${scored.candidate.decisionId} — rerank ${scored.total.toFixed(3)}`,
    `  ${w.structural.toFixed(2)} × structural ${c.structural.toFixed(2)}${
      scored.candidate.structural === null
        ? " (no exact slot or value match)"
        : ` (${scored.candidate.structural.explanation})`
    }`,
    `  ${w.lexical.toFixed(2)} × lexical    ${c.lexical.toFixed(2)}${
      scored.exactTerms.length === 0 ? " (BM25 only)" : ` (exact: ${scored.exactTerms.join(", ")})`
    }`,
    `  ${w.dense.toFixed(2)} × dense      ${c.dense.toFixed(2)}${scored.candidate.denseScore === null ? " (unavailable — index stale or not built)" : ""}`,
    `  ${w.premise.toFixed(2)} × premise    ${c.premise.toFixed(2)}`,
    `  ${w.recency.toFixed(2)} × recency    ${c.recency.toFixed(2)} (tie-break, ${RECENCY_HALF_LIFE_DAYS}-day half-life)`,
    `  = ${scored.total.toFixed(3)}`,
  ].join("\n");
}

/** The weights as a sentence each — the whole ranking policy in five lines. */
export function describeWeights(): string {
  return [
    "Structural 0.35 — an exact variable or value match. Decisive, not statistical.",
    "Lexical    0.30 — BM25, with exact technology-name matches scoring above it. Names are where embeddings are weakest and lexical matching strongest.",
    "Dense      0.20 — L1 and L2 fused cosine. Topical relatedness; zero when the index is stale.",
    "Premise    0.10 — Jaccard over shared premise ids. Graph proximity, deliberately weak: two decisions can share a premise and answer different questions.",
    "Recency    0.05 — tie-break only, on valid time. Any higher and a fresh irrelevant decision beats an old exact one.",
  ].join("\n");
}

/** Which components actually decided this ranking — the ones with non-zero weight×value,
 *  highest contribution first. */
export function dominantComponents(scored: ScoredCandidate): readonly string[] {
  const w = RERANK_WEIGHTS;
  const contributions = [
    { name: "structural", amount: w.structural * scored.components.structural },
    { name: "lexical", amount: w.lexical * scored.components.lexical },
    { name: "dense", amount: w.dense * scored.components.dense },
    { name: "premise", amount: w.premise * scored.components.premise },
    { name: "recency", amount: w.recency * scored.components.recency },
  ];

  return contributions
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((entry) => `${entry.name} ${entry.amount.toFixed(3)}`);
}

/** A `RetrievedHit` carries no rerank breakdown, so the score is attached here for the
 *  view. Kept separate from `RetrievedHit` because that is a Phase 0 contract. */
export function attachScore(
  hit: RetrievedHit,
  scored: readonly ScoredCandidate[],
): ScoredCandidate | null {
  return scored.find((entry) => entry.candidate.decisionId === hit.decisionId) ?? null;
}
