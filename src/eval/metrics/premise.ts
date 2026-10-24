/**
 * Metric 2 — premise extraction precision / recall / F1.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: NONE PUBLISHED. That absence is the result.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS METRIC HAS NO COMPARATOR, AND WHY THAT IS THE POINT
 *
 * No system surveyed in docs/05 or docs/06 extracts premises from dialogue. RecovAr recovers
 * rationale, ARGUS recovers alternatives, Kantara builds decision graphs from commits, agentmemory
 * stores turns. None of them represents "this decision is true GIVEN these assumptions" as first-class
 * nodes, so none of them can be measured on recovering them.
 *
 * A metric with no comparator cannot be spun. There is no prior number to beat, no framing in which
 * 0.4 recall is a win, and no baseline to blame. It is the one metric in this file where the only
 * available interpretation of the number is the true one — which is precisely why §7.2 requires it and
 * why the report leads with it rather than burying it after the metrics that do have comparators.
 *
 * ---------------------------------------------------------------------------
 * PREDICATE-FIRST, TYPE-STRICT
 *
 * A premise node is matched on span overlap like every other node, but the alignment additionally
 * requires the premise TYPE to agree. The substrate forbids merging across types regardless of text
 * similarity — "single user" (scale) and "single sign-on user flow" (requirement) are never the same
 * node, because a false merge produces a spectacular wrong cascade. A metric that scored across types
 * would be measuring something the system is not allowed to do.
 *
 * Predicate disagreement is counted separately, for the same reason variable disagreement is in
 * `extraction.ts`: the right sentence found and the wrong predicate assigned is a distinct, fixable
 * failure and folding it into a miss makes it invisible.
 * ---------------------------------------------------------------------------
 */

import type { EngineId, PremiseId } from "@/types/common";
import type { Premise } from "@/types/domain";
import type { ResolvedCorpus, ResolvedPremise } from "../corpus/labels";
import type { RunResult } from "../harness";
import { type Alignment, MATCH_RULE, align } from "./match";
import {
  COMPARATORS,
  METRIC_NAMES,
  type MetricResult,
  describeEngineId,
  precisionRecall,
} from "./types";

export interface PremiseOutcome {
  readonly metric: MetricResult;
  readonly alignment: Alignment<ResolvedPremise, Premise>;
  readonly predicateErrors: readonly { label: ResolvedPremise; node: Premise }[];
  readonly typeErrors: readonly { label: ResolvedPremise; node: Premise }[];
}

export function scorePremiseExtraction(
  corpus: ResolvedCorpus,
  run: RunResult,
  engine: EngineId,
): PremiseOutcome {
  const labels: ResolvedPremise[] = [];
  for (const transcript of corpus.transcripts) {
    for (const premise of transcript.premises) {
      /* `expectInList` is the premise-level form of "should this become a node": true when the
       * transcript STATES it as a fact, false when it is only mentioned. A mentioned premise is not
       * an extraction failure, so counting it as one would penalise the system for not inventing
       * beliefs nobody held. */
      if (!premise.expectInList) continue;
      labels.push(premise);
    }
  }

  const nodes: Premise[] = [...run.state.premises.values()];

  /* Premise spans live on the EVIDENCE, not the node: a premise is shared (invariant I2) and may have
   * several observations behind it. The first evidence entry with a span is the one that created it,
   * which is the span the label refers to. A premise with no span at all — created by a guard result
   * or a human assertion rather than by extraction — cannot be matched and is reported as spurious,
   * which is correct: it was not extracted from this corpus. */
  const spanOf = (premise: Premise): { start: number; end: number } | null => {
    for (const evidence of premise.evidence) {
      if (evidence.span !== undefined)
        return { start: evidence.span.start, end: evidence.span.end };
    }
    return null;
  };

  const alignable = nodes.filter((node) => spanOf(node) !== null);
  const unspanned = nodes.length - alignable.length;

  const alignment = align(
    labels,
    alignable,
    (label) => label.span,
    (node) => spanOf(node) ?? { start: 0, end: 0 },
    (label, node) => label.type === node.type,
  );

  const predicateErrors = alignment.pairs
    .filter((pair) => pair.label.predicate !== pair.node.predicate)
    .map((pair) => ({ label: pair.label, node: pair.node }));

  const typeErrors = findTypeErrors(labels, nodes);

  const detail = precisionRecall(
    alignment.truePositives,
    alignment.falsePositives + unspanned,
    alignment.falseNegatives,
  );

  return {
    alignment,
    predicateErrors,
    typeErrors,
    metric: {
      id: "premise-extraction",
      name: METRIC_NAMES["premise-extraction"],
      value: detail.f1,
      detail,
      n: labels.length,
      perEngine: [{ engine: describeEngineId(engine), value: detail.f1, n: labels.length, detail }],
      comparator:
        null /* deliberately null: see COMPARATORS, whose entry states that none exists */,
      gloss: `${detail.truePositives} of ${labels.length} labelled premises became shared nodes; ${predicateErrors.length} matched on span but were given the wrong predicate; ${unspanned} node(s) carried no extraction span at all.`,
      honestNote: `NO PUBLISHED COMPARATOR EXISTS for this metric — see ${COMPARATORS["premise-extraction"]?.source ?? "none"}. The absence is reported rather than filled with a borrowed number from a different task. Matched by ${MATCH_RULE}, additionally requiring premise TYPE to agree, because the substrate forbids merging across types and a metric that scored across them would measure something the system may not do. n=${labels.length} premises, hand-labelled by the system's author. Premise extraction is the weakest link in the architecture (risk R1) and this is the metric that would show it.`,
    },
  };
}

/** Spans that overlap but whose types disagree. Excluded from `align` by the eligibility predicate, so
 *  they surface here instead — otherwise a type error would look identical to a total miss. */
function findTypeErrors(
  labels: readonly ResolvedPremise[],
  nodes: readonly Premise[],
): { label: ResolvedPremise; node: Premise }[] {
  const out: { label: ResolvedPremise; node: Premise }[] = [];

  for (const label of labels) {
    for (const node of nodes) {
      if (node.type === label.type) continue;

      let span: { start: number; end: number } | null = null;
      for (const evidence of node.evidence) {
        if (evidence.span !== undefined) {
          span = { start: evidence.span.start, end: evidence.span.end };
          break;
        }
      }
      if (span === null) continue;

      const start = Math.max(label.span.start, span.start);
      const end = Math.min(label.span.end, span.end);
      if (end > start) out.push({ label, node });
    }
  }

  return out;
}

export type { PremiseId };
