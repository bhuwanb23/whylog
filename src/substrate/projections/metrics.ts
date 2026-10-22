/**
 * Metrics projection: the numbers the health panel and Phase 7 read.
 *
 * Phase 0 · sub-phase 0.2, consumed by Phases 4.4, 6.9 and 7
 *
 * ---------------------------------------------------------------------------
 * EVERY METRIC HERE IS DERIVED FROM THE LOG
 *
 * Nothing is counted as it happens and stored; everything is recomputed from the
 * projected state. That is what makes a metric survive a schema change, and it is
 * what lets the evaluation harness (Phase 7) recompute history rather than trust a
 * counter that was incremented by code that has since changed.
 *
 * The fold also writes a `metrics` map for cheap reads. This module is the
 * authoritative version: richer, typed, and the one that documents what each
 * number actually means.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, ISODateString, JustificationId, PremiseId } from "@/types/common";
import { isWorldObservable } from "@/types/domain";
import { driftAgeDays } from "../bi-temporal";
import type { GraphState } from "../graph-state";
import { OTHER_VARIABLE_THRESHOLD } from "../graph-state";

/* -------------------------------------------------------------------------- */
/* Compliance (Phase 4.4)                                                     */
/* -------------------------------------------------------------------------- */

export interface ComplianceReport {
  /** Fraction of ACCEPTED guards currently passing. 1.0 when there are none,
   *  because an unverified log is not a non-compliant one — and reporting 0 would
   *  punish a user for not having reached Phase 4 yet. */
  readonly compliance: number;
  readonly accepted: number;
  readonly passing: number;
  readonly failing: number;
  readonly skipped: number;
  readonly suppressed: number;
  /** Guards disabled because their decision is OUT or superseded. Excluded from
   *  the denominator: a reversed decision's guard failing is not a violation. */
  readonly disabled: number;
}

export function compliance(state: GraphState): ComplianceReport {
  let accepted = 0;
  let passing = 0;
  let failing = 0;
  let skipped = 0;
  let suppressed = 0;
  let disabled = 0;

  for (const guard of state.guards.values()) {
    if (guard.lifecycle === "suppressed") suppressed += 1;
    if (guard.lifecycle === "deleted") continue;
    if (guard.disabledByDecisionLabel) disabled += 1;
    if (guard.lifecycle !== "accepted" || guard.disabledByDecisionLabel) continue;

    accepted += 1;
    switch (guard.lastRun?.outcome) {
      case "pass":
        passing += 1;
        break;
      case "fail":
        failing += 1;
        break;
      case "skip":
      case undefined:
        skipped += 1;
        break;
    }
  }

  // Skipped guards are NOT counted as failures. A `string_pattern` guard with no
  // file contents to search skips, and calling that non-compliance would train the
  // user to ignore the score.
  const denominator = passing + failing;
  return {
    compliance: denominator === 0 ? 1 : passing / denominator,
    accepted,
    passing,
    failing,
    skipped,
    suppressed,
    disabled,
  };
}

/* -------------------------------------------------------------------------- */
/* Soundness                                                                  */
/* -------------------------------------------------------------------------- */

export interface SoundnessReport {
  /** Fraction of live decisions labelled IN. */
  readonly soundness: number;
  readonly live: number;
  readonly inLabel: number;
  readonly out: number;
  readonly unknown: number;
  readonly unfounded: number;
  /** IN decisions with no justification. Unfounded is a DATA-QUALITY warning,
   *  not a truth claim, and it is reported separately for that reason. */
  readonly unfoundedRate: number;
}

export function soundness(state: GraphState): SoundnessReport {
  let live = 0;
  let inLabel = 0;
  let out = 0;
  let unknown = 0;
  let unfounded = 0;

  for (const decision of state.decisions.values()) {
    if (decision.temporal.invalidFrom !== undefined) continue;
    if (decision.status === "superseded" || decision.status === "archived") continue;
    live += 1;

    switch (decision.label) {
      case "IN":
        inLabel += 1;
        if (decision.justificationIds.length === 0) unfounded += 1;
        break;
      case "OUT":
        out += 1;
        break;
      case "UNKNOWN":
        unknown += 1;
        break;
      case "UNFOUNDED":
        unfounded += 1;
        break;
    }
  }

  return {
    soundness: live === 0 ? 1 : inLabel / live,
    live,
    inLabel,
    out,
    unknown,
    unfounded,
    unfoundedRate: live === 0 ? 0 : unfounded / live,
  };
}

/* -------------------------------------------------------------------------- */
/* Verifiable coverage (Phase 4.4)                                            */
/* -------------------------------------------------------------------------- */

