/**
 * Entrenchment — 2.8.
 *
 * Phase 2 · sub-phase 2.8
 * Plan: plan/phase-2-truth-maintenance.md §2.8
 * Docs: docs/02-truth-maintenance-theory.md §3.4, docs/04 §4.5
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR
 *
 * When new information contradicts something already in the log, exactly one of two
 * things happens: the newcomer is accepted and the incumbent retracted, or the
 * newcomer is refused. That choice needs an ordering, and recency is the wrong one —
 * it would let a passing remark in a transcript overwrite a decision made over three
 * days.
 *
 * Entrenchment is that ordering: how much it would COST to give this belief up.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE TERMS, AND THE ONE NOBODY ELSE HAS
 *
 *   E(d) = 0.30 · source_authority     who said it
 *        + 0.20 · implementation_cost  what it would take to undo it  <- NOVEL
 *        + 0.20 · corroboration        how many independent sources
 *        + 0.15 · confidence           how sure the extraction was
 *        + 0.15 · recency              how recently it was valid
 *
 * `source_authority`, `corroboration`, `confidence` and `recency` all exist in prior
 * belief-revision systems. Veritas computes `0.40 reliability + 0.25 corroboration +
 * 0.20 confidence + 0.15 recency`. None of them has `implementation_cost`, because
 * none of them is attached to a codebase.
 *
 * `implementation_cost` is the fraction of a decision's accepted guards that currently
 * PASS. A decision with six passing guards is baked in: reversing it means changing
 * six things that are already built and verified. A decision with no guards has cost
 * 0.5 — and that is reported as UNKNOWN, never as "medium". A missing measurement must
 * not masquerade as a measurement. Phase 4 supplies the real number; until then every
 * breakdown carries `implementationCostUnknown: true` and the UI says so.
 *
 * ---------------------------------------------------------------------------
 * THE EE3 CAP
 *
 *   E(d) <= min(E(p)) over the decision's premises.
 *
 * A derived belief is never more entrenched than its weakest premise. Without this,
 * a decision resting entirely on `single-user` could out-rank the arrival of a second
 * user on corroboration and recency alone — and the system would refuse the very
 * evidence that invalidates it. The cap is what makes premise invalidation able to
 * beat entrenchment, which is the demo.
 *
 * `weakestPremiseId` is recorded when the cap binds, because "this is entrenched at
 * 0.31 because `single-user` is only 0.31" is the sentence that makes the number
 * arguable rather than authoritative.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { Decision, Premise } from "@/types/domain";
import { ORIGIN_AUTHORITY } from "@/types/domain";
import type { EntrenchmentBreakdown } from "@/types/reasoning";
import {
  ENTRENCHMENT_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  UNKNOWN_IMPLEMENTATION_COST,
  entrenchmentBand,
} from "@/types/reasoning";

/* -------------------------------------------------------------------------- */
/* Decision entrenchment                                                      */
/* -------------------------------------------------------------------------- */

export interface GuardStatus {
  /** Fraction of the decision's accepted guards that currently pass, 0..1. */
  readonly passingFraction: number;
  readonly total: number;
  readonly passing: number;
}

/**
 * E(d).
 *
 * @param now the instant recency is measured against. Passed in rather than read from
 *   the clock so that a batch run over the whole log orders every decision against the
 *   same instant — otherwise the last decision scored is systematically the freshest.
 * @param guards Phase 4. Absent means cost is UNKNOWN, not zero and not medium.
 */
