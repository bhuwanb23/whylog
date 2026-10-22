/**
 * Rerank dispatch — 3.5.
 *
 * Phase 3 · sub-phase 3.5
 * Plan: plan/phase-3-retrieval.md §3.5
 *
 * ---------------------------------------------------------------------------
 * ONE RULE: USE THE BEST RERANKER AVAILABLE, AND SAY WHICH ONE WAS USED
 *
 * The engine declares whether it can rerank. If it can, the model reads query and candidate
 * jointly — which is strictly more information than any weighted sum of independent signals
 * can use. If it cannot, the five weighted components score instead, and they are not a
 * degraded guess at the same thing: they are a different, fully inspectable method whose
 * arithmetic a user can read and argue with.
 *
 * `method` is on the result and rendered in the UI. A ranking whose provenance is unstated
 * is a ranking nobody can audit, and "the model decides" and "five numbers you can read"
 * have to be distinguishable at a glance.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { WhyLogEngine } from "@/ai/types";
import type { IndexArtifacts, RetrievedHit } from "@/types/retrieval";
import type { GraphState } from "@/substrate/graph-state";
import {
  canRerankWithModel,
  rerankWithModel,
  type ModelRerankInput,
} from "./cross-encoder";
import {
  rerankLocally,
  explainScore,
  type LocalRerankInput,
  type RerankCandidate,
  type ScoredCandidate,
} from "./local-weights";

export type RerankMethod = "llm-listwise" | "local-weights";

export interface RerankResult {
  readonly order: readonly DecisionId[];
  readonly method: RerankMethod;
  /** Only present for `local-weights`: the model path returns scores without components,
   *  and inventing components for it would be inventing an explanation. */
  readonly scored: readonly ScoredCandidate[];
  readonly durationMs: number;
  readonly engine: string;
}

export interface RerankInput {
  readonly query: string;
  readonly candidates: readonly RerankCandidate[];
  readonly artifacts: IndexArtifacts;
  readonly state: GraphState;
  readonly engine: WhyLogEngine;
  readonly queryTerms: readonly string[];
  readonly queryPremises: readonly PremiseId[];
  readonly topK: number;
  readonly now: number;
  readonly signal?: AbortSignal;
  /** Force the weighted path even when a model is available — used by Phase 7's ablation
   *  to measure what the reranker actually contributes. */
  readonly forceLocal?: boolean;
}

/**
 * Rerank, using the best method available.
 *
 * PROMOTED CANDIDATES STAY PROMOTED. A structural or premise hit was promoted to the top
 * before fusion because exact evidence outranks statistical evidence, and a reranker that
 * could demote it would undo the one rule that makes L4 and L5 worth having. Promoted
 * candidates are held at the front in their existing order and the reranker orders the rest.
 */
export async function rerank(input: RerankInput): Promise<RerankResult> {
  const useModel = input.forceLocal !== true && canRerankWithModel(input.engine);

  if (!useModel) {
    const localInput: LocalRerankInput = {
      query: input.query,
      queryTerms: input.queryTerms,
      candidates: input.candidates,
      artifacts: input.artifacts,
      state: input.state,
      queryPremises: input.queryPremises,
      now: input.now,
    };

    const scored = rerankLocally(localInput);
    return {
      order: orderWithPromotion(scored.map((entry) => entry.candidate), scored.map((entry) => entry.candidate.decisionId)),
      method: "local-weights",
      scored,
      durationMs: 0,
      engine: describeEngineId(input.engine.id()),
    };
  }

  /* ---- the model path ---- */
  const texts: readonly ModelRerankInput[] = input.candidates.map((candidate) => ({
    id: candidate.decisionId,
    text: textFor(input.state, candidate.decisionId),
  }));

  const result = await rerankWithModel(
    input.engine,
    input.query,
    texts,
    input.topK,
    input.signal,
  );

  /* The model returns an order but no components, so `scored` is the LOCAL scoring of the
   * same candidates. It is labelled as such by `method`: the components explain what the
   * weighted scorer thought, which is still useful for inspection even when it did not
   * decide the order. Presenting them as the reason for the model's order would be a lie. */
  const scored = rerankLocally({
    query: input.query,
    queryTerms: input.queryTerms,
    candidates: input.candidates,
    artifacts: input.artifacts,
    state: input.state,
    queryPremises: input.queryPremises,
    now: input.now,
  });

  return {
    order: orderWithPromotion(
      input.candidates,
      result.ranked.map((entry) => entry.id),
    ),
    method: "llm-listwise",
    scored,
    durationMs: result.durationMs,
    engine: describeEngineId(result.engine),
  };
}

/**
 * Hold promoted candidates at the front; order everything else by the reranker.
 *
 * Three groups, concatenated, de-duplicated:
 *   1. promoted candidates, in the order L4/L5 produced them (value matches before
 *      variable matches, which is specificity order)
 *   2. the reranker's order, minus anything already promoted
 *   3. anything the reranker never returned at all — a candidate truncated out of its
 *      top-k. Dropping it would silently lose an exact structural hit, which is the one
 *      result this layer must never lose.
 */
function orderWithPromotion(
  candidates: readonly RerankCandidate[],
  ranked: readonly DecisionId[],
): readonly DecisionId[] {
  const promoted = candidates
    .filter((candidate) => candidate.promoted)
    .map((candidate) => candidate.decisionId);
  const promotedSet = new Set(promoted);
  const rankedSet = new Set(ranked);

  const rest = ranked.filter((id) => !promotedSet.has(id));
  const neverRanked = candidates
    .map((candidate) => candidate.decisionId)
    .filter((id) => !promotedSet.has(id) && !rankedSet.has(id));

  const out: DecisionId[] = [];
  const seen = new Set<DecisionId>();
  for (const id of [...promoted, ...rest, ...neverRanked]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The text a cross-encoder reads jointly with the query. */
function textFor(state: GraphState, decisionId: DecisionId): string {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return decisionId;

  const parts = [decision.statement];
  if (decision.rationale !== undefined && decision.rationale.length > 0) parts.push(decision.rationale);
  if (decision.yStatement !== undefined) parts.push(decision.yStatement);

  return parts.join("\n");
}

function describeEngineId(engineId: { kind: string; model: string }): string {
  return engineId.model.length > 0 ? engineId.kind + ":" + engineId.model : engineId.kind;
}

/** Which method WOULD be used, before running anything — for the UI to state its policy. */
export function rerankMethodFor(engine: WhyLogEngine): RerankMethod {
  return canRerankWithModel(engine) ? "llm-listwise" : "local-weights";
}

export function describeMethod(method: RerankMethod): string {
  return method === "llm-listwise"
    ? "LLM listwise — the model read the query and every candidate JOINTLY and ordered them. A bi-encoder cannot represent the relationship between two texts it embedded separately; this can, which is why it sees negation and scope."
    : "Local weighted — five inspectable components: structural 0.35, lexical 0.30, dense 0.20, premise 0.10, recency 0.05. No model, no key, and every number below is one you can argue with.";
}

export { explainScore, rerankLocally, canRerankWithModel, rerankWithModel };
export { RERANK_WEIGHTS, RECENCY_HALF_LIFE_DAYS, describeWeights, dominantComponents } from "./local-weights";
export { describeUnavailablePath } from "./cross-encoder";
export type { RerankCandidate, ScoredCandidate, LocalRerankInput } from "./local-weights";
export type { ModelRerankInput, ModelRerankResult } from "./cross-encoder";
