/**
 * Review actions — 1.9, the five things a human can do.
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * ---------------------------------------------------------------------------
 * FIVE ACTIONS, AND EACH ONE WRITES A DIFFERENT EVENT
 *
 *   approve       → the candidate becomes a node at `status: "proposed"`. It does
 *                   NOT become IN unless `viaBulk` is false — a bulk approval is not
 *                   a considered one, and the fold enforces that.
 *   edit          → the human's wording wins, at `origin: "human_override"`, and the
 *                   ORIGINAL extraction stays on the `DecisionProposed` event.
 *   discard       → `ExtractionDiscarded` with the human's reason. Recorded, because
 *                   the discard list is the denominator of the precision metric.
 *   merge-into    → the human overrides the identity ladder. Rung-4 merges are
 *                   flagged `needsReview` precisely so this action exists.
 *   contest       → the Hansson screening outcome: a newcomer that cannot outrank
 *                   every contradictor goes to the Contested queue rather than being
 *                   silently applied or silently dropped.
 *
 * There is no sixth action, and specifically no "approve as IN". Promoting a
 * decision to IN is a separate deliberate act with its own reason, available from
 * the decision card once the extraction is committed.
 *
 * ---------------------------------------------------------------------------
 * WHY EDITING RAISES AUTHORITY
 *
 * A human who edits an extraction has read it and changed it. That is stronger
 * evidence of ownership than a human who clicked approve on something that looked
 * right, so the edited item carries `human_override` (0.9) rather than
 * `human_stated` (1.0): it is the human's version of the MACHINE's sentence, not the
 * human's own sentence.
 *
 * The distinction matters because entrenchment reads it. An edited decision is
 * harder to retract than an approved one, which is correct — a human has already
 * looked at the words.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type {
  AlternativeCandidate,
  DecisionCandidate,
  DiscardedCandidate,
  PremiseCandidate,
} from "@/ai/types";
import type { ResolvedCandidate, ReviewAction } from "@/extraction/types";
import type { ReviewItem } from "./types";

/** An edit raises the item to the top of the range a machine extraction can reach.
 *  Not 1.0: the machine still found it, and a human correcting a wrong extraction
 *  into a right one is not the same act as a human stating it from scratch. */
export const EDITED_CONFIDENCE = asConfidence(0.95);

/* -------------------------------------------------------------------------- */
/* Constructors — the only way to build an action                             */
/* -------------------------------------------------------------------------- */

export const approve = (viaBulk = false): ReviewAction => ({ type: "approve", viaBulk });

export const edit = (
  fields: Readonly<Record<string, string | number | boolean | null>>,
): ReviewAction => ({ type: "edit", fields });

export const discard = (reason: string): ReviewAction => ({
  type: "discard",
  reason: reason.trim().length === 0 ? "discarded in review" : reason.trim(),
});

/** Override the identity ladder: this candidate IS that node. */
export const mergeInto = (targetId: DecisionId | PremiseId): ReviewAction => ({
  type: "merge-into",
  targetId,
});

/** Hansson screening: it cannot outrank its contradictors, so it waits. */
export const contest = (reason: string): ReviewAction => ({
  type: "contest",
  reason: reason.trim().length === 0 ? "contested in review" : reason.trim(),
});

/** Has a human decided this item? `commit.ts` refuses anything that has not. */
export function isActedOn(candidate: ResolvedCandidate): boolean {
  return candidate.action !== null;
}

/* -------------------------------------------------------------------------- */
/* Applying an action                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Apply one action to one candidate, returning the candidate as it will be
 * committed.
 *
 * The action is data, so applying it is a pure function: the same candidate and the
 * same action always produce the same result, which is what makes a review
 * resumable after a reload.
 */
