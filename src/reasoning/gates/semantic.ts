/**
 * Gate (b) — semantic contradiction. 2.4.
 *
 * Phase 2 · sub-phase 2.4
 * Plan: plan/phase-2-truth-maintenance.md §2.4
 * Research: docs/03 §4 (retrieve then classify), docs/05 §3 (Kantara's M1/M2)
 *
 * ---------------------------------------------------------------------------
 * RETRIEVE, THEN CLASSIFY — NEVER COMPARE ALL PAIRS
 *
 * Invariant I3: retrieval PROPOSES, a classifier DISPOSES. An O(n²) pairwise sweep
 * is not merely slow, it is wrong: it surfaces every topically similar pair and asks
 * the classifier to reject most of them, which is how a detector acquires a false
 * positive rate it cannot afford.
 *
 * So candidates come from the retrieval stack (Phase 3) and only the survivors are
 * classified. Until Phase 3 exists this gate has no candidate source, and it says so
 * rather than inventing one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS BEFORE ITS DEPENDENCY DOES
 *
 * The gate ordering in `gates/index.ts` must be complete for the cycle in
 * `revise.ts` to be complete, and a cycle with a hole in it is a cycle that will be
 * filled by whichever gate happens to run last. Declaring gate (b) with an honest
 * "no candidates yet" keeps the orchestration real and the absence visible.
 *
 * `available` is false and the health panel shows it, so nobody concludes from a
 * quiet gate (b) that no semantic contradictions exist.
 *
 * ---------------------------------------------------------------------------
 * THE M1 / M2 DIAGNOSTIC IS NOT DECORATION
 *
 * Borrowed from Kantara (arXiv:2506.11005), which found 29 similar and 396
 * contradictory pairs across the Linux kernel rationale graph:
 *
 *   M1 — similar decisions, contradictory rationales ⇒ probable MISUNDERSTANDING
 *   M2 — contradictory decisions, similar rationales ⇒ probable COPY-PASTE or
 *        extraction error
 *
 * They point at different fixes. M1 means two people meant different things by the
 * same words. M2 means the same reasoning was attached to two incompatible choices,
 * which is usually a bug in the record rather than in the project — and telling the
 * user "your extraction is wrong" is more useful than telling them "your decisions
 * conflict".
 * ---------------------------------------------------------------------------
 */

import type {
  ClassificationRequest,
  DecisionSnapshot,
  PremiseSnapshot,
  WhyLogEngine,
} from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, EngineId, PremiseId } from "@/types/common";
import type { Decision, Premise } from "@/types/domain";
import type { ClassificationResult, ContradictionVerdict } from "@/types/retrieval";

export interface SemanticHit {
  readonly gate: "semantic";
  readonly verdict: ContradictionVerdict;
  readonly decisionA: DecisionId;
  readonly decisionB: DecisionId;
  readonly explanation: string;
  readonly diagnostic: "M1" | "M2" | null;
  readonly similarity: number;
  readonly engine: EngineId;
}

export interface GateBResult {
  readonly hits: readonly SemanticHit[];
  readonly pairsConsidered: number;
  readonly available: boolean;
  /** Why nothing ran. Shown in the health panel; a silent gate is indistinguishable
   *  from a gate that found nothing. */
  readonly unavailableReason: string | null;
}

/**
 * Gate (b), which needs Phase 3's retrieval stack to propose candidates.
 *
 * @param retrieve a candidate-pair source. Injected rather than imported so this
 *                 module has no dependency on `src/retrieval/` before it exists —
 *                 and so Phase 7 can measure the gate against a fixture pair list
 *                 without standing up an index.
 */
export async function detectSemantic(
  state: GraphState,
  engine: WhyLogEngine,
  retrieve?: (state: GraphState) => Promise<readonly CandidatePair[]>,
): Promise<GateBResult> {
  if (retrieve === undefined) {
    return {
      hits: [],
      pairsConsidered: 0,
      available: false,
      unavailableReason:
        "Gate (b) retrieves candidate pairs from the Phase 3 index and then classifies them. The index does not exist yet, so no pairs are proposed and nothing is classified. This is an absence of candidates, not an absence of contradictions.",
    };
  }

  const pairs = await retrieve(state);
  const hits: SemanticHit[] = [];

  for (const pair of pairs) {
    const a = state.decisions.get(pair.a);
    const b = state.decisions.get(pair.b);
    if (a === undefined || b === undefined) continue;

    const request: ClassificationRequest = {
      decisionA: snapshotOf(a),
      decisionB: snapshotOf(b),
      ...(pair.sharedPremises.length === 0
        ? {}
        : {
            sharedPremises: pair.sharedPremises
              .map((id) => premiseSnapshot(state, id))
              .filter(notNull),
          }),
      // Gate (a)'s answer is passed in so the semantic classifier cannot contradict
      // a table lookup without saying so. A model that overrules a deterministic
      // antonym match is a model that has found a bug in the ontology, and that
      // should be loud rather than quiet.
      ...(pair.structuralVerdict === undefined
        ? {}
        : { structuralVerdict: pair.structuralVerdict }),
    };

    const result = await engine.classify(request);
    if (result.verdict === "neutral") continue;

    hits.push({
      gate: "semantic",
      verdict: result.verdict,
      decisionA: pair.a,
      decisionB: pair.b,
      explanation: result.explanation,
      diagnostic: diagnose(pair, result.verdict),
      similarity: pair.similarity,
      engine: result.engine,
    });
  }

  return { hits, pairsConsidered: pairs.length, available: true, unavailableReason: null };
}

