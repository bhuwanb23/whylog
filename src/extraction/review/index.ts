/**
 * The review model — 1.9.
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * ---------------------------------------------------------------------------
 * THE QUEUE IS SORTED FOR REJECTION, NOT FOR ACCEPTANCE
 *
 * Extraction over-generates: ARGUS measured 155 false positives against 12 false
 * negatives, a 13:1 ratio (docs/05). So the review surface is optimised to make
 * saying NO cheap — collapsed rows, one-click discard, `j`/`k`/`d`/`a` keys — and
 * only incidentally easy to say yes to.
 *
 * That is a design decision with a measurable consequence, and it is the right one:
 * the cost of a wrong approval is a false node in the log that later drives a
 * cascade, while the cost of a wrong discard is losing an inference the user can
 * re-extract in one click.
 *
 * ---------------------------------------------------------------------------
 * TWO SOURCES, ONE QUEUE
 *
 * Before a commit the queue is the EXTRACTION RUN: candidates with no ids yet,
 * living in `store/extraction.ts`. After a commit it is the GRAPH: real nodes at
 * `status === "proposed"`, reached via `state.pendingReview`. Both have to render
 * in the same component with the same affordances, so both are projected onto one
 * shape here.
 *
 * They are NOT the same items and the queue is not additive: committing moves items
 * from the first representation to the second. A UI that showed both would show
 * every decision twice.
 * ---------------------------------------------------------------------------
 */

import type { Decision, Premise, RejectedAlternative } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import type { ExtractionRun } from "@/extraction/types";
import type { ResolvedCandidate } from "@/extraction/types";
import type { ConfidenceTier, ReviewFilter, ReviewItem, ReviewQueueOptions, ReviewSort } from "./types";
import { tierOf } from "@/extraction/types";



/* -------------------------------------------------------------------------- */
/* From an uncommitted run                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Project a run's candidates onto review items.
 *
 * Called before a commit. The items have no ids, so `accept` on one of them means
 * "write the events", and `discard` means "write an `ExtractionDiscarded`".
 */
export function queueFromRun(
  run: ExtractionRun,
  candidates: readonly ResolvedCandidate[],
): readonly ReviewItem[] {
  return candidates.map((candidate) => itemFromCandidate(run, candidate));
}

function itemFromCandidate(run: ExtractionRun, candidate: ResolvedCandidate): ReviewItem {
  const base = {
    key: candidate.key,
    id: null,
    quote: candidate.snippet.text,
    confidence: candidate.confidence,
    tier: candidate.tier,
    origin: candidate.origin.replace(/_/g, " "),
    engine: run.engine.model,
    expanded: candidate.tier !== "low",
    resolution: candidate.resolution.explanation,
    conflictsWith: candidate.resolution.conflictsWith,
    action: null,
  };

  if (candidate.kind === "decision" && candidate.decision !== null) {
    const decision = candidate.decision;
    return {
      ...base,
      kind: "decision",
      title: `${decision.variable} → ${decision.value}`,
      detail: decision.yStatement ?? decision.statement,
      derived: false,
    };
  }

  if (candidate.kind === "premise" && candidate.premise !== null) {
    const premise = candidate.premise;
    const derived = isDerivedPremise(premise.predicate, premise.text);
    return {
      ...base,
      kind: "premise",
      title: `${premise.type}.${premise.predicate}`,
      detail: premise.text,
      derived,
      // A derived premise is an inference from another premise, so it is never
      // expanded by default even at high confidence.
      expanded: base.expanded && !derived,
    };
  }

  if (candidate.kind === "alternative" && candidate.alternative !== null) {
    const alternative = candidate.alternative;
    return {
      ...base,
      kind: "alternative",
      title: `rejected: ${alternative.value}`,
      detail: alternative.whyRejected ?? "no reason recovered — stored, but it will never pre-empt",
      derived: false,
      // Alternatives are never expanded, at any tier. Published precision is 15.4%.
      expanded: false,
    };
  }

  return { ...base, kind: candidate.kind, title: candidate.key, detail: "", derived: false };
}

/**
 * Is this premise an OUT-list entry rather than a quoted one?
 *
 * Detected from the text marker `premise-linker.ts` writes, because the marker is
 * the only place the derivation is recorded — a `PremiseCandidate` has no field for
 * it, and adding one would mean widening the engine interface for a local-engine
 * concern.
 */
export function isDerivedPremise(_predicate: string, text: string): boolean {
  // `hasExclusion(predicate)` is deliberately NOT part of this test: a SUPPORTING
  // premise can also have an exclusion rule (that is how its OUT-list entry is
  // derived), so the predicate alone cannot distinguish the two. Only the marker
  // can.
  return text.includes("— excluded by");
}

