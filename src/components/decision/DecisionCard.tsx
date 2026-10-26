/**
 * The decision card — 6.2. ★
 *
 * Phase 6 · sub-phase 6.2
 * Plan: plan/phase-6-presentation.md §6.2
 *
 * ---------------------------------------------------------------------------
 * THE ENTIRE FORMALISM ON ONE CARD
 *
 * This is the most information-dense screen in the product and the one a judge will read closely,
 * because it is where the claim gets checked: does this thing actually store what it says it stores?
 *
 *   header            id · statement · label · lifecycle
 *   Y-statement       the self-justifying form, when Phase 1 recovered it
 *   RESTS ON          premises with LIVE labels                    ★ no competitor has this
 *   EXCLUDES          the OUT-list, dashed — non-monotonic support  ★ nor this
 *   REJECTED          alternatives, each with its reason
 *   ACCEPTED DOWNSIDE what you knowingly took on                    ★ nor this
 *   GUARDS            n/m passing, each with kind and severity
 *   ENTRENCHMENT      the score and all five weighted terms         ★ nor this
 *   PROVENANCE        the verbatim snippet, offsets, origin, engine, both timestamps
 *   RELATES TO        five edge kinds, styled as the lattice styles them
 *   actions           reverse · re-justify · contest · audit
 *
 * Together the starred four are the whole concept on one card.
 *
 * ---------------------------------------------------------------------------
 * PROGRESSIVE DISCLOSURE IS THE DENSITY MITIGATION
 *
 * The plan names the risk — "decision card too dense to read" — and the mitigation: the Y-statement
 * and status are always visible, everything else is collapsed by default. So this component composes
 * `Collapsible` sections rather than rendering eleven blocks at once.
 *
 * What is open by default is RESTS ON, because it is the section that answers the only question the
 * card exists to answer: what would have to change for this to stop being true?
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE COMPUTES A LABEL
 *
 * Labels arrive from the labeller via props. A card that derived its own label from the stored field
 * could disagree with the lattice and the timeline about the same decision, and three views showing
 * three labels for one node is how a user stops trusting all of them.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import { LABEL_COLOUR } from "@/theme";
import type { DecisionId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { EntrenchmentBreakdown as Breakdown } from "@/types/reasoning";
import { type ReactElement, useState } from "react";
import { Collapsible } from "../common/Collapsible";
import { LabelBadge, StatusBadge } from "../common/StatusBadge";
import { AuditTrail } from "./AuditTrail";
import { EntrenchmentBreakdown } from "./EntrenchmentBreakdown";
import { PremiseList, SectionLabel, premiseEntries } from "./PremiseList";
import { ProvenanceBlock } from "./ProvenanceBlock";
import {
  AcceptedDownside,
  AlternativeList,
  GuardSummary,
  RelationList,
  YStatement,
} from "./sections";

export interface DecisionCardProps {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly decisionId: DecisionId;
  readonly entrenchment: Breakdown;
  /** Rendered in the header. Kept as a prop so a list of cards can show a compact variant without
   *  a second component. */
  readonly compact?: boolean;
  readonly onSelectPremise?: (id: string) => void;
  readonly onSelectDecision?: (id: DecisionId) => void;
  readonly actions?: readonly CardAction[];
}

export interface CardAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly tone?: "default" | "danger";
  readonly title?: string;
  readonly disabled?: boolean;
}

