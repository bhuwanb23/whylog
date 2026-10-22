/**
 * Premise recovery ΓÇö 1.4. THE LOAD-BEARING SUB-PHASE.
 *
 * Phase 1 ┬╖ sub-phase 1.4
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.4
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE PRODUCT
 *
 * Everything else in Phase 1 is commodity: decisions are extractable at published
 * rates (~0.75 F1) and three shipping tools already do it. Premises are not. RAAM
 * needed an expert walkthrough to recover the assumptions a decision rests on,
 * which is the same as saying nobody has automated it.
 *
 * If premises cannot be recovered from dialogue at usable precision, the
 * truth-maintenance layer has nothing to maintain and the product collapses to a
 * decision log ΓÇö that is, to `ai-memory`. So this file is the one to prototype and
 * measure before anything else is built, and the one whose numbers must be reported
 * honestly.
 *
 * ---------------------------------------------------------------------------
 * CLOSED SET DISCIPLINE
 *
 * Exactly the 8 premise types from Phase 0.7. An unclassifiable assumption becomes
 * `requirement` with a free-text predicate and is flagged low-confidence. There is
 * no ninth type and no code path that invents one: RAAM's precision problem is
 * unbounded assumption discovery, and the closed set is the mitigation.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CANDIDATE IS REVIEWED
 *
 * `needsReview` is true for every topical cue and for every explicit cue below
 * 0.9 ΓÇö which, reading `premise-cues.ts`, is all of them. That is not an oversight
 * in the table, it is the table saying out loud that premise extraction does not
 * yet earn auto-acceptance. `TOPICAL_AUTO_ACCEPT_THRESHOLD = 1.0` is unreachable by
 * construction. When Phase 7's measurement says otherwise, the threshold moves and
 * this file does not.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES *NOT* DO
 *
 * It does not decide whether a premise SUPPORTS a decision or is EXCLUDED by it.
 * That is `premise-linker.ts`, because the answer depends on the decision as well
 * as on the premise, and this module only ever sees one episode's text.
 * ---------------------------------------------------------------------------
 */

import type { Confidence } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { PremiseType } from "@/types/domain";
import type { DiscardedCandidate, PremiseCandidate } from "@/ai/types";
import type { EpisodeWindow } from "./types";
import type { DecisionContext } from "./decisions";
import { spanFrom } from "./offset-map";
import { locateInEpisode, type Located } from "./episode-position";
import { canonicalPredicate, snakeCase } from "@/ontology/canonicalize";
import {
  PREMISE_CUES,
  EXPLICIT_AUTO_ACCEPT_THRESHOLD,
  TOPICAL_AUTO_ACCEPT_THRESHOLD,
  needsReview as cueNeedsReview,
  type PremiseCue,
} from "@/ontology/data/premise-cues";
import { PREMISE_TYPE_META, lookupPredicate } from "@/ontology/data/premise-types";

export interface RecoveredPremise {
  readonly candidate: PremiseCandidate;
  readonly cue: PremiseCue;
  readonly kind: "explicit" | "topical";
  /** Positive supports the decision; negative and restrictive constrain it. The
   *  linker turns a constrained premise into an OUT-list entry. */
  readonly polarity: PremisePolarity;
  readonly turn: Located["turn"];
  readonly episodeIndex: number;
  /** How the predicate was obtained. `cue` is the strong case; `derived` means the
   *  cue had no predicate and one was built from the text, which always needs a
   *  human look. */
  readonly predicateVia: "cue" | "derived";
}

export type PremisePolarity = "positive" | "negative" | "restrictive";

export interface PremiseRecovery {
  readonly premises: readonly RecoveredPremise[];
  readonly discarded: readonly DiscardedCandidate[];
  /** Per-type counts, for the histogram that shows whether the cue table is
   *  lopsided against this corpus. */
  readonly byType: Readonly<Record<PremiseType, number>>;
}

/** Below this a topical cue is noise. It is recorded as a discard rather than
 *  dropped, because the discard list is the denominator of the precision metric. */
const MIN_CUE_WEIGHT = 0.4;

