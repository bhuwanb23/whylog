/**
 * Decision recovery — 1.3.
 *
 * Phase 1 · sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md §1.3
 *
 * ---------------------------------------------------------------------------
 * THE SIX COMPONENTS, IN ORDER
 *
 *   1. cue detection          `cue-scan.ts`   — shared with the segmenter and the LLM path
 *   2. variable + value       `value-phrase.ts` + `@/ontology`
 *   3. polarity               `ai/local/negation.ts`
 *   4. modality               `ai/local/modality.ts`
 *   5. rationale              `rationale.ts`
 *   6. statement formation    `y-statement.ts`
 *
 * This module is the composition. Each component is separately testable and
 * separately tunable, which matters because Phase 7 measures them individually: a
 * single 400-line "extract a decision" function cannot be ablated.
 *
 * ---------------------------------------------------------------------------
 * WHAT BECOMES A NODE
 *
 *   modality `hypothetical`  → DISCARDED, with `discardedBy: "modality"`. A
 *                              question is not a decision, and keeping it as a
 *                              low-confidence candidate invites a bulk approve
 *                              that turns "what if we used Redis?" into a Redis
 *                              decision.
 *   modality `reported`      → DISCARDED. Somebody else's decision is context, not
 *                              a commitment this project made.
 *   modality `proposed`      → KEPT. The fold labels it UNKNOWN and only a
 *                              non-bulk human approval promotes it to IN, so a
 *                              proposal can never become a decision without
 *                              someone clicking on it. Discarding proposals would
 *                              lose the most useful thing in a transcript: what
 *                              the agent suggested and the human has not ruled out.
 *   modality `asserted`      → KEPT, and the only kind that can become IN at
 *                              creation.
 *
 * That is acceptance criterion "zero hypothetical or proposed statements become
 * nodes" satisfied structurally rather than by a filter someone can turn off.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE SYSTEMS
 *
 * Three of them, and mixing them up is the easiest bug in this pipeline to write
 * and the hardest to see — a snippet still renders, it just highlights the wrong
 * characters:
 *
 *   EPISODE     `episode.text` is assembled from turn bodies, so a cue position
 *               from `scanCues(episode.text)` is episode-relative.
 *   NORMALISED  each turn knows its own bounds here (`turn.start`), so
 *               `turn.start + positionWithinTurn` converts.
 *   RAW         `spanFrom()` with the transcript's offset map.
 *
 * Every span leaves this module in RAW coordinates, because that is what
 * `SourceSpan` promises and what the review pane highlights.
 *
 * ---------------------------------------------------------------------------
 * DEDUPLICATION IS BY VARIABLE + CANONICAL VALUE
 *
 * One negotiation routinely fires several cues: "we decided to use SQLite … going
 * with SQLite … SQLite it is". Three cues, ONE decision. Keeping all three would
 * triple the corroboration on a node that was decided once, and corroboration is an
 * input to entrenchment, which decides what gets retracted.
 * ---------------------------------------------------------------------------
 */

import type { Confidence, SourceSpan, TranscriptId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionVariable, Modality } from "@/types/domain";
import type { DiscardedCandidate, DecisionCandidate } from "@/ai/types";
import type { EpisodeWindow, NormalizedTurn } from "./types";
import { scanCues, variableAtCue, cueContext, type CueHit } from "./cue-scan";
import { spanFrom, type OffsetMap } from "./offset-map";
import { locateInEpisode, toNormalised, type Located } from "./episode-position";
import { extractClauseFields, type ClauseFields } from "./rationale";
import { imperativeStatement, renderYStatement, slotsFrom, type YStatementResult } from "./y-statement";
import { polarityOf, rejectedAfterCue, type PolarityEvidence } from "@/ai/local/negation";
import { classifyModality, type ModalityEvidence } from "@/ai/local/modality";
import { rankValues, valueAfter, valueBefore, type ValueCandidate } from "@/ai/local/value-phrase";
import { canonicalValueOf, foldKey, variableFromValue } from "@/ontology/canonicalize";
import { normalise } from "@/lib/text";

