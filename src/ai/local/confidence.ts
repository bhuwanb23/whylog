/**
 * The local confidence rubrics ΓÇö 1.8.
 *
 * Phase 1 ┬╖ sub-phase 1.8
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.8
 *
 * ---------------------------------------------------------------------------
 * ADDITIVE AND INSPECTABLE, ON PURPOSE
 *
 * Every term is a named constant and every score is a sum of them, so a wrong
 * confidence can be ARGUED WITH. "This decision is 0.62 because it has a strong
 * cue (+0.30), a resolved variable (+0.25), no rationale clause (+0) and an
 * asserted modality (+0.10)" is a sentence a user can disagree with and a
 * maintainer can tune. A learned scorer would be better on average and impossible
 * to correct in the one case that matters.
 *
 * The rubric for decisions is the plan's, verbatim. The premise and alternative
 * rubrics are the same shape with different weights, because the published
 * precision differs by a factor of five between them and a single rubric would
 * either over-trust alternatives or under-trust decisions.
 *
 * ---------------------------------------------------------------------------
 * THE TIER RULE LIVES IN `src/extraction/confidence.ts`
 *
 * Scoring is engine-specific ΓÇö the LLM path scores from run agreement, not from
 * cues ΓÇö but tiering is shared, because the review UI has one layout and it must
 * mean the same thing whichever engine produced the item. So this module returns
 * NUMBERS and never tiers.
 * ---------------------------------------------------------------------------
 */

import type { Confidence } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionOrigin, Modality } from "@/types/domain";
import type { RecoveredDecision } from "@/extraction/decisions";
import type { RecoveredPremise } from "@/extraction/premises";
import type { RecoveredAlternative } from "@/extraction/alternatives";
import type { ValueStrength } from "@/ai/local/value-phrase";

/* -------------------------------------------------------------------------- */
/* Decision rubric ΓÇö plan ┬º1.8, verbatim                                      */
/* -------------------------------------------------------------------------- */

export const DECISION_WEIGHTS = {
  /** Strong decision cue present. */
  strongCue: 0.3,
  /** Variable resolved to the ontology. */
  variableResolved: 0.25,
  /** Value resolved to a canonical alias. */
  canonicalValue: 0.15,
  /** Rationale clause present. */
  rationalePresent: 0.15,
  /** Modality is `asserted`. */
  assertedModality: 0.1,
  /** Human-stated origin. */
  humanStated: 0.05,
} as const;

/** What counts as a STRONG cue. The table's own weights are continuous; the rubric
 *  needs a threshold, and 0.8 sits between "decided to" (0.95) and "deal" (0.5). */
export const STRONG_CUE_WEIGHT = 0.8;

export interface DecisionScoreBreakdown {
  readonly total: Confidence;
  readonly terms: readonly ScoreTerm[];
}

export interface ScoreTerm {
  readonly label: string;
  readonly awarded: number;
  readonly available: number;
}

/**
 * Score a recovered decision.
 *
 * @param origin from `provenance.ts`. Passed in rather than read off the candidate
 *               because the candidate's `origin` is still the conservative default
 *               until provenance has seen the whole turn list.
 */
export function scoreDecision(
  decision: RecoveredDecision,
  origin: DecisionOrigin,
): DecisionScoreBreakdown {
  const terms: ScoreTerm[] = [];

  const cueAwarded =
    decision.cue.weight >= STRONG_CUE_WEIGHT
      ? DECISION_WEIGHTS.strongCue
      : decision.cue.weight * DECISION_WEIGHTS.strongCue;
  terms.push(term("strong decision cue", cueAwarded, DECISION_WEIGHTS.strongCue));

  // Binary rather than proportional: a decision that landed in a typed variable
  // either resolved or it did not, and `resolveVariable`'s internal score measures
  // how sure the GUESS was, not whether the slot is real.
  const variableAwarded = variableResolved(decision) ? DECISION_WEIGHTS.variableResolved : 0;
  terms.push(term("variable resolved to the ontology", variableAwarded, DECISION_WEIGHTS.variableResolved));

  const valueAwarded = valueStrengthAward(decision.value.strength, DECISION_WEIGHTS.canonicalValue);
  terms.push(term("value resolved to a canonical alias", valueAwarded, DECISION_WEIGHTS.canonicalValue));

  const rationaleAwarded = decision.fields.rationale === null ? 0 : DECISION_WEIGHTS.rationalePresent;
  terms.push(term("rationale clause present", rationaleAwarded, DECISION_WEIGHTS.rationalePresent));

  const modalityAwarded = decision.candidate.modality === "asserted" ? DECISION_WEIGHTS.assertedModality : 0;
  terms.push(term("modality is asserted", modalityAwarded, DECISION_WEIGHTS.assertedModality));

  const originAwarded = origin === "human_stated" ? DECISION_WEIGHTS.humanStated : 0;
  terms.push(term("human-stated origin", originAwarded, DECISION_WEIGHTS.humanStated));

  const total = terms.reduce((sum, t) => sum + t.awarded, 0);
  return { total: asConfidence(clamp(total)), terms };
}

/** A decision that landed in OTHER has no resolved variable, whatever the guess's
 *  internal score was. Checking the OUTCOME rather than the score keeps the term
 *  honest: `resolveVariable` returns 0.2 for OTHER via `fallback`. */
function variableResolved(decision: RecoveredDecision): boolean {
  return decision.candidate.variable !== "OTHER";
}