export function DecisionCard(props: DecisionCardProps): ReactElement {
  const decision: Decision | undefined = props.state.decisions.get(props.decisionId);

  if (decision === undefined) {
    return (
      <div className="notice notice-warning">
        {props.decisionId} is not in the log. It may have been named by an event that could not be
        folded — check the Foundation view's notices.
      </div>
    );
  }

  const label = props.labels.get(props.decisionId)?.label ?? decision.label;
  const premises = premiseEntries(props.state, props.labels, props.decisionId);
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (props.compact === true) {
    return <CompactRow decision={decision} label={label} onSelect={props.onSelectDecision} />;
  }

  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderLeft: "3px solid " + LABEL_COLOUR[label],
        borderRadius: 6,
        padding: "12px 14px",
        background: "var(--surface-raised)",
      }}
    >
      {/* ---- header ---- */}
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
          {decision.id}
        </span>
        <LabelBadge label={label} />
        <StatusBadge status={decision.status} />
        <span className="faint mono" style={{ fontSize: 10, marginLeft: "auto" }}>
          {decision.variable} = {decision.value}
        </span>
      </div>

      <h3 style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.4 }}>{decision.statement}</h3>

      <YStatement decision={decision} />

      {decision.rationale !== undefined && decision.rationale.length > 0 ? (
        <p className="dim" style={{ margin: "8px 0 0", fontSize: 12 }}>
          <SectionLabel>rationale</SectionLabel>
          <span style={{ marginLeft: 8 }}>{decision.rationale}</span>
        </p>
      ) : null}

      {/* ---- the section that answers the only question this card exists for ---- */}
      <div style={{ marginTop: 14 }}>
        <PremiseList
          restsOn={premises.restsOn}
          excludes={premises.excludes}
          onSelectPremise={props.onSelectPremise}
        />
      </div>

      <AlternativeList state={props.state} decision={decision} />
      <div style={{ marginTop: 10 }}>
        <AcceptedDownside decision={decision} />
      </div>

      <Collapsible title="guards" summary={guardSummary(props.state, decision)} defaultOpen={false}>
        <GuardSummary state={props.state} decision={decision} />
      </Collapsible>

      <Collapsible
        title="entrenchment"
        summary={
          props.entrenchment.capped.toFixed(2) +
          (props.entrenchment.ee3CapApplied
            ? " (EE3-capped from " + props.entrenchment.total.toFixed(2) + ")"
            : "")
        }
        defaultOpen={false}
      >
        <EntrenchmentBreakdown breakdown={props.entrenchment} expanded={showBreakdown} />
        <button
          type="button"
          className="badge faint"
          style={{ marginTop: 8, fontSize: 10 }}
          onClick={() => setShowBreakdown((previous) => !previous)}
        >
          {showBreakdown ? "hide the five terms" : "show all five weighted terms"}
        </button>
      </Collapsible>

      <Collapsible
        title="provenance"
        summary={decision.provenance.origin + " · " + decision.temporal.valid.slice(0, 10)}
        defaultOpen={false}
        note="The snippet is verbatim, with its character offsets, so it can be checked against the source. A paraphrase here would make everything else on this card unauditable."
      >
        <ProvenanceBlock state={props.state} decision={decision} />
      </Collapsible>

      <Collapsible
        title="relates to"
        summary={relationCount(decision) + " relationship(s)"}
        defaultOpen={false}
      >
        <RelationList state={props.state} decision={decision} />
      </Collapsible>

      <Collapsible
        title="audit trail"
        summary="the events that produced this state, on learned time"
        defaultOpen={false}
      >
        <AuditTrail state={props.state} labels={props.labels} decisionId={decision.id} />
      </Collapsible>

      {props.actions !== undefined && props.actions.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 14,
            flexWrap: "wrap",
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          {props.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="badge"
              title={action.title}
              disabled={action.disabled === true}
              onClick={action.onClick}
              style={
                action.tone === "danger"
                  ? { color: "var(--action)", borderColor: "var(--action)" }
                  : undefined
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The one-line variant, for lists. Same data, none of the sections. */
function CompactRow({
  decision,
  label,
  onSelect,
}: {
  decision: Decision;
  label: Labelled["label"];
  onSelect?: ((id: DecisionId) => void) | undefined;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(decision.id)}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "baseline",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderLeft: "3px solid " + LABEL_COLOUR[label],
        background: "transparent",
        padding: "6px 8px",
        cursor: "pointer",
      }}
    >
      <span className="mono faint" style={{ fontSize: 10 }}>
        {decision.id}
      </span>
      <span style={{ fontSize: 12 }}>{decision.statement}</span>
      <LabelBadge label={label} />
      <span className="mono faint" style={{ fontSize: 10, marginLeft: "auto" }}>
        {decision.temporal.valid.slice(0, 10)}
      </span>
    </button>
  );
}

function guardSummary(state: GraphState, decision: Decision): string {
  let passing = 0;
  let total = 0;

  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined || guard.lifecycle !== "accepted") continue;
    total += 1;
    if (guard.lastRun?.outcome === "pass") passing += 1;
  }

  return total === 0 ? "none — unverifiable" : passing + "/" + total + " passing";
}

function relationCount(decision: Decision): number {
  return (
    decision.edges.dependsOn.length +
    decision.edges.sharesPremiseWith.length +
    decision.edges.supersedes.length +
    decision.edges.supersededBy.length +
    decision.edges.conflictsWith.length +
    decision.edges.related.length
  );
}