export interface DecisionContext {
  readonly transcriptId: TranscriptId;
  /** Verbatim raw input. Every span is validated against it. */
  readonly raw: string;
  /** The transcript's offset map. Required: without it a span cannot be built,
   *  and building one by arithmetic is how the evidence contract rots. */
  readonly map: OffsetMap;
}

export interface RecoveredDecision {
  readonly candidate: DecisionCandidate;
  /** Kept for confidence scoring and the review UI; not persisted on the node. */
  readonly cue: CueHit;
  readonly turn: NormalizedTurn;
  readonly modality: ModalityEvidence;
  readonly polarity: PolarityEvidence;
  readonly value: ValueCandidate;
  readonly fields: ClauseFields;
  readonly yStatement: YStatementResult;
  readonly episodeIndex: number;
  /** Values in the same clause that were REFUSED. Seeds 1.5. */
  readonly rejectedValues: readonly string[];
}

export interface DecisionRecovery {
  readonly decisions: readonly RecoveredDecision[];
  readonly discarded: readonly DiscardedCandidate[];
}

/** Below this a value is an ordinary word, not a technology choice. */
const MIN_VALUE_SCORE = 0.3;

/** Below this a cue is a passing mention. "deal" and "for now" are in the table at
 *  low weight so that they can be RECORDED as weak rather than silently dropped —
 *  but weak is not extractable. */
const MIN_CUE_WEIGHT = 0.35;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/** Recover the decisions in one episode. */
export function recoverDecisions(episode: EpisodeWindow, context: DecisionContext): DecisionRecovery {
  const hits = scanCues(episode.text);
  if (hits.length === 0) return { decisions: [], discarded: [] };

  const discarded: DiscardedCandidate[] = [];
  /* Strongest mention per (variable, value), not the first.
   *
   * A decision is negotiated across several turns and the same value is usually mentioned more than
   * once: an agent floats it early ("I'd use SQLite"), the human settles it later ("going with
   * SQLite, not Postgres"). Keeping the FIRST mention recorded the proposal's span, the proposal's
   * modality and the proposal's origin authority — so a decision a human accepted was stamped as an
   * agent proposal, which understates `source_authority`, which feeds entrenchment, which decides
   * what gets retracted. It also pointed provenance at the wrong sentence, so the review pane
   * highlighted a suggestion rather than the acceptance.
   *
   * Cue weight is the right tiebreak because it is exactly "how reliably does this phrase mark a
   * real decision": `going with` (0.90) outranks a bare `use` (0.60), which is the ordering the
   * table was written to express. Ties keep the earlier mention, so behaviour is unchanged where
   * there is nothing to choose between. */
  const best = new Map<string, { decision: RecoveredDecision; weight: number }>();

  for (const hit of hits) {
    const recovered = recoverOne(episode, hit, context);
    if (recovered === null) continue;

    if (recovered.kind === "discard") {
      discarded.push(recovered.discard);
      continue;
    }

    const key = dedupeKey(recovered.decision.candidate);
    const incumbent = best.get(key);
    if (incumbent === undefined || hit.weight > incumbent.weight) {
      best.set(key, { decision: recovered.decision, weight: hit.weight });
    }
  }

  return { decisions: [...best.values()].map((entry) => entry.decision), discarded };
}

type Recovered =
  | { readonly kind: "decision"; readonly decision: RecoveredDecision }
  | { readonly kind: "discard"; readonly discard: DiscardedCandidate };