/* -------------------------------------------------------------------------- */
/* From the graph                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Project the graph's review queues onto review items.
 *
 * Called after a commit. These are real nodes, so `accept` means
 * `DecisionApproved` and `discard` means `DecisionSuperseded` or
 * `PremiseRetracted` — different events, same button.
 */
export function queueFromState(state: GraphState): readonly ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const id of state.pendingReview) {
    const decision = state.decisions.get(id);
    if (decision === undefined) continue;
    items.push(itemFromDecision(decision));
  }

  for (const id of state.pendingPremises) {
    const premise = state.premises.get(id);
    if (premise === undefined) continue;
    items.push(itemFromPremise(premise));
  }

  for (const alternative of state.alternatives.values()) {
    if (alternative.provenance === undefined) continue;
    items.push(itemFromAlternative(alternative));
  }

  return items;
}

function itemFromDecision(decision: Decision): ReviewItem {
  const confidence = decision.provenance?.confidence ?? 0.5;
  return {
    key: decision.id,
    kind: "decision",
    id: decision.id,
    title: `${decision.variable} → ${decision.value}`,
    detail: decision.yStatement ?? decision.statement,
    quote: decision.provenance?.snippet.text ?? "",
    confidence,
    tier: tierOf(confidence),
    origin: decision.provenance?.origin.replace(/_/g, " ") ?? "unknown",
    engine: decision.provenance?.extractedBy.model ?? "unknown",
    expanded: tierOf(confidence) !== "low",
    resolution: decision.status === "proposed" ? "awaiting approval" : decision.status,
    conflictsWith: [],
    derived: false,
    action: null,
  };
}

function itemFromPremise(premise: Premise): ReviewItem {
  const confidence = premise.confidence;
  const derived = isDerivedPremise(premise.predicate, premise.text);
  return {
    key: premise.id,
    kind: "premise",
    id: premise.id,
    title: `${premise.type}.${premise.predicate}`,
    detail: premise.text,
    quote: premise.evidence[0]?.snippet.text ?? "",
    confidence,
    tier: tierOf(confidence),
    origin: premise.origin.replace(/_/g, " "),
    engine: premise.extractedBy.model,
    expanded: tierOf(confidence) !== "low" && !derived,
    resolution: `corroborated ${premise.corroboration}×`,
    conflictsWith: [],
    derived,
    action: null,
  };
}

