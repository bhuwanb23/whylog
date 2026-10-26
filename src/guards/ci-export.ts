/**
 * CI export — 4.6.
 *
 * Phase 4 · sub-phase 4.6
 * Plan: plan/phase-4-executable-guards.md §4.6
 * Docs: docs/04-executable-decision-guards.md §5.2
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE MESSAGE IS THE PRODUCT
 *
 * Not "guard G-0007b failed". This:
 *
 *   ✗ WLD-0007 — Use SQLite, not Postgres
 *     Guard G-0007b (dependency_absent: pg) FAILED
 *     Evidence: "pg": "^8.11.3" found in package.json dependencies
 *     Decided: 2026-10-03 · Rests on: P-0002 single-user (IN), P-0005 no-deploy-infra (IN)
 *     Rejected alternative Postgres — reason: "deploy complexity"
 *
 *     → Is this a deliberate reversal?   whylog reverse WLD-0007 --to postgres
 *     → Or is this drift?                remove the dependency.
 *
 * That message does the job of an ADR, a code-review comment and an onboarding document, at the
 * exact moment it is useful — which is the moment someone has just installed the thing you
 * turned down six weeks ago and has no idea you turned it down.
 *
 * Everything it needs is embedded at export time: the decision, its premises with their labels
 * as they stood when the export was made, and the rejected alternatives with their reasons. A CI
 * job cannot query the log, so the log has to travel with the check.
 *
 * ---------------------------------------------------------------------------
 * SAME GUARD SET, SAME RESULTS
 *
 * §4.6's acceptance criterion. The exported runner evaluates the SAME six predicates as the
 * in-browser interpreter, over the same data, and the guard set is serialised as DATA rather
 * than regenerated — so the two cannot drift apart by having been written twice. The predicates
 * below are transcriptions of `eval/dependency.ts`, `eval/path.ts` and `eval/string.ts`,
 * including the word-boundary default and the dev-dependency asymmetry.
 *
 * What cannot be identical is the file discovery: the browser runs against a pasted virtual
 * project, CI against the real tree. That difference is the point of exporting, and it is why
 * the export carries the head hash — so a result can be tied to the log state that produced it.
 *
 * ---------------------------------------------------------------------------
 * BLOCKING FAILS THE BUILD; WARNING DOES NOT
 *
 * `blocking` failures exit non-zero. `warning` failures are printed as advisory and do not
 * affect the exit code, because a string pattern is far easier to match by accident than a
 * dependency entry is, and a build that fails on an accidental match gets its guard deleted
 * rather than its code fixed.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { Guard } from "@/types/guards";
import { isDeterministic } from "@/types/guards";
import { specTarget } from "./feedback";

/* -------------------------------------------------------------------------- */
/* What gets exported                                                         */
/* -------------------------------------------------------------------------- */

/** A guard plus everything the failure message needs, frozen at export time. */
export interface ExportedGuard {
  readonly id: string;
  readonly decisionId: string;
  readonly statement: string;
  readonly kind: Guard["spec"]["kind"];
  readonly target: string;
  readonly severity: Guard["severity"];
  readonly rationale: string;
  readonly spec: unknown;
  readonly decidedAt: string;
  readonly restsOn: readonly { id: string; text: string; label: string }[];
  readonly rejected: readonly { value: string; whyRejected: string | null }[];
  readonly appliesTo: readonly string[];
}

export interface CiExport {
  /** A standalone Node script. No dependencies beyond the standard library. */
  readonly runner: string;
  /** A GitHub Actions workflow running it on push and PR. */
  readonly workflow: string;
  readonly guards: readonly ExportedGuard[];
  /** Decisions whose guards were all non-deterministic, so nothing could be exported for them.
   *  Reported rather than silently omitted: an export that covers 8 of 12 decisions and does
   *  not say so is an export that looks like coverage. */
  readonly notExported: readonly { decisionId: DecisionId; reason: string }[];
  readonly headHash: string;
}

export interface CiExportInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly headHash: string;
  /** Export proposed guards too. Off by default: CI should run what a human accepted, and a
   *  proposed guard failing a build is the day-one wall of red §4.2 exists to prevent. */
  readonly includeProposed?: boolean;
}

