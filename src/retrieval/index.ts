/**
 * The retrieval pipeline — Phase 3's entry point.
 *
 * Phase 3 · sub-phases 3.1–3.9
 * Plan: plan/phase-3-retrieval.md §3.4, §3.5, §3.7
 * Docs: docs/03-retrieval-and-contradiction.md
 *
 * ---------------------------------------------------------------------------
 * ONE PASS, FIVE LEVELS, IN THIS ORDER
 *
 *   understand the query          variable, canonical value, terms, premises named
 *   L1 dense                      statement embeddings
 *   L2 dense                      HyPE inverted questions, built at extraction time
 *   L3 sparse                     BM25 over all text fields, ontology-aliased terms
 *   L4 structural                 variable / value index — PROMOTED, not fused
 *   L5 premise                    premise → dependents — PROMOTED, not fused
 *   RRF fusion at k = 60          score-agnostic, so it needs no calibration
 *   rerank                        two-stage; scores against the ORIGINAL query
 *   evidence contract             <= 3 searches, citations resolve in-run, groundedness
 *
 * ---------------------------------------------------------------------------
 * WHY L4 AND L5 ARE PROMOTED RATHER THAN FUSED
 *
 * RRF fuses RANKS. An exact structural match — the question names `DATABASE` and the log has
 * a decision settling `DATABASE` — is not a rank, it is a fact. Averaging a fact into a
 * statistical consensus lets four levels of weak topical agreement outvote one level of exact
 * evidence, which is precisely backwards: exact evidence outranks statistical evidence.
 *
 * So L4 and L5 matches are held at the front of the candidate order and the reranker is not
 * allowed to demote them (`rerank/index.ts`, `orderWithPromotion`). They still APPEAR in the
 * fusion so their `contributedBy` and `matchedOn` are recorded honestly — a promoted hit that
 * also ranked well says so, and one that only matched structurally says that too.
 *
 * ---------------------------------------------------------------------------
 * THE RERANKER SCORES AGAINST THE ORIGINAL QUERY. ALWAYS.
 *
 * `rerank()` takes the query string and nothing else, so scoring against a HyDE hypothetical
 * is not expressible in this API rather than merely discouraged by a comment. HyDE would have
 * the reranker judge relevance to a document nobody wrote and whose errors would then be
 * indistinguishable from the retrieval's. arXiv:2604.01733 found query-time HyDE underperformed
 * vanilla dense outright while hybrid RRF + cross-encoder dominated; `useHyde` defaults to
 * false and the option exists for Phase 7's ablation, not for production.
 *
 * ---------------------------------------------------------------------------
 * DEGRADATION IS REPORTED, NEVER SILENT
 *
 * With no embeddings built, or after an engine change makes them stale, L1 and L2 return
 * nothing and L3/L4/L5 carry the run. That still works — BM25 is what makes the keyless system
 * viable — but the answer says which levels ran. A user who cannot see that two of five levels
 * were unavailable cannot tell a thin answer from a thin log.
 * ---------------------------------------------------------------------------
 */

import type { WhyLogEngine } from "@/ai/types";
import { nowISO } from "@/lib/format";
import { canonicalValueOf } from "@/ontology";
import { VARIABLE_ORDER, variableKeywords, variableMeta } from "@/ontology/data/variables";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import { queryTerms, stalenessNotice, usableLevels } from "@/substrate/projections/indexes";
import type { DecisionId, EngineId, PremiseId } from "@/types/common";
import type { DecisionLabel, DecisionVariable } from "@/types/domain";
import type {
  Answer,
  FusedHit,
  IndexArtifacts,
  IndexLevel,
  QueryOptions,
  RankedHit,
  RetrievedHit,
} from "@/types/retrieval";
import { DEFAULT_QUERY_OPTIONS } from "@/types/retrieval";
import { TOPICALITY_FLOOR, composeAnswer } from "./answer";
import { SearchTrace, searchStep } from "./evidence-contract";
import { type DenseQuery, searchL1 } from "./index-levels/l1-dense";
import { searchL2 } from "./index-levels/l2-questions";
import { searchL3 } from "./index-levels/l3-sparse";
import { type StructuralMatch, searchL4 } from "./index-levels/l4-structural";
import { type PremiseMatch, expandBySharedPremise, searchL5 } from "./index-levels/l5-premises";
import { findPreemptions } from "./preemption";
import { type RerankCandidate, rerank } from "./rerank";
import { RRF_K, type RankedList, fuse, rank } from "./rrf";

