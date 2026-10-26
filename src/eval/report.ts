/**
 * `npm run eval:report` — write the full evaluation report to disk.
 *
 * Phase 7 · sub-phase 7.7
 *
 * ---------------------------------------------------------------------------
 * THE REPORT SHOWS ITS WORKING
 *
 * Every headline number is followed by the per-plant and per-question breakdown that produced it, the
 * sample size, the comparator (or an explicit statement that none exists) and what the number does not
 * establish. A report of summary numbers alone would be indistinguishable from marketing, and G6 asks
 * that every claim be backed by a number or a diagram rather than an adjective — which means the number
 * has to be traceable to the cases behind it.
 *
 * ---------------------------------------------------------------------------
 * IT IS GENERATED, NOT WRITTEN
 *
 * `docs/EVALUATION.md` quotes from this file; it does not restate it. Two copies of a number drift, and
 * a benchmark whose published figures disagree with its own output is worse than one with no published
 * figures. Regenerating the report is the only way to keep them identical.
 * ---------------------------------------------------------------------------
 */

import { nowISO } from "@/lib/format";
import { type AblationStudy, describeStudy, runAblation } from "./ablation/run";
import { renderAblationTable, renderPredictionAudit } from "./ablation/table";
import { DEFAULT_PARAMS, FULL } from "./ablation/toggles";
import { banner, blank, heading, line, prepare, readArgs, write } from "./cli";
import { describeCorpus } from "./corpus/labels";
import type { ResolvedCorpus } from "./corpus/labels";
import { describeLoad } from "./corpus/loader";
import { type HardeningReport, harden, renderHardening } from "./hardening";
import { runConfig } from "./harness";
import type { ScoredRun } from "./metrics";
import { metricsWithoutComparator, renderSuite, unusualMetrics } from "./metrics";
import { scoreAll } from "./metrics";
import type { MetricResult } from "./metrics/types";

/**
 * The whole report as Markdown.
 *
 * `study` is optional: the baseline report is useful without fifteen ablation runs, and requiring the
 * study would mean the fastest possible verification path — load the corpus, run it once, print the
 * numbers — took fifteen times longer than it needs to.
 */