function recoverOne(episode: EpisodeWindow, hit: CueHit, context: DecisionContext): Recovered | null {
  /* ---- 0. is this cue marking a decision, or the reason beside one? ----
   * "because", "since", "so that", "in order to" and "as long as" are episode-boundary markers and
   * rationale/premise material — `rationale.ts` and `premise-cues.ts` own them. Minting a decision
   * from one emits a second candidate for a decision the real cue already found, so one true
   * decision is scored as one false negative plus one false positive. Returned as null rather than
   * a discard: this is not a rejected candidate, it was never a decision cue. */
  if (hit.cue.rationaleOnly === true) return null;

  /* ---- 1. is the cue strong enough to be a decision at all? ---- */
  if (hit.weight < MIN_CUE_WEIGHT) {
    return discard("confidence-threshold", cueContext(episode.text, hit, 90), hit.weight);
  }

  /* ---- locate the turn, which every later component needs ---- */
  const located = locateInEpisode(episode, hit.start);
  if (located === null) return null;
  const localHit = shiftHit(hit, -located.offset);

  /* ---- 4. modality, before spending effort on the other slots ---- */
  const modality = classifyModality(located.turn.text, localHit, located.turn.speaker);

  if (modality.modality === "hypothetical" || modality.modality === "reported") {
    return discard("modality", modality.scope, hit.weight * 0.5);
  }

  /* ---- 2. value first, THEN variable ----
   *
   * `pickValue` needs a variable only to canonicalise the surface form, and `variableAtCue` accepts
   * the value as a hint — so the two are resolved in a second pass rather than guessed in the wrong
   * order. Guessing the variable from the cue's CONTEXT alone is what put "sqlite" in SCOPE and
   * "vite" in ARCHITECTURE: the episode's topic outvoted the value itself. A value is much stronger
   * evidence than a topic — `resolveVariable` scores the value first for exactly this reason — and
   * getting the slot wrong is not a cosmetic miss: the matcher requires the variable to agree, and
   * the identity ladder refuses to merge across slots, so a mis-slotted decision becomes one false
   * negative and one false positive at the same time. */
  const provisional = variableAtCue(episode.text, hit);
  const value = pickValue(episode.text, hit, provisional?.variable ?? "OTHER");
  if (value === null) return discard("confidence-threshold", cueContext(episode.text, hit, 90), hit.weight * 0.4);

  const guess = variableAtCue(episode.text, hit, value.surface);
  const variable: DecisionVariable = guess?.variable ?? provisional?.variable ?? "OTHER";

  /* ---- 3. polarity ---- */
  const polarity = polarityOf(episode.text, hit, value.surface);

  if (polarity.polarity === "negative") {
    // A refused value is a REJECTED ALTERNATIVE, not a decision. `alternatives.ts`
    // recovers it from the same cue; recording it here too would create a decision
    // node for the thing that was turned down.
    return null;
  }

  /* ---- 5. rationale, downside, applies_to, quality, concern ---- */
  const fields = extractClauseFields(episode.text, hit.start);

  /* ---- 6. statement ---- */
  const rejected = rejectedValues(episode.text, hit, value);
  const canonical = variable === "OTHER" ? foldKey(value.surface) : canonicalValueOf(variable, value.surface);
  const statement = imperativeStatement(canonical, rejected);

  const slots = slotsFrom(variable, canonical, statement, fields, rationalePremises(fields));
  const yStatement = renderYStatement(slots);

  /* ---- 1.6 provenance ---- */
  const snippet = spanFor(context, located, localHit, value);
  if (snippet === null) return null;

  const candidate: DecisionCandidate = {
    variable,
    value: canonical,
    statement,
    ...(yStatement.text.length > 0 ? { yStatement: yStatement.text } : {}),
    ...(fields.rationale === null ? {} : { rationale: fields.rationale.text }),
    ...(fields.downside === null ? {} : { acceptedDownside: fields.downside.text }),
    // Replaced by provenance.ts, which sees the whole turn list and can therefore
    // tell an acceptance from a proposal. Defaulting to the LOWEST authority here
    // means a pipeline that forgets the provenance stage produces under-confident
    // nodes rather than inflated ones.
    origin: "agent_inferred",
    modality: modality.modality as Modality,
    confidence: asConfidence(provisionalConfidence(hit, guess, value, fields, modality)),
    snippet,
    premiseRefs: [], // filled by premise-linker.ts once premises are recovered
    alternativeRefs: [], // filled by alternatives.ts
    appliesTo: fields.appliesTo,
  };

  return {
    kind: "decision",
    decision: {
      candidate,
      cue: hit,
      turn: located.turn,
      modality,
      polarity,
      value,
      fields,
      yStatement,
      episodeIndex: episode.index,
      rejectedValues: rejected,
    },
  };
}

