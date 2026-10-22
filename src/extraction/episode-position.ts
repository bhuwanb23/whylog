/**
 * Episode → turn position resolution.
 *
 * Phase 1 · sub-phases 1.2, 1.3, 1.4
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * Three recognisers — decisions, premises, alternatives — all need the same
 * conversion: a position in `episode.text` becomes a turn plus a position in that
 * turn's body. Written three times it drifts, and a drift here means one
 * recogniser's snippets highlight correctly while another's are shifted by the
 * length of a speaker marker. That is invisible in the data and obvious in the UI.
 *
 * It is also the only place that has to reason about the THREE coordinate systems
 * at once, so the explanation lives here rather than being repeated:
 *
 *   EPISODE     `episode.text` is the turn bodies joined with "\n\n", so a
 *               position in it is episode-relative.
 *   TURN        `turn.text` is one body; `localAt` is a position in it.
 *   NORMALISED  `turn.start` is where that body sits in the normalised transcript,
 *               so `turn.start + localAt` converts turn → normalised.
 *   RAW         `spanFrom()` with the transcript's offset map converts
 *               normalised → raw, which is what a `SourceSpan` must carry.
 * ---------------------------------------------------------------------------
 */

import type { EpisodeWindow, NormalizedTurn } from "./types";

export interface Located {
  /** The turn the position falls in. */
  readonly turn: NormalizedTurn;
  /** Where the turn's body starts in `episode.text`. */
  readonly offset: number;
  /** The position, made turn-relative. */
  readonly localAt: number;
  /** Index of the turn within the episode. */
  readonly turnPosition: number;
  /** The original turn index within the transcript. */
  readonly turnIndex: number;
}

/**
 * Resolve an episode-relative position to its turn.
 *
 * Returns null when the position falls in a JOINER rather than in a turn body —
 * which happens when a cue match straddles the "\n\n" between two turns. A
 * cross-turn cue is not a cue: no speaker said it, so it cannot be attributed, and
 * provenance depends on attribution.
 */
export function locateInEpisode(episode: EpisodeWindow, position: number): Located | null {
  for (let i = 0; i < episode.turns.length; i += 1) {
    const turn = episode.turns[i];
    const offset = episode.turnOffsets[i] ?? 0;
    if (turn === undefined) continue;
    if (position < offset || position >= offset + turn.text.length) continue;

    return {
      turn,
      offset,
      localAt: position - offset,
      turnPosition: i,
      turnIndex: turn.index,
    };
  }
  return null;
}

/**
 * Resolve an episode-relative RANGE, which may span several turns.
 *
 * Used for snippets that quote a negotiation rather than a single sentence. When
 * the range crosses turns, the returned `turns` list holds all of them and the
 * caller must decide whether a snippet that quotes two speakers is still a snippet
 * worth showing (usually yes, for a decision; usually no, for a premise).
 */
export function locateRange(
  episode: EpisodeWindow,
  start: number,
  end: number,
): { readonly turns: readonly Located[]; readonly speakerMixed: boolean } | null {
  const located: Located[] = [];

  for (let position = start; position < end; position += 1) {
    const found = locateInEpisode(episode, position);
    if (found === null) continue;
    if (located.length === 0 || located[located.length - 1]?.turnIndex !== found.turnIndex) {
      located.push(found);
    }
  }

  if (located.length === 0) return null;

  const speakers = new Set(located.map((l) => l.turn.speaker));
  return { turns: located, speakerMixed: speakers.size > 1 };
}

/** Turn-relative → normalised-transcript position. The only sanctioned conversion. */
export function toNormalised(located: Located, localAt: number): number {
  return located.turn.start + localAt;
}

/** The turns of an episode that a given speaker owns. Used by `provenance.ts` to
 *  find the human turn that accepted an agent proposal. */
export function turnsBySpeaker(
  episode: EpisodeWindow,
  speaker: "human" | "agent" | "unknown",
): readonly NormalizedTurn[] {
  return episode.turns.filter((turn) => turn.speaker === speaker);
}

/** The turn immediately AFTER the one at `turnPosition`, or null. */
export function nextTurn(episode: EpisodeWindow, turnPosition: number): NormalizedTurn | null {
  return episode.turns[turnPosition + 1] ?? null;
}
