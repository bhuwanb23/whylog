/**
 * Guard → runnable verify command — 5.3.
 *
 * Phase 5 · sub-phase 5.3
 * Plan: plan/phase-5-export-compiler.md §5.3
 * Docs: docs/01-prior-art-landscape.md §4.5 ("verifiable" — the requirement nobody else
 *       satisfies automatically)
 *
 * ---------------------------------------------------------------------------
 * THE REQUIREMENT NO ADR TOOL CAN SATISFY AUTOMATICALLY
 *
 * Every agent-optimized ADR spec asks for a verify command. In every tool surveyed, a human
 * writes it — and then it drifts from the decision it was supposed to check, because nothing
 * connects the two.
 *
 * Here the command is COMPILED from the same Phase 4 guards that the in-browser interpreter and
 * the CI runner evaluate, in the same pass over the same graph. So an export can never carry a
 * verify command that disagrees with its guard set: there is one source, read once.
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES, AND WHY NOT ONE
 *
 * A decision whose guards are ALL dependency checks gets a self-contained one-liner:
 *
 *   node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};
 *            process.exit(d['better-sqlite3'] && !d['pg'] ? 0 : 1)"
 *
 * That runs anywhere with Node and nothing else, which is the point — an agent can execute it
 * without installing the project, and a human can read it and see exactly what is being claimed.
 *
 * A decision with path or string guards gets the exported runner instead:
 *
 *   node scripts/whylog-guards.cjs --decision WLD-0007
 *
 * Reimplementing glob matching and word-boundary search inside a one-liner would mean a second
 * copy of `lib/glob.ts` semantics living in a string literal, which is precisely the drift this
 * phase exists to prevent. Delegating keeps ONE evaluator. The cost is that the runner has to
 * exist — so the command says so, and the emitter only prints it when the CI target is being
 * exported alongside.
 *
 * ---------------------------------------------------------------------------
 * NO GUARDS MEANS NO COMMAND, AND THE RECORD SAYS SO
 *
 * An unverifiable decision does not get a plausible-looking command. `undefined` is returned and
 * `record.ts` renders "no verify command — this decision is unverifiable", which is more useful
 * to an agent than a command that checks nothing, and more honest to a human than a gap.
 * ---------------------------------------------------------------------------
 */

import { shellQuote } from "@/guards/eval/command";
import type { DecisionId } from "@/types/common";
import type { Guard } from "@/types/guards";

/** The runner's path, matching `TARGET_FILENAMES["ci-guards"]`. One constant so the emitted
 *  command and the emitted file cannot disagree about where the file is. */
export const RUNNER_PATH = "scripts/whylog-guards.cjs";

export interface VerifyCommand {
  readonly command: string;
  /** True when the command needs the exported runner rather than standing alone. The emitter
   *  uses this to decide whether to warn that the CI target must be exported too. */
  readonly needsRunner: boolean;
  /** What the command actually checks, in words. Rendered as a comment above the command so a
   *  human reading CLAUDE.md can judge it without parsing shell. */
  readonly explains: string;
}

/**
 * Compile the verify command for one decision's guards.
 *
 * Only ACCEPTED guards contribute: a proposed guard is not a check the user has agreed to, and
 * emitting a command for one would tell an agent to verify something the log has not committed
 * to. Suppressed and deleted guards are excluded for the same reason.
 */
export function verifyCommandFor(
  decisionId: DecisionId,
  guards: readonly Guard[],
): VerifyCommand | null {
  const live = guards.filter(
    (guard) => guard.decisionId === decisionId && guard.lifecycle === "accepted",
  );

  if (live.length === 0) return null;

  const allDependency = live.every(
    (guard) => guard.spec.kind === "dependency_present" || guard.spec.kind === "dependency_absent",
  );

  if (allDependency) {
    return {
      command: dependencyOneLiner(live),
      needsRunner: false,
      explains: live.map((guard) => explainGuard(guard)).join("; "),
    };
  }

  return {
    command: `node ${RUNNER_PATH} --decision ${decisionId}`,
    needsRunner: true,
    explains: `${live.map((guard) => explainGuard(guard)).join("; ")}. Path and string checks need glob and word-boundary matching, which lives in the exported runner rather than being reimplemented inside a shell one-liner — one evaluator, not two that can drift.`,
  };
}

