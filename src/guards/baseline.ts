/**
 * The baseline and the ratchet — 4.4.
 *
 * Phase 4 · sub-phase 4.4
 * Plan: plan/phase-4-executable-guards.md §4.4
 * Docs: docs/04-executable-decision-guards.md §7
 *
 * ---------------------------------------------------------------------------
 * A LEGACY CODEBASE FAILS MANY GUARDS ON FIRST RUN
 *
 * That is not a bug in the guards and it is not a bug in the codebase — it is what happens when
 * you start checking decisions that were made and never verified. The naive response is a wall
 * of red, and a wall of red on day one is how a verification feature gets switched off.
 *
 * So: freeze the initial state as a BASELINE, fail only on NEW violations, and let the user
 * shrink the baseline deliberately.
 *
 *   "Never write fitness functions for the codebase you want — write them for the one you
 *    have. The function is a lock, not a goal."
 *
 * ---------------------------------------------------------------------------
 * A BASELINED FAILURE IS NOT A PASS
 *
 * This is the distinction that keeps the mechanism honest. A failure in the baseline is still a
 * failure: it is counted, it is listed, and it shows its evidence. What it does not do is count
 * as DRIFT, and it does not fire `GuardFailed` into the revision cycle — because firing a
 * revision proposal for a violation that predates the guard would produce a queue of things
 * the user already knows about, on the first run, which is the wall of red by another route.
 *
 * `metrics/compliance.ts` therefore reports TWO numbers: raw compliance, and compliance
 * excluding baselined failures. Showing only the second would hide the mess; showing only the
 * first would make day one look catastrophic. Both, labelled, is the honest presentation.
 *
 * ---------------------------------------------------------------------------
 * THE RATCHET ONLY TURNS ONE WAY
 *
 * Once a guard passes, it is added to `enforced`. A guard on that list cannot be silently
 * demoted: if it starts failing again, that is a NEW violation regardless of the baseline,
 * because the baseline recorded it as passing. Quality never decreases, which is the whole
 * point of calling it a ratchet.
 * ---------------------------------------------------------------------------
 */

import type { GuardId, ISODateString } from "@/types/common";
import type { GuardBaseline, GuardRunResult } from "@/types/guards";
import { nowISO } from "@/lib/format";
import type { EvaluatedGuard } from "./types";

/** No baseline yet. Distinct from an empty baseline: `frozenAt` empty means nothing has been
 *  frozen, so the first run should offer to freeze rather than pretending it already did. */
export const NO_BASELINE: GuardBaseline = {
  frozenAt: "" as ISODateString,
  frozenFailures: {},
  enforced: [],
};

export function hasBaseline(baseline: GuardBaseline | null): boolean {
  return baseline !== null && baseline.frozenAt.length > 0;
}

/**
 * Freeze the current failures as the baseline.
 *
 * Idempotent in the useful direction: freezing again REPLACES the baseline with the current
 * state, which is how a user deliberately accepts a new set of known failures. That is a
 * decision worth making explicitly, so the UI asks for it rather than doing it automatically.
 */
export function freezeBaseline(
  evaluated: readonly EvaluatedGuard[],
  previous: GuardBaseline | null,
): GuardBaseline {
  const frozenFailures: Record<string, string> = {};
  const enforced: GuardId[] = [];

  for (const entry of evaluated) {
    if (entry.result.outcome === "fail") {
      frozenFailures[entry.guard.id] = entry.result.evidence;
      continue;
    }
    /* Anything that passes at freeze time is enforced from then on. A skip is not a pass and
     * does not get enforced: enforcing a guard that could not run would ratchet a gap into a
     * guarantee. */
    if (entry.result.outcome === "pass") enforced.push(entry.guard.id);
  }

  /* Carry forward enforced guards that were not evaluated this run, so a run against a partial
   * project cannot silently un-ratchet them. */
  if (previous !== null) {
    for (const id of previous.enforced) {
      if (!enforced.includes(id)) enforced.push(id);
    }
  }

  return {
    frozenAt: nowISO() as ISODateString,
    frozenFailures,
    enforced,
  };
}

/**
 * Is this failure new?
 *
 * New means: not recorded in the baseline, OR the guard is on the enforced list. The second
 * clause is the ratchet — a guard that passed at freeze time and fails now is drift even if
 * some other run later recorded it as failing.
 */
