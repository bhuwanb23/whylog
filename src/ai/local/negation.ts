/**
 * Polarity and negation scope ΓÇö 1.3, component 3.
 *
 * Phase 1 ┬╖ sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.3
 *
 * ---------------------------------------------------------------------------
 * WHY POLARITY IS ITS OWN PROBLEM
 *
 * A cue tells you a decision is PRESENT. It does not tell you which way it points.
 * "instead of Postgres" mentions Postgres and REJECTS it; "going with Postgres"
 * mentions Postgres and ACCEPTS it. Rationale Miner found negation explicit in
 * only 12% of rationale sentences (docs/05), so polarity has to come from the
 * cue's own direction as often as from a negation word ΓÇö and when both are
 * present they can disagree.
 *
 * Getting this backwards is the worst available extraction error, worse than
 * missing the decision entirely: a polarity flip records the REJECTED option as
 * the chosen one, and every downstream layer ΓÇö contradiction detection, export,
 * guard synthesis ΓÇö then reasons correctly from a false premise.
 *
 * ---------------------------------------------------------------------------
 * THE RULE WHEN CUE AND NEGATION DISAGREE
 *
 * A negation word INSIDE THE SCOPE WINDOW flips the cue's direction. "not going
 * with Postgres" is ΓêÆPostgres, not +Postgres.
 *
 * But a negation OUTSIDE the window does not: "we're not a big team, so going with
 * SQLite" is +SQLite, and the "not" belongs to the PREMISE. That is what the
 * scope window is for, and why it is capped at 6 tokens or the clause boundary,
 * whichever comes first.
 * ---------------------------------------------------------------------------
 */

import type { CueDirection } from "@/ontology/data/decision-cues";
import type { CueHit } from "@/extraction/cue-scan";
import { tokenise } from "@/lib/text";

/** +X means X is chosen. ΓêÆX means X is refused and belongs in
 *  `RejectedAlternative`. */
export type Polarity = "positive" | "negative";

export interface PolarityEvidence {
  readonly polarity: Polarity;
  /** What decided it, so a wrong call is diagnosable. */
  readonly via: "cue-direction" | "negation-flip" | "verb-pattern" | "default";
  readonly marker: string | null;
  /** The tokens the negation search covered. */
  readonly scope: readonly string[];
}

/**
 * Negation scope window, in tokens.
 *
 * Six because it covers "not really going with X", "don't think we should use X"
 * and "no, we're not switching to X" while stopping before the next clause in
 * almost every real transcript. The clause boundary is a hard stop regardless: a
 * negation separated from the cue by a full stop is a negation of something else.
 */
export const NEGATION_SCOPE_TOKENS = 6;

const NEGATIONS: readonly string[] = [
  "not", "no", "never", "neither", "nor", "without", "avoid", "avoiding",
  "skip", "skipping", "skipped", "drop", "dropping", "dropped",
  "dont", "don't", "doesnt", "doesn't", "didnt", "didn't",
  "wont", "won't", "cant", "can't", "cannot", "couldnt", "couldn't",
  "shouldnt", "shouldn't", "isnt", "isn't", "arent", "aren't", "wasnt", "wasn't",
  "hardly", "barely", "rather", "instead",
];

/** Verb patterns that carry polarity independent of any cue. Checked when the cue
 *  direction is `neutral`. */
const POSITIVE_VERBS: readonly RegExp[] = [
  /\b(?:switch(?:ed|ing)?|mov(?:e|ed|ing)|migrat(?:e|ed|ing)|go|going|went|upgrade[ds]?)\s+to\b/i,
  /\b(?:adopt|adopting|adopted|embrace|embracing)\b/i,
  /\b(?:use|using|used|pick|picked|choose|chose|chosen|select|selected|take|took)\b/i,
  /\b(?:go|going|went)\s+with\b/i,
  /\bstick(?:ing|s)?\s+with\b/i,
  /\bkeep(?:ing)?\b/i,
  /\bstandardis(?:e|ing)\s+on\b/i,
  /\bstandardiz(?:e|ing)\s+on\b/i,
  /\bsettled\s+on\b/i,
  /\blanded\s+on\b/i,
];

