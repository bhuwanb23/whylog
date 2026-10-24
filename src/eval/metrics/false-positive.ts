/**
 * Metric 8 — false-positive rate per 100 decisions.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: ARGUS's FP:FN ratio of 13:1 (155 false positives against 12 false negatives).
 *
 * ---------------------------------------------------------------------------
 * THE METRIC THAT DECIDES WHETHER ANYBODY KEEPS THE TOOL INSTALLED
 *
 * A contradiction panel that is wrong once a day gets closed and never reopened. docs/03 §8 and
 * docs/02 §7 both list false positives as the failure mode that ends the product, and ARGUS's 13:1
 * ratio is the published evidence that this is not a hypothetical concern: the state of the art in
 * rationale mining produces fifteen wrong answers for every one it misses.
 *
 * Recall can always be bought with false positives. This metric is the price of the recall reported
 * everywhere else in the table, and it is why the table must never be read one row at a time.
 *
 * ---------------------------------------------------------------------------
 * THE DENOMINATOR IS DECISIONS, NOT QUERIES
 *
 * "Per 100 decisions" is a rate over the size of the graph, which is the quantity a user experiences:
 * a project with 400 decisions and a rate of 5 per 100 produces twenty interruptions, and twenty is
 * what determines whether the panel stays open. A rate over queries would measure something the user
 * never sees, because they do not query the graph twenty times a day — they are interrupted by it.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS A FALSE POSITIVE
 *
 * A contradiction record is a false positive when no plant expects it AND its verdict is one the user
 * would experience as an interruption — `contradiction` or `reversal`. `refinement` is excluded,
 * because the substrate treats refinement as the overwhelmingly common relationship between related
 * decisions and surfacing it as a conflict is precisely what docs/03 says gets a tool switched off
 * within a day; counting it here would measure the classifier's restraint rather than its errors.
 *
 * Label changes are counted too. A decision that flipped to OUT without any plant expecting it is an
 * interruption of exactly the same kind, and counting only contradiction records would let a system
 * achieve a perfect score by silently retracting decisions instead of reporting conflicts.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import type { Resolver } from "./resolve";
import { COMPARATORS, METRIC_NAMES, type MetricResult, describeEngineId } from "./types";

export interface FalsePositiveOutcome {
  readonly metric: MetricResult;
  readonly ratePer100: number;
  readonly decisions: number;
  readonly unexpectedContradictions: number;
  readonly unexpectedRetractions: number;
  readonly refinementVerdicts: number;
  readonly examples: readonly string[];
}

/** Verdicts a user experiences as an interruption. `refinement` is deliberately absent. */
const INTERRUPTING = new Set(["contradiction", "reversal"]);

export function scoreFalsePositives(
  corpus: ResolvedCorpus,
  run: RunResult,
  resolver: Resolver,
  engine: EngineId,
): FalsePositiveOutcome {
  /* Every decision the plants say should be flagged, by key. Anything outside this set is unexpected. */
  const expected = new Set<string>();
  for (const plant of corpus.plants) {
    for (const key of plant.expectUnsound) {
      const id = resolver.decision(key);
      if (id !== null) expected.add(id);
    }
  }

  let unexpectedContradictions = 0;
  let refinementVerdicts = 0;
  const examples: string[] = [];

  for (const record of run.state.contradictions) {
    if (record.verdict === "refinement") {
      refinementVerdicts += 1;
      continue;
    }
    if (!INTERRUPTING.has(record.verdict)) continue;

    /* A record is expected when EITHER side is a node some plant expected to become unsound. Requiring
     * both would count a genuine detection as a false positive whenever the corpus only labelled one
     * side of the pair. */
    const aExpected = expected.has(record.decisionA);
    const bExpected = record.decisionB !== undefined && expected.has(record.decisionB);
    if (aExpected || bExpected) continue;

    unexpectedContradictions += 1;
    if (examples.length < 8) {
      examples.push(
        `${record.gate}/${record.verdict} · ${record.decisionA}${record.decisionB === undefined ? "" : ` vs ${record.decisionB}`} · ${record.explanation.slice(0, 90)}`,
      );
    }
  }

  let unexpectedRetractions = 0;
  for (const decision of run.state.decisions.values()) {
    if (decision.label !== "OUT" && decision.label !== "UNFOUNDED") continue;
    if (expected.has(decision.id)) continue;

    unexpectedRetractions += 1;
    if (examples.length < 8) {
      examples.push(
        `retraction · ${decision.id} (${decision.variable}=${decision.value}) -> ${decision.label}`,
      );
    }
  }

  const decisions = run.state.decisions.size;
  const total = unexpectedContradictions + unexpectedRetractions;
  const ratePer100 = decisions === 0 ? 0 : (total / decisions) * 100;

  return {
    ratePer100,
    decisions,
    unexpectedContradictions,
    unexpectedRetractions,
    refinementVerdicts,
    examples,
    metric: {
      id: "false-positive-rate",
      name: METRIC_NAMES["false-positive-rate"],
      /* Lower is better, which is the opposite of every other metric in the table. The report sorts by
       * this one ascending and says so; a table where one row's good direction is inverted and nothing
       * marks it is a table that will be misread. */
      value: ratePer100,
      detail: null,
      n: decisions,
      perEngine: [
        { engine: describeEngineId(engine), value: ratePer100, n: decisions, detail: null },
      ],
      comparator: COMPARATORS["false-positive-rate"] ?? {
        source: "ARGUS (arXiv:2604.10345)",
        value: "FP:FN 13:1 — 155 false positives against 12 false negatives on alternatives",
      },
      gloss: `${ratePer100.toFixed(1)} unexpected interruption(s) per 100 decisions (${unexpectedContradictions} contradiction(s) and ${unexpectedRetractions} unexplained retraction(s) over ${decisions} decisions). ${refinementVerdicts} refinement verdict(s) were correctly NOT surfaced as conflicts.`,
      honestNote: `LOWER IS BETTER — the only metric in the table whose good direction is inverted. The denominator is decisions in the graph, not queries, because that is the quantity a user experiences: they are interrupted by the tool rather than polling it. 'Unexpected' means no plant labelled it, so a detection that is CORRECT but unlabelled counts against the system — this metric is biased pessimistic by construction, and on a corpus of ${decisions} decisions a single unlabelled true positive moves the rate by several points. ARGUS's 13:1 is a ratio over alternatives in a different corpus and is cited as the nearest published statement of the same failure, not as a like-for-like rate. Refinement verdicts are excluded on purpose: surfacing them is what docs/03 says gets a tool switched off, so counting them would measure restraint rather than error.`,
    },
  };
}
