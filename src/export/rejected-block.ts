/**
 * "Rejected — do not re-propose" — 5.3.
 *
 * Phase 5 · sub-phase 5.3
 * Plan: plan/phase-5-export-compiler.md §5.3
 *
 * ---------------------------------------------------------------------------
 * THE HIGHEST-VALUE BLOCK IN THE FILE, AND THE ONE NO COMPETITOR EMITS
 *
 * Not because Markdown is hard. Because none of them index rejected alternatives first-class, so
 * none of them has the data. A tool that stores decisions and not the things it turned down
 * cannot emit this block at any export quality.
 *
 * What it prevents is the most common and most expensive agent failure there is: an agent, given
 * a fresh context window and no memory of the conversation that produced the decision, proposes
 * Postgres. Again. To the person who rejected Postgres six weeks ago and wrote down why.
 *
 * ---------------------------------------------------------------------------
 * PREMISE STATUS IS WHAT MAKES IT MORE THAN A BLACKLIST
 *
 *   - **Postgres** (WLD-0007) — deploy complexity; premise P-0005 no-deploy-infra still IN
 *   - **Next.js**  (WLD-0003) — no SSR needed; premise P-0008 scope=hackathon CONTESTED
 *
 * The first line says: this rejection still holds, and here is the condition it rests on. The
 * second says: this rejection is under review, so proposing it is not obviously wrong.
 *
 * A flat blacklist would tell an agent to never mention Next.js even after the hackathon shipped
 * and the premise that ruled it out was falsified. Carrying the premise status turns the block
 * from "don't say this" into "don't say this WHILE THIS HOLDS" — which is the difference between
 * a rule and a decision.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { RejectedBlockEntry } from "@/types/export";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";

/**
 * Build the block.
 *
 * Only alternatives with a recorded reason are included. A rejection without a reason is a
 * blacklist entry an agent cannot evaluate, and it ages badly: nobody can later tell whether the
 * reason was obvious or whether there never was one. Phase 1 stored those alternatives anyway;
 * this is where the distinction pays off.
 */
export function rejectedBlock(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): readonly RejectedBlockEntry[] {
  const out: RejectedBlockEntry[] = [];

  for (const decision of state.decisions.values()) {
    /* A superseded decision's rejections are history. Emitting them would tell an agent not to
     * propose something the log has since adopted — the exact inverse of the block's purpose. */
    if (decision.status === "superseded" || decision.status === "archived") continue;

    const label = labels.get(decision.id)?.label ?? decision.label;
    if (label === "OUT") continue;

    const premiseEntries = decisionPremises(state, labels, decision.id);

    for (const alternativeId of decision.alternativeIds) {
      const alternative = state.alternatives.get(alternativeId);
      if (alternative === undefined) continue;
      if (alternative.whyRejected === undefined || alternative.whyRejected.trim().length === 0) continue;

      const contested = premiseEntries.find((entry) => entry.contested);

      out.push({
        value: alternative.value,
        decisionId: decision.id,
        why: alternative.whyRejected.trim(),
        premiseStatus: renderPremiseStatus(premiseEntries),
        contested: contested !== undefined,
      });
    }
  }

  /* Contested first: a rejection under review is the one an agent is most likely to be right
   * about revisiting, and burying it under forty settled ones is how it gets ignored. */
  return out.sort((a, b) => {
    if (a.contested !== b.contested) return a.contested ? -1 : 1;
    return a.decisionId < b.decisionId ? -1 : a.decisionId > b.decisionId ? 1 : a.value < b.value ? -1 : 1;
  });
}

interface PremiseEntry {
  readonly id: PremiseId;
  readonly text: string;
  readonly label: DecisionLabel;
  readonly contested: boolean;
}

function decisionPremises(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): readonly PremiseEntry[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: PremiseEntry[] = [];
  const seen = new Set<PremiseId>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      const label = labels.get(premiseId)?.label ?? premise.label;

      out.push({
        id: premiseId,
        text: premise.text,
        label,
        /* Contested means the premise is neither confirmed nor refuted: the decision rests on
         * something the log has not settled, so the rejection resting on it is provisional. */
        contested: label === "UNKNOWN",
      });
    }
  }

  return out;
}

function renderPremiseStatus(premises: readonly PremiseEntry[]): string {
  if (premises.length === 0) {
    return "no recorded premise — this rejection rests on nothing checkable, so treat it as advisory";
  }

  return premises
    .map((entry) =>
      "premise " + entry.id + " " + shorten(entry.text) + " " +
      (entry.contested ? "CONTESTED" : "still " + entry.label),
    )
    .join("; ");
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 34 ? flat : flat.slice(0, 31) + "...";
}

/** The block as Markdown. */
export function renderRejectedBlock(entries: readonly RejectedBlockEntry[]): string {
  if (entries.length === 0) {
    return [
      "## Rejected — do not re-propose without superseding the record",
      "",
      "Nothing has been recorded as rejected yet. Rejections are extracted from transcripts and",
      "confirmed on the Review tab; an alternative with no recorded reason is stored but never",
      "emitted here, because a blacklist entry nobody can evaluate ages badly.",
    ].join("\n");
  }

  const lines = [
    "## Rejected — do not re-propose without superseding the record",
    "",
  ];

  for (const entry of entries) {
    lines.push(
      "- **" + entry.value + "** (" + entry.decisionId + ") — " + entry.why + "; " + entry.premiseStatus +
        (entry.contested ? "  ⚠ UNDER REVIEW" : ""),
    );
  }

  lines.push("");
  lines.push(
    "Proposing one of these is not forbidden — it is a SUPERSESSION, and it has a form: record the",
    "new decision, cite the premise that changed, and let the old record be superseded rather than",
    "quietly contradicted in a diff.",
  );

  return lines.join("\n");
}

/** How many rejections are contested, for the export summary. */
export function contestedCount(entries: readonly RejectedBlockEntry[]): number {
  return entries.filter((entry) => entry.contested).length;
}
