/**
 * AUDIT TRAIL — 6.2.
 *
 * Phase 6 · sub-phase 6.2
 * Plan: plan/phase-6-presentation.md §6.2
 *
 * ---------------------------------------------------------------------------
 * THE EVENTS THAT PRODUCED THE CURRENT STATE, ON LEARNED TIME
 *
 * The audit trail is ordered by LEARNED time while everything else in the product is ordered by
 * valid time. That is not an inconsistency; it is the one place where the two orderings answer
 * different questions and the distinction matters:
 *
 *   valid time    what was true when — the timeline, the lattice, the export
 *   learned time  what the system knew when, and in what order it came to know it — the audit
 *
 * An audit is about the SYSTEM'S reasoning history, so a decision learned today about something that
 * happened three weeks ago belongs at the end of the audit trail and near the start of the timeline.
 * Rendering the audit on valid time would make it impossible to answer "why did the label change on
 * Tuesday?", which is the only question an audit trail exists to answer.
 *
 * ---------------------------------------------------------------------------
 * DELEGATED TO THE REASONING LAYER
 *
 * `reasoning/audit.ts` walks the justification graph, finds the weak links and renders the prose.
 * This component renders its output rather than re-deriving it, for the same reason the export gate
 * delegates to gate (a): two implementations of one judgement eventually disagree, and an audit
 * trail that disagrees with the reasoning layer is worse than no audit trail.
 * ---------------------------------------------------------------------------
 */

import { useMemo, type ReactElement } from "react";
import type { DecisionId } from "@/types/common";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { auditDecision, renderSummary, renderTrail, renderWeakest } from "@/reasoning/audit";
import { SectionLabel } from "./PremiseList";

export function AuditTrail({
  state,
  labels,
  decisionId,
}: {
  state: GraphState;
  labels: ReadonlyMap<NodeId, Labelled>;
  decisionId: DecisionId;
}): ReactElement {
  /* Auditing walks the justification graph to a depth cap, so it is memoised on the state rather
   * than recomputed on every expand/collapse of the card. */
  const trail = useMemo(() => auditDecision(state, labels, decisionId), [state, labels, decisionId]);

  return (
    <div>
      <SectionLabel>audit trail</SectionLabel>

      <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 11, lineHeight: 1.6 }}>
        {renderSummary(state, trail)}
      </pre>

      {trail.weakLinks.length > 0 ? (
        <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
          <strong>Weakest links</strong>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 11 }}>
            {renderWeakest(trail)}
          </pre>
        </div>
      ) : (
        <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
          No weak links found. Every step from this decision down to a premise is supported by
          something the log holds.
        </div>
      )}

      <pre className="mono faint" style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 10.5, lineHeight: 1.55 }}>
        {renderTrail(trail)}
      </pre>

      <div className="faint" style={{ fontSize: 10, marginTop: 8 }}>
        Ordered by LEARNED time, unlike everything else in the product, which orders by valid time.
        An audit answers "when did the system come to know this?", so a decision learned today about
        something that happened three weeks ago belongs at the END of the trail and near the START of
        the timeline. Both orderings are correct; they answer different questions.
      </div>
    </div>
  );
}
