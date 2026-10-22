/**
 * The embedding index: derived data, stored OUTSIDE the log.
 *
 * Phase 0 · sub-phase 0.8
 * Plan: plan/phase-0-foundation.md §0.8
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * VECTORS NEVER ENTER THE EVENT LOG. The log records `IndexRebuilt` and
 * `IndexStale` — the FACT that an index exists, who built it and when — and
 * nothing else. The vectors themselves live in a separate blob under their own
 * storage key.
 *
 * Three reasons, in order of importance:
 *
 *   1. THEY ARE DERIVED. Anything recomputable from the log does not belong in
 *      the log. Putting vectors in the chain would make a re-embed a history
 *      event, and the chain would grow every time the model changed.
 *
 *   2. THEY ARE ENGINE-SPECIFIC. Cosine similarity across embedding spaces is
 *      MEANINGLESS — not noisy, meaningless. A vector from `text-embedding-3-small`
 *      and one from a hashed n-gram vectoriser do not live in the same space, and
 *      comparing them produces a number that looks like a similarity and is not.
 *      Every vector is therefore tagged with the `EngineId` that produced it, and
 *      a tag mismatch marks the whole index STALE.
 *
 *   3. THEY ARE BIG. 500 decisions x 512 float32 is about 1 MB. In the log, that
 *      is 1 MB replayed on every fold and serialised on every export. Outside it,
 *      it is 1 MB that can be dropped to reclaim quota without losing a single
 *      event.
 *
 * Stale is not an error state. It is the honest state: semantic retrieval is
 * DISABLED, the other three index levels keep working, and the UI says why.
 * ---------------------------------------------------------------------------
 */

import { hashStable } from "@/lib/hash";
import { cosine, l2normalise, topK, type Scored } from "@/lib/cosine";
import { err, ok, type Result } from "@/lib/result";
import { nowISO } from "@/lib/format";
import type { DecisionId, EngineId, ISODateString, PremiseId } from "@/types/common";
import type { DenseIndexEntry, IndexArtifacts, PremiseIndex, SparseIndexEntry, StructuralIndex } from "@/types/retrieval";
import { loadIndexBlob, saveIndexBlob } from "./persistence";

/* -------------------------------------------------------------------------- */
/* The stored blob                                                            */
/* -------------------------------------------------------------------------- */

export const INDEX_FORMAT_VERSION = 1;

/** Vectors are stored as plain number arrays because Float32Array does not
 *  survive JSON. The conversion is explicit in both directions so nothing
 *  silently widens to float64 on the way in. */
export interface StoredIndexBlob {
  readonly formatVersion: number;
  readonly engine: EngineId;
  readonly dimensions: number;
  readonly computedAt: ISODateString;
  /** decisionId -> vector */
  readonly decisions: Readonly<Record<string, readonly number[]>>;
  /** decisionId -> the synthetic question, when L2 was built */
  readonly questions: Readonly<Record<string, string>>;
  /** decisionId -> question vector */
  readonly questionVectors: Readonly<Record<string, readonly number[]>>;
  /** premiseId -> vector */
  readonly premises: Readonly<Record<string, readonly number[]>>;
  /** decisionId -> fingerprint of the text that was embedded, so a changed
   *  statement can be detected without re-embedding everything. */
  readonly textHashes: Readonly<Record<string, string>>;
}

export function emptyBlob(engine: EngineId, dimensions: number, at: ISODateString): StoredIndexBlob {
  return {
    formatVersion: INDEX_FORMAT_VERSION,
    engine,
    dimensions,
    computedAt: at,
    decisions: {},
    questions: {},
    questionVectors: {},
    premises: {},
    textHashes: {},
  };
}

/* -------------------------------------------------------------------------- */
/* Staleness                                                                  */
/* -------------------------------------------------------------------------- */

/** Two engine ids name the same embedding space. */
export function sameSpace(a: EngineId, b: EngineId): boolean {
  return a.kind === b.kind && a.model === b.model;
}

export interface StalenessReport {
  readonly stale: boolean;
  readonly reason: string | null;
  readonly builtBy: EngineId | null;
  readonly builtAt: ISODateString | null;
  readonly dimensions: number;
  readonly count: number;
}

