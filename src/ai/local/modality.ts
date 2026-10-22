/**
 * Modality ΓÇö 1.3, component 4.
 *
 * Phase 1 ┬╖ sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.3
 *
 * ---------------------------------------------------------------------------
 * THE SINGLE FIELD THAT PREVENTS MOST EXTRACTION-DRIVEN FALSE CONTRADICTIONS
 *
 * **Only `asserted` modality creates an IN-labelled node.** Everything else starts
 * UNKNOWN and can only be promoted by a human approval (`DecisionApproved` with
 * `viaBulkApprove: false`). See `src/substrate/materialize.ts`.
 *
 * Without this, "what if we used Redis?" becomes a Redis decision, and three
 * sessions later the real Redis decision contradicts it. The user sees a
 * contradiction the system invented out of a question they asked, and disables the
 * feature. That is risk R3 in `plan/OVERVIEW.md`, and modality is the mitigation.
 *
 * ---------------------------------------------------------------------------
 * PRECEDENCE IS DELIBERATE
 *
 * hypothetical > proposed > reported > asserted.
 *
 * When a clause carries markers of two kinds, the WEAKER commitment wins, because
 * the cost is asymmetric: labelling a real decision `proposed` costs one human
 * click at review, while labelling a musing `asserted` costs a false contradiction
 * that the user cannot distinguish from a real one.
 *
 * ---------------------------------------------------------------------------
 * SCOPE IS THE CLAUSE, NOT THE TURN
 *
 * "yeah ok. going with SQLite, not Postgres." ΓÇö the acceptance is in the turn but
 * not in the clause that carries the cue, and that clause IS assertive. Scanning
 * the whole turn would find no hypothetical markers here, but in "what if we used
 * Redis? actually no, going with SQLite" it would find "what if" and mislabel the
 * decision. So markers are sought in the clause containing the cue, plus the
 * sentence before it (which is where a hedge usually sits).
 * ---------------------------------------------------------------------------
 */

import type { Modality } from "@/types/domain";
import type { CueHit } from "@/extraction/cue-scan";

export interface ModalityEvidence {
  readonly modality: Modality;
  /** Which marker decided it, verbatim. Shown in the review UI: a modality the
   *  user disagrees with must be arguable, and "because the text says 'what if'"
   *  is arguable in a way that a bare label is not. */
  readonly marker: string | null;
  readonly scope: string;
  /** The cue table's own speculative flag, kept separate because it is evidence
   *  about the CUE and the markers are evidence about the SENTENCE. */
  readonly cueSpeculative: boolean;
}

/* -------------------------------------------------------------------------- */
/* Markers                                                                    */
/* -------------------------------------------------------------------------- */

interface MarkerSet {
  readonly modality: Modality;
  readonly patterns: readonly RegExp[];
}

const HYPOTHETICAL: readonly RegExp[] = [
  /\bwhat if\b/i,
  /\bwhat would happen if\b/i,
  /\bif we (?:used|use|went|switch(?:ed)?|tried|had|added|did)\b/i,
  /\bif we were to\b/i,
  /\bsuppos(?:e|ing)\b/i,
  /\bhypothetical(?:ly)?\b/i,
  /\bjust (?:for argument|to explore|thinking out loud)\b/i,
  /\bplay(?:ing)? devil'?s advocate\b/i,
  /\bimagine (?:we|if)\b/i,
  /\bwould (?:that|this|it) work\b/i,
  /\bcould we (?:use|try|just|maybe)\b/i,
  /\bcan we (?:use|try)\b.*\?\s*$/,
  /\bis there any (?:way|reason) we (?:could|might)\b/i,
  /\bnot saying we should\b/i,
  /\bno commitment\b/i,
];

const PROPOSED: readonly RegExp[] = [
  /\b(?:we|i|you) (?:could|might|may|can) (?:use|go with|try|switch to|adopt|consider|move to)\b/i,
  /\b(?:i'?d|i would|we'?d|we would) (?:suggest|recommend|propose|go with|use|lean)\b/i,
  /\bconsider(?:ing)? (?:using|going with|switching to)?\b/i,
  /\bhow about\b/i,
  /\bwhat about\b/i,
  /\bperhaps (?:we|use|going)\b/i,
  /\bmaybe (?:we|use|going|switch)\b/i,
  /\bone option (?:is|would be)\b/i,
  /\banother option\b/i,
  /\bwould (?:work|be (?:a|an|the) (?:good|better) (?:fit|choice|option))\b/i,
  /\bif you want(?:ed)?\b/i,
  /\bsomething to consider\b/i,
  /\bworth considering\b/i,
  /\bmy recommendation (?:is|would be)\b/i,
  /\bshall we\b/i,
  /\bshould we\b/i,
];

/** Someone else's decision, quoted. Real, but not THIS project's ΓÇö reporting it as
 *  asserted would make the log claim a decision nobody here made. */
const REPORTED: readonly RegExp[] = [
  /\b(?:they|the team|the client|management|someone|people) (?:said|decided|want|wants|chose|picked|told)\b/i,
  /\bi (?:was|were) told\b/i,
  /\bapparently\b/i,
  /\bi heard\b/i,
  /\bthe word is\b/i,
  /\baccording to\b/i,
  /\bupstream (?:decided|chose|went)\b/i,
  /\bthe (?:docs?|readme|rfc|adr|ticket|issue) (?:says?|said|recommends?|suggests?)\b/i,
  /\blegacy decision\b/i,
  /\binherited (?:decision|choice)\b/i,
  /\bhistorically we\b/i,
];