export function renderFullReport(
  corpus: ResolvedCorpus,
  scored: ScoredRun,
  study: AblationStudy | null,
  hardening: HardeningReport | null = null,
): string {
  const out: string[] = [];

  out.push("# DecisionMemEval — evaluation report");
  out.push("");
  out.push(
    "Generated " + nowISO() + ". Do not edit by hand: `npm run eval:report` regenerates it.",
  );
  out.push("");
  out.push(
    "Corpus " +
      corpus.version +
      " · engine " +
      describeEngine(scored) +
      " · " +
      corpus.transcripts.length +
      " transcripts",
  );
  out.push("");

  /* ---- the honest summary first ---- */
  out.push("## Summary");
  out.push("");
  out.push(metricsSummary(scored));
  out.push("");

  /* ---- the suite ---- */
  out.push("## The thirteen metrics");
  out.push("");
  out.push("```");
  out.push(renderSuite(scored));
  out.push("```");
  out.push("");

  out.push("### Each metric, with what it does not establish");
  out.push("");
  for (const metric of scored.metrics) out.push(...metricSection(metric));

  /* ---- the two unusual ones, pulled forward ---- */
  out.push("## The two metrics no competitor can produce");
  out.push("");
  out.push(
    "§7.2 calls these out specifically. Neither measures a capability the surveyed systems have at any",
    "quality, because neither component exists in them: no surveyed system cascades a retraction, and no",
    "surveyed extractor operates on a corpus where speculation outnumbers decisions.",
  );
  out.push("");
  for (const metric of unusualMetrics(scored)) {
    out.push("- **" + metric.name + "** — " + metric.gloss);
    out.push("  " + metric.honestNote);
  }
  out.push("");

  /* ---- detail ---- */
  out.push("## Per-case detail");
  out.push("");
  out.push(...extractionDetail(scored));
  out.push(...plantDetail(scored));
  out.push(...questionDetail(scored));
  out.push(...guardDetail(scored));

  /* ---- ablation ---- */
  if (study !== null) {
    out.push("## Ablation study");
    out.push("");
    out.push("```");
    out.push(describeStudy(study));
    out.push("```");
    out.push("");
    out.push("```");
    out.push(renderAblationTable(study));
    out.push("```");
    out.push("");
    out.push("### Prediction audit");
    out.push("");
    out.push("```");
    out.push(renderPredictionAudit(study));
    out.push("```");
    out.push("");
  } else {
    out.push("## Ablation study");
    out.push("");
    out.push("NOT RUN. Pass `--ablation` or run `npm run eval:ablation` separately.");
    out.push(
      "A baseline without ablations supports claims about what the system scores, not about which",
    );
    out.push(
      "component earned the score — and only the second kind of claim is an architectural one.",
    );
    out.push("");
  }

  /* ---- hardening ---- */
  out.push("## Hardening pass");
  out.push("");
  if (hardening === null) {
    out.push(
      "NOT RUN. `npm run eval` computes it; a report without it has checked no demo-killer.",
    );
  } else {
    out.push("```");
    out.push(renderHardening(hardening));
    out.push("```");
  }
  out.push("");

  /* ---- new territory ---- */
  out.push("## Metrics with no published comparator");
  out.push("");
  const without = metricsWithoutComparator(scored);
  out.push(
    without.length +
      " of " +
      scored.metrics.length +
      " metrics have no published comparator. This is the new-territory claim stated as a count rather than",
    "as an adjective:",
  );
  out.push("");
  for (const metric of without) out.push("- " + metric.name);
  out.push("");

  return out.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function describeEngine(scored: ScoredRun): string {
  const first = scored.metrics[0]?.perEngine[0];
  return first === undefined ? "unknown" : first.engine;
}

function metricsSummary(scored: ScoredRun): string {
  const lines = [
    "Thirteen metrics over " +
      scored.run.transcripts.length +
      " transcripts. Every one carries its sample",
    "size, its comparator where one is published, and a statement of what it does not establish.",
    "",
  ];

  for (const metric of scored.metrics) {
    const value =
      metric.id === "false-positive-rate"
        ? metric.value.toFixed(1) + " per 100 (lower is better)"
        : metric.value.toFixed(3);
    lines.push("- **" + metric.name + "**: " + value + " (n=" + metric.n + ")");
  }

  return lines.join("\n");
}

function metricSection(metric: MetricResult): string[] {
  const out = ["#### " + metric.name, ""];
  const detail = metric.detail;

  out.push(
    "**" +
      (metric.id === "false-positive-rate"
        ? metric.value.toFixed(1) + " per 100 decisions"
        : metric.value.toFixed(3)) +
      "** · n=" +
      metric.n +
      (detail === null
        ? ""
        : " · P " +
          detail.precision.toFixed(3) +
          " / R " +
          detail.recall.toFixed(3) +
          " / F1 " +
          detail.f1.toFixed(3) +
          " (TP " +
          detail.truePositives +
          ", FP " +
          detail.falsePositives +
          ", FN " +
          detail.falseNegatives +
          ")"),
  );
  out.push("");
  out.push(metric.gloss);
  out.push("");
  out.push(
    "Comparator: " +
      (metric.comparator === null
        ? "**none published.** The absence is the finding — see the honest note."
        : metric.comparator.source + " — " + metric.comparator.value),
  );
  out.push("");
  out.push("> " + metric.honestNote);
  out.push("");
  return out;
}

function extractionDetail(scored: ScoredRun): string[] {
  const out = ["### Extraction", ""];

  out.push("| transcript | TP | FP | FN |");
  out.push("| --- | --- | --- | --- |");
  for (const entry of scored.extraction.perTranscript) {
    out.push(
      "| " + entry.transcript + " | " + entry.tp + " | " + entry.fp + " | " + entry.fn + " |",
    );
  }
  out.push("");

  if (scored.extraction.variableErrors.length > 0) {
    out.push(
      "Found the sentence, understood it as the wrong kind of decision (" +
        scored.extraction.variableErrors.length +
        "):",
    );
    out.push("");
    for (const entry of scored.extraction.variableErrors.slice(0, 12)) {
      out.push(
        "- `" +
          entry.label.key +
          "` labelled " +
          entry.label.variable +
          ", extracted as " +
          entry.node.variable,
      );
    }
    out.push("");
  }

  if (scored.premise.predicateErrors.length > 0) {
    out.push(
      "Premises matched on span but given the wrong predicate (" +
        scored.premise.predicateErrors.length +
        "):",
    );
    out.push("");
    for (const entry of scored.premise.predicateErrors.slice(0, 12)) {
      out.push(
        "- `" +
          entry.label.key +
          "` labelled `" +
          entry.label.predicate +
          "`, extracted as `" +
          entry.node.predicate +
          "`",
      );
    }
    out.push("");
  }

  if (scored.premise.typeErrors.length > 0) {
    out.push(
      "Premise TYPE errors (" +
        scored.premise.typeErrors.length +
        ") — spans overlap but the types disagree.",
      "The substrate forbids merging across types, so these are near-misses the alignment refused:",
    );
    out.push("");
    for (const entry of scored.premise.typeErrors.slice(0, 12)) {
      out.push(
        "- `" +
          entry.label.key +
          "` labelled " +
          entry.label.type +
          ", extracted as " +
          entry.node.type,
      );
    }
    out.push("");
  }

  if (scored.modality.wronglyPromoted.length > 0) {
    out.push(
      "**Statements that should not have become nodes, and did** (" +
        scored.modality.wronglyPromoted.length +
        "):",
    );
    out.push("");
    for (const entry of scored.modality.wronglyPromoted) {
      out.push("- `" + entry.label.key + "` (" + entry.label.modality + ") → " + entry.node.id);
    }
    out.push("");
  }

  out.push(
    "Alternative FP:FN ratio — " + scored.alternative.fpToFnRatio + " (ARGUS published 13:1).",
  );
  out.push("");
  return out;
}

function plantDetail(scored: ScoredRun): string[] {
  const out = ["### Planted cases", ""];

  out.push(
    "| plant | testable | expected flips | flipped | missed | survivors kept | over-retracted | correct |",
  );
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of scored.cascade.perPlant) {
    out.push(
      "| " +
        entry.plant +
        " | " +
        (entry.testable ? "yes" : "NO") +
        " | " +
        entry.expectedFlips.length +
        " | " +
        entry.flipped.length +
        " | " +
        entry.missedFlips.length +
        " | " +
        entry.survived.length +
        " | " +
        entry.overRetracted.length +
        " | " +
        (entry.correct ? "✓" : "✗") +
        " |",
    );
  }
  out.push("");

  if (scored.cascade.overRetractions > 0) {
    out.push("**Over-retractions** — each one is the demo-killer §7.4 names first:");
    out.push("");
    for (const entry of scored.cascade.perPlant) {
      for (const key of entry.overRetracted)
        out.push(
          "- " + entry.plant + " retracted `" + key + "`, which shares no falsified premise",
        );
    }
    out.push("");
  }

  if (scored.resolver.unresolvable.length > 0) {
    out.push(
      "**Plant keys with no runtime node** (" +
        scored.resolver.unresolvable.length +
        "). These plants are scored as",
      "FAILED rather than skipped — skipping would make cascade correctness improve as extraction worsens:",
    );
    out.push("");
    for (const key of scored.resolver.unresolvable) out.push("- " + key);
    out.push("");
  }

  out.push(
    "Contradiction records by gate: " +
      scored.contradiction.byGate.structural +
      " structural, " +
      scored.contradiction.byGate.semantic +
      " semantic, " +
      scored.contradiction.byGate.premise +
      " premise. Kantara diagnostics: " +
      scored.contradiction.m1Detections +
      " M1, " +
      scored.contradiction.m2Detections +
      " M2.",
  );
  out.push("");
  out.push(
    "Justifications carrying a non-empty OUT-list: " +
      scored.invalidation.outListPopulated +
      " of " +
      scored.invalidation.decisionsTotal +
      " decisions. Zero means the graph is monotonic and L2 cannot score.",
  );
  out.push("");

  if (scored.falsePositives.examples.length > 0) {
    out.push(
      "Unexpected interruptions (the false-positive numerator), first " +
        scored.falsePositives.examples.length +
        ":",
    );
    out.push("");
    for (const example of scored.falsePositives.examples) out.push("- " + example);
    out.push("");
  }

  return out;
}

