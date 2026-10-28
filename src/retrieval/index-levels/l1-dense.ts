/**
 * L1 — statement embeddings. 3.1
 *
 * Phase 3 · sub-phase 3.1
 * Plan: plan/phase-3-retrieval.md §3.1
 *
 * ---------------------------------------------------------------------------
 * THE BASELINE, AND WHY IT IS NEVER SUFFICIENT
 *
 * L1 embeds `statement + rationale`. It is necessary and it is the weakest of the five
 * levels, for a reason that is structural rather than a quality problem: **the documents
 * here are one sentence long.** Short-text embeddings are noisy — there is not enough
 * context for the vector to settle, so two unrelated one-line decisions can land close
 * together and two related ones far apart.
 *
 * That is precisely why L2 exists, and why the plan calls L2 "the highest-value cheap win
 * in the phase". L1 stays because it is the only level that can match a query phrased
 * nothing like any question ("the database thing"), and because dropping it would leave
 * L2 matching only question-shaped queries.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE VECTORS COME FROM
 *
 * `substrate/index-artifacts.ts` stores them outside the event log (Phase 0.8), tagged
 * with the engine that produced them. This module never touches storage: it reads the
 * already-assembled `IndexArtifacts` and returns a ranked list. Building is
 * `build-index.ts`'s job.
 *
 * If the index is stale — the engine changed, so cosine across the two spaces would be
 * meaningless — this returns an EMPTY list rather than a confident wrong one. An empty
 * L1 degrades the run to lexical and structural, which still works. A stale L1 that
 * scored anyway would silently corrupt every fusion it entered.
 * ---------------------------------------------------------------------------
 */

import { cosine } from "@/lib/cosine";
import type { DecisionId } from "@/types/common";
import type { IndexArtifacts, RankedHit } from "@/types/retrieval";
import { rank } from "../rrf";

export interface DenseQuery {
  readonly queryVector: Float32Array;
  readonly k: number;
}

/**
 * Rank decisions by cosine against the query vector.
 *
 * L1 entries only. L2 is a separate level and is fused separately, because a decision
 * that matches on both its statement and its inverted questions should score higher than
 * one that matches on either — and merging the two lists here would hide that agreement.
 */
export function searchL1(artifacts: IndexArtifacts, query: DenseQuery): readonly RankedHit[] {
  if (artifacts.stale) return [];

  const scored: { id: DecisionId; score: number }[] = [];

  for (const entry of artifacts.dense) {
    if (entry.level !== "L1") continue;
    scored.push({ id: entry.decisionId, score: cosine(query.queryVector, entry.vector) });
  }

  return rank("L1", scored).slice(0, Math.max(0, query.k));
}

/** How many L1 vectors exist. Zero means semantic retrieval is off, and the UI has to
 *  say so rather than showing an empty result as though it were an answer. */
export function l1Count(artifacts: IndexArtifacts): number {
  return artifacts.dense.filter((entry) => entry.level === "L1").length;
}

/** The text L1 embeds, so the builder and the query side cannot drift apart. */
export function l1Text(statement: string, rationale: string | undefined): string {
  return rationale === undefined || rationale.length === 0
    ? statement
    : statement + ". " + rationale;
}

export function describeL1(artifacts: IndexArtifacts): string {
  if (artifacts.stale) {
    return "L1 statement embeddings — DISABLED. The stored vectors came from a different embedding space; cosine across spaces is meaningless, not noisy.";
  }
  const count = l1Count(artifacts);
  return count === 0
    ? "L1 statement embeddings — none built. Lexical, structural and premise retrieval still work."
    : "L1 statement embeddings — " +
        count +
        " vector(s), " +
        artifacts.dimensions +
        "d. The baseline; necessary, never sufficient, because these documents are one sentence long.";
}
