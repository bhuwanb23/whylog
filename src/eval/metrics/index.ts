/**
 * The metric suite — 7.2. Scores one run against the corpus.
 *
 * Phase 7 · sub-phase 7.2
 *
 * ---------------------------------------------------------------------------
 * ORDER OF SCORING IS NOT ARBITRARY
 *
 * The three extraction metrics run FIRST, because their alignments are what build the resolver that
 * maps corpus keys to runtime ids. Every reasoning metric depends on that resolver: a cascade cannot be
 * checked against `l03/d1` without knowing which node `l03/d1` became.
 *
 * This creates a real dependency and it is worth stating plainly, because it means extraction failure
 * propagates into the reasoning scores. If premise extraction misses the premise a cascade should have
 * travelled through, cascade correctness falls — and the fall is a premise-extraction failure wearing a
 * cascade metric's name. Every reasoning metric's honest note points at the extraction metric to check
 * first. A benchmark whose rows are independent would be easier to read and would be lying.
 *
 * ---------------------------------------------------------------------------
 * THIRTEEN METRICS, ONE SHAPE
 *
 * Ten from §7.2's list, plus survivor preservation and modality precision which §7.2 calls out as the
 * two unusual ones, plus retrieval MRR which precision@5 alone cannot substitute for. Every one returns
 * a `MetricResult` carrying n, a comparator (null where none is published, which is itself the finding)
 * and an honest note stating what the number does not establish.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { type AlternativeOutcome, scoreAlternativeExtraction } from "./alternative";
import { type CascadeOutcome, scoreCascade } from "./cascade";
import { type ContradictionOutcome, scoreContradictionRecall } from "./contradiction";
import { type ExtractionOutcome, scoreDecisionExtraction } from "./extraction";
import { type FalsePositiveOutcome, scoreFalsePositives } from "./false-positive";
import { type GroundednessOutcome, scoreGroundedness } from "./groundedness";
import { type GuardOutcome, scoreGuards } from "./guards";
import { type InvalidationOutcome, scoreInvalidationRecall } from "./invalidation";
import { type ModalityOutcome, scoreModalityPrecision } from "./modality";
import { type PremiseOutcome, scorePremiseExtraction } from "./premise";
import { type Resolver, buildResolver } from "./resolve";
import { type RetrievalOutcome, scoreRetrieval } from "./retrieval";
import { METRIC_NAMES, type MetricId, type MetricResult, UNUSUAL_METRICS } from "./types";

export interface ScoredRun {
  readonly run: RunResult;
  readonly resolver: Resolver;
  /** All thirteen, in the order they are reported. */
  readonly metrics: readonly MetricResult[];
  /* The full outcomes, not just the metrics: the report needs the per-plant and per-question detail to
   * show its working, and a summary number with no breakdown behind it is not defensible. */
  readonly extraction: ExtractionOutcome;
  readonly premise: PremiseOutcome;
  readonly alternative: AlternativeOutcome;
  readonly modality: ModalityOutcome;
  readonly contradiction: ContradictionOutcome;
  readonly invalidation: InvalidationOutcome;
  readonly cascade: CascadeOutcome;
  readonly falsePositives: FalsePositiveOutcome;
  readonly groundedness: GroundednessOutcome;
  readonly retrieval: RetrievalOutcome;
  readonly guards: GuardOutcome;
}

/**
 * Score one completed run against the corpus.
 *
 * Pure: it reads the run and the corpus and writes nothing. Running it twice on the same input gives
 * the same output, which is what makes an ablation delta attributable to the toggle rather than to the
 * scorer.
 */