export function exportCi(input: CiExportInput): CiExport {
  const guards: ExportedGuard[] = [];
  const notExported: { decisionId: DecisionId; reason: string }[] = [];
  const seenDecisions = new Set<DecisionId>();

  for (const guard of input.state.guards.values()) {
    if (guard.lifecycle === "deleted" || guard.lifecycle === "suppressed") continue;
    if (guard.lifecycle === "proposed" && input.includeProposed !== true) continue;

    const decision = input.state.decisions.get(guard.decisionId);
    if (decision === undefined) continue;

    /* A superseded or archived decision's guards are not exported: the log has withdrawn the
     * decision, and a CI job enforcing a withdrawn decision blocks work the log already
     * approved. */
    if (decision.status === "superseded" || decision.status === "archived") {
      seenDecisions.add(decision.id);
      notExported.push({
        decisionId: decision.id,
        reason: "the decision is " + decision.status + ", so its guards are withdrawn with it",
      });
      continue;
    }

    if (!isDeterministic(guard.spec.kind)) {
      notExported.push({
        decisionId: decision.id,
        reason:
          guard.spec.kind === "command_exit_zero"
            ? guard.id +
              " is a command guard — exported separately below, since CI is exactly where a command can run"
            : guard.id +
              " is judged by a model, so it is advisory and cannot fail a build deterministically",
      });

      /* Command guards CAN be exported: CI has a shell, which the browser does not. They are
       * emitted into the runner's command section rather than the deterministic section. */
      if (guard.spec.kind !== "command_exit_zero") continue;
    }

    seenDecisions.add(decision.id);
    guards.push(exportedGuardOf(input.state, input.labels, guard, decision));
  }

  return {
    runner: renderRunner(guards, input.headHash),
    workflow: renderWorkflow(guards.length),
    guards,
    notExported,
    headHash: input.headHash,
  };
}

function exportedGuardOf(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  guard: Guard,
  decision: Decision,
): ExportedGuard {
  const restsOn: { id: string; text: string; label: string }[] = [];
  const seen = new Set<string>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      restsOn.push({
        id: premiseId,
        text: premise.text,
        /* The label as it stood AT EXPORT TIME. A CI job runs later, against a tree that may
         * have moved; pretending the label is live would be a lie, and dating it is not. */
        label: labels.get(premiseId)?.label ?? premise.label,
      });
    }
  }

  const rejected: { value: string; whyRejected: string | null }[] = [];
  for (const alternativeId of decision.alternativeIds) {
    const alternative = state.alternatives.get(alternativeId);
    if (alternative === undefined) continue;
    rejected.push({ value: alternative.value, whyRejected: alternative.whyRejected ?? null });
  }

  return {
    id: guard.id,
    decisionId: decision.id,
    statement: decision.statement,
    kind: guard.spec.kind,
    target: specTarget(guard),
    severity: guard.severity,
    rationale: guard.rationale,
    spec: guard.spec,
    decidedAt: decision.temporal.valid.slice(0, 10),
    restsOn,
    rejected,
    appliesTo: decision.appliesTo,
  };
}

/* -------------------------------------------------------------------------- */
/* The runner                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A standalone Node script.
 *
 * Standard library only — `fs` and `path`. No dependency to install, no build step, no
 * framework: it has to run in a CI job that has just checked out a repository and nothing else.
 */
export function renderRunner(guards: readonly ExportedGuard[], headHash: string): string {
  const lines: string[] = [];

  lines.push("#!/usr/bin/env node");
  lines.push("/**");
  lines.push(" * WhyLog decision guards — generated. Do not edit by hand.");
  lines.push(" *");
  lines.push(" * Log head: " + headHash);
  lines.push(" * Guards:   " + guards.length);
  lines.push(" *");
  lines.push(" * Exits non-zero if any BLOCKING guard fails. Warning failures are printed");
  lines.push(" * as advice and do not affect the exit code.");
  lines.push(" *");
  lines.push(" * Re-export from the app after any change to the log: the guard set below is");
  lines.push(" * frozen at export time, and so are the premise labels in each failure message.");
  lines.push(" */");
  lines.push("");
  lines.push('const fs = require("node:fs");');
  lines.push('const path = require("node:path");');
  lines.push("");
  lines.push("const GUARDS = " + JSON.stringify(guards, null, 2) + ";");
  lines.push("");
  lines.push(RUNNER_BODY);

  return lines.join("\n");
}

/**
 * The evaluator, transcribed.
 *
 * Kept as one block of emitted source rather than generated line by line, because it has to be
 * readable by whoever debugs a CI failure at 2am — and generated-looking code is not.
 */
