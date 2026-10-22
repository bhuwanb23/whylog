/**
 * The internal contracts of the extraction pipeline.
 *
 * Phase 1 ┬╖ all sub-phases
 * Plan: plan/phase-1-extraction-pipeline.md ┬╖ notes/PHASE-1-PLAN.md ┬º1
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The pipeline has ten stages and two engines. Without one place to put the
 * shapes that pass between them, every stage invents its own and the offset map
 * stops being honoured ΓÇö which is the failure mode that breaks the evidence
 * contract silently, because a snippet that does not resolve still LOOKS like a
 * snippet in the review UI.
 *
 * These types are internal to L1. Above this layer, consumers see
 * `ExtractionResult` from `src/ai/types.ts` and the review model from
 * `src/extraction/review/`. Nothing outside `src/extraction/` and `src/ai/`
 * should import from here.
 * ---------------------------------------------------------------------------
 */

import type {
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  ISODateString,
  PremiseId,
  SourceSpan,
  TranscriptId,
} from "@/types/common";
import type {
  DecisionOrigin,
  DecisionVariable,
  Modality,
  PremiseType,
} from "@/types/domain";
import type { ResolutionAction, ResolutionRung } from "@/substrate/identity";
import type {
  AlternativeCandidate,
  DecisionCandidate,
  DiscardedCandidate,
  PremiseCandidate,
} from "@/ai/types";

/* -------------------------------------------------------------------------- */
/* 1.1 ΓÇö input shapes                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The six supported transcript shapes plus two catch-alls.
 *
 * Detection is heuristic and the result is REPORTED, not trusted: the review UI
 * shows it so a wrong guess is visible and correctable. A transcript that
 * misattributes every turn is worse than one that admits it could not tell.
 */
export type InputShape =
  | "claude-code"
  | "cursor-chat"
  | "copilot-chat"
  | "codex-cli"
  | "generic-marked"
  | "jsonl"
  | "plain-prose"
  | "unknown";

export const INPUT_SHAPES: readonly InputShape[] = [
  "claude-code",
  "cursor-chat",
  "copilot-chat",
  "codex-cli",
  "generic-marked",
  "jsonl",
  "plain-prose",
  "unknown",
];

/** What a collapsed region was, for the review UI's "show tool noise" toggle. */
export type NoiseKind = "tool-call" | "diff" | "stack-trace" | "long-output" | "file-listing";

/* -------------------------------------------------------------------------- */
/* 1.1 ΓÇö the offset map                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One entry of the normalisedΓåÆraw index map.
 *
 * Stored as a sparse array of ANCHORS rather than one entry per character: a
 * 200 KB transcript would otherwise allocate a 200 KB array to describe text
 * that is 99% contiguous. `rawAt(normalisedIndex)` interpolates between anchors.
 */
export interface OffsetAnchor {
  /** Index into the normalised text. */
  readonly normalised: number;
  /** The corresponding index into the raw input. */
  readonly raw: number;
}

/* -------------------------------------------------------------------------- */
/* 1.1 ΓÇö normalised transcript                                                */
/* -------------------------------------------------------------------------- */

/**
 * One speaker turn.
 *
 * `start`/`end` index the NORMALISED text ΓÇö that is what `text` is a slice of, and
 * it is what `spanFrom()` consumes. Use `rawBounds()` from `offset-map.ts` to get
 * the corresponding range in the raw input for highlighting.
 *
 * Getting this backwards is the single easiest bug to write in this pipeline and
 * the hardest to see: a snippet still renders, it just highlights the wrong
 * characters.
 */
export interface NormalizedTurn {
  readonly index: number;
  readonly speaker: "human" | "agent" | "unknown";
  /** The turn body with its speaker marker stripped. */
  readonly text: string;
  /** Bounds of `text` in the NORMALISED string. */
  readonly start: number;
  readonly end: number;
  /** How the speaker was decided, so a wrong attribution is diagnosable. */
  readonly attribution: "marker" | "jsonl-role" | "indentation" | "inherited" | "none";
}

/** A fenced code block, extracted separately: it is evidence for guards (Phase 4),
 *  not decision text. */
