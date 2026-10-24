/**
 * The ablation delta table and the prediction audit — 7.3.
 *
 * Phase 7 · sub-phase 7.3
 *
 * ---------------------------------------------------------------------------
 * REPRODUCIBLE MEANS THE TABLE CARRIES ITS OWN INPUTS
 *
 * Every table printed here names the corpus version, the engine and the run timestamp. A delta table
 * without them is a set of numbers nobody can regenerate, and §7.3 asks for a reproducible table rather
 * than merely a table.
 *
 * ---------------------------------------------------------------------------
 * THE PREDICTION AUDIT IS THE POINT OF THE ABLATION
 *
 * A delta on its own says "removing X changed Y". It does not say whether that was expected. The audit
 * compares each observed delta against the threshold declared in `EXPECTED_DAMAGE` BEFORE the run and
 * classifies it:
 *
 *   CONFIRMED   the component moved the metric it was claimed to move, by at least the threshold
 *   FALSIFIED   the component was claimed to move a metric and did not — it is not earning its place
 *   UNTESTABLE  the metric never had a denominator in either run, so no comparison is possible
 *   BELOW FLOOR moved, but by less than the noise floor, which on twelve transcripts is not evidence
 *
 * §7.3 requires at least one falsified hypothesis reported honestly. That requirement cannot be met by
 * looking for something to confess after the fact; it is met by declaring thresholds in advance and
 * printing whatever the comparison produces. If nothing is falsified, the audit says so and the honest
 * reading is that the predictions were too timid — which is itself worth reporting, because a suite of
 * predictions that cannot fail is not a suite of hypotheses.
 * ---------------------------------------------------------------------------
 */

import type { MetricId, MetricResult } from "../metrics/types";
import { METRIC_NAMES } from "../metrics/types";
import type { AblationStudy } from "./run";
import { type Ablation, NOISE_FLOOR } from "./toggles";

export interface DeltaRow {
  readonly ablation: Ablation;
  readonly subsystem: string;
  readonly deltas: Readonly<Record<string, number>>;
  readonly verdicts: readonly PredictionVerdict[];
  readonly usable: boolean;
}

export type VerdictKind =
  | "confirmed"
  | "falsified"
  | "untestable"
  | "below-floor"
  | "no-prediction";

export interface PredictionVerdict {
  readonly metric: string;
  readonly kind: VerdictKind;
  readonly threshold: number;
  readonly delta: number;
  readonly baselineValue: number;
  readonly ablatedValue: number;
  readonly sentence: string;
}

/** Metrics the table reports on. Chosen before the run: the ones a component could plausibly move. */
export const TABLE_METRICS: readonly MetricId[] = [
  "decision-extraction",
  "premise-extraction",
  "alternative-precision",
  "modality-precision",
  "contradiction-recall-l1",
  "invalidation-recall-l2",
  "cascade-correctness-l3",
  "survivor-preservation",
  "false-positive-rate",
  "answer-groundedness",
  "retrieval-precision",
  "retrieval-mrr",
];

/** `false-positive-rate` is the one metric where LOWER is better, so its deltas are sign-flipped before
 *  comparison. Without this, a toggle that REDUCES false positives would be audited as having damaged
 *  the metric, and the audit would recommend keeping a component that makes the product worse. */
const LOWER_IS_BETTER = new Set<MetricId>(["false-positive-rate"]);

export function buildDeltaRows(study: AblationStudy): readonly DeltaRow[] {
  const baseline = study.baseline;
  if (baseline === null || baseline.scored === null) return [];

  const baselineValues = valuesOf(baseline.scored.metrics);

  return study.outcomes
    .filter((outcome) => outcome.ablation.id !== "full")
    .map((outcome) => {
      if (outcome.scored === null) {
        return {
          ablation: outcome.ablation,
          subsystem: outcome.ablation.subsystem,
          deltas: {},
          verdicts: [],
          usable: false,
        };
      }

      const values = valuesOf(outcome.scored.metrics);
      const deltas: Record<string, number> = {};

      for (const id of TABLE_METRICS) {
        const before = baselineValues[id];
        const after = values[id];
        if (before === undefined || after === undefined) continue;
        deltas[id] = LOWER_IS_BETTER.has(id) ? before - after : after - before;
      }

      return {
        ablation: outcome.ablation,
        subsystem: outcome.ablation.subsystem,
        deltas,
        verdicts: audit(outcome.ablation, deltas, baselineValues, values),
        usable: true,
      };
    });
}

