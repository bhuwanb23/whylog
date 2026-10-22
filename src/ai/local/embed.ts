/**
 * The hashed n-gram vectoriser.
 *
 * Phase 0 ┬╖ sub-phase 0.8 ΓÇö the local engine's embedding implementation
 * Plan: plan/phase-0-foundation.md ┬º0.8 ┬╖ docs/03 ┬º2 (the four-level index)
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 *
 * A deterministic, offline, keyless text vectoriser: 512 dimensions, built from
 * unigrams, bigrams and character 3-grams, each hashed to a bucket and a SIGN,
 * accumulated with a weight, then L2-normalised.
 *
 * It is a hashing-trick / feature-hashing vectoriser in the classic sense. It is
 * not a learned embedding, and it does not pretend to be one.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS GOOD ENOUGH TO SHIP AS THE DEFAULT
 *
 * The task is not open-domain semantic similarity. It is: does this query concern
 * the same technology, the same slot, the same constraint as this decision? For
 * that, shared character n-grams do a great deal of work ΓÇö "postgres",
 * "postgresql" and "pg-backed store" overlap heavily in trigram space, and
 * "sqlite" and "postgres" barely overlap at all.
 *
 * The signed accumulation is what makes it better than a bag of trigrams:
 * collisions cancel rather than accumulate, so two unrelated texts that happen to
 * share a trigram do not drift together.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT DO, STATED PLAINLY
 *
 * It cannot detect contradiction. "Use Postgres" and "Do not use Postgres" share
 * almost every feature and will land at cosine ~0.9. That is not a bug to fix ΓÇö
 * it is the load-bearing fact behind the whole three-gate design (docs/03 ┬º3), and
 * it is why `classify` is a separate capability from `embed` and why the
 * structural gate runs before either. A vectoriser that could tell those apart
 * would be a polarity classifier, and that is a different job.
 *
 * Consequently: this vectoriser powers RETRIEVAL, never contradiction detection.
 * ---------------------------------------------------------------------------
 */

import { charNgrams, contentTokens, normalise, tokenise } from "@/lib/text";
import { l2normalise } from "@/lib/cosine";
import type { EngineId } from "@/types/common";
import { LOCAL_DIMENSIONS } from "../config";

export const LOCAL_EMBEDDING_MODEL = "hashed-ngram-v1";

export const LOCAL_ENGINE_ID: EngineId = { kind: "local", model: LOCAL_EMBEDDING_MODEL };

/** Feature weights. Unigrams carry the most signal; character n-grams catch
 *  morphological variants the token list misses ("postgres"/"postgresql"). */
const WEIGHTS = {
  unigram: 1.0,
  bigram: 1.4,
  trigramChar: 0.6,
  variableTag: 0.9,
} as const;

/**
 * FNV-1a, 32-bit.
 *
 * Chosen over the log's `hash128` for one reason: this runs once per feature per
 * document, so it is the hottest loop in the index build, and a 13-character hex
 * round trip would dominate it. Distribution is adequate for 512 buckets.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bucket and sign for one feature, from one hash. The sign comes from a bit the
 *  bucket does not use, so the two are independent. */
function bucketAndSign(feature: string, dimensions: number): { bucket: number; sign: 1 | -1 } {
  const h = fnv1a(feature);
  return {
    bucket: h % dimensions,
    sign: (h >>> 16) & 1 ? 1 : -1,
  };
}

export interface EmbedOptions {
  readonly dimensions?: number;
  /** Prefix every feature with this tag. Used to keep decision vectors and
   *  premise vectors in distinguishable sub-spaces when they share one blob. */
  readonly namespace?: string;
  /** Extra features whose presence matters more than their frequency ΓÇö a decision
   *  variable name, a premise predicate. */
  readonly tags?: readonly string[];
}

/**
 * Embed one text.
 *
 * Pure and synchronous: the same string always produces the same vector, on every
 * machine, forever. That is what makes the local path REPRODUCIBLE, and it is why
 * Phase 7's ablation can compare engines on identical inputs rather than on two
 * samples of a stochastic one.
 */
