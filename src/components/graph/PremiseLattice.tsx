/**
 * The premise lattice — 6.6. ★ THE SIGNATURE VISUAL
 *
 * Phase 6 · sub-phase 6.6
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * ---------------------------------------------------------------------------
 * NOT A DECISION GRAPH
 *
 * A decision graph — what `ai-memory` ships — shows decisions linked to decisions. This is
 * BIPARTITE: assumptions are the load-bearing nodes, in columns by type across the top, and
 * decisions hang below them as leaves.
 *
 * Nobody in the category has that picture, because nobody stores that structure. It is not a
 * rendering choice layered over the same data; it is the data. A tool that records "we chose SQLite"
 * can draw a node. Only a tool that also records "given single-user, given no deploy infra, and
 * never if concurrent writers" can draw this — and the picture is the entire argument for why
 * storing the `given` matters.
 *
 * ---------------------------------------------------------------------------
 * THE CASCADE ANIMATION IS THE MONEY SHOT, AND IT IS REAL
 *
 * Click a premise → every decision resting on it highlights → falsify it → labels flip in sequence,
 * edges turn, survivors stay put. Ten seconds of animation communicates the concept better than any
 * paragraph.
 *
 * It animates a REAL cascade: `planCascade` diffs the labels before the falsification against the
 * labels after the reasoning cycle ran. Nothing is simulated. If the cascade stopped because a
 * decision had independent support, the animation shows it stopping there — which is the whole
 * point, and exactly the behaviour a simulated cascade would get wrong by showing everything flip.
 *
 * ---------------------------------------------------------------------------
 * RENDERED AS PLAIN SVG, NO LAYOUT LIBRARY
 *
 * The plan allows a force-layout library "for positioning only" and this uses none, because a force
 * layout is not reproducible: positions would settle differently each render, so two screenshots of
 * one log would differ and the animation would move the nodes being watched. `LatticeLayout` is
 * deterministic — columns by type, decisions at the barycentre of their premises — so the same log
 * always draws the same picture. Plain SVG keeps edges, labels and the animation fully controllable.
 *
 * ---------------------------------------------------------------------------
 * THE ANTI-HAIRBALL RULES ARE NOT OPTIONAL EXTRAS
 *
 * A lattice of 40 decisions with every premise drawn is unreadable, and an unreadable signature
 * visual is worse than none. So: one cascade at a time, superseded and `related` edges faded by
 * default behind a toggle, and single-dependent premises collapsed into their decision's card. All
 * three are applied in the LAYOUT, before rendering, so hidden nodes leave no gaps that look like
 * missing data.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { DecisionId, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import { label as labelGraph, describeReason, type Labelled, type NodeId } from "@/reasoning/labeller";
import { assertPremiseFalsified } from "@/store/reasoning";
import { useWhyLog } from "@/store/whylog";
import { LABEL_COLOUR } from "@/theme";
import { EdgeLegend, LatticeEdgeView } from "./LatticeEdge";
import { DecisionNode } from "./DecisionNode";
import { PremiseNode } from "./PremiseNode";
import {
  layoutLattice,
  describeLayout,
  type LatticeLayout,
  type LayoutOptions,
} from "./LatticeLayout";
import {
  FLIP_INTERVAL_MS,
  SETTLE_MS,
  isPremiseId,
  planCascade,
  revealedAt,
  stepAt,
  type CascadeAnimationPlan,
} from "./CascadeAnimation";
import { dependentsOf, type Highlight } from "./LatticeHighlight";

export interface PremiseLatticeProps {
  readonly state: GraphState;
  readonly includeSuperseded?: boolean;
  readonly includeRelated?: boolean;
  readonly focus?: readonly NodeId[];
  readonly onSelect?: (id: NodeId) => void;
  readonly height?: number;
}

export function PremiseLattice(props: PremiseLatticeProps): ReactElement {
  const labels = useMemo(() => labelGraph(props.state).labels, [props.state]);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [plan, setPlan] = useState<CascadeAnimationPlan | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [falsifyFor, setFalsifyFor] = useState<PremiseId | null>(null);
  const [observation, setObservation] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const beforeRef = useRef<ReadonlyMap<NodeId, Labelled> | null>(null);
  const timerRef = useRef<number | null>(null);

  const layout: LatticeLayout = useMemo(() => {
    const options: LayoutOptions = {
      includeSuperseded: props.includeSuperseded ?? showHidden,
      includeRelated: props.includeRelated ?? showHidden,
      ...(props.focus === undefined ? {} : { focus: props.focus }),
    };
    return layoutLattice(props.state, labels, options);
  }, [props.state, labels, props.includeSuperseded, props.includeRelated, props.focus, showHidden]);

  const highlight: Highlight = useMemo(
    () => (selected === null ? { origin: null, nodes: new Set(), edges: new Set() } : dependentsOf(props.state, layout, selected)),
    [selected, props.state, layout],
  );

  /* ---- the animation clock ---- */
  useEffect(() => {
    if (plan === null) return;

    const started = Date.now();
    timerRef.current = window.setInterval(() => {
      const now = Date.now() - started;
      setElapsed(now);
      if (now >= plan.totalMs) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 60);

    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [plan]);

  const revealed = useMemo(() => (plan === null ? new Set<NodeId>() : revealedAt(plan, elapsed)), [plan, elapsed]);
  const currentStep = plan === null ? null : stepAt(plan, elapsed);

  const select = useCallback(
    (id: string) => {
      const nodeId = id as NodeId;
      setSelected((previous) => (previous === nodeId ? null : nodeId));
      props.onSelect?.(nodeId);
    },
    [props],
  );

  /** Falsify the selected premise and animate what the reasoning layer actually does to it. */
  const falsify = async (premiseId: PremiseId): Promise<void> => {
    const text = observation.trim();
    if (text.length === 0) {
      setNote("Say what you observed. A falsification with no observation is an opinion, and the log records observations.");
      return;
    }

    setBusy(premiseId);
    setNote(null);

    /* Snapshot BEFORE. The animation is a diff, and a diff needs both sides. */
    beforeRef.current = labelGraph(currentGraph()).labels;

    const outcome = await assertPremiseFalsified(premiseId, text);
    setBusy(null);

    if (!outcome.ok) {
      setNote(outcome.error);
      beforeRef.current = null;
      return;
    }

    const before = beforeRef.current;
    beforeRef.current = null;
    if (before === null) return;

    /* Re-read the graph AFTER the cycle ran. The animation shows what happened, not what was
     * expected to happen. */
    const graphAfter = currentGraph();
    const after = labelGraph(graphAfter);

    const radius = blastRadius(graphAfter, premiseId);
    /* `describeReason` needs the graph to name the premise that failed, so it is called with the
     * AFTER graph — the reasons describe the world the cascade produced, not the one it started
     * from. */
    const next = planCascade(before, after.labels, premiseId, radius, (_node, _label, reason) =>
      describeReason(reason, graphAfter),
    );

    setPlan(next);
    setElapsed(0);
    setObservation("");
    setFalsifyFor(null);
    setNote(
      next.steps.length === 0
        ? "Falsified " + premiseId + ". Nothing flipped: " + (next.survivors.length > 0
            ? next.survivors.length + " node(s) were in the blast radius and every one survived, because each has support that does not depend on this premise."
            : "nothing depended on it.")
        : "Falsified " + premiseId + ". " + next.steps.length + " label(s) flipped and " +
          next.survivors.length + " survived. The animation shows the real diff, not a simulation.",
    );
  };

  const selectedPremise = selected !== null && isPremiseId(selected) ? (selected as PremiseId) : null;
  const selectedNode = selected === null ? null : layout.nodes.get(selected);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <EdgeLegend />
        <label className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />{" "}
          show superseded and topical edges
        </label>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-sunken)" }}>
        <svg
          width={Math.max(layout.width, 480)}
          height={props.height ?? Math.max(320, layout.height)}
          role="img"
          aria-label="Premise lattice: assumptions as load-bearing nodes, decisions hanging below them"
        >
          {/* column headers */}
          {layout.columns.map((column) => (
            <g key={column.type} transform={"translate(" + column.x + ",26)"}>
              <text textAnchor="middle" className="mono" style={{ fontSize: 10, fill: "var(--text-faint)", letterSpacing: 0.6 }}>
                {column.type.toUpperCase()}
              </text>
              <text textAnchor="middle" dy={12} className="mono" style={{ fontSize: 9, fill: "var(--text-faint)" }}>
                {column.count}
              </text>
            </g>
          ))}

          {/* the band separator: premises above, decisions below. The bipartite structure is
              drawn, not merely implied. */}
          <line
            x1={0}
            x2={Math.max(layout.width, 480)}
            y1={bandY(layout)}
            y2={bandY(layout)}
            stroke="var(--border)"
            strokeDasharray="3 5"
          />
          <text x={8} y={bandY(layout) - 6} className="mono" style={{ fontSize: 9, fill: "var(--text-faint)" }}>
            PREMISES — the assumptions
          </text>
          <text x={8} y={bandY(layout) + 14} className="mono" style={{ fontSize: 9, fill: "var(--text-faint)" }}>
            DECISIONS — what hangs off them
          </text>

          {/* edges first, so nodes draw on top */}
          {layout.edges.map((edge) => {
            const from = layout.nodes.get(edge.from);
            const to = layout.nodes.get(edge.to);
            if (from === undefined || to === undefined) return null;

            const key = edge.from + "\u0000" + edge.to + "\u0000" + edge.kind;
            const isHighlighted = highlight.edges.has(key);

            /* An edge turns red when the node it feeds has flipped in this animation. Red means an
             * action is available, and a decision that just lost its support is exactly that. */
            const turnedRed = revealed.has(edge.to) && currentStep !== null;

            return (
              <LatticeEdgeView
                key={key}
                edge={edge}
                from={from}
                to={to}
                highlighted={isHighlighted}
                dimmed={selected !== null && !isHighlighted && !highlight.nodes.has(edge.from) && !highlight.nodes.has(edge.to)}
                turnedRed={turnedRed}
              />
            );
          })}

          {/* premise nodes */}
          {[...layout.nodes.values()]
            .filter((node) => node.kind === "premise")
            .map((node) => {
              const premise = props.state.premises.get(node.id as PremiseId);
              if (premise === undefined) return null;

              return (
                <PremiseNode
                  key={node.id}
                  node={node}
                  predicate={premise.predicate}
                  type={premise.type}
                  selected={selected === node.id}
                  highlighted={highlight.nodes.has(node.id)}
                  dimmed={selected !== null && !highlight.nodes.has(node.id)}
                  flipping={currentStep !== null && currentStep.node === node.id}
                  onSelect={select}
                />
              );
            })}

          {/* decision nodes */}
          {[...layout.nodes.values()]
            .filter((node) => node.kind === "decision")
            .map((node) => {
              const decision = props.state.decisions.get(node.id as DecisionId);
              if (decision === undefined) return null;

              return (
                <DecisionNode
                  key={node.id}
                  node={node}
                  status={decision.status}
                  selected={selected === node.id}
                  highlighted={highlight.nodes.has(node.id)}
                  dimmed={selected !== null && !highlight.nodes.has(node.id)}
                  flipping={currentStep !== null && currentStep.node === node.id}
                  onSelect={select}
                />
              );
            })}
        </svg>
      </div>

      <pre className="mono faint" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 10 }}>
        {describeLayout(layout)}
      </pre>

      {/* ---- the cascade, live ---- */}
      {currentStep !== null ? (
        <div
          className="notice notice-info"
          style={{ marginTop: 10, borderLeft: "3px solid " + LABEL_COLOUR[currentStep.to], fontSize: 12 }}
        >
          <strong>
            {currentStep.node}: {currentStep.from} → {currentStep.to}
          </strong>{" "}
          ({currentStep.order + 1} of {plan?.steps.length ?? 0})
          <div className="dim" style={{ marginTop: 4 }}>
            {currentStep.reason}
          </div>
        </div>
      ) : null}

      {plan !== null && elapsed >= plan.totalMs ? (
        <div className="notice notice-info" style={{ marginTop: 10, fontSize: 12 }}>
          Cascade settled. {plan.steps.length} label(s) flipped, {plan.survivors.length} survived.
          {plan.survivors.length > 0 ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {plan.survivors.map((survivor) => (
                <li key={survivor.node}>
                  <span className="mono">{survivor.node}</span> — {survivor.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {note !== null ? (
        <div className="notice notice-info" style={{ marginTop: 10, fontSize: 12 }}>
          {note}
        </div>
      ) : null}

      {/* ---- the selected node, and the falsify composer ---- */}
      {selectedNode !== undefined && selectedNode !== null ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div style={{ fontSize: 12 }}>
            <span className="mono faint">{selectedNode.id}</span>{" "}
            <span className="badge" style={{ color: LABEL_COLOUR[selectedNode.label] }}>
              {selectedNode.label}
            </span>{" "}
            {selectedNode.text}
          </div>

          {selectedNode.kind === "premise" ? (
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              {selectedNode.dependents} decision(s) rest on this premise. Falsifying it puts every
              one of them in play — and the ones with independent support will survive, which is the
              difference between a truth-maintenance system and a house of cards.
            </div>
          ) : (
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              {selectedNode.collapsedPremises.length > 0
                ? selectedNode.collapsedPremises.length + " premise(s) collapsed into this card: " + selectedNode.collapsedPremises.join(", ") + ". A premise supporting exactly one decision adds a node and an edge to say what the card already says."
                : "Every premise this decision rests on is drawn above it."}
            </div>
          )}

          {selectedPremise !== null ? (
            <div style={{ marginTop: 10 }}>
              {falsifyFor === selectedPremise ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <textarea
                    value={observation}
                    rows={2}
                    onChange={(event) => setObservation(event.target.value)}
                    placeholder='what you observed, e.g. "there are four of us on it now and two edit decisions at the same time"'
                    style={{ flex: 1, minWidth: 260, fontSize: 12 }}
                  />
                  <button
                    type="button"
                    className="badge"
                    disabled={busy !== null}
                    onClick={() => void falsify(selectedPremise)}
                  >
                    {busy === selectedPremise ? "Running the cycle…" : "Falsify and watch"}
                  </button>
                  <button type="button" className="badge faint" onClick={() => setFalsifyFor(null)}>
                    cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="badge" onClick={() => setFalsifyFor(selectedPremise)}>
                  Falsify this premise
                </button>
              )}

              <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                This runs the real Phase 2 cycle — assertion, labelling, backtracking, cascade,
                entrenchment, adjudication — and animates the label diff it produces. It appends
                events, so it is not a preview.
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="faint" style={{ marginTop: 10, fontSize: 11 }}>
          Click a premise to see everything resting on it. Click a decision to see what holds it up.
        </div>
      )}
    </div>
  );
}

/** The y of the band separator, derived from the layout rather than hardcoded so it tracks the
 *  premise column depth. */
function bandY(layout: LatticeLayout): number {
  const decisionYs = [...layout.nodes.values()].filter((node) => node.kind === "decision").map((node) => node.y);
  const premiseYs = [...layout.nodes.values()].filter((node) => node.kind === "premise").map((node) => node.y);

  const lowestPremise = premiseYs.length === 0 ? 56 : Math.max(...premiseYs);
  const highestDecision = decisionYs.length === 0 ? lowestPremise + 90 : Math.min(...decisionYs);

  return (lowestPremise + highestDecision) / 2;
}

/** Every node the cascade could reach from this premise. Passed to `planCascade` as the blast
 *  radius so survivors can be named — a survivor is only meaningful against the set it survived. */
function blastRadius(state: GraphState, premiseId: PremiseId): readonly NodeId[] {
  const out: NodeId[] = [premiseId];
  const direct = state.premiseToDecisions.get(premiseId) ?? [];

  for (const decisionId of direct) {
    out.push(decisionId);
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;
    for (const dependent of decision.edges.dependsOn) out.push(dependent);
    for (const dependent of decision.edges.sharesPremiseWith) out.push(dependent);
  }

  return [...new Set(out)];
}

/**
 * The CURRENT graph, read at call time rather than captured from props.
 *
 * The falsification mutates the log through the store, so `props.state` is the graph from before the
 * cycle ran. Animating against that would show the labels the viewer already saw — the opposite of
 * the point. Reading through the store at call time is what makes the animation a diff of reality
 * rather than a diff of a snapshot.
 */
function currentGraph(): GraphState {
  return useWhyLog.getState().state;
}

export { FLIP_INTERVAL_MS, SETTLE_MS };
