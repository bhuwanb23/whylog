/**
 * Premise nodes — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 *
 * A CIRCLE, sized by dependent-decision count. Load-bearing nodes look load-bearing: the premise
 * four decisions hang off is visibly bigger than the one nothing depends on any more, which is the
 * single fastest way to see where the log's weight actually sits.
 *
 * The ring is SOLID for world-observable types (`scale`, `deployment`, `capability`, `external`)
 * and DASHED for intent-based ones (`team`, `budget`, `time`, `requirement`). A solid ring means a
 * guard or a repo scan could falsify it; a dashed ring means only a human can. That distinction
 * decides whether Phase 4 can verify the assumption at all, so it belongs on the node rather than
 * in a tooltip.
 */

import { isWorldObservable } from "@/ontology";
import { LABEL_COLOUR } from "@/theme";
import type { DecisionLabel, PremiseType } from "@/types/domain";
import type { ReactElement } from "react";
import type { LatticeNode } from "./LatticeLayout";
import { radiusFor, ringFor } from "./LatticeLayout";

export interface PremiseNodeProps {
  readonly node: LatticeNode;
  readonly predicate: string;
  readonly type: PremiseType;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly flipping: boolean;
  readonly onSelect: (id: string) => void;
}

export function PremiseNode(props: PremiseNodeProps): ReactElement {
  const radius = radiusFor(props.node.dependents);
  const colour = LABEL_COLOUR[props.node.label];
  const observable = isWorldObservable(props.type);

  return (
    <g
      transform={`translate(${props.node.x},${props.node.y})`}
      onClick={() => props.onSelect(props.node.id)}
      style={{
        cursor: "pointer",
        opacity: props.dimmed ? 0.22 : 1,
        transition: "opacity 220ms ease",
      }}
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
        {`${props.node.id} · ${props.type} · ${props.predicate}\n${props.node.text}\nlabel ${props.node.label} · ${props.node.dependents} decision(s) depend on it\n${
          observable
            ? "WORLD-OBSERVABLE — a guard or repo scan could falsify this"
            : "INTENT-BASED — only a human can retract this"
        }\nClick to see everything resting on it; falsify it to watch the cascade.`}
      </title>

      {/* The pulse ring, drawn only while this node is mid-flip. */}
      {props.flipping ? (
        <circle r={radius + 9} fill="none" stroke={colour} strokeWidth={1.5} opacity={0.55}>
          <animate
            attributeName="r"
            values={`${String(radius + 4)};${String(radius + 14)}`}
            dur="0.9s"
            repeatCount="indefinite"
          />
          <animate attributeName="opacity" values="0.6;0" dur="0.9s" repeatCount="indefinite" />
        </circle>
      ) : null}

      <circle
        r={radius}
        fill={
          props.node.label === "UNKNOWN" || props.node.label === "UNFOUNDED"
            ? "var(--surface-raised)"
            : colour
        }
        fillOpacity={props.node.label === "IN" ? 0.22 : 0.1}
        stroke={colour}
        strokeWidth={props.selected || props.highlighted ? 2.6 : 1.4}
        strokeDasharray={ringFor(props.type)}
      />

      <text
        textAnchor="middle"
        dy={-radius - 6}
        className="mono"
        style={{ fontSize: 9, fill: "var(--text-faint)" }}
      >
        {props.node.id}
      </text>

      <text textAnchor="middle" dy={3} style={{ fontSize: 9.5, fill: "var(--text)" }}>
        {truncate(props.node.text, 22)}
      </text>

      {props.node.dependents > 1 ? (
        <text
          textAnchor="middle"
          dy={radius + 11}
          className="mono"
          style={{ fontSize: 9, fill: colour }}
        >
          {props.node.dependents} dependents
        </text>
      ) : null}
    </g>
  );
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export type { DecisionLabel, PremiseType };
