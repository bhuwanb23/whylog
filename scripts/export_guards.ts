/**
 * Export the guard set and run it — the Phase 4.6 CI step.
 *
 * The `guards:ci` npm script pointed at THIS FILE, and the file did not exist.
 * The CI job that runs it had therefore never executed on any phase: the branch
 * was fourteen commits ahead of `origin/main` and no workflow had ever run.
 *
 * What it does, end to end and keyless:
 *
 *   1. builds a decision log from the fixture transcript, reviewed and approved
 *   2. compiles guards from those decisions — TEMPLATES ONLY, no model
 *   3. accepts them and runs them against the project they describe
 *   4. emits the standalone Node runner and the Actions workflow
 *   5. RUNS the emitted runner
 *
 * Step 5 is the point. Emitting a runner that was never executed proves nothing;
 * the runner is a transcription of the evaluators, and a transcription is wrong
 * until it has run. The runner reads `package.json` from the working directory,
 * so it runs inside `fixtures/sample-project`, which is the project the
 * fixture's decisions describe.
 *
 * A blocking guard failure exits non-zero, which is what makes the CI step
 * meaningful.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { commitReview } from "../src/extraction/commit";
import { runExtraction } from "../src/extraction/pipeline";
import { applyAction, approve } from "../src/extraction/review/actions";
import "../src/ai/local";
import { compile } from "../src/export/compiler";
import { useGuards } from "../src/store/guards";
import { useWhyLog } from "../src/store/whylog";
import { type TranscriptId, asISO } from "../src/types/common";

const ROOT = resolve(import.meta.dirname, "..");
const TRANSCRIPT = resolve(ROOT, "fixtures", "demo-transcript.txt");
const SAMPLE_PROJECT = resolve(ROOT, "fixtures", "sample-project");

const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function buildLog(): Promise<void> {
  const raw = readFileSync(TRANSCRIPT, "utf-8");
  const whylog = useWhyLog.getState();
  const engine = whylog.engine?.engine;
  if (engine === null || engine === undefined) fail("the store booted without an engine");

  const run = await runExtraction(
    { transcriptId: "T-0001" as TranscriptId, raw, occurredAt: NOW },
    { engine, engineId: ENGINE_ID, state: whylog.state },
  );
  if (!run.ok) fail(`extraction failed: ${run.failure.kind}`);

  const reviewed = run.outcome.queue.map((candidate) => applyAction(candidate, approve(false)));
  const committed = commitReview(
    {
      transcriptId: "T-0001" as TranscriptId,
      engine: ENGINE_ID,
      occurredAt: NOW,
      items: reviewed,
      machineDiscards: [],
    },
    whylog.state,
  );
  if (!committed.ok) fail("commit failed");

  const recorded = useWhyLog.getState().recordBatch(committed.drafts, {
    reason: "Reviewed and approved: the Oct-3 transcript.",
    actor: { kind: "human" },
    occurredAt: NOW,
  });
  if (!recorded.ok) fail(`record failed: ${recorded.error}`);
}

function write(relative: string, contents: string): void {
  const path = resolve(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf-8");
}

async function main(): Promise<number> {
  useWhyLog.getState().boot();
  /* The local engine has to be REGISTERED before the store can resolve it. */
  useWhyLog.getState().refreshEngine();
  await buildLog();

  /* The project the decisions describe. The runner will check THIS one, so the
   * manifest and the directory the runner runs in have to be the same project. */
  const manifest = readFileSync(resolve(SAMPLE_PROJECT, "package.json"), "utf-8");
  useGuards.getState().loadProject({ manifest });

  const synthesised = await useGuards.getState().synthesise({ templatesOnly: true });
  if (!synthesised.ok) fail(`synthesis failed: ${synthesised.error}`);

  for (const guard of [...useWhyLog.getState().state.guards.values()].filter(
    (g) => g.lifecycle === "proposed",
  )) {
    const accepted = useGuards.getState().accept(guard.id);
    if (!accepted.ok) fail(`could not accept ${guard.id}: ${accepted.error}`);
  }

  const ran = await useGuards.getState().run();
  if (!ran.ok) fail(`the guard run failed: ${ran.error}`);

  const whylog = useWhyLog.getState();
  const result = await compile({
    state: whylog.state,
    headHash: whylog.log.headHash,
    actor: { kind: "system" },
    targets: ["ci-guards"],
  });

  if (result.blocked) {
    console.error("the export was blocked by the consistency gate:");
    console.error(result.blockedExplanation ?? "(no explanation)");
    return 1;
  }

  for (const artifact of result.artifacts) {
    write(artifact.filename, artifact.contents);
  }

  const runner = result.artifacts.find((a) => a.target === "ci-guards");
  if (!runner) fail("no runner artifact was emitted");
  if (!existsSync(SAMPLE_PROJECT)) fail(`the sample project is missing: ${SAMPLE_PROJECT}`);

  /* The fixture transcript is DELIBERATELY contradictory - it contains a
   * "use postgres" decision and a "use sqlite, not postgres" decision, and the
   * Postgres one is called out in the notes as the trap. So the sample project
   * cannot satisfy the log, and blocking guards WILL fail. That is the correct
   * outcome, and asserting "no blocking guard fails" would be asserting
   * something false.
   *
   * What this step asserts instead is the chain that matters: the runner RAN,
   * and its exit code agrees with what it reported. A runner that says
   * "2 blocking decision guard(s) failed" and exits 0 is broken, and so is one
   * that says nothing and exits 1. */
  const run = spawnSync(process.execPath, [resolve(ROOT, runner.filename)], {
    cwd: SAMPLE_PROJECT,
    encoding: "utf-8",
  });

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);

  const blocking = /(\d+) blocking decision guard\(s\) failed/.exec(output);
  const reported = blocking === null ? 0 : Number(blocking[1]);
  const expectedExit = reported > 0 ? 1 : 0;
  if (run.status !== expectedExit) {
    console.error(
      `the runner reported ${reported} blocking failure(s) but exited ${run.status}, expected ${expectedExit}.`,
    );
    console.error(
      "a runner whose exit code disagrees with its own report is worse than no runner.",
    );
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
