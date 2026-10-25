/**
 * Metric 4 — contradiction recall at L1 (pairwise).
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: Kantara (arXiv:2506.11005), 396 contradictory pairs at F1 0.70–0.75.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE CONTROL, NOT THE HEADLINE
 *
 * L1 is "you said X, then you said not-X". Every system in docs/01 and docs/06 can do some version of
 * it, agentmemory included via recency, and ai-memory via git lineage. The corpus plants it as a
 * CONTROL: if L1 fails, the pipeline is broken somewhere upstream and none of the other numbers mean
 * anything. It is reported first for that reason and never as the achievement.
 *
 * The plan is explicit that pairwise contradiction detection is a dead end as a headline claim, and
 * docs/07 §2.1 lists "we detect contradictions" among the three sentences never to say. A metric
 * exists for it anyway, because a control that is not measured is not a control.
 *
 * ---------------------------------------------------------------------------
 * KANTARA PUBLISHED COUNTS, NOT RECALL
 *
 * 396 contradictory pairs over the Linux kernel is a COUNT of what was found, with F1 reported against
 * a hand-checked sample. It is not recall over a planted set, because nothing was planted — the
 * contradictions were whatever the kernel happened to contain. So the comparison is directional only:
 * both systems find contradictions in real material, and neither number is a rate over a known
 * denominator. The comparator field says this rather than printing 396 next to a recall figure and
 * letting the reader do arithmetic that would be meaningless.
 *
 * ---------------------------------------------------------------------------
 * M1 AND M2 ARE SCORED HERE TOO
 *
 * Kantara's two diagnostics — M1, similar decisions with contradictory rationales, and M2,
 * contradictory decisions with similar rationales — are the only part of its contribution that is not
 * plain pairwise detection. `ContradictionRecord.diagnostic` carries them, so they are counted
 * separately: an M2 detection is the interesting one, because it is a contradiction that survives
 * surface similarity and therefore cannot be found by a string comparison.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { plantIsTestable, runtimeTranscriptId, type Resolver } from "./resolve";
import { COMPARATORS, METRIC_NAMES, describeEngineId, precisionRecall, type MetricResult } from "./types";

export interface ContradictionOutcome {
  readonly metric: MetricResult;
  readonly perPlant: readonly {
    plant: string;
    kind: string;
    testable: boolean;
    expected: number;
    found: number;
    records: readonly string[];
  }[];
  readonly m1Detections: number;
  readonly m2Detections: number;
  readonly byGate: Readonly<Record<"structural" | "semantic" | "premise", number>>;
}

export function scoreContradictionRecall(
  corpus: ResolvedCorpus,
  run: RunResult,
  resolver: Resolver,
  engine: EngineId,
): ContradictionOutcome {
  const plants = corpus.plants.filter(
    (plant) =>
      plant.kind === "L1-pairwise" ||
      plant.kind === "M1-similar-decisions-contradictory-rationales" ||
      plant.kind === "M2-contradictory-decisions-similar-rationales" ||
      plant.kind === "duplicate-restatement",
  );

  const perPlant = plants.map((plant) => {
    const testable = plantIsTestable(run, plant.transcripts);
    const runtimeIds = plant.transcripts
      .map((key) => runtimeTranscriptId(run, key))
      .filter((id): id is string => id !== null);

    /* A record counts for this plant when both of its decisions live in the plant's transcripts, or —
     * for the single-transcript plants — when its one decision does. Restricting by transcript is what
     * stops an unrelated contradiction elsewhere in the merged graph from being credited here. */
    const owned = run.state.contradictions.filter((record) => {
      const a = transcriptOfDecision(run, record.decisionA);
      const b = record.decisionB === undefined ? a : transcriptOfDecision(run, record.decisionB);
      return a !== null && runtimeIds.includes(a) && (b === null || runtimeIds.includes(b));
    });

    /* `duplicate-restatement` expects ZERO contradictions: three restatements of decisions already in
     * the graph must merge, not conflict. Its expected count is inverted relative to every other plant,
     * and treating it like the others would score correct behaviour as a miss. */
    const expectsNone = plant.kind === "duplicate-restatement";
    const expected = expectsNone ? 1 : 1;
    const found = expectsNone ? (owned.length === 0 ? 1 : 0) : owned.length > 0 ? 1 : 0;

    return {
      plant: plant.id,
      kind: plant.kind,
      testable,
      expected,
      found: testable ? found : 0,
      records: owned.map((record) => record.gate + "/" + record.verdict + (record.diagnostic ? "/" + record.diagnostic : "")),
    };
  });

  const testable = perPlant.filter((entry) => entry.testable);
  const detail = precisionRecall(
    testable.reduce((sum, entry) => sum + entry.found, 0),
    0,
    testable.reduce((sum, entry) => sum + (entry.expected - entry.found), 0) +
      perPlant.filter((entry) => !entry.testable).length,
  );

  const byGate = { structural: 0, semantic: 0, premise: 0 };
  let m1 = 0;
  let m2 = 0;
  for (const record of run.state.contradictions) {
    byGate[record.gate] += 1;
    if (record.diagnostic === "M1") m1 += 1;
    if (record.diagnostic === "M2") m2 += 1;
  }

  return {
    perPlant,
    m1Detections: m1,
    m2Detections: m2,
    byGate,
    metric: {
      id: "contradiction-recall-l1",
      name: METRIC_NAMES["contradiction-recall-l1"],
      value: detail.recall,
      detail,
      n: perPlant.length,
      perEngine: [{ engine: describeEngineId(engine), value: detail.recall, n: perPlant.length, detail }],
      comparator: COMPARATORS["contradiction-recall-l1"] ?? null,
      gloss:
        detail.truePositives + " of " + perPlant.length + " planted L1 cases produced the expected verdict. " +
        "By gate: " + byGate.structural + " structural, " + byGate.semantic + " semantic, " + byGate.premise +
        " premise. Kantara diagnostics: " + m1 + " M1, " + m2 + " M2.",
      honestNote:
        "n=" + perPlant.length + " plants, which is a count of CASES, not of contradiction pairs — Kantara's 396 is a count " +
        "of pairs found in the Linux kernel with no planted denominator, so the two numbers are not rates over the same kind " +
        "of thing and must not be divided into each other. Recall here is over planted cases the corpus says must fire, plus " +
        "one case (duplicate-restatement) that says must NOT fire; an untestable plant — one whose transcript failed to " +
        "import — counts as a miss, because an unmeasured case is not a passed case. L1 is the CONTROL: every surveyed " +
        "system does some version of it, and a failure here invalidates the rest of the table.",
    },
  };
}

function transcriptOfDecision(run: RunResult, id: DecisionId): string | null {
  const decision = run.state.decisions.get(id);
  if (decision === undefined) return null;

  const entry = run.transcripts.find((candidate) => candidate.runtimeId === decision.provenance.transcriptId);
  return entry === undefined ? null : entry.runtimeId;
}
