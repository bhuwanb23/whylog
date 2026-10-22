/**
 * The lattice layout — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * ---------------------------------------------------------------------------
 * POSITIONING ONLY, AND DELIBERATELY NOT A FORCE LAYOUT
 *
 * The plan's implementation note allows a force-layout library "for positioning only". This uses
 * none, for a reason that matters more than aesthetics: **a force layout is not reproducible.**
 * Node positions would settle differently on each render, so two screenshots of the same log would
 * differ, a cascade animation would move nodes the user is trying to watch, and "the lattice at
 * time T" in the time machine would not look like the lattice they remember.
 *
 * A deterministic column layout gives the same picture every time. That is what makes the visual
 * usable as evidence rather than decoration.
 *
 * ---------------------------------------------------------------------------
 * THE BIPARTITE STRUCTURE IS THE LAYOUT, NOT AN ANNOTATION
 *
 * Premises occupy the top band, in COLUMNS BY TYPE, in `PREMISE_COLUMN_ORDER`. Decisions hang
 * below as leaves, positioned at the BARYCENTRE of the premises they rest on.
 *
 * Two consequences, both intended:
 *
 *   1. The two kinds never share a row, so the graph reads as bipartite without any label saying
 *      so — which is the point of giving premises circles and decisions rounded squares.
 *   2. Barycentre placement minimises edge crossing for free. A decision resting on `scale` and
 *      `deployment` sits between those two columns, so its edges are short and do not cross the
 *      whole diagram.
 *
 * ---------------------------------------------------------------------------
 * THE ANTI-HAIRBALL RULES ARE APPLIED HERE, BEFORE RENDERING
 *
 * Filtering at render time means the layout still reserves space for what is hidden, leaving gaps
 * that look like missing data. Doing it here means the layout is computed over what will actually
 * be drawn:
 *
 *   · premises with a SINGLE dependent decision are collapsed into that decision's card
 *   · superseded and archived decisions are dropped unless explicitly requested
 *   · `related` edges are dropped unless requested — they are topical, never structural, and
 *     drawing them is how a lattice becomes a hairball
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { DecisionLabel, PremiseType } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { PREMISE_COLUMN_ORDER, PREMISE_RING } from "@/theme";

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

export const COLUMN_WIDTH = 168;
export const PREMISE_ROW_HEIGHT = 74;
export const DECISION_ROW_HEIGHT = 62;
export const TOP_MARGIN = 56;
export const PREMISE_BAND_HEIGHT = 4;
export const LEFT_MARGIN = 24;

export type LatticeNodeKind = "premise" | "decision";

export interface LatticeNode {
  readonly id: NodeId;
  readonly kind: LatticeNodeKind;
  readonly x: number;
  readonly y: number;
  readonly label: DecisionLabel;
  readonly text: string;
  readonly column: PremiseType | null;
  /** Premises only: how many decisions hang off this one. Drives the radius, so load-bearing
   *  nodes LOOK load-bearing. */
  readonly dependents: number;
  /** Decisions only: premises collapsed into this card rather than drawn as nodes. */
  readonly collapsedPremises: readonly PremiseId[];
}

export type LatticeEdgeKind = "supports" | "excludes" | "depends-on" | "supersedes" | "conflicts";

export interface LatticeEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: LatticeEdgeKind;
}

export interface LatticeLayout {
  readonly nodes: ReadonlyMap<NodeId, LatticeNode>;
  readonly edges: readonly LatticeEdge[];
  readonly width: number;
  readonly height: number;
  /** Column headers, in draw order, with the x of their centre. */
  readonly columns: readonly { type: PremiseType; x: number; count: number }[];
  readonly premiseCount: number;
  readonly decisionCount: number;
  readonly collapsedPremiseCount: number;
  readonly droppedDecisionCount: number;
}

export interface LayoutOptions {
  readonly includeSuperseded?: boolean;
  readonly includeRelated?: boolean;
  /** Restrict to one cascade: only these decisions and the premises feeding them are laid out.
   *  The plan's rule — render ONE cascade at a time, never the whole graph unfiltered. */
  readonly focus?: readonly NodeId[];
}

