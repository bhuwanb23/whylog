/**
 * The offset map — 1.1's non-negotiable.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * Acceptance criterion: "any extracted snippet can be resolved to an exact
 * character range in the raw input." Without that, a citation is decoration —
 * the review UI highlights the wrong characters, the export ships a quote nobody
 * can find, and the evidence contract (docs/03 §5) collapses silently, because a
 * snippet that resolves to the WRONG range still looks exactly like one that
 * resolves to the right range.
 *
 * The rule this file exists to enforce:
 *
 *   **No stage computes a character index by arithmetic on a transformed
 *   string.** Every `SourceSpan` is produced by `spanFrom()`, which takes an
 *   index into the NORMALISED text and returns raw bounds.
 *
 * ---------------------------------------------------------------------------
 * REPRESENTATION
 *
 * Anchors, not one entry per character. Normalisation is piecewise contiguous:
 * long runs of text keep their relative offsets and only collapse points (tool
 * noise, code fences, stripped speaker markers) break the run. Storing a pair per
 * character would allocate ~200 KB to describe a 200 KB transcript that has maybe
 * forty discontinuities in it.
 *
 * `rawAt()` walks the anchor list. It is linear, which is fine: the list is short
 * and lookups happen once per extracted item, not once per character. If a
 * transcript ever produces enough anchors for that to matter, swap in a binary
 * search — the interface does not change.
 * ---------------------------------------------------------------------------
 */

import type { SourceSpan, TranscriptId } from "@/types/common";
import type { OffsetAnchor } from "./types";

/* -------------------------------------------------------------------------- */
/* The map                                                                    */
/* -------------------------------------------------------------------------- */

export interface OffsetMap {
  readonly anchors: readonly OffsetAnchor[];
  readonly normalisedLength: number;
  readonly rawLength: number;
}

/** The identity map: normalised index === raw index. Used for plain prose that
 *  needed no transformation, and as the fallback when a stage forgets to thread
 *  the map through. */