export function staleness(blob: StoredIndexBlob | null, current: EngineId): StalenessReport {
  if (blob === null) {
    return {
      stale: true,
      reason: "No embeddings have been built. Lexical, structural and premise retrieval are working; semantic retrieval is off.",
      builtBy: null,
      builtAt: null,
      dimensions: 0,
      count: 0,
    };
  }

  if (blob.formatVersion !== INDEX_FORMAT_VERSION) {
    return {
      stale: true,
      reason: `The stored index is format v${blob.formatVersion}; this build reads v${INDEX_FORMAT_VERSION}. Re-index to continue.`,
      builtBy: blob.engine,
      builtAt: blob.computedAt,
      dimensions: blob.dimensions,
      count: Object.keys(blob.decisions).length,
    };
  }

  if (!sameSpace(blob.engine, current)) {
    return {
      stale: true,
      reason: `These vectors were produced by ${describeEngine(blob.engine)} and the active engine is ${describeEngine(current)}. Cosine similarity across embedding spaces is meaningless, so semantic retrieval is disabled until you re-index.`,
      builtBy: blob.engine,
      builtAt: blob.computedAt,
      dimensions: blob.dimensions,
      count: Object.keys(blob.decisions).length,
    };
  }

  return {
    stale: false,
    reason: null,
    builtBy: blob.engine,
    builtAt: blob.computedAt,
    dimensions: blob.dimensions,
    count: Object.keys(blob.decisions).length,
  };
}