export function entrenchmentOf(
  state: GraphState,
  decisionId: DecisionId,
  now: number,
  guards?: GuardStatus,
): EntrenchmentBreakdown {
  const decision: Decision | undefined = state.decisions.get(decisionId);
  if (decision === undefined) return emptyBreakdown();

  const sourceAuthority = ORIGIN_AUTHORITY[decision.provenance.origin] ?? 0.4;
  const implementationCost =
    guards === undefined || guards.total === 0
      ? UNKNOWN_IMPLEMENTATION_COST
      : guards.passingFraction;
  const corroboration = clamp01(decision.corroboration);
  const confidence = clamp01(decision.provenance.confidence);
  const recency = recencyScore(validFromMs(decision), now);

  const weighted =
    ENTRENCHMENT_WEIGHTS.sourceAuthority * sourceAuthority +
    ENTRENCHMENT_WEIGHTS.implementationCost * implementationCost +
    ENTRENCHMENT_WEIGHTS.corroboration * corroboration +
    ENTRENCHMENT_WEIGHTS.confidence * confidence +
    ENTRENCHMENT_WEIGHTS.recency * recency;

  /* ---- the EE3 cap ---- */
  let capped = weighted;
  let capApplied = false;
  let weakestPremiseId: PremiseId | undefined;

  const premiseIds = premisesOf(state, decisionId);
  if (premiseIds.length > 0) {
    let weakest = Number.POSITIVE_INFINITY;
    for (const premiseId of premiseIds) {
      const score = premiseEntrenchmentOf(state, premiseId, now);
      if (score < weakest) {
        weakest = score;
        weakestPremiseId = premiseId;
      }
    }
    if (weakest < weighted) {
      capped = weakest;
      capApplied = true;
    }
  }

  return {
    total: round4(weighted),
    capped: round4(capped),
    ee3CapApplied: capApplied,
    components: {
      sourceAuthority: round4(sourceAuthority),
      implementationCost: round4(implementationCost),
      corroboration: round4(corroboration),
      confidence: round4(confidence),
      recency: round4(recency),
    },
    weights: ENTRENCHMENT_WEIGHTS,
    implementationCostUnknown: guards === undefined || guards.total === 0,
    ...(weakestPremiseId === undefined || !capApplied ? {} : { weakestPremiseId }),
  };
}

/* -------------------------------------------------------------------------- */
/* Premise entrenchment                                                       */
/* -------------------------------------------------------------------------- */

/**
 * E(p). The same idea, one term fewer.
 *
 * A premise has no guards — there is nothing to run against an assumption about the
 * world — so `implementation_cost` is dropped and the remaining four weights are
 * RENORMALISED to sum to 1. Renormalising rather than leaving a hole matters: an
 * unrenormalised premise score would max out at 0.80 and would therefore ALWAYS bind
 * the EE3 cap, making the cap a formality instead of a constraint that bites only when
 * a premise is genuinely weaker than its decision.
 *
 * Source authority for a premise comes from its evidence: a human-stated observation
 * outranks an agent inference, and a premise with no evidence at all is an assumption
 * held on nothing, which is the weakest thing in the log.
 */
export function premiseEntrenchmentOf(
  state: GraphState,
  premiseId: PremiseId,
  now: number,
): number {
  const premise: Premise | undefined = state.premises.get(premiseId);
  if (premise === undefined) return 0;

  const sourceAuthority = premiseAuthority(premise);
  const corroboration = clamp01(premise.corroboration);
  const confidence = clamp01(premise.confidence);
  const recency = recencyScore(validFromMsOfWindow(premise.temporal.valid), now);

  const w = ENTRENCHMENT_WEIGHTS;
  const denominator = w.sourceAuthority + w.corroboration + w.confidence + w.recency;

  const score =
    (w.sourceAuthority * sourceAuthority +
      w.corroboration * corroboration +
      w.confidence * confidence +
      w.recency * recency) /
    denominator;

  return round4(score);
}

/**
 * Who vouches for this premise.
 *
 * The highest-authority SUPPORTING observation wins, and a premise whose only evidence
 * is agent inference is capped low regardless of how confident the extraction was —
 * an inference cannot be more trustworthy than the inference it came from.
 */
