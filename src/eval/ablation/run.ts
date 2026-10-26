/**
 * The ablation study runner — 7.3.
 *
 * Phase 7 · sub-phase 7.3
 *
 * ---------------------------------------------------------------------------
 * ONE CORPUS, ONE ENGINE, FIFTEEN CONFIGURATIONS
 *
 * Every configuration runs the identical corpus through the identical harness. Only the toggles differ.
 * That is the whole method: a delta between two rows is attributable to the switch that differs between
 * them and to nothing else, because nothing else differs.
 *
 * The engine is fixed for the whole study rather than varied per row. Varying both at once would
 * produce a table where a delta could come from either, and §7.2's requirement that per-engine numbers
 * stay separate is satisfied by running the study ONCE PER ENGINE and keeping the two tables apart —
 * never by putting two engines in one table.
 *
 * ---------------------------------------------------------------------------
 * FAILURES ARE ROWS, NOT EXCEPTIONS
 *
 * A configuration that throws is recorded with its error and excluded from the delta table, which then
 * prints the exclusion. Aborting the study would leave eleven rows and no indication that a twelfth
 * existed, and a reader would compute deltas against a baseline that may not be the one that ran.
 * ---------------------------------------------------------------------------
 */

import { createLocalEngine, localEngineId } from "@/ai/local";
import type { WhyLogEngine } from "@/ai/types";
import { nowISO } from "@/lib/format";
import type { EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import { type RunResult, runConfig } from "../harness";
import { type ScoredRun, scoreAll } from "../metrics";
import { type Ablation, fullPlan } from "./toggles";

export interface AblationOutcome {
  readonly ablation: Ablation;
  readonly scored: ScoredRun | null;
  readonly run: RunResult | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface AblationStudy {
  readonly engine: EngineId;
  readonly corpusVersion: string;
  readonly ranAt: string;
  readonly outcomes: readonly AblationOutcome[];
  readonly baseline: AblationOutcome | null;
  /** Configurations that threw. Printed in the table rather than silently absent. */
  readonly failed: readonly { id: string; error: string }[];
  readonly totalDurationMs: number;
}

export interface StudyOptions {
  readonly engine?: WhyLogEngine;
  readonly engineId?: EngineId;
  readonly plan?: readonly Ablation[];
}

/**
 * Run the whole study.
 *
 * Sequential, not concurrent. The harness mints ids from a counter and stamps learned time from a clock
 * that advances on every call; running configurations concurrently would interleave those and the deltas
 * would stop being attributable to the toggles. Slower and correct beats faster and uninterpretable.
 */
export async function runAblation(
  corpus: ResolvedCorpus,
  options: StudyOptions = {},
): Promise<AblationStudy> {
  const engine = options.engine ?? createLocalEngine();
  const engineId = options.engineId ?? localEngineId();
  const plan = options.plan ?? fullPlan();
  const ranAt = nowISO();

  const outcomes: AblationOutcome[] = [];
  const started = Date.now();

  for (const ablation of plan) {
    const rowStart = Date.now();
    try {
      const run = await runConfig(corpus, {
        id: ablation.id,
        engine,
        engineId,
        toggles: ablation.toggles,
        params: ablation.params,
      });
      outcomes.push({
        ablation,
        scored: scoreAll(corpus, run, engineId),
        run,
        error: null,
        durationMs: Date.now() - rowStart,
      });
    } catch (error) {
      outcomes.push({
        ablation,
        scored: null,
        run: null,
        error: error instanceof Error ? error.message + "\n" + (error.stack ?? "") : String(error),
        durationMs: Date.now() - rowStart,
      });
    }
  }

  const failed = outcomes
    .filter((outcome) => outcome.error !== null)
    .map((outcome) => ({ id: outcome.ablation.id, error: outcome.error ?? "unknown" }));

  return {
    engine: engineId,
    corpusVersion: corpus.version,
    ranAt,
    outcomes,
    baseline: outcomes.find((outcome) => outcome.ablation.id === "full") ?? null,
    failed,
    totalDurationMs: Date.now() - started,
  };
}

/** The study as a short human-readable summary. Printed before the table so a run that produced no
 *  usable rows says so in the first line rather than in an empty grid. */
export function describeStudy(study: AblationStudy): string {
  const usable = study.outcomes.filter((outcome) => outcome.scored !== null).length;
  const lines = [
    "Ablation study: " +
      study.outcomes.length +
      " configuration(s), " +
      usable +
      " produced scores.",
    "Engine: " +
      study.engine.kind +
      (study.engine.model.length > 0 ? "/" + study.engine.model : "") +
      "  ·  corpus " +
      study.corpusVersion +
      "  ·  ran " +
      study.ranAt,
    "Total wall time: " + (study.totalDurationMs / 1000).toFixed(1) + "s",
  ];

  if (study.baseline === null || study.baseline.scored === null) {
    lines.push("");
    lines.push(
      "THE BASELINE DID NOT PRODUCE SCORES. No delta in this study is meaningful, because every",
    );
    lines.push("delta is measured against it. Fix the baseline before reading any row below.");
  }

  if (study.failed.length > 0) {
    lines.push("");
    lines.push(
      study.failed.length + " configuration(s) threw and are EXCLUDED from the delta table:",
    );
    for (const entry of study.failed)
      lines.push("  " + entry.id + " · " + entry.error.split("\n")[0]);
  }

  return lines.join("\n");
}
