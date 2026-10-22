/**
 * The emitted runner and workflow — 5.2 / 4.6.
 *
 * Delegates the actual code generation to `guards/ci-export.ts`, which owns the evaluator
 * transcription and the failure message. What lives here is the export-pass-specific wrapping:
 * the stamp header, and the note that ties the runner to the documents that reference it.
 */

import type { CiExport } from "@/guards";
import { renderWorkflow } from "@/guards";
import { RUNNER_PATH } from "../verify-command";

/** The runner, with an export-pass header. */
export function emitRunner(exported: CiExport, headHash: string): string {
  const header = [
    "/*",
    " * Emitted by the WhyLog export compiler alongside CLAUDE.md / AGENTS.md / DECISIONS.md.",
    " *",
    " * Those documents contain `Verify:` lines of the form:",
    ` *     node ${RUNNER_PATH} --decision WLD-0007`,
    " * This file is what makes those lines true. It is compiled from the same graph in the same",
    " * pass, so a verify command cannot name a guard this runner does not have.",
    " *",
    ` * Log head: ${headHash}`,
    ` * Guards:   ${exported.guards.length}`,
    " *",
    " * Re-export after any change to the log. Editing this file by hand is detected as a stamp",
    " * mismatch, and the edit is lost on the next export.",
    " */",
    "",
  ].join("\n");

  return header + exported.runner;
}

/** The workflow. Emitted by Phase 4's generator, unchanged — the export pass adds nothing to it,
 *  and a second generator here would be a second thing to keep in sync with the runner it
 *  invokes. */
export function emitWorkflow(guardCount: number): string {
  return renderWorkflow(guardCount);
}
