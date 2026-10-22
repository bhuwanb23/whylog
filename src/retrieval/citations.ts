/**
 * Citation expansion ΓÇö 3.9.
 *
 * Phase 3 ┬╖ sub-phase 3.9
 * Plan: plan/phase-3-retrieval.md ┬º3.9
 *
 * ---------------------------------------------------------------------------
 * A CITATION IS AN ARGUMENT, NOT A LINK
 *
 * Every competitor can render "Source: ADR-0012, 3 Oct". That is a link. What WhyLog
 * renders is:
 *
 *   WLD-0007 ┬╖ Use SQLite, not Postgres ┬╖ IN
 *     rests on   P-0002 "single-user desktop app" (IN)
 *                P-0005 "no deployment budget" (IN)
 *     excludes   P-0009 "concurrent writers" (OUT)
 *     rejected   postgres ΓÇö "needs a server process we cannot run"
 *     guards     1 of 2 passing
 *     provenance transcript T-0001, decided 2026-10-03, learned 2026-10-03, local engine
 *
 * Showing "rests on P-0002 (IN)" is qualitatively different from showing a source link, and
 * no competitor can display it because no competitor stores it. The `given` is the product;
 * the citation is where the user goes to check it.
 *
 * ---------------------------------------------------------------------------
 * LABELS ARE LIVE, NOT COPIED
 *
 * The label shown next to each premise is the CURRENT labelled state, taken from the
 * labeller's map, not the value stored on the premise when it was extracted. A citation
 * expansion that showed a stale label would say "rests on P-0005 (IN)" for a premise the log
 * has since falsified ΓÇö which is precisely the sentence that must never be printed, because
 * it is the sentence that makes the whole premise mechanism look decorative.
 *
 * Falling back to `premise.label` only when the labeller has no entry for that node keeps a
 * citation renderable during a partial fold, and that case is reported rather than hidden.
 *
 * ---------------------------------------------------------------------------
 * GUARDS ARE COUNTED, NEVER GUESSED
 *
 * A guard that has never run is not passing. `guardsPassing` counts only guards whose
 * `lastRun.outcome === "pass"`, and `neverRun` reports the remainder separately, because
 * "0 of 2 passing" and "2 of 2 never run" are different facts and the first one reads like a
 * failure when the second is merely an absence of evidence. Phase 4 owns running them.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId } from "@/types/common";
import type { Decision, DecisionLabel, Premise } from "@/types/domain";
import type { ExpandedCitation } from "@/types/retrieval";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";


export interface ExpandedCitationResult extends ExpandedCitation {
  /** Guards that exist but have never been run. Kept separate from `guardsPassing` so
   *  "0 of 2 passing" is never printed when the truth is "2 of 2 not yet run". */
  readonly guardsNeverRun: number;
  /** Premises whose label came from the stored value because the labeller had no entry.
   *  Nonzero means the expansion is showing a possibly stale label, and says so. */
  readonly labelsFromFallback: number;
}

/**
 * Expand one citation into the full argument it stands for.
 *
 * Returns null when the decision does not exist in state ΓÇö which cannot happen for a
 * citation that resolved in this run, and is checked anyway because a citation rendered
 * against a deleted node would be the one silent failure this file exists to prevent.
 */
export function expandCitation(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
  engine: EngineId,
): ExpandedCitationResult | null {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return null;

  let fallbacks = 0;
  const label = labels.get(decisionId)?.label ?? decision.label;

  const restsOn: { premise: Premise; label: DecisionLabel }[] = [];
  const excludes: { premise: Premise; label: DecisionLabel }[] = [];
  const seenIn = new Set<string>();
  const seenOut = new Set<string>();

  /* Walk the decision's OWN justification ids rather than scanning every justification in
   * the log for one whose consequent matches. Same result, O(justifications of this
   * decision) instead of O(all justifications) ΓÇö and citation expansion happens per hit per
   * answer, so this is on the hot path of the Ask view. */
  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seenIn.has(premiseId)) continue;
      seenIn.add(premiseId);
      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;
      const labelled = labels.get(premiseId);
      if (labelled === undefined) fallbacks += 1;
      restsOn.push({ premise, label: labelled?.label ?? premise.label });
    }

    for (const premiseId of justification.outList) {
      if (seenOut.has(premiseId)) continue;
      seenOut.add(premiseId);
      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;
      const labelled = labels.get(premiseId);
      if (labelled === undefined) fallbacks += 1;
      excludes.push({ premise, label: labelled?.label ?? premise.label });
    }
  }

  const rejected: { value: string; whyRejected?: string }[] = [];
  for (const alternativeId of decision.alternativeIds) {
    const alternative = state.alternatives.get(alternativeId);
    if (alternative === undefined) continue;
    rejected.push(
      alternative.whyRejected === undefined
        ? { value: alternative.value }
        : { value: alternative.value, whyRejected: alternative.whyRejected },
    );
  }

  let guardsPassing = 0;
  let guardsTotal = 0;
  let guardsNeverRun = 0;
  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    guardsTotal += 1;
    if (guard.lifecycle === "suppressed") continue;
    if (guard.lastRun === undefined) guardsNeverRun += 1;
    else if (guard.lastRun.outcome === "pass") guardsPassing += 1;
  }

  return {
    decision,
    label,
    restsOn,
    excludes,
    rejected,
    guardsPassing,
    guardsTotal,
    guardsNeverRun,
    labelsFromFallback: fallbacks,
    snippet: decision.provenance.snippet,
    decidedAt: decision.temporal.valid,
    learnedAt: decision.temporal.learned,
    engine: decision.provenance.extractedBy === engine ? engine : decision.provenance.extractedBy,
  };
}