const NEGATIVE_VERBS: readonly RegExp[] = [
  /\b(?:drop|dropped|dropping|ditch|ditched|ditching|dump|dumped)\b/i,
  /\bstop(?:ped|ping)?\s+using\b/i,
  /\b(?:remove|removed|removing|delete[ds]?|deleting|kill|killed|killing)\b/i,
  /\brevert(?:ed|ing)?\b/i,
  /\b(?:rule|ruled|ruling)\s+out\b/i,
  /\b(?:reject|rejected|rejecting|decline[ds]?|veto(?:ed)?|scrap(?:ped)?)\b/i,
  /\bno\s+longer\b/i,
  /\b(?:give|gave|giving)\s+up\s+on\b/i,
  /\bwalk(?:ed|ing)?\s+back\b/i,
  /\bback(?:ing)?\s+out\b/i,
];

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

const CLAUSE_BREAK = /[.!?\n;]/;

/**
 * The tokens between the start of the cue's clause and the end of the cue phrase.
 *
 * This is the ONLY region a negation may flip polarity from. Extending it past the
 * clause boundary is how "we're not a big team, so going with SQLite" becomes
 * ΓêÆSQLite.
 */
export function negationScope(text: string, hit: CueHit): readonly string[] {
  const clauseStart = clauseStartBefore(text, hit.start);
  const window = text.slice(clauseStart, hit.end);
  const tokens = tokenise(window);

  // Keep the tokens closest to the cue: if the clause is long, the negation that
  // matters is the one adjacent to the verb, not the one four clauses back.
  return tokens.slice(Math.max(0, tokens.length - NEGATION_SCOPE_TOKENS));
}

/** A short window AFTER the cue, for the "X, not Y" construction where the
 *  rejection follows the choice: "going with SQLite, not Postgres". */
export function trailingScope(text: string, hit: CueHit, tokens = 8): readonly string[] {
  let end = hit.end;
  while (end < text.length && !CLAUSE_BREAK.test(text[end] ?? "")) end += 1;
  return tokenise(text.slice(hit.end, Math.min(end, text.length))).slice(0, tokens);
}

function clauseStartBefore(text: string, from: number): number {
  for (let i = Math.min(from, text.length) - 1; i >= 0; i -= 1) {
    const ch = text[i] ?? "";
    if (CLAUSE_BREAK.test(ch)) return i + 1;
    // A comma also bounds the window, but only when it follows a conjunction ΓÇö
    // "single file, synchronous API" is one thought, while "not a big team, so"
    // is two.
    if (ch === "," && /\b(?:so|because|since|but|and so)\s*$/i.test(text.slice(Math.max(0, i - 24), i))) {
      return i + 1;
    }
  }
  return 0;
}

/* -------------------------------------------------------------------------- */
/* Polarity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which way does the value attached to this cue point?
 *
 * @param text  the turn or episode body
 * @param hit   the cue
 * @param value the value text the cue attaches to, when already extracted. Lets
 *              the verb patterns be checked against the phrase that actually
 *              carries the verb ("switch to Postgres") rather than the whole turn.
 */