export function embedText(text: string, options: EmbedOptions = {}): Float32Array {
  const dimensions = options.dimensions ?? LOCAL_DIMENSIONS;
  const namespace = options.namespace ?? "";
  const vector = new Float32Array(dimensions);

  const normalised = normalise(text);
  const tokens = contentTokens(normalised);
  const allTokens = tokenise(normalised);

  const add = (feature: string, weight: number): void => {
    const { bucket, sign } = bucketAndSign(namespace.length > 0 ? `${namespace}\u0001${feature}` : feature, dimensions);
    vector[bucket] = (vector[bucket] ?? 0) + sign * weight;
  };

  /* unigrams ΓÇö content words only, so "we", "the" and "use" do not push every
     decision in the corpus towards each other */
  for (const token of tokens) add(token, WEIGHTS.unigram);

  /* bigrams ΓÇö this is what separates "no postgres" from "postgres". The bigram
     containing the negation is a DIFFERENT FEATURE from the unigram, so the
     vectoriser is not blind to polarity; it merely does not treat it as a
     contradiction, which is the classifier's job. */
  for (let i = 0; i < allTokens.length - 1; i += 1) {
    const a = allTokens[i];
    const b = allTokens[i + 1];
    if (a === undefined || b === undefined) continue;
    add(`${a}_${b}`, WEIGHTS.bigram);
  }

  /* character 3-grams ΓÇö morphological robustness without a stemmer or a
     vocabulary. "postgresql" and "postgres" share nine trigrams. */
  for (const gram of charNgrams(normalised.replace(/\s+/g, " "), 3)) {
    add(gram, WEIGHTS.trigramChar);
  }

  /* explicit tags */
  for (const tag of options.tags ?? []) {
    if (tag.length > 0) add(`#${normalise(tag)}`, WEIGHTS.variableTag);
  }

  return l2normalise(vector);
}

/** Embed a batch. Order-preserving: `vectors[i]` corresponds to `texts[i]`. */
export function embedBatch(
  texts: readonly string[],
  options: EmbedOptions = {},
): readonly Float32Array[] {
  return texts.map((text) => embedText(text, options));
}

/**
 * The text a DECISION is embedded as.
 *
 * Deliberately narrow: the statement, the slot, the canonical value and the
 * rationale. The accepted downside and the rejected alternatives are indexed for
 * BM25 but excluded here, because including "postgres" in the vector for a
 * decision that REJECTED postgres pulls it towards exactly the wrong neighbours.
 */
export function decisionEmbeddingText(input: {
  readonly variable: string;
  readonly value: string;
  readonly statement: string;
  readonly rationale?: string;
}): string {
  return [input.statement, `${input.variable} ${input.value}`, input.rationale ?? ""]
    .filter((part) => part.trim().length > 0)
    .join(". ");
}

/** The text a PREMISE is embedded as. */
export function premiseEmbeddingText(input: {
  readonly type: string;
  readonly predicate: string;
  readonly text: string;
}): string {
  return `${input.text}. ${input.type} ${input.predicate}`;
}

/** The text a QUERY is embedded as. Prefixed with the interrogative form so it
 *  lands nearer the HyPE-style question vectors than the statement vectors, which
 *  is a small free win when L2 exists. */
export function queryEmbeddingText(query: string, variable?: string): string {
  const base = variable === undefined ? query : `${query} ${variable}`;
  return `What did we decide about ${base}?`;
}

/** Dimensions, for the index blob header. */
export function dimensions(options: EmbedOptions = {}): number {
  return options.dimensions ?? LOCAL_DIMENSIONS;
}

/** A cheap self-check: two texts that should be near, and two that should be far.
 *  Run at boot in development; if this fails, the vectoriser has been broken by a
 *  change to the tokeniser and every retrieval number downstream is meaningless. */
export function sanityPairs(): readonly { a: string; b: string; expect: "near" | "far" }[] {
  return [
    { a: "use postgres for the primary store", b: "postgresql as the main database", expect: "near" },
    { a: "use sqlite, it's one file", b: "embedded sqlite database", expect: "near" },
    { a: "use sqlite, it's one file", b: "use postgres for the primary store", expect: "far" },
    { a: "no authentication at all", b: "single user, no login", expect: "near" },
  ];
}