export function describeEngine(engine: EngineId): string {
  return engine.model.length > 0 ? `${engine.kind}:${engine.model}` : engine.kind;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export function loadBlob(): Result<StoredIndexBlob | null, string> {
  const raw = loadIndexBlob();
  if (!raw.ok) return err(raw.error);
  if (raw.value === null) return ok(null);

  const candidate = raw.value as Partial<StoredIndexBlob>;
  if (
    typeof candidate.dimensions !== "number" ||
    typeof candidate.decisions !== "object" ||
    candidate.decisions === null
  ) {
    // A malformed blob is treated as absent: it is derived data, and refusing to
    // boot over it would be exactly the wrong priority.
    return ok(null);
  }

  return ok(candidate as StoredIndexBlob);
}

export function saveBlob(blob: StoredIndexBlob): Result<void, string> {
  return saveIndexBlob(blob);
}

/** Approximate bytes the blob will occupy. Used to warn before a large embed. */
export function estimateBlobBytes(count: number, dimensions: number): number {
  // A JSON number averages ~8 characters, plus key overhead.
  return Math.ceil(count * dimensions * 8 * 1.15);
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

export interface EmbedTarget {
  readonly id: DecisionId | PremiseId;
  readonly text: string;
}

/**
 * Add or refresh vectors for a set of targets.
 *
 * Incremental by text hash: a target whose text has not changed since the last
 * build keeps its existing vector. Re-embedding 500 decisions because one
 * statement was edited is the kind of cost that makes people stop using a
 * feature, and the hash makes it unnecessary.
 */
export function upsertVectors(
  blob: StoredIndexBlob,
  engine: EngineId,
  targets: readonly EmbedTarget[],
  embed: (text: string) => Float32Array,
  at: ISODateString = nowISO(),
): StoredIndexBlob {
  const decisions: Record<string, readonly number[]> = { ...blob.decisions };
  const premises: Record<string, readonly number[]> = { ...blob.premises };
  const textHashes: Record<string, string> = { ...blob.textHashes };

  for (const target of targets) {
    const hash = hashText(target.text);
    if (textHashes[target.id] === hash) continue;

    const vector = Array.from(l2normalise(embed(target.text)));
    textHashes[target.id] = hash;

    // Decisions are "WLD-…", premises "P-…". Routing by prefix keeps one blob
    // without a second type field on every entry.
    if (target.id.startsWith("P-")) premises[target.id] = vector;
    else decisions[target.id] = vector;
  }

  return { ...blob, engine, computedAt: at, decisions, premises, textHashes };
}

export function upsertQuestionVectors(
  blob: StoredIndexBlob,
  questions: Readonly<Record<string, string>>,
  embed: (text: string) => Float32Array,
): StoredIndexBlob {
  const questionVectors: Record<string, readonly number[]> = { ...blob.questionVectors };

  for (const [id, question] of Object.entries(questions)) {
    const existing = blob.questions[id];
    if (existing === question && questionVectors[id] !== undefined) continue;
    questionVectors[id] = Array.from(l2normalise(embed(question)));
  }

  return { ...blob, questions: { ...blob.questions, ...questions }, questionVectors };
}

/** Drop vectors for nodes that no longer exist. Keeps the blob from growing
 *  forever across supersessions. */
export function prune(
  blob: StoredIndexBlob,
  liveDecisionIds: ReadonlySet<string>,
  livePremiseIds: ReadonlySet<string>,
): StoredIndexBlob {
  const keep = <T>(record: Readonly<Record<string, T>>, live: ReadonlySet<string>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) {
      if (live.has(key)) out[key] = value;
    }
    return out;
  };

  return {
    ...blob,
    decisions: keep(blob.decisions, liveDecisionIds),
    questionVectors: keep(blob.questionVectors, liveDecisionIds),
    questions: keep(blob.questions, liveDecisionIds),
    premises: keep(blob.premises, livePremiseIds),
    textHashes: keep(blob.textHashes, new Set([...liveDecisionIds, ...livePremiseIds])),
  };
}

/** A cheap content hash, so an unchanged statement is not re-embedded. */
function hashText(text: string): string {
  return hashStable(text);
}

/* -------------------------------------------------------------------------- */
/* Querying                                                                   */
/* -------------------------------------------------------------------------- */

/** Brute-force cosine over the stored vectors.
 *
 *  At 500 decisions x 512 dimensions this is well under a millisecond, which is
 *  why there is no vector database in the dependency budget and no plan to add
 *  one. An ANN index would be a genuine improvement at 10^5 vectors, and the
 *  honest note is that this stops being true somewhere around there. */
export function searchDense(
  blob: StoredIndexBlob,
  queryVector: Float32Array,
  k: number,
  level: "decision" | "question" | "premise" = "decision",
): readonly Scored<string>[] {
  const source: Readonly<Record<string, readonly number[]>> =
    level === "question" ? blob.questionVectors : level === "premise" ? blob.premises : blob.decisions;

  const entries = Object.entries(source);
  return topK(
    entries,
    ([, vector]) => cosine(queryVector, vector),
    k,
  ).map(({ item, score }): Scored<string> => ({ item: item[0], score }));
}

export function vectorFor(blob: StoredIndexBlob, id: string): Float32Array | null {
  const stored = blob.decisions[id] ?? blob.premises[id];
  return stored === undefined ? null : Float32Array.from(stored);
}

export function questionVectorFor(blob: StoredIndexBlob, id: string): Float32Array | null {
  const stored = blob.questionVectors[id];
  return stored === undefined ? null : Float32Array.from(stored);
}

/** Vectors for the identity ladder's rungs 4 and 5. */
export function vectorMap(blob: StoredIndexBlob, kind: "decision" | "premise"): ReadonlyMap<string, Float32Array> {
  const source = kind === "decision" ? blob.decisions : blob.premises;
  const out = new Map<string, Float32Array>();
  for (const [id, vector] of Object.entries(source)) out.set(id, Float32Array.from(vector));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Assembling IndexArtifacts                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Combine the stored vectors with the log-derived indexes into the artifact the
 * retrieval layer consumes.
 *
 * The structural, sparse and premise halves come from
 * src/substrate/projections/indexes.ts and are rebuilt from the log every time.
 * Only the dense half is read from disk — which is exactly the split that makes
 * the index disposable.
 */
export function assemble(
  blob: StoredIndexBlob | null,
  current: EngineId,
  structural: StructuralIndex,
  sparse: readonly SparseIndexEntry[],
  premises: PremiseIndex,
  at: ISODateString,
): IndexArtifacts {
  const dense: DenseIndexEntry[] = [];

  if (blob !== null && sameSpace(blob.engine, current)) {
    for (const [id, vector] of Object.entries(blob.decisions)) {
      dense.push({
        decisionId: id as DecisionId,
        level: "L1",
        vector: Float32Array.from(vector),
      });
    }
    for (const [id, vector] of Object.entries(blob.questionVectors)) {
      const question = blob.questions[id];
      dense.push({
        decisionId: id as DecisionId,
        level: "L2",
        vector: Float32Array.from(vector),
        ...(question === undefined ? {} : { question }),
      });
    }
  }

  return {
    engine: blob?.engine ?? current,
    dimensions: blob?.dimensions ?? 0,
    computedAt: blob?.computedAt ?? at,
    stale: blob === null || !sameSpace(blob.engine, current),
    dense,
    sparse,
    structural,
    premises,
  };
}

/** Which levels this artifact actually supports right now. */
export function availableLevels(artifacts: IndexArtifacts): readonly ("L1" | "L2" | "L3" | "L4" | "L5")[] {
  const out: ("L1" | "L2" | "L3" | "L4" | "L5")[] = [];
  if (!artifacts.stale) {
    if (artifacts.dense.some((e) => e.level === "L1")) out.push("L1");
    if (artifacts.dense.some((e) => e.level === "L2")) out.push("L2");
  }
  if (artifacts.sparse.length > 0) out.push("L3");
  out.push("L4", "L5");
  return out;
}
