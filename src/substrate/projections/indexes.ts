/**
 * Index projection: the four levels that need no vectors.
 *
 * Phase 0 · sub-phase 0.2, consumed by Phase 3
 * Plan: plan/phase-3-retrieval.md §3.1 · docs/03 §2
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BUILT HERE AND WHAT IS NOT
 *
 *   L1 dense decision   -> vectors, built in src/substrate/index-artifacts.ts
 *   L2 dense questions  -> vectors, built there too
 *   L3 sparse BM25      -> BUILT HERE. Terms come from the ontology, so this
 *                          works with no API key and never goes stale.
 *   L4 structural       -> BUILT HERE. variable -> ids, value -> ids.
 *   L5 premise inverted -> BUILT HERE. The cascade index.
 *
 * Three of the five levels are pure functions of the log. That is deliberate: the
 * keyless default is not a degraded mode, it is a mode with three working index
 * levels and a lexical fourth, and the only thing missing is dense similarity.
 *
 * Terms are ALIAS-FOLDED via the ontology before indexing, so a query for "pg"
 * finds a decision recorded as "postgres". Folding at index time rather than query
 * time is what makes the two agree without either side needing to know.
 * ---------------------------------------------------------------------------
 */

import { contentTokens, tokenise } from "@/lib/text";
import { buildCorpus, type SparseCorpus, type SparseDocument } from "@/lib/bm25";
import type { DecisionId, PremiseId } from "@/types/common";
import type { Decision, Premise } from "@/types/domain";
import type { PremiseIndex, StructuralIndex } from "@/types/retrieval";
import { canonicalValueOf, canonicalPredicate } from "@/ontology/canonicalize";
import type { GraphState } from "../graph-state";

/* -------------------------------------------------------------------------- */
/* L4 — structural                                                            */
/* -------------------------------------------------------------------------- */

/**
 * variable -> decision ids, and canonical value -> decision ids.
 *
 * This is the level the structural contradiction gate reads, and it is the only
 * level that can answer "what have we decided about DATABASE?" in constant time.
 * It is also the level that keeps working when the embeddings are stale.
 */
export function buildStructuralIndex(state: GraphState): StructuralIndex {
  const variableIndex = new Map<string, DecisionId[]>();
  const valueIndex = new Map<string, DecisionId[]>();

  const push = (map: Map<string, DecisionId[]>, key: string, id: DecisionId): void => {
    const bucket = map.get(key);
    if (bucket) bucket.push(id);
    else map.set(key, [id]);
  };

  for (const decision of state.decisions.values()) {
    push(variableIndex, decision.variable, decision.id);
    push(valueIndex, `${decision.variable}\u0000${decision.value}`, decision.id);
    // Also index the bare canonical value, so a query naming only a technology
    // ("postgres") finds the decision without knowing the slot.
    push(valueIndex, decision.value, decision.id);
  }

  return { variableIndex, valueIndex };
}

export function lookupByVariable(
  index: StructuralIndex,
  variable: string,
): readonly DecisionId[] {
  return index.variableIndex.get(variable) ?? [];
}

export function lookupByValue(index: StructuralIndex, value: string): readonly DecisionId[] {
  return index.valueIndex.get(value) ?? [];
}

/* -------------------------------------------------------------------------- */
/* L5 — premise inverted                                                      */
/* -------------------------------------------------------------------------- */

/**
 * premise -> decisions and decision -> premises.
 *
 * The forward direction is already materialised by the fold
 * (`state.premiseToDecisions`); the reverse is built here. Together they make the
 * cascade O(neighbours) instead of O(justifications), which is the difference
 * between a retraction that runs instantly and one the user waits for.
 */
export function buildPremiseIndex(state: GraphState): PremiseIndex {
  const decisionToPremises = new Map<DecisionId, PremiseId[]>();

  for (const [premiseId, decisionIds] of state.premiseToDecisions) {
    for (const decisionId of decisionIds) {
      const bucket = decisionToPremises.get(decisionId);
      if (bucket) {
        if (!bucket.includes(premiseId)) bucket.push(premiseId);
      } else {
        decisionToPremises.set(decisionId, [premiseId]);
      }
    }
  }

  return { premiseToDecisions: state.premiseToDecisions, decisionToPremises };
}

/* -------------------------------------------------------------------------- */
/* L3 — sparse                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The text a decision is searchable by.
 *
 * Deliberately includes the accepted downside and the rejected alternatives:
 * somebody searching "why not postgres" should find the decision that rejected
 * it, and the alternative's `whyRejected` is the only place that answer exists.
 */
export function decisionText(decision: Decision, alternatives: readonly string[]): string {
  const parts = [
    decision.statement,
    `${decision.variable} ${decision.value}`,
    decision.rationale ?? "",
    decision.acceptedDownside ?? "",
    decision.yStatement ?? "",
    ...alternatives,
  ];
  return parts.filter((p) => p.trim().length > 0).join(" \u0001 ");
}

export function premiseText(premise: Premise): string {
  const value = premise.value === undefined ? "" : ` ${String(premise.value)}`;
  return `${premise.text} ${premise.predicate}${value}`;
}

