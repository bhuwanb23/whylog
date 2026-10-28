/**
 * Reciprocal Rank Fusion — 3.4.
 *
 * Phase 3 · sub-phase 3.4
 * Plan: plan/phase-3-retrieval.md §3.4
 * Docs: docs/03-retrieval-and-contradiction.md §3
 *
 * ---------------------------------------------------------------------------
 * WHY RRF AND NOT SCORE FUSION
 *
 *   RRF(d) = Σ over retrievers r of  1 / (k + rank_r(d))        k = 60
 *
 * RRF is **score-agnostic**: it needs ranks, not scores. That is the entire reason it
 * is used here rather than a weighted sum of similarities.
 *
 * A cosine similarity lives in [-1, 1] and clusters near 0.8 for anything vaguely
 * topical. A BM25 score is unbounded and depends on corpus statistics — the same query
 * against a 10-decision log and a 500-decision log produces different numbers for the
 * same decision. Normalising either one to fuse them means choosing a normalisation,
 * and every choice is a tuning decision that silently changes results when the corpus
 * grows. Ranks have no such problem: rank 1 is rank 1 in both.
 *
 * ---------------------------------------------------------------------------
 * k = 60
 *
 * The value from the original RRF work, used unchanged by Graphiti and most hybrid
 * stacks. It is a named constant, not a magic number, and it is NOT tuned here.
 *
 * What it does: it damps the difference between high ranks. At k=60, rank 1 scores
 * 1/61 ≈ 0.0164 and rank 2 scores 1/62 ≈ 0.0161 — nearly identical. A small k would
 * make the top of each list dominate the fusion; a large k flattens it. 60 is the
 * conventional middle, and deviating from it would need a metric to justify it, which
 * is Phase 7's job.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 *
 * Identical inputs must produce identical rankings — §3.4's acceptance criterion, and
 * a prerequisite for Phase 7's ablation harness, which cannot measure an improvement
 * against a ranking that moves between runs.
 *
 * Two things guarantee it. Ties break by decision id, never by insertion order (which
 * depends on Map iteration and therefore on the order events were folded). And the
 * contributing lists are sorted before ranking, so a retriever that returns an unsorted
 * or equal-scored list still produces stable ranks.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { FusedHit, IndexLevel, RankedHit } from "@/types/retrieval";

/** The standard RRF damping constant. Not tuned — see the header. */
export const RRF_K = 60;

/** One ranked list from one level. */
export interface RankedList {
  readonly level: IndexLevel;
  readonly hits: readonly RankedHit[];
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Assign ranks to a list of scored ids.
 *
 * Rank is 1-based, as RRF requires. Equal scores get consecutive ranks broken by id —
 * NOT equal ranks. Sharing a rank between two tied documents would double-count them in
 * the fusion and quietly promote ties over documents that scored strictly between them.
 */
export function rank(
  level: IndexLevel,
  scored: readonly { id: DecisionId; score: number }[],
): readonly RankedHit[] {
  const sorted = [...scored].sort((a, b) =>
    b.score === a.score ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : b.score - a.score,
  );

  return sorted.map(
    (entry, index): RankedHit => ({
      decisionId: entry.id,
      rank: index + 1,
      score: entry.score,
      source: level,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Fusion                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fuse ranked lists.
 *
 * @param lists the per-level rankings. Empty lists contribute nothing, which is how a
 *   stale dense index degrades: L1 and L2 simply drop out and L3 carries the run.
 * @param k the damping constant. Defaults to `RRF_K`; overridable so Phase 7 can ablate
 *   it without editing this file.
 */
export function fuse(lists: readonly RankedList[], k: number = RRF_K): readonly FusedHit[] {
  const accumulator = new Map<
    DecisionId,
    { rrf: number; contributedBy: Set<IndexLevel>; bestRank: number }
  >();

  for (const list of lists) {
    for (const hit of list.hits) {
      const contribution = 1 / (k + hit.rank);
      const existing = accumulator.get(hit.decisionId);

      if (existing === undefined) {
        accumulator.set(hit.decisionId, {
          rrf: contribution,
          contributedBy: new Set([list.level]),
          bestRank: hit.rank,
        });
        continue;
      }

      existing.rrf += contribution;
      existing.contributedBy.add(list.level);
      if (hit.rank < existing.bestRank) existing.bestRank = hit.rank;
    }
  }

  const fused: FusedHit[] = [];
  for (const [decisionId, entry] of accumulator) {
    fused.push({
      decisionId,
      rrf: entry.rrf,
      /* Sorted so the same set of contributing levels always renders identically. A
       * Set's iteration order is insertion order, which depends on which retriever ran
       * first — and that is not something a UI should visibly depend on. */
      contributedBy: [...entry.contributedBy].sort(),
      bestRank: entry.bestRank,
    });
  }

  /* Deterministic: score descending, then id ascending. */
  fused.sort((a, b) =>
    b.rrf === a.rrf
      ? a.decisionId < b.decisionId
        ? -1
        : a.decisionId > b.decisionId
          ? 1
          : 0
      : b.rrf - a.rrf,
  );

  return fused;
}

/** The RRF contribution of a single rank, exposed so the UI can show the arithmetic. */
export function rrfContribution(rankValue: number, k: number = RRF_K): number {
  return 1 / (k + rankValue);
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How a fused score was assembled, as arithmetic.
 *
 * "How does your ranking work?" has to have an answer that is not "the model decides".
 * For fusion specifically the answer is: these levels contributed, at these ranks, and
 * here is the sum. Every number in it is checkable by hand.
 */
export function explainFusion(
  fused: FusedHit,
  lists: readonly RankedList[],
  k: number = RRF_K,
): string {
  const terms: string[] = [];

  for (const list of lists) {
    const hit = list.hits.find((entry) => entry.decisionId === fused.decisionId);
    if (hit === undefined) continue;
    terms.push(
      `${list.level} rank ${hit.rank} → 1/(${k}+${hit.rank}) = ${rrfContribution(hit.rank, k).toFixed(5)}`,
    );
  }

  if (terms.length === 0)
    return `${fused.decisionId}: no level contributed (score ${fused.rrf.toFixed(5)}).`;

  return [
    `${fused.decisionId} — RRF ${fused.rrf.toFixed(5)} from ${terms.length} level(s):`,
    ...terms.map((term) => `  · ${term}`),
    `  = ${fused.rrf.toFixed(5)}`,
    fused.contributedBy.length > 1
      ? "  Multiple levels agreeing is the strongest signal fusion can produce: lexical and dense retrieval are wrong in different ways, so agreeing is evidence."
      : "  Only one level contributed. Treat this rank as weaker than a multi-level one.",
  ].join("\n");
}

/** Which levels actually contributed anything, for the run trace. */
export function contributingLevels(lists: readonly RankedList[]): readonly IndexLevel[] {
  return lists.filter((list) => list.hits.length > 0).map((list) => list.level);
}

/** Total candidates across all lists, before fusion de-duplicates them. */
export function candidateCount(lists: readonly RankedList[]): number {
  return lists.reduce((total, list) => total + list.hits.length, 0);
}
