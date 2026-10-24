/**
 * Metric 3 — alternative extraction precision.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: ARGUS, 15.4% precision, alpha 0.64, FP:FN 13:1 (arXiv:2604.10345, docs/05 §4.3).
 *
 * ---------------------------------------------------------------------------
 * PRECISION IS THE HEADLINE BECAUSE ARGUS SAYSO
 *
 * ARGUS found alternatives to be the worst-measured rationale component in the literature: 15.4%
 * precision with a false-positive-to-false-negative ratio of 13:1. The system produces fifteen wrong
 * alternatives for every one it misses. That ratio matters more than the absolute number, because it
 * says the failure is not caution but noise — and noise is what makes a user stop reading the panel.
 *
 * So this metric reports precision first and the FP:FN ratio beside it, rather than leading with F1.
 * F1 would blend a catastrophic precision with a good recall into a number that looks acceptable, and
 * the whole reason ARGUS's result is memorable is that the blend hides the problem.
 *
 * ---------------------------------------------------------------------------
 * AN ALTERNATIVE WITHOUT `whyRejected` IS NOT A FALSE POSITIVE
 *
 * The corpus distinguishes alternatives that were rejected for a stated reason from ones merely
 * mentioned. The system stores both but only pre-empts on the former, and only the latter kind is a
 * plausible false positive: mentioning Redis is not an error, claiming Redis was rejected when nobody
 * rejected it is. Precision is therefore computed over ALL extracted alternatives, and a second number
 * — pre-emption eligibility precision — is computed over the ones the system would actually act on.
 * Reporting only the first would understate the risk; reporting only the second would overstate the
 * system's restraint.
 * ---------------------------------------------------------------------------
 */

import type { AlternativeId, EngineId, TranscriptId } from "@/types/common";
import type { RejectedAlternative } from "@/types/domain";
import type { ResolvedAlternative, ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { align, MATCH_RULE, type Alignment } from "./match";
import { COMPARATORS, METRIC_NAMES, describeEngineId, precisionRecall, type MetricResult } from "./types";

export interface AlternativeOutcome {
  readonly metric: MetricResult;
  readonly alignment: Alignment<ResolvedAlternative, RejectedAlternative>;
  readonly fpToFnRatio: string;
  /** Precision over the alternatives the system would actually pre-empt on. */
  readonly preemptionPrecision: number;
  readonly preemptionEligible: number;
}

export function scoreAlternativeExtraction(corpus: ResolvedCorpus, run: RunResult, engine: EngineId): AlternativeOutcome {
  const labels: ResolvedAlternative[] = [];
  for (const transcript of corpus.transcripts) {
    for (const alternative of transcript.alternatives) {
      /* `expectConfirmed` is the alternative-level form of "should this become a node": true when the
       * transcript actually REJECTS the alternative, false when it merely mentions it. Alternatives
       * need explicit confirmation before they may pre-empt anything, so a mention is not a miss. */
      if (!alternative.expectConfirmed) continue;
      labels.push(alternative);
    }
  }

  const nodes: RejectedAlternative[] = [...run.state.alternatives.values()];

  /* An alternative carries no transcript of its own — it belongs to the decision it was rejected in
   * favour of — so eligibility goes through that decision's provenance. This is the same transcript
   * test the decision metric applies, and without it a label from c01 could match a node extracted
   * from m02 merely because their character spans overlap in two differently-numbered documents.
   * That match would be scored as a true positive that never happened. */
  const ownerOf = new Map<AlternativeId, TranscriptId>();
  for (const alternative of nodes) {
    const decision = run.state.decisions.get(alternative.decisionId);
    if (decision !== undefined) ownerOf.set(alternative.id, decision.provenance.transcriptId);
  }

  const alignment = align(
    labels,
    nodes,
    (label) => label.span,
    (node) => ({ start: node.snippet.start, end: node.snippet.end }),
    (label, node) => {
      const owner = ownerOf.get(node.id);
      if (owner === undefined) return false;
      const entry = run.transcripts.find((candidate) => candidate.runtimeId === owner);
      /* `label.transcript` is carried on the label precisely so this needs no search. */
      return entry !== undefined && entry.transcript.id === label.transcript;
    },
  );

  const detail = precisionRecall(alignment.truePositives, alignment.falsePositives, alignment.falseNegatives);

  /* ARGUS's ratio, restated. Reported as a string because 13:1 is how the literature writes it and a
   * decimal would invite a comparison with a different quantity. */
  const fpToFnRatio =
    detail.falseNegatives === 0
      ? detail.falsePositives + ":0 (no misses to compare against)"
      : detail.falsePositives + ":" + detail.falseNegatives +
        " (" + (detail.falsePositives / detail.falseNegatives).toFixed(1) + " FP per FN)";

  /* Pre-emption eligibility: an alternative only enters the pre-emption index with an explicit
   * whyRejected AND human confirmation. Counting precision over just those answers the question a user
   * actually has — "when the system warns me I am re-proposing something rejected, is it right?" */
  const eligible = nodes.filter((node) => node.whyRejected !== undefined);
  const eligibleLabels = labels.filter((label) => label.whyRejected !== undefined);
  const eligibleHits = alignment.pairs.filter((pair) => pair.node.whyRejected !== undefined).length;
  const preemptionPrecision = eligible.length === 0 ? 0 : eligibleHits / eligible.length;

  return {
    alignment,
    fpToFnRatio,
    preemptionPrecision,
    preemptionEligible: eligible.length,
    metric: {
      id: "alternative-precision",
      name: METRIC_NAMES["alternative-precision"],
      value: detail.precision,
      detail,
      n: labels.length,
      perEngine: [{ engine: describeEngineId(engine), value: detail.precision, n: labels.length, detail }],
      comparator: COMPARATORS["alternative-precision"] ?? null,
      gloss:
        detail.precision.toFixed(3) + " precision against ARGUS's 0.154; FP:FN " + fpToFnRatio +
        " against ARGUS's 13:1. " + eligible.length + " alternative(s) carry a stated rejection reason and " +
        (preemptionPrecision * 100).toFixed(0) + "% of those are correct — the subset the system would act on.",
      honestNote:
        "Precision is the headline because ARGUS's finding is a PRECISION finding; F1 would blend a bad precision with a " +
        "good recall into a number that looks acceptable. Matched by " + MATCH_RULE + ", requiring the variable to agree. " +
        "n=" + labels.length + " labelled alternatives, of which " + eligibleLabels.length + " state a rejection reason. " +
        "The corpus is small enough that a single spurious alternative moves precision by several points, so the count is " +
        "reported beside the ratio and neither should be quoted without it.",
    },
  };
}

export type { AlternativeId };
