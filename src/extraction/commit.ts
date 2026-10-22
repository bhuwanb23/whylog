/**
 * Commit — 1.9's write path. THE ENFORCEMENT POINT.
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * **Nothing enters the log unreviewed.**
 *
 * `commitReview` REFUSES an item with no `ReviewAction`. Not "accepts it at low
 * confidence", not "marks it needsReview" — refuses, and reports which items were
 * the problem. An extraction that has not been looked at by a person is a set of
 * guesses, and guesses in an append-only hash-chained log are worse than guesses in
 * a scratchpad: they cannot be deleted, they drive cascades, and they get exported
 * into `AGENTS.md` where an agent will obey them.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE BATCH
 *
 * A commit is all-or-nothing. Half a justification — a decision whose premise was
 * written but whose `JustificationAttached` was not — is worse than nothing,
 * because the decision looks justified while resting on nothing, and the cascade
 * has no edge to walk. `recordBatch` is already all-or-nothing; this module's job
 * is to build the batch so that its ordering makes the references resolvable.
 *
 * Ordering, therefore:
 *
 *   1. `PremiseAsserted`      — premises exist before anything refers to them
 *   2. `DecisionProposed`     — carries `premiseIds`, so premises come first
 *   3. `JustificationAttached`— carries the IN and OUT lists
 *   4. `AlternativeRejected`  — carries `decisionId`, so decisions come first
 *   5. the review events       — `DecisionApproved` / `DecisionEdited` /
 *                               `DecisionRejected` / `PremiseConfirmed` /
 *                               `PremiseCorrected`
 *   6. `ExtractionDiscarded`  — the precision denominator
 *
 * ---------------------------------------------------------------------------
 * THE IN/OUT SPLIT IS RECOVERED HERE, NOT CARRIED
 *
 * `DecisionCandidate.premiseRefs` is one list, because the engine interface has one
 * list. Splitting it into a justification's IN-list and OUT-list needs the
 * exclusion table, and the table is ontology data — so the split happens here, at
 * the boundary between candidates and events, where both are in scope. An OUT-list
 * entry is recognised by the marker `premise-linker.ts` writes into its text.
 *
 * ---------------------------------------------------------------------------
 * WHY `DecisionProposed` IS WRITTEN FOR DISCARDED ITEMS TOO
 *
 * It is not. A discarded item never becomes a node; it becomes an
 * `ExtractionDiscarded` event, which is the record that it was produced and
 * rejected. Writing the node and then rejecting it would leave a `status:
 * "rejected"` decision in the graph forever, polluting every projection that
 * counts decisions.
 * ---------------------------------------------------------------------------
 */

import type {
  AlternativeId,
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  EventId,
  ISODateString,
  JustificationId,
  PremiseId,
  TranscriptId,
} from "@/types/common";
import { asConfidence } from "@/types/common";
import type { Actor } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { Justification } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import {
  formatAlternativeId,
  formatDecisionId,
  formatEpisodeId,
  formatJustificationId,
  formatPremiseId,
} from "@/lib/ids";
import { isAccepted } from "./types";
import type { ResolvedCandidate, ReviewAction } from "./types";
import { isDerivedPremise } from "./review";

export interface CommitInput {
  readonly transcriptId: TranscriptId;
  readonly engine: EngineId;
  /** The transcript's own time. Every event in the batch carries it as
   *  `occurredAt`, so ordering uses VALID time (0.3) rather than the moment of
   *  import. Losing this would stamp every imported decision "now" and silently
   *  destroy the bi-temporal split for the whole pipeline. */
  readonly occurredAt: ISODateString;
  readonly items: readonly ResolvedCandidate[];
  /** Discards produced by the recognisers, which the human never saw. Recorded
   *  alongside the human's own discards so the denominator is complete. */
  readonly machineDiscards?: readonly {
    kind: "decision" | "premise" | "alternative";
    discardedBy: "confidence-threshold" | "modality" | "duplicate";
    rawText: string;
    confidence: Confidence;
  }[];
  readonly episodeIds?: readonly (EpisodeId | null)[];
  /** True when the human approved several decisions with one action. Sets
   *  `viaBulkApprove`, which the fold reads to KEEP THE LABEL AT UNKNOWN: a bulk
   *  approval is not a considered one, and promoting ten decisions to IN in a
   *  single click is how a machine inference ends up driving a cascade. */
  readonly viaBulkApprove?: boolean;
  readonly actor?: Actor;
}