function discard(
  discardedBy: DiscardedCandidate["discardedBy"],
  rawText: string,
  confidence: number,
): Recovered {
  return {
    kind: "discard",
    discard: { kind: "decision", discardedBy, rawText, confidence: asConfidence(confidence) },
  };
}

/* -------------------------------------------------------------------------- */
/* Value                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which value this cue is about.
 *
 * `valueAfter` first when the cue introduces its value ("going with X"), otherwise
 * `valueBefore` ("X it is"). Then the ranked candidates in the cue's context, so a
 * phrase the extractor could not delimit still yields the value the ontology
 * recognises.
 */
function pickValue(text: string, hit: CueHit, variable: DecisionVariable): ValueCandidate | null {
  const phrase = hit.valueAfter
    ? (valueAfter(text, hit.end) ?? valueBefore(text, hit.start))
    : (valueBefore(text, hit.start) ?? valueAfter(text, hit.end));

  const ranked = rankValues(
    text,
    Math.max(0, hit.start - 60),
    Math.min(text.length, hit.end + 90),
    variable,
  );

  if (phrase !== null) {
    const exact = ranked.find((c) => normalise(c.surface) === normalise(phrase));
    /* `bare` is rejected here for the same reason it is rejected in the fallback below: a bare value
     * is an ordinary word, not a technology or a choice, and the code's own definition of that case
     * is "a failed extraction, not a low-confidence one". Letting the phrase path admit one on score
     * alone is what turned "it's the thing" into AUTH → "thing" and "it's a local" into
     * ARCHITECTURE → "local" — the cue's own phrase matched an ordinary word and the score gate waved
     * it through. Two gates that disagree about the same word is how a decision node gets minted for
     * a sentence that only described the world. */
    if (exact !== undefined && exact.strength !== "bare") {
      if (exact.score >= MIN_VALUE_SCORE) return exact;
      if (exact.strength === "tech-shaped") return exact;
    }
  }

  const best = ranked[0];
  if (best === undefined || best.score < MIN_VALUE_SCORE) return null;

  // A `bare` best candidate means the only noun available is an ordinary word.
  // That is a failed extraction, not a low-confidence one.
  if (best.strength === "bare") return null;
  return best;
}

function rejectedValues(text: string, hit: CueHit, chosen: ValueCandidate): readonly string[] {
  const out: string[] = [];

  const explicit = rejectedAfterCue(text, hit);
  if (explicit !== null && normalise(explicit) !== normalise(chosen.surface)) {
    out.push(canonicalFold(explicit));
  }

  // "instead of Y" / "over Y" put the refusal after the cue. Restricted to values
  // the ontology knows, so that an ordinary noun never becomes a rejected
  // alternative — the precision problem ARGUS measured at 15.4%.
  const window = text.slice(hit.start, Math.min(text.length, hit.end + 140));
  const pivot = /\b(?:instead of|rather than|over|in preference to)\s+([A-Za-z0-9@/._+-]+)/i.exec(window);
  const pivotValue = pivot?.[1];
  if (pivotValue !== undefined && normalise(pivotValue) !== normalise(chosen.surface)) {
    const folded = canonicalFold(pivotValue);
    if (!out.includes(folded)) out.push(folded);
  }

  return out;
}

