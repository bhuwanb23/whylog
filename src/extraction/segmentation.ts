/**
 * Episode segmentation — 1.2, the deliberate deviation.
 *
 * Phase 1 · sub-phase 1.2
 * Plan: plan/phase-1-extraction-pipeline.md §1.2
 *
 * ---------------------------------------------------------------------------
 * WHY NOT SENTENCES
 *
 * arXiv:2506.11005 (Kantara) assumes "rationale appears in a single sentence
 * containing both a decision and its rationale". That holds for Linux commit
 * messages, which are written AFTER the decision by someone summarising it.
 *
 * It does not hold for dialogue, where the decision is NEGOTIATED:
 *
 *     agent:  "Postgres via Supabase would work, but it means a hosted
 *              dependency… What's the actual concurrency requirement?"
 *     human:  "none really. it's one person, one machine, one log."   ← PREMISE
 *     agent:  "Then I'd use SQLite with better-sqlite3 instead…"       ← PROPOSAL
 *     human:  "yeah ok. going with SQLite, not Postgres. single-user   ← DECISION
 *              and no deploy hassle is the whole argument."            ← RATIONALE
 *
 * Four turns, one decision, and the premise appears BEFORE the decision it
 * supports. Sentence segmentation discards turns 1 and 2 for having no cue, which
 * is precisely the premise the whole product is built on. So: segment on EPISODES
 * — a window of consecutive turns bounded by topic shift and containing at least
 * one decision cue — extract at episode granularity, then attribute individual
 * snippets within it.
 *
 * ---------------------------------------------------------------------------
 * THE LEAD TURN
 *
 * Every episode includes one turn BEFORE its first cue. That single rule is what
 * recovers the premise above, and it costs one extra turn of context per episode.
 * It is not a heuristic dressed up as a principle: it is the observation that in
 * dialogue the constraint is stated, then the decision follows from it.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";
import type { VariableGuess } from "@/ontology/canonicalize";
import type { EpisodeBoundaryReason, EpisodeWindow, NormalizedTurn, NormalizedTranscript } from "./types";
import { episodeVariable, scanCues, variableAtCue, type CueHit } from "./cue-scan";
import { toRawBounds } from "./normalizer";

/** Consecutive cue-less turns that close an episode. Three rather than one
 *  because a negotiation routinely has a digression in the middle of it, and
 *  closing on the first quiet turn is how a four-turn episode becomes two
 *  half-episodes with the premise in the wrong one. */
const CUE_GAP_TURNS = 3;

/** Hard ceiling on episode length. Beyond this the episode is split and reported
 *  as `length-cap`, because an episode that long is two negotiations that happen
 *  to share a variable. */
const MAX_EPISODE_TURNS = 14;
const MAX_EPISODE_CHARS = 9_000;

/** Turns included before the first cue. See the file header. */
const LEAD_TURNS = 1;

/** Turns included after the last cue, so a trailing rationale is inside the
 *  window. Two rather than one: "going with SQLite" is often followed by the
 *  reason in the NEXT turn ("yeah — and the schema is tiny so migration stays
 *  open"). */
const TRAIL_TURNS = 2;

/** A variable guess at or above this score, differing from the running episode
 *  variable, is a topic shift. Below it, the guess is too weak to split on. */
const TOPIC_SHIFT_SCORE = 0.6;

