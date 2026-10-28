/**
 * `npm run readiness` — the one command that answers "is it ready?"
 *
 * Three questions, one exit code:
 *   1. HARD GATES  — does the project work?          → gates the exit code
 *   2. MEASURED    — how well does it work?          → reported, never gated
 *   3. KNOWN GAPS  — what's open, and what closes it → reported, never gated
 *
 * A low score is a result, not a defect. Gating on it is what made `verify:all`
 * (verify && eval && demo:verify) useless: `eval` exits 1 by design while
 * hardening stays NOT READY on a 12-transcript corpus.
 *
 * Ablation (fifteen configurations) is cached under docs/generated/ so the
 * daily path stays near a minute. Pass `--ablation` to force a fresh study.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { RUNNER_PATH } from "@/export/verify-command";
import {
  ABLATION_CACHE_PATH,
  type AblationCache,
  ablationCacheUsable,
  cacheFromStudy,
  readAblationCache,
  writeAblationCache,
} from "./ablation/cache";
import { type AblationStudy, describeStudy, runAblation } from "./ablation/run";
import { DEFAULT_PARAMS, FULL } from "./ablation/toggles";
import { blank, heading, line, prepare, readArgs, write } from "./cli";
import { CORPUS_VERSION } from "./corpus/data";
import { REQUIRED_DRY_RUNS, runDryRuns } from "./demo/dryrun";
import { buildSeed } from "./demo/kit";
import { type VerificationReport, verifyDemo } from "./demo/verify";
import { type HardeningReport, harden } from "./hardening";
import { describeFailures, runConfig } from "./harness";
import { type ScoredRun, renderSuite, scoreAll } from "./metrics";
import { renderFullReport } from "./report";

const EVAL_REPORT = "docs/generated/EVAL-REPORT.md";
const LLM_PATH_MARKER = "docs/generated/LLM-PATH-RUN.md";
const IAA_MARKER = "docs/generated/IAA.json";
const TARGET_CORPUS_SIZE = 30;
const WORKFLOW_PATH = ".github/workflows/decision-guards.yml";

interface GateResult {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

interface KnownGap {
  readonly id: string;
  readonly open: boolean;
  readonly closesWhen: string;
}

interface MeasuredBundle {
  readonly scored: ScoredRun;
  readonly hardened: HardeningReport;
  readonly ablation: AblationCache;
  readonly ablationSource: "fresh" | "cache";
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const forceAblation = args.has("ablation");
  const started = Date.now();

  process.stdout.write("\n" + "=".repeat(78) + "\n");
  process.stdout.write("WhyLog readiness — hard gates gate the exit; scores and gaps do not\n");
  process.stdout.write("=".repeat(78) + "\n");

  heading("1. HARD GATES");
  const gates = await runHardGates();
  for (const gate of gates) {
    line((gate.passed ? "   PASS  " : "   FAIL  ") + pad(gate.label, 20) + gate.detail);
  }
  const hardPassed = gates.every((gate) => gate.passed);
  line(
    hardPassed
      ? "   → All " + gates.length + " hard gates pass."
      : "   → " + gates.filter((g) => !g.passed).length + " hard gate(s) failing.",
  );

  heading("2. MEASURED");
  let measured: MeasuredBundle | null = null;
  try {
    measured = await runMeasured(forceAblation);
    printMeasured(measured);
  } catch (error: unknown) {
    line(
      "   MEASURED suite threw — reported, not gated: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  heading("3. KNOWN GAPS");
  const gaps = measured === null ? [] : evaluateGaps(measured);
  if (measured === null) {
    line("   (skipped — measured suite did not complete)");
  } else {
    const open = gaps.filter((gap) => gap.open);
    const closed = gaps.filter((gap) => !gap.open);
    for (const gap of gaps) {
      line(
        (gap.open ? "   OPEN  " : "   PASS  ") + pad(gap.id, 22) + "closes when " + gap.closesWhen,
      );
    }
    blank();
    line(
      "   " +
        open.length +
        " open · " +
        closed.length +
        " closed. Gaps never fail the build; they flip to PASS when their closing condition holds.",
    );
  }

  const buildReady = gates
    .filter((gate) => !gate.id.startsWith("demo"))
    .every((gate) => gate.passed);
  const demoReady = gates.filter((gate) => gate.id.startsWith("demo")).every((gate) => gate.passed);
  const openGaps = gaps.filter((gap) => gap.open);
  const benchmarkReady = measured !== null && openGaps.length === 0;

  heading("VERDICT");
  line("   build-ready           " + (buildReady ? "YES" : "NO"));
  line("   demo-ready            " + (demoReady ? "YES" : "NO"));
  line(
    "   benchmark-defensible  " +
      (benchmarkReady ? "YES" : "NO") +
      (benchmarkReady ? "" : "    " + openGaps.length + " known gap(s) open"),
  );
  blank();
  line(
    "Exit " +
      (hardPassed ? "0" : "1") +
      ". Hard gates only. ~" +
      Math.round((Date.now() - started) / 1000) +
      " s.",
  );
  if (!hardPassed) {
    blank();
    line("Fix failing hard gates before reading scores or gaps.");
  }

  process.exitCode = hardPassed ? 0 : 1;
}

/* -------------------------------------------------------------------------- */
/* Hard gates                                                                 */
/* -------------------------------------------------------------------------- */

