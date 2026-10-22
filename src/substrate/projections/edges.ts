/**
 * Edge projection: the dependency network.
 *
 * Phase 0 · sub-phase 0.2, consumed by Phase 2 (cascade) and Phase 6.6 (graph)
 *
 * ---------------------------------------------------------------------------
 * NOT EVERY EDGE IS A CASCADE PATH
 *
 * This is the distinction the whole reasoning layer depends on, and it is easy to
 * lose:
 *
 *   CASCADE PATHS     sharesPremiseWith, dependsOn
 *                     invalidation propagates along these, and stops at any node
 *                     with an independent surviving justification.
 *
 *   NEVER CASCADES    conflictsWith, related, supersedes/supersededBy
 *                     two decisions may conflict without either supporting the
 *                     other. Propagating along `conflictsWith` would turn one
 *                     contradiction into a graph-wide retraction, which is exactly
 *                     the over-retraction failure that gets a tool switched off.
 *
 * The lattice view draws all of them, in different styles, because a human needs
 * to see both. The cascade walks only the first group.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { GraphState } from "../graph-state";

export type EdgeKind =
  | "supersedes"
  | "supersededBy"
  | "conflictsWith"
  | "dependsOn"
  | "sharesPremiseWith"
  | "related";

export interface Edge {
  readonly from: DecisionId;
  readonly to: DecisionId;
  readonly kind: EdgeKind;
  /** The premise both decisions rest on, for `sharesPremiseWith`. This is what
   *  makes the edge EXPLAINABLE: hover it and the UI can say which assumption is
   *  shared, rather than drawing a line and calling it a relationship. */
  readonly viaPremiseId?: PremiseId;
  readonly viaPremiseText?: string;
}

/** Edges along which invalidation may propagate. */
export const CASCADE_EDGE_KINDS: readonly EdgeKind[] = ["sharesPremiseWith", "dependsOn"];

/** Edges that must NEVER carry a cascade. */
export const NON_CASCADE_EDGE_KINDS: readonly EdgeKind[] = [
  "supersedes",
  "supersededBy",
  "conflictsWith",
  "related",
];

export function isCascadeEdge(kind: EdgeKind): boolean {
  return CASCADE_EDGE_KINDS.includes(kind);
}

export function allEdges(state: GraphState): readonly Edge[] {
  const out: Edge[] = [];

  for (const decision of state.decisions.values()) {
    for (const kind of Object.keys(decision.edges) as EdgeKind[]) {
      for (const target of decision.edges[kind]) {
        out.push({ from: decision.id, to: target, kind });
      }
    }
  }

  return attachPremises(state, out);
}

/** Attach the shared premise to each `sharesPremiseWith` edge. */
function attachPremises(state: GraphState, edges: readonly Edge[]): readonly Edge[] {
  return edges.map((edge) => {
    if (edge.kind !== "sharesPremiseWith") return edge;

    const a = premisesOfDecision(state, edge.from);
    const b = premisesOfDecision(state, edge.to);
    for (const premiseId of a) {
      if (b.includes(premiseId)) {
        // The text is optional: a premise node may have been closed out and
        // pruned from the map. Absent text means the key is omitted, not
        // present-and-undefined.
        const viaPremiseText = state.premises.get(premiseId)?.text;
        return {
          ...edge,
          viaPremiseId: premiseId,
          ...(viaPremiseText === undefined ? {} : { viaPremiseText }),
        };
      }
    }
    return edge;
  });
}

export function edgesOf(state: GraphState, id: DecisionId, kind?: EdgeKind): readonly Edge[] {
  const decision = state.decisions.get(id);
  if (!decision) return [];

  const out: Edge[] = [];
  for (const edgeKind of Object.keys(decision.edges) as EdgeKind[]) {
    if (kind !== undefined && edgeKind !== kind) continue;
    for (const target of decision.edges[edgeKind]) {
      out.push({ from: id, to: target, kind: edgeKind });
    }
  }
  return attachPremises(state, out);
}