function valueStrengthAward(strength: ValueStrength, available: number): number {
  switch (strength) {
    case "scoped-known":
      return available;
    case "known":
      return available;
    case "tech-shaped":
      return available * 0.5;
    case "bare":
      return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Premise rubric                                                             */
/* -------------------------------------------------------------------------- */

export const PREMISE_WEIGHTS = {
  /** Explicit cue rather than a topical hint. */
  explicitCue: 0.25,
  /** The cue declared its predicate, so rung 1 of the ladder can match it. */
  predicateFromCue: 0.2,
  /** A restrictive cue states a bound rather than mentioning a topic. */
  restrictive: 0.15,
  /** The premise attaches to a decision. Unattached premises are facts, not
   *  load-bearing assumptions, and score lower for it. */
  attachedToDecision: 0.15,
  /** A value was recovered, so the premise is falsifiable by counting. */
  hasValue: 0.1,
  /** World-observable types can be checked by a guard, which makes them worth
   *  more to the system AND more likely to be real: people state measurable
   *  constraints more precisely than intentions. */
  worldObservable: 0.15,
} as const;

export function scorePremise(
  premise: RecoveredPremise,
  attached: boolean,
  worldObservable: boolean,
): DecisionScoreBreakdown {
  const terms: ScoreTerm[] = [];

  terms.push(term("explicit cue", premise.kind === "explicit" ? PREMISE_WEIGHTS.explicitCue : PREMISE_WEIGHTS.explicitCue * premise.cue.weight, PREMISE_WEIGHTS.explicitCue));
  terms.push(term("predicate came from the cue table", premise.predicateVia === "cue" ? PREMISE_WEIGHTS.predicateFromCue : 0, PREMISE_WEIGHTS.predicateFromCue));
  terms.push(term("restrictive polarity", premise.polarity === "restrictive" ? PREMISE_WEIGHTS.restrictive : premise.polarity === "negative" ? PREMISE_WEIGHTS.restrictive * 0.5 : 0, PREMISE_WEIGHTS.restrictive));
  terms.push(term("attached to a decision", attached ? PREMISE_WEIGHTS.attachedToDecision : 0, PREMISE_WEIGHTS.attachedToDecision));
  terms.push(term("value recovered", premise.candidate.value === undefined ? 0 : PREMISE_WEIGHTS.hasValue, PREMISE_WEIGHTS.hasValue));
  terms.push(term("world-observable type", worldObservable ? PREMISE_WEIGHTS.worldObservable : 0, PREMISE_WEIGHTS.worldObservable));

  const total = terms.reduce((sum, t) => sum + t.awarded, 0);
  return { total: asConfidence(clamp(total)), terms };
}

/* -------------------------------------------------------------------------- */
/* Alternative rubric                                                         */
/* -------------------------------------------------------------------------- */

export const ALTERNATIVE_WEIGHTS = {
  /** Syntactically explicit ("X instead of Y") versus inferred. */
  pivotConstruction: 0.35,
  rejectionCue: 0.25,
  knownValue: 0.2,
  hasReason: 0.2,
} as const;

export function scoreAlternative(alternative: RecoveredAlternative): DecisionScoreBreakdown {
  const terms: ScoreTerm[] = [];

  terms.push(term("pivot construction", alternative.via === "pivot" ? ALTERNATIVE_WEIGHTS.pivotConstruction : 0, ALTERNATIVE_WEIGHTS.pivotConstruction));
  terms.push(term("rejection cue", alternative.cuePhrase === null ? 0 : ALTERNATIVE_WEIGHTS.rejectionCue, ALTERNATIVE_WEIGHTS.rejectionCue));
  terms.push(term("value known to the ontology", alternative.value.strength === "known" || alternative.value.strength === "scoped-known" ? ALTERNATIVE_WEIGHTS.knownValue : 0, ALTERNATIVE_WEIGHTS.knownValue));
  terms.push(term("carries a reason", alternative.candidate.whyRejected === undefined ? 0 : ALTERNATIVE_WEIGHTS.hasReason, ALTERNATIVE_WEIGHTS.hasReason));

  const total = terms.reduce((sum, t) => sum + t.awarded, 0);
  return { total: asConfidence(clamp(total)), terms };
}

/* -------------------------------------------------------------------------- */
/* Modality penalty                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How much a modality discounts a decision.
 *
 * `proposed` is a real proposal and keeps most of its score ΓÇö it just cannot become
 * IN without a human. `hypothetical` and `reported` never reach here: they are
 * discarded in `decisions.ts`.
 */
export const MODALITY_FACTOR: Readonly<Record<Modality, number>> = {
  asserted: 1,
  proposed: 0.85,
  hypothetical: 0.4,
  reported: 0.4,
};

/**
 * How much an origin discounts a decision.
 *
 * Multiplies the score rather than adding to it, and tracks `ORIGIN_AUTHORITY`:
 * an agent-inferred decision is not "5 points worse", it is proportionally less
 * trustworthy, and the difference matters more at the top of the scale where the
 * bulk-approve threshold sits.
 */
export function originFactor(origin: DecisionOrigin, authority: Readonly<Record<DecisionOrigin, number>>): number {
  return authority[origin];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function term(label: string, awarded: number, available: number): ScoreTerm {
  return { label, awarded: Math.max(0, awarded), available };
}

function clamp(value: number): number {
  return Math.max(0.05, Math.min(0.95, value));
}

/** The breakdown as one line per term, for the review UI's "why this score"
 *  expansion. Shows awarded AND available, so a missing term is visible as a gap
 *  rather than as an absence. */
export function describeBreakdown(breakdown: DecisionScoreBreakdown): string {
  return breakdown.terms
    .map((t) => `${t.label}: +${t.awarded.toFixed(2)} of ${t.available.toFixed(2)}`)
    .join("\n");
}