export interface CoverageReport {
  /** Fraction of live, sound decisions with at least one ACCEPTED guard. */
  readonly verifiableCoverage: number;
  readonly decisions: number;
  readonly guarded: number;
  /** Live decisions whose premises are all intent-based, so no guard could ever
   *  verify them. Marked `unverifiable` and SHOWN, never silently skipped. */
  readonly unverifiableByNature: number;
  /** Live decisions that could have a guard and do not. This is the actionable
   *  number: it is the backlog Phase 4 works down. */
  readonly unguardedButVerifiable: number;
}

export function coverage(state: GraphState): CoverageReport {
  let decisions = 0;
  let guarded = 0;
  let unverifiableByNature = 0;
  let unguardedButVerifiable = 0;

  for (const decision of state.decisions.values()) {
    if (decision.temporal.invalidFrom !== undefined) continue;
    if (decision.label !== "IN") continue;
    decisions += 1;

    const hasAcceptedGuard = decision.guardIds.some((id) => {
      const guard = state.guards.get(id);
      return guard?.lifecycle === "accepted";
    });
    if (hasAcceptedGuard) {
      guarded += 1;
      continue;
    }

    const premises = premiseIdsOf(state, decision.id);
    const anyObservable = premises.some((id) => {
      const premise = state.premises.get(id);
      return premise !== undefined && isWorldObservable(premise.type);
    });

    // A decision with no premises at all is not "unverifiable by nature" — it is
    // unfounded, and soundness() already reports it.
    if (premises.length > 0 && !anyObservable) unverifiableByNature += 1;
    else unguardedButVerifiable += 1;
  }

  return {
    verifiableCoverage: decisions === 0 ? 0 : guarded / decisions,
    decisions,
    guarded,
    unverifiableByNature,
    unguardedButVerifiable,
  };
}

