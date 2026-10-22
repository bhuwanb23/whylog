/**
 * Reasoning contracts — entrenchment, adjudication, revision proposals.
 *
 * Phase 2 · sub-phases 2.6-2.9
 * Plan:     plan/phase-2-truth-maintenance.md
 * Research: docs/02-truth-maintenance-theory.md §3, §5
 */

import type { Confidence, DecisionId, EventId, PremiseId, ProposalId, SourceSpan } from "./common";
import type { DecisionLabel, Nogood } from "./domain";

/* -------------------------------------------------------------------------- */
/* Entrenchment                                                               */
/* -------------------------------------------------------------------------- */

/**
 * E(d) = 0.30 · source_authority
 *      + 0.20 · implementation_cost   <- the NOVEL term
 *      + 0.20 · corroboration
 *      + 0.15 · confidence
 *      + 0.15 · recency
 *
 * Then the EE3 cap: E(d) <= min(E(p)) over the decision's premises. A derived
 * belief is never more entrenched than its weakest premise.
 *
 * `implementation_cost` is the term no belief-revision system has, because none
 * of them is attached to a codebase. It is measured by the fraction of the
 * decision's accepted guards that currently pass — see Phase 4.5.
 */
export interface EntrenchmentBreakdown {
  readonly total: number;
  readonly capped: number;
  readonly ee3CapApplied: boolean;
  readonly components: {
    readonly sourceAuthority: number;
    readonly implementationCost: number;
    readonly corroboration: number;
    readonly confidence: number;
    readonly recency: number;
  };
  readonly weights: {
    readonly sourceAuthority: number;
    readonly implementationCost: number;
    readonly corroboration: number;
    readonly confidence: number;
    readonly recency: number;
  };
  /**
   * True when implementationCost is a DEFAULT rather than a measurement.
   *
   * Displayed as "unknown — no guard", never as "medium". A missing measurement
   * must not masquerade as a measurement.
   */
  readonly implementationCostUnknown: boolean;
  /** The weakest premise, when the EE3 cap binds. */
  readonly weakestPremiseId?: PremiseId;
}

export const ENTRENCHMENT_WEIGHTS = Object.freeze({
  sourceAuthority: 0.3,
  implementationCost: 0.2,
  corroboration: 0.2,
  confidence: 0.15,
  recency: 0.15,
} as const);

/** Recency half-life in days, on the VALID time axis. A decision made three
 *  weeks ago is three weeks old regardless of when it was imported. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Neutral value used when no guard exists. */
export const UNKNOWN_IMPLEMENTATION_COST = 0.5;

/* -------------------------------------------------------------------------- */
/* Cascade                                                                    */
/* -------------------------------------------------------------------------- */

export interface CascadeStep {
  readonly from: DecisionId | PremiseId;
  readonly to: DecisionId;
  readonly depth: number;
  readonly became: DecisionLabel;
  /**
   * True when propagation STOPPED here because the node had an independent
   * surviving justification.
   *
   * Zombie-belief prevention. The stop condition is THE DESIGN, not an
   * optimisation: over-retraction is worse than under-retraction, because a
   * tool that flags everything gets switched off.
   */
  readonly stoppedAtIndependentSupport: boolean;
  readonly reason: string;
}

export interface CascadeResult {
  readonly steps: readonly CascadeStep[];
  readonly flipped: readonly DecisionId[];
  readonly survivors: readonly DecisionId[];
  /** True when the depth cap truncated propagation. */
  readonly truncated: boolean;
  readonly potentiallyAffectedBeyondCap: number;
}

/* -------------------------------------------------------------------------- */
/* Backtracking & nogoods                                                     */
/* -------------------------------------------------------------------------- */

export interface BacktrackResult {
  /** The MINIMAL set of assumption nodes responsible. Give up as little as
   *  possible. */
  readonly culpritPremises: readonly PremiseId[];
  readonly path: readonly (DecisionId | PremiseId)[];
  readonly depthReached: number;
  readonly truncated: boolean;
}