export interface SegmentationResult {
  readonly episodes: readonly EpisodeWindow[];
  /** Turns that were in no episode. Reported, because a transcript where most
   *  turns are skipped is a transcript the segmenter did not understand. */
  readonly uncoveredTurns: number;
  readonly cueHits: number;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function segmentEpisodes(normalized: NormalizedTranscript): SegmentationResult {
  const turns = normalized.turns;
  if (turns.length === 0) return { episodes: [], uncoveredTurns: 0, cueHits: 0 };

  const perTurn = turns.map((turn) => scanCues(turn.text));
  const cueHits = perTurn.reduce((total, hits) => total + hits.length, 0);

  const ranges = groupRanges(turns, perTurn);
  const episodes = ranges.map((range, index) =>
    buildEpisode(index, normalized, turns, perTurn, range.start, range.end, range.reason),
  );

  const covered = new Set<number>();
  for (const episode of episodes) {
    for (let i = episode.turnRange[0]; i < episode.turnRange[1]; i += 1) covered.add(i);
  }

  return {
    episodes,
    uncoveredTurns: turns.length - covered.size,
    cueHits,
  };
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

interface Range {
  readonly start: number;
  readonly end: number;
  readonly reason: EpisodeBoundaryReason;
}

/**
 * Walk the turns and collect [start, end) ranges that contain at least one cue.
 *
 * The window is grown around the cues rather than built from them: the first cue
 * opens a candidate range one turn earlier (the lead turn) and the range stays
 * open through `CUE_GAP_TURNS` quiet turns and `TRAIL_TURNS` after the last cue.
 */
function groupRanges(
  turns: readonly NormalizedTurn[],
  perTurn: readonly (readonly CueHit[])[],
): readonly Range[] {
  const ranges: Range[] = [];

  type OpenEpisode = { firstCue: number; lastCue: number; variable: DecisionVariable | null };
  let open: OpenEpisode | null = null;
  let quiet = 0;

  const close = (end: number, reason: EpisodeBoundaryReason): void => {
    if (open === null) return;
    const start = Math.max(0, open.firstCue - LEAD_TURNS);
    const boundedEnd = Math.min(turns.length, Math.max(end, open.lastCue + 1 + TRAIL_TURNS));
    ranges.push({ start, end: boundedEnd, reason });
    open = null;
    quiet = 0;
  };

  for (let i = 0; i < turns.length; i += 1) {
    const hits = perTurn[i] ?? [];

    if (hits.length > 0) {
      const variable = variableForTurn(turns[i] as NormalizedTurn, hits);

      if (open === null) {
        open = { firstCue: i, lastCue: i, variable: variable === null ? null : variable.variable };
        quiet = 0;
        continue;
      }

      // Bind the known non-null episode here: `close()` above can reassign `open` to
      // null between this point and the update below, which invalidates narrowing and
      // forces a nullable spread. `current` is provably non-null from here onward.
      const current: OpenEpisode = open;

      // Topic shift: a confident guess at a DIFFERENT variable closes the episode
      // and opens a new one at this turn. Splitting here is what keeps a database
      // decision and a auth decision out of the same justification. Read from
      // `current` (bound non-null above) so `close()` nulling `open` is irrelevant.
      if (
        current.variable !== null &&
        variable !== null &&
        variable.variable !== current.variable &&
        variable.score >= TOPIC_SHIFT_SCORE
      ) {
        close(i, "topic-shift");
        open = { firstCue: i, lastCue: i, variable: variable.variable };
        quiet = 0;
        continue;
      }

      const updated = { ...current, lastCue: i, variable: current.variable ?? (variable === null ? null : variable.variable) };
      open = updated;
      quiet = 0;

      if (i - updated.firstCue + 1 >= MAX_EPISODE_TURNS) close(i + 1, "length-cap");
      continue;
    }

    if (open === null) continue;

    quiet += 1;
    if (quiet >= CUE_GAP_TURNS) {
      close(i - quiet + 1, "cue-gap");
      continue;
    }

    const soFar = charSpan(turns, Math.max(0, open.firstCue - LEAD_TURNS), i + 1);
    if (soFar > MAX_EPISODE_CHARS) close(i, "length-cap");
  }

  close(turns.length, "end-of-transcript");
  return ranges;
}

/** The variable a single turn's cues point at. `hits` is unused here because the
 *  strongest cue is re-found from the text: `variableAtCue` needs the cue's
 *  POSITION to take its context window, and the caller's list is already
 *  position-correct, so the strongest of it is the right one to pass. */
function variableForTurn(turn: NormalizedTurn, hits: readonly CueHit[]): VariableGuess | null {
  const best = hits.reduce<CueHit | null>(
    (current, hit) => (current === null || hit.weight > current.weight ? hit : current),
    null,
  );
  if (best === null) return null;
  return variableAtCue(turn.text, best);
}

function charSpan(turns: readonly NormalizedTurn[], start: number, end: number): number {
  let total = 0;
  for (let i = start; i < Math.min(end, turns.length); i += 1) total += (turns[i]?.text.length ?? 0) + 2;
  return total;
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

function buildEpisode(
  index: number,
  normalized: NormalizedTranscript,
  turns: readonly NormalizedTurn[],
  perTurn: readonly (readonly CueHit[])[],
  start: number,
  end: number,
  reason: EpisodeBoundaryReason,
): EpisodeWindow {
  const slice = turns.slice(start, end);

  // `text` is assembled from turn bodies rather than sliced out of the
  // normalised transcript, because a slice would include the gaps between turns
  // (marker remnants, collapsed placeholders) that the recognisers should not
  // read. `turnOffsets` records where each body starts so a within-turn cue
  // position converts to an episode position without a second search.
  const parts: string[] = [];
  const turnOffsets: number[] = [];
  let length = 0;

  for (const turn of slice) {
    turnOffsets.push(length);
    parts.push(turn.text);
    length += turn.text.length + 2;
  }

  const text = parts.join("\n\n");

  const hits: CueHit[] = [];
  slice.forEach((turn, position) => {
    const offset = turnOffsets[position] ?? 0;
    for (const hit of perTurn[turn.index] ?? []) {
      hits.push(shiftHit(hit, offset));
    }
  });

  const first = slice[0];
  const last = slice[slice.length - 1];

  return {
    index,
    turns: slice,
    turnRange: [start, end],
    charRange: [first?.start ?? 0, last?.end ?? 0],
    /* Computed above at the same time `text` is built; returning it is what lets a recogniser
     * convert a within-turn cue position into an episode position without re-searching. */
    turnOffsets,
    rawRange: rawRangeOf(normalized, first, last),
    text,
    variable: episodeVariable(text, hits),
    cuePositions: hits.map((hit) => hit.start),
    boundaryReason: reason,
  };
}

function shiftHit(hit: CueHit, offset: number): CueHit {
  return { ...hit, start: hit.start + offset, end: hit.end + offset };
}

/** Turn bounds are in NORMALISED coordinates; the review pane needs RAW ones. */
function rawRangeOf(
  normalized: NormalizedTranscript,
  first: NormalizedTurn | undefined,
  last: NormalizedTurn | undefined,
): readonly [number, number] {
  if (first === undefined || last === undefined) return [0, 0];
  return toRawBounds(normalized, first.start, last.end);
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeSegmentation(result: SegmentationResult, turnCount: number): string {
  const parts = [`${result.episodes.length} episode${result.episodes.length === 1 ? "" : "s"}`];
  parts.push(`${result.cueHits} cue${result.cueHits === 1 ? "" : "s"}`);
  if (result.uncoveredTurns > 0) {
    parts.push(
      `${result.uncoveredTurns} of ${turnCount} turns in no episode — no decision cue, so nothing to extract`,
    );
  }
  const capped = result.episodes.filter((e) => e.boundaryReason === "length-cap").length;
  if (capped > 0) parts.push(`${capped} split on length, not on topic`);
  return parts.join(" · ");
}

/** The episode a normalised character position falls in. Used to attribute a
 *  snippet to its episode when the recogniser only has an offset. */
export function episodeAt(episodes: readonly EpisodeWindow[], position: number): EpisodeWindow | null {
  for (const episode of episodes) {
    if (position >= episode.charRange[0] && position < episode.charRange[1]) return episode;
  }
  return null;
}