async function runHardGates(): Promise<readonly GateResult[]> {
  const typecheck = runNpm("typecheck");
  /* Same Biome gate as `npm run verify` (`check`), labelled "lint" in the report. */
  const lint = runNpm("check");
  const structure = runNpm("check:structure");
  const tests = runNpm("test");
  const build = runNpm("build");

  const demo = await runDemoGates();
  const guards = runGuardGate();

  return [
    {
      id: "typecheck",
      label: "typecheck",
      passed: typecheck.ok,
      detail: typecheck.ok
        ? "0 errors across src/ + tests/ + scripts/"
        : summarizeFailure(typecheck.stdout + "\n" + typecheck.stderr, "tsc failed"),
    },
    {
      id: "lint",
      label: "lint",
      passed: lint.ok,
      detail: lint.ok ? describeLint(lint.stdout + lint.stderr) : "biome lint failed",
    },
    {
      id: "structure",
      label: "structure",
      passed: structure.ok,
      detail: structure.ok
        ? (firstMatching(structure.stdout, /\d+ source files.*/) ?? "ok")
        : summarizeFailure(structure.stdout + "\n" + structure.stderr, "structure check failed"),
    },
    {
      id: "tests",
      label: "tests",
      passed: tests.ok,
      detail: tests.ok ? describeTests(tests.stdout + tests.stderr) : "vitest failed",
    },
    demo.giveable,
    demo.deterministic,
    guards,
    {
      id: "build",
      label: "production build",
      passed: build.ok,
      detail: build.ok
        ? "bundle written to dist/"
        : summarizeFailure(build.stdout + "\n" + build.stderr, "vite build failed"),
    },
  ];
}