/** Build the BM25 documents for every live decision. Terms are alias-folded. */
export function buildSparseDocuments(state: GraphState): readonly SparseDocument[] {
  const documents: SparseDocument[] = [];

  for (const decision of state.decisions.values()) {
    if (decision.temporal.invalidFrom !== undefined) continue; // closed nodes are
    // still retrievable by id and by the timeline, but not by search: surfacing a
    // superseded rule as a top hit is how an export ends up containing both sides
    // of a reversal.

    const alternatives: string[] = [];
    for (const alternativeId of decision.alternativeIds) {
      const alternative = state.alternatives.get(alternativeId);
      if (!alternative) continue;
      alternatives.push(alternative.value);
      if (alternative.whyRejected !== undefined) alternatives.push(alternative.whyRejected);
    }

    const text = decisionText(decision, alternatives);
    const terms = termFrequencies(decision.variable, text);

    documents.push({ id: decision.id, terms, length: countTerms(terms) });
  }

  return documents;
}

function countTerms(terms: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const value of Object.values(terms)) total += value;
  return total;
}

/**
 * Tokenise and fold.
 *
 * Each token is indexed BOTH raw and canonical, so "pg" and "postgres" retrieve
 * the same decision whichever the query used. That doubles the term count for
 * aliased values and is worth it: the alternative is folding the query and hoping
 * the folding is symmetric, which it is not for compound mentions.
 */
export function termFrequencies(variable: string, text: string): Record<string, number> {
  const terms: Record<string, number> = {};
  const add = (term: string): void => {
    if (term.length === 0) return;
    terms[term] = (terms[term] ?? 0) + 1;
  };

  for (const token of contentTokens(text)) {
    add(token);
    const folded = canonicalValueOf(variable as Decision["variable"], token);
    if (folded !== token) add(folded);
  }

  // The variable name itself, so "what did we decide about testing?" matches on
  // the slot even when the statement does not repeat the word.
  add(variable.toLowerCase());

  return terms;
}

export function buildSparseCorpus(state: GraphState): SparseCorpus {
  return buildCorpus(buildSparseDocuments(state));
}

/** Terms for a query, folded the same way documents were. */
export function queryTerms(state: GraphState, query: string, variable?: string): readonly string[] {
  const tokens = tokenise(query);
  const out = new Set<string>();

  for (const token of tokens) {
    out.add(token);
    if (variable !== undefined) {
      const folded = canonicalValueOf(variable as Decision["variable"], token);
      if (folded !== token) out.add(folded);
    }
  }

  // Content tokens are the ones that carry retrieval signal; keeping the
  // stopwords out of the query prevents "we do not use postgres" from scoring on
  // "use". Negation is handled by the classifier, not by BM25.
  return [...out].filter((t) => contentTokens(t).length > 0);
}

/* -------------------------------------------------------------------------- */
/* L2 — the synthetic questions (text side)                                   */
/* -------------------------------------------------------------------------- */

/**
 * HyPE-style hypothetical questions, generated at INDEX time from templates.
 *
 * Index-time beats query-time here: HyDE expands the query and has to be right
 * about what the user meant, whereas these are generated from a decision the
 * system already understands, and arXiv:2604.01733 found query-time expansion
 * underperformed plain dense retrieval while hybrid + rerank dominated. Templates
 * cost nothing and cannot hallucinate.
 */
export const QUESTION_TEMPLATES: readonly ((d: Decision) => string)[] = [
  (d) => `What did we decide about ${d.variable.toLowerCase()}?`,
  (d) => `Should we use ${d.value}?`,
  (d) => `Why ${d.value} and not something else?`,
  (d) => `Is ${d.value} still the right choice?`,
  (d) => `What are the constraints on the ${d.variable.toLowerCase()} decision?`,
];

export function questionsFor(decision: Decision): readonly string[] {
  const out = QUESTION_TEMPLATES.map((template) => template(decision));
  // The statement itself is the best question when it is already interrogative.
  if (decision.statement.includes("?")) out.unshift(decision.statement);
  return out;
}

/** Premise-shaped questions: "what assumes a single user?" retrieves the premise
 *  and everything resting on it. */
export function premiseQuestions(premise: Premise): readonly string[] {
  return [
    `What assumes ${premise.text}?`,
    `Is ${premise.text} still true?`,
    `Which decisions depend on ${premise.predicate}?`,
  ];
}

/* -------------------------------------------------------------------------- */
/* Staleness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which index levels are usable RIGHT NOW.
 *
 * L3, L4 and L5 never go stale — they are pure functions of the log. L1 and L2 do,
 * the moment the engine changes, because cosine similarity across embedding
 * spaces is meaningless. Reporting this honestly is what lets the UI say "semantic
 * search is off until you re-index" instead of returning confident garbage.
 */
export function usableLevels(state: GraphState): readonly ("L1" | "L2" | "L3" | "L4" | "L5")[] {
  const always: ("L3" | "L4" | "L5")[] = ["L3", "L4", "L5"];
  if (state.index.stale || state.index.builtBy === undefined) return always;
  return [...state.index.levels.filter((l) => l === "L1" || l === "L2"), ...always];
}

export function denseAvailable(state: GraphState): boolean {
  return !state.index.stale && state.index.builtBy !== undefined;
}

export function stalenessNotice(state: GraphState): string | null {
  if (state.index.builtBy === undefined) {
    return "No embeddings have been built yet. Lexical, structural and premise retrieval are working.";
  }
  if (!state.index.stale) return null;
  return `The embedding index was built by ${state.index.builtBy.model || state.index.builtBy.kind} and the active engine is now ${state.engine.model || state.engine.kind}. Vectors from different spaces cannot be compared, so semantic retrieval is disabled until you re-index.`;
}

/** Canonical predicate folding, re-exported so the index builders have one
 *  import site for ontology behaviour. */
export { canonicalPredicate };
