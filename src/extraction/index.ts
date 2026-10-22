/**
 * The extraction pipeline's public surface.
 *
 * Phase 1 · all sub-phases
 * Plan: plan/phase-1-extraction-pipeline.md · STRUCTURE.md §6
 *
 * ---------------------------------------------------------------------------
 * WHAT CALLERS MAY USE
 *
 * Three things: the contracts (`types.ts`), the orchestrator (`runExtraction`), and
 * the review model (`review/`). Everything else is a stage — normalisation,
 * segmentation, cue scanning, the recognisers — and a caller that reaches for a
 * stage directly is a caller that has started to duplicate the pipeline's ordering
 * guarantees.
 *
 * The stages are still exported, because Phase 7 measures them individually and a
 * measurement harness that has to go through the orchestrator cannot attribute a
 * number to a component. The review UI and the store should not need them.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES OUTSIDE THIS BARREL
 *
 * The engine seam (`src/ai/types.ts`) and the local recognisers (`src/ai/local/*`).
 * The split is deliberate: `src/extraction/` holds the mechanical stages SHARED by
 * both engines, and `src/ai/local/` holds cue-and-lexicon recognition, which is the
 * local engine's business. An LLM engine uses the same normaliser, the same
 * segmenter and the same offset map, and none of the recognisers.
 * ---------------------------------------------------------------------------
 */

/* ---- contracts ---- */
export type {
  CandidateKind,
  CodeBlock,
  ConfidenceTier,
  EpisodeBoundaryReason,
  EpisodeWindow,
  ExtractionOptions,
  ExtractionRun,
  InputShape,
  NoiseKind,
  NoiseRegion,
  NormalizedTranscript,
  NormalizedTurn,
  NormalizationStats,
  OffsetAnchor,
  OriginEvidence,
  ResolutionOutcome,
  ResolvedCandidate,
  ReviewAction,
  ReviewOutcome,
  StageName,
  StageReport,
} from "./types";

export {
  INPUT_SHAPES,
  TIER_HIGH_AT,
  isAccepted,
  TIER_LABELS,
  TIER_MEDIUM_AT,
  demoteTier,
  tierOf,
} from "./types";

/* ---- the orchestrator ---- */
export {
  describeOutcome,
  runExtraction,
  type ExtractionInput,
  type PipelineFailure,
  type PipelineOptions,
  type PipelineOutcome,
  type PipelineResult,
} from "./pipeline";

/* ---- coordinate systems ---- */
export {
  OffsetMapBuilder,
  anchorCount,
  identityMap,
  locateSnippet,
  normalisedAt,
  rawAt,
  rawBounds,
  spanFrom,
  type OffsetMap,
} from "./offset-map";
export {
  locateInEpisode,
  locateRange,
  nextTurn,
  toNormalised,
  turnsBySpeaker,
  type Located,
} from "./episode-position";

/* ---- stages: shared by both engines ---- */
export {
  DEFAULT_CHUNK_CHARS,
  chunkOfTurn,
  chunkTurns,
  describeChunking,
  overlappedTurnIndexes,
  type Chunk,
  type ChunkingResult,
} from "./chunking";
export {
  asAlreadyNormalised,
  describeNormalisation,
  findCodeBlocks,
  normaliseTranscript,
  toRawBounds,
  type NormalizerOptions,
} from "./normalizer";
export {
  describeSegmentation,
  episodeAt,
  segmentEpisodes,
  type SegmentationResult,
} from "./segmentation";
export {
  CUE_CONTEXT_CHARS,
  contextTokens,
  cueContext,
  cueCount,
  describeHits,
  episodeVariable,
  hasCue,
  longestCuePhrase,
  scanCues,
  strongestCue,
  variableAtCue,
  type CueHit,
} from "./cue-scan";
export {
  EMPTY_NOISE_SCAN,
  collapseNoise,
  placeholderFor,
  scanNoise,
  type NoiseScan,
} from "./noise";
export {
  accepts,
  attributeSpeakers,
  detectShape,
  isAcceptanceOnly,
  linesWithOffsets,
  looksLikeJsonl,
  matchMarker,
  reverses,
  trimTrailing,
  type AttributionResult,
  type LineSpan,
  type RawTurn,
  type SpeakerMarker,
} from "./speakers";
export {
  describeUncertainty,
  recoverTimestamp,
  resolveYear,
  type RecoveredTime,
} from "./timestamps";

