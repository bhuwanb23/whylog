/**
 * Selectors: the read side the UI consumes.
 *
 * Phase 0 · sub-phase 0.2, extended through Phase 6
 *
 * ---------------------------------------------------------------------------
 * THE ORDERING RULE, ENFORCED HERE
 *
 * Every list the UI shows is ordered by VALID time, not learned time. It would be
 * easy to sort by the event order — that is the order the data arrived in — and it
 * would be wrong every time somebody pastes a three-week-old transcript, because
 * the timeline would then show the history in the order the user happened to
 * remember it.
 *
 * The audit view is the one exception, and it sorts by learned time explicitly and
 * by name (`auditTrail`), so the two orders can never be confused.
 * ---------------------------------------------------------------------------
 */

import { compare, byValidDesc, byIdAsc, formatInterval, isOpen } from "@/substrate/bi-temporal";
import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import type { Decision, DecisionLabel, DecisionVariable, Premise } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import { OTHER_VARIABLE_THRESHOLD } from "@/substrate/graph-state";
import * as decisions from "@/substrate/projections/decisions";
import * as edges from "@/substrate/projections/edges";
import * as justifications from "@/substrate/projections/justifications";
import * as metrics from "@/substrate/projections/metrics";
import * as premises from "@/substrate/projections/premises";

/** The canonical timeline order: valid time descending, ties broken by id.
 *  Exported so a component cannot sort the same list differently by accident. */
export const timelineOrder = compare(byValidDesc, byIdAsc);

export interface GraphNode {
  readonly id: DecisionId;
  readonly variable: DecisionVariable;
  readonly label: DecisionLabel;
  readonly live: boolean;
}

/* -------------------------------------------------------------------------- */
/* Timeline (6.1)                                                             */
/* -------------------------------------------------------------------------- */

export interface TimelineRow {
  readonly decision: Decision;
  readonly premises: readonly Premise[];
  readonly excluded: readonly Premise[];
  readonly interval: string;
  readonly live: boolean;
  readonly supersededBy: DecisionId | null;
  readonly guardCount: number;
}

export interface TimelineFilter {
  readonly variables: readonly DecisionVariable[];
  readonly labels: readonly DecisionLabel[];
  /** Include closed-out nodes. Off by default: the timeline shows what is true,
   *  and a separate control shows what stopped being true. */
  readonly includeClosed: boolean;
  readonly text: string;
}

export const NO_TIMELINE_FILTER: TimelineFilter = {
  variables: [],
  labels: [],
  includeClosed: false,
  text: "",
};