/** Longest cue phrase first, so "no other users" wins over "no". */
const CUES_BY_LENGTH: readonly PremiseCue[] = [...PREMISE_CUES].sort(
  (a, b) => b.phrase.length - a.phrase.length || b.weight - a.weight,
);

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twelve: 12, twenty: 20, fifty: 50, hundred: 100,
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function recoverPremises(episode: EpisodeWindow, context: DecisionContext): PremiseRecovery {
  const found: RecoveredPremise[] = [];
  const discarded: DiscardedCandidate[] = [];
  /** Positions already claimed by a longer cue, so "no other users" does not also
   *  fire "no". */
  const claimed: boolean[] = new Array(episode.text.length).fill(false);
  /** One candidate per predicate per episode. Two cues for the same assumption are
   *  one assumption, and emitting both would double its corroboration. */
  const seenPredicate = new Set<string>();

  for (const cue of CUES_BY_LENGTH) {
    let from = 0;
    for (;;) {
      const at = episode.text.toLowerCase().indexOf(cue.phrase, from);
      if (at < 0) break;
      from = at + cue.phrase.length;

      if (claimed.slice(at, at + cue.phrase.length).some(Boolean)) continue;
      for (let i = at; i < at + cue.phrase.length; i += 1) claimed[i] = true;

      const located = locateInEpisode(episode, at);
      if (located === null) continue;

      const built = buildPremise(episode, cue, at, located, context);
      if (built === null) {
        discarded.push({
          kind: "premise",
          discardedBy: "confidence-threshold",
          rawText: windowAround(episode.text, at, 90),
          confidence: asConfidence(cue.weight * 0.5),
        });
        continue;
      }

      const key = `${built.candidate.type}\u0000${built.candidate.predicate}`;
      if (seenPredicate.has(key)) continue;
      seenPredicate.add(key);

      found.push(built);
    }
  }

  const byType = countByType(found);
  return { premises: found, discarded, byType };
}

function buildPremise(
  episode: EpisodeWindow,
  cue: PremiseCue,
  at: number,
  located: Located,
  context: DecisionContext,
): RecoveredPremise | null {
  if (cue.weight < MIN_CUE_WEIGHT) return null;

  /* ---- predicate: from the cue, or derived from the text ---- */
  const viaCue = cue.predicate !== undefined && lookupPredicate(cue.predicate) !== null;
  const derived = viaCue ? null : derivePredicate(cue, located.turn.text, at - located.offset);
  const predicate = viaCue ? canonicalPredicate(cue.type, cue.predicate as string) : derived;
  if (predicate === null) return null;

  /* ---- value ---- */
  const meta = PREMISE_TYPE_META[cue.type];
  const declared = lookupPredicate(predicate);
  const valueKind = declared?.predicate.valueKind ?? meta.predicates[0]?.valueKind ?? "string";
  const value = readValue(episode.text, at, cue.phrase.length, valueKind);

  /* ---- text: the clause, verbatim ---- */
  const clause = readClause(located.turn.text, at - located.offset, cue.phrase.length);
  if (clause.trim().length < 4) return null;

  /* ---- span, in raw coordinates ---- */
  const normalisedStart = located.turn.start + clause.start;
  const normalisedEnd = located.turn.start + clause.end;
  const snippet = spanFrom(
    context.transcriptId,
    context.raw,
    context.map,
    normalisedStart,
    normalisedEnd,
  );
  if (snippet === null) return null;

  const polarity: PremisePolarity = cue.polarity ?? "positive";
  const confidence = scorePremise(cue, viaCue, value !== undefined, polarity);

  const candidate: PremiseCandidate = {
    type: cue.type,
    predicate,
    ...(value === undefined ? {} : { value }),
    text: clause.text.trim(),
    confidence,
    snippet,
    // Every premise is reviewed. See the file header: the cue table's own
    // thresholds are unreachable on purpose, and this module does not get to
    // decide otherwise.
    needsReview: cueNeedsReview(cue) || !viaCue || confidence < EXPLICIT_AUTO_ACCEPT_THRESHOLD,
  };

  return {
    candidate,
    cue,
    kind: cue.kind,
    polarity,
    turn: located.turn,
    episodeIndex: episode.index,
    predicateVia: viaCue ? "cue" : "derived",
  };
}

/* -------------------------------------------------------------------------- */
/* Predicate                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build a predicate for a cue that does not declare one.
 *
 * Always namespaced under the cue's own type, so rung 1 of the identity ladder can
 * still match it exactly on a re-import. An unnamespaced predicate would resolve
 * differently on each run and mint a duplicate node every time ΓÇö the failure the
 * closed vocabulary exists to prevent.
 *
 * The result is `requirement.<free text>` when nothing better is available, which
 * is the plan's designated escape hatch and is always flagged low-confidence.
 */
function derivePredicate(cue: PremiseCue, turnText: string, localAt: number): string | null {
  const namespace = PREMISE_TYPE_META[cue.type].namespace;
  const cueWords = snakeCase(cue.phrase.replace(/[^A-Za-z0-9 ]/g, " "));

  // A cue whose phrase already reads as a predicate name ("single user",
  // "free tier") is the best available derivation and is stable across runs.
  if (cueWords.length >= 3 && cueWords.length <= 40) {
    const candidate = canonicalPredicate(cue.type, cueWords);
    if (lookupPredicate(candidate) !== null) return candidate;

    // Not a declared predicate, but still stable and still namespaced.
    const words = cueWords.split("_").filter((w) => w.length > 0);
    if (words.length > 0 && words.length <= 4) return `${namespace}.${words.join("_")}`;
  }

  const clause = readClause(turnText, localAt, cue.phrase.length).text;
  const words = snakeCase(clause.replace(/[^A-Za-z0-9 ]/g, " "))
    .split("_")
    .filter((w) => w.length > 2)
    .slice(0, 4);

  if (words.length === 0) return null;
  return `${namespace}.${words.join("_")}`;
}

