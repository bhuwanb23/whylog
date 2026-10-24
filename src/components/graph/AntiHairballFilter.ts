/**
 * The anti-hairball rules — 6.6.
 *
 * Phase 6 · sub-phase 6.6
 * Plan: plan/phase-6-presentation.md §6.6
 *
 * ---------------------------------------------------------------------------
 * THE RULES ARE THE VISUAL'S SURVIVAL CONDITION
 *
 * A lattice of 40 decisions with every premise and every edge drawn is unreadable, and an
 * unreadable signature visual is worse than no signature visual: it is the one picture in the
 * product that nobody else can draw, and drawing it badly teaches a judge that the structure is
 * too complex to see, which is the opposite of the claim.
 *
 * So four rules, each with a reason that is about comprehension rather than aesthetics:
 *
 *   1. premises in COLUMNS BY TYPE, decisions as leaves beneath
 *      The bipartite structure becomes spatial rather than something the viewer has to infer from
 *      edge endpoints.
 *
 *   2. render ONE CASCADE AT A TIME, never the whole graph unfiltered
 *      `focus` restricts the layout to one blast radius. This is the difference between showing a
 *      mechanism and showing a tangle.
 *
 *   3. fade SUPERSEDED and `related` edges by default, behind a toggle
 *      A superseded decision is history and a `related` edge is topical, never structural — neither
 *      carries weight in a cascade, and drawing them at full strength implies that they do.
 *
 *   4. COLLAPSE premises with a single dependent decision into that decision's card
 *      A premise supporting exactly one decision adds a node and an edge to say what the card
 *      already says. Collapsing it is what leaves the SHARED premises — the load-bearing ones —
 *      visible, which is the structure worth seeing.
 *
 * ---------------------------------------------------------------------------
 * APPLIED IN THE LAYOUT, NOT AT RENDER TIME
 *
 * Filtering when drawing means the layout still reserves space for what is hidden, leaving gaps that
 * read as missing data. Filtering before layout means the picture is computed over what will actually
 * be drawn. `LatticeLayout` does the work; this module owns the RULES and reports them, so the user
 * can see what was withheld and why rather than wondering where the rest of their log went.
 * ---------------------------------------------------------------------------
 */

import type { LatticeLayout } from "./LatticeLayout";

export interface HairballReport {
  readonly collapsedPremises: number;
  readonly hiddenSuperseded: number;
  readonly hiddenRelated: boolean;
  readonly focused: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** True when the picture is still too dense to read, and the user should focus a cascade. */
  readonly tooDense: boolean;
}

/** Above this many edges the picture stops being legible and the view should push the user toward
 *  focusing one cascade. Not a hard limit — nothing is hidden by it — because silently dropping
 *  edges to hit a number would make the diagram lie. */
export const DENSITY_LIMIT = 90;

export function reportHairball(layout: LatticeLayout, focused: boolean): HairballReport {
  return {
    collapsedPremises: layout.collapsedPremiseCount,
    hiddenSuperseded: layout.droppedDecisionCount,
    hiddenRelated: !focused,
    focused,
    nodeCount: layout.nodes.size,
    edgeCount: layout.edges.length,
    tooDense: layout.edges.length > DENSITY_LIMIT,
  };
}

/** What is being withheld, and why. Rendered under the lattice: a diagram that hides things without
 *  saying so is a diagram the viewer cannot trust, and the first thing they will wonder is whether
 *  their log is incomplete. */
export function describeHairball(report: HairballReport): string {
  const lines: string[] = [];

  if (report.collapsedPremises > 0) {
    lines.push(
      `${report.collapsedPremises} premise(s) collapsed into their decision's card. A premise supporting exactly one decision adds a node and an edge to say what the card already says; collapsing them is what leaves the SHARED premises — the load-bearing ones — visible.`,
    );
  }

  if (report.hiddenSuperseded > 0) {
    lines.push(
      `${report.hiddenSuperseded} superseded/archived decision(s) hidden. History, not structure: they carry no weight in a cascade. Toggle to show them.`,
    );
  }

  if (!report.focused) {
    lines.push(
      "Topical `related` edges hidden. They mean 'these concern each other', never 'these support " +
        "each other', and drawing them at full strength implies a cascade path where there is none.",
    );
  }

  if (report.tooDense) {
    lines.push(
      `STILL DENSE: ${report.edgeCount} edges, above the ${DENSITY_LIMIT}-edge legibility limit. Select a premise to focus one cascade — the plan's rule is to render one cascade at a time, never the whole graph unfiltered.`,
    );
  }

  if (lines.length === 0) {
    lines.push(
      "Nothing withheld. Every premise, decision and structural edge in the log is drawn.",
    );
  }

  return lines.join("\n\n");
}