export interface CandidatePair {
  readonly a: DecisionId;
  readonly b: DecisionId;
  /** Retrieval similarity. Reported, never used as the verdict: "use Postgres" and
   *  "don't use Postgres" are ~0.9 similar, so a threshold on this number is a
   *  contradiction detector that fires on agreement. */
  readonly similarity: number;
  readonly sharedPremises: readonly PremiseId[];
  readonly structuralVerdict?: ClassificationResult;
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

/* -------------------------------------------------------------------------- */
/* The M1 / M2 diagnostic                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which kind of mistake this probably is.
 *
 * Decided from the pair's own shape rather than from the classifier's opinion,
 * because the classifier was asked whether the decisions conflict and not why the
 * record looks the way it does.
 *
 *   high similarity + conflicting rationale ⇒ M1, a misunderstanding
 *   low similarity  + shared rationale      ⇒ M2, a copy-paste or extraction error
 *
 * Anything else returns null, and null is displayed as "unclassified" rather than
 * being quietly folded into one of the two. A diagnostic that always picks one is a
 * diagnostic nobody learns from.
 */
export function diagnose(pair: CandidatePair, verdict: ContradictionVerdict): "M1" | "M2" | null {
  if (verdict === "refinement") return null;

  if (pair.similarity >= M1_SIMILARITY_FLOOR) return "M1";
  if (pair.similarity <= M2_SIMILARITY_CEILING && pair.sharedPremises.length > 0) return "M2";
  return null;
}

/** Above this, the decisions are near-duplicates and the conflict is in the
 *  reasoning — two people who meant different things by the same words. */
export const M1_SIMILARITY_FLOOR = 0.75;

/** Below this, with premises in common, the reasoning was reused across two
 *  incompatible choices — usually a record-keeping error rather than a real one. */
export const M2_SIMILARITY_CEILING = 0.45;

export const DIAGNOSTIC_MEANING: Readonly<Record<"M1" | "M2", string>> = {
  M1: "Similar decisions with contradictory rationales. Probably a misunderstanding: two people meant different things by the same words. Read both rationales before changing either decision.",
  M2: "Contradictory decisions with similar rationales. Probably copy-paste or an extraction error: the same reasoning is attached to two incompatible choices. Check the record before checking the project.",
};

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The slice of a decision the classifier is allowed to see.
 *
 * Deliberately WITHOUT the label: telling a model "this one is already IN" invites
 * it to agree with the graph rather than judge the pair, and the whole point of gate
 * (b) is a second opinion the graph did not produce.
 */
function snapshotOf(decision: Decision): DecisionSnapshot {
  return {
    id: decision.id,
    variable: decision.variable,
    value: decision.value,
    statement: decision.statement,
    ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
    validFrom: decision.temporal.valid,
  };
}

function premiseSnapshot(state: GraphState, id: PremiseId): PremiseSnapshot | null {
  const premise: Premise | undefined = state.premises.get(id);
  if (premise === undefined) return null;
  return {
    id: premise.id,
    type: premise.type,
    predicate: premise.predicate,
    text: premise.text,
  };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeResult(result: GateBResult): string {
  if (!result.available) return `gate (b) unavailable — ${result.unavailableReason}`;
  if (result.hits.length === 0) {
    return `gate (b) considered ${result.pairsConsidered} candidate pair${result.pairsConsidered === 1 ? "" : "s"} and found no semantic conflict`;
  }
  const m1 = result.hits.filter((h) => h.diagnostic === "M1").length;
  const m2 = result.hits.filter((h) => h.diagnostic === "M2").length;
  const unclassified = result.hits.length - m1 - m2;
  return [
    `${result.hits.length} semantic verdict${result.hits.length === 1 ? "" : "s"} from ${result.pairsConsidered} candidate pairs`,
    m1 > 0 ? `${m1} M1 (probable misunderstanding)` : "",
    m2 > 0 ? `${m2} M2 (probable copy-paste or extraction error)` : "",
    unclassified > 0 ? `${unclassified} unclassified` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}