export interface CodeBlock {
  readonly lang: string | null;
  readonly text: string;
  readonly rawStart: number;
  readonly rawEnd: number;
  /** Which turn contains it, or null when it sits between turns. */
  readonly turnIndex: number | null;
}

/** A region collapsed to a placeholder for extraction but retained verbatim for
 *  snippet resolution. */
export interface NoiseRegion {
  readonly kind: NoiseKind;
  readonly rawStart: number;
  readonly rawEnd: number;
  /** The verbatim text, so `snippet-validation.ts` can still confirm a snippet
   *  that legitimately quotes a tool output. */
  readonly raw: string;
  readonly replacedWith: string;
}

export interface NormalizationStats {
  readonly rawChars: number;
  readonly normalisedChars: number;
  readonly turns: number;
  readonly humanTurns: number;
  readonly agentTurns: number;
  readonly unattributedTurns: number;
  readonly codeBlocks: number;
  readonly noiseRegions: number;
  readonly noiseCharsCollapsed: number;
}

/**
 * The canonical form every supported input reduces to.
 *
 * `text` is what the recognisers read. `raw` is what snippets are validated
 * against and what the review UI highlights. They are never the same string, and
 * conflating them is the bug this type exists to prevent.
 */
export interface NormalizedTranscript {
  readonly transcriptId: TranscriptId;
  readonly shape: InputShape;
  readonly raw: string;
  readonly text: string;
  readonly turns: readonly NormalizedTurn[];
  readonly codeBlocks: readonly CodeBlock[];
  readonly noise: readonly NoiseRegion[];
  readonly anchors: readonly OffsetAnchor[];
  /** When the conversation happened. `uncertain` is true whenever it was
   *  defaulted to import time rather than recovered from the text. */
  readonly occurredAt: ISODateString;
  readonly timeUncertain: boolean;
  readonly stats: NormalizationStats;
}

/* -------------------------------------------------------------------------- */
/* 1.2 ΓÇö episodes                                                             */
/* -------------------------------------------------------------------------- */

/** Why an episode ended. Recorded so a bad boundary is diagnosable rather than
 *  merely observed. */
export type EpisodeBoundaryReason =
  | "topic-shift"
  | "cue-gap"
  | "length-cap"
  | "end-of-transcript";

/**
 * A decision episode: a window of consecutive turns bounded by topic shift and
 * containing at least one decision cue.
 *
 * THE DELIBERATE DEVIATION from arXiv:2506.11005, which assumes rationale sits in
 * a single sentence containing both decision and rationale. That holds for Linux
 * commit messages. In dialogue a decision is negotiated across four turns and the
 * premise often appears BEFORE the decision it supports ΓÇö so sentence-level
 * segmentation loses exactly the premise the product is built on.
 */
export interface EpisodeWindow {
  readonly index: number;
  readonly turns: readonly NormalizedTurn[];
  /** Inclusive first turn index, exclusive last. */
  readonly turnRange: readonly [start: number, end: number];
  /** Bounds of `text` in the NORMALISED transcript. Cue positions and every span
   *  the recognisers produce are in this coordinate system. */
  readonly charRange: readonly [start: number, end: number];
  /** The same window in the RAW input, for the review pane. Not a slice of `raw`:
   *  it is the range that CONTAINS the window, so a lifted code block inside the
   *  episode still shows. */
  readonly rawRange: readonly [start: number, end: number];
  /** The concatenated turn bodies ΓÇö what the recognisers read. Not a slice of
   *  either transcript: it is built from the turns, which is why `charRange`
   *  describes where the window sits rather than where `text` came from. */
  readonly text: string;
  /** `text` offset of each turn's body, indexed by position in `turns`. Lets a
   *  recogniser convert a within-turn cue position into an episode position
   *  without re-searching. */
  readonly turnOffsets: readonly number[];
  /** Best guess at the variable under negotiation, from the cues found. Drives
   *  episode labelling in the review UI and pre-filters the identity pools. */
  readonly variable: DecisionVariable | null;
  /** Indices into the raw text where decision cues were found. An episode with
   *  none is not emitted. */
  readonly cuePositions: readonly number[];
  readonly boundaryReason: EpisodeBoundaryReason;
}

