/**
 * Cosine similarity over dense vectors.
 *
 * Phase 3 · sub-phase 3.1
 * Plan: plan/phase-3-retrieval.md §3.1
 *
 * ---------------------------------------------------------------------------
 * THE NUMBER THAT JUSTIFIES NO VECTOR DATABASE
 *
 * 500 decisions x 512 dimensions x 4 bytes = ~1 MB. A full brute-force scan is
 * 256,000 multiply-adds — under a millisecond in JS. An ANN index would add a
 * network hop, a dependency and an approximation error to speed up something
 * already instantaneous.
 *
 * `topK` below is the boundary at which a real ANN index would slot in if the
 * corpus ever grew by three orders of magnitude.
 * ---------------------------------------------------------------------------
 */

export type Vector = Float32Array | readonly number[];

/** Dot product. Assumes both vectors are L2-normalised by the caller. */
export function dot(a: Vector, b: Vector): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export function magnitude(v: Vector): number {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i] ?? 0;
    sum += x * x;
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity in [-1, 1].
 *
 * Returns 0 for a zero-magnitude vector rather than NaN — a decision with no
 * text produces no signal, and NaN would propagate through RRF and silently
 * corrupt the ranking.
 */
export function cosine(a: Vector, b: Vector): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0) return 0;
  return dot(a, b) / (ma * mb);
}

/** Cosine between two already-L2-normalised vectors: just the dot product. */
export function cosineNormalised(a: Vector, b: Vector): number {
  return dot(a, b);
}

/** L2-normalise in place into a new Float32Array. */
export function l2normalise(v: Vector): Float32Array {
  const out = new Float32Array(v.length);
  const m = magnitude(v);
  if (m === 0) return out;
  for (let i = 0; i < v.length; i += 1) {
    out[i] = (v[i] ?? 0) / m;
  }
  return out;
}

export interface Scored<T> {
  readonly item: T;
  readonly score: number;
}

/**
 * Brute-force top-K. Stable: ties break by original index, so the same input
 * always produces the same ranking — required for the determinism acceptance
 * criterion in Phase 3.4.
 */
export function topK<T>(
  items: readonly T[],
  score: (item: T, index: number) => number,
  k: number,
): readonly Scored<T>[] {
  const scored: { item: T; score: number; index: number }[] = items.map((item, index) => ({
    item,
    score: score(item, index),
    index,
  }));

  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));

  return scored.slice(0, Math.max(0, k)).map(({ item, score }) => ({ item, score }));
}

/** Euclidean distance — used by the premise lattice layout, not by retrieval. */
export function euclidean(a: Vector, b: Vector): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