export { RRF_K } from "./rrf";
export { TOPICALITY_FLOOR } from "./answer";

/* -------------------------------------------------------------------------- */
/* Query understanding                                                        */
/* -------------------------------------------------------------------------- */

export interface UnderstoodQuery {
  readonly question: string;
  readonly variable: DecisionVariable | null;
  readonly value: string | null;
  readonly terms: readonly string[];
  readonly premiseIds: readonly PremiseId[];
  readonly explanation: string;
}

/**
 * Read the question. No model, no embedding — the variable and value are matched against the
 * ontology's own vocabulary, which is the same vocabulary extraction used, so a question
 * phrased in the terms the log was built from resolves exactly.
 */
export function understandQuery(state: GraphState, question: string): UnderstoodQuery {
  const folded = question.toLowerCase();
  const terms = queryTerms(question);

  let variable: DecisionVariable | null = null;
  let value: string | null = null;
  const why: string[] = [];

  /* Value first: a named value implies its variable and is the more specific signal, so it
   * wins when both are present. `variableKeywords()` is the same keyword table extraction
   * uses, which is what makes a question phrased in the log's own vocabulary resolve exactly
   * rather than approximately. */
  const keywords = variableKeywords();

  outer: for (const slot of VARIABLE_ORDER) {
    const meta = variableMeta(slot);
    for (const candidate of meta.commonValues) {
      const foldedCandidate = candidate.toLowerCase();
      if (foldedCandidate.length < 3) continue;
      if (!folded.includes(foldedCandidate)) continue;

      variable = slot;
      value = canonicalValueOf(slot, candidate);
      why.push(`"${candidate}" is a known ${slot} value`);
      break outer;
    }
  }

  /* Then the variable by its own keywords, for questions that name the slot without a value
   * ("what did we decide about the database?"). */
  if (variable === null) {
    for (const [keyword, slots] of keywords) {
      if (keyword.length < 3 || !folded.includes(keyword)) continue;
      const slot = slots[0];
      if (slot === undefined) continue;
      variable = slot;
      why.push(`"${keyword}" is a ${slot} keyword`);
      break;
    }
  }

  const premiseIds = premisesNamedBy(state, terms);
  if (premiseIds.length > 0) {
    why.push(`${premiseIds.length} premise(s) share vocabulary with the question`);
  }

  if (variable === null)
    why.push("no known variable or value appears in the question, so L4 cannot fire");

  return {
    question,
    variable,
    value,
    terms,
    premiseIds,
    explanation: `${why.join("; ")}.`,
  };
}

/**
 * Premises the question appears to name.
 *
 * Requires at least two shared content tokens: a single shared token ("app", "server", "cost")
 * would pull in half the log and turn a precise L5 promotion into noise. Promotions are held
 * at the front of the ranking and cannot be demoted, so a loose match here is more damaging
 * than a missed one.
 */
export function premisesNamedBy(state: GraphState, terms: readonly string[]): readonly PremiseId[] {
  const querySet = new Set(terms.filter((term) => term.length > 2));
  const out: PremiseId[] = [];

  for (const premise of state.premises.values()) {
    const tokens = new Set(
      premise.text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2),
    );

    let shared = 0;
    for (const token of tokens) {
      if (querySet.has(token)) shared += 1;
    }

    if (shared >= MIN_PREMISE_TOKEN_OVERLAP) out.push(premise.id);
  }

  return out;
}

export const MIN_PREMISE_TOKEN_OVERLAP = 2;

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

