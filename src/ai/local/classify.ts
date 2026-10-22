/**
 * The local semantic classifier — 2.11, delegating to 3.6.
 *
 * Phase 2 · sub-phase 2.11 — rewritten in Phase 3 · sub-phase 3.6
 * Plan: plan/phase-2-truth-maintenance.md §2.11
 *       plan/phase-3-retrieval.md §3.6 (the canonical rule engine)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS NOW 60 LINES INSTEAD OF 253
 *
 * It used to contain its own implementation of the classifier rules. §3.6 then specified
 * the same rules as the retrieval-layer classifier, with a fifth rule added. Two
 * implementations of one judgement is the failure the Phase 2 audit found in the
 * adjudicator: an adjudicator with a narrower rule than its detector silently disagreed
 * with it, so a newcomer could be ACCEPTED while gate (a) reported a contradiction.
 *
 * The rule is now: **one rule engine, and everything else delegates to it.** That engine
 * lives in `retrieval/contradiction.ts` (§3.6 names it there, and STRUCTURE.md §8 has it
 * there). This file is the engine's `classify` implementation — the adapter between the
 * `ClassificationRequest` the AI layer speaks and the pair the rule engine speaks.
 *
 * The import points "up" a layer (ai → retrieval), which looks wrong and is deliberate.
 * Layering exists to stop the wrong things depending on each other; here the dependency is
 * on pure functions over two snapshots, with no state and no I/O, and the alternative is
 * two classifiers that can disagree. There is no cycle: contradiction.ts → negation.ts →
 * ai/local/negation.ts, and none of those import this file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ADAPTER DOES THAT THE RULE ENGINE CANNOT
 *
 * 1. Gate (a)'s verdict wins unchanged. If the structural gate already classified this
 *    pair, a second opinion on top of an ontology table lookup would be strictly worse
 *    than the lookup. The rule engine never sees that a gate ran.
 * 2. Confidence is capped for the local path. The rules are real evidence but they are not
 *    a reading of the text, and the number has to let the UI distinguish "the antonym table
 *    says so" from "a model read both statements".
 * ---------------------------------------------------------------------------
 * WHAT THIS ADAPTER DELIBERATELY DOES NOT DO
 *
 * It does not implement the hypothetical guard from §3.6 ("a hypothetical or proposed
 * decision produces no verdict at all"). It cannot: `DecisionSnapshot` carries
 * `id, variable, value, statement, rationale, validFrom` and no lifecycle status, which is
 * the only field that says whether a decision is settled.
 *
 * That is not a gap in the snapshot — it is the right division of labour. Whether a decision
 * MAY be classified is pipeline policy, not engine behaviour, and the caller holds the full
 * `Decision` with its status. `retrieval/contradiction.ts` exports `isClassifiable` and the
 * retrieval pipeline applies it before ever building a request, so a `proposed` decision
 * never reaches any engine at all. An engine told "don't classify this" would have to invent
 * a verdict to return; never being asked does not.
 * ---------------------------------------------------------------------------
 */

import { type PairVerdict, classifyPair, describeRules } from "@/retrieval/contradiction";
import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { ClassificationResult } from "@/types/retrieval";
import type { ClassificationRequest } from "../types";

/** No local verdict may claim more certainty than a model reading both statements. The
 *  rule engine's antonym case reaches 0.95 because it is a table lookup with no ambiguity
 *  in it; everything else is capped here. */
export const LOCAL_CONFIDENCE_CAP = 0.6;

export function localClassify(
  request: ClassificationRequest,
  engine: EngineId,
): ClassificationResult {
  if (request.structuralVerdict !== undefined) return request.structuralVerdict;

  const pair = classifyPair(request.decisionA, request.decisionB);

  /* The diagnostic needs a rationale similarity, which the request does not carry — it
   * carries the two snapshots, and nothing here is allowed to embed them (invariant I3:
   * similarity never produces a verdict, and an M1/M2 label must not smuggle one in). The
   * retrieval pipeline computes the diagnostic where it already has the vectors. */
  const diagnostic = null;

  return {
    verdict: pair.verdict,
    gate: "semantic",
    explanation: pair.explanation,
    confidence: asConfidence(Math.min(pair.confidence, LOCAL_CONFIDENCE_CAP)),
    engine,
    ...(diagnostic === null ? {} : { diagnostic }),
  };
}

/** Re-exported so gate (b) and the Ask view quote the same rule list the classifier
 *  actually applies. The rules are the classifier's whole behaviour, so listing them is
 *  auditing it. */
export { describeRules as describeLocalRules };
export type { PairVerdict };