export function scoreAll(corpus: ResolvedCorpus, run: RunResult, engine: EngineId): ScoredRun {
  /* ---- extraction first: these alignments build the resolver ---- */
  const extraction = scoreDecisionExtraction(corpus, run, engine);
  const premise = scorePremiseExtraction(corpus, run, engine);
  const alternative = scoreAlternativeExtraction(corpus, run, engine);
  const modality = scoreModalityPrecision(corpus, run, engine);

  const resolver = buildResolver(
    corpus,
    run,
    extraction.alignment,
    premise.alignment,
    alternative.alignment,
  );

  /* ---- reasoning: all depend on the resolver ---- */
  const contradiction = scoreContradictionRecall(corpus, run, resolver, engine);
  const invalidation = scoreInvalidationRecall(corpus, run, resolver, engine);
  const cascade = scoreCascade(corpus, run, resolver, engine);
  const falsePositives = scoreFalsePositives(corpus, run, resolver, engine);

  /* ---- retrieval and answering ---- */
  const groundedness = scoreGroundedness(corpus, run, engine);
  const retrieval = scoreRetrieval(corpus, run, resolver, engine);

  /* ---- guards ---- */
  const guards = scoreGuards(corpus, run, engine);

  return {
    run,
    resolver,
    extraction,
    premise,
    alternative,
    modality,
    contradiction,
    invalidation,
    cascade,
    falsePositives,
    groundedness,
    retrieval,
    guards,
    metrics: [
      extraction.metric,
      premise.metric,
      alternative.metric,
      contradiction.metric,
      invalidation.metric,
      cascade.correctness,
      cascade.survivorship,
      falsePositives.metric,
      groundedness.metric,
      retrieval.precision,
      retrieval.mrr,
      guards.metric,
      modality.metric,
    ],
  };
}

/** The two metrics §7.2 flags as unusual, pulled to the front of a report section. They are the ones
 *  no competitor can produce at any quality, because no competitor has the components they measure. */
export function unusualMetrics(scored: ScoredRun): readonly MetricResult[] {
  return scored.metrics.filter((metric) =>
    (UNUSUAL_METRICS as readonly string[]).includes(metric.id),
  );
}

/** Metrics with no published comparator. Not a gap in the work — the claim that this is new territory,
 *  stated as a list of metric ids rather than as an adjective. */
export function metricsWithoutComparator(scored: ScoredRun): readonly MetricResult[] {
  return scored.metrics.filter((metric) => metric.comparator === null);
}

export function metricById(scored: ScoredRun, id: MetricId): MetricResult | null {
  return scored.metrics.find((metric) => metric.id === id) ?? null;
}

/** The suite as a compact table. Every row carries n beside the value, because a number without a
 *  denominator is not a measurement and this is the shortest form in which the suite gets quoted. */
export function renderSuite(scored: ScoredRun): string {
  const lines: string[] = [];

  lines.push(`${"Metric".padEnd(46) + "Value".padStart(9) + "n".padStart(7)}  Comparator`);
  lines.push("-".repeat(100));

  for (const metric of scored.metrics) {
    const comparator = metric.comparator === null ? "NONE PUBLISHED" : metric.comparator.source;
    const value =
      metric.id === "false-positive-rate"
        ? `${metric.value.toFixed(1)}/100`
        : metric.value.toFixed(3);

    lines.push(
      `${metric.name.padEnd(46) + value.padStart(9) + String(metric.n).padStart(7)}  ${comparator}`,
    );
  }

  lines.push("");
  lines.push("Lower is better for: false-positive rate. Higher is better for everything else.");
  lines.push(
    `${metricsWithoutComparator(scored).length} of ${scored.metrics.length} metrics have NO published comparator — that is the new-territory claim, stated as a count.`,
  );

  return lines.join("\n");
}

export { METRIC_NAMES };
export type { MetricId, MetricResult, Resolver };
export { buildResolver } from "./resolve";
export { MATCH_RULE, align, overlapOf, type Alignment, type AlignedPair, type Span } from "./match";
export {
  COMPARATORS,
  UNUSUAL_METRICS,
  meanReciprocalRank,
  precisionAtK,
  precisionRecall,
  describeEngineId,
  type EngineMetric,
  type PrecisionRecall,
} from "./types";
