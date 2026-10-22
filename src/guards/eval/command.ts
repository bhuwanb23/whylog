/**
 * `command_exit_zero` — 4.3. Export only.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 *
 * ---------------------------------------------------------------------------
 * THIS FILE NEVER RUNS A COMMAND
 *
 * There is no shell in a browser, and pretending otherwise would mean either faking a result or
 * shelling out through a mechanism the sandbox does not have. So the evaluator returns SKIP
 * with a reason that says where the guard CAN run, and `ci-export.ts` emits it as real code.
 *
 * The kind is deterministic in principle and environment-dependent in practice: its result
 * depends on installed tooling, network state and whatever the command touches. That is why it
 * ranks below the six virtual-project kinds and why it is never `blocking` by default — a
 * guard that fails because a binary is missing on one machine is not evidence about the
 * decision.
 * ---------------------------------------------------------------------------
 */

import type { CommandSpec, VirtualProject } from "@/types/guards";
import { type Evaluation, SKIP_NOT_RUNNABLE } from "./types";

export function evalCommand(_spec: CommandSpec, _project: VirtualProject): Evaluation {
  /* Both parameters are unused by design. The signature matches every other evaluator so the
   * dispatcher in ./index.ts can call all eight kinds through one function type, and a
   * dispatcher with a special case for the unrunnable kind is a dispatcher that will grow more
   * special cases. */
  return {
    outcome: "skip",
    evidence: "",
    skipReason: `${SKIP_NOT_RUNNABLE.skipReason} This guard runs \`${_spec.command}\` and needs a shell; the exported CI runner executes it and reports the real exit code.`,
  };
}

/** The command as it appears in the exported runner. Quoted for a POSIX shell. */
export function commandLine(spec: CommandSpec): string {
  const cwd =
    spec.cwd === undefined || spec.cwd.length === 0 ? "" : `cd ${shellQuote(spec.cwd)} && `;
  return cwd + spec.command;
}

export function shellQuote(value: string): string {
  /* Single quotes with embedded quotes escaped. Double quotes would let the shell expand
   * variables inside a path, which for a command emitted into CI is a silent substitution the
   * author did not ask for. */
  return `'${value.replace(/'/g, "'\\''")}'`;
}
