/**
 * BM25 sparse scoring — index level L3.
 *
 * Phase 3 · sub-phase 3.2
 * Plan: plan/phase-3-retrieval.md §3.2
 *
 * ---------------------------------------------------------------------------
 * WHY SPARSE RETRIEVAL IS NOT OPTIONAL
 *
 * Technology names are exactly the tokens where dense embeddings are weakest and
 * lexical matching is strongest. A query containing "better-sqlite3" must
 * retrieve the decision containing "better-sqlite3" at rank 1, and no embedding
 * quality guarantees that.
 *
 * The sparse level also CARRIES THE ENTIRE SYSTEM when no key is present, which
 * is the default configuration.
 * ---------------------------------------------------------------------------
 */

/** Okapi BM25 defaults. k1 controls term-frequency saturation; b controls
 *  length normalisation. Standard values — do not tune these without a metric. */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface SparseDocument {
  readonly id: string;
  /** term -> frequency. Terms must already be alias-folded via the ontology. */
  readonly terms: Readonly<Record<string, number>>;
  readonly length: number;
}

export interface SparseCorpus {
  readonly documents: readonly SparseDocument[];
  /** term -> number of documents containing it */
  readonly documentFrequency: Readonly<Record<string, number>>;
  readonly totalDocuments: number;
  readonly averageLength: number;
}

/** Inverse document frequency with the standard +1 smoothing, so a term present
 *  in every document scores 0 rather than negative. */
export function idf(term: string, corpus: SparseCorpus): number {
  const df = corpus.documentFrequency[term] ?? 0;
  const n = corpus.totalDocuments;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export function buildCorpus(documents: readonly SparseDocument[]): SparseCorpus {
  const documentFrequency: Record<string, number> = {};
  let totalLength = 0;

  for (const doc of documents) {
    totalLength += doc.length;
    for (const term of Object.keys(doc.terms)) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
    }
  }

  return {
    documents,
    documentFrequency,
    totalDocuments: documents.length,
    averageLength: documents.length === 0 ? 0 : totalLength / documents.length,
  };
}

export function scoreDocument(
  queryTerms: readonly string[],
  doc: SparseDocument,
  corpus: SparseCorpus,
): number {
  if (corpus.averageLength === 0) return 0;

  const norm = BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / corpus.averageLength);
  let total = 0;

  for (const term of queryTerms) {
    const tf = doc.terms[term] ?? 0;
    if (tf === 0) continue;
    total += idf(term, corpus) * ((tf * (BM25_K1 + 1)) / (tf + norm));
  }

  return total;
}

export interface Bm25Hit {
  readonly id: string;
  readonly score: number;
}

/** Ranked sparse hits. Ties break by id so the ranking is deterministic. */
export function searchSparse(
  queryTerms: readonly string[],
  corpus: SparseCorpus,
  k: number,
): readonly Bm25Hit[] {
  const hits: Bm25Hit[] = [];

  for (const doc of corpus.documents) {
    const score = scoreDocument(queryTerms, doc, corpus);
    if (score > 0) hits.push({ id: doc.id, score });
  }

  hits.sort((a, b) => (b.score === a.score ? (a.id < b.id ? -1 : 1) : b.score - a.score));
  return hits.slice(0, Math.max(0, k));
}

/** Deduplicate query terms, preserving first-occurrence order. */
export function uniqueTerms(terms: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