export function applyAction(candidate: ResolvedCandidate, action: ReviewAction): ResolvedCandidate {
  const withAction: ResolvedCandidate = { ...candidate, action };

  switch (action.type) {
    case "edit":
      return applyEdit(withAction, action.fields);

    case "merge-into":
      return {
        ...withAction,
        resolution: {
          ...candidate.resolution,
          action: "merge",
          matchedId: action.targetId,
          score: 1,
          needsReview: false,
          explanation: `${candidate.resolution.explanation}. A human overrode the ladder and merged this onto ${action.targetId}.`,
        },
      };

    case "contest":
      return {
        ...withAction,
        resolution: {
          ...candidate.resolution,
          needsReview: true,
          explanation: `${candidate.resolution.explanation}. Contested: ${action.reason}`,
        },
      };

    case "approve":
    case "discard":
      return withAction;
  }
}

/**
 * Apply a human edit.
 *
 * The fields are a partial, so an untouched field keeps the machine's value. What
 * always changes is the ORIGIN and the CONFIDENCE, because a human has now read this
 * item — and an item a human has read is different evidence from one they have not.
 */
export function applyEdit(
  candidate: ResolvedCandidate,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): ResolvedCandidate {
  if (candidate.kind === "decision" && candidate.decision !== null) {
    return {
      ...candidate,
      decision: editDecision(candidate.decision, fields),
      origin: "human_override",
      confidence: EDITED_CONFIDENCE,
      tier: "high",
      resolution: {
        ...candidate.resolution,
        needsReview: false,
        explanation: `${candidate.resolution.explanation}. Edited by a human, so it is recorded at human_override authority.`,
      },
    };
  }

  if (candidate.kind === "premise" && candidate.premise !== null) {
    return {
      ...candidate,
      premise: editPremise(candidate.premise, fields),
      origin: "human_override",
      confidence: EDITED_CONFIDENCE,
      tier: "high",
    };
  }

  if (candidate.kind === "alternative" && candidate.alternative !== null) {
    return {
      ...candidate,
      alternative: editAlternative(candidate.alternative, fields),
      origin: "human_override",
      confidence: EDITED_CONFIDENCE,
      tier: "high",
    };
  }

  return candidate;
}

function editDecision(
  candidate: DecisionCandidate,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): DecisionCandidate {
  return {
    ...candidate,
    ...(stringField(fields, "variable") === null ? {} : { variable: stringField(fields, "variable") as DecisionCandidate["variable"] }),
    ...(stringField(fields, "value") === null ? {} : { value: stringField(fields, "value") as string }),
    ...(stringField(fields, "statement") === null ? {} : { statement: stringField(fields, "statement") as string }),
    ...(stringField(fields, "yStatement") === null ? {} : { yStatement: stringField(fields, "yStatement") as string }),
    ...(stringField(fields, "rationale") === null ? {} : { rationale: stringField(fields, "rationale") as string }),
    origin: "human_override",
    confidence: EDITED_CONFIDENCE,
    // An edited decision is asserted, not proposed: the human has said the words.
    // This is the one place `modality` is changed by the review rather than by the
    // modality detector, and it is correct — the human asserting it IS the evidence.
    modality: "asserted",
  };
}

function editPremise(
  candidate: PremiseCandidate,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): PremiseCandidate {
  return {
    ...candidate,
    ...(stringField(fields, "predicate") === null ? {} : { predicate: stringField(fields, "predicate") as string }),
    ...(stringField(fields, "text") === null ? {} : { text: stringField(fields, "text") as string }),
    ...(fields["value"] === undefined || fields["value"] === null ? {} : { value: fields["value"] as string | number | boolean }),
    confidence: EDITED_CONFIDENCE,
    // A human-confirmed premise no longer needs review. This is the only route to
    // `needsReview: false` in Phase 1, and it requires a person.
    needsReview: false,
  };
}

function editAlternative(
  candidate: AlternativeCandidate,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): AlternativeCandidate {
  return {
    ...candidate,
    ...(stringField(fields, "value") === null ? {} : { value: stringField(fields, "value") as string }),
    ...(stringField(fields, "whyRejected") === null ? {} : { whyRejected: stringField(fields, "whyRejected") as string }),
    confidence: EDITED_CONFIDENCE,
  };
}

