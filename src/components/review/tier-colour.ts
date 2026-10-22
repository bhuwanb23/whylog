/**
 * The confidence-tier colours.
 *
 * Phase 1 · sub-phase 1.9
 *
 * One module because the row's left border, the filter pill's highlight and the
 * commit button's accent all encode the same three tiers, and three copies of a
 * colour map is three chances for the review UI to disagree with itself about what
 * "low" looks like.
 *
 * Colour encodes EPISTEMIC STATUS, never severity. Red is reserved elsewhere in the
 * app for "an action is available" and is not used for tiers at all: a low-confidence
 * item is not dangerous, it is probably wrong, and those call for different colours.
 */

import type { ConfidenceTier } from "@/extraction/types";

export const TIER_COLOUR: Readonly<Record<ConfidenceTier, string>> = {
  high: "var(--tier-high, #3fb950)",
  medium: "var(--tier-medium, #d29922)",
  low: "var(--tier-low, #6e7681)",
};

/** What a tier means, for the `title` tooltip on a badge. */
export { TIER_HINTS } from "@/extraction/confidence";