function questionDetail(scored: ScoredRun): string[] {
  const out = [
    "### Questions",
    "",
    "| id | verdict | expected | groundedness | claims | searches | over budget |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of scored.groundedness.perQuestion) {
    out.push(
      "| " +
        entry.question +
        " | " +
        entry.verdict +
        " | " +
        entry.expectedVerdict +
        " | " +
        entry.groundedness.toFixed(2) +
        " | " +
        entry.groundedClaims +
        "/" +
        entry.claims +
        " | " +
        entry.searches +
        " | " +
        (entry.overBudget ? "YES" : "no") +
        " |",
    );
  }
  out.push("");

  out.push("| id | relevant expected | found in top 5 | first relevant rank |");
  out.push("| --- | --- | --- | --- |");
  for (const entry of scored.retrieval.perQuestion) {
    out.push(
      "| " +
        entry.question +
        " | " +
        entry.relevant.length +
        " | " +
        entry.relevantFound +
        " | " +
        (entry.firstRelevantRank === null ? "—" : String(entry.firstRelevantRank)) +
        " |",
    );
  }
  out.push("");
  return out;
}

function guardDetail(scored: ScoredRun): string[] {
  const out = ["### Guards", ""];
  out.push(
    "Precision is NOT MEASURED — a transcript corpus contains no repository state, so no violation could be",
    "seeded. See `docs/LIMITATIONS.md`. What is measurable:",
  );
  out.push("");
  out.push(
    "- synthesis rate: " +
      scored.guards.decisionsWithGuard +
      " of " +
      scored.guards.decisionsTotal +
      " decisions got a proposed guard",
  );
  out.push(
    "- determinism share: " +
      scored.guards.deterministic +
      " deterministic, " +
      scored.guards.judged +
      " `llm_judge`",
  );
  out.push("- skips counted as passes (must be 0): " + scored.guards.skippedCountedAsPass);
  out.push(
    "- guards auto-accepted without a human (must be 0, invariant I4): " +
      scored.guards.autoAccepted,
  );
  out.push(
    "- stale `disabledByDecisionLabel` flags (must be 0): " + scored.guards.staleDisabledFlags,
  );
  out.push("");
  return out;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const { corpus: resolved, load, engine, engineId } = prepare();

  banner("Generating the evaluation report");
  line(describeCorpus(resolved));
  blank();
  line(describeLoad(load));

  heading("Baseline run");
  const run = await runConfig(resolved, {
    id: "full",
    engine,
    engineId,
    toggles: FULL,
    params: DEFAULT_PARAMS,
  });
  line(
    "imported in " +
      (run.durationMs / 1000).toFixed(1) +
      "s · " +
      run.state.decisions.size +
      " decisions",
  );

  const scored = scoreAll(resolved, run, engineId);

  let study: AblationStudy | null = null;
  if (args.has("ablation")) {
    heading("Ablation study");
    study = await runAblation(resolved, { engine, engineId });
    line(describeStudy(study));
  }

  const hardened = harden(resolved, scored);
  const markdown = renderFullReport(resolved, scored, study, hardened);
  write(args.get("out") ?? "docs/generated/EVAL-REPORT.md", markdown);

  blank();
  line(
    "The report is generated. docs/EVALUATION.md quotes from it and never restates it, because two",
  );
  line(
    "copies of a number drift and a benchmark that disagrees with its own output is worse than none.",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    "\n" + (error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n",
  );
  process.exitCode = 1;
});
