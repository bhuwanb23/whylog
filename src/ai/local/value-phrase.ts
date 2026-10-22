/**
 * Value-phrase extraction and the known-value lexicon — 1.3, component 2.
 *
 * Phase 1 · sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md §1.3
 *
 * STRUCTURE.md §5 calls this file `lexicon.ts` and describes it as "synonym
 * folding — the file that decides whether the local path feels intelligent".
 * Synonym folding proper already exists and is better placed: it is
 * `src/ontology/canonicalize.ts`, backed by ~560 aliases authored in Phase 0.7.
 * What is genuinely local-only, and lives here, is the other half of the job:
 *
 *   1. finding WHICH WORDS in a clause are the value at all — "going with SQLite
 *      with better-sqlite3 instead of Postgres" has three nouns and one of them is
 *      the decision;
 *   2. ranking candidate values by how much the ontology knows about them, so the
 *      extractor prefers a recognised technology over a generic English noun.
 *
 * ---------------------------------------------------------------------------
 * THE RANKING IS THE WHOLE TRICK
 *
 * A value the alias table claims is almost always the decision. A value that is
 * merely tech-shaped (`kebab-case`, `dotted`, `CamelCase`) is a decent guess. A
 * bare common noun is a last resort and should usually mean the extraction failed,
 * which is why it scores low enough to land in the collapsed review tier rather
 * than being silently asserted.
 * ---------------------------------------------------------------------------
 */

import { DECISION_VARIABLES, type DecisionVariable } from "@/types/domain";
import { VARIABLE_META } from "@/ontology/data/variables";
import { ALIASES, GLOBAL_ALIASES, canonicalToVariables } from "@/ontology/data/aliases";
import { canonicalValueOf, foldKey, variableFromValue } from "@/ontology/canonicalize";
import { STOPWORDS, tokenise } from "@/lib/text";

export type ValueStrength = "known" | "scoped-known" | "tech-shaped" | "bare";

export interface ValueCandidate {
  /** Verbatim from the text, so the snippet still resolves. */
  readonly surface: string;
  /** Alias-folded. This is what goes on the node. */
  readonly canonical: string;
  /** Best variable for it, or null when the ontology has no opinion. */
  readonly variable: DecisionVariable | null;
  readonly strength: ValueStrength;
  readonly score: number;
  readonly start: number;
  readonly end: number;
}

/* -------------------------------------------------------------------------- */
/* The lexicon                                                                */
/* -------------------------------------------------------------------------- */

/**
 * folded value → the variables that claim it. Built once at module load.
 *
 * Seeded from `canonicalToVariables()` (aliases.ts) so the canonical direction is
 * defined in exactly one place, then extended with the ALIAS direction and with
 * `commonValues`, neither of which that function covers.
 */
const CLAIMED_BY: ReadonlyMap<string, readonly DecisionVariable[]> = buildClaimIndex();

function buildClaimIndex(): ReadonlyMap<string, readonly DecisionVariable[]> {
  const index = new Map<string, DecisionVariable[]>();

  const claim = (value: string, variable: DecisionVariable): void => {
    const key = foldKey(value);
    if (key.length === 0) return;
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, [variable]);
      return;
    }
    if (!existing.includes(variable)) existing.push(variable);
  };

  for (const [canonical, variables] of canonicalToVariables()) {
    for (const variable of variables) claim(canonical, variable);
  }

  for (const variable of DECISION_VARIABLES) {
    for (const alias of Object.keys(ALIASES[variable])) claim(alias, variable);
    for (const value of VARIABLE_META[variable].commonValues) claim(value, variable);
  }

  return index;
}

/** Every value the ontology knows, for the review UI's autocomplete. */
export function knownValues(): readonly string[] {
  return [...new Set([...ALIASES_LIST, ...GLOBAL_LIST])].sort();
}

const ALIASES_LIST: readonly string[] = Object.values(ALIASES).flatMap((table) =>
  Object.values(table),
);
const GLOBAL_LIST: readonly string[] = Object.values(GLOBAL_ALIASES);

/** Which variables claim this value. Empty means the ontology has never heard of
 *  it, which is a real signal rather than a missing one. */
export function variablesFor(value: string): readonly DecisionVariable[] {
  return CLAIMED_BY.get(foldKey(value)) ?? [];
}

/** How many values the lexicon covers. Reported in the health panel: a lexicon
 *  that stops growing is a lexicon that has stopped matching new transcripts. */
export function lexiconSize(): number {
  return CLAIMED_BY.size;
}

/* -------------------------------------------------------------------------- */
/* Phrase extraction                                                          */
/* -------------------------------------------------------------------------- */