function audit(
  ablation: Ablation,
  deltas: Readonly<Record<string, number>>,
  baselineValues: Readonly<Record<string, number>>,
  ablatedValues: Readonly<Record<string, number>>,
): readonly PredictionVerdict[] {
  if (ablation.expectsDamage.length === 0) {
    return [
      {
        metric: "(none declared)",
        kind: "no-prediction",
        threshold: 0,
        delta: 0,
        baselineValue: 0,
        ablatedValue: 0,
        sentence: `No damage was predicted for this switch, so no hypothesis was at risk. ${
          ablation.id === "no-voting"
            ? "The local engine reports voting as unsupported and the pipeline ignores the option, so this switch is UNMEASURABLE keyless — predicting a movement here would be predicting a bug."
            : "Reported for completeness; a switch with no prediction cannot be falsified and should not be counted as a confirmed design choice."
        }`,
      },
    ];
  }

  return ablation.expectsDamage.map((expectation) => {
    const delta = deltas[expectation.metric] ?? Number.NaN;
    const baselineValue = baselineValues[expectation.metric] ?? Number.NaN;
    const ablatedValue = ablatedValues[expectation.metric] ?? Number.NaN;

    const untestable = Number.isNaN(delta) || (baselineValue === 0 && ablatedValue === 0);

    if (untestable) {
      return {
        metric: expectation.metric,
        kind: "untestable" as VerdictKind,
        threshold: expectation.threshold,
        delta: Number.isNaN(delta) ? 0 : delta,
        baselineValue: Number.isNaN(baselineValue) ? 0 : baselineValue,
        ablatedValue: Number.isNaN(ablatedValue) ? 0 : ablatedValue,
        sentence:
          "The metric had no denominator in either run, so nothing could be compared. This is not a " +
          "confirmed prediction and must not be read as one — an untested component is not a working component.",
      };
    }

    if (delta >= expectation.threshold) {
      return {
        metric: expectation.metric,
        kind: "confirmed" as VerdictKind,
        threshold: expectation.threshold,
        delta,
        baselineValue,
        ablatedValue,
        sentence: `Removing it moved ${name(expectation.metric)} by ${signed(delta)}, at or above the declared threshold of ${expectation.threshold.toFixed(2)}. The component earns its place on this corpus.`,
      };
    }

    if (Math.abs(delta) < NOISE_FLOOR) {
      return {
        metric: expectation.metric,
        kind: "below-floor" as VerdictKind,
        threshold: expectation.threshold,
        delta,
        baselineValue,
        ablatedValue,
        sentence: `Removing it moved ${name(expectation.metric)} by ${signed(delta)}, below the ${NOISE_FLOOR.toFixed(2)} noise floor for a twelve-transcript corpus. This is not evidence the component is useless — it is evidence the corpus is too small to tell, and those are different claims.`,
      };
    }

    return {
      metric: expectation.metric,
      kind: "falsified" as VerdictKind,
      threshold: expectation.threshold,
      delta,
      baselineValue,
      ablatedValue,
      sentence: `PREDICTION FALSIFIED. Removing this component moved ${name(expectation.metric)} by ${signed(delta)} against a declared threshold of ${expectation.threshold.toFixed(2)}. On this corpus the component does not do what the architecture claims it does — either it is not load-bearing, or the corpus does not exercise the case it was built for, and distinguishing those needs more transcripts rather than more argument.`,
    };
  });
}

function valuesOf(metrics: readonly MetricResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of metrics) out[metric.id] = metric.value;
  return out;
}

function name(id: string): string {
  return METRIC_NAMES[id as MetricId] ?? id;
}

function signed(value: number): string {
  return (value >= 0 ? "+" : "") + value.toFixed(3);
}

/** The delta table as fixed-width text. Deltas are SIGNED and sign-flipped for false-positive rate, so
 *  a positive number always means "the full system is better". */