export interface CommitOk {
  readonly ok: true;
  readonly drafts: readonly NewEvent<EventType>[];
  readonly counts: CommitCounts;
  /** The review events carry a `reason`, and every one of them says which item it
   *  was about. Exposed so the caller can show the batch before appending. */
  readonly reasons: readonly string[];
}

export interface CommitCounts {
  readonly premises: number;
  readonly decisions: number;
  readonly justifications: number;
  readonly alternatives: number;
  readonly approvals: number;
  readonly edits: number;
  readonly rejections: number;
  readonly premiseConfirmations: number;
  readonly discards: number;
  readonly events: number;
  /** How many justifications carry a non-empty OUT-list. The number of decisions
   *  from this transcript that gate (c) can fire on. */
  readonly nonMonotonic: number;
}

export type CommitFailure =
  | { readonly ok: false; readonly kind: "unreviewed"; readonly keys: readonly string[] }
  | { readonly ok: false; readonly kind: "empty" }
  | { readonly ok: false; readonly kind: "no-accepted" };

export type CommitResult = CommitOk | CommitFailure;

/** Placeholder for `Justification.informant.eventId`. The fold rewrites it to the
 *  real event id, because a batch producer cannot know the ids `appendBatch` will
 *  mint. See the `JustificationAttached` case in `materialize.ts`. */