function premiseAuthority(premise: Premise): number {
  const supporting = premise.evidence.filter((entry) => entry.supports);
  if (supporting.length === 0) {
    /* An assumption with no observation behind it. Non-zero because it was asserted
     * deliberately and appears in a justification, but it is the weakest kind of
     * support in the log. */
    return 0.3;
  }

  const byKind: Record<string, number> = {
    human: ORIGIN_AUTHORITY.human_stated,
    guard: 0.85,
    "repo-scan": 0.7,
    transcript: ORIGIN_AUTHORITY.agent_inferred,
  };

  let best = 0;
  for (const entry of supporting) {
    const authority = byKind[entry.kind] ?? 0.4;
    if (authority > best) best = authority;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The shared pieces                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Exponential decay on the VALID time axis, half-life 30 days.
 *
 * Valid time, not learned time: a decision made three weeks ago is three weeks old
 * even if the transcript was imported this morning. Scoring recency on import time
 * would make every freshly imported log look newly made, which is exactly the
 * bi-temporal confusion the substrate exists to prevent.
 */
export function recencyScore(validFromMs: number, now: number): number {
  if (!Number.isFinite(validFromMs)) return 0.5;

  const ageDays = Math.max(0, (now - validFromMs) / 86_400_000);
  return 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
}

function validFromMs(decision: Decision): number {
  return validFromMsOfWindow(decision.temporal.valid);
}

function validFromMsOfWindow(valid: string): number {
  const ms = Date.parse(valid);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** The premises a decision rests on: every IN-list premise of every justification
 *  whose consequent is this decision. */
export function premisesOf(state: GraphState, decisionId: DecisionId): readonly PremiseId[] {
  const found = new Set<PremiseId>();
  for (const justification of state.justifications.values()) {
    if (justification.consequent !== decisionId) continue;
    for (const premiseId of justification.inList) found.add(premiseId);
  }
  return [...found];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function emptyBreakdown(): EntrenchmentBreakdown {
  return {
    total: 0,
    capped: 0,
    ee3CapApplied: false,
    components: {
      sourceAuthority: 0,
      implementationCost: UNKNOWN_IMPLEMENTATION_COST,
      corroboration: 0,
      confidence: 0,
      recency: 0,
    },
    weights: ENTRENCHMENT_WEIGHTS,
    implementationCostUnknown: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The arithmetic, written out.
 *
 * A number that cannot be argued with is not a diagnosis. Every term is shown with its
 * weight and its value, the cap is shown when it binds and named by the premise that
 * caused it, and the unknown guard term is labelled unknown rather than 0.50.
 */
export function describeEntrenchment(
  state: GraphState,
  decisionId: DecisionId,
  breakdown: EntrenchmentBreakdown,
): string {
  const c = breakdown.components;
  const w = breakdown.weights;

  const lines = [
    `${decisionId} — entrenchment ${breakdown.capped.toFixed(2)} (${entrenchmentBand(breakdown.capped)})`,
    `  ${w.sourceAuthority.toFixed(2)} × source authority ${c.sourceAuthority.toFixed(2)}`,
    breakdown.implementationCostUnknown
      ? `  ${w.implementationCost.toFixed(2)} × implementation cost UNKNOWN (no guard yet — counted as ${c.implementationCost.toFixed(2)}, not measured)`
      : `  ${w.implementationCost.toFixed(2)} × implementation cost ${c.implementationCost.toFixed(2)}`,
    `  ${w.corroboration.toFixed(2)} × corroboration ${c.corroboration.toFixed(2)}`,
    `  ${w.confidence.toFixed(2)} × confidence ${c.confidence.toFixed(2)}`,
    `  ${w.recency.toFixed(2)} × recency ${c.recency.toFixed(2)} (half-life ${RECENCY_HALF_LIFE_DAYS}d, valid time)`,
    `  = ${breakdown.total.toFixed(2)} uncapped`,
  ];

  if (breakdown.ee3CapApplied && breakdown.weakestPremiseId !== undefined) {
    const weakest = state.premises.get(breakdown.weakestPremiseId);
    lines.push(
      `  EE3 cap binds: weakest premise ${breakdown.weakestPremiseId}` +
        `${weakest === undefined ? "" : ` "${weakest.text}"`} is ${breakdown.capped.toFixed(2)}, so the decision cannot be more entrenched than that.`,
    );
  }

  return lines.join("\n");
}

/** One-line form for list rows. */
export function entrenchmentSummary(breakdown: EntrenchmentBreakdown): string {
  const band = entrenchmentBand(breakdown.capped);
  const cap = breakdown.ee3CapApplied ? ", capped by its weakest premise" : "";
  const unknown = breakdown.implementationCostUnknown ? ", no guard measured" : "";
  return `${breakdown.capped.toFixed(2)} ${band}${cap}${unknown}`;
}
