/**
 * Rationale, accepted downside and `applies_to` ΓÇö 1.3, component 5.
 *
 * Phase 1 ┬╖ sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.3
 *
 * ---------------------------------------------------------------------------
 * WHY THE RATIONALE IS A SEPARATE FIELD AND NOT PART OF THE STATEMENT
 *
 * The statement is what the export ships as a rule; the rationale is why the rule
 * exists. Keeping them apart is what lets Phase 2 ask "is this rationale still
 * true?" ΓÇö a question that cannot be posed of a sentence where the two are fused.
 *
 * ---------------------------------------------------------------------------
 * WHY `acceptedDownside` DESERVES EXTRACTION EFFORT
 *
 * Nobody stores it, and it is precisely what a future you needs when the downside
 * arrives. "SQLite, and yes that means one writer at a time" is the sentence that
 * stops a re-litigation six months later. It is also the cheapest trust signal
 * available: an extractor that recovers the cost of a decision, not only its
 * benefit, is visibly reading rather than pattern-matching.
 *
 * ---------------------------------------------------------------------------
 * DIRECTION
 *
 * Rationale markers are sought BOTH after and before the cue. Dialogue puts the
 * reason first about as often as last ΓÇö "single-user and no deploy hassle is the
 * whole argument" follows the decision, but "we can't afford a managed service, so
 * SQLite" precedes it. Searching only one direction halves recall for no gain.
 * ---------------------------------------------------------------------------
 */

import { contentTokens } from "@/lib/text";
import { findGlobs } from "@/lib/glob";

export interface RationaleCandidate {
  readonly text: string;
  readonly marker: string;
  readonly direction: "after" | "before";
  readonly start: number;
  readonly end: number;
  /** 0..1. Explicit markers score above the topic sentence. */
  readonly strength: number;
}

export interface DownsideCandidate {
  readonly text: string;
  readonly marker: string;
  readonly start: number;
  readonly end: number;
}

export interface ClauseFields {
  readonly rationale: RationaleCandidate | null;
  readonly downside: DownsideCandidate | null;
  readonly appliesTo: readonly string[];
  /** What the decision is trying to achieve ΓÇö the `to achieve Γƒ¿qualityΓƒ⌐` slot. */
  readonly quality: string | null;
  /** What problem prompted it ΓÇö the `facing Γƒ¿concernΓƒ⌐` slot. */
  readonly concern: string | null;
}

/* -------------------------------------------------------------------------- */
/* Markers                                                                    */
/* -------------------------------------------------------------------------- */

/** Explicit reason markers, strongest first. */
const RATIONALE_MARKERS: readonly string[] = [
  "the whole argument is",
  "the whole reason is",
  "the reason being",
  "the reason is",
  "mainly because",
  "mostly because",
  "purely because",
  "simply because",
  "so that",
  "in order to",
  "because",
  "due to",
  "owing to",
  "on account of",
  "given that",
  "seeing as",
  "as long as",
  "since",
  "for this reason",
  "which means",
  "that means",
  "to avoid",
  "to keep",
  "to prevent",
  "to sidestep",
  "so we don't",
  "so we do not",
  "so we can",
  "so it",
  "so",
];

const DOWNSIDE_MARKERS: readonly string[] = [
  "accepted downside",
  "accepting that",
  "accepting the",
  "we accept",
  "i accept",
  "the downside is",
  "downside is",
  "the trade-off is",
  "trade-off is",
  "tradeoff is",
  "the cost is",
  "the catch is",
  "catch is",
  "the caveat is",
  "caveat is",
  "the limitation is",
  "at the cost of",
  "even though",
  "yes that means",
  "which does mean",
  "which means we lose",
  "we lose",
  "gives up",
  "giving up",
  "sacrificing",
  "in exchange for",
  "the price is",
];

/** Quality attributes ΓÇö the `to achieve` slot's vocabulary. */
const QUALITY_TERMS: readonly string[] = [
  "simplicity", "simple", "portability", "portable", "performance", "speed", "fast",
  "reliability", "reliable", "testability", "testable", "maintainability",
  "flexibility", "flexible", "control", "predictability", "deterministic",
  "offline", "zero-config", "zero config", "no deploy", "no infrastructure",
  "low cost", "free", "cheap", "security", "privacy", "latency", "throughput",
  "developer experience", "dx", "velocity", "stability", "observability",
];

/** Concern markers ΓÇö the `facing` slot. */
const CONCERN_MARKERS: readonly string[] = [
  "the problem is",
  "problem is",
  "the issue is",
  "issue is",
  "the pain is",
  "facing",
  "we need",
  "i need",
  "we're hitting",
  "we hit",
  "blocked by",
  "struggling with",
  "the hard part is",
  "concern is",
  "the worry is",
];

/** How far either side of the cue to look. Longer than the negation window
 *  because a rationale is a clause, not a word. */
const RATIONALE_WINDOW = 260;
const DOWNSIDE_WINDOW = 200;

const CLAUSE_END = /[.!?\n;]/;

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pull the clause fields out of an episode or turn body.
 *
 * @param text  the body being read
 * @param at    the position of the decision cue within it
 */
export function extractClauseFields(text: string, at: number): ClauseFields {
  return {
    rationale: extractRationale(text, at),
    downside: extractDownside(text, at),
    appliesTo: extractAppliesTo(text, at),
    quality: extractQuality(text, at),
    concern: extractConcern(text, at),
  };
}

/** The reason clause, searching after the cue first because that is where prose
 *  usually puts it, then before. */
