/**
 * Confidence tiering — 1.8, the shared half.
 *
 * Phase 1 ú sub-phase 1.8
 * Plan: plan/phase-1-extraction-pipeline.md §1.8
 *
 * ---------------------------------------------------------------------------
 * WHAT IS SHARED AND WHAT IS NOT
 *
 * SCORING is engine-specific: the local path scores from cues and slots
 * (`src/ai/local/confidence.ts`), the LLM path scores from run agreement
 * (`voting.ts`). TIERING is shared, because the review UI has one layout and a
 * tier must mean the same thing whichever engine produced the item. If "high"
 * meant 0.75 locally and 0.6 on the LLM path, a bulk approve would sweep different
 * populations on the two paths and Phase 7's comparison would be meaningless.
 *
 * ---------------------------------------------------------------------------
 * THE TIERS DRIVE THE UI, NOT A SORT
 *
 * Extraction over-generates: ARGUS measured 155 false positives against 12 false
 * negatives, a 13:1 ratio (docs/05). So the review surface is optimised for FAST
 * REJECTION rather than careful acceptance:
 *
 *   ò0.75  high    expanded, bulk-approvable
 *   0.45–  medium  normal
 *   <0.45  low     COLLAPSED BY DEFAULT, one-click discard
 *
 * A tier is therefore a claim about how much of the user's attention an item
 * deserves, which is why premises and alternatives are always one tier BELOW the
 * decision they attach to: the published precision gap is a fact about the
 * components, and the UI should encode it rather than ask the user to remember it.
 * ---------------------------------------------------------------------------
 */

import { MODALITY_FACTOR } from "@/ai/local/confidence";
import type { AlternativeCandidate, DecisionCandidate, PremiseCandidate } from "@/ai/types";
import type { Confidence } from "@/types/common";
import { asConfidence } from "@/types/common";
import { type DecisionOrigin, type Modality, ORIGIN_AUTHORITY } from "@/types/domain";
import { type ConfidenceTier, TIER_HIGH_AT, TIER_MEDIUM_AT, demoteTier, tierOf } from "./types";

export { TIER_HIGH_AT, TIER_MEDIUM_AT, tierOf, demoteTier };
export type { ConfidenceTier };

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export interface TieredDecision {
  readonly candidate: DecisionCandidate;
  readonly confidence: Confidence;
  readonly tier: ConfidenceTier;
  readonly expanded: boolean;
  readonly bulkApprovable: boolean;
}

/**
 * Apply modality and origin to a raw score, then tier it.
 *
 * Both are MULTIPLICATIVE. An agent-inferred proposal is not "a good extraction
 * minus points"; it is proportionally less trustworthy, and the difference matters
 * most near the bulk-approve threshold, where an additive penalty would let a
 * strong cue carry a weak origin over the line.
 */
export function tierDecision(
  candidate: DecisionCandidate,
  origin: DecisionOrigin,
  rawScore: Confidence,
): TieredDecision {
  const confidence = asConfidence(
    clamp(rawScore * MODALITY_FACTOR[candidate.modality] * ORIGIN_AUTHORITY[origin]),
  );
  const tier = tierOf(confidence);

  return {
    candidate: { ...candidate, confidence, origin },
    confidence,
    tier,
    expanded: tier !== "low",
    // Bulk approval is the fastest way to get a wrong node into the log, so it is
    // restricted to the top tier AND to asserted modality: a bulk-approved
    // proposal would be promoted to IN by `DecisionApproved`, which is exactly the
    // thing the review gate exists to prevent.
    bulkApprovable: tier === "high" && candidate.modality === "asserted",
  };
}

/* -------------------------------------------------------------------------- */
/* Premises and alternatives                                                  */
/* -------------------------------------------------------------------------- */

export interface TieredPremise {
  readonly candidate: PremiseCandidate;
  readonly confidence: Confidence;
  readonly tier: ConfidenceTier;
  readonly expanded: boolean;
}

/**
 * Tier a premise, one tier below the decision it supports.
 *
 * `decisionTier` is the tier of the decision the premise attaches to. An unattached
 * premise is demoted from `medium` rather than from the decision's tier, because
 * there is no decision to be below.
 */
export function tierPremise(
  candidate: PremiseCandidate,
  rawScore: Confidence,
  decisionTier: ConfidenceTier | null,
): TieredPremise {
  // A premise the extractor already flagged is capped below the auto-accept line.
  // `needsReview` is true for every topical cue and every explicit cue under 0.9,
  // so in practice this caps everything — which is the honest Phase 1 position.
  const capped = candidate.needsReview ? Math.min(rawScore, TIER_HIGH_AT - 0.01) : rawScore;
  const confidence = asConfidence(clamp(capped));

  const own = tierOf(confidence);
  const tier = decisionTier === null ? demoteTier(own) : lowerOf(own, demoteTier(decisionTier));

  return {
    candidate: { ...candidate, confidence },
    confidence,
    tier,
    expanded: tier === "high",
  };
}

