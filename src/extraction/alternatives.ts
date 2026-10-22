/**
 * Rejected-alternative recovery ΓÇö 1.5.
 *
 * Phase 1 ┬╖ sub-phase 1.5
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.5
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GETS ITS OWN SUB-PHASE
 *
 * ARGUS measured **15.4% precision** on Alternatives with run-consistency ╬▒ = 0.64
 * ΓÇö the worst of any rationale component (docs/05 ┬º4). It is also the
 * highest-value one, because alternatives power PRE-EMPTION: catching a mistake
 * before the decision rather than after.
 *
 * Their finding argues in WhyLog's favour, and it is testable: "Alternatives occur
 * almost exclusively in issues, pull requests, and code reviews" ΓÇö that is, in
 * DISCUSSION. A transcript IS continuous discussion, so it should be the richest
 * available source. Phase 7 tests that hypothesis; this file is written to make the
 * test possible rather than to assume the result.
 *
 * ---------------------------------------------------------------------------
 * HOW PRECISION IS BOUGHT
 *
 * Three restrictions, each of which costs recall and buys precision, in the order
 * they cost least:
 *
 *   1. **Only values the ontology recognises.** An unknown noun rejected for
 *      unknown reasons is not worth pre-empting on. `value-phrase.ts` supplies the
 *      strength; anything `bare` is dropped.
 *
 *   2. **Only inside an episode that produced a decision.** A rejected alternative
 *      with nothing chosen against it is not an alternative, it is a topic. Those
 *      become discards, which is the denominator of the precision measurement.
 *
 *   3. **`whyRejected` gates the pre-emption index, not the store.** An
 *      alternative with no reason is recorded ΓÇö losing it would lose information ΓÇö
 *      but it never warns anybody. Pre-empting without a reason is nagging, and a
 *      tool that nags gets switched off.
 *
 * Plus the review tier: alternatives are collapsed by default and require explicit
 * confirmation before entering the index. A false pre-emption ("you rejected
 * Supabase" when you did not) is worse than no pre-emption at all, because it
 * arrives at the moment the user is most receptive to it.
 * ---------------------------------------------------------------------------
 */

import type { DiscardedCandidate, AlternativeCandidate } from "@/ai/types";
import type { DecisionVariable } from "@/types/domain";
import { asConfidence } from "@/types/common";
import type { EpisodeWindow } from "./types";
import type { DecisionContext, RecoveredDecision } from "./decisions";
import { spanFrom } from "./offset-map";
import { locateInEpisode, toNormalised } from "./episode-position";
import { rankValues, type ValueCandidate } from "@/ai/local/value-phrase";
import { canonicalValueOf, foldKey, variableFromValue } from "@/ontology/canonicalize";
import { normalise } from "@/lib/text";

export interface RecoveredAlternative {
  readonly candidate: AlternativeCandidate;
  /** Index into the episode's recovered decisions. */
  readonly decisionIndex: number;
  readonly value: ValueCandidate;
  /** How it was found. `pivot` is the syntactically explicit case and by far the
   *  most precise; `cue` is a rejection phrase; `contrast` is the weakest. */
  readonly via: "pivot" | "cue" | "contrast";
  readonly cuePhrase: string | null;
  readonly episodeIndex: number;
}

export interface AlternativeRecovery {
  readonly alternatives: readonly RecoveredAlternative[];
  readonly discarded: readonly DiscardedCandidate[];
  /** How many carry a reason. The ratio is the number that decides whether the
   *  pre-emption index has anything in it. */
  readonly withReason: number;
}

/** Rejection phrases, longest first so "we could have used" is not read as
 *  "could have". */
