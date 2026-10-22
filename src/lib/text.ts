/**
 * Text normalisation and tokenisation.
 *
 * Phase 1 ┬╖ sub-phase 1.1, and Phase 3 ┬╖ sub-phase 3.2
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.1
 *       plan/phase-3-retrieval.md ┬º3.2
 *
 * Everything here is deterministic and locale-independent. No Intl, no
 * localeCompare ΓÇö the same transcript must tokenise identically on every machine
 * or the hash chain and the golden tests both break.
 */

/** A small closed stopword list. Deliberately tiny: aggressive stopword
 *  removal destroys the negation cues ("not", "no", "never") that Phase 2's
 *  gate (b) and the local classifier depend on. Those words are KEPT. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "we",
  "you",
  "i",
  "they",
  "he",
  "she",
  "as",
  "at",
  "by",
  "from",
  "so",
  "then",
  "there",
  "here",
  "just",
  "really",
  "actually",
  "basically",
  "like",
  "yeah",
  "ok",
  "okay",
]);

/** Lowercase, strip punctuation, collapse whitespace. Never touches case
 *  inside code fences ΓÇö callers must strip those first. */
export function normalise(input: string): string {
  return input
    .toLowerCase()
    // Keep hyphens and dots inside tokens: "better-sqlite3", "vite+react",
    // "src/db/**" are single meaningful units.
    .replace(/[^a-z0-9+./_*\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into tokens WITHOUT removing stopwords. */
export function tokenise(input: string): readonly string[] {
  const normalised = normalise(input);
  return normalised.length === 0 ? [] : normalised.split(" ");
}

/** Split and drop stopwords. Used for the sparse index only ΓÇö never for
 *  negation or polarity analysis, which need the full token stream. */
export function contentTokens(input: string): readonly string[] {
  return tokenise(input).filter((t) => !STOPWORDS.has(t));
}

/**
 * Character n-grams. Used by the local hashed embedding (src/ai/local/embed.ts)
 * so that morphological variants ("migrate", "migrating", "migration") land in
 * overlapping buckets without a stemmer.
 */
export function charNgrams(input: string, n = 3): readonly string[] {
  const padded = `  ${normalise(input)} `;
  if (padded.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i <= padded.length - n; i += 1) {
    out.push(padded.slice(i, i + n));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Speaker turns                                                              */
/* -------------------------------------------------------------------------- */

export type Speaker = "human" | "agent" | "unknown";

export interface Turn {
  readonly speaker: Speaker;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const HUMAN_MARKERS = [
  /^(user|human|me|you)\s*:/i,
  /^>\s/,
  /^#\s*user/i,
];

const AGENT_MARKERS = [
  /^(assistant|agent|claude|copilot|cursor|codex|ai|bot)\s*:/i,
  /^ΓÅ║/,
  /^ΓÄ┐/,
];

/**
 * Speaker attribution. Provenance (Phase 1.6) and therefore `source_authority`
 * in the entrenchment function both depend on this, so a failure to attribute
 * must fall back to the LOWEST authority ("unknown" -> agent_inferred), never to
 * the highest. Guessing "human" would inflate entrenchment.
 */
export function detectSpeaker(line: string): Speaker {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "unknown";
  if (HUMAN_MARKERS.some((re) => re.test(trimmed))) return "human";
  if (AGENT_MARKERS.some((re) => re.test(trimmed))) return "agent";
  return "unknown";
}

/** Strip a leading "User:" / "Assistant:" marker, returning the body and the
 *  offset at which the body starts (so char spans stay accurate). */
export function stripSpeakerMarker(line: string): { body: string; offset: number } {
  const match = /^(user|human|assistant|agent|claude|copilot|me|you|ai|bot)\s*:\s*/i.exec(line);
  if (!match) return { body: line, offset: 0 };
  return { body: line.slice(match[0].length), offset: match[0].length };
}

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Is `snippet` a LITERAL substring of `source`?
 *
 * Hard rule on the LLM extraction path: any returned snippet that fails this
 * check is discarded and its item downgraded to low confidence. This one check
 * prevents the most common and most corrosive LLM extraction failure ΓÇö
 * paraphrased citations that quietly rot the evidence contract.
 */
export function isLiteralSubstring(snippet: string, source: string): boolean {
  if (snippet.length === 0) return false;
  return source.includes(snippet);
}

/** Collapse whitespace for display without changing offsets. */
export function displayTrim(input: string, max = 240): string {
  const collapsed = input.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}ΓÇª`;
}