export interface RetrieveInput {
  readonly state: GraphState;
  readonly artifacts: IndexArtifacts;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly engine: WhyLogEngine;
  readonly question: string;
  readonly options?: Partial<QueryOptions>;
  readonly signal?: AbortSignal;
}

export interface RetrievalResult {
  readonly hits: readonly RetrievedHit[];
  readonly fused: readonly FusedHit[];
  readonly understood: UnderstoodQuery;
  readonly levels: readonly IndexLevel[];
  readonly levelsUnavailable: readonly IndexLevel[];
  readonly notice: string | null;
  readonly method: string;
  readonly durationMs: number;
}

/**
 * Retrieve and rank. This is the whole of §3.1–§3.5 in one call.
 *
 * Retrieval PROPOSES. It never classifies a pair and never produces a verdict — invariant I3.
 * The scores it returns select candidates for `contradiction.ts`, which then discards them.
 */
/**
 * Merge the caller's options over the defaults.
 *
 * A plain spread is not enough: `QueryOptions` fields are optional, and
 * spreading an optional over a required default yields `number | undefined` —
 * so `options.topK` would be possibly-undefined at every use, even though a
 * default always exists. Resolving each field explicitly keeps the resolved
 * options total, which is what the rest of the retrieval stack assumes.
 */
function resolveQueryOptions(options: QueryOptions | undefined): Required<
  Pick<QueryOptions, "topK" | "recallK" | "rrfK" | "useHyde" | "includeSuperseded">
> & {
  readonly levels: readonly IndexLevel[] | undefined;
} {
  return {
    topK: options?.topK ?? DEFAULT_QUERY_OPTIONS.topK,
    recallK: options?.recallK ?? DEFAULT_QUERY_OPTIONS.recallK,
    rrfK: options?.rrfK ?? DEFAULT_QUERY_OPTIONS.rrfK,
    useHyde: options?.useHyde ?? DEFAULT_QUERY_OPTIONS.useHyde,
    includeSuperseded: options?.includeSuperseded ?? DEFAULT_QUERY_OPTIONS.includeSuperseded,
    levels: options?.levels,
  };
}