const REJECTION_CUES: readonly { phrase: string; weight: number; whyAfter: boolean }[] = [
  { phrase: "we could have used", weight: 0.85, whyAfter: true },
  { phrase: "we could have gone with", weight: 0.85, whyAfter: true },
  { phrase: "could have used", weight: 0.8, whyAfter: true },
  { phrase: "ruled out", weight: 0.9, whyAfter: true },
  { phrase: "rule out", weight: 0.7, whyAfter: true },
  { phrase: "decided against", weight: 0.95, whyAfter: true },
  { phrase: "instead of", weight: 0.9, whyAfter: false },
  { phrase: "rather than", weight: 0.9, whyAfter: false },
  { phrase: "in preference to", weight: 0.85, whyAfter: false },
  { phrase: "over using", weight: 0.7, whyAfter: false },
  { phrase: "we skipped", weight: 0.8, whyAfter: true },
  { phrase: "skipping", weight: 0.65, whyAfter: true },
  { phrase: "dropped", weight: 0.7, whyAfter: true },
  { phrase: "dropping", weight: 0.65, whyAfter: true },
  { phrase: "ditched", weight: 0.8, whyAfter: true },
  { phrase: "not using", weight: 0.75, whyAfter: true },
  { phrase: "no longer using", weight: 0.8, whyAfter: true },
  { phrase: "reverted", weight: 0.75, whyAfter: true },
  { phrase: "before we go down the", weight: 0.7, whyAfter: false },
  { phrase: "would work but", weight: 0.8, whyAfter: true },
  { phrase: "would have worked but", weight: 0.8, whyAfter: true },
  { phrase: "is tempting but", weight: 0.75, whyAfter: true },
  { phrase: "seems like a good fit but", weight: 0.7, whyAfter: true },
  { phrase: "we don't need", weight: 0.6, whyAfter: true },
  { phrase: "avoid", weight: 0.55, whyAfter: true },
];