export function polarityOf(text: string, hit: CueHit, value?: string): PolarityEvidence {
  const scope = negationScope(text, hit);
  const negated = findNegation(scope);

  /* ---- 1. the cue's own direction ---- */
  if (hit.direction === "accept" || hit.direction === "reject") {
    const base: Polarity = hit.direction === "accept" ? "positive" : "negative";
    if (negated === null) {
      return { polarity: base, via: "cue-direction", marker: hit.phrase, scope };
    }
    // A negated accept is a reject, and a negated reject is an accept. Double
    // negation is rare enough in transcripts that one flip is the right model.
    return {
      polarity: base === "positive" ? "negative" : "positive",
      via: "negation-flip",
      marker: negated,
      scope,
    };
  }

  /* ---- 2. pivot: "X instead of Y" accepts X and rejects Y ---- */
  if (hit.direction === "pivot") {
    return {
      polarity: negated === null ? "positive" : "negative",
      via: negated === null ? "cue-direction" : "negation-flip",
      marker: negated ?? hit.phrase,
      scope,
    };
  }

  /* ---- 3. neutral cue: the verb decides ---- */
  const verbText = value !== undefined && value.length > 0 ? `${hit.phrase} ${value}` : hit.phrase;
  const positive = POSITIVE_VERBS.some((pattern) => pattern.test(verbText));
  const negative = NEGATIVE_VERBS.some((pattern) => pattern.test(verbText));

  if (negative && !positive) return { polarity: "negative", via: "verb-pattern", marker: verbText, scope };
  if (positive && !negative) return { polarity: "positive", via: "verb-pattern", marker: verbText, scope };

  if (negated !== null) return { polarity: "negative", via: "negation-flip", marker: negated, scope };

  // No evidence either way. DEFAULT POSITIVE: a decision cue with no polarity
  // signal is far more often a commitment than a refusal, and the review UI shows
  // the `via: "default"` marker so the guess is visible.
  return { polarity: "positive", via: "default", marker: null, scope };
}

function findNegation(scope: readonly string[]): string | null {
  const set = new Set(NEGATIONS);
  for (let i = scope.length - 1; i >= 0; i -= 1) {
    const token = scope[i];
    if (token !== undefined && set.has(token)) return token;
  }
  return null;
}

/** Is this token a negation? Exported for the premise extractor, where
 *  "no concurrent writers" is an OUT-list condition rather than a polarity flip. */
export function isNegation(token: string): boolean {
  return NEGATIONS.includes(token.toLowerCase());
}

/**
 * The cue inventory, exported.
 *
 * Phase 2 kept this list inside `ai/local/classify.ts`; Phase 3 collapsed that file into a
 * thin delegate over `retrieval/contradiction.ts` (one rule engine, not two that can
 * disagree ΓÇö the Phase 2 audit's gap 3). The vocabulary is a NEGATION concern, so it moved
 * here with the rest of the negation machinery rather than staying behind in a file that no
 * longer implements any rules.
 *
 * Exported because the health panel prints it: the cue list is the classifier's entire
 * polarity vocabulary, and a list the user cannot read is a list they cannot audit.
 */
export const NEGATION_CUES: readonly string[] = NEGATIONS;

/**
 * The value REJECTED by an "X, not Y" construction.
 *
 * "going with SQLite, not Postgres" ΓåÆ "postgres". This is the highest-precision
 * alternative source available on the local path, because the rejection is
 * syntactically explicit rather than inferred.
 */
export function rejectedAfterCue(text: string, hit: CueHit): string | null {
  const trailing = text.slice(hit.end, hit.end + 90);
  const match = /(?:^|[\s,])(?:not|rather than|instead of|over|no)\s+([A-Za-z0-9@/._+-]+(?:\s+[A-Za-z0-9@/._+-]+)?)/i.exec(
    trailing,
  );
  return match?.[1]?.trim() ?? null;
}

export const POLARITY_EXPLANATIONS: Readonly<Record<PolarityEvidence["via"], string>> = {
  "cue-direction": "the cue phrase itself carries the direction",
  "negation-flip": "a negation inside the cue's clause reversed it",
  "verb-pattern": "the verb decided, because the cue was direction-neutral",
  default: "no polarity evidence ΓÇö defaulted to chosen, which the review can correct",
};

export function describePolarity(evidence: PolarityEvidence): string {
  const marker = evidence.marker === null ? "" : ` ("${evidence.marker}")`;
  return `${evidence.polarity === "positive" ? "CHOSEN" : "REFUSED"}${marker} ΓÇö ${POLARITY_EXPLANATIONS[evidence.via]}`;
}

/** Which cue directions exist, for the review UI's legend. */
export function describeDirection(direction: CueDirection): string {
  switch (direction) {
    case "accept":
      return "the value after this cue is chosen";
    case "reject":
      return "the value after this cue is refused";
    case "pivot":
      return "\"X instead of Y\" ΓÇö accepts X, refuses Y";
    case "neutral":
      return "a decision is present; direction comes from the verb or a negation";
  }
}