/** The neighbours a cascade may step to next. */
export function cascadeNeighbours(state: GraphState, id: DecisionId): readonly DecisionId[] {
  const decision = state.decisions.get(id);
  if (!decision) return [];
  return [...decision.edges.sharesPremiseWith, ...decision.edges.dependsOn];
}

/** Premises a decision rests on, from the justification side. */
export function premisesOfDecision(state: GraphState, id: DecisionId): readonly PremiseId[] {
  const out: PremiseId[] = [];
  for (const justificationId of state.decisions.get(id)?.justificationIds ?? []) {
    const justification = state.justifications.get(justificationId);
    if (!justification) continue;
    for (const premiseId of [...justification.inList, ...justification.outList]) {
      if (!out.includes(premiseId)) out.push(premiseId);
    }
  }
  return out;
}

/**
 * Connected components over CASCADE edges only.
 *
 * This is what the lattice view draws as clusters, and it is also the honest
 * answer to "if this premise died, what is affected?" — a component is the
 * maximal set of decisions that share assumptions.
 */
export function cascadeComponents(state: GraphState): readonly (readonly DecisionId[])[] {
  const adjacency = new Map<DecisionId, Set<DecisionId>>();

  for (const decision of state.decisions.values()) {
    let bucket = adjacency.get(decision.id);
    if (!bucket) {
      bucket = new Set();
      adjacency.set(decision.id, bucket);
    }
    for (const neighbour of cascadeNeighbours(state, decision.id)) bucket.add(neighbour);
  }

  const seen = new Set<DecisionId>();
  const components: DecisionId[][] = [];

  // Sorted start order so the component list is deterministic across replays.
  for (const start of [...adjacency.keys()].sort()) {
    if (seen.has(start)) continue;

    const component: DecisionId[] = [];
    const queue: DecisionId[] = [start];
    seen.add(start);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);

      for (const neighbour of adjacency.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }

    if (component.length > 1) components.push(component.sort());
  }

  return components.sort((a, b) => b.length - a.length);
}

/** The largest component. A single component containing most of the graph means
 *  premises are being over-merged — the resolution ladder is collapsing distinct
 *  assumptions into one node, and every decision looks connected to every other. */
export function largestComponent(state: GraphState): readonly DecisionId[] {
  return cascadeComponents(state)[0] ?? [];
}

/** Graph density over cascade edges, for the health panel. */
export function cascadeDensity(state: GraphState): number {
  const n = state.decisions.size;
  if (n < 2) return 0;
  const directed = allEdges(state).filter((e) => isCascadeEdge(e.kind)).length;
  return directed / (n * (n - 1));
}

/** Nodes with no cascade edges at all. These are the decisions that would survive
 *  ANY premise invalidation elsewhere, and they are the ones the cascade must not
 *  touch — the stop condition made visible. */
export function isolatedDecisions(state: GraphState): readonly Decision[] {
  const out: Decision[] = [];
  for (const decision of state.decisions.values()) {
    if (cascadeNeighbours(state, decision.id).length === 0) out.push(decision);
  }
  return out;
}

/** A path between two decisions over cascade edges, or null. Used to explain a
 *  cascade: "WLD-0003 fell because it shares `scale.single_user` with WLD-0001,
 *  which shares `deployment.local_only` with the invalidated premise." */
export function cascadePath(
  state: GraphState,
  from: DecisionId,
  to: DecisionId,
  maxDepth = 6,
): readonly DecisionId[] | null {
  if (from === to) return [from];

  const queue: DecisionId[][] = [[from]];
  const seen = new Set<DecisionId>([from]);

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined) break;
    if (path.length > maxDepth) continue;

    const last = path[path.length - 1];
    if (last === undefined) continue;

    for (const neighbour of cascadeNeighbours(state, last)) {
      if (seen.has(neighbour)) continue;
      const next = [...path, neighbour];
      if (neighbour === to) return next;
      seen.add(neighbour);
      queue.push(next);
    }
  }

  return null;
}
