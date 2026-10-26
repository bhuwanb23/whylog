/**
 * Inclusion priority — 5.4.
 *
 * Phase 5 · sub-phase 5.4
 * Plan: plan/phase-5-export-compiler.md §5.4
 *
 * ---------------------------------------------------------------------------
 * WHY RANK AT ALL
 *
 * Anthropic's guidance is ~200 lines per context file, because "longer files consume more
 * context and reduce adherence". A mature log has more decisions than fit. So something has to
 * be left out, and the question is whether the thing left out is chosen by a rule anyone can
 * read or by whichever decision happened to sort first by id.
 *
 * ---------------------------------------------------------------------------
 *     priority(d) = 0.35 · soundness       IN > UNKNOWN > OUT
 *                 + 0.25 · entrenchment    strongly held decisions first
 *                 + 0.20 · scope breadth   decisions governing many files first
 *                 + 0.15 · guard severity  blocking guards before warning
 *                 + 0.05 · recency
 *
 * The weights come from the plan and are printed in the export view. They are inspectable
 * because a ranking nobody can read is a ranking nobody can argue with — the same rule the
 * retrieval reranker follows.
 *
 * ---------------------------------------------------------------------------
 * SOUNDNESS DOMINATES, AND OUT IS EXCLUDED BEFORE RANKING
 *
 * 0.35 is the largest weight, but it is not what keeps OUT decisions out of the file — they are
 * removed BEFORE ranking, by default, and only returned under an explicit toggle. Ranking an OUT
 * decision highly and then emitting it would put a rule the log no longer believes into an
 * agent's context alongside its replacement, which is exactly the "the model may pick one
 * arbitrarily" failure §5.6 exists to prevent.
 *
 * The weight matters for the cases in between: UNKNOWN and UNFOUNDED decisions are still
 * believed, just not well-supported, and they should lose a budget slot to an IN one.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { Decision } from "@/types/domain";
import type { DecisionLabel } from "@/types/domain";
import { EXPORT_PRIORITY_WEIGHTS } from "@/types/export";

/** Soundness by label. IN is 1; the rest are graded by how much support is missing. */
export const SOUNDNESS_BY_LABEL: Readonly<Record<DecisionLabel, number>> = {
  IN: 1,
  UNKNOWN: 0.5,
  UNFOUNDED: 0.3,
  OUT: 0,
};

/** Recency half-life for the 0.05 term. 365 days, deliberately long: recency is a tie-breaker,
 *  not a signal. A three-year-old decision that is IN, entrenched and blocking-guarded should
 *  outrank something decided last week that governs one file. Using the 180-day half-life the
 *  retrieval reranker uses would let freshness move decisions the other four terms agree on. */
export const RECENCY_HALF_LIFE_DAYS = 365;

/** Scope breadth saturates here. A decision governing 12 globs is not four times as important as
 *  one governing 3; it is somewhat broader. Without saturation a single decision with a long
 *  `applies_to` list would outrank everything else on 0.20 of the total. */
export const SCOPE_SATURATION = 6;

export interface PriorityInput {
  readonly decision: Decision;
  readonly label: DecisionLabel;
  /** Fraction of the decision's accepted guards that pass, or null when it has none. */
  readonly guardStatus: { passing: number; total: number; hasBlocking: boolean } | null;
  readonly now: number;
}

export interface PriorityBreakdown {
  readonly total: number;
  readonly soundness: number;
  readonly entrenchment: number;
  readonly scopeBreadth: number;
  readonly guardSeverity: number;
  readonly recency: number;
}

export function priorityOf(input: PriorityInput): PriorityBreakdown {
  const soundness = SOUNDNESS_BY_LABEL[input.label] ?? 0;

  /* `decision.entrenchment` is already 0..1 and already folds in source authority,
   * implementation cost, corroboration, confidence and recency. Reusing it rather than
   * recomputing keeps the export's notion of "strongly held" identical to the reasoning layer's
   * — two entrenchment functions would eventually rank differently and nobody would know which
   * was right. */
  const entrenchment = clamp01(input.decision.entrenchment);

  const scopeBreadth = clamp01(input.decision.appliesTo.length / SCOPE_SATURATION);

  /* Blocking guards outrank warning ones because a blocking guard failing stops a build: the
   * decision it protects is one the project has already agreed to enforce. A decision with no
   * guards scores 0 here, which is correct — it is less load-bearing in the verification sense,
   * and §5.3's "verifiable" property is exactly what it lacks. */
  let guardSeverity = 0;
  if (input.guardStatus !== null && input.guardStatus.total > 0) {
    guardSeverity = input.guardStatus.hasBlocking ? 1 : 0.6;
  }

  const recency = recencyScore(input.decision.temporal.valid, input.now);

  const total =
    EXPORT_PRIORITY_WEIGHTS.soundness * soundness +
    EXPORT_PRIORITY_WEIGHTS.entrenchment * entrenchment +
    EXPORT_PRIORITY_WEIGHTS.scopeBreadth * scopeBreadth +
    EXPORT_PRIORITY_WEIGHTS.guardSeverity * guardSeverity +
    EXPORT_PRIORITY_WEIGHTS.recency * recency;

  return { total, soundness, entrenchment, scopeBreadth, guardSeverity, recency };
}