function premiseIdsOf(state: GraphState, decisionId: DecisionId): readonly PremiseId[] {
  const out: PremiseId[] = [];
  for (const justificationId of state.decisions.get(decisionId)?.justificationIds ?? []) {
    const justification = state.justifications.get(justificationId as JustificationId);
    if (!justification) continue;
    for (const id of [...justification.inList, ...justification.outList]) out.push(id);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Drift                                                                      */
/* -------------------------------------------------------------------------- */

export interface DriftReport {
  /** Guards failing continuously, oldest first. */
  readonly failing: readonly { guardId: string; decisionId: string; days: number }[];
  /** Longest continuous failure, in days. The headline number: "a decision you
   *  made has been violated for N days". */
  readonly maxDriftDays: number;
}

export function drift(state: GraphState, now: ISODateString): DriftReport {
  const failing: { guardId: string; decisionId: string; days: number }[] = [];

  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted" || guard.disabledByDecisionLabel) continue;
    if (guard.firstFailedAt === undefined) continue;
    failing.push({
      guardId: guard.id,
      decisionId: guard.decisionId,
      days: Math.floor(driftAgeDays(guard.firstFailedAt, now)),
    });
  }

  failing.sort((a, b) => b.days - a.days);
  return { failing, maxDriftDays: failing[0]?.days ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Ontology health (Phase 0.7)                                                */
/* -------------------------------------------------------------------------- */

export interface OntologyHealth {
  readonly otherRate: number;
  readonly needsExtension: boolean;
  readonly threshold: number;
  /** Premise-type histogram. A spike is usually the extractor over-firing on one
   *  type, not the corpus being about one thing. */
  readonly premiseTypes: Readonly<Record<string, number>>;
  /** Justifications with a non-empty OUT-list. Zero means premise extraction is
   *  finding supporting conditions only, and gate (c) has nothing to work with. */
  readonly excludedConditionCount: number;
}

export function ontologyHealth(state: GraphState): OntologyHealth {
  const total = state.decisions.size;
  const other = state.byVariable.get("OTHER")?.length ?? 0;
  const otherRate = total === 0 ? 0 : other / total;

  const premiseTypes: Record<string, number> = {};
  for (const premise of state.premises.values()) {
    premiseTypes[premise.type] = (premiseTypes[premise.type] ?? 0) + 1;
  }

  let excluded = 0;
  for (const justification of state.justifications.values()) {
    if (justification.outList.length > 0) excluded += 1;
  }

  return {
    otherRate,
    needsExtension: otherRate > OTHER_VARIABLE_THRESHOLD,
    threshold: OTHER_VARIABLE_THRESHOLD,
    premiseTypes,
    excludedConditionCount: excluded,
  };
}

/* -------------------------------------------------------------------------- */
/* Detection quality (Phase 7.3)                                              */
/* -------------------------------------------------------------------------- */

export interface DetectionReport {
  readonly total: number;
  readonly byGate: Readonly<Record<string, number>>;
  readonly byVerdict: Readonly<Record<string, number>>;
  /** M1 = similar decisions, contradictory rationales. M2 = contradictory
   *  decisions, similar rationales. Borrowed from arXiv:2506.11005 and kept
   *  because the split tells you which FAILURE you have: M2 usually means the
   *  extractor got it wrong, M1 usually means the user did. */
  readonly m1: number;
  readonly m2: number;
  readonly resolved: number;
  readonly dismissed: number;
  /** Precision proxy: dismissed / resolved. The number that decides whether the
   *  gates are trusted. */
  readonly precisionProxy: number;
}

export function detections(state: GraphState): DetectionReport {
  const byGate: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  let m1 = 0;
  let m2 = 0;
  let resolved = 0;
  let dismissed = 0;

  for (const record of state.contradictions) {
    byGate[record.gate] = (byGate[record.gate] ?? 0) + 1;
    byVerdict[record.verdict] = (byVerdict[record.verdict] ?? 0) + 1;
    if (record.diagnostic === "M1") m1 += 1;
    if (record.diagnostic === "M2") m2 += 1;
    if (record.resolution === "accepted") resolved += 1;
    if (record.resolution === "dismissed") dismissed += 1;
  }

  const judged = resolved + dismissed;
  return {
    total: state.contradictions.length,
    byGate,
    byVerdict,
    m1,
    m2,
    resolved,
    dismissed,
    precisionProxy: judged === 0 ? 1 : resolved / judged,
  };
}

/* -------------------------------------------------------------------------- */
/* The agency ledger (Phase 6.4)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Who actually decided things.
 *
 * Reported because it is the honest answer to "is this my log or the model's?".
 * A log where most decisions are `agent_inferred` is a log the user has not read,
 * and the UI should say so rather than presenting it as the user's own reasoning.
 */
export interface AgencyReport {
  readonly humanStated: number;
  readonly humanAccepted: number;
  readonly agentInferred: number;
  readonly humanOverride: number;
  /** Fraction of live decisions with human authority >= 0.8. */
  readonly humanShare: number;
  readonly eventsByActor: Readonly<Record<string, number>>;
}

export function agency(state: GraphState): AgencyReport {
  let humanStated = 0;
  let humanAccepted = 0;
  let agentInferred = 0;
  let humanOverride = 0;
  let live = 0;

  for (const decision of state.decisions.values()) {
    if (decision.temporal.invalidFrom !== undefined) continue;
    live += 1;
    switch (decision.provenance.origin) {
      case "human_stated":
        humanStated += 1;
        break;
      case "agent_proposed_human_accepted":
        humanAccepted += 1;
        break;
      case "agent_inferred":
        agentInferred += 1;
        break;
      case "human_override":
        humanOverride += 1;
        break;
    }
  }

  const eventsByActor: Record<string, number> = {};
  for (const event of state.events) {
    const key =
      event.actor.kind === "engine" ? `engine:${event.actor.engine.kind}` : event.actor.kind;
    eventsByActor[key] = (eventsByActor[key] ?? 0) + 1;
  }

  return {
    humanStated,
    humanAccepted,
    agentInferred,
    humanOverride,
    humanShare: live === 0 ? 0 : (humanStated + humanOverride + humanAccepted) / live,
    eventsByActor,
  };
}

/* -------------------------------------------------------------------------- */
/* One call, everything                                                       */
/* -------------------------------------------------------------------------- */

export interface MetricsReport {
  readonly compliance: ComplianceReport;
  readonly soundness: SoundnessReport;
  readonly coverage: CoverageReport;
  readonly drift: DriftReport;
  readonly ontology: OntologyHealth;
  readonly detections: DetectionReport;
  readonly agency: AgencyReport;
  readonly events: number;
  readonly transcripts: number;
  readonly headHash: string;
}

export function reportAll(state: GraphState, now: ISODateString): MetricsReport {
  return {
    compliance: compliance(state),
    soundness: soundness(state),
    coverage: coverage(state),
    drift: drift(state, now),
    ontology: ontologyHealth(state),
    detections: detections(state),
    agency: agency(state),
    events: state.events.length,
    transcripts: state.transcripts.size,
    headHash: state.headHash,
  };
}

/** The three numbers that go in the export stamp, in one place so the compiler
 *  and the health panel cannot disagree about them.
 *
 *  No reference instant: all three are pure functions of the graph. If a
 *  time-dependent metric is ever added here, it takes one — but a parameter
 *  that is ignored is a lie about what the function depends on. */
export function headlineNumbers(state: GraphState): {
  compliance: number;
  verifiableCoverage: number;
  soundness: number;
} {
  return {
    compliance: compliance(state).compliance,
    verifiableCoverage: coverage(state).verifiableCoverage,
    soundness: soundness(state).soundness,
  };
}