const VALUE_CHAR = /[A-Za-z0-9@/._+\-#]/;
/** Words that may appear INSIDE a value ("Tailwind CSS", "GitHub Actions") but
 *  never START one. */
const INNER_WORDS = new Set(["css", "actions", "cloud", "code", "studio", "server", "db", "js", "ui", "kit", "engine", "api"]);
/** Words that END a value: a conjunction or a preposition is the start of the
 *  next thought. */
const TRAILING_STOP = new Set([
  "and", "or", "but", "so", "because", "since", "for", "with", "without",
  "instead", "rather", "over", "not", "no", "the", "a", "an", "to", "in", "on",
  "as", "by", "from", "then", "also", "just", "really", "actually",
]);
const LEADING_STOP = new Set(["the", "a", "an", "some", "any", "this", "that", "using", "use", "go", "going", "with", "to", "switch", "switching", "move", "moving", "migrate", "migrating", "adopt", "pick", "picked", "choose", "chose", "keep", "sticking", "stick"]);

/**
 * The value phrase that follows a cue.
 *
 * @param text      the turn or episode body
 * @param from      index to start reading at — normally the end of the cue phrase
 * @param maxChars  hard cap; a value phrase longer than this is a sentence the
 *                  extractor mistook for a noun phrase
 */
export function valueAfter(text: string, from: number, maxChars = 60): string | null {
  const window = text.slice(from, from + maxChars);
  const phrase = takePhrase(window);
  return phrase.length === 0 ? null : phrase.trim();
}

/**
 * The value phrase that PRECEDES a cue, for "SQLite it is" / "SQLite, decided".
 *
 * Read backwards from the cue and reversed, because `takePhrase` is written
 * forwards and two phrase extractors would drift.
 */
export function valueBefore(text: string, until: number, maxChars = 60): string | null {
  const start = Math.max(0, until - maxChars);
  const window = text.slice(start, until);

  // Take the LAST phrase in the window, which is the one adjacent to the cue.
  const tokens = window.split(/(\s+)/);
  let end = tokens.length;
  while (end > 0) {
    const piece = (tokens[end - 1] ?? "").trim();
    if (piece.length > 0) break;
    end -= 1;
  }

  let begin = end;
  while (begin > 0) {
    const piece = (tokens[begin - 1] ?? "").trim();
    if (piece.length === 0) {
      begin -= 1;
      continue;
    }
    const lower = piece.toLowerCase().replace(/[^\w]/g, "");
    if (TRAILING_STOP.has(lower) || LEADING_STOP.has(lower) || STOPWORDS.has(lower)) break;
    if (!VALUE_CHAR.test(piece)) break;
    begin -= 1;
  }

  const phrase = tokens.slice(begin, end).join("").trim();
  return phrase.length === 0 ? null : phrase;
}

/** Read a value phrase forward from the start of `window`. */
function takePhrase(window: string): string {
  // Skip leading whitespace, stopwords and the cue's own verb, so that
  // "going with the SQLite file" yields "sqlite file" rather than "with".
  let i = 0;
  for (;;) {
    const match = /^\s*([A-Za-z]+)(?![\w.-])/.exec(window.slice(i));
    if (match === null) break;
    const word = match[1] ?? "";
    const lower = word.toLowerCase();
    if (!LEADING_STOP.has(lower) && !STOPWORDS.has(lower)) break;
    i += match[0].length;
  }

  const words: string[] = [];
  let cursor = i;

  while (cursor < window.length) {
    const rest = window.slice(cursor);
    const match = /^\s*([A-Za-z0-9@/._+\-#']+)/.exec(rest);
    if (match === null) break;

    const raw = match[1] ?? "";
    const clean = raw.replace(/[,.;:!?'"()]+$/g, "");
    if (clean.length === 0) break;

    const lower = clean.toLowerCase();
    if (words.length > 0 && (TRAILING_STOP.has(lower) || STOPWORDS.has(lower))) break;
    if (words.length > 0 && !INNER_WORDS.has(lower) && !/[.\-@/#]/.test(clean) && !isKnown(lower)) break;
    if (words.length >= 4) break;

    words.push(clean);
    cursor += match[0].length - (raw.length - clean.length);
  }

  return words.join(" ");
}

function isKnown(value: string): boolean {
  return CLAIMED_BY.has(foldKey(value));
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

const STRENGTH_SCORE: Readonly<Record<ValueStrength, number>> = {
  known: 0.95,
  "scoped-known": 0.8,
  "tech-shaped": 0.55,
  bare: 0.25,
};

/**
 * Rank every candidate value in a clause.
 *
 * Called with the cue's context window rather than the whole episode: a value
 * mentioned three sentences away is not the value this decision is about.
 */
export function rankValues(text: string, start: number, end: number, hintVariable?: DecisionVariable | null): readonly ValueCandidate[] {
  const window = text.slice(start, end);
  const candidates: ValueCandidate[] = [];
  const seen = new Set<string>();

  for (const match of window.matchAll(/[A-Za-z0-9][A-Za-z0-9@/._+\-#']*/g)) {
    const surface = match[0].replace(/[,.;:!?'"()]+$/g, "");
    if (surface.length < 2) continue;

    const lower = surface.toLowerCase();
    if (STOPWORDS.has(lower) || TRAILING_STOP.has(lower) || LEADING_STOP.has(lower)) continue;

    // Multi-word values are joined greedily: "Tailwind CSS" must not arrive as two
    // candidates, one of which ("css") is a real technology and therefore a
    // plausible wrong answer.
    const extended = extendWithInnerWords(window, match.index ?? 0, surface);
    const key = foldKey(extended);
    if (seen.has(key)) continue;
    seen.add(key);

    const at = start + (match.index ?? 0);
    candidates.push(scoreCandidate(extended, at, at + extended.length, hintVariable ?? null));
  }

  return candidates.sort((a, b) => b.score - a.score || a.start - b.start);
}

function extendWithInnerWords(window: string, at: number, surface: string): string {
  let phrase = surface;
  let cursor = at + surface.length;

  for (;;) {
    const match = /^\s+([A-Za-z]+)/.exec(window.slice(cursor));
    if (match === null) break;
    const word = match[1] ?? "";
    if (!INNER_WORDS.has(word.toLowerCase())) break;
    phrase = `${phrase} ${word}`;
    cursor += match[0].length;
  }
  return phrase;
}

function scoreCandidate(
  surface: string,
  start: number,
  end: number,
  hintVariable: DecisionVariable | null,
): ValueCandidate {
  const key = foldKey(surface);
  const claimedBy = CLAIMED_BY.get(key) ?? [];
  const guess = variableFromValue(surface);
  const variable = hintVariable ?? guess?.variable ?? claimedBy[0] ?? null;

  let strength: ValueStrength;
  if (claimedBy.length > 0 && hintVariable !== null && claimedBy.includes(hintVariable)) {
    strength = "scoped-known";
  } else if (claimedBy.length > 0 || guess !== null) {
    strength = "known";
  } else if (isTechShaped(surface)) {
    strength = "tech-shaped";
  } else {
    strength = "bare";
  }

  let score = STRENGTH_SCORE[strength];
  if (hintVariable !== null && variable === hintVariable) score += 0.05;
  if (claimedBy.length > 1) score -= 0.15; // ambiguous across slots: "local", "none"
  if (surface.length <= 3 && strength === "bare") score -= 0.1; // "db", "ui", "api"

  return {
    surface,
    canonical: variable === null ? key : canonicalValueOf(variable, surface),
    variable,
    strength,
    score: Math.max(0, Math.min(1, score)),
    start,
    end,
  };
}

/** Looks like a product or package name rather than an English word. */
export function isTechShaped(surface: string): boolean {
  if (/[.@/#]/.test(surface)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(surface)) return true; // kebab-case
  if (/^[A-Z][a-z]+[A-Z]/.test(surface)) return true; // CamelCase
  if (/\d/.test(surface) && /[a-z]/i.test(surface)) return true; // "es2022", "s3"
  if (/^[A-Z]{2,}$/.test(surface)) return true; // "SQL", "ORM"
  return false;
}

/**
 * Values in a clause that are KNOWN but were not the chosen one.
 *
 * Feeds 1.5: "going with SQLite instead of Postgres" has two known values and the
 * cue direction says which is which. Restricting rejected-alternative recovery to
 * values the ontology recognises is what keeps its precision above the published
 * 15.4% — an unknown noun rejected for unknown reasons is not worth pre-empting
 * on.
 */
export function knownValuesIn(text: string, start: number, end: number): readonly ValueCandidate[] {
  return rankValues(text, start, end, null).filter((c) => c.strength === "known" || c.strength === "scoped-known");
}

export function describeStrength(strength: ValueStrength): string {
  switch (strength) {
    case "known":
      return "the ontology's alias table claims this value";
    case "scoped-known":
      return "claimed by the alias table AND scoped to the variable under negotiation";
    case "tech-shaped":
      return "looks like a product name, but the ontology does not know it — worth adding";
    case "bare":
      return "an ordinary word; probably not the value, review before accepting";
  }
}

/** Tokens that are values rather than prose, for callers that already tokenised. */
export function valueTokens(text: string): readonly string[] {
  return tokenise(text).filter((token) => isTechShaped(token) || isKnown(token));
}
