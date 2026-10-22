/**
 * The premise lattice — 6.6.
 *
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * "The differentiating visual is not another chat UI and not another decision timeline. It is
 * the premise lattice — a bipartite graph where assumptions are the load-bearing nodes and
 * decisions hang off them."
 *
 * The lattice is the one piece of Phase 6 that is pure geometry, so it is also the one piece
 * that can be tested exactly rather than eyeballed. Four properties matter, and each one is
 * a promise the plan makes:
 *
 *   1. BIPARTITE. Premises on one side, decisions on the other. The edges run from a premise
 *      to the decisions that rest on it.
 *   2. DETERMINISTIC. No force simulation. Two renderings of the same log must place the same
 *      node at the same pixel, or the lattice is decoration rather than evidence: a cascade
 *      animation would move the node you are watching, and "the lattice at time T" would not
 *      look like the lattice you remember.
 *   3. COLUMNS BY PREMISE TYPE. Premises sit in a column per type, so two premises of the
 *      same kind line up and the eye can compare them.
 *   4. ANTI-HAIRBALL. A premise that 40 decisions rest on must not draw 40 edges into the
 *      space of one node; the layout reports what it withheld instead of silently dropping it.
 */

import { describe, expect, it } from "vitest";

import { DENSITY_LIMIT, reportHairball } from "@/components/graph/AntiHairballFilter";
import {
  COLUMN_WIDTH,
  type LatticeLayout,
  type LatticeNode,
  layoutLattice,
} from "@/components/graph/LatticeLayout";
import { label } from "@/reasoning/labeller";
import { buildDemoLog } from "../../helpers/demo-log";

async function lattice(): Promise<{ layout: LatticeLayout; node: (id: string) => LatticeNode }> {
  const state = await buildDemoLog("curated");
  const labels = label(state).labels;
  const built = layoutLattice(state, labels);
  return { layout: built, node: (id) => built.nodes.get(id as never) as LatticeNode };
}

describe("The premise lattice", () => {
  it("is bipartite: premises on one side, decisions on the other, edges from premise to decision", async () => {
    const { layout } = await lattice();

    const premises = [...layout.nodes.values()].filter((n) => n.kind === "premise");
    const decisions = [...layout.nodes.values()].filter((n) => n.kind === "decision");
    expect(premises.length).toBeGreaterThan(0);
    expect(decisions.length).toBeGreaterThan(0);

    // Every edge runs FROM a premise TO a decision. If one ran the other way the picture
    // would stop being "assumptions with decisions hanging off them".
    for (const edge of layout.edges) {
      const from = layout.nodes.get(edge.from);
      const to = layout.nodes.get(edge.to);
      expect(from?.kind).toBe("premise");
      expect(to?.kind).toBe("decision");
    }
  });

  it("is deterministic: the same log lays out to the same pixels", async () => {
    const state = await buildDemoLog("curated");
    const labels = label(state).labels;

    const first = layoutLattice(state, labels);
    const second = layoutLattice(state, labels);

    expect([...second.nodes.values()].map((n) => [n.id, n.x, n.y])).toEqual(
      [...first.nodes.values()].map((n) => [n.id, n.x, n.y]),
    );
    expect(second.edges).toEqual(first.edges);
  });

  it("puts premises in a column per type, and decisions below them", async () => {
    const { layout } = await lattice();

    // Every premise of a type shares that type's column x.
    const columnX = new Map<string, number>();
    for (const node of layout.nodes.values()) {
      if (node.kind !== "premise" || node.column === null) continue;
      const seen = columnX.get(node.column);
      if (seen === undefined) columnX.set(node.column, node.x);
      else expect(node.x).toBe(seen);
    }
    expect(columnX.size).toBeGreaterThan(0);

    // The columns are laid out left to right, COLUMN_WIDTH apart.
    const xs = [...columnX.values()].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]! - xs[i - 1]!).toBe(COLUMN_WIDTH);
    }

    // Decisions sit BELOW the premise band, never interleaved with the premises.
    const premises = [...layout.nodes.values()].filter((n) => n.kind === "premise");
    const decisions = [...layout.nodes.values()].filter((n) => n.kind === "decision");
    const lowestPremise = Math.max(...premises.map((n) => n.y));
    const highestDecision = Math.min(...decisions.map((n) => n.y));
    expect(highestDecision).toBeGreaterThan(lowestPremise);
  });

  it("no two nodes overlap", async () => {
    const { layout } = await lattice();
    const nodes = [...layout.nodes.values()];

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const sameX = a.x === b.x;
        const sameY = a.y === b.y;
        expect(sameX && sameY).toBe(false);
      }
    }
  });

  it("reports a hairball rather than silently dropping edges to hit a number", async () => {
    const { layout } = await lattice();
    const report = reportHairball(layout, false);

    /* The report is derived from the layout, and it says what was WITHHELD rather than
     * hiding it: "nothing was dropped, the picture is just dense" is a different statement
     * from "we dropped 12 edges to make it fit", and only the first is honest. */
    expect(report.collapsedPremises).toBe(layout.collapsedPremiseCount);
    expect(report.hiddenSuperseded).toBe(layout.droppedDecisionCount);
    expect(report.nodeCount).toBe(layout.nodes.size);
    expect(report.edgeCount).toBe(layout.edges.length);
    expect(report.tooDense).toBe(layout.edges.length > DENSITY_LIMIT);

    /* Nothing is hidden by the density limit itself - it is a prompt to focus, not a
     * filter. A diagram that silently drops edges to hit a number makes the diagram lie. */
    expect(report.edgeCount).toBe(layout.edges.length);
  });
});