/* -------------------------------------------------------------------------- */
/* The layout                                                                 */
/* -------------------------------------------------------------------------- */

export function layoutLattice(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  options?: LayoutOptions,
): LatticeLayout {
  const includeSuperseded = options?.includeSuperseded ?? false;
  const includeRelated = options?.includeRelated ?? false;
  const focus = options?.focus === undefined ? null : new Set(options.focus);

  /* ---- 1. which decisions are in ---- */
  const decisions: DecisionId[] = [];
  let droppedDecisions = 0;

  for (const decision of state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") {
      droppedDecisions += 1;
      if (!includeSuperseded) continue;
    }
    if (focus !== null && !focus.has(decision.id)) continue;
    decisions.push(decision.id);
  }

  /* ---- 2. premise → decisions, restricted to those decisions ---- */
  const supports = new Map<PremiseId, DecisionId[]>();
  const excludes = new Map<PremiseId, DecisionId[]>();
  const wanted = new Set(decisions);

  for (const decisionId of decisions) {
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;

    for (const justificationId of decision.justificationIds) {
      const justification = state.justifications.get(justificationId);
      if (justification === undefined) continue;

      for (const premiseId of justification.inList) {
        const list = supports.get(premiseId);
        if (list === undefined) supports.set(premiseId, [decisionId]);
        else if (!list.includes(decisionId)) list.push(decisionId);
      }

      for (const premiseId of justification.outList) {
        const list = excludes.get(premiseId);
        if (list === undefined) excludes.set(premiseId, [decisionId]);
        else if (!list.includes(decisionId)) list.push(decisionId);
      }
    }
  }

  /* ---- 3. collapse single-dependent premises into their decision ----
   * A premise supporting exactly one decision adds a node and an edge to say something the
   * decision's card already says. Collapsing it is the difference between a lattice and a
   * hairball, and it is why the shared premises — the load-bearing ones — are what remains
   * visible. */
  const collapsed = new Map<DecisionId, PremiseId[]>();
  const drawnPremises: PremiseId[] = [];
  let collapsedCount = 0;

  const allPremiseIds = new Set<PremiseId>([...supports.keys(), ...excludes.keys()]);

  for (const premiseId of allPremiseIds) {
    const inList = supports.get(premiseId) ?? [];
    const outList = excludes.get(premiseId) ?? [];
    const total = new Set([...inList, ...outList]).size;

    if (total === 1) {
      const only = inList[0] ?? outList[0];
      if (only !== undefined) {
        const existing = collapsed.get(only);
        if (existing === undefined) collapsed.set(only, [premiseId]);
        else existing.push(premiseId);
        collapsedCount += 1;
        continue;
      }
    }

    drawnPremises.push(premiseId);
  }

  /* ---- 4. premise positions: columns by type, stacked within a column ---- */
  const nodes = new Map<NodeId, LatticeNode>();
  const columnOf = new Map<PremiseType, PremiseId[]>();

  for (const premiseId of drawnPremises) {
    const premise = state.premises.get(premiseId);
    if (premise === undefined) continue;

    const type = columnKey(premise.type);
    const list = columnOf.get(type);
    if (list === undefined) columnOf.set(type, [premiseId]);
    else list.push(premiseId);
  }

  /* Columns appear in the fixed order from theme.ts, so the picture is stable across renders and
   * screenshots. Empty columns are skipped rather than drawn as gaps. */
  const orderedTypes: PremiseType[] = [];
  for (const type of PREMISE_COLUMN_ORDER) {
    if ((columnOf.get(type) ?? []).length > 0) orderedTypes.push(type);
  }
  for (const type of columnOf.keys()) {
    if (!orderedTypes.includes(type)) orderedTypes.push(type);
  }

  const premiseX = new Map<PremiseId, number>();
  let maxRows = 0;

  orderedTypes.forEach((type, columnIndex) => {
    const members = columnOf.get(type) ?? [];
    /* Sorted by dependent count descending, so the most load-bearing premise in a column is at the
     * top where the eye lands first. Ties break by id for determinism. */
    const sorted = [...members].sort((a, b) => {
      const byCount = dependentCount(a, b, supports, excludes);
      return byCount !== 0 ? byCount : a < b ? -1 : 1;
    });

    maxRows = Math.max(maxRows, sorted.length);

    sorted.forEach((premiseId, row) => {
      const premise = state.premises.get(premiseId);
      if (premise === undefined) return;

      const x = LEFT_MARGIN + columnIndex * COLUMN_WIDTH + COLUMN_WIDTH / 2;
      const y = TOP_MARGIN + row * PREMISE_ROW_HEIGHT;
      premiseX.set(premiseId, x);

      nodes.set(premiseId, {
        id: premiseId,
        kind: "premise",
        x,
        y,
        label: labels.get(premiseId)?.label ?? premise.label,
        text: premise.text,
        column: type,
        dependents: new Set([...(supports.get(premiseId) ?? []), ...(excludes.get(premiseId) ?? [])]).size,
        collapsedPremises: [],
      });
    });
  });

  /* ---- 5. decision positions: barycentre of the premises they rest on ---- */
  const decisionY = TOP_MARGIN + Math.max(1, maxRows) * PREMISE_ROW_HEIGHT + PREMISE_BAND_HEIGHT * PREMISE_ROW_HEIGHT;

  const positioned = decisions
    .map((decisionId) => {
      const feeding = [...(feedingPremises(decisionId, supports)), ...(feedingPremises(decisionId, excludes))]
        .filter((premiseId) => premiseX.has(premiseId))
        .map((premiseId) => premiseX.get(premiseId) as number);

      const barycentre =
        feeding.length === 0
          ? null
          : feeding.reduce((total, value) => total + value, 0) / feeding.length;

      return { decisionId, barycentre };
    })
    /* Decisions with no drawn premise go last, to the right: they are the unverifiable ones, and
     * clustering them together makes the gap visible instead of scattering it through the diagram. */
    .sort((a, b) => {
      if (a.barycentre === null && b.barycentre === null) return a.decisionId < b.decisionId ? -1 : 1;
      if (a.barycentre === null) return 1;
      if (b.barycentre === null) return -1;
      return a.barycentre - b.barycentre || (a.decisionId < b.decisionId ? -1 : 1);
    });

  /* Barycentre placement can put two decisions at the same x. Spreading them by index within a
   * tolerance keeps edges short without letting nodes overlap. */
  const decisionX = new Map<DecisionId, number>();
  let cursor = LEFT_MARGIN + COLUMN_WIDTH / 2;

  positioned.forEach((entry, index) => {
    const target = entry.barycentre ?? LEFT_MARGIN + Math.max(1, orderedTypes.length) * COLUMN_WIDTH + COLUMN_WIDTH / 2 + index * 40;
    const x = Math.max(cursor, target);
    cursor = x + 120;
    decisionX.set(entry.decisionId, x);

    const decision = state.decisions.get(entry.decisionId);
    if (decision === undefined) return;

    nodes.set(entry.decisionId, {
      id: entry.decisionId,
      kind: "decision",
      x,
      y: decisionY,
      label: labels.get(entry.decisionId)?.label ?? decision.label,
      text: decision.statement,
      column: null,
      dependents: 0,
      collapsedPremises: collapsed.get(entry.decisionId) ?? [],
    });
  });

  /* ---- 6. edges ---- */
  const edges: LatticeEdge[] = [];

  for (const [premiseId, decisionIds] of supports) {
    if (!nodes.has(premiseId)) continue;
    for (const decisionId of decisionIds) {
      if (!nodes.has(decisionId)) continue;
      edges.push({ from: premiseId, to: decisionId, kind: "supports" });
    }
  }

  for (const [premiseId, decisionIds] of excludes) {
    if (!nodes.has(premiseId)) continue;
    for (const decisionId of decisionIds) {
      if (!nodes.has(decisionId)) continue;
      edges.push({ from: premiseId, to: decisionId, kind: "excludes" });
    }
  }

  for (const decisionId of decisions) {
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;

    for (const other of decision.edges.dependsOn) {
      if (nodes.has(other)) edges.push({ from: decisionId, to: other, kind: "depends-on" });
    }
    for (const other of decision.edges.supersedes) {
      if (nodes.has(other)) edges.push({ from: decisionId, to: other, kind: "supersedes" });
    }
    for (const other of decision.edges.conflictsWith) {
      if (nodes.has(other)) edges.push({ from: decisionId, to: other, kind: "conflicts" });
    }
    if (includeRelated) {
      for (const other of decision.edges.related) {
        if (nodes.has(other)) edges.push({ from: decisionId, to: other, kind: "depends-on" });
      }
    }
  }

  const columns = orderedTypes.map((type, index) => ({
    type,
    x: LEFT_MARGIN + index * COLUMN_WIDTH + COLUMN_WIDTH / 2,
    count: (columnOf.get(type) ?? []).length,
  }));

  const width = LEFT_MARGIN * 2 + Math.max(1, orderedTypes.length) * COLUMN_WIDTH;
  const height = decisionY + DECISION_ROW_HEIGHT * 2;

  return {
    nodes,
    edges,
    width,
    height,
    columns,
    premiseCount: drawnPremises.length,
    decisionCount: decisions.length,
    collapsedPremiseCount: collapsedCount,
    droppedDecisionCount: includeSuperseded ? 0 : droppedDecisions,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function columnKey(type: PremiseType): PremiseType {
  return (PREMISE_COLUMN_ORDER as readonly string[]).includes(type) ? type : "requirement";
}

function dependentCount(
  a: PremiseId,
  b: PremiseId,
  supports: ReadonlyMap<PremiseId, DecisionId[]>,
  excludes: ReadonlyMap<PremiseId, DecisionId[]>,
): number {
  const countA = new Set([...(supports.get(a) ?? []), ...(excludes.get(a) ?? [])]).size;
  const countB = new Set([...(supports.get(b) ?? []), ...(excludes.get(b) ?? [])]).size;
  return countB - countA;
}

function* feedingPremises(
  decisionId: DecisionId,
  index: ReadonlyMap<PremiseId, DecisionId[]>,
): Generator<PremiseId> {
  for (const [premiseId, decisionIds] of index) {
    if (decisionIds.includes(decisionId)) yield premiseId;
  }
}

/** The ring style for a premise type: solid when the world could falsify it, dashed when only a
 *  human can. Drawn on the node, so the difference between a guardable assumption and an intent is
 *  visible without reading a tooltip. */
export function ringFor(type: PremiseType | null): "solid" | "dashed" {
  if (type === null) return "solid";
  return PREMISE_RING[type] === "dashed" ? "dashed" : "solid";
}

/** Premise radius from dependent count. Load-bearing nodes look load-bearing — the plan's own
 *  words, and the reason the lattice reads at a glance rather than needing a legend. */
export function radiusFor(dependents: number): number {
  return Math.min(22, 9 + dependents * 3);
}

export function describeLayout(layout: LatticeLayout): string {
  return [
    layout.premiseCount + " premise node(s) in " + layout.columns.length + " type column(s), " +
      layout.decisionCount + " decision(s) below.",
    layout.collapsedPremiseCount > 0
      ? layout.collapsedPremiseCount + " premise(s) collapsed into their decision's card — a premise supporting exactly one decision adds a node and an edge to say what the card already says."
      : "No premises collapsed.",
    layout.droppedDecisionCount > 0
      ? layout.droppedDecisionCount + " superseded/archived decision(s) hidden. Toggle to show them."
      : "",
    layout.edges.length + " edge(s).",
    "",
    "Layout is DETERMINISTIC, not a force simulation: columns by premise type, decisions at the",
    "barycentre of the premises they rest on. A force layout settles differently on each render, so",
    "two screenshots of the same log would differ and a cascade animation would move the nodes you",
    "are trying to watch. Same picture every time is what makes this usable as evidence.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
