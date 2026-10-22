/**
 * Three-run majority voting — 1.8, the LLM path only.
 *
 * Phase 1 · sub-phase 1.8
 * Plan: plan/phase-1-extraction-pipeline.md §1.8
 *
 * ---------------------------------------------------------------------------
 * WHY VOTE AT ALL
 *
 * ARGUS used exactly this because single-run consistency was imperfect: α 0.64–0.88
 * across components (docs/05 §4). A model asked the same question three times at
 * low temperature does not answer identically, and the components it drops are not
 * random — they are the ones it was least sure about. So agreement is a usable
 * confidence signal, and disagreement is a usable doubt signal.
 *
 * It costs 3× tokens and buys a measurable precision gain. That trade is worth
 * making explicit and TOGGLEABLE, so a demo can run at 1× when latency matters and
 * Phase 7 can measure what the 3× actually bought.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOCAL ENGINE DOES NOT VOTE
 *
 * It is deterministic. Three runs return three byte-identical results, so voting
 * would cost 3× the time and change nothing. `LOCAL_CAPABILITIES.voting` is false
 * and `vote()` short-circuits on a single run, so a caller cannot get this wrong by
 * accident.
 *
 * ---------------------------------------------------------------------------
 * ALIGNMENT IS THE HARD PART
 *
 * Three runs produce three differently-ordered, differently-worded lists. Voting
 * requires knowing which item in run 2 is "the same" as which item in run 1, and
 * the only stable handle is the ONTOLOGY: variable + canonical value for decisions,
 * type + canonical predicate for premises. Aligning on statement text would count
 * the same decision three times whenever the model rephrased it, which is the
 * opposite of what voting is for.
 * ---------------------------------------------------------------------------
 */

import type { Confidence } from "@/types/common";
import { asConfidence } from "@/types/common";
import type {
  AlternativeCandidate,
  DecisionCandidate,
  ExtractionResult,
  PremiseCandidate,
} from "@/ai/types";
import { canonicalPredicate, canonicalValueOf, foldKey } from "@/ontology/canonicalize";
import { normalise } from "@/lib/text";
import { tierOf, type ConfidenceTier } from "./types";

/** How many runs must agree for full confidence. Two of three, per the plan. */
export const MAJORITY_OF_THREE = 2;

export interface VotingOptions {
  /** 1 disables voting: the first run is returned unchanged. */
  readonly runs: 1 | 2 | 3;
  /** Below this temperature the runs stop disagreeing and the vote stops meaning
   *  anything. Reported, not enforced — the caller owns the request. */
  readonly temperature: number;
}

export const DEFAULT_VOTING: VotingOptions = { runs: 3, temperature: 0.2 };

export interface RunAgreement {
  readonly presentIn: number;
  readonly totalRuns: number;
  readonly majority: boolean;
  /** Multiplier applied to the item's own confidence. 1 for a majority, less for
   *  a singleton — and the reduction is enough to move it down a tier, which is
   *  what "collapsed" means in the review UI. */
  readonly factor: number;
}

export interface VoteOutcome {
  readonly result: ExtractionResult;
  readonly runsUsed: number;
  readonly decisionAgreement: readonly RunAgreement[];
  readonly premiseAgreement: readonly RunAgreement[];
  readonly alternativeAgreement: readonly RunAgreement[];
  /** Items that appeared in only one run. Kept, downgraded, collapsed. */
  readonly singletons: number;
  /** Items in no majority. Reported because it is the number that says whether
   *  voting was worth the tokens. */
  readonly agreementRate: number;
}

/** Confidence a singleton is multiplied by. 0.55 lands a 0.7 item at 0.385, which
 *  is below `TIER_MEDIUM_AT` — so a singleton always collapses. */
export const SINGLETON_FACTOR = 0.55;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Vote across runs.
 *
 * @param runs results in run order. `runs[0]` supplies the wording of every
 *             surviving item, so the output reads consistently rather than being
 *             stitched from three phrasings.
 */