export function isNewViolation(baseline: GuardBaseline | null, evaluated: EvaluatedGuard): boolean {
  if (evaluated.result.outcome !== "fail") return false;
  if (!hasBaseline(baseline)) return true;
  if (baseline === null) return true;

  if (baseline.enforced.includes(evaluated.guard.id)) return true;

  return !(evaluated.guard.id in baseline.frozenFailures);
}

/** Annotate a run with baseline-relative novelty. */
export function applyBaseline(
  baseline: GuardBaseline | null,
  evaluated: readonly EvaluatedGuard[],
): readonly EvaluatedGuard[] {
  return evaluated.map((entry) => ({
    ...entry,
    newViolation: isNewViolation(baseline, entry),
  }));
}

/** Failures the baseline already knew about. Listed, not hidden. */
export function baselinedFailures(
  baseline: GuardBaseline | null,
  evaluated: readonly EvaluatedGuard[],
): readonly EvaluatedGuard[] {
  return evaluated.filter((entry) => entry.result.outcome === "fail" && !entry.newViolation);
}

export function newViolations(evaluated: readonly EvaluatedGuard[]): readonly EvaluatedGuard[] {
  return evaluated.filter((entry) => entry.newViolation);
}

/**
 * Remove a guard from the baseline — the user fixed it, or decided it should fail loudly now.
 *
 * Shrinking the baseline is the deliberate act the pattern depends on. If it could only grow,
 * the baseline would eventually contain everything and the guards would check nothing.
 */
export function shrinkBaseline(
  baseline: GuardBaseline,
  guardId: GuardId,
): GuardBaseline {
  const frozenFailures: Record<string, string> = {};

  for (const [id, evidence] of Object.entries(baseline.frozenFailures)) {
    if (id === guardId) continue;
    frozenFailures[id] = evidence;
  }

  return { ...baseline, frozenFailures };
}

/** Add to the enforced set. Called when a previously failing guard passes. */
export function ratchetUp(baseline: GuardBaseline, guardId: GuardId): GuardBaseline {
  if (baseline.enforced.includes(guardId)) return baseline;
  return { ...baseline, enforced: [...baseline.enforced, guardId] };
}

/** Ratchet every guard that passed this run, and drop the ones that now fail. A guard that
 *  fails is removed from `enforced` so it can be re-ratcheted when it passes again — but the
 *  failure itself is NEW by definition, because it was enforced. */
export function ratchetAfterRun(
  baseline: GuardBaseline,
  evaluated: readonly EvaluatedGuard[],
): GuardBaseline {
  let next = baseline;

  for (const entry of evaluated) {
    if (entry.skipped) continue;

    if (entry.result.outcome === "pass") {
      next = ratchetUp(next, entry.guard.id);
      next = shrinkBaseline(next, entry.guard.id);
    }
  }

  return next;
}

export function describeBaseline(baseline: GuardBaseline | null): string {
  if (!hasBaseline(baseline) || baseline === null) {
    return [
      "No baseline has been frozen.",
      "",
      "Until one is, every failure counts as new. On a codebase whose decisions were never",
      "checked before, that means a wall of red on the first run — which is how a verification",
      "feature gets switched off. Freezing records the failures you already know about and",
      "surfaces only what drifts afterwards.",
      "",
      "A baselined failure is still a failure: it is counted, listed and shows its evidence. It",
      "just is not DRIFT, and it does not fire a revision proposal for something you already know.",
    ].join("\n");
  }

  const frozen = Object.keys(baseline.frozenFailures).length;

  return [
    "Baseline frozen " + baseline.frozenAt + ".",
    "  known failures   " + frozen,
    "  enforced (ratcheted) " + baseline.enforced.length,
    "",
    "Only violations NEW since that freeze surface as drift. An enforced guard that starts",
    "failing is new by definition, because the baseline recorded it passing — that is the",
    "ratchet, and it only turns one way.",
    "",
    "Shrink the baseline deliberately as you fix things. If it could only grow it would",
    "eventually contain everything, and the guards would be checking nothing.",
  ].join("\n");
}

export type { GuardRunResult };
