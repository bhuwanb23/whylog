/**
 * Metric 6 — cascade correctness at L3 (propagation), and metric 7, survivor preservation.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: NONE PUBLISHED for either. No surveyed system cascades a retraction at all.
 *
 * ---------------------------------------------------------------------------
 * ONE METRIC, TWO HALVES, AND THE SECOND HALF IS THE ONE THAT MATTERS
 *
 * Cascade correctness is not "did the right nodes flip". It is "did the right nodes flip AND the wrong
 * ones stay put". A cascade that retracts everything reachable is perfectly correct on the first half
 * and catastrophic in use: the user falsifies one assumption about team size and eleven unrelated
 * decisions vanish from the graph. They will never trust it again, and they will be right not to.
 *
 * So the score is a strict conjunction per plant — flips AND survivors — and survivor preservation is
 * additionally reported on its own, because it is the number that predicts whether the product
 * survives contact with a real project. §7.2 calls it one of the two unusual metrics; §7.4 names
 * cascade over-retraction as the first of four demo-killers. Both point here.
 *
 * ---------------------------------------------------------------------------
 * THE PLANTED CASE IS BUILT TO DISTINGUISH THE TWO
 *
 * `l03` puts three decisions on deliberately different support:
 *   d1 pooling           rests on single-user ALONE
 *   d2 migration tooling rests on scope ALONE
 *   d3 read replicas     rests on single-user AND no-deploy-infra
 *
 * Falsifying single-user must flip d1, spare d2 entirely, and leave d3 to its remaining support. Three
 * different correct behaviours from one intervention, and each one distinguishes a different wrong
 * implementation: a cascade that flips d2 is following edges rather than justifications; one that flips
 * d3 is treating support as all-or-nothing.
 *
 * ---------------------------------------------------------------------------
 * AN UNRESOLVABLE SURVIVOR IS A FAILURE, NOT A SKIP
 *
 * If the decision that was supposed to survive was never extracted, the survivor cannot be verified and
 * the plant is scored as failed. Skipping it would report a cascade correctness computed only over the
 * plants that happened to extract cleanly — a number that improves as extraction gets worse, which is
 * the exact inverse of what a benchmark should do.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { type Resolver, plantIsTestable } from "./resolve";
import { METRIC_NAMES, type MetricResult, describeEngineId } from "./types";

export interface PlantOutcome {
  readonly plant: string;
  readonly testable: boolean;
  readonly interventionApplied: boolean;
  readonly expectedFlips: readonly string[];
  readonly flipped: readonly string[];
  readonly missedFlips: readonly string[];
  readonly expectedSurvivors: readonly string[];
  readonly survived: readonly string[];
  /** Survivors that were retracted. Each one is an over-retraction — the demo-killer. */
  readonly overRetracted: readonly string[];
  readonly unresolvable: readonly string[];
  readonly correct: boolean;
}

export interface CascadeOutcome {
  readonly correctness: MetricResult;
  readonly survivorship: MetricResult;
  readonly perPlant: readonly PlantOutcome[];
  readonly overRetractions: number;
  readonly survivorsExpected: number;
}

const UNSOUND = new Set(["OUT", "UNFOUNDED"]);

