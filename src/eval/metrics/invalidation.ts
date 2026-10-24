/**
 * Metric 5 — premise-invalidation recall at L2 (non-monotonic).
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: NONE PUBLISHED. No surveyed system has this component.
 *
 * ---------------------------------------------------------------------------
 * THE HEADLINE RESULT, AND THE REASON THE PRODUCT EXISTS
 *
 * L1 fires when YOU contradict yourself. L2 fires when REALITY does: the decision is never mentioned,
 * its variable is never mentioned, no new statement conflicts with it — and it is nonetheless no
 * longer true, because an assumption it rested on stopped holding.
 *
 * The planted case is the product's whole argument in one transcript. `demo2` says there are now four
 * people on the project and two of them edit decisions concurrently. It never says the word database.
 * The SQLite decision from `demo1` excluded concurrent writers, so it becomes unsound — and the only
 * reason any system could notice is that it stored the exclusion.
 *
 * Storing the decision is what every competitor does. Storing the `given` is what none of them does,
 * and this metric measures whether storing it actually buys the detection.
 *
 * ---------------------------------------------------------------------------
 * NO INTERVENTION: MEASURED THE HARD WAY ON PURPOSE
 *
 * Unlike the L3 plant, this one carries no harness-applied falsification. The refutation has to be
 * recovered from demo2's own text by extraction, and connected to demo1's premise by the reasoning
 * layer. That is two failure points instead of zero, and the number will be worse for it.
 *
 * It is measured this way because it is the claim being made. An L2 recall computed after the harness
 * hands the system the falsified premise measures the cascade, not the detection — and the cascade is
 * already measured by metric 6. Reporting a hand-fed L2 number as evidence for "the world moved and the
 * log noticed" would be the one genuinely dishonest number available in this file.
 *
 * ---------------------------------------------------------------------------
 * THE OUT-LIST IS WHAT MAKES THIS NON-MONOTONIC
 *
 * A Doyle SL justification is valid iff every IN-list node is IN AND no OUT-list node is IN. A
 * non-empty OUT-list is the formal signature of non-monotonic reasoning, and it is gate (c). A system
 * with only IN-lists is monotonic: adding information can never retract a conclusion, so it can never
 * notice that the world moved. This metric is therefore also a measurement of whether the OUT-list is
 * populated at all — and `outListPopulated` is reported beside the recall for exactly that reason.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { type Resolver, plantIsTestable } from "./resolve";
import { METRIC_NAMES, type MetricResult, describeEngineId } from "./types";

export interface InvalidationOutcome {
  readonly metric: MetricResult;
  readonly perPlant: readonly {
    plant: string;
    testable: boolean;
    expectedUnsound: readonly string[];
    flipped: readonly string[];
    notFlipped: readonly string[];
    unresolvable: readonly string[];
  }[];
  /** How many decisions in the graph carry a non-empty OUT-list. Zero means the graph is monotonic and
   *  this metric cannot score above zero for a reason that has nothing to do with detection quality. */
  readonly outListPopulated: number;
  readonly decisionsTotal: number;
  readonly premiseGateRecords: number;
}

export function scoreInvalidationRecall(
  corpus: ResolvedCorpus,
  run: RunResult,
  resolver: Resolver,
  engine: EngineId,
): InvalidationOutcome {
  const plants = corpus.plants.filter((plant) => plant.kind === "L2-premise");

  const perPlant = plants.map((plant) => {
    const testable = plantIsTestable(run, plant.transcripts);
    const flipped: string[] = [];
    const notFlipped: string[] = [];
    const unresolvable: string[] = [];

    for (const key of plant.expectUnsound) {
      const id = resolver.decision(key);
      if (id === null) {
        unresolvable.push(key);
        continue;
      }

      /* "Unsound" is label OUT or UNFOUNDED. UNKNOWN is not a flip: it means the labeller could not
       * decide, and counting indecision as detection would let a system pass by refusing to commit. */
      const labelled = run.labels.get(id);
      if (labelled !== undefined && (labelled.label === "OUT" || labelled.label === "UNFOUNDED"))
        flipped.push(key);
      else notFlipped.push(key);
    }

    return {
      plant: plant.id,
      testable,
      expectedUnsound: plant.expectUnsound,
      flipped,
      notFlipped,
      unresolvable,
    };
  });

  const expected = perPlant.reduce((sum, entry) => sum + entry.expectedUnsound.length, 0);
  const hit = perPlant
    .filter((entry) => entry.testable)
    .reduce((sum, entry) => sum + entry.flipped.length, 0);
  const value = expected === 0 ? 0 : hit / expected;

  let outListPopulated = 0;
  for (const justification of run.state.justifications.values()) {
    if (justification.outList.length > 0) outListPopulated += 1;
  }

  const premiseGateRecords = run.state.contradictions.filter(
    (record) => record.gate === "premise",
  ).length;

  return {
    perPlant,
    outListPopulated,
    decisionsTotal: run.state.decisions.size,
    premiseGateRecords,
    metric: {
      id: "invalidation-recall-l2",
      name: METRIC_NAMES["invalidation-recall-l2"],
      value,
      detail: null,
      n: expected,
      perEngine: [{ engine: describeEngineId(engine), value, n: expected, detail: null }],
      comparator: null /* no comparator exists; COMPARATORS records that this is the finding */,
      gloss: `${hit} of ${expected} decision(s) that should have gone unsound when their premise was falsified actually did. ${outListPopulated} justification(s) carry a non-empty OUT-list, which is what makes the graph non-monotonic at all. ${premiseGateRecords} premise-gate record(s) were raised.`,
      honestNote: `NO PUBLISHED COMPARATOR EXISTS — no surveyed system detects that a decision's premise became false without the decision being mentioned, so there is no component to compare against and the absence is reported rather than filled with a borrowed number. n=${expected}, which is ONE planted case (demo1's SQLite decision falsified by demo2). A single case supports the claim that the mechanism fires; it does not support any claim about a RATE, and no rate should be quoted from this metric. Measured with NO harness intervention: the refutation must be extracted from demo2's text and connected to demo1's premise by the reasoning layer, so a miss here may be an extraction failure rather than a reasoning one — check premise-extraction before blaming gate (c). If outListPopulated is 0 the graph is monotonic and this metric is structurally incapable of scoring, which is a different finding from a detection failure and is printed beside the number for that reason.`,
    },
  };
}