/** Expand every citation in an answer, in claim order. Unresolvable ids are dropped here and
 *  counted by the caller ΓÇö the evidence contract already recorded them as unresolved. */
export function expandAll(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  ids: readonly DecisionId[],
  engine: EngineId,
): { expanded: readonly ExpandedCitationResult[]; missing: readonly DecisionId[] } {
  const expanded: ExpandedCitationResult[] = [];
  const missing: DecisionId[] = [];
  const seen = new Set<DecisionId>();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const result = expandCitation(state, labels, id, engine);
    if (result === null) missing.push(id);
    else expanded.push(result);
  }

  return { expanded, missing };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The expansion as the user reads it.
 *
 * Order is deliberate: what was decided, what it rests on, what it excludes, what was
 * rejected, whether anything checks it, where it came from. A reader who stops after the
 * second line still has the decision and its premises ΓÇö the two things that matter most.
 */
export function renderExpansion(expanded: ExpandedCitationResult): string {
  const lines: string[] = [];
  const decision = expanded.decision;

  lines.push(
    decision.id + " ┬╖ " + decision.statement + " ┬╖ " + expanded.label +
      (decision.status === "contested" ? " (CONTESTED ΓÇö a human call is pending)" : ""),
  );

  if (expanded.restsOn.length === 0) {
    lines.push("  rests on   ΓÇö nothing recorded. This decision has no stated premises, so there is nothing to check it against.");
  } else {
    lines.push("  rests on   " + expanded.restsOn.map((entry) => entry.premise.id + ' "' + entry.premise.text + '" (' + entry.label + ")").join("; "));
  }

  if (expanded.excludes.length > 0) {
    lines.push("  excludes   " + expanded.excludes.map((entry) => entry.premise.id + ' "' + entry.premise.text + '" (' + entry.label + ")").join("; "));
    lines.push("             If any excluded condition becomes true, this decision is invalidated. That is gate (c).");
  }

  if (expanded.rejected.length > 0) {
    lines.push(
      "  rejected   " +
        expanded.rejected
          .map((entry) => entry.value + (entry.whyRejected === undefined ? " (no reason recorded)" : ' ΓÇö "' + entry.whyRejected + '"'))
          .join("; "),
    );
  }

  if (expanded.guardsTotal === 0) {
    lines.push("  guards     none. Nothing automatically checks whether this still holds.");
  } else {
    const neverRun =
      expanded.guardsNeverRun > 0
        ? ", " + expanded.guardsNeverRun + " never run"
        : "";
    lines.push("  guards     " + expanded.guardsPassing + " of " + expanded.guardsTotal + " passing" + neverRun + ".");
  }

  lines.push(
    "  provenance " + expanded.snippet.transcriptId + ", decided " + expanded.decidedAt.slice(0, 10) +
      ", learned " + expanded.learnedAt.slice(0, 10) + ", extracted by " + expanded.engine + ".",
  );

  if (expanded.labelsFromFallback > 0) {
    lines.push(
      "  note       " + expanded.labelsFromFallback +
        " premise label(s) came from the stored value because the labeller had no entry for them ΓÇö treat those labels as possibly stale.",
    );
  }

  return lines.join("\n");
}

/** One-line form for inline citation markers: "[WLD-0007 ┬╖ rests on P-0002 (IN), P-0005 (IN)]". */
export function renderInline(expanded: ExpandedCitationResult): string {
  const premises =
    expanded.restsOn.length === 0
      ? "no premises recorded"
      : "rests on " + expanded.restsOn.map((entry) => entry.premise.id + " (" + entry.label + ")").join(", ");

  return "[" + expanded.decision.id + " ┬╖ " + premises + "]";
}

export type { Decision, Premise };
