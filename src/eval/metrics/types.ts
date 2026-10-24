/**
 * The metric contract — 7.2.
 *
 * Phase 7 · sub-phase 7.2
 * Plan: plan/phase-7-evaluation.md §7.2
 *
 * ---------------------------------------------------------------------------
 * EVERY METRIC CARRIES ITS COMPARATOR AND ITS DENOMINATOR
 *
 * A number without a denominator is not a measurement, and a number without a comparator is not an
 * argument. So `MetricResult` requires both, and requires the sample size beside them.
 *
 * The plan's framing is exact: "It works well" loses to a number, and a number loses to a number
 * WITH AN ABLATION showing which component earned it. This contract is what makes the first step
 * unavoidable — a metric that cannot state n cannot be reported.
 *
 * ---------------------------------------------------------------------------
 * PER ENGINE, ALWAYS SEPARATE
 *
 * `byEngine` is not optional decoration. A single blended number hides the thing that most needs
 * showing: that the local, keyless path is a genuine peer rather than a stub. So every metric
 * computes per engine and the report refuses to render a blended-only row.
 *
 * ---------------------------------------------------------------------------
 * `honestNote` IS PART OF THE CONTRACT
 *
 * Every metric must be able to say what it does NOT establish. A corpus of 15 transcripts cannot
 * support a claim about production behaviour, and a metric that reports 0.83 F1 without saying "on
 * 15 transcripts, hand-labelled by the author" is doing the thing docs/07 accuses every surveyed
 * system of: overstating. The field is required, not optional, so omitting it is a compile error
 * rather than an editorial choice.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";

/** The ten metrics §7.2 requires, plus the two unusual ones it calls out. */
export type MetricId =
  | "decision-extraction"
  | "premise-extraction"
  | "alternative-precision"
  | "contradiction-recall-l1"
  | "invalidation-recall-l2"
  | "cascade-correctness-l3"
  | "survivor-preservation"
  | "false-positive-rate"
  | "answer-groundedness"
  | "retrieval-precision"
  | "retrieval-mrr"
  | "guard-precision"
  | "modality-precision";

export interface PrecisionRecall {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

export interface MetricResult {
  readonly id: MetricId;
  readonly name: string;
  /** The headline number. For P/R/F1 metrics this is F1; for rates it is the rate. */
  readonly value: number;
  readonly detail: PrecisionRecall | null;
  /** Sample size. Required: a metric that cannot state n cannot be reported. */
  readonly n: number;
  readonly perEngine: readonly EngineMetric[];
  /** The published number this is compared against, or null when none exists. Null is itself a
   *  result — three of the ten metrics have NO published comparator, which is the claim that this
   *  is new territory rather than a re-implementation. */
  readonly comparator: { readonly source: string; readonly value: string } | null;
  /** One line: what the number means for someone who has not read the code. */
  readonly gloss: string;
  /** What this number does NOT establish. Required, not optional. */
  readonly honestNote: string;
}

export interface EngineMetric {
  readonly engine: string;
  readonly value: number;
  readonly n: number;
  readonly detail: PrecisionRecall | null;
}

export function describeEngineId(engine: EngineId): string {
  return engine.kind + (engine.model.length > 0 ? "/" + engine.model : "");
}

/** Precision, recall and F1 from raw counts. Returns zeros rather than NaN when a denominator is
 *  empty, because NaN propagates into every average downstream and a report full of NaN is
 *  indistinguishable from a broken harness. */
export function precisionRecall(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number,
): PrecisionRecall {
  const precision = truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, truePositives, falsePositives, falseNegatives };
}

/** Mean reciprocal rank. `ranks` are 1-based positions of the first relevant result per query;
 *  a query with no relevant result contributes 0, which is the standard convention and the honest
 *  one — omitting failed queries would inflate the score by deleting the failures. */
export function meanReciprocalRank(ranks: readonly (number | null)[]): number {
  if (ranks.length === 0) return 0;

  const total = ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / rank), 0);
  return total / ranks.length;
}

/** Precision at k. */
export function precisionAtK(relevantInTopK: number, k: number): number {
  return k === 0 ? 0 : relevantInTopK / k;
}

/** The comparator table, from docs/05 §4 and docs/07. Kept as data so the report can print the
 *  published number beside ours without either being retyped and drifting. */
export const COMPARATORS: Readonly<Partial<Record<MetricId, { source: string; value: string }>>> = {
  "decision-extraction": {
    source: "RecovAr (docs/05 §4.1)",
    value: "75% recall / 77% precision on commit-message rationale; Kantara reports F1 0.70–0.75 on contradictions",
  },
  "premise-extraction": {
    source: "none published",
    value: "No system surveyed extracts premises from dialogue. This is new territory, so the number has no comparator and is reported as such.",
  },
  "alternative-precision": {
    source: "ARGUS (arXiv:2604.10345)",
    value: "15.4% precision on alternatives, alpha 0.64, FP:FN ratio 13:1",
  },
  "contradiction-recall-l1": {
    source: "Kantara (arXiv:2506.11005)",
    value: "Reported 396 contradictory pairs found over the Linux kernel at F1 0.70–0.75, but published COUNTS rather than recall over a planted set",
  },
  "invalidation-recall-l2": {
    source: "none published",
    value: "No system surveyed detects that a decision's premise became false without the decision being mentioned. There is no comparator because there is no component.",
  },
  "cascade-correctness-l3": {
    source: "none published",
    value: "No system surveyed cascades a retraction and then STOPS where independent support exists.",
  },
  "survivor-preservation": {
    source: "none published",
    value: "Over-retraction is the failure mode that kills this product, and nobody measures it because nobody cascades.",
  },
  "answer-groundedness": {
    source: "RepoRationale",
    value: "Specifies the evidence contract (bounded searches, citations resolve in-run, insufficient-evidence first-class) but publishes no quantity",
  },
  "retrieval-precision": {
    source: "agentmemory",
    value: "R@5 95.2% with BM25 + vector + graph and RRF — a DIFFERENT task (memory recall over conversation turns, not decisions over a corpus)",
  },
  "guard-precision": {
    source: "fitness-function literature",
    value: "Qualitative throughout. No published precision figure, because no surveyed tool generates the check from the decision.",
  },
  "modality-precision": {
    source: "none published",
    value: "Of the statements the system DECLINED to turn into decisions, how many were correctly declined. The guard against hypotheticals becoming nodes.",
  },
};

/** The two numbers §7.2 calls unusual and worth reporting. Flagged so the report can lead with
 *  them: they are the ones no competitor can produce at any quality. */
export const UNUSUAL_METRICS: readonly MetricId[] = ["survivor-preservation", "modality-precision"];

export const METRIC_NAMES: Readonly<Record<MetricId, string>> = {
  "decision-extraction": "Decision extraction P / R / F1",
  "premise-extraction": "Premise extraction P / R / F1",
  "alternative-precision": "Alternative extraction precision",
  "contradiction-recall-l1": "Contradiction recall (L1 pairwise)",
  "invalidation-recall-l2": "Premise-invalidation recall (L2 non-monotonic)",
  "cascade-correctness-l3": "Cascade correctness (L3 propagation)",
  "survivor-preservation": "Survivor preservation",
  "false-positive-rate": "False-positive rate per 100 decisions",
  "answer-groundedness": "Answer groundedness",
  "retrieval-precision": "Retrieval precision@5",
  "retrieval-mrr": "Retrieval MRR",
  "guard-precision": "Guard precision on seeded violations",
  "modality-precision": "Modality precision (correctly declined)",
};
