/**
 * Commit preview — 1.9's "what will this do?".
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * ---------------------------------------------------------------------------
 * WHY A PREVIEW EXISTS BEFORE A COMMIT
 *
 * "The system proposes, the human disposes" (invariant I4) is only real if the
 * human can see the proposal. A commit button that appends nine events to a
 * hash-chained log without saying which nine is a button the user learns not to
 * press — and then the review queue becomes a formality.
 *
 * The preview is also where the idempotence claim becomes VISIBLE. Re-import the
 * same transcript and the preview reads "0 new nodes · 9 merges onto existing
 * nodes". That sentence is the acceptance criterion for sub-phase 1.7, shown to the
 * user rather than asserted in a test they will never read.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * Not the Phase 2 cascade preview. This shows what the COMMIT writes. The cascade
 * preview shows what a premise invalidation would retract, and it needs the
 * dependency-directed backtracker, which does not exist yet. Confusing the two
 * would mean promising a cascade prediction the system cannot make.
 * ---------------------------------------------------------------------------
 */

import type { DiscardedCandidate } from "@/ai/types";
import { isAccepted } from "@/extraction/types";
import type { ResolvedCandidate, ReviewAction } from "@/extraction/types";
import type { AlternativeId, DecisionId, PremiseId } from "@/types/common";

export interface CommitPreview {
  readonly newDecisions: number;
  readonly mergedDecisions: number;
  readonly uncertainDecisions: number;
  readonly newPremises: number;
  readonly mergedPremises: number;
  readonly derivedPremises: number;
  readonly newAlternatives: number;
  readonly alternativesWithReason: number;
  readonly discarded: number;
  readonly edited: number;
  readonly conflicts: readonly DecisionId[];
  /** Nodes the commit will merge onto, so the preview can name them. */
  readonly mergeTargets: readonly {
    readonly id: DecisionId | PremiseId | AlternativeId;
    readonly label: string;
  }[];
  /** Events the commit will append. Shown as a count because the list is long and
   *  the number is what tells the user how big the act is. */
  readonly events: number;
  readonly actions: Readonly<Record<ReviewAction["type"], number>>;
  /** Items parked in the Contested queue. Not written as nodes, not thrown away. */
  readonly contested: number;
}

const NO_ACTIONS: Readonly<Record<ReviewAction["type"], number>> = {
  approve: 0,
  edit: 0,
  discard: 0,
  "merge-into": 0,
  contest: 0,
};

/**
 * What committing this review would write.
 *
 * Items with no action are NOT counted: an unreviewed item is not committed, and a
 * preview that included it would overstate the act. The review is all-or-nothing
 * per item, and the count of unreviewed items is reported separately so the user
 * knows what they are leaving behind.
 */
export function previewCommit(
  candidates: readonly ResolvedCandidate[],
  discards: readonly DiscardedCandidate[] = [],
): CommitPreview {
  const actions: Record<ReviewAction["type"], number> = { ...NO_ACTIONS };
  const mergeTargets: { id: DecisionId | PremiseId | AlternativeId; label: string }[] = [];
  const conflicts = new Set<DecisionId>();

  let newDecisions = 0;
  let mergedDecisions = 0;
  let uncertainDecisions = 0;
  let newPremises = 0;
  let mergedPremises = 0;
  let derivedPremises = 0;
  let newAlternatives = 0;
  let alternativesWithReason = 0;
  let edited = 0;
  let contested = 0;

  for (const candidate of candidates) {
    const action = candidate.action;
    if (action === null) continue;

    actions[action.type] += 1;
    if (action.type === "edit") edited += 1;
    if (!isAccepted(action)) {
      if (action.type === "contest") contested += 1;
      continue;
    }

    for (const id of candidate.resolution.conflictsWith) conflicts.add(id);

    if (candidate.resolution.action === "merge" && candidate.resolution.matchedId !== null) {
      mergeTargets.push({
        id: candidate.resolution.matchedId,
        label: labelFor(candidate),
      });
    }

    switch (candidate.kind) {
      case "decision": {
        if (candidate.resolution.action === "merge") mergedDecisions += 1;
        else if (candidate.resolution.action === "candidate") uncertainDecisions += 1;
        else newDecisions += 1;
        break;
      }
      case "premise": {
        if (candidate.resolution.action === "merge") mergedPremises += 1;
        else newPremises += 1;
        if (candidate.premise !== null && candidate.premise.text.includes("— excluded by")) {
          derivedPremises += 1;
        }
        break;
      }
      case "alternative": {
        newAlternatives += 1;
        if (candidate.alternative?.whyRejected !== undefined) alternativesWithReason += 1;
        break;
      }
    }
  }

  const accepted = actions.approve + actions.edit + actions["merge-into"];

  return {
    newDecisions,
    mergedDecisions,
    uncertainDecisions,
    newPremises,
    mergedPremises,
    derivedPremises,
    newAlternatives,
    alternativesWithReason,
    discarded: actions.discard + discards.length,
    contested,
    edited,
    conflicts: [...conflicts],
    mergeTargets,
    // One event per accepted node, one per discard, plus the single
    // ExtractionReviewed that records the whole act. The reason field on state-
    // changing events is written by the commit, not counted here.
    events: accepted + actions.discard + discards.length + 1,
    actions,
  };
}