/**
 * The self-contained dependency check.
 *
 * Exit 0 iff every `dependency_present` guard's package is there AND no `dependency_absent`
 * guard's package is. Mirrors `eval/dependency.ts` exactly, including the dev-dependency
 * asymmetry: an absence check covers devDependencies, a presence check does not.
 */
export function dependencyOneLiner(guards: readonly Guard[]): string {
  const present: string[] = [];
  const absent: string[] = [];
  const absentIncludingDev: string[] = [];

  for (const guard of guards) {
    const spec = guard.spec;
    if (spec.kind !== "dependency_present" && spec.kind !== "dependency_absent") continue;

    const includeDev = spec.includeDev ?? spec.kind === "dependency_absent";

    if (spec.kind === "dependency_present") present.push(spec.package);
    else if (includeDev) absentIncludingDev.push(spec.package);
    else absent.push(spec.package);
  }

  const conditions: string[] = [];

  for (const pkg of present) conditions.push(`d[${quote(pkg)}]`);
  for (const pkg of absent) conditions.push(`!r[${quote(pkg)}]`);
  for (const pkg of absentIncludingDev) conditions.push(`!d[${quote(pkg)}]`);

  if (conditions.length === 0) return "true";

  /* `r` is runtime dependencies, `d` is runtime + dev. Two maps rather than one because the
   * asymmetry is the semantics: a build-only dependency does not mean a decision was
   * implemented, but a rejected package installed for tooling is still installed. */
  return `node -e ${doubleQuote(
    `const p=require('./package.json');const r=p.dependencies||{};const d=Object.assign({},r,p.devDependencies||{});process.exit(${conditions.join("&&")}?0:1)`,
  )}`;
}

function quote(pkg: string): string {
  return `'${pkg.replace(/'/g, "\\'")}'`;
}

function doubleQuote(body: string): string {
  /* The body contains single quotes, so it is wrapped in double quotes; any double quote inside
   * has to be escaped or the shell ends the string early and the command silently checks less
   * than it appears to. */
  return `"${body.replace(/"/g, '\\"')}"`;
}

export function explainGuard(guard: Guard): string {
  const spec = guard.spec;

  switch (spec.kind) {
    case "dependency_present":
      return `${spec.package} must be installed`;
    case "dependency_absent":
      return `${spec.package} must NOT be installed${spec.includeDev === true ? " (including devDependencies)" : ""}`;
    case "path_glob_exists":
      return `a file matching ${spec.glob} must exist`;
    case "path_glob_absent":
      return `no file matching ${spec.glob} may exist`;
    case "string_in_files":
      return `${JSON.stringify(spec.pattern)} must appear within ${spec.glob}`;
    case "string_absent_in_files":
      return `${JSON.stringify(spec.pattern)} must NOT appear within ${spec.glob}`;
    case "command_exit_zero":
      return `${shellQuote(spec.command)} must exit 0`;
    case "llm_judge":
      return `a rubric verdict over ${spec.scopeGlobs.join(", ")} (advisory — never fails a build)`;
  }
}

/** Rendered into the record. `undefined` becomes an explicit statement rather than an omitted
 *  line, because an agent that sees no verify line cannot tell "not checkable" from "not
 *  emitted", and a human reading the export cannot tell either. */
export function renderVerify(verify: VerifyCommand | null): string {
  if (verify === null) {
    return "Verify: none — this decision is UNVERIFIABLE. No guard could be compiled from it, so nothing would tell you if it stopped holding.";
  }

  return `Verify: ${verify.command}${verify.needsRunner ? `   (needs ${RUNNER_PATH}, exported alongside)` : ""}\n        checks: ${verify.explains}`;
}

export function describeVerifyPolicy(): string {
  return [
    "Verify commands are COMPILED from the Phase 4 guards, in the same pass over the same graph.",
    "An export can never carry a command that disagrees with its guard set, because there is one",
    "source and it is read once.",
    "",
    "  all-dependency guards  a self-contained `node -e` one-liner. Runs anywhere with Node,",
    "                         installs nothing, and a human can read what it claims.",
    `  anything else          \`node ${RUNNER_PATH} --decision <id>\`. Glob and word-boundary`,
    "                         matching live in ONE evaluator rather than being reimplemented",
    "                         inside a string literal — which is the drift this phase prevents.",
    "  no accepted guards     no command, and the record says UNVERIFIABLE. Never a plausible-",
    "                         looking command that checks nothing.",
    "",
    "Only ACCEPTED guards contribute. A proposed guard is not a check the user agreed to.",
  ].join("\n");
}
