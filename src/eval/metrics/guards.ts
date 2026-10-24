/**
 * Metric 12 — guard precision on seeded violations.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: the fitness-function literature, qualitative throughout.
 *
 * ---------------------------------------------------------------------------
 * THIS METRIC IS NOT MEASURED, AND SAYING SO IS THE RESULT
 *
 * Guard precision needs seeded violations: a repository state that breaks a decision, with a label
 * saying which guard should catch it. This corpus is twelve TRANSCRIPTS. It contains no package.json,
 * no repository state and no violations, so there is nothing for a guard to fail against and no
 * denominator for a precision.
 *
 * The honest output is `n = 0` and a note explaining what would be needed, not a proxy number dressed
 * up as precision. A benchmark that reports 1.0 for guard precision because no guard ever ran is
 * reporting that it measured nothing, in a format designed to look like success.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MEASURED INSTEAD, AND LABELLED AS SUCH
 *
 * Four properties of the guard layer that a transcript corpus CAN test, reported as their own numbers
 * and never as precision:
 *
 *   1. SYNTHESIS RATE — how many decisions got at least one proposed guard. This is the claim that
 *      matters most (nobody generates the check from the decision) and it needs no violations.
 *   2. DETERMINISM SHARE — how many synthesised guards are deterministic rather than `llm_judge`.
 *      `llm_judge` is structurally excluded from compliance in Phase 4, so this is the fraction of the
 *      layer that can actually gate a CI run.
 *   3. SKIP DISCIPLINE — whether any skipped guard was counted as a pass. Phase 4 settled that skips
 *      are never passes; this checks the settlement held.
 *   4. AUTO-INSTALL — whether any guard reached `accepted` without a human. Invariant I4 says the
 *      system proposes and the human disposes, and a harness that never acts as a human should find
 *      zero accepted guards. Finding one would be a real defect.
 *
 * All four are structural checks on the corpus this benchmark actually has, and all four would still be
 * worth reporting even with a perfect violation-seeded precision beside them.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { Guard } from "@/types/guards";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { COMPARATORS, METRIC_NAMES, describeEngineId, type MetricResult } from "./types";

export interface GuardOutcome {
  readonly metric: MetricResult;
  readonly guards: number;
  readonly decisionsWithGuard: number;
  readonly decisionsTotal: number;
  readonly synthesisRate: number;
  readonly deterministic: number;
  readonly judged: number;
  readonly determinismShare: number;
  readonly skippedCountedAsPass: number;
  readonly autoAccepted: number;
  /** Guards whose `disabledByDecisionLabel` disagrees with their decision's actual label. Must be 0. */
  readonly staleDisabledFlags: number;
  readonly byKind: Readonly<Record<string, number>>;
}

export function scoreGuards(corpus: ResolvedCorpus, run: RunResult, engine: EngineId): GuardOutcome {
  const guards: Guard[] = [...run.state.guards.values()];
  const decisionsTotal = run.state.decisions.size;

  const decisionsWithGuard = new Set(guards.map((guard) => guard.decisionId)).size;
  const synthesisRate = decisionsTotal === 0 ? 0 : decisionsWithGuard / decisionsTotal;

  /* `llm_judge` is the only non-deterministic kind, and Phase 4 excludes it from compliance by
   * filtering on `isDeterministic` with no code path around the filter. Counting it here checks that
   * the exclusion has something to exclude — a determinism share of 1.0 with zero guards is vacuous. */
  const deterministic = guards.filter((guard) => guard.spec.kind !== "llm_judge").length;
  const judged = guards.length - deterministic;
  const determinismShare = guards.length === 0 ? 0 : deterministic / guards.length;

  const byKind: Record<string, number> = {};
  for (const guard of guards) {
    const kind: string = guard.spec.kind;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }

  /* A skip counted as a pass would be invisible in the compliance metric and fatal in CI: the pipeline
   * goes green because the check never ran. Detected by looking for guards whose last run skipped but
   * whose lifecycle reads as satisfied. */
  const skippedCountedAsPass = guards.filter(
    (guard) => guard.lastRun?.outcome === "skip" && guard.lifecycle === "accepted",
  ).length;

  /* A guard whose decision went OUT or SUPERSEDED must be auto-disabled, or a reversed decision keeps
   * nagging the user about a rule they no longer hold. Phase 6 found this field going stale in the fold
   * and fixed it there; counting it here means a regression surfaces as a number in a table rather than
   * as a bug noticed during the demo. */
  const staleDisabled = guards.filter((guard) => {
    const decision = run.state.decisions.get(guard.decisionId);
    if (decision === undefined) return false;
    const shouldBeDisabled =
      decision.label === "OUT" || decision.label === "UNFOUNDED" || decision.status === "superseded";
    return shouldBeDisabled !== guard.disabledByDecisionLabel;
  }).length;

  /* Invariant I4. The harness never acts as a human, so every accepted guard is one the system
   * accepted for itself. */
  const autoAccepted = guards.filter((guard) => guard.lifecycle === "accepted").length;

  return {
    guards: guards.length,
    decisionsWithGuard,
    decisionsTotal,
    synthesisRate,
    deterministic,
    judged,
    determinismShare,
    skippedCountedAsPass,
    autoAccepted,
    staleDisabledFlags: staleDisabled,
    byKind,
    metric: {
      id: "guard-precision",
      name: METRIC_NAMES["guard-precision"],
      /* Zero, not a proxy. The value is meaningless without n and the gloss says so first. */
      value: 0,
      detail: null,
      n: 0,
      perEngine: [{ engine: describeEngineId(engine), value: 0, n: 0, detail: null }],
      comparator: COMPARATORS["guard-precision"] ?? null,
      gloss:
        "NOT MEASURED — n=0. This corpus is twelve transcripts with no repository state, so no violation could be seeded " +
        "and no guard had anything to fail against. Measured instead: synthesis rate " + (synthesisRate * 100).toFixed(0) +
        "% (" + decisionsWithGuard + " of " + decisionsTotal + " decisions got a proposed guard), determinism share " +
        (determinismShare * 100).toFixed(0) + "% (" + deterministic + " deterministic, " + judged + " llm_judge), " +
        skippedCountedAsPass + " skip(s) counted as a pass, " + autoAccepted + " guard(s) auto-accepted without a human, " +
        staleDisabled + " guard(s) whose disabled flag disagrees with their decision's label.",
      honestNote:
        "NOT MEASURED, AND THIS IS A LIMITATION OF THE BENCHMARK RATHER THAN A RESULT ABOUT THE SYSTEM. Guard precision " +
        "requires seeded violations — a repository state that breaks a decision, labelled with which guard should catch it " +
        "— and a transcript corpus contains no repository state. Reporting a proxy as precision, or reporting 1.0 because " +
        "no guard ever failed, would both be the same error in different clothes: a number in a format designed to look " +
        "like a measurement. The four structural properties that ARE testable on this corpus are reported in the gloss and " +
        "are worth having on their own — synthesis rate is the central novelty claim (no surveyed tool generates the check " +
        "from the decision) and needs no violations at all. Three of the reported counts are INVARIANT CHECKS rather than " +
        "measurements and must be zero: skips counted as passes, guards accepted without a human (invariant I4 — the harness " +
        "never acts as a human, so any accepted guard is one the system accepted for itself), and guards whose disabled flag " +
        "disagrees with their decision's label. A non-zero value in any of them is a defect in Phase 4 or in the fold, not a " +
        "property of the corpus. Seeding real violations needs a fixture repository, which is roadmap work and is recorded " +
        "in LIMITATIONS.",
    },
  };
}

export type { ResolvedCorpus };