const MARKER_SETS: readonly MarkerSet[] = [
  { modality: "hypothetical", patterns: HYPOTHETICAL },
  { modality: "proposed", patterns: PROPOSED },
  { modality: "reported", patterns: REPORTED },
];

/** A clause that is unambiguously COMMITTED, and outranks a weak hedge nearby.
 *  Past tense and first-person plural commitment are the strongest assertive
 *  signals English gives us here. */
const COMMITTED: readonly RegExp[] = [
  /\b(?:we|i|let'?s) (?:decided|went|chose|picked|settled|agreed|committed|landed on)\b/i,
  /\bdecided (?:to|on|against)\b/i,
  /\b(?:we'?re|i'?m|let'?s) going with\b/i,
  /\bgoing with\b/i,
  /\bwe'?ll go with\b/i,
  /\b(?:it'?s|its) settled\b/i,
  /\bfinal (?:answer|decision|call)\b/i,
  /\bdone deal\b/i,
  /\bship(?:ping)? it\b/i,
  /\b(?:switched|moved|migrated) to\b/i,
  /\bsticking with\b/i,
  /\bwe use\b/i,
  /\bwe'?re using\b/i,
];

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

const CLAUSE_BREAK = /[.!?\n;]/;

/**
 * The text modality is judged on: the clause containing the cue, plus the one
 * before it.
 *
 * Returns the scope and the cue's offset WITHIN it, so a caller that needs to
 * look at what follows the cue can do so without recomputing.
 */
export function modalityScope(turnText: string, hit: CueHit): { scope: string; cueAt: number } {
  const before = lastBreakBefore(turnText, hit.start);
  const previousStart = lastBreakBefore(turnText, before - 1);

  let end = hit.end;
  while (end < turnText.length && !CLAUSE_BREAK.test(turnText[end] ?? "")) end += 1;

  const scope = turnText.slice(previousStart, end);
  return { scope, cueAt: hit.start - previousStart };
}

function lastBreakBefore(text: string, from: number): number {
  for (let i = Math.min(from, text.length) - 1; i >= 0; i -= 1) {
    if (CLAUSE_BREAK.test(text[i] ?? "")) return i + 1;
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Classify one cue occurrence.
 *
 * @param turnText the full turn body ΓÇö used only to find the clause
 * @param hit      the cue, with its `speculative` flag from the ontology table
 * @param speaker  a question from a human is far more likely to be hypothetical
 *                 than the same words from an agent, which is answering one
 */
export function classifyModality(
  turnText: string,
  hit: CueHit,
  speaker: "human" | "agent" | "unknown" = "unknown",
): ModalityEvidence {
  const { scope, cueAt } = modalityScope(turnText, hit);

  // Weakest-commitment-wins, checked in precedence order.
  for (const set of MARKER_SETS) {
    for (const pattern of set.patterns) {
      const match = pattern.exec(scope);
      if (match === null) continue;

      // A marker AFTER the cue is usually the next thought, not a hedge on this
      // one: "going with SQLite ΓÇö what if we need multi-user later?" is an
      // asserted decision with a hypothetical worry attached.
      const at = match.index;
      if (at > cueAt + hit.phrase.length && set.modality !== "reported") continue;

      return {
        modality: set.modality,
        marker: match[0].trim(),
        scope: scope.trim(),
        cueSpeculative: hit.speculative,
      };
    }
  }

  // The cue table's own flag: "what if", "we could", "consider" are listed as
  // speculative there, and the table is the data an eval can tune.
  if (hit.speculative) {
    return {
      modality: "proposed",
      marker: hit.phrase,
      scope: scope.trim(),
      cueSpeculative: true,
    };
  }

  // A human asking a question with no assertive marker is exploring, not deciding.
  if (speaker === "human" && isQuestion(scope, cueAt) && !hasCommittedMarker(scope)) {
    return {
      modality: "hypothetical",
      marker: "?",
      scope: scope.trim(),
      cueSpeculative: false,
    };
  }

  const committed = firstCommittedMarker(scope);
  return {
    modality: "asserted",
    marker: committed,
    scope: scope.trim(),
    cueSpeculative: false,
  };
}

function isQuestion(scope: string, cueAt: number): boolean {
  const after = scope.slice(cueAt);
  return /\?/.test(after);
}

function hasCommittedMarker(scope: string): boolean {
  return COMMITTED.some((pattern) => pattern.test(scope));
}

function firstCommittedMarker(scope: string): string | null {
  for (const pattern of COMMITTED) {
    const match = pattern.exec(scope);
    if (match !== null) return match[0].trim();
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export const MODALITY_EXPLANATIONS: Readonly<Record<Modality, string>> = {
  asserted: "Committed. Creates an IN-labelled node on approval.",
  proposed: "A proposal, not a commitment. Starts UNKNOWN and needs a human approval to become IN.",
  hypothetical: "Exploration or a question. Starts UNKNOWN; it must never contradict a real decision.",
  reported: "Somebody else's decision, quoted. Recorded as context, not as this project's commitment.",
};

export function describeModality(evidence: ModalityEvidence): string {
  const why =
    evidence.marker === null
      ? "no hedge found in the clause"
      : `because the clause contains "${evidence.marker}"`;
  return `${evidence.modality} ΓÇö ${why}. ${MODALITY_EXPLANATIONS[evidence.modality]}`;
}

/** Marker counts, for the eval harness: a modality classifier that only ever
 *  returns `asserted` is not filtering anything, and that is measurable. */
export function markerInventorySize(): Readonly<Record<Modality, number>> {
  return {
    asserted: COMMITTED.length,
    proposed: PROPOSED.length,
    hypothetical: HYPOTHETICAL.length,
    reported: REPORTED.length,
  };
}