function canonicalFold(value: string): string {
  const variable = variableFromValue(value)?.variable ?? null;
  return variable === null ? foldKey(value) : canonicalValueOf(variable, value);
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Episode-relative position → the turn it falls in, plus the same position made
 * turn-relative.
 *
 * Returning the TURN rather than just an offset is what lets the caller get back to
 * normalised coordinates: `turn.start + localOffset`. There is no other route, and
 * inventing one is how an offset bug gets written.
 */
/** Shift a cue hit into a different coordinate system. Used to turn an
 *  episode-relative hit into a turn-relative one, which is what the modality and
 *  negation modules read. */
function shiftHit(hit: CueHit, delta: number): CueHit {
  return { ...hit, start: hit.start + delta, end: hit.end + delta };
}

/**
 * The verbatim span for this decision, in RAW coordinates.
 *
 * Runs cue start → value end, so the snippet reads as the sentence the user would
 * point at ("going with SQLite, not Postgres") rather than as the cue alone.
 */
function spanFor(
  context: DecisionContext,
  located: Located,
  localHit: CueHit,
  value: ValueCandidate,
): SourceSpan | null {
  const turn = located.turn;

  /* The value's bounds came from `rankValues` over the EPISODE text, so they cannot be added to a
   * turn offset; the value is re-located inside the turn by literal search instead.
   *
   * When the value is NOT in this turn the candidate is rejected rather than falling back to a
   * cue-only snippet. The fallback looked safe — the cue is still a true quote — but it is what
   * lets a weak copula cue ("it's") in one sentence adopt a value mentioned three sentences away,
   * and emit a decision whose snippet is the two characters "it's". A decision whose value does not
   * appear in the cue's own turn was not stated by that cue, and the real pivot case (a value
   * carried across two speakers) is rarer than the false positive it was buying. */
  const valueAt = turn.text.toLowerCase().indexOf(value.surface.toLowerCase());
  if (valueAt < 0) return null;

  const start = toNormalised(located, localHit.start);
  const end = toNormalised(located, Math.max(localHit.end, valueAt + value.surface.length));

  if (end <= start) return null;
  return spanFrom(context.transcriptId, context.raw, context.map, start, end);
}

/* -------------------------------------------------------------------------- */
/* Provisional confidence                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The additive score from plan §1.8, computed here because every term is already
 * in hand.
 *
 * `confidence.ts` recomputes and OVERRIDES this with the full rubric — including
 * origin, which needs the whole turn list and is not available inside one episode.
 * A provisional score exists so that a discard can carry an honest number: the
 * discarded list is the denominator of the precision metric, and a denominator of
 * zeros is not a measurement.
 */
function provisionalConfidence(
  hit: CueHit,
  guess: { score: number } | null,
  value: ValueCandidate,
  fields: ClauseFields,
  modality: ModalityEvidence,
): number {
  let score = 0;

  if (hit.weight >= 0.8) score += 0.3;
  else score += hit.weight * 0.3;

  if (guess !== null && guess.score >= 0.5) score += 0.25;
  if (value.strength === "known" || value.strength === "scoped-known") score += 0.15;
  if (fields.rationale !== null) score += 0.15;
  if (modality.modality === "asserted") score += 0.1;
  // +0.05 for human-stated origin is added by provenance.ts, which knows the speaker

  return Math.max(0.05, Math.min(0.95, score));
}

/** The rationale clause doubles as the premise seed until `premises.ts` runs.
 *  Returning it here keeps the Y-statement's context slot populated even when
 *  premise recovery finds nothing typed. */
function rationalePremises(fields: ClauseFields): readonly string[] {
  if (fields.rationale === null) return [];
  return [fields.rationale.text];
}

function dedupeKey(candidate: DecisionCandidate): string {
  return `${candidate.variable}\u0000${normalise(candidate.value)}`;
}

/** Confidence carried on a candidate, exposed so `confidence.ts` can demote
 *  rather than recompute from nothing. */
export function confidenceOf(candidate: DecisionCandidate): Confidence {
  return candidate.confidence;
}

/** How many cues fired and how many survived to become candidates. The gap is the
 *  discard rate, which is the number the review UI's "why so many?" answer needs. */
export function describeRecovery(recovery: DecisionRecovery, cueCount: number): string {
  return `${cueCount} cue${cueCount === 1 ? "" : "s"} → ${recovery.decisions.length} decision${recovery.decisions.length === 1 ? "" : "s"}, ${recovery.discarded.length} discarded`;
}
