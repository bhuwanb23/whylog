/**
 * The store: the log, the derived graph, and the actions that connect them.
 *
 * Everything above this layer reads `state` and calls `record`. Nothing above it
 * touches localStorage, the hash chain, or the fold.
 */

export {
  useWhyLog,
  bootOnce,
  isBooted,
  persistenceAvailable,
  type BootStatus,
  type Notice,
  type WhyLogState,
} from "./whylog";
export * as selectors from "./selectors";export {
  DEFAULT_CASCADE_DEPTH_CAP,
  DEFAULT_MAX_SEARCH_STEPS,
  initialSettings,
  useTuning,
  type SettingsState,
} from "./settings";


export {
  REVIEW_KEY,
  hasPendingReview,
  pendingReviewAge,
  useExtraction,
  type ExtractionState,
  type ExtractionStatus,
} from "./extraction";

/**
 * Phase 2 — the reasoning cycle.
 *
 * Kept in its own store rather than folded into `whylog` because its state is DERIVED
 * and disposable: a run can always be recomputed from the log, so persisting it would
 * create a second source of truth that could disagree with the first. Only the events a
 * run produces are persisted, by the log.
 */
export {
  useReasoning,
  /* §2.1 — the assertion entry point. Four input kinds, one function. */
  assertPremiseFalsified,
  assertUserDecision,
  applyReversal,
  applyRejustification,
  linkRejustification,
  applyContest,
  applyVouch,
  applyOverride,
  deterministicCases,
  contestedCases,
  truncatedCases,
  hardestCase,
  type ReasoningState,
  type ReasoningStatus,
  type RunOptions,
} from "./reasoning";

/**
 * Phase 3 — retrieval and the evidence contract.
 *
 * Owns the index artifacts and the question. Gate (b) reads the artifacts from here rather than
 * building its own, so there is one index and one notion of staleness rather than two that can
 * disagree.
 */
export {
  useAsk,
  describeIndex,
  describeHowProduced,
  describePreemptionCoverage,
  retrieveOnly,
  renderExpansion,
  HISTORY_LIMIT,
  type AskState,
  type AskStatus,
  type AskHistoryEntry,
  type ExpandedCitationResult,
  type RetrievalResult,
} from "./ask";

/**
 * Phase 4 — executable decision guards.
 *
 * Owns the virtual project and the baseline, both persisted: the project is a paste rather than a
 * derivation, and losing it on reload would mean re-pasting a file listing every session, which
 * is enough friction that the compliance score stops getting looked at.
 */
export {
  useGuards,
  describeGuardStore,
  overCapDecisions,
  GUARDS_STORAGE_KEY,
  type GuardState,
  type GuardStoreStatus,
} from "./guards";

/**
 * Phase 5 — the agent-native export compiler.
 *
 * Derived and disposable like the reasoning and ask stores: every artifact can be recompiled from
 * the log at any time, so persisting the compiled text would create a second source of truth that
 * could disagree with the first. Only the EVENTS recording that an export happened are persisted.
 */
export {
  useExport,
  describeExportState,
  describeSelectedBudget,
  describeStamp,
  selectedArtifact,
  type ExportState,
  type ExportStatus,
  type CheckResult,
} from "./export";
