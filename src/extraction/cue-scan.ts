/**
 * Cue scanning ΓÇö the shared front end of 1.3 and 1.5.
 *
 * Phase 1 ┬╖ sub-phases 1.2, 1.3, 1.5
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.3
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES IN `src/extraction/` AND NOT `src/ai/local/`
 *
 * STRUCTURE.md ┬º5 lists `ai/local/cues.ts`. It is here instead, because cue
 * matching is used by THREE consumers and only one of them is the local engine:
 *
 *   ΓÇó `segmentation.ts` ΓÇö cues mark EPISODE BOUNDARIES on both paths. An episode
 *     with no cue in it is not a decision episode, and that is true whether an LLM
 *     or a lexicon does the reading.
 *   ΓÇó the local recognisers ΓÇö cues are how it finds a decision at all.
 *   ΓÇó the LLM path ΓÇö as a sanity check. When the model returns a value that
 *     appears nowhere near a cue, that is worth downgrading.
 *
 * Two copies of the cue table would drift, and a drift between the segmenter and
 * the recogniser means an episode that contains a decision the recogniser cannot
 * see.
 *
 * ---------------------------------------------------------------------------
 * THE TABLE IS DATA, NOT CODE
 *
 * Phrases, weights, directions and speculative flags all come from
 * `src/ontology/data/decision-cues.ts` (Phase 0.7). This module only matches.
 * Extending recall is a data edit, which is the point: the eval harness in Phase 7
 * can measure a cue-table change without touching extraction logic.
 * ---------------------------------------------------------------------------
 */

import {
  DECISION_CUES,
  type CueDirection,
  type DecisionCue,
} from "@/ontology/data/decision-cues";
import { resolveVariable, type VariableGuess } from "@/ontology/canonicalize";
import { contentTokens, normalise } from "@/lib/text";
import type { DecisionVariable } from "@/types/domain";

export interface CueHit {
  readonly cue: DecisionCue;
  /** Index of the phrase in the scanned text. */
  readonly start: number;
  readonly end: number;
  readonly phrase: string;
  readonly direction: CueDirection;
  readonly weight: number;
  readonly speculative: boolean;
  /** Where the value is expected relative to the cue. */
  readonly valueAfter: boolean;
}

/** How many characters either side of a cue are read as its context. Wide enough
 *  to cover "going with SQLite rather than Postgres for the single-user case",
 *  narrow enough that the next sentence's topic does not leak in. */
export const CUE_CONTEXT_CHARS = 120;

/** Longest cue phrase in the table, used to size the match window. */
const LONGEST_PHRASE = DECISION_CUES.reduce((max, cue) => Math.max(max, cue.phrase.length), 0);

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Find every cue occurrence, sorted by position.
 *
 * Matching is on the LOWERCASED text but positions are indices into the ORIGINAL,
 * because lowercasing is length-preserving for everything in these transcripts
 * and a `SourceSpan` built from a lowercased index would be wrong the moment it
 * was not.
 *
 * Overlapping hits are resolved in favour of the LONGER phrase: "we decided to"
 * beats "decided to", and reporting both would double-count one decision.
 */
export function scanCues(text: string): readonly CueHit[] {
  const lower = text.toLowerCase();
  const hits: CueHit[] = [];

  for (const cue of DECISION_CUES) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(cue.phrase, from);
      if (at < 0) break;

      // A cue must not start mid-word: "undecided to" contains "decided to".
      const before = at === 0 ? " " : (lower[at - 1] ?? " ");
      const after = lower[at + cue.phrase.length] ?? " ";
      if (/[\w]/.test(before) || /[\w]/.test(after)) {
        from = at + 1;
        continue;
      }

      hits.push({
        cue,
        start: at,
        end: at + cue.phrase.length,
        phrase: text.slice(at, at + cue.phrase.length),
        direction: cue.direction,
        weight: cue.weight,
        speculative: cue.speculative,
        valueAfter: cue.valueAfter,
      });
      from = at + cue.phrase.length;
    }
  }

  return dedupeOverlaps(hits.sort((a, b) => a.start - b.start || b.end - a.end));
}

function dedupeOverlaps(sorted: readonly CueHit[]): readonly CueHit[] {
  const kept: CueHit[] = [];
  let coveredUntil = -1;

  for (const hit of sorted) {
    if (hit.start < coveredUntil) continue;
    kept.push(hit);
    coveredUntil = hit.end;
  }
  return kept;
}

/** Does any cue occur at all? Cheap pre-filter used by the segmenter to skip
 *  stretches of transcript that cannot contain a decision. */
export function hasCue(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_CUES.some((cue) => lower.includes(cue.phrase));
}

/** The strongest cue in a stretch of text, or null. */
export function strongestCue(text: string): CueHit | null {
  const hits = scanCues(text);
  if (hits.length === 0) return null;
  return hits.reduce((best, hit) => (hit.weight > best.weight ? hit : best));
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** The window of text a cue's variable and value are read from. */
export function cueContext(text: string, hit: CueHit, chars: number = CUE_CONTEXT_CHARS): string {
  const start = Math.max(0, hit.start - Math.floor(chars / 3));
  const end = Math.min(text.length, hit.end + chars);
  return text.slice(start, end);
}

/** Tokens for `resolveVariable`, which accumulates evidence over a token list. */
export function contextTokens(text: string, hit: CueHit): readonly string[] {
  return contentTokens(cueContext(text, hit));
}

/**
 * Which ontology variable is under negotiation at this cue.
 *
 * Returns null rather than `OTHER` when there is no evidence at all: `OTHER` is a
 * real answer ("a variable the ontology does not know") and conflating it with
 * "we have not looked yet" would hide the signal the health panel watches. The
 * `OTHER`-rate metric only means something if `OTHER` is only ever assigned after
 * a genuine attempt.
 */
export function variableAtCue(text: string, hit: CueHit, valueHint?: string): VariableGuess | null {
  const tokens = contextTokens(text, hit);
  if (tokens.length === 0 && (valueHint === undefined || valueHint.length === 0)) return null;

  const guess = resolveVariable(valueHint ?? "", tokens);
  if (guess.via === "fallback" && tokens.length === 0) return null;
  return guess;
}

/**
 * Best variable for a whole episode: the majority of its cues, weighted by cue
 * strength. A cue-weighted majority rather than a plain one because a weak
 * topical cue should not outvote "we decided to".
 */
export function episodeVariable(text: string, hits: readonly CueHit[]): DecisionVariable | null {
  if (hits.length === 0) return null;

  const tally = new Map<DecisionVariable, number>();
  for (const hit of hits) {
    const guess = variableAtCue(text, hit);
    if (guess === null) continue;
    tally.set(guess.variable, (tally.get(guess.variable) ?? 0) + guess.score * hit.weight);
  }
  if (tally.size === 0) return null;

  const ranked = [...tally.entries()].sort((a, b) =>
    b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1],
  );
  return ranked[0]?.[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function cueCount(): number {
  return DECISION_CUES.length;
}

export function describeHits(hits: readonly CueHit[]): string {
  if (hits.length === 0) return "no decision cues";
  const phrases = hits.slice(0, 4).map((h) => `"${normalise(h.phrase)}"`);
  const more = hits.length > 4 ? ` +${hits.length - 4} more` : "";
  return `${hits.length} cue${hits.length === 1 ? "" : "s"}: ${phrases.join(", ")}${more}`;
}

/** Longest phrase in the table ΓÇö exposed so the segmenter can size its window
 *  without re-deriving it. */
export function longestCuePhrase(): number {
  return LONGEST_PHRASE;
}
