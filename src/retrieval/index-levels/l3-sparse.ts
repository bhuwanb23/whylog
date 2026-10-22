/**
 * L3 ΓÇö sparse lexical index. 3.2
 *
 * Phase 3 ┬╖ sub-phase 3.2
 * Plan: plan/phase-3-retrieval.md ┬º3.2
 *
 * ---------------------------------------------------------------------------
 * NON-NEGOTIABLE
 *
 * Technology names are precisely the tokens where dense embeddings are weakest and
 * lexical matching is strongest. `better-sqlite3` is an out-of-vocabulary compound that
 * an embedding model has little signal about, and a query containing it must retrieve the
 * decision containing it at rank 1 ΓÇö no embedding quality guarantees that.
 *
 * This level also **carries the entire system when no key is present**. L1 and L2 are off
 * without embeddings; L4 and L5 are exact but narrow. L3 is the only level that is both
 * general and keyless, which makes it the reason the product is usable at all in the
 * sandbox default configuration.
 *
 * ---------------------------------------------------------------------------
 * ALIAS FOLDING
 *
 * Terms are indexed BOTH raw and canonical (`projections/indexes.ts:termFrequencies`), so
 * `pg` and `postgres` retrieve the same decision whichever the query used. Both directions
 * are indexed rather than folding the query and hoping, because folding is not symmetric
 * for compound mentions: "postgres connection pooling" folds to something that no longer
 * contains the literal token a decision statement used.
 *
 * ---------------------------------------------------------------------------
 * NEVER DENSE-ONLY
 *
 * ┬º3.2's risk row says it plainly: sparse L3 is mandatory and RRF-fused. A build that
 * quietly drops L3 when embeddings are available is a build that starts missing
 * technology names the day someone adds an API key.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { IndexArtifacts, RankedHit } from "@/types/retrieval";
import { buildCorpus, searchSparse, type SparseCorpus } from "@/lib/bm25";
import { rank } from "../rrf";

/**
 * Rank decisions by BM25 against the query's folded terms.
 *
 * The corpus is rebuilt per query from the artifact's sparse entries. That looks wasteful
 * and is not: `buildCorpus` is one pass over the documents computing document frequencies,
 * and at 10^2-10^3 decisions it is microseconds. Caching it would mean invalidating on
 * every event, which is a correctness risk bought for a saving that does not exist ΓÇö the
 * same reasoning as `reasoning/graph-index.ts`.
 */
export function searchL3(
  artifacts: IndexArtifacts,
  queryTerms: readonly string[],
  k: number,
): readonly RankedHit[] {
  if (artifacts.sparse.length === 0 || queryTerms.length === 0) return [];

  const corpus = corpusOf(artifacts);
  const hits = searchSparse(queryTerms, corpus, k);

  return rank(
    "L3",
    hits.map((hit) => ({ id: hit.id as DecisionId, score: hit.score })),
  );
}

export function corpusOf(artifacts: IndexArtifacts): SparseCorpus {
  return buildCorpus(
    artifacts.sparse.map((entry) => ({
      id: entry.decisionId,
      terms: entry.terms,
      length: entry.length,
    })),
  );
}

/**
 * Did an exact technology name match?
 *
 * Used by the reranker's structural component and by the run trace. A query token that
 * appears verbatim in a decision's terms is the strongest lexical signal there is, and it
 * is worth knowing separately from the aggregate BM25 score ΓÇö which can be high on
 * stopword-ish overlap with no exact name match at all.
 */
export function exactTermHits(
  artifacts: IndexArtifacts,
  decisionId: DecisionId,
  queryTerms: readonly string[],
): readonly string[] {
  const entry = artifacts.sparse.find((candidate) => candidate.decisionId === decisionId);
  if (entry === undefined) return [];

  return queryTerms.filter((term) => (entry.terms[term] ?? 0) > 0);
}

export function l3Count(artifacts: IndexArtifacts): number {
  return artifacts.sparse.length;
}

export function describeL3(artifacts: IndexArtifacts): string {
  const count = l3Count(artifacts);
  return count === 0
    ? "L3 sparse lexical ΓÇö no documents. Either the log is empty or every decision is superseded."
    : "L3 sparse lexical (BM25) ΓÇö " + count + " document(s), terms alias-folded both ways. Never stale, never needs a key, and the level that guarantees a technology name in the query finds the technology name in the decision.";
}
