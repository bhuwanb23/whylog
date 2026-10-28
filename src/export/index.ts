import type { ExportId } from "@/types/common";
import {
  type CompileInput,
  type CompileResult,
  annotationsForResult,
  buildNarratives,
  compile,
  describeCompile,
} from "./compiler";

export { compile, describeCompile, buildNarratives, annotationsForResult };
export type { CompileInput, CompileResult };

/* ---- the canonical intermediate form ---- */
export { buildCif, describeCif, checkSixProperties, linesForRecord, guardsByDecision } from "./cif";
export type { CifOptions, CifResult } from "./cif";

/* ---- the agent-optimized record ---- */
export {
  recordFor,
  imperativeFor,
  renderStatus,
  premisesOf,
  rejectedOf,
  ANTI_RELITIGATION,
  MUST_NOT_LIMIT,
} from "./record";
export { rejectedBlock, renderRejectedBlock, contestedCount } from "./rejected-block";
export {
  verifyCommandFor,
  renderVerify,
  explainGuard,
  describeVerifyPolicy,
  dependencyOneLiner,
  RUNNER_PATH,
} from "./verify-command";

/* ---- budget and priority ---- */
export {
  priorityOf,
  guardStatusFor,
  explainPriority,
  describePriority,
  recencyScore,
  SOUNDNESS_BY_LABEL,
  RECENCY_HALF_LIFE_DAYS,
  SCOPE_SATURATION,
} from "./priority";
export {
  allocate,
  renderIndex,
  describeBudget,
  describeExcluded,
  estimateTokens,
  indexEntryFor,
  FIXED_OVERHEAD,
  TOKENS_PER_LINE,
} from "./budget";

/* ---- the gate ---- */
export {
  consistencyGate,
  renderBlocked,
  renderWarnings,
  annotationsFor,
  describeGate,
} from "./consistency-gate";
export type { GateInput, GateReport, Annotation } from "./consistency-gate";

/* ---- the stamp ---- */
export {
  buildStamp,
  renderStamp,
  STAMP_SCHEMA_VERSION,
  artifactDigest,
  headHashOf,
  shortHash,
  stripStamp,
  STAMP_MARKER,
} from "./stamp";
export { parseStamp, verifyStamp, explainVerification, mismatchPayload } from "./stamp/verify";
export type { ParsedStamp, VerifyInput } from "./stamp/verify";

/* ---- emitters ---- */
export {
  emit,
  filenameFor,
  isDocumentTarget,
  TARGET_AUDIENCE,
  emitClaudeMd,
  emitAgentsMd,
  emitCursorRules,
  emitDecisionsMd,
  renderRecord,
  renderIndexLine,
} from "./emitters";
export type { EmitInput, DecisionNarrative, RenderOptions } from "./emitters";

/* ---- CI ---- */
export { emitCi, CI_TARGET } from "./ci";
export { emitRunner, emitWorkflow } from "./ci/runner";
export { WORKFLOW_PATH, WORKFLOW_PURPOSE } from "./ci/workflow";
export type { CiInput, CiResult } from "./ci";

/* ---- round trip ---- */
export {
  parseDecisionsMd,
  planMerge,
  describeMergePlan,
  importedEvent,
  type MergePlan,
  type MergeEntry,
  type MergeAction,
  type ParsedRecord,
  type ParsedDocument,
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
