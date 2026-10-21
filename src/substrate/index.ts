/**
 * L0 — the substrate.
 *
 * Phase 0 in full. Everything above this layer writes events through `event-log`
 * and reads projections through `projections`; nothing above it touches
 * localStorage, the hash chain or the fold directly.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR INVARIANTS, AS ENFORCED HERE
 *
 *   I1  nothing is deleted, everything is an event
 *       -> event-log.ts exposes `append` and no mutation path
 *   I2  premises are shared nodes
 *       -> identity.ts pools premises by type and merges onto existing nodes
 *   I3  retrieval proposes, a classifier disposes
 *       -> projections/indexes.ts builds candidate sets; nothing here labels
 *   I4  the system proposes, the human disposes
 *       -> projections/labels.ts returns changes; the caller commits them
 * ---------------------------------------------------------------------------
 */

/* --- the log --- */
export {
  append,
  appendBatch,
  appendSealed,
  currentEngine,
  describeActor,
  emptyLog,
  eventsOfType,
  historyOf,
  iterate,
  learnedBetween,
  loadLog,
  occurredBetween,
  recent,
  typeTally,
  actorTally,
  verify,
  type AppendContext,
  type AppendOutcome,
  type EventDraft,
  type EventLog,
} from "./event-log";

export {
  EVENT_TYPES,
  EVENT_TYPE_COUNT,
  isKnownEventType,
  payloadShapeOk,
  validateEvent,
  validateLoose,
  type PayloadOf,
  type ValidationContext,
} from "./event-validation";

/* --- the chain --- */
export {
  GENESIS_HASH,
  HASH_LENGTH,
  appendEvent,
  coerceEvent,
  describeVerification,
  hashEvent,
  headHash,
  linkHash,
  sealEvents,
  verifyChain,
  type ChainVerification,
  type ChainViolation,
} from "./hash-chain";

/* --- the fold --- */
export {
  applyBatch,
  applyEvent,
  applyToState,
  emptyDraft,
  emptyFold,
  finalise,
  fold,
  freeze,
  materializeAsOf,
  materializeThrough,
  rebuild,
  toDraft,
  type Draft,
  type FoldOptions,
} from "./materialize";

export {
  INDEX_UNBUILT,
  OTHER_VARIABLE_THRESHOLD,
  ZERO_COUNTERS,
  decisionIds,
  emptyLocalState,
  emptyState,
  isLive,
  labelHistogram,
  ontologyNeedsExtension,
  otherVariableRate,
  premiseIds,
  premiseTypeHistogram,
  type ContradictionRecord,
  type Counters,
  type ExportRecordState,
  type GraphState,
  type IndexStatus,
} from "./graph-state";

/* --- time --- */
export {
  NO_FILTER,
  byIdAsc,
  byLearnedAsc,
  byValidAsc,
  byValidDesc,
  closedWindow,
  compare,
  driftAgeDays,
  formatInterval,
  ingestionLagDays,
  isBackDated,
  isKnownAt,
  isOpen,
  isValidAt,
  learnedAgeDays,
  matchesAsOf,
  openWindow,
  overlapDays,
  overlaps,
  recency,
  reopenWindow,
  validAgeDays,
  type AsOfFilter,
} from "./bi-temporal";

/* --- identity --- */
export {
  IDENTITY_CANONICALIZER,
  LOCAL_TAU_HIGH,
  LOCAL_TAU_LOW,
  RUNG_NAMES,
  TAU_HIGH,
  TAU_LOW,
  decisionFingerprint,
  decisionPool,
  describeResolutionStats,
  emptyResolutionStats,
  lexicalSimilarity,
  premiseFingerprint,
  premisePool,
  recordResolution,
  resolveDecision,
  resolvePremise,
  thresholdsFor,
  type Canonicalizer,
  type DecisionCandidates,
  type DecisionResolution,
  type MergeOutcome,
  type PremiseCandidates,
  type PremiseResolution,
  type ResolveDecisionInput,
  type ResolvePremiseInput,
  type Resolution,
  type ResolutionAction,
  type ResolutionRung,
  type ResolutionStats,
} from "./identity";

/* --- persistence & portability --- */
export {
  CONFIG_STORAGE_KEY,
  INDEX_STORAGE_KEY,
  KNOWN_SCHEMA_VERSIONS,
  MIGRATIONS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  canLoad,
  migrateEvents,
  readSchemaVersion,
  reachableVersion,
  schemaMigratedPayload,
  type Migration,
  type MigrationOutcome,
  type MigrationStep,
} from "./schema";

export {
  clearApiKey,
  clearConfig,
  clearIndexBlob,
  clearLog,
  formatBytes,
  isPersistent,
  loadConfig,
  loadIndexBlob,
  loadLog as loadStoredLog,
  reclaimSpace,
  report as storageReport,
  resetStorageBackend,
  saveConfig,
  saveEvents,
  saveIndexBlob,
  saveLog as saveStoredLog,
  storage,
  useMemoryStorage,
  wipeAll,
  type StorageBackend,
  type StorageReport,
  type StoredConfig,
  type StoredLog,
} from "./persistence";

export {
  EXPORT_FILENAME,
  FORMAT_VERSION,
  MAGIC,
  describeImportOutcome,
  describeRejection,
  exportLog,
  importLog,
  reseal,
  serializeCompact,
  serializeLog,
  statsFromCounts,
  type ImportOutcome,
  type ImportRejection,
  type ImportResult,
  type PortableLog,
  type PortableStats,
} from "./portability";

/* --- snapshots --- */
export {
  emptyCache,
  isCurrent,
  nearestBefore,
  putSnapshot,
  relate,
  resolve as resolveSnapshot,
  stateAtIndex,
  takeSnapshot,
  type Snapshot,
  type SnapshotCache,
  type SnapshotRelation,
} from "./snapshot";

/* --- derived index artifacts --- */
export {
  INDEX_FORMAT_VERSION,
  assemble as assembleIndexArtifacts,
  availableLevels,
  describeEngine,
  emptyBlob,
  estimateBlobBytes,
  loadBlob as loadIndexStore,
  prune as pruneIndexStore,
  questionVectorFor,
  sameSpace,
  saveBlob as saveIndexStore,
  searchDense,
  staleness,
  upsertQuestionVectors,
  upsertVectors,
  vectorFor,
  vectorMap,
  type EmbedTarget,
  type StalenessReport,
  type StoredIndexBlob,
} from "./index-artifacts";

/* --- the export stamp --- */
export {
  STAMP_MARKER,
  buildStamp,
  complianceStatement,
  countChangedSince,
  describeVerification as describeStampVerification,
  parseStampBlock,
  premisesToRecheck,
  renderStampBlock,
  stripStampBlock,
  verifyStamp,
} from "./integrity";

/* --- projections --- */
export * as projections from "./projections";