export interface TieredAlternative {
  readonly candidate: AlternativeCandidate;
  readonly confidence: Confidence;
  readonly tier: ConfidenceTier;
  readonly expanded: boolean;
  /** An alternative with no reason is stored but never pre-empts. Pre-empting
   *  without a reason is nagging. */
  readonly preemptionEligible: boolean;
}

export function tierAlternative(
  candidate: AlternativeCandidate,
  rawScore: Confidence,
  decisionTier: ConfidenceTier | null,
): TieredAlternative {
  const confidence = asConfidence(clamp(rawScore));
  const own = tierOf(confidence);
  const tier = decisionTier === null ? demoteTier(own) : lowerOf(own, demoteTier(decisionTier));

  return {
    candidate: { ...candidate, confidence },
    confidence,
    // Alternatives are never expanded by default, at any tier. ARGUS's 15.4%
    // precision means the expected value of showing one unasked is negative.
    expanded: false,
    tier,
    preemptionEligible:
      candidate.whyRejected !== undefined && candidate.whyRejected.trim().length > 0,
  };
}

/** `low` < `medium` < `high`. */
function lowerOf(a: ConfidenceTier, b: ConfidenceTier): ConfidenceTier {
  const rank: Record<ConfidenceTier, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function clamp(value: number): number {
  return Math.max(0.05, Math.min(0.95, value));
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export interface TierHistogram {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly bulkApprovable: number;
  readonly expandedByDefault: number;
  readonly total: number;
}

/**
 * What the review queue will look like BEFORE the user opens it.
 *
 * Worth computing because it is the number that predicts whether review will take
 * 60 seconds or 10 minutes: a queue that is 80% `low` is a queue where the
 * extractor over-generated, and the right response is to discard in bulk, not to
 * read.
 */
export function histogram(
  decisions: readonly TieredDecision[],
  premises: readonly TieredPremise[],
  alternatives: readonly TieredAlternative[],
): TierHistogram {
  const all: ConfidenceTier[] = [
    ...decisions.map((d) => d.tier),
    ...premises.map((p) => p.tier),
    ...alternatives.map((a) => a.tier),
  ];

  return {
    high: all.filter((t) => t === "high").length,
    medium: all.filter((t) => t === "medium").length,
    low: all.filter((t) => t === "low").length,
    bulkApprovable: decisions.filter((d) => d.bulkApprovable).length,
    expandedByDefault:
      decisions.filter((d) => d.expanded).length +
      premises.filter((p) => p.expanded).length +
      alternatives.filter((a) => a.expanded).length,
    total: all.length,
  };
}

export function describeHistogram(h: TierHistogram): string {
  if (h.total === 0) return "nothing extracted";
  const parts = [
    `${h.total} item${h.total === 1 ? "" : "s"}`,
    `${h.high} high ú ${h.medium} medium ú ${h.low} low`,
  ];
  if (h.bulkApprovable > 0) parts.push(`${h.bulkApprovable} bulk-approvable`);
  const collapsed = h.total - h.expandedByDefault;
  if (collapsed > 0) parts.push(`${collapsed} collapsed by default`);
  return parts.join(" ú ");
}

/** What a tier MEANS, in the words the review UI shows. */
export const TIER_HINTS: Readonly<Record<ConfidenceTier, string>> = {
  high: "Expanded. Safe to bulk-approve if the transcript is one you trust.",
  medium: "Normal review. Read it; the extractor is probably right.",
  low: "Collapsed. The extractor is probably wrong — one click discards it.",
};

/** The modality discount, exposed so the review UI can explain why an item that
 *  scored well still landed in a lower tier. */
export function describeModalityDiscount(modality: Modality): string {
  const factor = MODALITY_FACTOR[modality];
  if (factor === 1) return "asserted — no discount";
  return `${modality} — score multiplied by ${factor.toFixed(2)}`;
}

/** The origin discount, likewise. */
export function describeOriginDiscount(origin: DecisionOrigin): string {
  const factor = ORIGIN_AUTHORITY[origin];
  if (factor === 1) return "human-stated — full authority";
  return `${origin.replace(/_/g, " ")} — score multiplied by ${factor.toFixed(2)}`;
}
