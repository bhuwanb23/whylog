/**
 * Decision nodes — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 *
 * A ROUNDED SQUARE, so the bipartite structure reads without labels: circles above, squares below,
 * edges only between the two bands. A decision graph — what `ai-memory` ships — draws one shape and
 * links decisions to decisions, which is a different claim about the world. This picture says the
 * assumptions are the load-bearing nodes and the decisions hang off them, and it says so by shape
 * before it says so by words.
 *
 * Premises collapsed into this card (single-dependent ones, per the anti-hairball rules) are listed
 * as a count on the node, so collapsing them hides edges without hiding information.
 */

import { LABEL_BACKGROUND, LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import type { ReactElement } from "react";
import type { LatticeNode } from "./LatticeLayout";

export const DECISION_WIDTH = 112;
export const DECISION_HEIGHT = 34;

export interface DecisionNodeProps {
  readonly node: LatticeNode;
  readonly status: string;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly flipping: boolean;
  readonly onSelect: (id: string) => void;
}

export function DecisionNode(props: DecisionNodeProps): ReactElement {
  const colour = LABEL_COLOUR[props.node.label];
  const hollow = props.node.label === "UNKNOWN" || props.node.label === "UNFOUNDED";

  return (
    <g
      transform={`translate(${props.node.x},${props.node.y})`}
      onClick={() => props.onSelect(props.node.id)}
      style={{
        cursor: "pointer",
        opacity: props.dimmed ? 0.22 : 1,
        transition: "opacity 220ms ease",
      }}
      /* biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; a focusable <g> with an
         explicit role and a key handler is the accessible equivalent, and a HTML button cannot be
         placed inside a <svg> at all. */
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.node.id);
        }
      }}
    >
      <title>
        {`${props.node.id} · ${props.node.text}\nlabel ${props.node.label} — ${LABEL_MEANING[props.node.label]}\nlifecycle ${props.status}${
          props.node.collapsedPremises.length > 0
            ? `\n${props.node.collapsedPremises.length} premise(s) collapsed into this card: ${props.node.collapsedPremises.join(", ")}`
            : ""
        }`}
      </title>

      {props.flipping ? (
        <rect
          x={-DECISION_WIDTH / 2 - 6}
          y={-DECISION_HEIGHT / 2 - 6}
          width={DECISION_WIDTH + 12}
          height={DECISION_HEIGHT + 12}
          rx={9}
          fill="none"
          stroke={colour}
          strokeWidth={1.5}
          opacity={0.55}
        >
          <animate attributeName="opacity" values="0.6;0" dur="0.9s" repeatCount="indefinite" />
        </rect>
      ) : null}

      <rect
        x={-DECISION_WIDTH / 2}
        y={-DECISION_HEIGHT / 2}
        width={DECISION_WIDTH}
        height={DECISION_HEIGHT}
        rx={7}
        fill={hollow ? "var(--surface-raised)" : LABEL_BACKGROUND[props.node.label]}
        stroke={colour}
        strokeWidth={props.selected || props.highlighted ? 2.4 : 1.2}
        strokeDasharray={props.node.label === "UNFOUNDED" ? "4 3" : ""}
      />

      <text
        textAnchor="middle"
        dy={-3}
        className="mono"
        style={{ fontSize: 9, fill: "var(--text-faint)" }}
      >
        {props.node.id}
      </text>

      <text textAnchor="middle" dy={9} style={{ fontSize: 9.5, fill: "var(--text)" }}>
        {truncate(props.node.text, 20)}
      </text>

      {props.node.collapsedPremises.length > 0 ? (
        <text
          textAnchor="middle"
          dy={DECISION_HEIGHT / 2 + 11}
          className="mono"
          style={{ fontSize: 8.5, fill: "var(--text-faint)" }}
        >
          +{props.node.collapsedPremises.length} collapsed
        </text>
      ) : null}
    </g>
  );
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