function labelFor(candidate: ResolvedCandidate): string {
  if (candidate.kind === "decision" && candidate.decision !== null) {
    return `${candidate.decision.variable} → ${candidate.decision.value}`;
  }
  if (candidate.kind === "premise" && candidate.premise !== null) {
    return `${candidate.premise.type}.${candidate.premise.predicate}`;
  }
  if (candidate.kind === "alternative" && candidate.alternative !== null) {
    return `rejected ${candidate.alternative.value}`;
  }
  return candidate.key;
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The paragraph the confirm dialog shows.
 *
 * Ordered by consequence: what gets created, what merges, what is thrown away, and
 * last what conflicts — because a conflict is the only line that should make the
 * user stop and read.
 */
export function describeCommit(preview: CommitPreview, unreviewed: number): string {
  if (preview.events === 1) {
    return unreviewed > 0
      ? "Nothing reviewed. Committing now would append one event recording that this extraction was reviewed and everything in it left undecided."
      : "Nothing to commit.";
  }

  const lines: string[] = [];

  const created: string[] = [];
  if (preview.newDecisions > 0)
    created.push(`${preview.newDecisions} new decision${plural(preview.newDecisions)}`);
  if (preview.newPremises > 0)
    created.push(`${preview.newPremises} new premise${plural(preview.newPremises)}`);
  if (preview.newAlternatives > 0)
    created.push(
      `${preview.newAlternatives} rejected alternative${plural(preview.newAlternatives)}`,
    );
  if (created.length > 0) lines.push(`Creates ${created.join(", ")}.`);

  const merged = preview.mergedDecisions + preview.mergedPremises;
  if (merged > 0) {
    lines.push(
      `Merges ${merged} onto existing node${plural(merged)} — corroboration increments, evidence extends, and no duplicate is created.`,
    );
  }
  if (preview.derivedPremises > 0) {
    lines.push(
      `${preview.derivedPremises} of those premises ${preview.derivedPremises === 1 ? "is" : "are"} OUT-list entries inferred from another premise rather than quoted from the transcript.`,
    );
  }
  if (preview.alternativesWithReason < preview.newAlternatives) {
    const without = preview.newAlternatives - preview.alternativesWithReason;
    lines.push(
      `${without} alternative${plural(without)} ${without === 1 ? "has" : "have"} no recovered reason: stored, but excluded from pre-emption, so they will never warn you about anything.`,
    );
  }
  if (preview.discarded > 0) {
    lines.push(
      `Discards ${preview.discarded}, recorded as ExtractionDiscarded so the precision denominator counts them.`,
    );
  }
  if (preview.contested > 0) {
    lines.push(
      `${preview.contested} item${plural(preview.contested)} are CONTESTED: parked rather than written, because a newcomer that cannot outrank every contradictor is not silently applied. Phase 2 turns these into revision proposals.`,
    );
  }
  if (preview.edited > 0) {
    lines.push(
      `${preview.edited} item${plural(preview.edited)} carry your wording at human_override authority (0.9), not the machine's.`,
    );
  }
  if (preview.uncertainDecisions > 0) {
    lines.push(
      `${preview.uncertainDecisions} decision${plural(preview.uncertainDecisions)} the identity ladder was unsure about — committing creates them as new nodes flagged needsReview.`,
    );
  }
  if (preview.conflicts.length > 0) {
    lines.push(
      `CONFLICTS with ${preview.conflicts.join(", ")} on the same variable with a different value. Committing does not resolve it; Phase 2's contradiction detector will, and until then both stay live.`,
    );
  }
  if (unreviewed > 0) {
    lines.push(
      `${unreviewed} item${plural(unreviewed)} are unreviewed and will NOT be committed. They stay in this run until you decide or clear it.`,
    );
  }

  lines.push(`Appends ${preview.events} events to the log.`);
  return lines.join("\n");
}

/** The one-line version, for the button label and the toast. */
export function summariseCommit(preview: CommitPreview): string {
  const parts: string[] = [];
  if (preview.newDecisions > 0) parts.push(`${preview.newDecisions} new`);
  if (preview.mergedDecisions + preview.mergedPremises > 0) {
    parts.push(`${preview.mergedDecisions + preview.mergedPremises} merged`);
  }
  if (preview.discarded > 0) parts.push(`${preview.discarded} discarded`);
  if (parts.length === 0) return "nothing reviewed";
  return `${parts.join(" · ")} → ${preview.events} events`;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/** Are there merge targets worth naming? The preview lists up to this many so the
 *  user can see WHICH nodes absorb the new evidence. */
export const MERGE_TARGETS_SHOWN = 4;

export function describeMergeTargets(preview: CommitPreview): string {
  if (preview.mergeTargets.length === 0) return "";
  const shown = preview.mergeTargets.slice(0, MERGE_TARGETS_SHOWN);
  const rest = preview.mergeTargets.length - shown.length;
  const list = shown.map((target) => `${target.id} (${target.label})`).join(", ");
  return rest > 0 ? `${list} and ${rest} more` : list;
}