async function runDemoGates(): Promise<{ giveable: GateResult; deterministic: GateResult }> {
  try {
    const seed = await buildSeed();
    const report = verifyDemo(seed);
    const dry = await runDryRuns(REQUIRED_DRY_RUNS);

    return {
      giveable: {
        id: "demo-giveable",
        label: "demo is giveable",
        passed: report.demoable,
        detail: describeDemoable(report),
      },
      deterministic: {
        id: "demo-deterministic",
        label: "demo deterministic",
        passed: dry.passed,
        detail: dry.deterministic
          ? REQUIRED_DRY_RUNS + " consecutive runs identical"
          : (dry.divergences[0] ?? "dry runs diverged or failed"),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      giveable: {
        id: "demo-giveable",
        label: "demo is giveable",
        passed: false,
        detail: message,
      },
      deterministic: {
        id: "demo-deterministic",
        label: "demo deterministic",
        passed: false,
        detail: "not run — seed failed",
      },
    };
  }
}

function runGuardGate(): GateResult {
  const result = runNpm("guards:ci", ["--include-proposed"]);
  const runnerExists = existsSync(resolvePath(process.cwd(), RUNNER_PATH));
  const workflowExists = existsSync(resolvePath(process.cwd(), WORKFLOW_PATH));
  const emitted = runnerExists && workflowExists;
  const passed = result.ok && emitted;
  const detail = passed
    ? "runner + workflow emitted, hash chain verified"
    : !result.ok
      ? summarizeFailure(result.stdout + "\n" + result.stderr, "guards:ci failed")
      : "runner or workflow missing after export";
  return { id: "guards", label: "guard runner", passed, detail };
}

/* -------------------------------------------------------------------------- */
/* Measured                                                                   */
/* -------------------------------------------------------------------------- */

async function runMeasured(forceAblation: boolean): Promise<MeasuredBundle> {
  const { corpus: resolved, engine, engineId } = prepare();

  const run = await runConfig(resolved, {
    id: "full",
    engine,
    engineId,
    toggles: FULL,
    params: DEFAULT_PARAMS,
  });
  line("   baseline   " + describeFailures(run));
  line(
    "              " +
      run.state.decisions.size +
      " decisions · " +
      run.state.premises.size +
      " premises · " +
      (run.durationMs / 1000).toFixed(1) +
      "s",
  );

  const scored = scoreAll(resolved, run, engineId);
  const hardened = harden(resolved, scored);

  let study: AblationStudy | null = null;
  const cached = readAblationCache();
  const cacheUsable = !forceAblation && ablationCacheUsable(cached, CORPUS_VERSION);

  let ablation: AblationCache;
  let ablationSource: "fresh" | "cache";

  if (cacheUsable) {
    ablation = cached;
    ablationSource = "cache";
    line(
      "   ablation   cache " +
        ABLATION_CACHE_PATH +
        " · ran " +
        ablation.ranAt +
        " (pass --ablation to refresh)",
    );
  } else {
    line(
      forceAblation
        ? "   ablation   refreshing (--ablation)"
        : "   ablation   no usable cache — running full study once",
    );
    study = await runAblation(resolved, { engine, engineId });
    line("              " + (describeStudy(study).split("\n")[0] ?? "study complete"));
    ablation = cacheFromStudy(study);
    writeAblationCache(ablation);
    ablationSource = "fresh";
  }

  write(
    EVAL_REPORT,
    renderFullReport(resolved, scored, study, hardened, study === null ? ablation : null),
  );

  return { scored, hardened, ablation, ablationSource };
}

function printMeasured(bundle: MeasuredBundle): void {
  blank();
  for (const row of renderSuite(bundle.scored).split("\n")) {
    line("   " + row);
  }
  blank();
  const killersPass = bundle.hardened.killers.length - bundle.hardened.killersFailing;
  line(
    "   demo-killers " +
      killersPass +
      "/" +
      bundle.hardened.killers.length +
      " · mechanical checks " +
      bundle.hardened.mechanicalFailing +
      " of " +
      bundle.hardened.mechanicalTotal +
      " failing",
  );
  line(
    "   ablation: confirmed " +
      bundle.ablation.confirmed +
      " · FALSIFIED " +
      bundle.ablation.falsified +
      " · below floor " +
      bundle.ablation.belowFloor +
      " · untestable " +
      bundle.ablation.untestable +
      " · NOT WIRED " +
      bundle.ablation.notWired +
      (bundle.ablationSource === "cache" ? "  (cached)" : ""),
  );
}

/* -------------------------------------------------------------------------- */
/* Known gaps                                                                 */
/* -------------------------------------------------------------------------- */

function evaluateGaps(bundle: MeasuredBundle): readonly KnownGap[] {
  const { scored, hardened, ablation } = bundle;
  const killer = (id: string) => hardened.killers.find((entry) => entry.id === id);

  const refusalsOk =
    scored.groundedness.refusalsExpected > 0 &&
    scored.groundedness.refusalsCorrect === scored.groundedness.refusalsExpected;

  const hypotheticalsOk = (killer("hypotheticals-as-nodes")?.passes ?? false) === true;

  const l2l3Testable = scored.cascade.perPlant.every((plant) => plant.testable);

  const guardMeasured = (scored.metrics.find((m) => m.id === "guard-precision")?.n ?? 0) > 0;

  const corpusSized = scored.run.transcripts.length >= TARGET_CORPUS_SIZE;

  const llmPathRun = existsSync(resolvePath(process.cwd(), LLM_PATH_MARKER));
  const independentLabels = existsSync(resolvePath(process.cwd(), IAA_MARKER));

  const moreNeeded = Math.max(0, TARGET_CORPUS_SIZE - scored.run.transcripts.length);

  return [
    {
      id: "G6 / phase-7.3",
      open: !ablation.hypothesisResolved,
      closesWhen: "the ablation confirms or falsifies ≥1 declared hypothesis",
    },
    {
      id: "guard-precision",
      open: !guardMeasured,
      closesWhen: "a fixture repository with seeded violations exists",
    },
    {
      id: "refusal",
      open: !refusalsOk,
      closesWhen:
        "extraction precision improves enough that unanswerable questions stop matching a variable",
    },
    {
      id: "hypotheticals",
      open: !hypotheticalsOk,
      closesWhen: "0 labelled declines become nodes",
    },
    {
      id: "l2-l3-untestable",
      open: !l2l3Testable,
      closesWhen: "a plant targets a premise the extractor actually produces",
    },
    {
      id: "llm-path",
      open: !llmPathRun,
      closesWhen: "npm run eval has run against a real model with a key",
    },
    {
      id: "corpus-size",
      open: !(corpusSized && independentLabels),
      closesWhen: moreNeeded + " more transcripts, labelled by someone who isn't the author",
    },
    {
      id: "author-labels",
      open: !independentLabels,
      closesWhen: "inter-annotator agreement published at " + IAA_MARKER,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Process helpers                                                            */
/* -------------------------------------------------------------------------- */

interface NpmResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function runNpm(script: string, extra: readonly string[] = []): NpmResult {
  /* Windows needs `shell: true` to resolve npm.cmd; pass a single command string so
   * args are not concatenated unsafely under DEP0190. */
  const command =
    extra.length === 0 ? "npm run " + script : "npm run " + script + " -- " + extra.join(" ");
  const result = spawnSync(command, {
    encoding: "utf8",
    shell: true,
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function describeLint(output: string): string {
  const warnings = output.match(/Found (\d+) warning/i);
  const errors = output.match(/Found (\d+) error/i);
  const warnCount = warnings ? warnings[1] : "0";
  const errCount = errors ? errors[1] : "0";
  return errCount + " errors, " + warnCount + " warnings (all deliberate — STRUCTURE.md §18.12)";
}

function describeTests(output: string): string {
  const tests = output.match(/Tests\s+(\d+)\s+passed/i);
  const files = output.match(/Test Files\s+(\d+)\s+passed/i);
  if (tests && files) {
    return tests[1] + " passed across " + files[1] + " files";
  }
  if (tests) return tests[1] + " passed";
  return "vitest ok";
}

function describeDemoable(report: VerificationReport): string {
  return (
    report.verified +
    " verified · " +
    report.manual +
    " manual · " +
    report.failed +
    " FAILED · " +
    (report.demoable ? "DEMOABLE" : "NOT DEMOABLE")
  );
}

function pad(text: string, width: number): string {
  return text.length >= width ? text + " " : text + " ".repeat(width - text.length);
}

function firstMatching(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[0].trim() : null;
}

function summarizeFailure(output: string, fallback: string): string {
  const interesting = output
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(
      (row) =>
        row.length > 0 && !row.startsWith(">") && !row.startsWith("npm ") && !/^whylog@/.test(row),
    );
  const errorLine =
    interesting.find((row) => /error TS\d+/i.test(row)) ??
    interesting.find((row) => /error/i.test(row)) ??
    interesting[0];
  if (errorLine === undefined) return fallback;
  return errorLine.length > 100 ? errorLine.slice(0, 97) + "..." : errorLine;
}

main().catch((error: unknown) => {
  process.stderr.write(
    "\n" + (error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n",
  );
  process.exitCode = 1;
});
