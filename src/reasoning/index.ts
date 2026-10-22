/**
 * Reasoning barrel — Phase 2.
 *
 * Generated from the actual `export` lines of each module, not written from memory:
 * a barrel that names a symbol its module does not export compiles to `undefined` at
 * runtime and only fails at the first call site, which is the worst place to find out.
 *
 * ---------------------------------------------------------------------------
 * ONE ALIAS, AND WHY
 *
 * `gates/premise.ts` and `gates/semantic.ts` both export `describeResult`. TypeScript
 * resolves an ambiguous `export *` by silently dropping BOTH names, so the collision is
 * invisible until something imports one of them. They are re-exported here under
 * distinct names and the originals are not exported at all.
 *
 * `MAX_CASCADE_DEPTH` is exported by `cascade.ts` and re-exported by `revise.ts` for
 * convenience; only the canonical one is exposed here.
 * ---------------------------------------------------------------------------
 */

/* ---- 2.2 the JTMS labeller ---- */
export {
  label,
  validityOf,
  wellFoundedness,
  describeReason,
  describeLabelling,
  LABEL_MEANING,
  MAX_ITERATIONS,
} from "./labeller";
export type {
  NodeId,
  Labelled,
  LabelReason,
  LabellingResult,
  ValidityVerdict,
  FoundingProblem,
  WellFoundedness,
} from "./labeller";

/* ---- 2.3-2.5 the three gates, through the orchestrator ---- */
export {
  runGates,
  describeRun,
  describeAvailability,
  findingsFor,
  deterministicFindings,
  detectStructural,
  detectPremiseInvalidation,
  detectSemantic,
} from "./gates";
export type {
  GateFinding,
  GateRun,
  GateOptions,
  StructuralHit,
  PremiseInvalidation,
  SemanticHit,
  GateBResult,
  CandidatePair,
} from "./gates";

/* gate (a) internals, for the conflict view */
export {
  NEWCOMER_ID,
  pairKey,
  wouldContradict,
  describeHits as describeStructuralHits,
  describeBlindSpots as describeStructuralBlindSpots,
} from "./gates/structural";

/* gate (c) internals, for the premise view */
export {
  previewInvalidation,
  loadBearingPremises,
  describeResult as describePremiseGateResult,
  describeGate as describePremiseGate,
} from "./gates/premise";
export type { InvalidationClause, GateCResult } from "./gates/premise";

/* gate (b) internals, for the semantic conflict view */
export {
  diagnose,
  M1_SIMILARITY_FLOOR,
  M2_SIMILARITY_CEILING,
  DIAGNOSTIC_MEANING,
  describeResult as describeSemanticResult,
} from "./gates/semantic";

/* ---- 2.6 backtracking & nogoods ---- */
export {
  backtrack,
  assumptionSetOf,
  describeBacktrack,
  splitCulprits,
  MAX_BACKTRACK_DEPTH,
} from "./backtracking";
export {
  nogoodForFinding,
  explainConjunction,
  blocksConjunction,
  nogoodsInvolving,
  nextNogoodId,
  nogoodKey,
  isDuplicate,
  countNogoods,
} from "./nogoods";
export type { NogoodDraft } from "./nogoods";

/* ---- 2.7 cascade ---- */
export {
  cascade,
  describeCascade,
  cascadeLines,
  deepestStep,
  MAX_CASCADE_DEPTH,
} from "./cascade";

/* ---- 2.8 entrenchment & adjudication ---- */
export {
  entrenchmentOf,
  premiseEntrenchmentOf,
  recencyScore,
  premisesOf,
  describeEntrenchment,
  entrenchmentSummary,
} from "./entrenchment";
export type { GuardStatus } from "./entrenchment";
export {
  adjudicate,
  findContradictors,
  contradictorIds,
  scoreNewcomer,
  explainRefusal,
  describeOutcome,
} from "./adjudication";
export type { Newcomer, AdjudicationInput, Contradictor } from "./adjudication";

/* ---- 2.9 proposals ---- */
export {
  buildProposal,
  actionsFor,
  evidenceForFinding,
  renderProposal,
  describeAction,
  openProposals,
  highEntrenchmentProposals,
  nextProposalNumber,
  countOpen,
  WHY_NOT_AUTO_APPLIED,
} from "./proposals";
export type { ProposalInput, ProposalEvidence } from "./proposals";

/* ---- 2.10 audit ---- */
export {
  auditDecision,
  soleSupportDecisions,
  chronologicalOrder,
  renderTrail,
  renderWeakest,
  weaknessLabel,
  renderSummary,
  MAX_AUDIT_DEPTH,
} from "./audit";
export type { WeaknessKind, AuditStep, WeakLink, AuditTrail } from "./audit";

/* ---- 2.1 the assertion entry point: one function, four input kinds ---- */
export {
  assertNewInformation,
  findExistingDecision,
  falsifyPremise,
  userDecision,
  guardResult,
  sourceLabel,
} from "./assert";
export type {
  Assertion,
  AssertionSource,
  AssertionResult,
  AssertContext,
  PremiseAssertion,
  DecisionAssertion,
} from "./assert";

/* ---- 2.1 the cycle. The only entry point anything outside reasoning/ needs. ---- */
export {
  revise,
  renderResult,
  deepestCascade,
  REVISION_PLACEHOLDER_EVENT_ID,
} from "./revise";
export type {
  LabelChange,
  ReviseInput,
  RevisionCase,
  ReviseResult,
  EventDraftAny,
} from "./revise";