/* ---- stages: recognition ---- */
export {
  describeFields,
  extractClauseFields,
  extractDownside,
  extractRationale,
} from "./rationale";
export {
  Y_SLOTS,
  Y_SLOT_LABELS,
  describeCompleteness,
  imperativeStatement,
  parseYStatement,
  renderYStatement,
  slotsFrom,
} from "./y-statement";
export {
  confidenceOf,
  describeRecovery as describeDecisionRecovery,
  recoverDecisions,
  type DecisionContext,
  type DecisionRecovery,
  type RecoveredDecision,
} from "./decisions";
export {
  describeRecovery as describePremiseRecovery,
  predicateFromCueRate,
  recoverPremises,
  type PremisePolarity,
  type PremiseRecovery,
  type RecoveredPremise,
} from "./premises";
export {
  allExclusionsFor,
  describeLinking,
  linkPremises,
  resolveJustification,
  type ExcludedPremise,
  type JustificationLink,
  type LinkedPremise,
  type PremiseLinking,
  type ResolvedJustification,
} from "./premise-linker";
export {
  ALTERNATIVE_MIN_CONFIDENCE,
  describeRecovery as describeAlternativeRecovery,
  recoverAlternatives,
  type AlternativeRecovery,
  type RecoveredAlternative,
} from "./alternatives";

/* ---- stages: provenance, confidence, resolution, voting ---- */
export {
  classifyOrigin,
  describeEngine,
  describeProvenance,
  isMachineOrigin,
  summariseOrigins,
  type OriginClassification,
  type OriginRule,
  type ProvenanceSummary,
} from "./provenance";
export {
  TIER_HINTS,
  describeHistogram,
  describeModalityDiscount,
  describeOriginDiscount,
  histogram,
  tierAlternative,
  tierDecision,
  tierPremise,
  type TierHistogram,
  type TieredAlternative,
  type TieredDecision,
  type TieredPremise,
} from "./confidence";
export {
  FAILURE_EXPLANATIONS,
  FAILED_VALIDATION_CONFIDENCE,
  MAX_SNIPPET_CHARS,
  describeValidation,
  discardsFromFailures,
  isUnverified,
  validateExtraction,
  validateSnippet,
  type SnippetFailure,
  type SnippetVerdict,
  type ValidatedExtraction,
  type ValidationReport,
} from "./snippet-validation";
export {
  conflictingDecisions,
  describeIdempotence,
  describeResolution,
  resolveExtraction,
  type ResolutionContext,
  type ResolutionReport,
  type ResolutionResult,
} from "./resolution";
export {
  DEFAULT_VOTING,
  MAJORITY_OF_THREE,
  SINGLETON_FACTOR,
  alternativeKey,
  decisionKey,
  describeAgreement,
  describeVoting,
  premiseKey,
  tierAfterVoting,
  voteAcrossRuns,
  type RunAgreement,
  type VoteOutcome,
  type VotingOptions,
} from "./voting";

/* ---- review and commit ----
 *
 * `export * as review` gives a namespace, and a namespace does NOT flatten: a
 * caller cannot `import { approve } from "@/extraction"` off it. Both forms are
 * exported, because the store and the review view want the flat names and a caller
 * that wants the whole surface should not have to list eighteen of them. */
export * as review from "./review";
export {
  DEFAULT_REVIEW_OPTIONS,
  EDITED_CONFIDENCE,
  MERGE_TARGETS_SHOWN,
  REVIEW_FILTERS,
  REVIEW_KEYS,
  applyAction,
  applyBatch,
  applyEdit,
  approve,
  contest,
  contestedIn,
  conflictsInBatch,
  describeAction,
  describeCommit,
  describeKeys,
  describeMergeTargets,
  describeQueue,
  discard,
  discardFrom,
  edit,
  filterQueue,
  isActedOn,
  isBulkApprovable,
  isDerivedPremise,
  mergeInto,
  previewCommit,
  queueFromRun,
  queueFromState,
  sortQueue,
  summariseCommit,
  summariseQueue,
  type CommitPreview,
  type QueueSummary,
  type ReviewFilter,
  type ReviewItem,
  type ReviewQueueOptions,
  type ReviewSort,
} from "./review";
export {
  PLACEHOLDER_EVENT_ID,
  commitReview,
  type CommitCounts,
  type CommitFailure,
  type CommitInput,
  type CommitOk,
  type CommitResult,
} from "./commit";
export {
  describeActions,
  describeCounts,
  describeFailure,
  describeInProgress,
} from "./commit-report";