export function renderAblationTable(study: AblationStudy): string {
  const rows = buildDeltaRows(study);
  const lines: string[] = [];

  lines.push("ABLATION DELTA TABLE");
  lines.push(
    `corpus ${study.corpusVersion} · engine ${study.engine.kind}${study.engine.model.length > 0 ? `/${study.engine.model}` : ""} · ran ${study.ranAt}`,
  );
  lines.push(
    "Every number is (ablated − baseline), sign-flipped for false-positive rate so that POSITIVE ALWAYS MEANS THE FULL SYSTEM IS BETTER.",
  );
  lines.push("");

  const header =
    "Switch".padEnd(30) + TABLE_METRICS.map((id) => shortName(id).padStart(11)).join("");
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const row of rows) {
    if (!row.usable) {
      lines.push(`${row.ablation.id.padEnd(30)}  THREW — excluded from the table`);
      continue;
    }
    const cells = TABLE_METRICS.map((id) => {
      const delta = row.deltas[id];
      return (delta === undefined ? "·" : signed(delta)).padStart(11);
    });
    lines.push(row.ablation.id.padEnd(30) + cells.join(""));
  }

  lines.push("");
  lines.push(
    "· = metric not produced by that configuration. A column of · is a configuration that never exercised the component,",
  );
  lines.push("    which is a different finding from a column of +0.000.");

  return lines.join("\n");
}

/** The prediction audit. This is where §7.3's "at least one hypothesis falsified and reported honestly"
 *  is either satisfied or visibly not. */
export function renderPredictionAudit(study: AblationStudy): string {
  const rows = buildDeltaRows(study).filter((row) => row.usable);
  const lines: string[] = [];

  const all = rows.flatMap((row) => row.verdicts.map((verdict) => ({ row, verdict })));
  const falsified = all.filter((entry) => entry.verdict.kind === "falsified");
  const confirmed = all.filter((entry) => entry.verdict.kind === "confirmed");
  const untestable = all.filter((entry) => entry.verdict.kind === "untestable");
  const belowFloor = all.filter((entry) => entry.verdict.kind === "below-floor");

  lines.push("PREDICTION AUDIT");
  lines.push(
    "Thresholds were declared in src/eval/ablation/toggles.ts BEFORE any configuration was run.",
  );
  lines.push("");
  lines.push(`  confirmed     ${confirmed.length}`);
  lines.push(`  FALSIFIED     ${falsified.length}`);
  lines.push(
    `  below floor   ${belowFloor.length}   (moved less than ${NOISE_FLOOR.toFixed(2)} — too small to interpret on 12 transcripts)`,
  );
  lines.push(`  untestable    ${untestable.length}   (no denominator in either run)`);
  lines.push("");

  if (falsified.length === 0) {
    lines.push(
      "NOTHING WAS FALSIFIED. §7.3 requires at least one falsified hypothesis reported honestly, and this run",
    );
    lines.push(
      "does not have one. The honest reading is that the declared thresholds were too timid to be at risk, not",
    );
    lines.push(
      "that every architectural claim survived contact with measurement. A prediction that cannot fail is a",
    );
    lines.push("description, and a study made only of those has not tested the architecture.");
    lines.push("");
  } else {
    lines.push(
      "FALSIFIED PREDICTIONS — reported in full, with the threshold that was declared beforehand:",
    );
    lines.push("");
    for (const entry of falsified) {
      lines.push(`  ${entry.row.ablation.id} · ${entry.row.ablation.label}`);
      lines.push(`    Predicted: ${entry.row.ablation.predicts}`);
      lines.push(`    Observed:  ${entry.verdict.sentence}`);
      lines.push(
        `    Baseline ${entry.verdict.baselineValue.toFixed(3)} -> ablated ${entry.verdict.ablatedValue.toFixed(3)}`,
      );
      lines.push("");
    }
  }

  if (confirmed.length > 0) {
    lines.push("CONFIRMED — the component moved the metric it was claimed to move:");
    for (const entry of confirmed) {
      lines.push(`  ${entry.row.ablation.id.padEnd(30)} ${entry.verdict.sentence}`);
    }
    lines.push("");
  }

  if (untestable.length > 0) {
    lines.push(
      "UNTESTABLE — recorded rather than quietly dropped, because an untested component is not a working one:",
    );
    for (const entry of untestable) {
      lines.push(`  ${entry.row.ablation.id.padEnd(30)} ${entry.verdict.metric}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function shortName(id: MetricId): string {
  const map: Record<string, string> = {
    "decision-extraction": "decisions",
    "premise-extraction": "premises",
    "alternative-precision": "alterns",
    "modality-precision": "modality",
    "contradiction-recall-l1": "L1",
    "invalidation-recall-l2": "L2",
    "cascade-correctness-l3": "L3",
    "survivor-preservation": "survivor",
    "false-positive-rate": "FP/100",
    "answer-groundedness": "grounded",
    "retrieval-precision": "P@5",
    "retrieval-mrr": "MRR",
  };
  return map[id] ?? id.slice(0, 10);
}

export type { DeltaRow as Delta };