export function voteAcrossRuns(runs: readonly ExtractionResult[]): VoteOutcome {
  const first = runs[0];
  if (first === undefined) {
    throw new Error("voteAcrossRuns needs at least one run");
  }
  if (runs.length <= 1) {
    return {
      result: first,
      runsUsed: runs.length,
      decisionAgreement: first.decisions.map(() => unanimous(1)),
      premiseAgreement: first.premises.map(() => unanimous(1)),
      alternativeAgreement: first.alternatives.map(() => unanimous(1)),
      singletons: 0,
      agreementRate: 1,
    };
  }

  const total = runs.length;
  const decisionKeys = runs.map((run) => new Set(run.decisions.map(decisionKey)));
  const premiseKeys = runs.map((run) => new Set(run.premises.map(premiseKey)));
  const alternativeKeys = runs.map((run) => new Set(run.alternatives.map(alternativeKey)));

  let singletons = 0;
  let agreed = 0;
  let counted = 0;

  const decisionAgreement: RunAgreement[] = [];
  const decisions = first.decisions.map((candidate) => {
    const agreement = agreementFor(decisionKey(candidate), decisionKeys, total);
    decisionAgreement.push(agreement);
    counted += 1;
    agreed += agreement.majority ? 1 : 0;
    if (!agreement.majority) singletons += 1;
    return applyFactor(candidate, agreement.factor, (c, confidence) => ({ ...c, confidence }));
  });

  const premiseAgreement: RunAgreement[] = [];
  const premises = first.premises.map((candidate) => {
    const agreement = agreementFor(premiseKey(candidate), premiseKeys, total);
    premiseAgreement.push(agreement);
    counted += 1;
    agreed += agreement.majority ? 1 : 0;
    if (!agreement.majority) singletons += 1;

    return applyFactor(candidate, agreement.factor, (c, confidence) => ({
      ...c,
      confidence,
      // A premise only one run found is exactly the case the review exists for.
      needsReview: true,
    }));
  });

  const alternativeAgreement: RunAgreement[] = [];
  const alternatives = first.alternatives.map((candidate) => {
    const agreement = agreementFor(alternativeKey(candidate), alternativeKeys, total);
    alternativeAgreement.push(agreement);
    counted += 1;
    agreed += agreement.majority ? 1 : 0;
    if (!agreement.majority) singletons += 1;
    return applyFactor(candidate, agreement.factor, (c, confidence) => ({ ...c, confidence }));
  });

  // Items found ONLY by later runs are added at singleton confidence. Dropping them
  // would make voting strictly worse than one run: three chances to find something,
  // but only the first run's findings count.
  for (let i = 1; i < runs.length; i += 1) {
    const run = runs[i];
    if (run === undefined) continue;

    for (const candidate of run.decisions) {
      if (decisionKeys[0]?.has(decisionKey(candidate))) continue;
      const agreement = agreementFor(decisionKey(candidate), decisionKeys, total);
      if (agreement.presentIn < MAJORITY_OF_THREE) continue;
      decisions.push(applyFactor(candidate, agreement.factor, (c, confidence) => ({ ...c, confidence })));
      decisionAgreement.push(agreement);
    }

    for (const candidate of run.premises) {
      if (premiseKeys[0]?.has(premiseKey(candidate))) continue;
      const agreement = agreementFor(premiseKey(candidate), premiseKeys, total);
      if (agreement.presentIn < MAJORITY_OF_THREE) continue;
      premises.push(
        applyFactor(candidate, agreement.factor, (c, confidence) => ({ ...c, confidence, needsReview: true })),
      );
      premiseAgreement.push(agreement);
    }

    for (const candidate of run.alternatives) {
      if (alternativeKeys[0]?.has(alternativeKey(candidate))) continue;
      const agreement = agreementFor(alternativeKey(candidate), alternativeKeys, total);
      if (agreement.presentIn < MAJORITY_OF_THREE) continue;
      alternatives.push(applyFactor(candidate, agreement.factor, (c, confidence) => ({ ...c, confidence })));
      alternativeAgreement.push(agreement);
    }
  }

  const usage = sumUsage(runs);

  return {
    result: {
      ...first,
      decisions,
      premises,
      alternatives,
      // Discards are unioned: a candidate one run rejected and another kept is
      // worth showing, and the denominator of the precision metric should count
      // every candidate any run produced.
      discarded: dedupeDiscards(runs),
      durationMs: runs.reduce((sum, run) => sum + run.durationMs, 0),
      ...(usage === undefined ? {} : { usage }),
    },
    runsUsed: total,
    decisionAgreement,
    premiseAgreement,
    alternativeAgreement,
    singletons,
    agreementRate: counted === 0 ? 0 : Math.round((agreed / counted) * 100) / 100,
  };
}

