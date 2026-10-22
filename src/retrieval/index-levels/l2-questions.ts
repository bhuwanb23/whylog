/**
 * L2 ΓÇö inverted questions (HyPE). 3.1
 *
 * Phase 3 ┬╖ sub-phase 3.1
 * Plan: plan/phase-3-retrieval.md ┬º3.1
 * Research: docs/03 ┬º2.2
 *
 * ---------------------------------------------------------------------------
 * THE ASYMMETRY THIS REMOVES
 *
 *   NAIVE                            WhyLog
 *   ΓöÇΓöÇΓöÇΓöÇΓöÇ                            ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
 *   "why did we drop auth?"          "why did we drop auth?"
 *            Γöé                                Γöé
 *            Γû╝                                Γû╝
 *   match against STATEMENTS         match against INVERTED QUESTIONS
 *   "Drop auth entirely ΓÇö local      "why is there no login?"
 *    single-user tool"               "did we decide about auth?"
 *            Γöé                                Γöé
 *            Γû╝                                Γû╝
 *   interrogative vs declarative     question Γåö question
 *   ΓÇö a dialect mismatch             ΓÇö same shape, same dialect
 *
 * HyPE (Vake et al. 2025) precomputes hypothetical questions per chunk at INDEX time, so
 * query matching becomes question-to-question retrieval. WhyLog's queries are ALREADY
 * questions ΓÇö "why did we drop auth?" is not a document-shaped query needing HyDE's
 * dialect translation, it wants another question. So the asymmetry is removed completely
 * rather than approximately.
 *
 * ---------------------------------------------------------------------------
 * COST: ZERO ADDITIONAL LLM CALLS
 *
 * The questions are generated from templates over the ontology
 * (`projections/indexes.ts:questionsFor`), during an extraction call that is already
 * happening. Nothing here calls a model. On the LLM path the schema carries
 * `questionsThisAnswers` so the model can supply better ones; the templates are the
 * fallback and the entire local path.
 *
 * ---------------------------------------------------------------------------
 * ONE VECTOR PER DECISION, NOT ONE PER QUESTION
 *
 * `index-artifacts.ts` stores `questionVectors` keyed by decision id ΓÇö a single slot.
 * So the questions for one decision are concatenated and embedded together. That is a
 * real trade: it loses the ability to match a single question precisely, and it is taken
 * because five vectors per decision is five times the storage and five times the
 * brute-force cosine work, for a corpus of one-sentence documents where the questions
 * are already near-duplicates of each other.
 *
 * If Phase 7's ablation shows L2 underperforming, the fix is to store one vector per
 * question and max-pool the scores ΓÇö not to tune the templates.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { IndexArtifacts, RankedHit } from "@/types/retrieval";
import { cosine } from "@/lib/cosine";
import { rank } from "../rrf";

/**
 * Rank decisions by how well the query matches the questions they answer.
 *
 * Empty when the index is stale, for the same reason L1 is: cosine across embedding
 * spaces is meaningless, and a stale L2 that scored anyway would corrupt every fusion
 * it entered.
 */
export function searchL2(
  artifacts: IndexArtifacts,
  queryVector: Float32Array,
  k: number,
): readonly RankedHit[] {
  if (artifacts.stale) return [];

  const scored: { id: DecisionId; score: number }[] = [];

  for (const entry of artifacts.dense) {
    if (entry.level !== "L2") continue;
    scored.push({ id: entry.decisionId, score: cosine(queryVector, entry.vector) });
  }

  return rank("L2", scored).slice(0, Math.max(0, k));
}

export function l2Count(artifacts: IndexArtifacts): number {
  return artifacts.dense.filter((entry) => entry.level === "L2").length;
}

/** The synthetic question stored for a decision, for the run trace. Showing which
 *  question matched is what makes L2 inspectable rather than magical. */
export function questionFor(artifacts: IndexArtifacts, decisionId: DecisionId): string | null {
  for (const entry of artifacts.dense) {
    if (entry.level === "L2" && entry.decisionId === decisionId && entry.question !== undefined) {
      return entry.question;
    }
  }
  return null;
}

/**
 * Concatenate the generated questions into the single text L2 embeds.
 *
 * Joined with newlines rather than spaces: the local hashed n-gram embedder treats a
 * newline as a hard boundary, which stops the last word of one question and the first of
 * the next forming a spurious bigram that matches nothing real.
 */
export function l2Text(questions: readonly string[]): string {
  return questions.join("\n");
}

export function describeL2(artifacts: IndexArtifacts): string {
  if (artifacts.stale) {
    return "L2 inverted questions ΓÇö DISABLED with L1, for the same reason.";
  }
  const count = l2Count(artifacts);
  return count === 0
    ? "L2 inverted questions ΓÇö none built. Question-shaped queries fall back to L1 and L3."
    : "L2 inverted questions (HyPE) ΓÇö " + count + " decision(s). Query matching becomes question-to-question, which removes the interrogative/declarative asymmetry entirely. Cost: zero extra model calls.";
}
