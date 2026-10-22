/**
 * The review queue's shapes.
 *
 * Phase 1 · sub-phase 1.9
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN `review/index.ts`
 *
 * `review/actions.ts` needs `ReviewItem` to build a discard record, and
 * `review/index.ts` re-exports `actions.ts`. With the interface declared in
 * `index.ts` the two files import each other. `verbatimModuleSyntax` erases a
 * type-only import so nothing breaks at runtime — which is exactly why it would
 * have survived: a cycle that works is a cycle nobody fixes, and it breaks the day
 * either module grows a top-level initialiser that reads the other.
 *
 * Same reason `src/extraction/lines.ts` exists for the speakers pair.
 * ---------------------------------------------------------------------------
 */

import type { AlternativeId, Confidence, DecisionId, PremiseId } from "@/types/common";
import type { ConfidenceTier, ReviewAction } from "@/extraction/types";

/* Re-exported because they are part of the queue's vocabulary: a caller reading
 * `review/types.ts` for `ReviewItem` needs these to interpret it, and importing
 * them from `@/extraction/types` as well would split one concept across two files. */
export type { ConfidenceTier, ReviewAction };

/** What the review component renders. One shape, whichever source produced it. */
export interface ReviewItem {
  readonly key: string;
  readonly kind: "decision" | "premise" | "alternative";
  /** Set once the item is a real node in the graph. Null while it is still a
   *  candidate in an uncommitted run. */
  readonly id: DecisionId | PremiseId | AlternativeId | null;
  readonly title: string;
  readonly detail: string;
  readonly quote: string;
  readonly confidence: Confidence;
  readonly tier: ConfidenceTier;
  readonly origin: string;
  readonly engine: string;
  /** Expanded by default? Low tier is never expanded — that is the whole point of
   *  sorting for rejection. */
  readonly expanded: boolean;
  /** The ladder's answer, in words. "merges onto WLD-0003" is the difference
   *  between a review the user trusts and one they have to verify by hand. */
  readonly resolution: string;
  readonly conflictsWith: readonly DecisionId[];
  /** Is this an OUT-list premise, derived rather than quoted? Shown differently
   *  because it is an inference and the user should know before accepting it. */
  readonly derived: boolean;
  readonly action: ReviewAction | null;
}

export type ReviewFilter =
  | "all"
  | "decisions"
  | "premises"
  | "alternatives"
  | "conflicts"
  | "derived"
  | "low"
  | "unreviewed";

export type ReviewSort = "confidence-desc" | "confidence-asc" | "kind" | "conflicts-first";

export interface ReviewQueueOptions {
  readonly filter: ReviewFilter;
  readonly sort: ReviewSort;
  readonly search: string;
}

export const DEFAULT_REVIEW_OPTIONS: ReviewQueueOptions = {
  filter: "all",
  sort: "confidence-desc",
  search: "",
};