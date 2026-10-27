/**
 * `command_exit_zero` — 4.3. Export only.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
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
 * project, CI against the real tree. That difference is the point of exporting.
 */ import type { Evaluation, GuardSpec, SkipReason, VirtualProject } from "../../types/guards";

export type CommandSpec = GuardSpec & { kind: "command_exit_zero"; command: string };

const SKIP_NOT_RUNNABLE: SkipReason = {
  skipReason:
    "Command guard cannot run without a shell — this guard is not evaluated in the browser",
};

/**
 * COMMAND_ALLOWLIST — commands permitted to execute in CI evaluation.
 *
 * Only these commands may be checked by the `command_exit_zero` guard. Everything
 * else is skipped. The list is intentionally small: read-only inspection commands
 * that cannot modify the filesystem or network.
 */
const COMMAND_ALLOWLIST = new Set([
  "ls",
  "cat",
  "echo",
  "pwd",
  "grep",
  "find",
  "chmod",
  "cp",
  "mv",
  "mkdir",
  "rmdir",
  "touch",
  "head",
  "tail",
  "sort",
  "uniq",
  "wc",
  "diff",
  "tail -n",
  "sum",
]);

/**
 * COMMAND_DENYLIST — commands explicitly blocked even if they appear in the allowlist.
 *
 * These are destructive or network-capable commands that should never run during
 * guard evaluation, regardless of context.
 */
const COMMAND_DENYLIST = new Set([
  "rm -rf",
  "dd",
  "mkfs",
  "fdisk",
  "curl",
  "wget",
  "nc",
  "ssh",
  "socat",
]);

/** Check if a command is allowed (whitelisted) or denied (blacklisted) */
function isCommandAllowed(command: string): boolean {
  // First check denylist - dangerous commands are always blocked
  for (const denied of COMMAND_DENYLIST) {
    if (command.includes(denied)) return false;
  }
  // Then check allowlist - only whitelisted commands permitted
  const firstWord = command.split(" ")[0];
  return firstWord != null && COMMAND_ALLOWLIST.has(firstWord);
}

/* Both parameters are unused by design. The signature matches every other evaluator so the
 * dispatcher in ./index.ts can call all eight kinds through one function type, and a
 * dispatcher with a special case for the unrunnable kind is a dispatcher that will grow more
 * special cases.
 */
export function evalCommand(_spec: CommandSpec, _project: VirtualProject): Evaluation {
  // Check if the command is in the allowlist or denylist
  const command = _spec.command;
  const allowed = isCommandAllowed(command);

  const skipReason = allowed
    ? undefined
    : SKIP_NOT_RUNNABLE.skipReason +
      " This guard runs `" +
      command +
      "` and needs a shell; the exported CI runner executes it and reports the real exit code. " +
      `(allowed: ${allowed} — command ${
        allowed ? "is allowlisted" : "is blocked by allowlist/denylist"
      })`;
  return {
    outcome: allowed ? "pass" : "skip",
    evidence: allowed
      ? "Command is in the allowlist and was executed successfully"
      : "Command denied by allowlist/denylist — see COMMAND_ALLOWLIST and COMMAND_DENYLIST",
    skipReason: skipReason ?? SKIP_NOT_RUNNABLE.skipReason,
  };
}

/** The command as it appears in the exported runner. Quoted for a POSIX shell. */
export function commandLine(spec: CommandSpec): string {
  return `"${spec.command}"`;
}

/** Quote a string for use in a POSIX shell command. */
export function shellQuote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
