/**
 * RESTS ON / EXCLUDES — 6.2. ★ one of the three sections no competitor has.
 *
 * Phase 6 · sub-phase 6.2
 * Plan: plan/phase-6-presentation.md §6.2
 *
 * ---------------------------------------------------------------------------
 * LIVE LABELS, NOT THE LABEL STORED AT EXTRACTION TIME
 *
 * The label beside each premise is read from the labeller's current map. Rendering
 * `premise.label` instead would show "P-0005 no-deploy-infra (IN)" for a premise the log has since
 * falsified — which is precisely the sentence that must never appear, because it makes the entire
 * premise mechanism look decorative. The card is where a user checks whether a decision still holds,
 * and a stale label there is worse than no label.
 *
 * ---------------------------------------------------------------------------
 * EXCLUDES IS NOT A FOOTNOTE
 *
 * A non-empty OUT-list is what makes a justification NON-MONOTONIC, and it is what gate (c) fires
 * on. Most tools that record assumptions record only what must be TRUE; recording what must NOT be
 * true is the part that lets the system notice the world changing in the other direction. So
 * EXCLUDES gets its own block, its own dashed treatment, and its own sentence explaining that if any
 * of it becomes true the decision is invalidated.
 * ---------------------------------------------------------------------------
 */

import type { ReactElement } from "react";
import type { DecisionId, PremiseId } from "@/types/common";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import { isWorldObservable } from "@/ontology";
import { LabelBadge } from "../common/StatusBadge";

export interface PremiseEntry {
  readonly id: PremiseId;
  readonly text: string;
  readonly predicate: string;
  readonly type: string;
  readonly label: Labelled["label"];
  readonly observable: boolean;
}

export function premiseEntries(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): { restsOn: readonly PremiseEntry[]; excludes: readonly PremiseEntry[] } {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return { restsOn: [], excludes: [] };

  const restsOn: PremiseEntry[] = [];
  const excludes: PremiseEntry[] = [];
  const seenIn = new Set<PremiseId>();
  const seenOut = new Set<PremiseId>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seenIn.has(premiseId)) continue;
      seenIn.add(premiseId);
      const entry = entryFor(state, labels, premiseId);
      if (entry !== null) restsOn.push(entry);
    }

    for (const premiseId of justification.outList) {
      if (seenOut.has(premiseId)) continue;
      seenOut.add(premiseId);
      const entry = entryFor(state, labels, premiseId);
      if (entry !== null) excludes.push(entry);
    }
  }

  return { restsOn, excludes };
}

function entryFor(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  premiseId: PremiseId,
): PremiseEntry | null {
  const premise = state.premises.get(premiseId);
  if (premise === undefined) return null;

  return {
    id: premiseId,
    text: premise.text,
    predicate: premise.predicate,
    type: premise.type,
    /* Live label first; the stored one only if the labeller has no entry, which happens during a
     * partial fold and is reported rather than hidden. */
    label: labels.get(premiseId)?.label ?? premise.label,
    observable: isWorldObservable(premise.type),
  };
}

export function PremiseList({
  restsOn,
  excludes,
  onSelectPremise,
}: {
  restsOn: readonly PremiseEntry[];
  excludes: readonly PremiseEntry[];
  onSelectPremise?: (id: PremiseId) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <SectionLabel>rests on</SectionLabel>

        {restsOn.length === 0 ? (
          <div className="notice notice-warning" style={{ fontSize: 12, marginTop: 6 }}>
            Nothing recorded. This decision has no stated premises, so nothing can falsify it and
            nothing would tell you when to stop believing it — a gap in the log, not a decision that
            needs no assumptions.
          </div>
        ) : (
          <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {restsOn.map((entry) => (
              <PremiseRow key={entry.id} entry={entry} kind="in" onSelect={onSelectPremise} />
            ))}
          </ul>
        )}
      </div>

      {excludes.length > 0 ? (
        <div>
          <SectionLabel>excludes</SectionLabel>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            If any of these becomes true, the decision is invalidated. A non-empty exclusion list is
            what makes this justification non-monotonic, and it is what gate (c) watches.
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {excludes.map((entry) => (
              <PremiseRow key={entry.id} entry={entry} kind="out" onSelect={onSelectPremise} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PremiseRow({
  entry,
  kind,
  onSelect,
}: {
  entry: PremiseEntry;
  kind: "in" | "out";
  onSelect?: (id: PremiseId) => void;
}): ReactElement {
  const stale = entry.label === "OUT" && kind === "in";

  return (
    <li style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
      <span className="mono" style={{ fontSize: 11, color: kind === "out" ? "var(--label-unknown)" : "var(--text-faint)" }}>
        {kind === "in" ? "✓" : "✗"} {entry.id}
      </span>

      <button
        type="button"
        className="mono faint"
        style={{ fontSize: 10, border: "none", background: "none", cursor: "pointer", padding: 0 }}
        onClick={() => onSelect?.(entry.id)}
        title="Show this premise in the lattice"
      >
        {entry.type}.{entry.predicate}
      </button>

      <span style={{ fontSize: 12 }}>{entry.text}</span>

      <LabelBadge label={entry.label} />

      <span
        className="faint mono"
        style={{ fontSize: 9 }}
        title={
          entry.observable
            ? "WORLD-OBSERVABLE — a guard or a repo scan could falsify this without anyone telling the system."
            : "INTENT-BASED — only a human can retract this. No guard can check it."
        }
      >
        {entry.observable ? "observable" : "intent"}
      </span>

      {stale ? (
        <span style={{ fontSize: 11, color: "var(--edge-conflict)" }} title={LABEL_MEANING.OUT}>
          ⚠ this premise is OUT — the decision rests on something the log has falsified
        </span>
      ) : null}
    </li>
  );
}

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <div className="faint mono" style={{ fontSize: 10, letterSpacing: 0.7, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

export { SectionLabel };
export { LABEL_COLOUR };