function stringField(
  fields: Readonly<Record<string, string | number | boolean | null>>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Batch                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Apply one action to a batch.
 *
 * Bulk approve passes `viaBulk: true`, which the fold reads to KEEP THE LABEL AT
 * UNKNOWN. Ten decisions promoted to IN by one click is how a machine inference
 * ends up driving a cascade, so the fast path is fast without being authoritative.
 */
export function applyBatch(
  candidates: readonly ResolvedCandidate[],
  action: ReviewAction,
): readonly ResolvedCandidate[] {
  return candidates.map((candidate) => applyAction(candidate, action));
}

/** The discard event for one item. Keeps the confidence the item HAD, so the
 *  precision metric can be computed per tier: "of the items scored high, how many
 *  did the human discard?" is the number that says whether the rubric is calibrated. */
export function discardFrom(item: ReviewItem): DiscardedCandidate {
  return {
    kind: item.kind,
    discardedBy: "human",
    // The quote is preferred over the machine's summary: the discard list is what
    // Phase 7 reads to compute precision, and a paraphrase in it would make the
    // measurement measure the paraphraser.
    rawText: item.quote.length > 0 ? item.quote : item.detail,
    confidence: asConfidence(item.confidence),
  };
}

/**
 * Which decisions a batch would conflict with.
 *
 * Shown BEFORE the action is applied. Bulk-approving three items that each
 * contradict a live decision is the fastest way to put the graph into a state where
 * every subsequent contradiction check fires, and the user is told first.
 */
export function conflictsInBatch(candidates: readonly ResolvedCandidate[]): readonly DecisionId[] {
  const out = new Set<DecisionId>();
  for (const candidate of candidates) {
    for (const id of candidate.resolution.conflictsWith) out.add(id);
  }
  return [...out];
}

/** Can this item be bulk-approved? Mirrors `tierDecision.bulkApprovable` for the
 *  graph-sourced queue, where the tier is recomputed from the node's confidence. */
export function isBulkApprovable(item: ReviewItem): boolean {
  return item.kind === "decision" && item.tier === "high" && item.action === null;
}

/** The contested items, which is the Hansson queue in Phase 1's clothing: things
 *  that could not outrank a contradictor and are waiting for a human. */
export function contestedIn(candidates: readonly ResolvedCandidate[]): readonly ResolvedCandidate[] {
  return candidates.filter((candidate) => candidate.action?.type === "contest");
}

/** The keyboard map, exported so the component and the help panel cannot disagree
 *  about what a key does. */
export const REVIEW_KEYS: Readonly<Record<string, string>> = {
  j: "next item",
  k: "previous item",
  a: "approve",
  d: "discard",
  e: "edit",
  c: "contest",
  Enter: "approve and advance",
  Escape: "close the editor",
  "Shift+A": "approve every expanded item (bulk — stays UNKNOWN)",
  "Shift+D": "discard every collapsed item",
};

export function describeKeys(): string {
  return Object.entries(REVIEW_KEYS)
    .map(([key, meaning]) => `${key} — ${meaning}`)
    .join(" · ");
}

/** What an action says, in the words the audit trail will show. */
export function describeAction(action: ReviewAction | null): string {
  if (action === null) return "not reviewed";
  switch (action.type) {
    case "approve":
      return action.viaBulk
        ? "approved in bulk — recorded, but stays UNKNOWN until approved individually"
        : "approved";
    case "edit":
      return `edited: ${Object.keys(action.fields).join(", ")}`;
    case "discard":
      return `discarded — ${action.reason}`;
    case "merge-into":
      return `merged into ${action.targetId}, overriding the ladder`;
    case "contest":
      return `contested — ${action.reason}`;
  }
}