/* -------------------------------------------------------------------------- */
/* Alignment keys                                                             */
/* -------------------------------------------------------------------------- */

/** variable + canonical value. Stable across rephrasings, which is the point. */
export function decisionKey(candidate: DecisionCandidate): string {
  const canonical =
    candidate.variable === "OTHER" ? foldKey(candidate.value) : canonicalValueOf(candidate.variable, candidate.value);
  return `D\u0000${candidate.variable}\u0000${normalise(canonical)}`;
}

/** type + canonical predicate. Values are deliberately NOT in the key: a premise
 *  whose value the model read differently across runs is still the same premise,
 *  and splitting it would hide the disagreement instead of surfacing it. */
export function premiseKey(candidate: PremiseCandidate): string {
  return `P\u0000${candidate.type}\u0000${normalise(canonicalPredicate(candidate.type, candidate.predicate))}`;
}

export function alternativeKey(candidate: AlternativeCandidate): string {
  const canonical =
    candidate.variable === "OTHER" ? foldKey(candidate.value) : canonicalValueOf(candidate.variable, candidate.value);
  return `A\u0000${candidate.decisionRef}\u0000${candidate.variable}\u0000${normalise(canonical)}`;
}

/* -------------------------------------------------------------------------- */
/* Agreement                                                                  */
/* -------------------------------------------------------------------------- */

function agreementFor(key: string, keySets: readonly (ReadonlySet<string> | undefined)[], total: number): RunAgreement {
  let presentIn = 0;
  for (const set of keySets) {
    if (set?.has(key)) presentIn += 1;
  }

  const majority = presentIn >= MAJORITY_OF_THREE;
  return {
    presentIn,
    totalRuns: total,
    majority,
    factor: majority ? 1 : SINGLETON_FACTOR,
  };
}

function unanimous(totalRuns: number): RunAgreement {
  return { presentIn: totalRuns, totalRuns, majority: true, factor: 1 };
}

function applyFactor<T extends { confidence: Confidence }>(
  candidate: T,
  factor: number,
  withConfidence: (candidate: T, confidence: Confidence) => T,
): T {
  if (factor === 1) return candidate;
  return withConfidence(candidate, asConfidence(Math.max(0.05, candidate.confidence * factor)));
}

function dedupeDiscards(runs: readonly ExtractionResult[]): ExtractionResult["discarded"] {
  const seen = new Set<string>();
  const out: ExtractionResult["discarded"][number][] = [];

  for (const run of runs) {
    for (const discard of run.discarded) {
      const key = `${discard.kind}\u0000${discard.discardedBy}\u0000${normalise(discard.rawText).slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(discard);
    }
  }
  return out;
}

function sumUsage(runs: readonly ExtractionResult[]): ExtractionResult["usage"] {
  let promptTokens = 0;
  let completionTokens = 0;
  let any = false;

  for (const run of runs) {
    if (run.usage === undefined) continue;
    any = true;
    promptTokens += run.usage.promptTokens;
    completionTokens += run.usage.completionTokens;
  }

  return any ? { promptTokens, completionTokens } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeVoting(outcome: VoteOutcome): string {
  if (outcome.runsUsed <= 1) {
    return "voting off — one run. Turn it on in Settings to trade 3× tokens for run-agreement confidence.";
  }

  const percent = Math.round(outcome.agreementRate * 100);
  const parts = [
    `${outcome.runsUsed} runs`,
    `${percent}% of items reached a ${MAJORITY_OF_THREE}-of-${outcome.runsUsed} majority`,
  ];
  if (outcome.singletons > 0) {
    parts.push(
      `${outcome.singletons} appeared in only one run — kept at ${SINGLETON_FACTOR} × confidence, which collapses them`,
    );
  }
  return parts.join(" · ");
}

/** What a run-agreement record means, for the review UI's per-item explanation. */
export function describeAgreement(agreement: RunAgreement): string {
  if (agreement.majority) {
    return `found in ${agreement.presentIn} of ${agreement.totalRuns} runs — full confidence`;
  }
  return `found in ${agreement.presentIn} of ${agreement.totalRuns} runs — confidence × ${SINGLETON_FACTOR}, collapsed by default`;
}

/** The tier a voted item lands in, so callers can check that a singleton really
 *  does collapse rather than trusting the factor. */
export function tierAfterVoting(confidence: Confidence): ConfidenceTier {
  return tierOf(confidence);
}