export function identityMap(raw: string): OffsetMap {
  return {
    anchors: [{ normalised: 0, raw: 0 }],
    normalisedLength: raw.length,
    rawLength: raw.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Builder                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds the map incrementally, as the normaliser walks the raw input.
 *
 * The normaliser calls `keep(rawChars)` for text it passes through unchanged and
 * `skip(rawChars, normalisedChars)` for text it collapses, removes or replaces.
 * Those two calls are the whole contract — there is no way to advance the
 * normalised position without saying what happened to the raw position, which is
 * what makes an offset bug impossible to write by accident.
 */
export class OffsetMapBuilder {
  readonly #anchors: OffsetAnchor[] = [{ normalised: 0, raw: 0 }];
  #normalised = 0;
  #raw = 0;

  /** Text carried through verbatim: both positions advance together. */
  keep(rawChars: number): this {
    if (rawChars <= 0) return this;
    this.#normalised += rawChars;
    this.#raw += rawChars;
    return this;
  }

  /**
   * A discontinuity.
   *
   * @param rawChars        characters consumed from the raw input
   * @param normalisedChars characters emitted into the normalised text (0 when
   *                        the region is dropped, or the placeholder length when
   *                        it is collapsed)
   */
  skip(rawChars: number, normalisedChars: number): this {
    if (rawChars <= 0 && normalisedChars <= 0) return this;
    this.#normalised += normalisedChars;
    this.#raw += rawChars;
    this.#anchor();
    return this;
  }

  /** Record an anchor at the current position without moving either cursor. Use
   *  at a boundary the caller knows is significant (a turn start), so that a span
   *  beginning exactly there resolves exactly. */
  mark(): this {
    this.#anchor();
    return this;
  }

  #anchor(): void {
    const last = this.#anchors[this.#anchors.length - 1];
    if (last && last.normalised === this.#normalised && last.raw === this.#raw) return;
    this.#anchors.push({ normalised: this.#normalised, raw: this.#raw });
  }

  build(normalisedText: string, rawText: string): OffsetMap {
    // The final anchor is forced so that a span ending at the very end of the
    // normalised text resolves, even when the tail was contiguous.
    this.#normalised = normalisedText.length;
    this.#raw = rawText.length;
    this.#anchor();

    return {
      anchors: [...this.#anchors],
      normalisedLength: normalisedText.length,
      rawLength: rawText.length,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalised index → raw index.
 *
 * Between two anchors the mapping is a pure translation, so interpolation is
 * exact rather than approximate: if `a.normalised + d` is inside the run, then
 * `a.raw + d` is the right answer by construction.
 */
export function rawAt(map: OffsetMap, normalisedIndex: number): number {
  if (normalisedIndex <= 0) return 0;
  if (normalisedIndex >= map.normalisedLength) return map.rawLength;

  let anchor = map.anchors[0] ?? { normalised: 0, raw: 0 };
  for (const candidate of map.anchors) {
    if (candidate.normalised > normalisedIndex) break;
    anchor = candidate;
  }
  const raw = anchor.raw + (normalisedIndex - anchor.normalised);
  return Math.min(Math.max(raw, 0), map.rawLength);
}

/** Raw index → normalised index. The inverse, used by the review UI to highlight
 *  a raw range the user selected. Returns null when the raw index falls inside a
 *  collapsed region, which has no normalised counterpart. */
export function normalisedAt(map: OffsetMap, rawIndex: number): number | null {
  if (rawIndex <= 0) return 0;
  if (rawIndex >= map.rawLength) return map.normalisedLength;

  let before = map.anchors[0] ?? { normalised: 0, raw: 0 };
  let after: OffsetAnchor | null = null;

  for (const candidate of map.anchors) {
    if (candidate.raw > rawIndex) {
      after = candidate;
      break;
    }
    before = candidate;
  }

  // Inside a discontinuity: the raw index has no normalised counterpart.
  if (after !== null) {
    const gapRaw = after.raw - before.raw;
    const gapNormalised = after.normalised - before.normalised;
    if (gapRaw !== gapNormalised && rawIndex > before.raw) return null;
  }

  return before.normalised + (rawIndex - before.raw);
}

/* -------------------------------------------------------------------------- */
/* Spans                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY sanctioned way to build a `SourceSpan`.
 *
 * Takes normalised bounds, returns raw bounds, and verifies that the text at
 * those raw bounds is what the caller thinks it is. A mismatch means an offset
 * bug upstream; returning a span anyway would put a wrong quote in front of the
 * user, so it returns null and the caller discards the item.
 */
export function spanFrom(
  transcriptId: TranscriptId,
  raw: string,
  map: OffsetMap,
  normalisedStart: number,
  normalisedEnd: number,
  expectedText?: string,
): SourceSpan | null {
  if (normalisedEnd <= normalisedStart) return null;

  const start = rawAt(map, normalisedStart);
  const end = rawAt(map, normalisedEnd);
  if (end <= start) return null;

  const text = raw.slice(start, end);
  if (text.length === 0) return null;

  if (expectedText !== undefined && normaliseWhitespace(text) !== normaliseWhitespace(expectedText)) {
    return null;
  }

  return { transcriptId, start, end, text };
}

/**
 * Resolve a snippet the ENGINE returned back to a raw range.
 *
 * The LLM path returns text, not offsets — it cannot know them. So the snippet is
 * located by literal search, preferring a hit inside the span the candidate came
 * from. Anything that is not a literal substring is rejected here rather than
 * later, at the point where the reason is still known.
 */
export function locateSnippet(
  transcriptId: TranscriptId,
  raw: string,
  snippet: string,
  hint?: { readonly start: number; readonly end: number },
): SourceSpan | null {
  const needle = snippet.trim();
  if (needle.length === 0) return null;

  // Prefer a hit inside the hinted window: the same sentence can appear twice in
  // a long transcript and the hint is what disambiguates it.
  if (hint !== undefined && hint.end > hint.start) {
    const window = raw.slice(hint.start, hint.end);
    const at = window.indexOf(needle);
    if (at >= 0) {
      return { transcriptId, start: hint.start + at, end: hint.start + at + needle.length, text: needle };
    }
  }

  const at = raw.indexOf(needle);
  if (at < 0) return null;
  return { transcriptId, start: at, end: at + needle.length, text: needle };
}

/** Whitespace-insensitive comparison. Normalisation collapses runs of whitespace,
 *  so a verbatim snippet and its raw counterpart differ only in spacing. */
function normaliseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Normalised bounds → raw bounds.
 *
 * The forward direction of `normalisedAt`, and the one the review UI needs: turns
 * and episodes are stored in normalised coordinates because that is the text the
 * recognisers read, but highlighting happens in the raw pane.
 */
export function rawBounds(
  map: OffsetMap,
  normalisedStart: number,
  normalisedEnd: number,
): readonly [start: number, end: number] {
  return [rawAt(map, normalisedStart), rawAt(map, normalisedEnd)];
}

/** How many discontinuities the map describes. Reported in the review UI: a
 *  normalisation that touched almost everything is a normalisation worth
 *  doubting. */
export function anchorCount(map: OffsetMap): number {
  return map.anchors.length;
}
