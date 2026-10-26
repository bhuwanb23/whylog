/**
 * `npm run guards:ci` — emit the standalone guard runner and its GitHub Actions workflow.
 *
 * Phase 4.6 / Phase 5, entry point. Written in Phase 7's gap pass: `package.json` and
 * `.github/workflows/ci.yml` both pointed at this file and it did not exist, so the CI `guards` job and
 * every verify command Phase 5 exported were invoking a script that was never there.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FILE FROM `guards/ci-export.ts`
 *
 * `ci-export.ts` is pure: state in, strings out. This file is the edge — it reads a log, folds it,
 * labels it, writes two files and exits non-zero on a problem. Keeping the two apart means the export
 * logic stays importable from the browser build, which cannot touch `node:fs`.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE GRAPH COMES FROM
 *
 * Node has no `localStorage`, so the authoritative log cannot be read the way the app reads it. Two
 * sources, in priority order:
 *
 *   1. `--log <file>` — a portable log exported from the app's Export view (`substrate/portability.ts`).
 *      This is the real path: it is the user's actual decision graph, hash chain and all.
 *   2. No `--log` — the demo seed, built from `fixtures/demo-transcript*.txt` through the eval harness.
 *      This exists so `npm run guards:ci` works on a fresh clone and CI is green out of the box, which
 *      is the difference between a workflow somebody keeps and one someone deletes.
 *
 * Source 2 is a DEMONSTRATION and the output says so. A CI job verifying the demo fixtures is not
 * verifying your project, and a runner that did not announce that would be worse than no runner.
 * ---------------------------------------------------------------------------
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { createLocalEngine, localEngineId } from "../src/ai/local";
import { RUNNER_PATH } from "../src/export/verify-command";
import { describeExport, exportCi } from "../src/guards/ci-export";
import { monotonicNow, nowISO } from "../src/lib/format";
import { label } from "../src/reasoning/labeller";
import { fold } from "../src/substrate";
import { describeRejection, importLog } from "../src/substrate/portability";
import type { ISODateString } from "../src/types/common";
import type { AnyEvent } from "../src/types/events";

/* `RUNNER_PATH` is imported from `export/verify-command.ts` rather than repeated here. That module
 * emits verify commands naming this exact path, so a second copy of the string is a second place for
 * it to drift — and a verify command pointing at a file that was written somewhere else fails in CI
 * with a "module not found" that looks like a broken runner rather than a mismatched constant. */
const WORKFLOW_PATH = ".github/workflows/decision-guards.yml";

interface Args {
  readonly log: string | null;
  readonly includeProposed: boolean;
  readonly out: string;
  readonly dryRun: boolean;
  readonly quiet: boolean;
}