/* -------------------------------------------------------------------------- */
/* Value                                                                      */
/* -------------------------------------------------------------------------- */

/** Read the value a cue introduces, in the shape its predicate declares. */
function readValue(
  text: string,
  at: number,
  phraseLength: number,
  valueKind: "boolean" | "number" | "string" | "enum",
): string | number | boolean | undefined {
  const window = text.slice(Math.max(0, at - 40), Math.min(text.length, at + phraseLength + 40));

  if (valueKind === "boolean") {
    // A negative cue asserts `false` on a predicate whose name implies presence:
    // "no concurrent writers" is `concurrent_writers = 0`, "not multi-tenant" is
    // `multi_tenant = false`. Returning `true` here would invert the premise.
    return undefined;
  }

  if (valueKind === "number") {
    const number = readNumber(window);
    if (number !== null) return number;
    return undefined;
  }

  // `string` and `enum`: the cue phrase is the value. Canonicalisation of an enum
  // is the predicate table's job, not the extractor's ΓÇö guessing a permitted value
  // here would be inventing data.
  const trimmed = window.trim();
  return trimmed.length > 0 && trimmed.length <= 60 ? trimmed : undefined;
}

function readNumber(window: string): number | null {
  const digits = /\b(\d{1,7})\b/.exec(window);
  if (digits !== null) return Number(digits[1]);

  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(window)) return value;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Clause                                                                     */
/* -------------------------------------------------------------------------- */

const CLAUSE_END = /[.!?\n;]/;

/** The clause containing a cue, expanded a little either side so the premise reads
 *  as a sentence rather than as a fragment. */
function readClause(text: string, at: number, phraseLength: number): { text: string; start: number; end: number } {
  let start = at;
  while (start > 0 && !CLAUSE_END.test(text[start - 1] ?? "")) start -= 1;

  let end = at + phraseLength;
  while (end < text.length && !CLAUSE_END.test(text[end] ?? "")) end += 1;

  const body = text.slice(start, end);
  const trimmed = body.replace(/^\s*(?:and|but|so|because|since)\s+/i, "");
  return { text: trimmed, start, end };
}

function windowAround(text: string, at: number, chars: number): string {
  const start = Math.max(0, at - Math.floor(chars / 3));
  return text.slice(start, Math.min(text.length, at + chars)).trim();
}

/* -------------------------------------------------------------------------- */
/* Confidence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Additive, inspectable, and deliberately capped below the decision rubric.
 *
 * Plan ┬º1.8: premises are always one tier lower than the decision they attach to,
 * reflecting the published precision gap. `confidence.ts` applies the tier demotion;
 * this score is the input to it.
 */
function scorePremise(
  cue: PremiseCue,
  predicateFromCue: boolean,
  hasValue: boolean,
  polarity: PremisePolarity,
): Confidence {
  let score = cue.weight * 0.55;

  if (cue.kind === "explicit") score += 0.2;
  if (predicateFromCue) score += 0.15; // a namespaced predicate is rung-1 matchable
  if (hasValue) score += 0.05;

  // A restrictive cue ("one person", "only me") is the strongest premise signal in
  // dialogue: it states a bound rather than mentioning a topic.
  if (polarity === "restrictive") score += 0.05;

  // Topical cues never clear the auto-accept threshold, and the score should say
  // so rather than leaving it to `needsReview` alone.
  if (cue.kind === "topical") score = Math.min(score, TOPICAL_AUTO_ACCEPT_THRESHOLD - 0.15);

  return asConfidence(Math.max(0.05, Math.min(0.9, score)));
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function countByType(found: readonly RecoveredPremise[]): Readonly<Record<PremiseType, number>> {
  const out: Record<PremiseType, number> = {
    scale: 0, team: 0, budget: 0, time: 0,
    deployment: 0, capability: 0, requirement: 0, external: 0,
  };
  for (const premise of found) out[premise.candidate.type] += 1;
  return out;
}

export function describeRecovery(recovery: PremiseRecovery): string {
  const parts: string[] = [];
  for (const type of Object.keys(recovery.byType) as PremiseType[]) {
    const count = recovery.byType[type];
    if (count > 0) parts.push(`${type} ${count}`);
  }
  const summary = parts.length === 0 ? "no typed premises" : parts.join(" ┬╖ ");
  return `${recovery.premises.length} premise${recovery.premises.length === 1 ? "" : "s"} (${summary}), ${recovery.discarded.length} discarded`;
}

/**
 * How many premises came from a cue that declared its predicate.
 *
 * This is the number that decides whether the closed set is doing its job. A low
 * rate means the extractor is inventing `requirement.<free text>` predicates, which
 * resolve at rung 4 or worse and therefore need review every time.
 */
export function predicateFromCueRate(recovery: PremiseRecovery): number {
  if (recovery.premises.length === 0) return 0;
  const fromCue = recovery.premises.filter((p) => p.predicateVia === "cue").length;
  return fromCue / recovery.premises.length;
}

export { MIN_CUE_WEIGHT as PREMISE_MIN_CUE_WEIGHT };
