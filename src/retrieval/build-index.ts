/**
 * Index construction — 3.1–3.3.
 *
 * Phase 3 · sub-phases 3.1, 3.2, 3.3
 * Plan: plan/phase-3-retrieval.md §3.1–§3.3
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT THAT MAKES THE INDEX DISPOSABLE
 *
 * Two halves, built by completely different means:
 *
 *   L1, L2  (dense)      READ FROM DISK. Expensive to build, engine-specific, stored
 *                        outside the log in their own blob (Phase 0.8).
 *   L3, L4, L5           DERIVED FROM THE LOG. Pure functions of `GraphState`, rebuilt
 *                        on every fold, never persisted.
 *
 * Nothing dense is derived and nothing derived is persisted. That is what lets the whole
 * index be thrown away to reclaim quota without losing a single event, and what lets an
 * engine switch mark L1/L2 stale while L3/L4/L5 keep working — the keyless path degrades
 * to a still-useful system instead of failing.
 *
 * ---------------------------------------------------------------------------
 * INCREMENTAL BY TEXT HASH, AND WHY THAT MATTERS MORE THAN IT LOOKS
 *
 * A decision whose statement hash is unchanged keeps its existing vector. Re-embedding
 * 500 decisions because one statement was edited is the kind of cost that makes people
 * stop using a feature — on the LLM path it is 500 paid API calls to fix a typo.
 *
 * §3.1's acceptance criterion is the same fact stated as a requirement: L2 questions "are
 * regenerated when a decision is edited". The hash is what makes regeneration cheap enough
 * to do on every edit rather than as a maintenance step nobody performs.
 *
 * ---------------------------------------------------------------------------
 * ONE BATCHED EMBED CALL
 *
 * `engine.embed` takes an array. Everything pending — L1 statements and L2 questions
 * together — goes in ONE call. The alternative is a call per decision, which on the LLM
 * path turns a 500-decision re-index into 1000 requests.
 *
 * ---------------------------------------------------------------------------
 * THE LOG RECORDS THE FACT, NOT THE DATA
 *
 * `IndexRebuilt` and `IndexStale` go into the chain. The vectors do not. An index is
 * derived, and putting derived data in an append-only log turns every re-embed into a
 * history event — the chain would grow every time the model changed, and an export would
 * carry a megabyte of floats the importer could not even use.
 * ---------------------------------------------------------------------------
 */

import type { Actor, DecisionId, EngineId, ISODateString, PremiseId } from "@/types/common";
import type { NewEvent } from "@/types/events";
import type { IndexArtifacts } from "@/types/retrieval";
import type { GraphState } from "@/substrate/graph-state";
import type { WhyLogEngine } from "@/ai/types";
import {
  assemble,
  emptyBlob,
  estimateBlobBytes,
  loadBlob,
  prune,
  sameSpace,
  saveBlob,
  staleness,
  type StalenessReport,
  type StoredIndexBlob,
} from "@/substrate/index-artifacts";
import {
  buildPremiseIndex,
  buildSparseDocuments,
  buildStructuralIndex,
  questionsFor,
} from "@/substrate/projections/indexes";
import { hashStable } from "@/lib/hash";
import { nowISO } from "@/lib/format";
import { l1Text } from "./index-levels/l1-dense";
import { l2Text } from "./index-levels/l2-questions";

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

export interface BuildReport {
  readonly artifacts: IndexArtifacts;
  readonly staleness: StalenessReport;
  /** Vectors actually embedded this run. Zero means everything was already current. */
  readonly embedded: number;
  /** Decisions skipped because their text hash had not changed. */
  readonly skipped: number;
  readonly questionsBuilt: number;
  readonly pruned: number;
  readonly estimatedBytes: number;
  readonly durationMs: number;
  readonly levels: readonly IndexLevelName[];
  /** The events to append. The store commits them; this module never writes. */
  readonly drafts: readonly (NewEvent<"IndexRebuilt"> | NewEvent<"IndexStale">)[];
  readonly saved: boolean;
  readonly saveError: string | null;
}

export type IndexLevelName = "L1" | "L2" | "L3" | "L4" | "L5";