export function scoreCascade(
  corpus: ResolvedCorpus,
  run: RunResult,
  resolver: Resolver,
  engine: EngineId,
): CascadeOutcome {
  const plants = corpus.plants.filter(
    (plant) => plant.kind === "L3-cascade" || plant.kind === "L2-premise",
  );

  const perPlant: PlantOutcome[] = plants.map((plant) => {
    const testable = plantIsTestable(run, plant.transcripts);

    /* An L3 plant is only testable if its intervention actually landed. An L2 plant has no
     * intervention — the falsification must come out of the transcript — so it is testable whenever its
     * transcripts imported. */
    const interventionApplied =
      plant.falsify === undefined ||
      plant.falsify.every((step) =>
        run.interventions.some(
          (outcome) =>
            outcome.plant === plant.id && outcome.predicate === step.predicate && outcome.applied,
        ),
      );

    const flipped: string[] = [];
    const missedFlips: string[] = [];
    const survived: string[] = [];
    const overRetracted: string[] = [];
    const unresolvable: string[] = [];

    for (const key of plant.expectUnsound) {
      const id = resolver.decision(key);
      if (id === null) {
        unresolvable.push(key);
        continue;
      }
      if (isUnsound(run, id)) flipped.push(key);
      else missedFlips.push(key);
    }

    for (const key of plant.expectSurvivors) {
      const id = resolver.decision(key);
      if (id === null) {
        /* A survivor that was never extracted cannot be shown to have survived. Counted as unresolved
         * and the plant fails, per the header: skipping it would reward poor extraction. */
        unresolvable.push(key);
        continue;
      }
      if (isUnsound(run, id)) overRetracted.push(key);
      else survived.push(key);
    }

    const correct =
      testable &&
      interventionApplied &&
      missedFlips.length === 0 &&
      overRetracted.length === 0 &&
      unresolvable.length === 0 &&
      plant.expectUnsound.length + plant.expectSurvivors.length > 0;

    return {
      plant: plant.id,
      testable,
      interventionApplied,
      expectedFlips: plant.expectUnsound,
      flipped,
      missedFlips,
      expectedSurvivors: plant.expectSurvivors,
      survived,
      overRetracted,
      unresolvable,
      correct,
    };
  });

  const survivorsExpected = perPlant.reduce(
    (sum, entry) => sum + entry.expectedSurvivors.length,
    0,
  );
  const survivorsKept = perPlant.reduce((sum, entry) => sum + entry.survived.length, 0);
  const overRetractions = perPlant.reduce((sum, entry) => sum + entry.overRetracted.length, 0);

  const correctPlants = perPlant.filter((entry) => entry.correct).length;
  const correctnessValue = perPlant.length === 0 ? 0 : correctPlants / perPlant.length;

  /* Survivor preservation is 1.0 when no survivors are expected, which is vacuous rather than perfect.
   * The report must not print it as an achievement, so the gloss says so explicitly. */
  const survivorValue = survivorsExpected === 0 ? 1 : survivorsKept / survivorsExpected;

  return {
    perPlant,
    overRetractions,
    survivorsExpected,
    correctness: {
      id: "cascade-correctness-l3",
      name: METRIC_NAMES["cascade-correctness-l3"],
      value: correctnessValue,
      detail: null,
      n: perPlant.length,
      perEngine: [
        {
          engine: describeEngineId(engine),
          value: correctnessValue,
          n: perPlant.length,
          detail: null,
        },
      ],
      comparator: null,
      gloss: `${correctPlants} of ${perPlant.length} plant(s) were FULLY correct — every expected flip happened and no survivor was retracted. ${overRetractions} over-retraction(s) across ${survivorsExpected} expected survivor(s).`,
      honestNote: `Scored as a strict conjunction per plant: a cascade that flips the right nodes AND retracts a survivor scores 0, not partial credit, because over-retraction is the failure that destroys trust and partial credit would hide it. n=${perPlant.length} plants — small enough that this metric is a PASS/FAIL over named cases rather than a statistical rate, and it should be quoted as such. A plant whose intervention could not be applied, or whose survivor was never extracted, is scored as FAILED rather than skipped: skipping would make the number improve as extraction worsens. No published comparator exists, because no surveyed system propagates a retraction at all.`,
    },
    survivorship: {
      id: "survivor-preservation",
      name: METRIC_NAMES["survivor-preservation"],
      value: survivorValue,
      detail: null,
      n: survivorsExpected,
      perEngine: [
        {
          engine: describeEngineId(engine),
          value: survivorValue,
          n: survivorsExpected,
          detail: null,
        },
      ],
      comparator: null,
      gloss:
        survivorsExpected === 0
          ? "VACUOUS: the corpus expected no survivors in the plants that ran, so 1.0 here means nothing was tested."
          : `${survivorsKept} of ${survivorsExpected} decision(s) that shared no falsified premise kept their label. ${overRetractions} were retracted anyway.`,
      honestNote: `One of the two metrics §7.2 calls unusual, and the one that predicts whether the product survives a real project. 1.0 is VACUOUS when n=0 and the gloss says so rather than printing a perfect score for an untested property — a benchmark that reports 100% because it measured nothing is worse than one that reports 40%. n=${survivorsExpected} survivors, all from the single l03 plant, so this is a check that a specific mechanism does not over-fire, not an estimate of an over-retraction RATE. Nobody publishes a comparator because nobody cascades.`,
    },
  };
}

function isUnsound(run: RunResult, id: DecisionId): boolean {
  const labelled = run.labels.get(id);
  if (labelled !== undefined) return UNSOUND.has(labelled.label);

  const decision = run.state.decisions.get(id);
  return decision !== undefined && (decision.label === "OUT" || decision.label === "UNFOUNDED");
}
