/**
 * `npm run eval:ablation` — run every configuration and print the delta table plus the prediction audit.
 *
 * Phase 7 · sub-phase 7.3
 *
 * A separate entry point from `ablation/run.ts` on purpose. `run.ts` is imported by `table.ts`, and a
 * module that starts a fifteen-configuration study on import would run the study every time anything
 * read the table renderer. Side effects belong at the edge.
 */

import { banner, blank, heading, line, prepare, readArgs, write } from "../cli";
import { type ScoredRun, renderSuite } from "../metrics";
import { type AblationStudy, describeStudy, runAblation } from "./run";
import { renderAblationTable, renderPredictionAudit } from "./table";
import { describePlan, fullPlan } from "./toggles";

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const { corpus: resolved, engineId } = prepare();

  const plan = fullPlan();

  banner("Ablation study — " + plan.length + " configurations");
  line(describePlan(plan));
  blank();
  line(
    "This runs the full corpus once per configuration, sequentially. Configurations are NOT run",
  );
  line(
    "concurrently: the harness mints ids from a counter and stamps learned time from a clock that",
  );
  line("advances per call, and interleaving them would make deltas unattributable to the toggles.");

  const study = await runAblation(resolved, { engineId });

  heading("Study");
  line(describeStudy(study));

  heading("Delta table");
  line(renderAblationTable(study));

  heading("Prediction audit");
  line(renderPredictionAudit(study));

  if (args.has("out")) {
    const baseline = study.baseline;
    write(
      args.get("out") ?? "ablation-report.md",
      renderAblationMarkdown(study, baseline === null ? null : baseline.scored),
    );
  }

  blank();
  line(
    "A delta is only meaningful against the baseline row. If the baseline threw, nothing below it means anything.",
  );
}

function renderAblationMarkdown(study: AblationStudy, baseline: ScoredRun | null): string {
  const parts = [
    "# Ablation study",
    "",
    "Corpus " +
      study.corpusVersion +
      " · engine " +
      study.engine.kind +
      (study.engine.model.length > 0 ? "/" + study.engine.model : "") +
      " · ran " +
      study.ranAt,
    "",
    "Every number below is (ablated − baseline), sign-flipped for false-positive rate so that a positive",
    "delta always means the full system is better. Thresholds were declared in `toggles.ts` before any",
    "configuration was run.",
    "",
    "```",
    describeStudy(study),
    "",
    renderAblationTable(study),
    "",
    renderPredictionAudit(study),
    "```",
    "",
  ];

  if (baseline !== null) {
    parts.push("## Baseline metrics", "", "```", renderSuite(baseline), "```", "");
  }

  return parts.join("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    "\n" + (error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n",
  );
  process.exitCode = 1;
});