const MIN_CONFIDENCE = 0.35;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function recoverAlternatives(
  episode: EpisodeWindow,
  decisions: readonly RecoveredDecision[],
  context: DecisionContext,
): AlternativeRecovery {
  if (decisions.length === 0) {
    // Nothing was chosen, so nothing was chosen AGAINST. Every rejection phrase in
    // this episode becomes a discard ΓÇö recorded, so the precision denominator is
    // honest, and visible in the review UI's "why was this dropped" list.
    return { alternatives: [], discarded: collectOrphans(episode), withReason: 0 };
  }

  const found: RecoveredAlternative[] = [];
  const discarded: DiscardedCandidate[] = [];
  const seen = new Set<string>();

  /* ---- 1. the pivot values the decision recovery already found ---- */
  decisions.forEach((decision, decisionIndex) => {
    for (const rejected of decision.rejectedValues) {
      const key = dedupeKey(decision.candidate.variable, rejected);
      if (seen.has(key)) continue;

      const value = valueFromText(episode.text, rejected, decision.candidate.variable);
      if (value === null) continue;
      seen.add(key);

      const built = build(episode, decisionIndex, decisions, value, "pivot", null, context, discarded);
      if (built !== null) found.push(built);
    }
  });

  /* ---- 2. rejection cues in the episode text ---- */
  const lower = episode.text.toLowerCase();
  for (const cue of REJECTION_CUES) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(cue.phrase, from);
      if (at < 0) break;
      from = at + cue.phrase.length;

      const value = valueNear(episode.text, at + cue.phrase.length, decisions);
      if (value === null) {
        discarded.push({
          kind: "alternative",
          discardedBy: "confidence-threshold",
          rawText: episode.text.slice(Math.max(0, at - 20), at + cue.phrase.length + 60).trim(),
          confidence: asConfidence(cue.weight * 0.4),
        });
        continue;
      }

      const decisionIndex = nearestDecision(decisions, episode, at);
      const key = dedupeKey(value.variable ?? decisions[decisionIndex]?.candidate.variable ?? "OTHER", value.canonical);
      if (seen.has(key)) continue;
      seen.add(key);

      const built = build(episode, decisionIndex, decisions, value, "cue", cue, context, discarded, at, cue.whyAfter);
      if (built !== null) found.push(built);
    }
  }

  return {
    alternatives: found,
    discarded,
    withReason: found.filter((a) => a.candidate.whyRejected !== undefined).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

function build(
  episode: EpisodeWindow,
  decisionIndex: number,
  decisions: readonly RecoveredDecision[],
  value: ValueCandidate,
  via: RecoveredAlternative["via"],
  cue: { phrase: string; weight: number } | null,
  context: DecisionContext,
  discarded: DiscardedCandidate[],
  cueAt?: number,
  whyAfter?: boolean,
): RecoveredAlternative | null {
  const decision = decisions[decisionIndex];
  if (decision === undefined) return null;

  // Never record the chosen value as its own alternative. A pivot construction
  // mis-parsed at either end produces exactly this, and "you rejected SQLite" on a
  // SQLite decision is the most damaging false pre-emption available.
  if (normalise(value.canonical) === normalise(decision.candidate.value)) return null;

  const variable: DecisionVariable = value.variable ?? decision.candidate.variable;
  const canonical = variable === "OTHER" ? foldKey(value.surface) : canonicalValueOf(variable, value.surface);

  const why = findWhyRejected(episode.text, cueAt ?? value.start, whyAfter ?? true);
  const confidence = score(value, via, cue, why !== null);

  if (confidence < MIN_CONFIDENCE) {
    discarded.push({
      kind: "alternative",
      discardedBy: "confidence-threshold",
      rawText: value.surface,
      confidence,
    });
    return null;
  }

  const snippet = spanFor(episode, value, context);
  if (snippet === null) return null;

  return {
    candidate: {
      variable,
      value: canonical,
      ...(why === null ? {} : { whyRejected: why }),
      confidence,
      snippet,
      decisionRef: decisionIndex,
    },
    decisionIndex,
    value,
    via,
    cuePhrase: cue?.phrase ?? null,
    episodeIndex: episode.index,
  };
}

/**
 * The reason this alternative was turned down.
 *
 * Sought after the cue ("ruled out Postgres ΓÇö migrations before we have a user")
 * and, when that fails, before it ("migrations are a hassle, so not Postgres").
 * Both directions because dialogue puts the reason wherever the speaker was
 * heading.
 */
function findWhyRejected(text: string, at: number, afterFirst: boolean): string | null {
  const order = afterFirst ? ["after", "before"] : ["before", "after"];

  for (const direction of order) {
    const window =
      direction === "after"
        ? text.slice(at, Math.min(text.length, at + 180))
        : text.slice(Math.max(0, at - 180), at);

    const found = reasonClause(window, direction === "before");
    if (found !== null) return found;
  }
  return null;
}

const REASON_MARKERS = [
  "because", "since", "due to", "as it", "as they", "so ", "which means",
  "that means", "but it", "but that", "but you", "but we", "too much", "too many",
  "requires", "would need", "would mean", "means", "the problem", "the catch",
  "overkill", "heavier", "more complex", "dependency", "ceremony", "hassle",
];

function reasonClause(window: string, reversed: boolean): string | null {
  const lower = window.toLowerCase();
  const positions = REASON_MARKERS.map((marker) => ({ marker, at: reversed ? lower.lastIndexOf(marker) : lower.indexOf(marker) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => (reversed ? b.at - a.at : a.at - b.at));

  const best = positions[0];
  if (best === undefined) return null;

  const body = reversed
    ? window.slice(0, best.at).trim()
    : window.slice(best.at).trim();

  const clause = body.split(/[.!?\n;]/)[0]?.trim() ?? "";
  if (clause.length < 10 || clause.length > 200) return null;
  return clause;
}

/* -------------------------------------------------------------------------- */
/* Values                                                                     */
/* -------------------------------------------------------------------------- */

function valueNear(
  text: string,
  at: number,
  decisions: readonly RecoveredDecision[],
): ValueCandidate | null {
  const hint = decisions[0]?.candidate.variable ?? null;
  const ranked = rankValues(text, at, Math.min(text.length, at + 80), hint);

  // Only values the ontology recognises. See the file header: restriction 1.
  const known = ranked.find((c) => c.strength === "known" || c.strength === "scoped-known");
  if (known !== undefined) return known;

  const shaped = ranked.find((c) => c.strength === "tech-shaped");
  return shaped ?? null;
}

function valueFromText(text: string, surface: string, hint: DecisionVariable): ValueCandidate | null {
  const at = text.toLowerCase().indexOf(surface.toLowerCase());
  if (at < 0) {
    const variable = variableFromValue(surface)?.variable ?? hint;
    return {
      surface,
      canonical: variable === "OTHER" ? foldKey(surface) : canonicalValueOf(variable, surface),
      variable,
      strength: "known",
      score: 0.8,
      start: 0,
      end: 0,
    };
  }
  const ranked = rankValues(text, at, at + surface.length + 1, hint);
  return ranked[0] ?? null;
}

/** The decision whose value is closest in the text, so the alternative attaches to
 *  the choice it was weighed against rather than to whichever decision came first. */
function nearestDecision(
  decisions: readonly RecoveredDecision[],
  episode: EpisodeWindow,
  at: number,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  decisions.forEach((decision, index) => {
    const decisionAt = episode.text.toLowerCase().indexOf(decision.candidate.value.toLowerCase());
    if (decisionAt < 0) return;
    const distance = Math.abs(decisionAt - at);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });

  return best;
}

function spanFor(episode: EpisodeWindow, value: ValueCandidate, context: DecisionContext): ReturnType<typeof spanFrom> {
  const located = locateInEpisode(episode, value.start);
  if (located === null) return null;

  const localAt = value.start - located.offset;
  const start = toNormalised(located, localAt);
  const end = toNormalised(located, localAt + value.surface.length);
  if (end <= start) return null;

  return spanFrom(context.transcriptId, context.raw, context.map, start, end);
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately harsher than the decision rubric.
 *
 * The published precision is 15.4%, so a score that mirrors the decision rubric
 * would put alternatives in the bulk-approvable tier and the user would approve
 * wrong ones in bulk. `confidence.ts` demotes the tier again on top of this.
 */
function score(
  value: ValueCandidate,
  via: RecoveredAlternative["via"],
  cue: { weight: number } | null,
  hasReason: boolean,
): ReturnType<typeof asConfidence> {
  let score = 0;

  score += via === "pivot" ? 0.4 : via === "cue" ? 0.3 : 0.2;
  score += (cue?.weight ?? 0.7) * 0.2;
  score += value.strength === "scoped-known" ? 0.2 : value.strength === "known" ? 0.15 : 0.05;
  if (hasReason) score += 0.15;

  return asConfidence(Math.max(0.05, Math.min(0.85, score)));
}

function dedupeKey(variable: DecisionVariable, value: string): string {
  return `${variable}\u0000${normalise(value)}`;
}

/* -------------------------------------------------------------------------- */
/* Orphans                                                                    */
/* -------------------------------------------------------------------------- */

/** Rejection phrases in an episode that produced no decision. Recorded as
 *  discards so the precision denominator counts them. */
function collectOrphans(episode: EpisodeWindow): readonly DiscardedCandidate[] {
  const lower = episode.text.toLowerCase();
  const out: DiscardedCandidate[] = [];

  for (const cue of REJECTION_CUES) {
    const at = lower.indexOf(cue.phrase);
    if (at < 0) continue;
    out.push({
      kind: "alternative",
      discardedBy: "duplicate",
      rawText: episode.text.slice(Math.max(0, at - 20), at + cue.phrase.length + 60).trim(),
      confidence: asConfidence(cue.weight * 0.3),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeRecovery(recovery: AlternativeRecovery): string {
  const parts = [
    `${recovery.alternatives.length} alternative${recovery.alternatives.length === 1 ? "" : "s"}`,
  ];
  if (recovery.alternatives.length > 0) {
    parts.push(
      `${recovery.withReason} with a reason${recovery.withReason === recovery.alternatives.length ? "" : ` ΓÇö ${recovery.alternatives.length - recovery.withReason} stored but excluded from pre-emption`}`,
    );
  }
  if (recovery.discarded.length > 0) parts.push(`${recovery.discarded.length} discarded`);
  return parts.join(", ");
}

export const ALTERNATIVE_MIN_CONFIDENCE = MIN_CONFIDENCE;
