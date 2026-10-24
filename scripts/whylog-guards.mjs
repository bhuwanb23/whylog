#!/usr/bin/env node
/**
 * WhyLog decision guards — generated. Do not edit by hand.
 *
 * Log head: 3024af0f082bfa
 * Guards:   0
 *
 * Exits non-zero if any BLOCKING guard fails. Warning failures are printed
 * as advice and do not affect the exit code.
 *
 * Re-export from the app after any change to the log: the guard set below is
 * frozen at export time, and so are the premise labels in each failure message.
 */

const fs = require("node:fs");
const path = require("node:path");

const GUARDS = [];


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
    else if (c === ".") out += "\\.";
    else if ("+^${}|()[]".includes(c)) out += "\\" + c;
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
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = wordBoundary === false ? escaped : "\\b" + escaped + "\\b";
  return new RegExp(source, caseSensitive ? "g" : "gi");
}

function findMatchInText(text, pattern, wordBoundary, caseSensitive) {
  const re = compilePattern(pattern, wordBoundary, caseSensitive);
  const lines = text.split("\n");
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
          ? { outcome: "fail", evidence: "No file matches `" + spec.glob + "` among " + project.files.length + " path(s)" }
          : { outcome: "pass", evidence: matches.length + " file(s) match `" + spec.glob + "`: " + matches.slice(0, 6).join(", ") };
      }
      return matches.length > 0
        ? { outcome: "fail", evidence: matches.length + " file(s) match `" + spec.glob + "` but none should: " + matches.slice(0, 6).join(", ") }
        : { outcome: "pass", evidence: "No file matches `" + spec.glob + "`" };
    }

    case "string_in_files":
    case "string_absent_in_files": {
      const scoped = project.files.filter((f) => matchesGlob(f, spec.glob));
      if (scoped.length === 0) {
        return { outcome: "skip", evidence: "no file matches the scope `" + spec.glob + "`" };
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
        return { outcome: "fail", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching `" + spec.glob + "`" };
      }
      return { outcome: "pass", evidence: '"' + spec.pattern + '" does not appear in ' + scoped.length + " file(s) matching `" + spec.glob + "`" };
    }

    case "command_exit_zero": {
      /* CI has a shell, which the browser does not. This is the one kind whose result can
       * legitimately differ between the two targets, and it is environment-dependent by
       * nature — which is why it is never `blocking` by default. */
      try {
        const { execSync } = require("node:child_process");
        execSync(spec.command, { stdio: "pipe", cwd: spec.cwd || "." });
        return { outcome: "pass", evidence: "`" + spec.command + "` exited 0" };
      } catch (error) {
        const out = (error.stdout || error.stderr || "").toString().trim().split("\n")[0] || "";
        return { outcome: "fail", evidence: "`" + spec.command + "` exited non-zero" + (out ? ": " + out : "") };
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
  lines.push("\x1b[31m\u2717 " + guard.decisionId + " \u2014 " + guard.statement + "\x1b[0m");
  lines.push("  Guard " + guard.id + " (" + guard.kind + ": " + guard.target + ") FAILED  [" + guard.severity + "]");
  lines.push("  Evidence: " + result.evidence);
  lines.push("  Why this check verifies that decision: " + guard.rationale);

  const premises = guard.restsOn.length === 0
    ? "nothing recorded"
    : guard.restsOn.map((p) => p.id + " " + p.text + " (" + p.label + ")").join(", ");
  lines.push("  Decided: " + guard.decidedAt + " \u00b7 Rests on: " + premises);

  if (guard.restsOn.length === 0) {
    lines.push("    (no recorded premise, so nothing can falsify it \u2014 a gap worth filling in WhyLog)");
  }

  for (const alt of guard.rejected) {
    lines.push("  Rejected alternative " + alt.value + (alt.whyRejected ? " \u2014 reason: \"" + alt.whyRejected + "\"" : " \u2014 no reason recorded"));
  }

  lines.push("");
  lines.push("  \u2192 Is this a deliberate reversal?   Record it in WhyLog so the log stops claiming otherwise.");
  lines.push("  \u2192 Or is this drift?                Undo the change: " + undoHint(guard));
  return lines.join("\n");
}

function undoHint(guard) {
  switch (guard.kind) {
    case "dependency_absent": return "remove the \"" + guard.target + "\" dependency.";
    case "dependency_present": return "install \"" + guard.target + "\", or record the decision that replaced it.";
    case "path_glob_absent": return "remove the file(s) matching \"" + guard.target + "\".";
    case "path_glob_exists": return "restore the file(s) matching \"" + guard.target + "\".";
    case "string_absent_in_files": return "remove \"" + guard.target + "\" from the files in scope.";
    case "string_in_files": return "add \"" + guard.target + "\" where the decision expects it.";
    default: return "see the guard's rationale above.";
  }
}

/* -------------------------------------------------------------------- main -- */

/* `--decision WLD-0007` restricts the run to one decision's guards. The verify command exported */
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
    console.error("[31mNo guards in this runner for decision " + opts.decision + ".[0m");
    console.error("The exported runner is probably older than that decision. Re-export from WhyLog.");
    process.exit(2);
  }

  console.log("WhyLog decision guards \u00b7 " + selected.length + " of " + GUARDS.length + " guard(s)" + (opts.decision === null ? "" : " for " + opts.decision) + " \u00b7 " + files.length + " file(s) scanned");

  let blocking = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const guard of selected) {
    const result = evaluate(guard, project);

    if (result.outcome === "pass") { passed += 1; continue; }
    if (result.outcome === "skip") {
      skipped += 1;
      console.log("\x1b[33m\u2013 " + guard.id + " SKIPPED\x1b[0m (" + guard.kind + ": " + guard.target + ") \u2014 " + result.evidence);
      continue;
    }

    if (guard.severity === "blocking") blocking += 1;
    else warnings += 1;

    console.log(reportFailure(guard, result));
  }

  console.log("");
  console.log("  passed " + passed + " \u00b7 failed " + (blocking + warnings) + " (" + blocking + " blocking, " + warnings + " warning) \u00b7 skipped " + skipped);

  if (blocking > 0) {
    console.log("\n\x1b[31m" + blocking + " blocking decision guard(s) failed.\x1b[0m");
    console.log("Each failure above names the decision, the premise it rests on, and what was rejected.");
    process.exit(1);
  }
  if (warnings > 0) {
    console.log("\n" + warnings + " warning-level guard(s) failed \u2014 advisory, build not blocked.");
  }
  process.exit(0);
}

main();
