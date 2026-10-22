/**
 * Lattice edges — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 *
 * ---------------------------------------------------------------------------
 * FIVE KINDS, FIVE VISUALLY DISTINCT TREATMENTS
 *
 *   supports      premise → decision, IN-list      SOLID      the load-bearing edge
 *   excludes      premise → decision, OUT-list     DASHED     non-monotonic support
 *   depends-on    decision → decision              SOLID blue a cascade path
 *   supersedes    decision → decision              DOTTED grey history
 *   conflicts     decision → decision              RED dashed the only red in the system
 *
 * `excludes` is dashed for a reason that is not decorative: a non-empty OUT-list is what makes a
 * justification NON-MONOTONIC, and gate (c) fires on exactly that. An exclusion drawn the same as a
 * support would hide the distinction between "this decision rests on P" and "this decision is
 * invalidated if P becomes true" — which are opposite claims about the same node.
 *
 * `conflicts` is the only red. Red means an action is available, and a recorded conflict is one.
 * ---------------------------------------------------------------------------
 */

import type { ReactElement } from "react";
import type { LatticeEdge, LatticeNode } from "./LatticeLayout";

export const EDGE_VISUAL: Readonly<
  Record<LatticeEdge["kind"], { stroke: string; width: number; dash: string; label: string }>
> = {
  supports: { stroke: "var(--label-in)", width: 1.6, dash: "", label: "supports — IN-list, load-bearing" },
  excludes: { stroke: "var(--label-unknown)", width: 1.6, dash: "6 4", label: "excludes — OUT-list, NON-MONOTONIC. If this premise becomes true the decision is invalidated. This is what gate (c) fires on." },
  "depends-on": { stroke: "var(--edge-cascade)", width: 1.4, dash: "", label: "depends on — a cascade path" },
  supersedes: { stroke: "var(--edge-supersede)", width: 1.2, dash: "2 4", label: "supersedes — history" },
  conflicts: { stroke: "var(--edge-conflict)", width: 1.8, dash: "5 3", label: "conflicts — the only red in the system. An action is available." },
};

export interface EdgeProps {
  readonly edge: LatticeEdge;
  readonly from: LatticeNode;
  readonly to: LatticeNode;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly turnedRed: boolean;
}

export function LatticeEdgeView(props: EdgeProps): ReactElement {
  const visual = EDGE_VISUAL[props.edge.kind];

  /* A premise → decision edge is drawn as a curve that leaves the premise downwards and enters the
   * decision from above, which is what makes the bipartite structure read as a hierarchy of support
   * rather than as an arbitrary tangle. Decision → decision edges are straight, because they live
   * in one band and curving them would imply a relationship to the premise band that does not exist. */
  const path =
    props.from.kind === "premise"
      ? curve(props.from.x, props.from.y, props.to.x, props.to.y)
      : "M " + props.from.x + " " + props.from.y + " L " + props.to.x + " " + props.to.y;

  const stroke = props.turnedRed ? "var(--edge-conflict)" : visual.stroke;

  return (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={props.highlighted ? visual.width + 1.2 : visual.width}
      strokeDasharray={visual.dash}
      opacity={props.dimmed ? 0.14 : props.highlighted ? 1 : 0.72}
      style={{ transition: "opacity 220ms ease, stroke 220ms ease, stroke-width 220ms ease" }}
    >
      <title>{visual.label}</title>
    </path>
  );
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return "M " + x1 + " " + y1 + " C " + x1 + " " + midY + ", " + x2 + " " + midY + ", " + x2 + " " + y2;
}

/** The edge legend. Rendered beside the lattice, because five line styles nobody can look up is
 *  five line styles nobody learns. */
export function EdgeLegend(): ReactElement {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      {(Object.keys(EDGE_VISUAL) as LatticeEdge["kind"][]).map((kind) => {
        const visual = EDGE_VISUAL[kind];
        return (
          <span key={kind} style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={visual.label}>
            <svg width="26" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="26"
                y2="4"
                stroke={visual.stroke}
                strokeWidth={visual.width}
                strokeDasharray={visual.dash}
              />
            </svg>
            <span className="faint" style={{ fontSize: 11 }}>
              {kind}
            </span>
          </span>
        );
      })}
    </div>
  );
}