const PLACEHOLDER_EVENT_ID = "EV-000000-000000" as EventId;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function commitReview(input: CommitInput, state: GraphState): CommitResult {
  const reviewed = input.items.filter((item) => item.action !== null);
  const unreviewed = input.items.filter((item) => item.action === null).map((item) => item.key);

  if (unreviewed.length > 0) {
    // The rule, enforced. See the file header.
    return { ok: false, kind: "unreviewed", keys: unreviewed };
  }
  if (reviewed.length === 0 && (input.machineDiscards?.length ?? 0) === 0) {
    return { ok: false, kind: "empty" };
  }

  // `contest` is not an acceptance and not a discard: it parks the item. Phase 2
  // turns the Contested queue into proposals; until then a contested item is
  // recorded as a discard so it does not silently vanish, with the human's reason.
  const accepted = reviewed.filter((item) => item.action !== null && item.action.type !== "discard" && item.action.type !== "contest");
  const rejected = reviewed.filter((item) => item.action?.type === "discard");
  const contested = reviewed.filter((item) => item.action?.type === "contest");
  if (accepted.length === 0 && rejected.length === 0 && contested.length === 0) {
    return { ok: false, kind: "no-accepted" };
  }

  const drafts: NewEvent<EventType>[] = [];
  const reasons: string[] = [];

  /* ---- id allocation, from the CURRENT counters ---- */
  // Derived from state rather than from a module-level counter, so a failed commit
  // leaves no gap and two commits in one session cannot collide.
  let premiseSeq = state.counters.premises;
  let decisionSeq = state.counters.decisions;
  let justificationSeq = state.counters.justifications;

  const premiseIds = new Map<string, PremiseId>();
  const decisionIds = new Map<string, DecisionId>();
  const alternativesByDecision = new Map<string, number>();

  const nextPremiseId = (): PremiseId => {
    premiseSeq += 1;
    return formatPremiseId(premiseSeq);
  };
  const nextDecisionId = (): DecisionId => {
    decisionSeq += 1;
    return formatDecisionId(decisionSeq);
  };

  /* ---- 1. premises ---- */
  let premiseCount = 0;
  let premiseConfirmations = 0;

  input.items.forEach((item) => {
    if (item.kind !== "premise" || item.premise === null || !isAccepted(item.action)) return;

    // A merge does not create a node: `PremiseAsserted` on an EXISTING id appends
    // evidence and takes the max confidence, which is what corroboration is.
    const id =
      item.resolution.action === "merge" && item.resolution.matchedId !== null
        ? (item.resolution.matchedId as PremiseId)
        : nextPremiseId();

    premiseIds.set(item.key, id);

    drafts.push({
      type: "PremiseAsserted",
      payload: {
        premiseId: id,
        transcriptId: input.transcriptId,
        type: item.premise.type,
        predicate: item.premise.predicate,
        ...(item.premise.value === undefined ? {} : { value: item.premise.value }),
        text: item.premise.text,
        confidence: item.confidence,
        engine: input.engine,
        snippet: item.premise.snippet,
      },
    });
    premiseCount += 1;

    if (item.action?.type === "edit") {
      drafts.push(reviewEvent("PremiseCorrected", {
        premiseId: id,
        fields: item.action.fields,
      }, `Premise ${id} corrected by hand: ${item.premise.predicate}`, reasons));
    } else {
      drafts.push(reviewEvent("PremiseConfirmed", { premiseId: id },
        `Premise ${id} confirmed: ${item.premise.text}`, reasons));
      premiseConfirmations += 1;
    }
  });

  /* ---- 2. decisions ---- */
  let decisionCount = 0;
  let approvals = 0;
  let edits = 0;

  input.items.forEach((item) => {
    if (item.kind !== "decision" || item.decision === null || !isAccepted(item.action)) return;

    const id =
      item.resolution.action === "merge" && item.resolution.matchedId !== null
        ? (item.resolution.matchedId as DecisionId)
        : nextDecisionId();

    decisionIds.set(item.key, id);

    const refs = resolvePremiseRefs(item.inRefs, input.items, premiseIds);
    const episodeId = episodeIdFor(item.episodeIndex, input.episodeIds, state);

    drafts.push({
      type: "DecisionProposed",
      payload: {
        decisionId: id,
        transcriptId: input.transcriptId,
        episodeId,
        variable: item.decision.variable,
        value: item.decision.value,
        statement: item.decision.statement,
        ...(item.decision.rationale === undefined ? {} : { rationale: item.decision.rationale }),
        ...(item.decision.acceptedDownside === undefined ? {} : { acceptedDownside: item.decision.acceptedDownside }),
        origin: item.origin,
        modality: item.decision.modality,
        confidence: item.confidence,
        engine: input.engine,
        snippet: item.decision.snippet,
        premiseIds: refs.all,
        alternativeIds: [],
        ...(item.decision.yStatement === undefined ? {} : { yStatement: item.decision.yStatement }),
        ...(item.decision.appliesTo.length === 0 ? {} : { appliesTo: item.decision.appliesTo }),
        // `episode` is deliberately NOT supplied. A candidate carries no turn
        // indices, and inventing a range from the snippet's character offsets would
        // put turn numbers where character numbers belong. The fold synthesises an
        // episode from the decision's own snippet, which is a real range in a real
        // transcript; `episodeIds` above is what names it.
      },
    });
    decisionCount += 1;

    /* ---- 3. justification, immediately after its decision ---- */
    if (refs.inList.length > 0 || refs.outList.length > 0) {
      justificationSeq += 1;
      const justificationId = formatJustificationId(justificationSeq);
      const justification: Justification = {
        id: justificationId,
        consequent: id,
        inList: refs.inList,
        outList: refs.outList,
        informant: { kind: "extraction", engine: input.engine, eventId: PLACEHOLDER_EVENT_ID },
        createdAt: input.occurredAt,
      };

      drafts.push({
        type: "JustificationAttached",
        payload: { justificationId, consequent: id, justification },
        // A STATE_CHANGING event, so `reason` is mandatory. It states what the
        // justification rests on, which is the sentence a user reads when gate (c)
        // fires six months later.
        reason: justificationReason(justification),
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        occurredAt: input.occurredAt,
      });
      reasons.push(justificationReason(justification));
    }

    /* ---- 5. the review event ---- */
    if (item.action?.type === "edit") {
      drafts.push(reviewEvent("DecisionEdited", {
        decisionId: id,
        fields: item.action.fields,
      }, `Decision ${id} (${item.decision.variable} → ${item.decision.value}) edited by hand before acceptance`, reasons));
      edits += 1;
    } else {
      const viaBulk = item.action?.type === "approve" ? item.action.viaBulk : input.viaBulkApprove === true;
      drafts.push(reviewEvent("DecisionApproved", {
        decisionId: id,
        viaBulkApprove: viaBulk,
      }, approvalReason(item, viaBulk), reasons));
      approvals += 1;
    }
  });

  /* ---- 4. alternatives, after their decisions ---- */
  let alternativeCount = 0;

  input.items.forEach((item) => {
    if (item.kind !== "alternative" || item.alternative === null || !isAccepted(item.action)) return;

    const decisionKey = `decision:${item.alternative.decisionRef}`;
    const decisionId = decisionIds.get(decisionKey);
    if (decisionId === undefined) return; // its decision was discarded, so it has nothing to be an alternative TO

    const seq = (alternativesByDecision.get(decisionId) ?? 0) + 1;
    alternativesByDecision.set(decisionId, seq);
    const alternativeId: AlternativeId = formatAlternativeId(decisionId, seq);

    drafts.push({
      type: "AlternativeRejected",
      payload: {
        alternativeId,
        decisionId,
        variable: item.alternative.variable,
        value: item.alternative.value,
        ...(item.alternative.whyRejected === undefined ? {} : { whyRejected: item.alternative.whyRejected }),
        confidence: item.confidence,
        engine: input.engine,
        snippet: item.alternative.snippet,
      },
    });
    alternativeCount += 1;
  });

  /* ---- 6. discards ---- */
  let discardCount = 0;

  for (const item of [...rejected, ...contested]) {
    const action = item.action;
    drafts.push({
      type: "ExtractionDiscarded",
      payload: {
        candidateKind: item.kind,
        discardedBy: "human",
        // A contested item is recorded as a discard with its reason attached, so it
        // survives the run instead of vanishing when the queue is cleared. Phase 2
        // reads these back out of the log to build the Contested queue properly.
        rawText: contestedReason(action, item.snippet.text, item.key),
        confidence: asConfidence(item.confidence),
      },
    });
    discardCount += 1;
  }

  for (const discard of input.machineDiscards ?? []) {
    drafts.push({
      type: "ExtractionDiscarded",
      payload: {
        candidateKind: discard.kind,
        discardedBy: discard.discardedBy,
        rawText: discard.rawText,
        confidence: discard.confidence,
      },
    });
    discardCount += 1;
  }

  const nonMonotonic = drafts.filter(
    (draft) =>
      draft.type === "JustificationAttached" &&
      draft.payload.justification.outList.length > 0,
  ).length;

  return {
    ok: true,
    drafts,
    reasons,
    counts: {
      premises: premiseCount,
      decisions: decisionCount,
      justifications: justificationSeq - state.counters.justifications,
      alternatives: alternativeCount,
      approvals,
      edits,
      rejections: rejected.length,
      premiseConfirmations,
      discards: discardCount,
      events: drafts.length,
      nonMonotonic,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Justification lists                                                        */
/* -------------------------------------------------------------------------- */

interface ResolvedRefs {
  /** IN-list and OUT-list together, in the order the candidate listed them. This
   *  is what `DecisionProposed.premiseIds` carries. */
  readonly all: readonly PremiseId[];
  readonly inList: readonly PremiseId[];
  readonly outList: readonly PremiseId[];
}

/**
 * Turn local premise indices into ids, split into IN and OUT.
 *
 * The split is by the derived-premise marker: an OUT-list entry was inferred from
 * another premise rather than quoted, and `premise-linker.ts` says so in its text.
 * A premise the human DISCARDED is dropped from both lists rather than referenced
 * by id — a justification that points at a premise nobody accepted rests on
 * nothing, and "rests on nothing" is indistinguishable from "rests on something
 * unrecorded" once the graph is written.
 */
function resolvePremiseRefs(
  refs: readonly number[],
  items: readonly ResolvedCandidate[],
  premiseIds: ReadonlyMap<string, PremiseId>,
): ResolvedRefs {
  const all: PremiseId[] = [];
  const inList: PremiseId[] = [];
  const outList: PremiseId[] = [];

  for (const ref of refs) {
    const item = items.find((candidate) => candidate.key === `premise:${ref}`);
    if (item === undefined || item.premise === null) continue;
    if (!isAccepted(item.action)) continue;

    const id = premiseIds.get(item.key);
    if (id === undefined) continue;

    all.push(id);
    if (isDerivedPremise(item.premise.predicate, item.premise.text)) outList.push(id);
    else inList.push(id);
  }

  return { all, inList, outList };
}

function justificationReason(justification: Justification): string {
  const parts = [`${justification.inList.length} supporting premise${justification.inList.length === 1 ? "" : "s"}`];
  if (justification.outList.length > 0) {
    parts.push(
      `${justification.outList.length} excluded condition${justification.outList.length === 1 ? "" : "s"} — non-monotonic, so it can be invalidated by the world rather than only by a contradiction`,
    );
  }
  return `Attaching a justification for ${justification.consequent}: ${parts.join(", ")}.`;
}

/* -------------------------------------------------------------------------- */
/* Review events                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A review event with its reason.
 *
 * Every one of the five review types is STATE_CHANGING, so `reason` is mandatory —
 * and it should say WHICH item it was about, because the reason is what the audit
 * trail shows six months later when somebody asks why a decision is IN.
 */
function reviewEvent<T extends "DecisionApproved" | "DecisionEdited" | "DecisionRejected" | "PremiseConfirmed" | "PremiseCorrected">(
  type: T,
  payload: NewEvent<T>["payload"],
  reason: string,
  reasons: string[],
): NewEvent<T> {
  reasons.push(reason);
  return { type, payload, reason };
}

function approvalReason(item: ResolvedCandidate, bulk: boolean): string {
  const label = item.decision === null ? item.key : `${item.decision.variable} → ${item.decision.value}`;
  return bulk
    ? `Approved ${label} in a bulk action, so it stays UNKNOWN rather than IN until it is approved individually.`
    : `Approved ${label}: the extraction is accepted and the decision is asserted.`;
}

/** A contested item's raw text carries its reason, because `ExtractionDiscarded`
 *  has no reason field and the reason is the only thing that distinguishes "the
 *  human disagreed" from "the human is not sure yet". */
function contestedReason(action: ReviewAction | null, snippet: string, fallback: string): string {
  const base = snippet.length > 0 ? snippet : fallback;
  if (action?.type === "contest") return `CONTESTED: ${action.reason} — ${base}`;
  if (action?.type === "discard") return `DISCARDED: ${action.reason} — ${base}`;
  return base;
}

/* -------------------------------------------------------------------------- */
/* Episodes                                                                   */
/* -------------------------------------------------------------------------- */

function episodeIdFor(
  episodeIndex: number,
  episodeIds: readonly (EpisodeId | null)[] | undefined,
  state: GraphState,
): EpisodeId {
  const supplied = episodeIds?.[episodeIndex] ?? null;
  if (supplied !== null) return supplied;
  // The fold synthesises an episode from the decision's own snippet when the event
  // names one that does not exist, so the safest fallback is the next id in
  // sequence rather than a guess at an existing one.
  return formatEpisodeId(state.counters.episodes + Math.max(1, episodeIndex + 1));
}


export { PLACEHOLDER_EVENT_ID };