export function extractRationale(text: string, at: number): RationaleCandidate | null {
  return rationaleIn(text, at, "after") ?? rationaleIn(text, at, "before");
}

function rationaleIn(text: string, at: number, direction: "after" | "before"): RationaleCandidate | null {
  const windowStart = direction === "after" ? at : Math.max(0, at - RATIONALE_WINDOW);
  const windowEnd = direction === "after" ? Math.min(text.length, at + RATIONALE_WINDOW) : at;
  const window = text.slice(windowStart, windowEnd);
  const lower = window.toLowerCase();

  let best: RationaleCandidate | null = null;

  for (let m = 0; m < RATIONALE_MARKERS.length; m += 1) {
    const marker = RATIONALE_MARKERS[m];
    if (marker === undefined) continue;

    const found = lower.indexOf(marker);
    if (found < 0) continue;

    const bodyStart = windowStart + found + marker.length;
    const body = readClause(text, bodyStart);
    if (body.text.trim().length < 8) continue;

    // Earlier in the table means a more explicit marker, so the first hit wins
    // unless a later one is markedly longer ΓÇö a longer reason is a better reason.
    const strength = 1 - m / (RATIONALE_MARKERS.length * 1.6);
    const candidate: RationaleCandidate = {
      text: body.text.trim(),
      marker,
      direction,
      start: body.start,
      end: body.end,
      strength: Math.max(0.2, Math.min(0.98, strength + (body.text.length > 60 ? 0.05 : 0))),
    };

    if (best === null || candidate.strength > best.strength) best = candidate;
    if (best !== null && best.strength > 0.9) break;
  }

  return best;
}

export function extractDownside(text: string, at: number): DownsideCandidate | null {
  const start = Math.max(0, at - Math.floor(DOWNSIDE_WINDOW / 3));
  const end = Math.min(text.length, at + DOWNSIDE_WINDOW);
  const window = text.slice(start, end);
  const lower = window.toLowerCase();

  for (const marker of DOWNSIDE_MARKERS) {
    const found = lower.indexOf(marker);
    if (found < 0) continue;

    const body = readClause(text, start + found + marker.length);
    if (body.text.trim().length < 6) continue;

    return {
      text: body.text.trim(),
      marker,
      start: body.start,
      end: body.end,
    };
  }
  return null;
}

/**
 * File globs this decision governs.
 *
 * Sought in a wider window than the other fields because `applies_to` is often
 * stated a sentence or two away from the decision: "that's the rule for anything
 * under src/db". Feeds export ┬º5.3 and guard scoping ┬º4.2.
 */
export function extractAppliesTo(text: string, at: number): readonly string[] {
  const start = Math.max(0, at - 300);
  const end = Math.min(text.length, at + 400);
  const found = findGlobs(text.slice(start, end));
  return [...new Set(found)].slice(0, 8);
}

function extractQuality(text: string, at: number): string | null {
  const window = text.slice(Math.max(0, at - 120), Math.min(text.length, at + RATIONALE_WINDOW)).toLowerCase();
  for (const term of QUALITY_TERMS) {
    if (window.includes(term)) return term;
  }
  return null;
}

function extractConcern(text: string, at: number): string | null {
  const start = Math.max(0, at - 300);
  const window = text.slice(start, at);
  const lower = window.toLowerCase();

  for (const marker of CONCERN_MARKERS) {
    const found = lower.lastIndexOf(marker);
    if (found < 0) continue;
    const body = readClause(window, found + marker.length);
    if (body.text.trim().length < 6) continue;
    return body.text.trim();
  }

  // No marker: the tokens of the preceding clause are the best available summary
  // of what prompted the decision. Weak, and reported as such by being the last
  // resort rather than a scored candidate.
  const preceding = window.trim().split(CLAUSE_END).filter((s) => s.trim().length > 0);
  const last = preceding[preceding.length - 1];
  if (last === undefined) return null;
  const tokens = contentTokens(last);
  return tokens.length >= 3 ? last.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Clause reading                                                             */
/* -------------------------------------------------------------------------- */

/** Read forward from `start` to the end of the clause, trimming a leading
 *  conjunction or comma. */
function readClause(text: string, start: number): { text: string; start: number; end: number } {
  let i = start;
  while (i < text.length && /[\s,;:]/.test(text[i] ?? "")) i += 1;

  let end = i;
  while (end < text.length && !CLAUSE_END.test(text[end] ?? "")) end += 1;

  const body = text.slice(i, end);
  const trimmed = body.replace(/^(?:and|but|so|which|that)\s+/i, "");
  return { text: trimmed, start: i, end };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeFields(fields: ClauseFields): string {
  const parts: string[] = [];
  parts.push(fields.rationale === null ? "no rationale clause" : `rationale via "${fields.rationale.marker}"`);
  parts.push(fields.downside === null ? "no accepted downside" : "accepted downside recovered");
  parts.push(fields.quality === null ? "no quality term" : `quality: ${fields.quality}`);
  parts.push(fields.concern === null ? "no concern" : `concern: ${fields.concern.slice(0, 40)}`);
  if (fields.appliesTo.length > 0) parts.push(`applies to ${fields.appliesTo.join(", ")}`);
  return parts.join(" ┬╖ ");
}

export function markerCounts(): Readonly<Record<string, number>> {
  return {
    rationale: RATIONALE_MARKERS.length,
    downside: DOWNSIDE_MARKERS.length,
    quality: QUALITY_TERMS.length,
    concern: CONCERN_MARKERS.length,
  };
}