export async function retrieve(input: RetrieveInput): Promise<RetrievalResult> {
  const started = Date.now();
  const options = resolveQueryOptions(input.options);
  const understood = understandQuery(input.state, input.question);
  const levels = usableLevels(input.state);
  const lists: RankedList[] = [];
  const perLevelScores = new Map<DecisionId, Map<IndexLevel, number>>();

  /* ---- L1 + L2: dense. One embedding call for the question. ---- */
  let queryVector: Float32Array | null = null;
  if (levels.includes("L1") || levels.includes("L2")) {
    const embedded = await input.engine.embed([understood.question], input.signal);
    const vector = embedded.vectors[0];
    if (vector !== undefined) queryVector = vector;
  }

  if (queryVector !== null) {
    const denseQuery: DenseQuery = { queryVector, k: options.recallK };
    const l1 = searchL1(input.artifacts, denseQuery);
    lists.push({ level: "L1", hits: l1 });
    record(perLevelScores, "L1", l1);

    const l2 = searchL2(input.artifacts, queryVector, options.recallK);
    lists.push({ level: "L2", hits: l2 });
    record(perLevelScores, "L2", l2);
  }

  /* ---- L3: sparse. Carries the keyless system. ---- */
  const l3 = searchL3(input.artifacts, understood.terms, options.recallK);
  lists.push({ level: "L3", hits: l3 });
  record(perLevelScores, "L3", l3);

  /* ---- L4 + L5: exact evidence, promoted rather than fused. ---- */
  const structural = searchL4(input.artifacts, understood.variable, understood.value);
  const premiseMatches = searchL5(
    input.artifacts,
    understood.premiseIds,
    "query-named",
    (id) => input.state.premises.get(id)?.text ?? id,
  );

  const l4Ranked = asRanked("L4", structural);
  const l5Ranked = asRanked("L5", premiseMatches);
  lists.push({ level: "L4", hits: l4Ranked });
  lists.push({ level: "L5", hits: l5Ranked });
  record(perLevelScores, "L4", l4Ranked);
  record(perLevelScores, "L5", l5Ranked);

  /* ---- fuse ---- */
  const fused = fuse(lists, options.rrfK);

  const promotedIds = new Set<DecisionId>([
    ...structural.map((match) => match.decisionId),
    ...premiseMatches.map((match) => match.decisionId),
  ]);

  /* ---- build rerank candidates ---- */
  const candidates: RerankCandidate[] = fused.map((hit) => ({
    decisionId: hit.decisionId,
    denseScore: denseScoreOf(perLevelScores, hit.decisionId),
    sparseScore: scoreOf(perLevelScores, hit.decisionId, "L3"),
    sparseRank: rankOf(lists, "L3", hit.decisionId),
    structural: structural.find((match) => match.decisionId === hit.decisionId) ?? null,
    premise: premiseMatches.find((match) => match.decisionId === hit.decisionId) ?? null,
    promoted: promotedIds.has(hit.decisionId),
  }));

  /* Promoted candidates the fusion never surfaced — an exact match with no lexical or dense
   * agreement at all. It still belongs in the order; losing it would lose the one result that
   * is certain. */
  for (const id of promotedIds) {
    if (candidates.some((candidate) => candidate.decisionId === id)) continue;
    candidates.push({
      decisionId: id,
      denseScore: null,
      sparseScore: 0,
      sparseRank: 0,
      structural: structural.find((match) => match.decisionId === id) ?? null,
      premise: premiseMatches.find((match) => match.decisionId === id) ?? null,
      promoted: true,
    });
  }

  /* ---- rerank: second stage, against the ORIGINAL query ---- */
  const ranked = await rerank({
    query: understood.question,
    candidates,
    artifacts: input.artifacts,
    state: input.state,
    engine: input.engine,
    queryTerms: understood.terms,
    queryPremises: understood.premiseIds,
    topK: options.topK,
    now: Date.now(),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  const scoredBy = new Map(ranked.scored.map((entry) => [entry.candidate.decisionId, entry]));
  const rrfBy = new Map(fused.map((hit) => [hit.decisionId, hit]));

  const hits: RetrievedHit[] = [];
  for (const [index, decisionId] of ranked.order.entries()) {
    if (!options.includeSuperseded) {
      const decision = input.state.decisions.get(decisionId);
      if (
        decision !== undefined &&
        (decision.status === "superseded" || decision.status === "archived")
      )
        continue;
    }

    const decision = input.state.decisions.get(decisionId);
    if (decision === undefined) continue;

    const fusedHit = rrfBy.get(decisionId);
    const scored = scoredBy.get(decisionId);

    hits.push({
      decisionId,
      decision,
      finalScore: scored?.total ?? fusedHit?.rrf ?? 0,
      rrf: fusedHit?.rrf ?? 0,
      ...(scored === undefined ? {} : { rerankScore: scored.total }),
      matchedOn:
        fusedHit === undefined
          ? promotedLevelsOf(structural, premiseMatches, decisionId)
          : [...fusedHit.contributedBy],
      promoted: promotedIds.has(decisionId),
    });

    if (index >= options.topK) break;
  }

  const unavailable = (["L1", "L2"] as const).filter((level) => !levels.includes(level));

  return {
    hits,
    fused,
    understood,
    levels,
    levelsUnavailable: unavailable,
    notice: stalenessNotice(input.state),
    method: ranked.method,
    durationMs: Date.now() - started,
  };
}

function record(
  into: Map<DecisionId, Map<IndexLevel, number>>,
  level: IndexLevel,
  hits: readonly RankedHit[],
): void {
  for (const hit of hits) {
    const existing = into.get(hit.decisionId);
    if (existing === undefined) into.set(hit.decisionId, new Map([[level, hit.score]]));
    else existing.set(level, hit.score);
  }
}

function scoreOf(
  scores: Map<DecisionId, Map<IndexLevel, number>>,
  id: DecisionId,
  level: IndexLevel,
): number {
  return scores.get(id)?.get(level) ?? 0;
}

function denseScoreOf(
  scores: Map<DecisionId, Map<IndexLevel, number>>,
  id: DecisionId,
): number | null {
  const entry = scores.get(id);
  if (entry === undefined) return null;
  const l1 = entry.get("L1");
  const l2 = entry.get("L2");
  if (l1 === undefined && l2 === undefined) return null;
  /* The better of the two: L2 matches the question someone WOULD ask about this decision,
   * L1 matches its statement. Which one is closer depends on how the user phrased it, and
   * taking the max lets either win without a calibration constant between them. */
  return Math.max(l1 ?? Number.NEGATIVE_INFINITY, l2 ?? Number.NEGATIVE_INFINITY);
}

function rankOf(lists: readonly RankedList[], level: IndexLevel, id: DecisionId): number {
  const list = lists.find((entry) => entry.level === level);
  return list?.hits.find((hit) => hit.decisionId === id)?.rank ?? 0;
}

/** L4/L5 matches carry no score of their own — an exact match is not a graded one. They enter
 *  the fusion at rank order of specificity (value matches before variable matches, which the
 *  search functions already produce) and are promoted regardless of score. */
function asRanked(
  level: IndexLevel,
  matches: readonly { decisionId: DecisionId }[],
): readonly RankedHit[] {
  return rank(
    level,
    matches.map((match, index) => ({ id: match.decisionId, score: matches.length - index })),
  );
}

function promotedLevelsOf(
  structural: readonly StructuralMatch[],
  premises: readonly PremiseMatch[],
  id: DecisionId,
): readonly IndexLevel[] {
  const out: IndexLevel[] = [];
  if (structural.some((match) => match.decisionId === id)) out.push("L4");
  if (premises.some((match) => match.decisionId === id)) out.push("L5");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Ask — retrieval plus the evidence contract                                 */
/* -------------------------------------------------------------------------- */

export interface AskInput extends RetrieveInput {
  readonly engineId: EngineId;
  readonly forceLocalRerank?: boolean;
}

/**
 * Answer a question under the evidence contract.
 *
 * At most three searches, each with a distinct purpose, each recorded:
 *
 *   1. THE QUESTION as asked — all five levels, fused and reranked.
 *   2. EXPANSION BY SHARED PREMISE — only if search 1 was thin. Decisions resting on the same
 *      premises as search 1's hits answer many questions that the question's own vocabulary
 *      does not match, because they share the `given` rather than the wording.
 *   3. PREMISE QUESTIONS — only if still thin. HyPE's inverted questions rephrased as the
 *      query, catching a decision recorded in different words from the ones asked.
 *
 * The budget is what makes refusal reachable. Without it, "not found" always means "have not
 * looked hard enough yet", and a system that can always look again never has to say it does
 * not know.
 */
export async function ask(input: AskInput): Promise<Answer> {
  const trace = new SearchTrace();
  const answeredAt = nowISO();

  /* ---- search 1 ---- */
  const first = await retrieve(input);
  trace.note(first.hits.map((hit) => hit.decisionId));
  const recorded1 = trace.record(
    searchStep(
      first.understood.question,
      first.levels,
      first.hits.length,
      first.hits[0]?.finalScore ?? 0,
      `The question as asked, over all five levels. ${first.understood.explanation}`,
    ),
  );

  let hits = first.hits;

  /* ---- search 2: expansion by shared premise, only when thin ---- */
  if (recorded1 && isThin(hits)) {
    const seeds = hits.map((hit) => hit.decisionId);
    const expanded = seeds.length === 0 ? [] : expandBySharedPremise(input.artifacts, seeds);

    const before = new Set(seeds);
    const added = expanded.filter((id) => !before.has(id));
    trace.note(added);

    const recorded2 = trace.record(
      searchStep(
        `decisions sharing a premise with: ${seeds.join(", ")}`,
        ["L5"],
        added.length,
        0,
        added.length === 0
          ? "Search 1 was thin, so the run expanded along shared premises. Nothing new came back — no other decision rests on the same assumptions as these."
          : "Search 1 was thin, so the run expanded along shared premises: decisions resting on the same `given` often answer a question whose wording does not match.",
      ),
    );

    if (added.length > 0) {
      const merged: RetrievedHit[] = [...hits];
      for (const decisionId of added) {
        const decision = input.state.decisions.get(decisionId);
        if (decision === undefined) continue;
        merged.push({
          decisionId,
          decision,
          /* Scored at the topicality floor rather than at a computed value. A shared-premise
           * expansion is an EXACT relation — same `given` — so it is promoted, and giving it a
           * fabricated numeric score would imply a ranking nobody computed. */
          finalScore: TOPICALITY_FLOOR,
          rrf: 0,
          matchedOn: ["L5"],
          promoted: true,
        });
      }
      hits = merged;
    }

    /* ---- search 3: HyPE questions as the query, only when still thin ---- */
    if (recorded2 && isThin(hits)) {
      const questionHits = await searchByPremiseQuestions(input, hits, trace);
      if (questionHits.length > 0) hits = [...hits, ...questionHits];
    }
  }

  /* ---- pre-emption: checked on every ask, not only on thin ones ---- */
  const preemptions = findPreemptions(
    input.state,
    input.labels,
    input.question,
    first.understood.terms,
  );

  /* ---- compose under the contract ---- */
  const labels = new Map<DecisionId, DecisionLabel>();
  for (const hit of hits) {
    labels.set(hit.decisionId, input.labels.get(hit.decisionId)?.label ?? hit.decision.label);
  }

  const premisesOf = new Map<DecisionId, readonly string[]>();
  for (const hit of hits) {
    premisesOf.set(hit.decisionId, premiseLines(input.state, input.labels, hit.decisionId));
  }

  return composeAnswer({
    question: input.question,
    retrieved: hits,
    engine: input.engine,
    engineId: input.engineId,
    trace,
    labels,
    premisesOf,
    preemptions,
    logSize: input.state.decisions.size,
    answeredAt,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

/** Thin means too few hits to answer from. Two is the floor: one decision can be quoted, but
 *  a single hit gives the reader nothing to compare it against and no way to notice that the
 *  retrieval missed the decision that actually matters. */
export function isThin(hits: readonly RetrievedHit[]): boolean {
  return hits.filter((hit) => hit.promoted || hit.finalScore >= TOPICALITY_FLOOR).length < 2;
}

async function searchByPremiseQuestions(
  input: AskInput,
  current: readonly RetrievedHit[],
  trace: SearchTrace,
): Promise<readonly RetrievedHit[]> {
  /* Re-query with the questions the log itself would ask about the premises already in play.
   * This is HyPE's inverted-question index used from the other direction: instead of matching
   * a question to a decision's questions, match the decision's questions to the corpus. */
  const seed = premisesOfHits(input.state, current);
  const questionText = seed
    .map((id) => input.state.premises.get(id)?.text ?? "")
    .filter((text) => text.length > 0)
    .join(" ");

  if (questionText.length === 0) {
    trace.markBoundedOut();
    return [];
  }

  const terms = queryTerms(questionText);
  const l3 = searchL3(input.artifacts, terms, DEFAULT_QUERY_OPTIONS.recallK);

  const before = new Set(current.map((hit) => hit.decisionId));
  const added: RetrievedHit[] = [];
  const notedIds: DecisionId[] = [];

  for (const hit of l3) {
    if (before.has(hit.decisionId)) continue;
    const decision = input.state.decisions.get(hit.decisionId);
    if (decision === undefined) continue;
    before.add(hit.decisionId);
    notedIds.push(hit.decisionId);
    added.push({
      decisionId: hit.decisionId,
      decision,
      finalScore: hit.score,
      rrf: 0,
      matchedOn: ["L3"],
      promoted: false,
    });
  }

  trace.note(notedIds);
  trace.record(
    searchStep(
      questionText.slice(0, 120),
      ["L3"],
      added.length,
      added[0]?.finalScore ?? 0,
      added.length === 0
        ? "Still thin, so the run re-queried with the premises' own vocabulary. Nothing further came back — this is the last search the contract allows, and the answer will say so."
        : "Still thin, so the run re-queried with the premises' own vocabulary rather than the question's wording.",
    ),
  );

  return added;
}

/** One pass over the fold's own premise → decisions index, not a scan per hit. */
function premisesOfHits(state: GraphState, hits: readonly RetrievedHit[]): readonly PremiseId[] {
  const wanted = new Set(hits.map((hit) => hit.decisionId));
  const out = new Set<PremiseId>();

  for (const [premiseId, dependents] of state.premiseToDecisions) {
    if (dependents.some((id) => wanted.has(id))) out.add(premiseId);
  }

  return [...out];
}

/** The premises as the composer will quote them: id, text, LIVE label. */
function premiseLines(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): readonly string[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: string[] = [];
  const seen = new Set<PremiseId>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);
      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;
      const label = labels.get(premiseId)?.label ?? premise.label;
      out.push(`${premiseId} "${premise.text}" (${label})`);
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeRetrieval(result: RetrievalResult): string {
  const lines = [
    `Levels available: ${result.levels.join(", ")}${result.levelsUnavailable.length > 0 ? `  (unavailable: ${result.levelsUnavailable.join(", ")})` : ""}`,
    `Query read as: ${result.understood.explanation}`,
    `Fusion: RRF at k = ${RRF_K} — ranks only, so no score calibration between levels.`,
    `Rerank: ${result.method}, scored against the ORIGINAL query.`,
    `Candidates: ${result.fused.length} fused → ${result.hits.length} returned.`,
    `Took ${result.durationMs} ms.`,
  ];

  if (result.notice !== null) lines.push(`Note: ${result.notice}`);

  return lines.join("\n");
}

export function describePipeline(): string {
  return [
    "Retrieval pipeline — five levels, fused, then reranked, then bound:",
    "",
    "  L1 dense       statement embeddings",
    "  L2 dense       HyPE inverted questions, generated at extraction time, zero extra LLM calls",
    "  L3 sparse      BM25 over all text fields, ontology-aliased terms — carries the keyless system",
    "  L4 structural  variable / value index — PROMOTED, not fused",
    "  L5 premise     premise → dependents — PROMOTED, not fused",
    "",
    "L4 and L5 are promoted rather than fused because an exact match is a FACT, not a rank.",
    "Averaging a fact into a statistical consensus lets four levels of weak topical agreement",
    "outvote one level of exact evidence, which is backwards. The reranker cannot demote them.",
    "",
    `Fusion is RRF at k = ${RRF_K}. It reads ranks and never scores, so it needs no`,
    "calibration between a cosine in [-1,1] and a BM25 score with no upper bound.",
    "",
    "The reranker scores against the ORIGINAL QUERY. `rerank()` takes the query string and",
    "nothing else, so scoring against a HyDE hypothetical is not expressible here rather than",
    "merely discouraged by a comment.",
    "",
    "Retrieval PROPOSES; it never classifies. Invariant I3: no score produced here decides a",
    "contradiction — the classifier in ./contradiction.ts reads no score at all.",
  ].join("\n");
}

export { composeAnswer, describeComposition } from "./answer";
export { groundednessOf, describeThresholds } from "./groundedness";
export {
  MAX_SEARCHES,
  SearchTrace,
  describeContract,
  resolveCitations,
} from "./evidence-contract";
export {
  classifyPair,
  classifyPairs,
  isClassifiable,
  describeRules,
  describeVerdict as describeContradictionVerdict,
  requestFor,
} from "./contradiction";
export { findPreemptions, renderPreemption, countPreemptions } from "./preemption";
export { expandCitation, expandAll, renderExpansion, renderInline } from "./citations";
export { buildIndex, describeBuild, type BuildReport } from "./build-index";