/* -------------------------------------------------------------------------- */
/* 1.6 ΓÇö provenance                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the speaker attribution plus the modality imply about who decided.
 *
 * Maps directly onto `source_authority` in the entrenchment function and onto the
 * agency ledger (Phase 6.4). This is why speaker attribution in 1.1 is
 * non-negotiable: it is an input to a RETRACTION POLICY, not to a display field.
 */
export interface OriginEvidence {
  /** The turn the cue was found in. */
  readonly cueTurn: number;
  readonly cueSpeaker: "human" | "agent" | "unknown";
  /** A human turn within `acceptanceWindowTurns` that accepts the proposal. */
  readonly acceptedInTurn: number | null;
  /** A human turn that reverses an earlier agent proposal. */
  readonly reversedInTurn: number | null;
  readonly modality: Modality;
}

/* -------------------------------------------------------------------------- */
/* The run                                                                    */
/* -------------------------------------------------------------------------- */

export interface ExtractionOptions {
  readonly transcriptId: TranscriptId;
  /** When the conversation happened, if the user supplied it. Otherwise
   *  recovered from the text, otherwise import time flagged uncertain. */
  readonly occurredAt?: ISODateString;
  readonly label?: string;
  /** ~12k characters, on turn boundaries, one turn of overlap. */
  readonly chunkChars?: number;
  /** Three-run majority voting. LLM path only; the local engine is deterministic
   *  so voting would return three identical runs and cost 3├ù for nothing. */
  readonly voting?: boolean;
  readonly signal?: AbortSignal;
}

export type StageName =
  | "normalise"
  | "segment"
  | "recognise"
  | "resolve"
  | "score";

/** Per-stage telemetry. Extraction is the layer users trust least, so it reports
 *  what it did rather than only what it found. */
export interface StageReport {
  readonly stage: StageName;
  readonly durationMs: number;
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly note?: string;
}

/**
 * One extraction, before human review.
 *
 * Carries the normalised transcript as well as the candidates because the review
 * UI needs the raw text and the offset map to highlight spans ΓÇö and because
 * `snippet-validation.ts` must re-check every snippet against `normalized.raw`
 * at review time, not only at extraction time.
 */