/** Exponential decay on VALID time, not learned time. Ordering and display use valid time
 *  throughout the product: a decision made three years ago and imported yesterday is three years
 *  old, and ranking it as fresh would misrepresent when it was taken. */
export function recencyScore(validFrom: string, now: number): number {
  const then = Date.parse(validFrom);
  if (Number.isNaN(then)) return 0;

  const days = Math.max(0, (now - then) / 86_400_000);
  return 0.5 ** (days / RECENCY_HALF_LIFE_DAYS);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Guard facts for one decision, read once. */
export function guardStatusFor(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: Decision["id"],
): PriorityInput["guardStatus"] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return null;

  let passing = 0;
  let total = 0;
  let hasBlocking = false;

  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    if (guard.lifecycle !== "accepted") continue;
    if (guard.disabledByDecisionLabel) continue;
    if (labels.get(decisionId)?.label !== "IN") continue;

    total += 1;
    if (guard.severity === "blocking") hasBlocking = true;
    if (guard.lastRun !== undefined && guard.lastRun.outcome === "pass") passing += 1;
  }

  return total === 0 ? null : { passing, total, hasBlocking };
}

export function explainPriority(breakdown: PriorityBreakdown): string {
  return (
    "priority " +
    breakdown.total.toFixed(3) +
    " = " +
    EXPORT_PRIORITY_WEIGHTS.soundness +
    "·soundness(" +
    breakdown.soundness.toFixed(2) +
    ") + " +
    EXPORT_PRIORITY_WEIGHTS.entrenchment +
    "·entrenchment(" +
    breakdown.entrenchment.toFixed(2) +
    ") + " +
    EXPORT_PRIORITY_WEIGHTS.scopeBreadth +
    "·scope(" +
    breakdown.scopeBreadth.toFixed(2) +
    ") + " +
    EXPORT_PRIORITY_WEIGHTS.guardSeverity +
    "·guardSeverity(" +
    breakdown.guardSeverity.toFixed(2) +
    ") + " +
    EXPORT_PRIORITY_WEIGHTS.recency +
    "·recency(" +
    breakdown.recency.toFixed(2) +
    ")"
  );
}

export function describePriority(): string {
  return [
    "Inclusion priority — what gets an inline slot when the log is bigger than the budget:",
    "",
    "  " +
      EXPORT_PRIORITY_WEIGHTS.soundness +
      "  soundness       IN 1.0 · UNKNOWN 0.5 · UNFOUNDED 0.3 · OUT 0.0",
    "  " +
      EXPORT_PRIORITY_WEIGHTS.entrenchment +
      "  entrenchment    decision.entrenchment, REUSED not recomputed",
    "  " +
      EXPORT_PRIORITY_WEIGHTS.scopeBreadth +
      "  scope breadth   appliesTo.length / " +
      SCOPE_SATURATION +
      ", saturating",
    "  " +
      EXPORT_PRIORITY_WEIGHTS.guardSeverity +
      "  guard severity  1.0 with a blocking guard · 0.6 warning-only · 0 none",
    "  " +
      EXPORT_PRIORITY_WEIGHTS.recency +
      "  recency         half-life " +
      RECENCY_HALF_LIFE_DAYS +
      " days on VALID time",
    "",
    "OUT decisions are EXCLUDED before ranking, not ranked low. Ranking one highly and emitting it",
    'would put a rule the log no longer believes next to its replacement — the "model may pick',
    "one arbitrarily\" failure. Recency's half-life is a year rather than the 180 days retrieval",
    "uses, because here it is a tie-breaker and must not overturn the other four terms.",
  ].join("\n");
}
