/**
 * The export compiler — Phase 5's entry point.
 *
 * Phase 5 · sub-phases 5.1–5.7
 * Plan: plan/phase-5-export-compiler.md
 * Docs: docs/01-prior-art-landscape.md §4.5 — the agent-optimized ADR specification
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOVEL HERE, STATED PLAINLY
 *
 * Multi-format export is NOT novel. `ai-memory rules --target agents-md` ships it and `AGENTS.md`
 * is in more than 60,000 projects. Emitting Markdown is not the contribution.
 *
 * Three things in this phase are:
 *
 *   1. VERIFY COMMANDS GENERATED FROM THE DECISION. Every agent-optimized ADR spec asks for one;
 *      in every tool surveyed a human writes it, and then it drifts from the decision it checks.
 *      Here it is compiled from the same Phase 4 guards, in the same pass, so it cannot.
 *
 *   2. THE PRE-EXPORT CONSISTENCY GATE. Nobody refuses to export a log that contradicts itself.
 *      "If two rules contradict each other, the model may pick one arbitrarily" — so this is the
 *      one place in the product where truth maintenance PREVENTS an outcome rather than reporting
 *      one for a human to read.
 *
 *   3. THE REJECTED-ALTERNATIVES BLOCK WITH PREMISE STATUS. The highest-value block in the file
 *      and the one no competitor emits, because none of them index rejected alternatives
 *      first-class. It is not a blacklist: each entry says whether the reason still holds.
 *
 * Stamping is auditability and is described that way everywhere, never as tamper-proofing.
 * ---------------------------------------------------------------------------
 */

import type { Actor } from "@/types/common";
import type { ExportId } from "@/types/common";
import { compile, describeCompile, buildNarratives, annotationsForResult, type CompileInput, type CompileResult } from "./compiler";

export { compile, describeCompile, buildNarratives, annotationsForResult };
export type { CompileInput, CompileResult };

/* ---- the canonical intermediate form ---- */
export { buildCif, describeCif, checkSixProperties, linesForRecord, guardsByDecision } from "./cif";
export type { CifOptions, CifResult } from "./cif";

/* ---- the agent-optimized record ---- */
export { recordFor, imperativeFor, renderStatus, premisesOf, rejectedOf, ANTI_RELITIGATION, MUST_NOT_LIMIT } from "./record";
export { rejectedBlock, renderRejectedBlock, contestedCount } from "./rejected-block";
export { verifyCommandFor, renderVerify, explainGuard, describeVerifyPolicy, dependencyOneLiner, RUNNER_PATH } from "./verify-command";

/* ---- budget and priority ---- */
export { priorityOf, guardStatusFor, explainPriority, describePriority, recencyScore, SOUNDNESS_BY_LABEL, RECENCY_HALF_LIFE_DAYS, SCOPE_SATURATION } from "./priority";
export { allocate, renderIndex, describeBudget, describeExcluded, estimateTokens, indexEntryFor, FIXED_OVERHEAD, TOKENS_PER_LINE } from "./budget";

/* ---- the gate ---- */
export { consistencyGate, renderBlocked, renderWarnings, annotationsFor, describeGate } from "./consistency-gate";
export type { GateInput, GateReport, Annotation } from "./consistency-gate";

/* ---- the stamp ---- */
export { buildStamp, renderStamp, STAMP_SCHEMA_VERSION, artifactDigest, headHashOf, shortHash, stripStamp, STAMP_MARKER } from "./stamp";
export { parseStamp, verifyStamp, explainVerification, mismatchPayload } from "./stamp/verify";
export type { ParsedStamp, VerifyInput } from "./stamp/verify";

/* ---- emitters ---- */
export { emit, filenameFor, isDocumentTarget, TARGET_AUDIENCE, emitClaudeMd, emitAgentsMd, emitCursorRules, emitDecisionsMd, renderRecord, renderIndexLine } from "./emitters";
export type { EmitInput, DecisionNarrative, RenderOptions } from "./emitters";

/* ---- CI ---- */
export { emitCi, CI_TARGET } from "./ci";
export { emitRunner, emitWorkflow } from "./ci/runner";
export { WORKFLOW_PATH, WORKFLOW_PURPOSE } from "./ci/workflow";
export type { CiInput, CiResult } from "./ci";

/* ---- round trip ---- */
export {
  parseDecisionsMd, planMerge, describeMergePlan, importedEvent,
  type MergePlan, type MergeEntry, type MergeAction, type ParsedRecord, type ParsedDocument,
} from "./round-trip";

export type { ExportId };

/**
 * The whole phase, described. Shown in the export view's reference panel, because the compiler
 * makes several decisions the user should be able to see: what is excluded and why, what the
 * budget does, what the gate blocks on, and what the stamp is and is not for.
 */
export function describeExportPhase(): string {
  return [
    "The export compiler — one graph, one pass, five artifacts.",
    "",
    "  graph → consistency gate → CIF → priority rank → budget split → emitters → stamp",
    "",
    "The intermediate form is the architecture. Every emitter is a PURE FUNCTION of the CIF and",
    "never reads the graph, which is what stops five formats drifting apart: there is one place a",
    "decision becomes a record, and five places that render a record somebody else built.",
    "",
    "Two CIFs are built in the same pass — one with exclusions and a budget for the agent files,",
    "one without either for DECISIONS.md. A human reading history needs the reversals; an agent",
    "following rules must not see a reversed rule beside its replacement.",
    "",
    "Multi-format export is not novel and is not the claim. The three things that are:",
    "  · verify commands COMPILED from the Phase 4 guards, in the same pass, so they cannot drift",
    "  · a pre-export gate that REFUSES to emit a self-contradictory log",
    "  · the rejected-alternatives block, with each reason's premise status attached",
  ].join("\n");
}