const RUNNER_BODY = `
/* ---------------------------------------------------------------- project -- */

function readManifest() {
  try {
    const raw = JSON.parse(fs.readFileSync("package.json", "utf8"));
    return {
      dependencies: raw.dependencies || {},
      devDependencies: raw.devDependencies || {},
    };
  } catch {
    return { dependencies: {}, devDependencies: {} };
  }
}

function listFiles(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full.split(path.sep).join("/"));
  }
  return out;
}

function readFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------- glob -- */
/* Transcribed from src/lib/glob.ts so results match the in-browser run.      */

function globToRegExpSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
        else { out += ".*"; i += 1; }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === ".") out += "\\\\.";
    else if ("+^$\{}|()[]".includes(c)) out += "\\\\" + c;
    else out += c;
  }
  return out;
}

function matchesGlob(p, glob) {
  return new RegExp("^" + globToRegExpSource(glob) + "$").test(p);
}

/* Word boundaries ON by default: a bare substring match on "pg" hits "pgp",   */
/* "pgsql-tools" and any passing mention in a comment.                        */
function compilePattern(pattern, wordBoundary, caseSensitive) {
  const escaped = pattern.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
  const source = wordBoundary === false ? escaped : "\\\\b" + escaped + "\\\\b";
  return new RegExp(source, caseSensitive ? "g" : "gi");
}

function findMatchInText(text, pattern, wordBoundary, caseSensitive) {
  const re = compilePattern(pattern, wordBoundary, caseSensitive);
  const lines = text.split("\\n");
  for (let i = 0; i < lines.length; i += 1) {
    re.lastIndex = 0;
    if (re.test(lines[i])) return { line: i + 1, text: lines[i].trim() };
  }
  return null;
}

/* ---------------------------------------------------------------- evaluate -- */

function evaluate(guard, project) {
  const spec = guard.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent": {
      /* Same asymmetry as the browser: an ABSENCE check covers devDependencies, because a
       * rejected package installed for tooling is still installed. A PRESENCE check does not,
       * because a build-only dependency does not mean the decision was implemented. */
      const includeDev = spec.includeDev === undefined
        ? spec.kind === "dependency_absent"
        : spec.includeDev;

      const inRuntime = project.dependencies[spec.package];
      const inDev = includeDev ? project.devDependencies[spec.package] : undefined;
      const version = inRuntime !== undefined ? inRuntime : inDev;
      const where = inRuntime !== undefined ? "dependencies" : "devDependencies";

      if (spec.kind === "dependency_present") {
        return version === undefined
          ? { outcome: "fail", evidence: '"' + spec.package + '" is not in package.json' + (includeDev ? " (checked dependencies and devDependencies)" : " (checked dependencies only)") }
          : { outcome: "pass", evidence: '"' + spec.package + '": "' + version + '" is present in ' + where };
      }
      return version !== undefined
        ? { outcome: "fail", evidence: '"' + spec.package + '": "' + version + '" found in package.json ' + where }
        : { outcome: "pass", evidence: '"' + spec.package + '" does not appear in package.json' };
    }

    case "path_glob_exists":
    case "path_glob_absent": {
      const matches = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (spec.kind === "path_glob_exists") {
        return matches.length === 0
          ? { outcome: "fail", evidence: "No file matches \`" + spec.glob + "\` among " + project.files.length + " path(s)" }
          : { outcome: "pass", evidence: matches.length + " file(s) match \`" + spec.glob + "\`: " + matches.slice(0, 6).join(", ") };
      }
      return matches.length > 0
        ? { outcome: "fail", evidence: matches.length + " file(s) match \`" + spec.glob + "\` but none should: " + matches.slice(0, 6).join(", ") }
        : { outcome: "pass", evidence: "No file matches \`" + spec.glob + "\`" };
    }

    case "string_in_files":
    case "string_absent_in_files": {
      const scoped = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (scoped.length === 0) {
        return { outcome: "skip", evidence: "no file matches the scope \`" + spec.glob + "\`" };
      }
      const wordBoundary = spec.wordBoundary === undefined ? true : spec.wordBoundary;
      const caseSensitive = spec.caseSensitive === undefined ? false : spec.caseSensitive;

      for (const file of scoped) {
        const text = readFile(file);
        if (text === undefined) continue;
        const hit = findMatchInText(text, spec.pattern, wordBoundary, caseSensitive);
        if (hit === null) continue;

        const where = file + ":" + hit.line;
        const quoted = JSON.stringify(hit.text.length > 160 ? hit.text.slice(0, 157) + "..." : hit.text);
        if (spec.kind === "string_absent_in_files") {
          return { outcome: "fail", evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted };
        }
        return { outcome: "pass", evidence: '"' + spec.pattern + '" found at ' + where + " — " + quoted };
      }

      if (spec.kind === "string_in_files") {
        return { outcome: "fail", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching \`" + spec.glob + "\`" };
      }
      return { outcome: "pass", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching \`" + spec.glob + "\`" };
    }

    case "command_exit_zero": {
      /* CI has a shell, which the browser does not. This is the one kind whose result can
       * legitimately differ between the two targets, and it is environment-dependent by
       * nature — which is why it is never \`blocking\` by default. */
      try {
        const { execSync } = require("node:child_process");
        execSync(spec.command, { stdio: "pipe", cwd: spec.cwd || "." });
        return { outcome: "pass", evidence: "\`" + spec.command + "\` exited 0" };
      } catch (error) {
        const out = (error.stdout || error.stderr || "").toString().trim().split("\\n")[0] || "";
        return { outcome: "fail", evidence: "\`" + spec.command + "\` exited non-zero" + (out ? ": " + out : "") };
      }
    }

    default:
      return { outcome: "skip", evidence: "kind " + spec.kind + " cannot run in CI without a model" };
  }
}

/* ----------------------------------------------------------------- report -- */
/* The failure message is the product. It does the job of an ADR, a code-review */
/* comment and an onboarding document, at the moment it is useful.             */

function reportFailure(guard, result) {
  const lines = [];
  lines.push("");
  lines.push("\\x1b[31m\\u2717 " + guard.decisionId + " \\u2014 " + guard.statement + "\\x1b[0m");
  lines.push("  Guard " + guard.id + " (" + guard.kind + ": " + guard.target + ") FAILED  [" + guard.severity + "]");
  lines.push("  Evidence: " + result.evidence);
  lines.push("  Why this check verifies that decision: " + guard.rationale);

  const premises = guard.restsOn.length === 0
    ? "nothing recorded"
    : guard.restsOn.map((p) => p.id + " " + p.text + " (" + p.label + ")").join(", ");
  lines.push("  Decided: " + guard.decidedAt + " \\u00b7 Rests on: " + premises);

  if (guard.restsOn.length === 0) {
    lines.push("    (no recorded premise, so nothing can falsify it \\u2014 a gap worth filling in WhyLog)");
  }

  for (const alt of guard.rejected) {
    lines.push("  Rejected alternative " + alt.value + (alt.whyRejected ? " \\u2014 reason: \\"" + alt.whyRejected + "\\"" : " \\u2014 no reason recorded"));
  }

  lines.push("");
  lines.push("  \\u2192 Is this a deliberate reversal?   Record it in WhyLog so the log stops claiming otherwise.");
  lines.push("  \\u2192 Or is this drift?                Undo the change: " + undoHint(guard));
  return lines.join("\\n");
}

function undoHint(guard) {
  switch (guard.kind) {
    case "dependency_absent": return "remove the \\"" + guard.target + "\\" dependency.";
    case "dependency_present": return "install \\"" + guard.target + "\\", or record the decision that replaced it.";
    case "path_glob_absent": return "remove the file(s) matching \\"" + guard.target + "\\".";
    case "path_glob_exists": return "restore the file(s) matching \\"" + guard.target + "\\".";
    case "string_absent_in_files": return "remove \\"" + guard.target + "\\" from the files in scope.";
    case "string_in_files": return "add \\"" + guard.target + "\\" where the decision expects it.";
    default: return "see the guard's rationale above.";
  }
}

/* -------------------------------------------------------------------- main -- */

/* \`--decision WLD-0007\` restricts the run to one decision's guards. The verify command exported */
/* into CLAUDE.md / AGENTS.md / DECISIONS.md uses exactly this flag, so an agent can check one    */
/* rule without running the whole set. It is supported HERE rather than by a second runner: two   */
/* runners would drift, and a verify command naming a flag the runner ignores would exit 0 for a  */
/* decision that is broken.                                                                       */
function parseArgs(argv) {
  const opts = { decision: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--decision" && argv[i + 1] !== undefined) { opts.decision = argv[i + 1]; i += 1; }
    else if (typeof argv[i] === "string" && argv[i].startsWith("--decision=")) { opts.decision = argv[i].slice(11); }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = readManifest();
  const files = listFiles(".");
  const project = { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, files: files };

  const selected = opts.decision === null ? GUARDS : GUARDS.filter((g) => g.decisionId === opts.decision);

  if (opts.decision !== null && selected.length === 0) {
    /* Exiting 0 here would tell an agent the decision is fine when the truth is that this runner
     * holds no guards for it — most likely because the export predates the decision. Exit 2 says
     * "I could not check this", which is a different claim from "it passed". */
    console.error("\x1b[31mNo guards in this runner for decision " + opts.decision + ".\x1b[0m");
    console.error("The exported runner is probably older than that decision. Re-export from WhyLog.");
    process.exit(2);
  }

  console.log("WhyLog decision guards \\u00b7 " + selected.length + " of " + GUARDS.length + " guard(s)" + (opts.decision === null ? "" : " for " + opts.decision) + " \\u00b7 " + files.length + " file(s) scanned");

  let blocking = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const guard of selected) {
    const result = evaluate(guard, project);

    if (result.outcome === "pass") { passed += 1; continue; }
    if (result.outcome === "skip") {
      skipped += 1;
      console.log("\\x1b[33m\\u2013 " + guard.id + " SKIPPED\\x1b[0m (" + guard.kind + ": " + guard.target + ") \\u2014 " + result.evidence);
      continue;
    }

    if (guard.severity === "blocking") blocking += 1;
    else warnings += 1;

    console.log(reportFailure(guard, result));
  }

  console.log("");
  console.log("  passed " + passed + " \\u00b7 failed " + (blocking + warnings) + " (" + blocking + " blocking, " + warnings + " warning) \\u00b7 skipped " + skipped);

  if (blocking > 0) {
    console.log("\\n\\x1b[31m" + blocking + " blocking decision guard(s) failed.\\x1b[0m");
    console.log("Each failure above names the decision, the premise it rests on, and what was rejected.");
    process.exit(1);
  }
  if (warnings > 0) {
    console.log("\\n" + warnings + " warning-level guard(s) failed \\u2014 advisory, build not blocked.");
  }
  process.exit(0);
}

main();
`;

