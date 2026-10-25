/**
 * Emitter dispatch — 5.2.
 *
 * Phase 5 · sub-phase 5.2
 *
 * Five targets from one CIF. Every emitter is a pure function: CIF in, text out, no graph read,
 * no I/O, no clock. That is what makes "changing a decision updates every artifact consistently"
 * a property of the architecture rather than a hope.
 */

import type { DecisionId } from "@/types/common";
import type { ExportCif, ExportTarget } from "@/types/export";
import { TARGET_FILENAMES } from "@/types/export";
import { emitClaudeMd } from "./claude";
import { emitAgentsMd } from "./agents";
import { emitCursorRules } from "./cursorrules";
import { emitDecisionsMd, type DecisionNarrative } from "./decisions-md";

export interface EmitInput {
  readonly target: ExportTarget;
  readonly cif: ExportCif;
  /** The rendered stamp block, identical across targets, so a mismatch means the same thing
   *  whichever file it is found in. */
  readonly stampBlock: string;
  readonly projectName?: string;
  /** Required for `decisions-md` only: the ADR narrative the agent record does not carry. */
  readonly narratives?: ReadonlyMap<DecisionId, DecisionNarrative>;
}

/** The reader each target is written for. Shown in the export view, because "which file do I
 *  need?" is a question about the reader, not about the format. */
export const TARGET_AUDIENCE: Readonly<Record<ExportTarget, string>> = {
  "claude-md": "Claude Code, read at the start of every session. Kept under ~200 lines because longer files reduce adherence.",
  "agents-md": "The cross-agent standard — a README for agents, used in 60,000+ projects. The default when you do not know which tool the next contributor will use.",
  cursorrules: "Cursor, as project instructions. A flat imperative list; per-rule files under .cursor/rules/ are a v2 target.",
  "decisions-md": "Humans. Full ADR form with context, consequences and alternatives — and the only target carrying superseded decisions, because a reversal is history a person needs and a rule an agent should not see.",
  "ci-guards": "GitHub Actions. The Phase 4 runner, emitted alongside so the checks live where the code does.",
};

export function emit(input: EmitInput): string {
  switch (input.target) {
    case "claude-md":
      return emitClaudeMd(
        input.cif,
        input.stampBlock,
        input.projectName === undefined ? undefined : { projectName: input.projectName },
      );
    case "agents-md":
      return emitAgentsMd(input.cif, input.stampBlock, input.projectName);
    case "cursorrules":
      return emitCursorRules(input.cif, input.stampBlock);
    case "decisions-md":
      return emitDecisionsMd(input.cif, input.stampBlock, input.narratives ?? new Map(), input.projectName);
    case "ci-guards":
      /* Not a Markdown emitter. The CI target is the Phase 4 runner, compiled from the same graph
       * in the same pass — it needs guard records, not a CIF. Routing it through here would mean
       * inventing a CIF-shaped hole for something that is not a document. `compiler.ts` handles it
       * directly. */
      return "";
  }
}

export function filenameFor(target: ExportTarget): string {
  return TARGET_FILENAMES[target];
}

/** Whether a target renders Markdown from the CIF, as opposed to code from the graph. */
export function isDocumentTarget(target: ExportTarget): boolean {
  return target !== "ci-guards";
}

export { emitClaudeMd } from "./claude";
export { emitAgentsMd } from "./agents";
export { emitCursorRules } from "./cursorrules";
export { emitDecisionsMd } from "./decisions-md";
export type { DecisionNarrative } from "./decisions-md";
export { renderRecord, renderIndexLine } from "./shared";
export type { RenderOptions } from "./shared";
