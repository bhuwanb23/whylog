/**
 * Shared CLI plumbing for the three eval entry points.
 *
 * Phase 7 · sub-phase 7.2
 *
 * Kept apart from the scoring modules on purpose. `metrics/*` and `ablation/*` are pure: they take a
 * corpus and a run and return numbers, with no process, no filesystem and no console. Only this file
 * and the three entry points touch the outside world, which is what makes the suite importable from the
 * browser build later without dragging Node's `process` into a Vite bundle.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { createLocalEngine, localEngineId } from "@/ai/local";
import type { WhyLogEngine } from "@/ai/types";
import type { EngineId } from "@/types/common";
import { CORPUS_ROOT, corpus } from "./corpus/data";
import { describeCorpus } from "./corpus/labels";
import type { ResolvedCorpus } from "./corpus/labels";
import { type LoadReport, describeLoad, loadCorpus } from "./corpus/loader";

export interface CliContext {
  readonly corpus: ResolvedCorpus;
  readonly load: LoadReport;
  readonly engine: WhyLogEngine;
  readonly engineId: EngineId;
}

/**
 * Load the corpus and pick an engine.
 *
 * Exits non-zero when labels fail to resolve. A corpus with unresolved quotes produces metrics whose
 * denominators are wrong for a reason invisible in the output, and continuing would publish numbers that
 * look fine and are not. Stopping is the only behaviour that keeps the report trustworthy.
 */
export function prepare(): CliContext {
  const load = loadCorpus(corpus, CORPUS_ROOT);

  banner("DecisionMemEval " + corpus.version);
  line(describeCorpus(corpus));
  blank();
  line(describeLoad(load));

  if (load.missingFiles.length > 0) {
    blank();
    line("ABORTING: " + load.missingFiles.length + " transcript file(s) are missing from disk.");
    line("A metric computed over a partial corpus is not a smaller metric, it is a different one.");
    process.exitCode = 1;
    throw new Error("missing transcript files");
  }

  if (load.unresolved.length > 0) {
    blank();
    line(
      "ABORTING: " +
        load.unresolved.length +
        " label(s) quote text that is not in their transcript.",
    );
    line(
      "Fix the corpus before scoring. The quotes are the ground truth; a quote that does not match is",
    );
    line(
      "a ground truth that does not exist, and every recall number computed against it is wrong.",
    );
    process.exitCode = 1;
    throw new Error("unresolved corpus labels");
  }

  /* The local engine, always. The whole benchmark runs keyless by design: a number that requires an API
   * key to reproduce is not a number a judge can check, and §7.5 lists keyless verification as a demo
   * requirement for the same reason. */
  return { corpus: load.corpus, load, engine: createLocalEngine(), engineId: localEngineId() };
}

export function banner(text: string): void {
  const rule = "=".repeat(Math.max(text.length, 78));
  process.stdout.write("\n" + rule + "\n" + text + "\n" + rule + "\n");
}

export function heading(text: string): void {
  process.stdout.write("\n--- " + text + " " + "-".repeat(Math.max(0, 72 - text.length)) + "\n");
}

export function line(text: string): void {
  process.stdout.write(text + "\n");
}

export function blank(): void {
  process.stdout.write("\n");
}

export function write(filePath: string, contents: string): void {
  const absolute = resolvePath(process.cwd(), filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
  line("wrote " + filePath + " (" + contents.length.toLocaleString("en-US") + " bytes)");
}

/** A `--flag value` reader. Unknown flags are reported rather than ignored, because a typo'd flag that
 *  silently falls back to a default produces a run the operator believes was configured differently. */
export function readArgs(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out.set(key, next);
      i += 1;
    } else {
      out.set(key, "true");
    }
  }

  const known = new Set(["out", "json", "engine", "only", "quick"]);
  for (const key of out.keys()) {
    if (!known.has(key))
      line("note: unknown flag --" + key + " ignored (known: " + [...known].join(", ") + ")");
  }

  return out;
}
