/**
 * The CI target — 5.2 / 4.6.
 *
 * Phase 5 · sub-phase 5.2, over Phase 4's sub-phase 4.6
 * Plan: plan/phase-5-export-compiler.md §5.2
 *
 * ---------------------------------------------------------------------------
 * A THIN ADAPTER, NOT A SECOND EXPORTER
 *
 * Phase 4 already compiles the guard set into a standalone Node runner and an Actions workflow
 * (`guards/ci-export.ts`), including the rich failure message. Reimplementing that here would
 * produce two CI exporters that could disagree — and the risk table names exactly this: "verify
 * command drifts from the guard set".
 *
 * So this module calls Phase 4's and adds only what the export pass needs: the artifacts in the
 * shape the compiler collects, and the guarantee that the runner is emitted in the SAME pass as
 * the verify commands that reference it.
 *
 * That guarantee is the point. A `CLAUDE.md` telling an agent to run
 * `node scripts/whylog-guards.cjs --decision WLD-0007` is only true if that file exists and
 * honours that flag. Compiling both from one graph in one pass is what makes it true.
 * ---------------------------------------------------------------------------
 */

import { type CiExport, exportCi } from "@/guards";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { ExportId, ISODateString } from "@/types/common";
import type { CompiledArtifact, ExportTarget, IntegrityStamp } from "@/types/export";
import { RUNNER_PATH } from "../verify-command";
import { emitRunner, emitWorkflow } from "./runner";

export const CI_TARGET: ExportTarget = "ci-guards";

export interface CiInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly headHash: string;
  readonly exportId: ExportId;
  readonly generatedAt: ISODateString;
  readonly stampBlock: string;
  /** The SAME stamp the document artifacts carry. Passed in rather than rebuilt here: a CI
   *  artifact stamped with its own counts would be a second opinion about the log, and the two
   *  would disagree the moment one of them was computed after a mutation. */
  readonly stamp: IntegrityStamp;
}

export interface CiResult {
  readonly artifacts: readonly CompiledArtifact[];
  readonly export: CiExport;
  /** True when a verify command in the compiled documents points at `RUNNER_PATH` — which means
   *  the runner MUST be written, or those commands are broken instructions to an agent. */
  readonly requiredByDocuments: boolean;
}

/**
 * Emit the CI artifacts.
 *
 * Two files: the runner and the workflow. They are separate artifacts rather than one because
 * they land in different directories and a user may want the runner without Actions.
 */
export function emitCi(input: CiInput, requiredByDocuments: boolean): CiResult {
  const exported = exportCi({
    state: input.state,
    labels: input.labels,
    headHash: input.headHash,
  });

  const budget = {
    maxLines: 0,
    inlineCount: exported.guards.length,
    indexCount: 0,
    excludedCount: exported.notExported.length,
    overBudget: false,
  };

  const runner = emitRunner(exported, input.headHash);
  const workflow = emitWorkflow(exported.guards.length);

  const artifacts: CompiledArtifact[] = [
    {
      exportId: input.exportId,
      target: CI_TARGET,
      filename: RUNNER_PATH,
      contents: runner,
      stamp: input.stamp,
      budget,
      warnings: [],
    },
    {
      exportId: input.exportId,
      target: CI_TARGET,
      filename: ".github/workflows/decision-guards.yml",
      contents: workflow,
      stamp: input.stamp,
      budget,
      warnings: [],
    },
  ];

  return { artifacts, export: exported, requiredByDocuments };
}
