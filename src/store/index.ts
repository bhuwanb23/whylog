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
export * as selectors from "./selectors";
export {
  DEFAULT_CASCADE_DEPTH_CAP,
  DEFAULT_MAX_SEARCH_STEPS,
  applyConfig,
  defaultConfig,
  initialSettings,
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
