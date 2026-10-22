/**
 * Label projection — the only writer of `LabelChanged` state.
 *
 * Phase 0 · sub-phase 0.2, consumed by Phase 2
 * Plan: plan/phase-2-truth-maintenance.md §2.3
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM justifications.ts
 *
 * `justifications.ts` DERIVES what a label should be. This module turns a
 * derivation into EVENTS. Nothing else in the codebase is allowed to construct a
 * `LabelChanged` payload, because a label change is the moment the system asserts
 * something about the user's decisions, and every such assertion must carry a
 * reason, a trigger and a gate.
 *
 * Concentrating the write path here is what makes the audit trail complete: ask
 * "why did WLD-0007 go OUT?" and the answer is a single event with a named
 * premise, a named justification and a named gate. Ask the same question of a
 * system that relabels nodes in place and there is nothing to read.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EventId, JustificationId, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { LabelChangedPayload } from "@/types/events";
import type { GraphState } from "../graph-state";
import { deriveLabel } from "./justifications";

/** Which gate caused the change. Recorded on the event so the false-positive
 *  metric can be broken down by mechanism — a structural gate that fires wrongly
 *  is a table bug; a semantic gate that fires wrongly is a threshold bug, and
 *  they are fixed in completely different places. */
export type LabelGate = "structural" | "semantic" | "premise" | "cascade";

export interface LabelChange {
  readonly nodeId: DecisionId | PremiseId;
  readonly from: DecisionLabel;
  readonly to: DecisionLabel;
  readonly gate: LabelGate;
  readonly triggerPremiseId?: PremiseId;
  readonly invalidJustificationId?: JustificationId;
  /** Becomes the event's mandatory `reason`. Never empty. */
  readonly reason: string;
}

/**
 * Compute every label change the current graph implies.
 *
 * Pure: reads the state, returns a list. The CALLER appends the events, in a
 * batch, so that a cascade produces one atomic commit rather than a sequence of
 * half-applied relabellings.
 */
export function pendingLabelChanges(
  state: GraphState,
  gate: LabelGate,
  triggerPremiseId?: PremiseId,
): readonly LabelChange[] {
  const changes: LabelChange[] = [];

  for (const decision of state.decisions.values()) {
    const derived = deriveLabel(state, decision);
    if (derived === decision.label) continue;

    const invalid = firstInvalidJustification(state, decision);
    changes.push({
      nodeId: decision.id,
      from: decision.label,
      to: derived,
      gate,
      ...(triggerPremiseId === undefined ? {} : { triggerPremiseId }),
      ...(invalid === null ? {} : { invalidJustificationId: invalid.id }),
      reason: explainChange(decision.id, decision.label, derived, invalid, triggerPremiseId, state),
    });
  }

  // Deterministic order: by node id. A cascade committed in a different order
  // produces a different hash chain, and two runs of the same reasoning must not.
  changes.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  return changes;
}

function firstInvalidJustification(
  state: GraphState,
  decision: { justificationIds: readonly JustificationId[] },
): { id: JustificationId } | null {
  for (const id of decision.justificationIds) {
    const justification = state.justifications.get(id);
    if (!justification) return { id };

    for (const premiseId of justification.inList) {
      const label = state.premises.get(premiseId)?.label;
      if (label !== "IN") return { id };
    }
    for (const premiseId of justification.outList) {
      if (state.premises.get(premiseId)?.label === "IN") return { id };
    }
  }
  return null;
}

function explainChange(
  decisionId: DecisionId,
  from: DecisionLabel,
  to: DecisionLabel,
  invalid: { id: JustificationId } | null,
  triggerPremiseId: PremiseId | undefined,
  state: GraphState,
): string {
  if (to === "UNFOUNDED") {
    return `${decisionId} moved ${from} -> UNFOUNDED: it has no justification reaching a premise node. This is a data-quality warning, not a claim that the decision is wrong.`;
  }

  if (triggerPremiseId !== undefined) {
    const text = state.premises.get(triggerPremiseId)?.text ?? String(triggerPremiseId);
    if (to === "OUT") {
      return `${decisionId} moved ${from} -> OUT because the premise "${text}" no longer holds${
        invalid ? ` and justification ${invalid.id} with it` : ""
      }.`;
    }
    return `${decisionId} moved ${from} -> ${to} following a change to the premise "${text}".`;
  }

  if (invalid) {
    return `${decisionId} moved ${from} -> ${to}: justification ${invalid.id} is no longer valid.`;
  }

  return `${decisionId} moved ${from} -> ${to}.`;
}

/** Build the event payload. `at`/`occurredAt`/`actor` come from the append
 *  context; the payload is what this module owns. */
export function toPayload(change: LabelChange): LabelChangedPayload {
  return {
    nodeId: change.nodeId,
    from: change.from,
    to: change.to,
    ...(change.invalidJustificationId === undefined
      ? {}
      : { invalidJustificationId: change.invalidJustificationId }),
    ...(change.triggerPremiseId === undefined ? {} : { triggerPremiseId: change.triggerPremiseId }),
    gate: change.gate,
  };
}

/** The label history of one node, oldest first, read back off the log. This is
 *  the node's audit trail and it is complete by construction. */
export function labelHistory(
  events: readonly { id: EventId; type: string; at: string; payload: unknown; reason: string }[],
  nodeId: DecisionId | PremiseId,
): readonly { at: string; from: DecisionLabel; to: DecisionLabel; reason: string; gate?: LabelGate }[] {
  const out: { at: string; from: DecisionLabel; to: DecisionLabel; reason: string; gate?: LabelGate }[] = [];

  for (const event of events) {
    if (event.type !== "LabelChanged") continue;
    const payload = event.payload as LabelChangedPayload;
    if (payload.nodeId !== nodeId) continue;
    out.push({
      at: event.at,
      from: payload.from,
      to: payload.to,
      reason: event.reason,
      ...(payload.gate === undefined ? {} : { gate: payload.gate }),
    });
  }

  return out;
}

/** How many decisions changed label per gate. Reported in the health panel: a
 *  gate that produces most of the churn is the gate to tune first. */
export function changesByGate(state: GraphState): Readonly<Record<LabelGate, number>> {
  const out: Record<LabelGate, number> = { structural: 0, semantic: 0, premise: 0, cascade: 0 };

  for (const event of state.events) {
    if (event.type !== "LabelChanged") continue;
    const gate = event.payload.gate;
    if (gate !== undefined) out[gate] += 1;
  }

  return out;
}