/* -------------------------------------------------------------------------- */
/* The workflow                                                               */
/* -------------------------------------------------------------------------- */

export function renderWorkflow(guardCount: number): string {
  return [
    "# Generated by WhyLog. Runs the exported decision guards on every push and PR.",
    "# " + guardCount + " guard(s). Re-export from the app when the log changes.",
    "name: decision-guards",
    "",
    "on:",
    "  push:",
    "  pull_request:",
    "",
    "jobs:",
    "  guards:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 20",
    "",
    "      # No install step: the runner uses only the Node standard library.",
    "      - name: WhyLog decision guards",
    "        run: node .whylog/guards.cjs",
    "",
    "      # Advisory only. A guard is a lock on a decision, not a lint rule, so its",
    "      # failure is uploaded as an artifact for the PR rather than commented by a bot.",
    "      - name: Upload guard report on failure",
    "        if: failure()",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: whylog-guard-failures",
    "          path: .whylog/",
    "          if-no-files-found: ignore",
    "",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeExport(exported: CiExport): string {
  const kinds = new Map<string, number>();
  for (const guard of exported.guards) {
    kinds.set(guard.kind, (kinds.get(guard.kind) ?? 0) + 1);
  }

  const lines = [
    "Exported " +
      exported.guards.length +
      " guard(s) over " +
      new Set(exported.guards.map((g) => g.decisionId)).size +
      " decision(s).",
    "Log head: " + exported.headHash,
    "",
  ];

  for (const [kind, count] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push("  " + kind.padEnd(24) + count);
  }

  if (exported.notExported.length > 0) {
    lines.push("");
    lines.push("Not exported (" + exported.notExported.length + "):");
    for (const entry of exported.notExported.slice(0, 10)) {
      lines.push("  " + entry.decisionId + " — " + entry.reason);
    }
    if (exported.notExported.length > 10)
      lines.push("  … " + (exported.notExported.length - 10) + " more");
  }

  lines.push("");
  lines.push("Two files: `.whylog/guards.cjs` (standalone Node, standard library only) and");
  lines.push("`.github/workflows/decision-guards.yml`. Blocking failures exit non-zero; warnings");
  lines.push("are printed as advice and do not block the build.");

  return lines.join("\n");
}