export interface ExtractionRun {
  readonly transcriptId: TranscriptId;
  readonly normalized: NormalizedTranscript;
  readonly episodes: readonly EpisodeWindow[];
  readonly decisions: readonly DecisionCandidate[];
  readonly premises: readonly PremiseCandidate[];
  readonly alternatives: readonly AlternativeCandidate[];
  readonly discarded: readonly DiscardedCandidate[];
  readonly engine: EngineId;
  readonly stages: readonly StageReport[];
  readonly startedAt: ISODateString;
  readonly durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* 1.7 + 1.9 ΓÇö resolved candidates, the review queue's unit                   */
/* -------------------------------------------------------------------------- */

/** What the identity ladder decided about one candidate. */
export interface ResolutionOutcome {
  readonly action: ResolutionAction;
  readonly rung: ResolutionRung;
  /** The existing node this candidate merges into, when `action === "merge"`. */
  readonly matchedId: DecisionId | PremiseId | null;
  readonly score: number;
  readonly explanation: string;
  readonly needsReview: boolean;
  /**
   * Existing decisions on the SAME VARIABLE with a DIFFERENT canonical value.
   *
   * Not a merge and not a duplicate: a conflict. The ladder never merges across
   * values, so without this field the conflict would be invisible until Phase 2
   * re-derived it from the graph ΓÇö and Phase 1 is where the human is already
   * looking at the item. Surfacing it here is what lets the review UI say "this
   * contradicts WLD-0003" at the moment the user is deciding whether to keep it.
   */
  readonly conflictsWith: readonly DecisionId[];
}

export type CandidateKind = "decision" | "premise" | "alternative";

/**
 * A candidate with its identity resolution attached, ready for review.
 *
 * This is the review queue's unit. `resolution` is present BEFORE the human acts,
 * because "merge into the existing node" is one of the review actions and the
 * human needs to see what the ladder proposed in order to override it.
 */
export interface ResolvedCandidate {
  /** Local, per-run key. Not an id: ids are minted at commit. */
  readonly key: string;
  readonly kind: CandidateKind;
  readonly decision: DecisionCandidate | null;
  readonly premise: PremiseCandidate | null;
  readonly alternative: AlternativeCandidate | null;
  readonly resolution: ResolutionOutcome;
  readonly origin: DecisionOrigin;
  readonly confidence: Confidence;
  readonly tier: ConfidenceTier;
  readonly snippet: SourceSpan;
  /** The episode this came from, so the review UI can show the negotiation. */
  readonly episodeIndex: number;
  readonly episodeId: EpisodeId | null;
  /** Local indices of the premises this decision rests on (IN-list) and excludes
   *  (OUT-list). Resolved to real ids at commit. */
  readonly inRefs: readonly number[];
  readonly outRefs: readonly number[];
  /**
   * The human's decision. Null until they make one.
   *
   * This is the field `commit.ts` refuses to work without: an item with
   * `action === null` is not committed, and a commit containing one is refused
   * outright. Invariant I4 ΓÇö the system proposes, the human disposes ΓÇö is enforced
   * by making this field the only route from a candidate to an event.
   */
  readonly action: ReviewAction | null;
}

/* -------------------------------------------------------------------------- */
/* 1.8 ΓÇö confidence tiers                                                     */
/* -------------------------------------------------------------------------- */

export type ConfidenceTier = "high" | "medium" | "low";

export const TIER_HIGH_AT = 0.75;
export const TIER_MEDIUM_AT = 0.45;

export function tierOf(confidence: Confidence): ConfidenceTier {
  if (confidence >= TIER_HIGH_AT) return "high";
  if (confidence >= TIER_MEDIUM_AT) return "medium";
  return "low";
}

/** One tier down, never up. Premises and alternatives carry a published precision
 *  gap against decisions (0.75 vs 0.15 on alternatives), so an alternative that
 *  scores like a high-confidence decision is still shown collapsed. */
export function demoteTier(tier: ConfidenceTier): ConfidenceTier {
  if (tier === "high") return "medium";
  return "low";
}

export const TIER_LABELS: Readonly<Record<ConfidenceTier, string>> = {
  high: "Expanded ΓÇö bulk-approvable",
  medium: "Normal review",
  low: "Collapsed ΓÇö one-click discard",
};

/* -------------------------------------------------------------------------- */
/* 1.10 ΓÇö the commit                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A human action on a review item.
 *
 * Every one of these writes an event with a reason. There is no action that
 * changes the log without one: invariant I4, "the system proposes, the human
 * disposes", is enforced by making this type the only input `commit.ts` accepts.
 */
export type ReviewAction =
  | { readonly type: "approve"; readonly viaBulk: boolean }
  | {
      readonly type: "edit";
      readonly fields: Readonly<Record<string, string | number | boolean | null>>;
    }
  | { readonly type: "discard"; readonly reason: string }
  | { readonly type: "merge-into"; readonly targetId: DecisionId | PremiseId }
  | { readonly type: "contest"; readonly reason: string };

/**
 * Is this action one that writes a node?
 *
 * `discard` and `contest` do not. Lives here rather than in `commit.ts` because
 * `commit.ts`, `review/diff.ts` and `review/actions.ts` all need the same answer,
 * and a commit preview that disagrees with the commit is worse than no preview.
 * Importing it from `commit.ts` would also close a cycle: `commit.ts` reads
 * `review/index.ts`, which re-exports `review/diff.ts`.
 */
export function isAccepted(action: ReviewAction | null): boolean {
  return action !== null && action.type !== "discard" && action.type !== "contest";
}

/** What the review produced, ready to commit. */
export interface ReviewOutcome {
  readonly approved: readonly ResolvedCandidate[];
  readonly discarded: readonly ResolvedCandidate[];
  readonly merged: readonly { readonly candidate: ResolvedCandidate; readonly intoId: DecisionId | PremiseId }[];
  readonly contested: readonly { readonly candidate: ResolvedCandidate; readonly reason: string }[];
  readonly secondsTaken: number;
}