function itemFromAlternative(alternative: RejectedAlternative): ReviewItem {
  const confidence = alternative.confidence;
  return {
    key: alternative.id,
    kind: "alternative",
    id: alternative.id,
    title: `rejected: ${alternative.value}`,
    detail: alternative.whyRejected ?? "no reason recovered — stored, but it will never pre-empt",
    quote: alternative.provenance?.snippet.text ?? "",
    confidence,
    tier: tierOf(confidence),
    origin: alternative.provenance?.origin.replace(/_/g, " ") ?? "unknown",
    engine: alternative.provenance?.extractedBy.model ?? "unknown",
    expanded: false,
    resolution: `against ${alternative.decisionId}`,
    conflictsWith: [],
    derived: false,
    action: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Filtering and sorting                                                      */
/* -------------------------------------------------------------------------- */

export function filterQueue(
  items: readonly ReviewItem[],
  options: ReviewQueueOptions,
): readonly ReviewItem[] {
  const search = options.search.trim().toLowerCase();

  return items.filter((item) => {
    if (options.filter === "unreviewed" && item.action !== null) return false;

    switch (options.filter) {
      case "decisions":
        if (item.kind !== "decision") return false;
        break;
      case "premises":
        if (item.kind !== "premise") return false;
        break;
      case "alternatives":
        if (item.kind !== "alternative") return false;
        break;
      case "conflicts":
        if (item.conflictsWith.length === 0) return false;
        break;
      case "derived":
        if (!item.derived) return false;
        break;
      case "low":
        if (item.tier !== "low") return false;
        break;
      case "all":
      case "unreviewed":
        break;
    }

    if (search.length === 0) return true;
    return (
      item.title.toLowerCase().includes(search) ||
      item.detail.toLowerCase().includes(search) ||
      item.quote.toLowerCase().includes(search)
    );
  });
}

export function sortQueue(items: readonly ReviewItem[], sort: ReviewSort): readonly ReviewItem[] {
  const copy = [...items];

  switch (sort) {
    case "confidence-desc":
      copy.sort((a, b) => b.confidence - a.confidence || a.key.localeCompare(b.key));
      break;
    case "confidence-asc":
      copy.sort((a, b) => a.confidence - b.confidence || a.key.localeCompare(b.key));
      break;
    case "kind":
      copy.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.confidence - a.confidence);
      break;
    case "conflicts-first":
      copy.sort(
        (a, b) =>
          Number(b.conflictsWith.length > 0) - Number(a.conflictsWith.length > 0) ||
          b.confidence - a.confidence,
      );
      break;
  }

  return copy;
}

function kindRank(kind: ReviewItem["kind"]): number {
  return kind === "decision" ? 0 : kind === "premise" ? 1 : 2;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export interface QueueSummary {
  readonly total: number;
  readonly decisions: number;
  readonly premises: number;
  readonly alternatives: number;
  readonly derived: number;
  readonly conflicts: number;
  readonly low: number;
  readonly expanded: number;
  readonly reviewed: number;
  readonly accepted: number;
  readonly edited: number;
  readonly discarded: number;
}

export function summariseQueue(items: readonly ReviewItem[]): QueueSummary {
  const count = (predicate: (item: ReviewItem) => boolean): number => items.filter(predicate).length;

  return {
    total: items.length,
    decisions: count((i) => i.kind === "decision"),
    premises: count((i) => i.kind === "premise"),
    alternatives: count((i) => i.kind === "alternative"),
    derived: count((i) => i.derived),
    conflicts: count((i) => i.conflictsWith.length > 0),
    low: count((i) => i.tier === "low"),
    expanded: count((i) => i.expanded),
    reviewed: count((i) => i.action !== null),
    accepted: count((i) => i.action?.type === "approve"),
    edited: count((i) => i.action?.type === "edit"),
    discarded: count((i) => i.action?.type === "discard"),
  };
}

/**
 * The sentence above the queue.
 *
 * Written to tell the user how long this will take and what most of it probably is,
 * because a queue of 40 items where 30 are collapsed low-tier is a 90-second job and
 * a queue of 40 expanded decisions is a ten-minute one.
 */
export function describeQueue(summary: QueueSummary): string {
  if (summary.total === 0) return "nothing to review";

  const parts = [
    `${summary.total} item${summary.total === 1 ? "" : "s"} — ${summary.decisions} decisions, ${summary.premises} premises, ${summary.alternatives} alternatives`,
  ];
  if (summary.expanded > 0) parts.push(`${summary.expanded} expanded`);
  if (summary.low > 0) parts.push(`${summary.low} collapsed as low-confidence, probably wrong`);
  if (summary.derived > 0) parts.push(`${summary.derived} derived rather than quoted — read those`);
  if (summary.conflicts > 0) parts.push(`${summary.conflicts} conflict with a live decision`);
  if (summary.reviewed > 0) {
    parts.push(`${summary.reviewed} reviewed (${summary.accepted} accepted, ${summary.edited} edited, ${summary.discarded} discarded)`);
  }
  return parts.join(" · ");
}

export const REVIEW_FILTERS: readonly { readonly id: ReviewFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "decisions", label: "Decisions" },
  { id: "premises", label: "Premises" },
  { id: "alternatives", label: "Alternatives" },
  { id: "conflicts", label: "Conflicts" },
  { id: "derived", label: "Derived" },
  { id: "low", label: "Low confidence" },
];

/* -------------------------------------------------------------------------- */
/* The barrel                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `src/extraction/review/index.ts` IS the review model, and it also re-exports the
 * other two review modules.
 *
 * That is unusual for a barrel and deliberate here: the model, the actions and the
 * commit preview are one feature seen from three angles, and a caller that has to
 * know which of the three files a function lives in has been made to understand the
 * implementation. `import { review } from "@/extraction"` gives them all of it.
 */

export {
  EDITED_CONFIDENCE,
  REVIEW_KEYS,
  applyAction,
  applyBatch,
  applyEdit,
  approve,
  contest,
  contestedIn,
  conflictsInBatch,
  describeAction,
  describeKeys,
  discard,
  discardFrom,
  edit,
  isActedOn,
  isBulkApprovable,
  mergeInto,
} from "./actions";

export {
  MERGE_TARGETS_SHOWN,
  describeCommit,
  describeMergeTargets,
  previewCommit,
  summariseCommit,
  type CommitPreview,
} from "./diff";

/* Re-exported so `@/extraction/review` remains the one import a caller needs. */
export type { ReviewFilter, ReviewItem, ReviewQueueOptions, ReviewSort } from "./types";
export { DEFAULT_REVIEW_OPTIONS } from "./types";