function readArgs(argv: readonly string[]): Args {
  let log: string | null = null;
  let includeProposed = false;
  let out = ".";
  let dryRun = false;
  let quiet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--log") {
      log = argv[i + 1] ?? null;
      i += 1;
    } else if (token === "--out") {
      out = argv[i + 1] ?? ".";
      i += 1;
    } else if (token === "--include-proposed") {
      includeProposed = true;
    } else if (token === "--dry-run") {
      dryRun = true;
    } else if (token === "--quiet") {
      quiet = true;
    } else if (token !== undefined && token.startsWith("--")) {
      process.stderr.write(
        "unknown flag " + token + " (known: --log --out --include-proposed --dry-run --quiet)\n",
      );
    }
  }

  return { log, includeProposed, out, dryRun, quiet };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const say = (text: string): void => {
    if (!args.quiet) process.stdout.write(text + "\n");
  };

  const engine = createLocalEngine();
  const engineId = localEngineId();
  const started = monotonicNow();

  /* ---- obtain the graph ---- */
  let events: readonly AnyEvent[];
  let headHash: string;
  let source: string;

  if (args.log !== null) {
    const path = resolvePath(process.cwd(), args.log);
    if (!existsSync(path)) {
      process.stderr.write("no such log file: " + args.log + "\n");
      process.stderr.write(
        "Export one from the app's Export view (JSON), then re-run with --log <file>.\n",
      );
      process.exitCode = 1;
      return;
    }

    const raw = readFileSync(path, "utf8");
    const imported = importLog(raw, { existingIds: null, existingHeadHash: "" });

    if (!imported.ok) {
      process.stderr.write("the log was REJECTED: " + describeRejection(imported.rejection) + "\n");
      process.stderr.write(
        "A broken hash chain is refused rather than repaired. Exporting guards from a log whose history " +
          "cannot be verified would stamp a digest over events nobody can trust, and the stamp is the only " +
          "thing telling a reader the runner matches the graph.\n",
      );
      process.exitCode = 1;
      return;
    }

    /* `newEvents` are already sealed and deduplicated against an empty log, so with `existingIds: null`
     * this is the whole file. `headHashAfter` is the chain head the digest must cover. */
    events = imported.outcome.newEvents;
    headHash = imported.outcome.headHashAfter;
    source =
      args.log +
      " (" +
      imported.outcome.totalInFile +
      " event(s), " +
      imported.outcome.duplicates +
      " duplicate(s) skipped)";
  } else {
    say("no --log given: building the DEMO seed from fixtures/demo-transcript*.txt");
    say("a CI job verifying the demo fixtures is not verifying your project.\n");

    const seed = await buildDemoSeed(engine, engineId);
    events = seed.state.events;
    headHash = seed.headHash;
    source = "demo seed (fixtures/demo-transcript*.txt)";
  }

  /* ---- fold, label, export ---- */
  const at = nowISO() as ISODateString;
  const state = fold(events, { engine: engineId, now: at });
  const labelled = label(state);

  const exported = exportCi({
    state,
    labels: labelled.labels,
    headHash,
    ...(args.includeProposed ? { includeProposed: true } : {}),
  });

  say(describeExport(exported));
  say("");
  say("source graph: " + source);
  say("head hash:    " + exported.headHash);
  say("decisions:    " + state.decisions.size + " · guards in graph: " + state.guards.size);
  say("exported:     " + exported.guards.length + " guard(s)");

  if (exported.notExported.length > 0) {
    say("");
    say(
      "NOT EXPORTED (" + exported.notExported.length + ") — reported rather than silently omitted,",
    );
    say(
      "because an export covering 8 of 12 decisions that does not say so looks like full coverage:",
    );
    for (const entry of exported.notExported) say("  " + entry.decisionId + " · " + entry.reason);
  }

  if (exported.guards.length === 0) {
    say("");
    say("ZERO GUARDS EXPORTED.");
    say(
      "Guards are PROPOSED, never auto-installed (invariant I4), so a graph nobody has accepted any",
    );
    say(
      "guard for exports nothing. That is correct behaviour, not a failure — but a CI job with no",
    );
    say(
      "checks is a CI job that always passes, so pass --include-proposed if you want the proposals",
    );
    say("run in CI, or accept guards in the app's Guards view first.");
    if (!args.includeProposed) process.exitCode = 0;
  }

  if (args.dryRun) {
    say("");
    say("--dry-run: nothing written.");
    say(
      "would write " +
        RUNNER_PATH +
        " (" +
        exported.runner.length.toLocaleString("en-US") +
        " bytes)",
    );
    say(
      "would write " +
        WORKFLOW_PATH +
        " (" +
        exported.workflow.length.toLocaleString("en-US") +
        " bytes)",
    );
    return;
  }

  /* ---- write ---- */
  write(resolvePath(process.cwd(), args.out, RUNNER_PATH), exported.runner, say);
  write(resolvePath(process.cwd(), args.out, WORKFLOW_PATH), exported.workflow, say);

  say("");
  say("done in " + (monotonicNow() - started).toFixed(0) + "ms.");
  say("");
  say(
    "The runner is standalone Node with no dependencies beyond the standard library, so it can be",
  );
  say("committed and run by CI without installing this project. Verify one decision with:");
  say("");
  say("  node " + RUNNER_PATH + " --decision WLD-0001");
  say("");
  say(
    "The digest stamped into it covers the guard set and this head hash. If the graph changes, re-run",
  );
  say(
    "this command — a runner whose digest no longer matches the graph is a check that has drifted from",
  );
  say(
    "the decision it was compiled from, which is the exact failure mode guards exist to prevent.",
  );
}

/** Build the demo graph through the same harness the benchmark uses, so the exported guards come from
 *  the real pipeline rather than from a second, simpler import path that would eventually disagree. */
async function buildDemoSeed(
  engine: ReturnType<typeof createLocalEngine>,
  engineId: ReturnType<typeof localEngineId>,
) {
  const { corpus, CORPUS_ROOT } = await import("../src/eval/corpus/data");
  const { loadCorpus } = await import("../src/eval/corpus/loader");
  const { runConfig } = await import("../src/eval/harness");
  const { FULL, DEFAULT_PARAMS } = await import("../src/eval/ablation/toggles");

  const loaded = loadCorpus(corpus, CORPUS_ROOT);
  const demoOnly = {
    ...loaded.corpus,
    transcripts: loaded.corpus.transcripts.filter(
      (transcript) => transcript.id === "demo1" || transcript.id === "demo2",
    ),
    questions: [],
    plants: [],
  };

  const run = await runConfig(demoOnly, {
    id: "guards-ci-seed",
    engine,
    engineId,
    toggles: FULL,
    params: DEFAULT_PARAMS,
  });

  return { state: run.state, headHash: run.state.headHash };
}

function write(path: string, contents: string, say: (text: string) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  say("wrote " + path + " (" + contents.length.toLocaleString("en-US") + " bytes)");
}

main().catch((error: unknown) => {
  process.stderr.write(
    "\n" + (error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n",
  );
  process.exitCode = 1;
});
