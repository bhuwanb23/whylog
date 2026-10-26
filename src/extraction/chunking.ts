/**
 * Chunking — 1.1.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * ---------------------------------------------------------------------------
 * CHUNK AT ~12k CHARACTERS ON SPEAKER-TURN BOUNDARIES, NEVER MID-SENTENCE
 *
 * Chunking exists for the LLM path: one call per chunk. But it runs on BOTH paths,
 * because the local recognisers also process an episode at a time and a chunk is
 * what bounds the episode search. Keeping the two paths on the same chunking means
 * Phase 7's ablation compares engines rather than windowing strategies.
 *
 * Two rules do the work:
 *
 *   • A boundary may only fall BETWEEN turns. Acceptance criterion 1.1 says so
 *     directly, and the reason is the SQLite episode: it spans four turns, and a
 *     chunk that cut through it would hand the recogniser a premise in one chunk
 *     and the decision it supports in the next.
 *
 *   • Consecutive chunks OVERLAP BY ONE TURN. That overlap is what keeps a
 *     negotiated decision from being split: the last turn of chunk N is the first
 *     turn of chunk N+1, so an episode that straddles the boundary is whole in at
 *     least one of them. Duplicates created by the overlap are removed by entity
 *     resolution (1.7), which is exactly what that stage is for.
 *
 * ---------------------------------------------------------------------------
 * THE OVERSIZED TURN
 *
 * A single turn longer than the budget cannot be split on a turn boundary, because
 * there is only one. It becomes a chunk of its own, over budget, and is reported
 * in `oversized`. Splitting it mid-sentence would break the rule that protects the
 * episode; letting it through whole costs tokens but loses nothing.
 * ---------------------------------------------------------------------------
 */

import { toRawBounds } from "./normalizer";
import type { NormalizedTranscript, NormalizedTurn } from "./types";

export const DEFAULT_CHUNK_CHARS = 12_000;

/** Never emit a chunk smaller than this unless the transcript is smaller.
 *  Tiny chunks mean tiny episodes and tiny episodes lose the negotiation. */
const MIN_CHUNK_CHARS = 1_500;

export interface Chunk {
  readonly index: number;
  readonly turns: readonly NormalizedTurn[];
  /** Bounds in the RAW input, so a chunk can be highlighted in the review pane. */
  readonly rawRange: readonly [start: number, end: number];
  /** The concatenated turn bodies — what an engine is sent. */
  readonly text: string;
  readonly chars: number;
  /** True when the first turn also ended the previous chunk. The recogniser uses
   *  this to avoid reporting the same decision twice. */
  readonly overlapsPrevious: boolean;
  /** True when one turn alone exceeded the budget. */
  readonly oversized: boolean;
}

export interface ChunkingResult {
  readonly chunks: readonly Chunk[];
  readonly budget: number;
  readonly oversizedTurns: number;
}

/**
 * Split normalised turns into overlapping chunks.
 *
 * @param budget target characters per chunk. A soft ceiling: the chunker stops
 *               ADDING turns once it is exceeded, so a chunk may overshoot by
 *               one turn's length rather than cutting a turn in half.
 */
export function chunkTurns(
  turns: readonly NormalizedTurn[],
  normalized: NormalizedTranscript,
  budget: number = DEFAULT_CHUNK_CHARS,
): ChunkingResult {
  if (turns.length === 0) {
    return { chunks: [], budget, oversizedTurns: 0 };
  }

  const chunks: Chunk[] = [];
  let oversizedTurns = 0;
  let start = 0;

  while (start < turns.length) {
    let end = start; // exclusive
    let chars = 0;

    // Always take at least one turn, so an oversized turn still produces a chunk
    // rather than an infinite loop.
    const first = turns[start];
    if (first !== undefined) {
      chars += first.text.length;
      if (chars > budget) oversizedTurns += 1;
      end = start + 1;
    }

    while (end < turns.length) {
      const next = turns[end];
      if (next === undefined) break;
      if (chars + next.text.length > budget && chars >= MIN_CHUNK_CHARS) break;
      chars += next.text.length;
      end += 1;
    }

    chunks.push(buildChunk(chunks.length, turns, start, end, chunks.length > 0, normalized));
    if (end >= turns.length) break;

    // One turn of overlap. `end - 1` is safe because `end > start` always holds:
    // the loop above takes at least one turn.
    start = Math.max(start + 1, end - 1);
  }

  return { chunks, budget, oversizedTurns };
}

function buildChunk(
  index: number,
  turns: readonly NormalizedTurn[],
  start: number,
  end: number,
  overlapsPrevious: boolean,
  normalized: NormalizedTranscript,
): Chunk {
  const slice = turns.slice(start, end);
  const text = slice.map((t) => t.text).join("\n\n");

  const first = slice[0];
  const last = slice[slice.length - 1];
  /* A turn's start/end are NORMALISED offsets. `rawRange` is documented as raw, and the review pane
   * highlights with it, so reporting normalised offsets there would highlight the wrong slice of the
   * pasted text whenever noise was collapsed — silently, and only on messy transcripts. */
  const [rawStart, rawEnd] = toRawBounds(normalized, first?.start ?? 0, last?.end ?? 0);

  const oversized = slice.length === 1 && (first?.text.length ?? 0) > DEFAULT_CHUNK_CHARS;

  return {
    index,
    turns: slice,
    rawRange: [rawStart, rawEnd],
    text,
    chars: text.length,
    overlapsPrevious,
    oversized,
  };
}

/**
 * Which chunk a turn belongs to.
 *
 * With overlap a turn can belong to two chunks; the FIRST is returned, because
 * that is the chunk whose recogniser will report it. Used by `pipeline.ts` to
 * deduplicate candidates from the overlap region.
 */
export function chunkOfTurn(chunks: readonly Chunk[], turnIndex: number): Chunk | null {
  for (const chunk of chunks) {
    if (chunk.turns.some((t) => t.index === turnIndex)) return chunk;
  }
  return null;
}

/** Turns that appear in more than one chunk. Reported so the user can see why an
 *  extraction produced more candidates than the transcript seems to contain. */
export function overlappedTurnIndexes(chunks: readonly Chunk[]): readonly number[] {
  const seen = new Map<number, number>();
  for (const chunk of chunks) {
    for (const turn of chunk.turns) {
      seen.set(turn.index, (seen.get(turn.index) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

export function describeChunking(result: ChunkingResult): string {
  const parts = [`${result.chunks.length} chunk${result.chunks.length === 1 ? "" : "s"}`];
  parts.push(`budget ${Math.round(result.budget / 1000)}k chars`);
  if (result.oversizedTurns > 0) {
    parts.push(
      `${result.oversizedTurns} turn${result.oversizedTurns === 1 ? "" : "s"} over budget — sent whole rather than split mid-sentence`,
    );
  }
  return parts.join(" · ");
}
