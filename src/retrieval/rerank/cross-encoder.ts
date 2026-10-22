/**
 * Cross-encoder reranking — 3.5.
 *
 * Phase 3 · sub-phase 3.5
 * Plan: plan/phase-3-retrieval.md §3.5
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND STAGE AT ALL
 *
 * A bi-encoder embeds query and document INDEPENDENTLY and compares the vectors. It
 * structurally cannot represent the relationship between them — it never saw them together.
 * A cross-encoder reads them JOINTLY, so it can attend to negation, scope and qualification:
 * the things that decide whether "use Postgres" answers "why didn't we use Postgres?".
 *
 * Reported as the single largest retrieval quality boost in a standard RAG pipeline, on the
 * order of +27 percentage points precision@1.
 *
 * ---------------------------------------------------------------------------
 * THREE IMPLEMENTATIONS, AND WHICH ONE THIS FILE ACTUALLY SHIPS
 *
 *   LLM                    provider model as a listwise reranker      — IMPLEMENTED
 *   local + download       cross-encoder/ms-marco-MiniLM-L-6-v2       — NOT AVAILABLE
 *   local, zero download   the five weighted components               — local-weights.ts
 *
 * The middle row needs a ~6M-parameter model file and an inference runtime. Both are
 * outside the dependency budget (no NLP package, no model download), and adding either
 * would break the property that the app runs in a sandboxed browser frame with no network
 * and no key. So the dispatch below offers the LLM path when a provider supports reranking
 * and the weighted path otherwise, and the downloaded-model path is documented rather than
 * faked.
 *
 * Faking it — shipping a "cross-encoder" that is secretly the weighted scorer — would be
 * worse than not having it, because the UI would report a capability the system does not
 * have.
 *
 * ---------------------------------------------------------------------------
 * THE HARD RULE, ENFORCED BY THE SIGNATURE
 *
 * `rerankWithModel(query, ...)` takes the ORIGINAL QUERY. There is no parameter through
 * which a HyDE hypothetical could be passed, so scoring against one is not expressible.
 * Mixing them is the most common way this pipeline is silently broken, and a signature that
 * forbids it is worth more than a comment that warns about it.
 * ---------------------------------------------------------------------------
 */

import type { WhyLogEngine } from "@/ai/types";
import type { DecisionId, EngineId } from "@/types/common";

export interface ModelRerankInput {
  readonly id: DecisionId;
  /** The text the model reads JOINTLY with the query. Statement plus rationale plus the
   *  premises, because a decision is not just its one-line statement. */
  readonly text: string;
}

export interface ModelRerankResult {
  readonly ranked: readonly { id: DecisionId; score: number }[];
  readonly engine: EngineId;
  readonly method: "llm-listwise";
  readonly durationMs: number;
}

/**
 * Listwise reranking through the provider model.
 *
 * LISTWISE, not pointwise: the model sees all candidates at once and orders them. Pointwise
 * scoring asks "how relevant is this one?" k times, and the scores are not comparable across
 * calls because each call has its own notion of the scale. Ordering five things against each
 * other is both cheaper (one call) and better calibrated.
 */
export async function rerankWithModel(
  engine: WhyLogEngine,
  query: string,
  candidates: readonly ModelRerankInput[],
  k: number,
  signal?: AbortSignal,
): Promise<ModelRerankResult> {
  const started = nowMs();

  const result = await engine.rerank({
    query,
    candidates: candidates.map((candidate) => ({ id: candidate.id, text: candidate.text })),
    k,
    ...(signal === undefined ? {} : { signal }),
  });

  return {
    ranked: result.ranked.map((entry) => ({ id: entry.id as DecisionId, score: entry.score })),
    engine: result.engine,
    method: "llm-listwise",
    durationMs: Math.round(nowMs() - started),
  };
}

/** Whether this engine can rerank at all. The dispatch reads this and nothing else. */
export function canRerankWithModel(engine: WhyLogEngine): boolean {
  return engine.capabilities().reranking;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * What the downloaded-model path would require, stated plainly.
 *
 * Recorded here rather than left as a gap in someone's head: this is a deliberate scope
 * decision with a reason, not an oversight, and the reason is the dependency budget.
 */
export function describeUnavailablePath(): string {
  return [
    "cross-encoder/ms-marco-MiniLM-L-6-v2 (~6M params) — NOT AVAILABLE.",
    "",
    "It needs a model file and an inference runtime. Both are outside the dependency budget",
    "(no NLP package, no model download, no network in the sandbox), and either one would",
    "break the property that the app runs in a browser frame with no key and no connection.",
    "",
    "The dispatch therefore offers: LLM listwise when a provider supports reranking, and the",
    "five weighted components otherwise. Both are real. A third option that pretended to be",
    "a cross-encoder would report a capability the system does not have.",
  ].join("\n");
}