export function timeline(state: GraphState, filter: TimelineFilter = NO_TIMELINE_FILTER): readonly TimelineRow[] {
  const needle = filter.text.trim().toLowerCase();

  return decisions
    .allDecisions(state, "valid-desc")
    .filter((decision) => {
      if (!filter.includeClosed && !isOpen(decision.temporal)) return false;
      if (filter.variables.length > 0 && !filter.variables.includes(decision.variable)) return false;
      if (filter.labels.length > 0 && !filter.labels.includes(decision.label)) return false;
      if (needle.length > 0) {
        const haystack = `${decision.statement} ${decision.value} ${decision.rationale ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .map((decision): TimelineRow => {
      const { inList, outList } = premises.premisesOf(state, decision.id);
      return {
        decision,
        premises: inList,
        excluded: outList,
        interval: formatInterval(decision.temporal),
        live: isOpen(decision.temporal),
        supersededBy: decision.edges.supersededBy[0] ?? null,
        guardCount: decision.guardIds.length,
      };
    });
}

/** The audit trail, in LEARNED time. The one list that must not be reordered by
 *  validity: its whole purpose is to show what the system knew, when it knew it. */
export function auditTrail(
  state: GraphState,
  limit = 200,
): readonly { id: string; at: string; occurredAt: string; type: string; actor: string; reason: string }[] {
  return state.events
    .slice(-limit)
    .reverse()
    .map((event) => ({
      id: event.id,
      at: event.at,
      occurredAt: event.occurredAt,
      type: event.type,
      actor: event.actor.kind === "engine" ? `engine:${event.actor.engine.kind}` : event.actor.kind,
      reason: event.reason,
    }));
}

/* -------------------------------------------------------------------------- */
/* Health (6.9)                                                               */
/* -------------------------------------------------------------------------- */

export interface HealthSummary {
  readonly events: number;
  readonly decisions: number;
  readonly liveDecisions: number;
  readonly soundness: number;
  readonly compliance: number;
  readonly verifiableCoverage: number;
  readonly contradictions: number;
  readonly openProposals: number;
  readonly pendingReview: number;
  readonly otherVariableRate: number;
  readonly ontologyNeedsExtension: boolean;
  readonly excludedConditions: number;
  readonly maxDriftDays: number;
  readonly humanShare: number;
  readonly chainValid: boolean;
  readonly headHash: string;
  readonly indexStale: boolean;
  readonly indexLevels: readonly string[];
  readonly labelDrift: readonly justifications.LabelDrift[];
}

export function health(state: GraphState, now: ISODateString, chainValid: boolean): HealthSummary {
  const sound = metrics.soundness(state);
  const report = metrics.compliance(state);
  const cov = metrics.coverage(state);
  const drift = metrics.drift(state, now);
  const onto = metrics.ontologyHealth(state);
  const agency = metrics.agency(state);

  return {
    events: state.events.length,
    decisions: state.decisions.size,
    liveDecisions: sound.live,
    soundness: sound.soundness,
    compliance: report.compliance,
    verifiableCoverage: cov.verifiableCoverage,
    contradictions: state.contradictions.length,
    openProposals: [...state.proposals.values()].filter((p) => p.status === "open").length,
    pendingReview: state.pendingReview.length,
    otherVariableRate: onto.otherRate,
    ontologyNeedsExtension: onto.otherRate > OTHER_VARIABLE_THRESHOLD,
    excludedConditions: onto.excludedConditionCount,
    maxDriftDays: drift.maxDriftDays,
    humanShare: agency.humanShare,
    chainValid,
    headHash: state.headHash,
    indexStale: state.index.stale,
    indexLevels: state.index.levels,
    labelDrift: justifications.labelDrift(state),
  };
}

/* -------------------------------------------------------------------------- */
/* Conflict (6.5)                                                             */
/* -------------------------------------------------------------------------- */

/** Open revision proposals, weakest-entrenched first. The order matters: the
 *  system adjudicates weakest-first, and the queue should read the same way the
 *  reasoning ran. */
export function openProposals(state: GraphState) {
  return [...state.proposals.values()]
    .filter((p) => p.status === "open")
    .sort((a, b) => a.entrenchment.total - b.entrenchment.total);
}

export function contestedQueue(state: GraphState): readonly Decision[] {
  return decisions.contestedDecisions(state);
}

/** Unresolved detections, newest first. */
export function unresolvedContradictions(state: GraphState) {
  return state.contradictions.filter((c) => c.resolution === undefined);
}

/* -------------------------------------------------------------------------- */
/* Graph (6.6)                                                                */
/* -------------------------------------------------------------------------- */

export interface GraphData {
  readonly nodes: readonly { id: DecisionId; variable: DecisionVariable; label: DecisionLabel; live: boolean }[];
  readonly links: readonly edges.Edge[];
  readonly clusters: readonly (readonly DecisionId[])[];
  readonly largestCluster: number;
}

export function graph(state: GraphState, includeClosed = false): GraphData {
  const nodes: GraphNode[] = [];

  for (const decision of state.decisions.values()) {
    if (!includeClosed && !isOpen(decision.temporal)) continue;
    nodes.push({
      id: decision.id,
      variable: decision.variable,
      label: decision.label,
      live: isOpen(decision.temporal),
    });
  }

  const clusters = edges.cascadeComponents(state);
  return {
    nodes,
    links: edges.allEdges(state),
    clusters,
    largestCluster: clusters[0]?.length ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

export function decisionById(state: GraphState, id: DecisionId): Decision | null {
  return decisions.getDecision(state, id);
}

export function premiseById(state: GraphState, id: PremiseId): Premise | null {
  return premises.getPremise(state, id);
}

/** Everything known about one decision, assembled for the detail drawer. */
export function decisionDetail(state: GraphState, id: DecisionId) {
  const decision = decisions.getDecision(state, id);
  if (decision === null) return null;

  const { inList, outList } = premises.premisesOf(state, id);
  return {
    decision,
    premises: inList,
    excluded: outList,
    evaluations: justifications.evaluateFor(state, id),
    derivedLabel: justifications.deriveLabel(state, decision),
    chain: decisions.supersessionChain(state, id),
    edges: edges.edgesOf(state, id),
    alternatives: decision.alternativeIds
      .map((alternativeId) => state.alternatives.get(alternativeId))
      .filter((a): a is NonNullable<typeof a> => a !== undefined),
    guards: decision.guardIds
      .map((guardId) => state.guards.get(guardId))
      .filter((g): g is NonNullable<typeof g> => g !== undefined),
    interval: formatInterval(decision.temporal),
    live: isOpen(decision.temporal),
    history: state.events.filter(
      (event) =>
        event.type === "LabelChanged" &&
        (event.payload as { nodeId?: string }).nodeId === id,
    ),
  };
}