/**
 * A recorded impossible conjunction of assumptions.
 *
 * In classical TMS a nogood is internal bookkeeping. Here it is THE EXPLANATION:
 * "these two assumptions cannot both hold" is the single most
 * useful sentence the system can produce. Display it prominently, and check
 * new proposals against recorded nogoods before suggesting them.
 *
 * An ALIAS of the persisted node, not a second shape of it: a nogood recorded
 * in the log and a nogood reported to the user have to be the same thing, and
 * two interfaces for one concept drift.
 */
export interface NogoodRecord {
  readonly id: NogoodId;
  readonly premiseIds: readonly PremiseId[];
  readonly explanation: string;
  readonly derivedFrom: EventId;
}

/* -------------------------------------------------------------------------- */
/* Adjudication                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Non-prioritized revision (Hansson): the newcomer may be REJECTED.
 *
 * AGM's Success postulate — always accept new information — is wrong here. If
 * it held, any passing remark in a transcript could overwrite a decision made
 * over three days. A noisy input stream must not be able to corrupt a
 * well-founded log.
 */
export type AdjudicationOutcome =
  /** The newcomer outranks every contradictor; retract weakest-first. */
  | { readonly kind: "apply"; readonly retract: readonly DecisionId[] }
  /** The newcomer is weaker than at least one contradictor. It goes to the
   *  CONTESTED queue — never silently dropped, never silently applied. */
  | {
      readonly kind: "reject-newcomer";
      readonly why: string;
      readonly blockingDecisionId: DecisionId;
      readonly newcomerEntrenchment: number;
      readonly incumbentEntrenchment: number;
      /** §2.8: the FULL breakdown of BOTH sides. Two totals cannot show that the
       *  newcomer lost on corroboration and implementation cost rather than on
       *  authority, and "override anyway" is only an informed choice if the
       *  arithmetic is visible. */
      readonly newcomerBreakdown: EntrenchmentBreakdown;
      readonly incumbentBreakdown: EntrenchmentBreakdown;
    }
  /** Nothing to adjudicate. */
  | { readonly kind: "none" };

/* -------------------------------------------------------------------------- */
/* The revision proposal — seven parts, every time                            */
/* -------------------------------------------------------------------------- */

export type RevisionAction = "reverse" | "rejustify" | "contest";

/**
 * The system PROPOSES, the human DISPOSES (invariant I4). Nothing here is ever
 * auto-applied: not a retraction, not a reversal, not a guard, not an export.
 *
 * Veritas auto-retracts because its inputs are programmatic assertions with
 * declared reliability. WhyLog's inputs are EXTRACTED PROSE, and extracted prose
 * must not be allowed to silently rewrite a considered decision.
 */
export interface RevisionProposal {
  readonly id: ProposalId;
  readonly createdAt: EventId;

  /** 1. WHAT FAILED */
  readonly unsoundDecisionId: DecisionId;
  readonly failedPremiseId: PremiseId;
  readonly failedPremiseText: string;

  /** 2. THE EVIDENCE */
  readonly evidence: {
    readonly quote: string;
    readonly span?: SourceSpan;
    readonly source: "transcript" | "guard" | "human" | "repo-scan";
    readonly confidence: Confidence;
  };

  /** 3. THE NOGOOD */
  readonly nogood?: NogoodRecord;

  /** 4. THE CASCADE */
  readonly cascade: CascadeResult;

  /** 5. ENTRENCHMENT */
  readonly entrenchment: EntrenchmentBreakdown;
  readonly entrenchmentBand: "LOW" | "MEDIUM" | "HIGH";

  /** 6. ACTIONS */
  readonly availableActions: readonly RevisionAction[];

  /** 7. WHY NOT AUTO-APPLIED */
  readonly whyNotAutoApplied: string;

  readonly status: "open" | "resolved" | "dismissed";
  readonly resolvedBy?: EventId;
}

/** Bands used for display. Deliberately coarse: the exact number is available
 *  in the breakdown, the band is what a human reads at a glance. */
export function entrenchmentBand(total: number): "LOW" | "MEDIUM" | "HIGH" {
  if (total >= 0.7) return "HIGH";
  if (total >= 0.45) return "MEDIUM";
  return "LOW";
}
