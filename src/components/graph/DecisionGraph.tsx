/**
 * The decision graph — 6.6. Supersession chains.
 *
 * Phase 6 · sub-phase 6.6
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE PICTURE EVERY COMPETITOR SHIPS, AND IT IS KEPT ANYWAY
 *
 * `ai-memory` draws decisions linked to decisions. That view is not wrong — it answers "what
 * replaced what?", which is a real question and one the lattice answers badly, because supersession
 * is an edge between two leaves and the lattice puts leaves in a row.
 *
 * So this is a second view over the same graph, not a fallback: the lattice shows what holds a
 * decision UP, this shows what a decision was REPLACED BY. Both are needed and neither subsumes the
 * other.
 *
 * ---------------------------------------------------------------------------
 * CHAINS, NOT A GRAPH
 *
 * Rendered as chains by variable, because supersession is linear in practice: a variable holds one
 * live decision at a time, and its history is a sequence. Drawing it as a general graph would
 * produce a tangle of one-node-per-event with no more information than a list gives, and a list is
 * readable.
 * ---------------------------------------------------------------------------
 */

import type { ReactElement } from "react";
import type { DecisionId } from "@/types/common";
import type { DecisionVariable } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import { LabelBadge, StatusBadge } from "../common/StatusBadge";

export interface SupersessionChain {
  readonly variable: DecisionVariable;
  /** Oldest first, ending with the live decision. */
  readonly decisions: readonly DecisionId[];
  readonly live: DecisionId | null;
}

/** Chains by variable, oldest first. */
export function chainsOf(state: GraphState): readonly SupersessionChain[] {
  const out: SupersessionChain[] = [];

  for (const [variable, decisionIds] of state.byVariable) {
    if (decisionIds.length < 2) continue;

    /* Ordered by VALID time, which is the ordering rule for everything displayed: a pasted
     * historical transcript would otherwise put a three-week-old decision at the end of its own
     * chain because it was learned last. */
    const sorted = [...decisionIds].sort((a, b) => {
      const decisionA = state.decisions.get(a);
      const decisionB = state.decisions.get(b);
      const atA = decisionA?.temporal.valid ?? "";
      const atB = decisionB?.temporal.valid ?? "";
      return atA === atB ? (a < b ? -1 : 1) : atA < atB ? -1 : 1;
    });

    const live = sorted.find((id) => {
      const decision = state.decisions.get(id);
      return decision !== undefined && decision.status !== "superseded" && decision.status !== "archived";
    }) ?? null;

    out.push({ variable, decisions: sorted, live });
  }

  /* Longest chain first: a variable that has been reversed four times is the interesting one, and
   * it is also the one most likely to harbour an unreconciled contradiction. */
  return out.sort((a, b) => b.decisions.length - a.decisions.length || (a.variable < b.variable ? -1 : 1));
}

export function DecisionGraph({
  state,
  labels,
  onSelect,
}: {
  state: GraphState;
  labels: ReadonlyMap<NodeId, Labelled>;
  onSelect?: (id: DecisionId) => void;
}): ReactElement {
  const chains = chainsOf(state);

  if (chains.length === 0) {
    return (
      <div className="dim" style={{ fontSize: 12 }}>
        No variable has more than one decision yet, so there are no supersession chains. A chain
        appears the first time a decision is reversed — which is the moment this view becomes the
        useful one, because "what replaced what, and why" is a question the lattice answers badly.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {chains.map((chain) => (
        <div key={chain.variable}>
          <div className="faint mono" style={{ fontSize: 11, marginBottom: 6, letterSpacing: 0.6 }}>
            {chain.variable} · {chain.decisions.length} decision(s)
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "stretch", flexWrap: "wrap" }}>
            {chain.decisions.map((decisionId, index) => {
              const decision = state.decisions.get(decisionId);
              if (decision === undefined) return null;

              const nodeLabel = labels.get(decisionId)?.label ?? decision.label;
              const isLive = chain.live === decisionId;

              return (
                <div key={decisionId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {index > 0 ? (
                    <span className="mono faint" style={{ fontSize: 12 }} title="superseded by">
                      →
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => onSelect?.(decisionId)}
                    title={LABEL_MEANING[nodeLabel]}
                    style={{
                      textAlign: "left",
                      border: "1px solid " + (isLive ? LABEL_COLOUR[nodeLabel] : "var(--border-strong)"),
                      borderLeft: "3px solid " + LABEL_COLOUR[nodeLabel],
                      borderRadius: 4,
                      padding: "6px 9px",
                      background: isLive ? "var(--surface-raised)" : "transparent",
                      opacity: isLive ? 1 : 0.62,
                      cursor: "pointer",
                      minWidth: 170,
                    }}
                  >
                    <div className="mono faint" style={{ fontSize: 10 }}>
                      {decisionId} · {decision.temporal.valid.slice(0, 10)}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        textDecoration: isLive ? "none" : "line-through",
                      }}
                    >
                      {decision.statement}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                      <LabelBadge label={nodeLabel} />
                      <StatusBadge status={decision.status} />
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="faint" style={{ fontSize: 11 }}>
        Ordered by VALID time, not learned time: a pasted historical transcript would otherwise put a
        three-week-old decision at the end of its own chain because it was learned last. Struck-through
        entries are superseded — retained as history, never hidden, and excluded from agent exports by
        default.
      </div>
    </div>
  );
}