export interface BuildOptions {
  readonly state: GraphState;
  readonly engine: WhyLogEngine;
  readonly actor: Actor;
  /** Skip embedding entirely — build only L3/L4/L5. The keyless fast path, and what a
   *  user who does not want vectors at all should be offered. */
  readonly skipDense?: boolean;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build the full index.
 *
 * Never throws on a stale or absent blob: those are honest states, not errors, and the run
 * continues with whatever levels are available. `levels` says which.
 */
export async function buildIndex(options: BuildOptions): Promise<BuildReport> {
  const started = nowMs();
  const { state, engine } = options;
  const engineId: EngineId = engine.id();
  const at = nowISO() as ISODateString;

  /* ---- L3, L4, L5: pure functions of the log, no model, no I/O ---- */
  const structural = buildStructuralIndex(state);
  const premiseIndex = buildPremiseIndex(state);

  const sparse = buildSparseDocuments(state).map((doc) => ({
    decisionId: doc.id as DecisionId,
    terms: doc.terms,
    length: doc.length,
  }));

  /* ---- L1, L2: load the blob, embed only what changed ---- */
  const loaded = loadBlob();
  const existing: StoredIndexBlob =
    loaded.ok && loaded.value !== null ? loaded.value : emptyBlob(engineId, engine.dimensions, at);

  let blob = existing;
  let embedded = 0;
  let skipped = state.decisions.size;
  let questionsBuilt = 0;
  let pruned = 0;

  if (options.skipDense !== true) {
    const dense = await embedChanged(state, engine, existing, options.signal);
    blob = dense.blob;
    embedded = dense.embedded;
    skipped = dense.skipped;
    questionsBuilt = dense.questionsBuilt;
    pruned = dense.pruned;
  } else {
    /* Dense skipped deliberately. The blob is left EXACTLY as loaded — not emptied — so
     * turning dense back on does not force a re-embed of everything. */
    pruned = pruneCount(state, existing);
    blob = prune(existing, liveDecisions(state), livePremises(state));
  }

  const artifacts = assemble(blob, engineId, structural, sparse, premiseIndex, at);
  const levels = levelsOf(artifacts);

  const saved = saveBlob(blob);
  const drafts = indexDrafts(artifacts, engineId, blob, at, options.actor, levels);

  return {
    artifacts,
    staleness: staleness(blob, engineId),
    embedded,
    skipped,
    questionsBuilt,
    pruned,
    estimatedBytes: estimateBlobBytes(Object.keys(blob.decisions).length, blob.dimensions),
    durationMs: Math.round(nowMs() - started),
    levels,
    drafts,
    saved: saved.ok,
    saveError: saved.ok ? null : saved.error,
  };
}

/* -------------------------------------------------------------------------- */
/* The dense half                                                             */
/* -------------------------------------------------------------------------- */

interface DenseBuild {
  readonly blob: StoredIndexBlob;
  readonly embedded: number;
  readonly skipped: number;
  readonly questionsBuilt: number;
  readonly pruned: number;
}

/**
 * Embed everything whose text changed, in ONE batched call.
 *
 * L1 statements and L2 questions are batched together because they are the same kind of
 * work against the same model, and splitting them would double the request count on the
 * LLM path for no benefit.
 */
async function embedChanged(
  state: GraphState,
  engine: WhyLogEngine,
  existing: StoredIndexBlob,
  signal?: AbortSignal,
): Promise<DenseBuild> {
  const engineId = engine.id();
  const at = nowISO() as ISODateString;

  /* A blob from a different embedding space cannot be extended: cosine across spaces is
   * meaningless, so mixing new vectors into it would produce scores that look comparable
   * and are not. Start over rather than patch. */
  const blob = sameSpace(existing.engine, engineId)
    ? existing
    : emptyBlob(engineId, engine.dimensions, at);

  const decisions = [...state.decisions.values()];

  const pendingStatements: { id: DecisionId; text: string }[] = [];
  const pendingQuestions: { id: DecisionId; text: string }[] = [];
  const questions: Record<string, string> = {};

  for (const decision of decisions) {
    const statementText = l1Text(decision.statement, decision.rationale);
    if (blob.textHashes[decision.id] !== hashStable(statementText)) {
      pendingStatements.push({ id: decision.id, text: statementText });
    }

    /* §3.1: questions are REGENERATED when a decision is edited. The question text is
     * derived from the statement, so comparing the generated string is the check — a
     * decision edited in a way that does not change its questions does not re-embed them. */
    const questionText = l2Text(questionsFor(decision));
    questions[decision.id] = questionText;
    if (blob.questions[decision.id] !== questionText || blob.questionVectors[decision.id] === undefined) {
      pendingQuestions.push({ id: decision.id, text: questionText });
    }
  }

  const texts = [
    ...pendingStatements.map((entry) => entry.text),
    ...pendingQuestions.map((entry) => entry.text),
  ];

  if (texts.length === 0) {
    const pruned = pruneCount(state, blob);
    return {
      blob: prune(blob, liveDecisions(state), livePremises(state)),
      embedded: 0,
      skipped: decisions.length,
      questionsBuilt: Object.keys(questions).length,
      pruned,
    };
  }

  const result = await engine.embed(texts, signal);

  const decisionsRecord: Record<string, readonly number[]> = { ...blob.decisions };
  const hashes: Record<string, string> = { ...blob.textHashes };
  const questionVectors: Record<string, readonly number[]> = { ...blob.questionVectors };

  let cursor = 0;
  for (const entry of pendingStatements) {
    const vector = result.vectors[cursor];
    cursor += 1;
    if (vector === undefined) continue;
    decisionsRecord[entry.id] = Array.from(vector);
    hashes[entry.id] = hashStable(entry.text);
  }
  for (const entry of pendingQuestions) {
    const vector = result.vectors[cursor];
    cursor += 1;
    if (vector === undefined) continue;
    questionVectors[entry.id] = Array.from(vector);
  }

  const beforePrune = countVectors(blob);
  const next: StoredIndexBlob = {
    ...blob,
    engine: engineId,
    dimensions: result.dimensions,
    computedAt: at,
    decisions: decisionsRecord,
    questionVectors,
    questions: { ...blob.questions, ...questions },
    textHashes: hashes,
  };
  const prunedBlob = prune(next, liveDecisions(state), livePremises(state));

  return {
    blob: prunedBlob,
    embedded: pendingStatements.length + pendingQuestions.length,
    skipped: decisions.length - pendingStatements.length,
    questionsBuilt: Object.keys(questions).length,
    pruned: Math.max(0, beforePrune - countVectors(prunedBlob)),
  };
}

/**
 * Premise vectors, on demand.
 *
 * Not built in every run: premises are only embedded when identity resolution's rung 5
 * needs them, and most runs do not. Building them eagerly would pay for vectors nothing
 * reads.
 */
export async function embedPremises(
  state: GraphState,
  engine: WhyLogEngine,
  existing: StoredIndexBlob,
  premiseText: (premiseId: PremiseId) => string,
): Promise<StoredIndexBlob> {
  const pending = [...state.premises.values()]
    .map((premise) => ({ id: premise.id, text: premiseText(premise.id) }))
    .filter((entry) => existing.textHashes[entry.id] !== hashStable(entry.text));

  if (pending.length === 0) return existing;

  const result = await engine.embed(pending.map((entry) => entry.text));
  const premises: Record<string, readonly number[]> = { ...existing.premises };
  const hashes: Record<string, string> = { ...existing.textHashes };

  pending.forEach((entry, index) => {
    const vector = result.vectors[index];
    if (vector === undefined) return;
    premises[entry.id] = Array.from(vector);
    hashes[entry.id] = hashStable(entry.text);
  });

  return { ...existing, premises, textHashes: hashes };
}

/* -------------------------------------------------------------------------- */
/* The events                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `IndexRebuilt` when the index is current, `IndexStale` when it is not.
 *
 * Both belong in the log because both are facts about the log's HISTORY that a reader six
 * months later needs: "semantic search was off from here to here" is not recoverable from
 * the blob, which only records the present.
 */
function indexDrafts(
  artifacts: IndexArtifacts,
  engineId: EngineId,
  blob: StoredIndexBlob,
  at: ISODateString,
  actor: Actor,
  levels: readonly IndexLevelName[],
): readonly (NewEvent<"IndexRebuilt"> | NewEvent<"IndexStale">)[] {
  if (artifacts.stale) {
    return [
      {
        type: "IndexStale",
        payload: { staleEngine: blob.engine, currentEngine: engineId },
        actor,
        reason:
          "The stored vectors were produced by a different embedding space than the active engine. Cosine similarity across spaces is meaningless — not noisy, meaningless — so L1 and L2 are disabled until the index is rebuilt. L3, L4 and L5 are pure functions of the log and keep working.",
        at,
      },
    ];
  }

  return [
    {
      type: "IndexRebuilt",
      payload: {
        engine: engineId,
        decisionsIndexed: Object.keys(blob.decisions).length,
        levels,
      },
      actor,
      reason:
        levels.length === 0
          ? "Index built with no levels available: the log has no live decisions."
          : "Index rebuilt. Levels " +
            levels.join(", ") +
            ". The vectors themselves live outside the log — this event records the FACT that an index exists, who built it and when, because that is history and the floats are not.",
      at,
    },
  ];
}

function levelsOf(artifacts: IndexArtifacts): readonly IndexLevelName[] {
  const out: IndexLevelName[] = [];
  if (!artifacts.stale) {
    if (artifacts.dense.some((entry) => entry.level === "L1")) out.push("L1");
    if (artifacts.dense.some((entry) => entry.level === "L2")) out.push("L2");
  }
  if (artifacts.sparse.length > 0) out.push("L3");
  /* L4 and L5 are maps built from the log. They exist even when empty, and an empty one
   * is a true statement about an empty log rather than a missing level. */
  out.push("L4", "L5");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function liveDecisions(state: GraphState): ReadonlySet<string> {
  return new Set<string>([...state.decisions.keys()]);
}

function livePremises(state: GraphState): ReadonlySet<string> {
  return new Set<string>([...state.premises.keys()]);
}

function countVectors(blob: StoredIndexBlob): number {
  return (
    Object.keys(blob.decisions).length +
    Object.keys(blob.premises).length +
    Object.keys(blob.questionVectors).length
  );
}

function pruneCount(state: GraphState, blob: StoredIndexBlob): number {
  const live = new Set<string>([...liveDecisions(state), ...livePremises(state)]);
  let dead = 0;
  for (const key of Object.keys(blob.decisions)) if (!live.has(key)) dead += 1;
  for (const key of Object.keys(blob.premises)) if (!live.has(key)) dead += 1;
  for (const key of Object.keys(blob.questionVectors)) if (!live.has(key)) dead += 1;
  return dead;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the build did, in numbers a user can check.
 *
 * The embedded/skipped split is the point: it is the difference between "re-indexing costs
 * 500 API calls" and "re-indexing costs one", and a user deciding whether to trust the
 * feature with a key needs to see which one they are getting.
 */
export function describeBuild(report: BuildReport): string {
  const lines = [
    "Index build — " + report.durationMs + " ms",
    "  levels available: " + (report.levels.length === 0 ? "none" : report.levels.join(", ")),
    "  vectors embedded: " + report.embedded + "  ·  decisions unchanged: " + report.skipped,
    "  inverted questions: " + report.questionsBuilt + "  ·  dead vectors pruned: " + report.pruned,
    "  estimated blob size: " + Math.round(report.estimatedBytes / 1024) + " KB",
  ];

  if (report.staleness.stale && report.staleness.reason !== null) {
    lines.push("  STALE: " + report.staleness.reason);
  }
  if (!report.saved && report.saveError !== null) {
    lines.push("  NOT SAVED: " + report.saveError + " — the index works this session and is rebuilt next load.");
  }

  return lines.join("\n");
}

export { sameSpace, staleness, loadBlob, saveBlob, emptyBlob, estimateBlobBytes };
export type { StoredIndexBlob, StalenessReport };
