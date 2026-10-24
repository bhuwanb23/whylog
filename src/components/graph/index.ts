/**
 * The graph components — Phase 6 · 6.6.
 *
 * The premise lattice is the signature visual, and the decision graph beside it is the picture every
 * competitor ships. Both are here because they answer different questions and neither subsumes the
 * other: the lattice shows what holds a decision UP, the graph shows what it was REPLACED BY.
 */

export {
  PremiseLattice,
  FLIP_INTERVAL_MS,
  SETTLE_MS,
  type PremiseLatticeProps,
} from "./PremiseLattice";
export { DecisionGraph, chainsOf, type SupersessionChain } from "./DecisionGraph";
export { PremiseNode, type PremiseNodeProps } from "./PremiseNode";
export {
  DecisionNode,
  DECISION_WIDTH,
  DECISION_HEIGHT,
  type DecisionNodeProps,
} from "./DecisionNode";
export { LatticeEdgeView, EdgeLegend, EDGE_VISUAL, type EdgeProps } from "./LatticeEdge";
export {
  layoutLattice,
  describeLayout,
  ringFor,
  radiusFor,
  COLUMN_WIDTH,
  PREMISE_ROW_HEIGHT,
  DECISION_ROW_HEIGHT,
  type LatticeLayout,
  type LatticeNode,
  type LatticeEdge,
  type LatticeEdgeKind,
  type LatticeNodeKind,
  type LayoutOptions,
} from "./LatticeLayout";
export {
  planCascade,
  stepAt,
  revealedAt,
  isPremiseId,
  describeAnimationPlan,
  type CascadeStep,
  type CascadeAnimationPlan,
} from "./CascadeAnimation";
export {
  dependentsOf,
  edgeKey,
  isPremise,
  MAX_HIGHLIGHT_DEPTH,
  NO_HIGHLIGHT,
  type Highlight,
} from "./LatticeHighlight";
export {
  reportHairball,
  describeHairball,
  DENSITY_LIMIT,
  type HairballReport,
} from "./AntiHairballFilter";
