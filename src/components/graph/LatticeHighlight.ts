/**
 * Lattice highlighting — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 *
 * ---------------------------------------------------------------------------
 * "RENDER ONE CASCADE AT A TIME; NEVER THE WHOLE GRAPH UNFILTERED"
 *
 * Selecting a node computes the set that matters for it and dims everything else. That is the
 * anti-hairball rule applied to INTERACTION rather than to layout: the layout drops what should
 * never be drawn, and highlighting drops what should not be looked at right now.
 *
 * Dimming rather than hiding, deliberately. A node that disappears when you click its neighbour
 * makes the diagram feel unstable, and the viewer loses the spatial memory of where things were. A
 * node that fades keeps its position and its context, and the eye tracks what changed.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { LatticeLayout } from "./LatticeLayout";

export interface Highlight {
  /** The node that was clicked, or null when nothing is selected. */
  readonly origin: NodeId | null;
  /** Every node that stays at full opacity. */
  readonly nodes: ReadonlySet<NodeId>;
  /** Every edge that stays at full opacity, keyed `from\u0000to\u0000kind`. */
  readonly edges: ReadonlySet<string>;
}

export const NO_HIGHLIGHT: Highlight = { origin: null, nodes: new Set(), edges: new Set() };

export function edgeKey(from: NodeId, to: NodeId, kind: string): string {
  return `${from}\u0000${to}\u0000${kind}`;
}

/**
 * What matters for this node.
 *
 * For a PREMISE: every decision resting on it, transitively through `depends-on` — which is exactly
 * the cascade's blast radius, so clicking a premise previews what falsifying it would touch.
 *
 * For a DECISION: every premise holding it up, plus the decisions it depends on and the ones that
 * share its premises. Reading upward answers "what would have to change for this to stop being
 * true?", which is the question the whole product exists to answer.
 */
export function dependentsOf(state: GraphState, layout: LatticeLayout, origin: NodeId): Highlight {
  const nodes = new Set<NodeId>([origin]);
  const edges = new Set<string>();

  if (isPremise(origin)) {
    collectDownward(state, layout, origin as PremiseId, nodes, edges, new Set());
  } else {
    collectUpward(state, layout, origin as DecisionId, nodes, edges);
  }

  return { origin, nodes, edges };
}

/** Premise → decisions → their dependents, transitively. Depth-capped, because a cycle in
 *  `dependsOn` would otherwise loop forever and a highlight that hangs the tab is worse than one
 *  that is incomplete. */
function collectDownward(
  state: GraphState,
  layout: LatticeLayout,
  premiseId: PremiseId,
  nodes: Set<NodeId>,
  edges: Set<string>,
  visited: Set<NodeId>,
  depth = 0,
): void {
  if (depth > MAX_HIGHLIGHT_DEPTH) return;

  const direct = state.premiseToDecisions.get(premiseId) ?? [];

  for (const decisionId of direct) {
    if (!layout.nodes.has(decisionId)) continue;

    nodes.add(decisionId);
    edges.add(edgeKey(premiseId, decisionId, "supports"));
    edges.add(edgeKey(premiseId, decisionId, "excludes"));

    if (visited.has(decisionId)) continue;
    visited.add(decisionId);

    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;

    /* `dependsOn` and `sharesPremiseWith` are the two edges the cascade is allowed to follow. The
     * highlight follows exactly those and no others, so what you see lit up is what a falsification
     * would actually reach — not a superset that overstates the blast radius. */
    for (const next of decision.edges.dependsOn) {
      if (!layout.nodes.has(next)) continue;
      nodes.add(next);
      edges.add(edgeKey(decisionId, next, "depends-on"));
    }

    for (const next of decision.edges.sharesPremiseWith) {
      if (!layout.nodes.has(next)) continue;
      nodes.add(next);
    }
  }
}

/** Decision → the premises holding it up, and the decisions it depends on. */
function collectUpward(
  state: GraphState,
  layout: LatticeLayout,
  decisionId: DecisionId,
  nodes: Set<NodeId>,
  edges: Set<string>,
): void {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return;

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (!layout.nodes.has(premiseId)) continue;
      nodes.add(premiseId);
      edges.add(edgeKey(premiseId, decisionId, "supports"));
    }

    for (const premiseId of justification.outList) {
      if (!layout.nodes.has(premiseId)) continue;
      nodes.add(premiseId);
      edges.add(edgeKey(premiseId, decisionId, "excludes"));
    }
  }

  for (const next of decision.edges.dependsOn) {
    if (!layout.nodes.has(next)) continue;
    nodes.add(next);
    edges.add(edgeKey(decisionId, next, "depends-on"));
  }

  for (const next of decision.edges.conflictsWith) {
    if (!layout.nodes.has(next)) continue;
    nodes.add(next);
    edges.add(edgeKey(decisionId, next, "conflicts"));
  }

  for (const next of decision.edges.supersedes) {
    if (!layout.nodes.has(next)) continue;
    nodes.add(next);
    edges.add(edgeKey(decisionId, next, "supersedes"));
  }
}

/** Same depth cap as the cascade: 4. Matching it is deliberate — a highlight that reaches deeper
 *  than the cascade would show nodes lit up that a real falsification could never touch, which is
 *  the highlight lying about the mechanism. */
export const MAX_HIGHLIGHT_DEPTH = 4;

export function isPremise(id: NodeId): boolean {
  return id.startsWith("P-");
}

export type { Labelled };
