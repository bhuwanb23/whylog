/**
 * DecisionMemEval — the evaluation harness, the metric suite and the ablation study.
 *
 * Phase 7 · one import site.
 *
 * Four entry points, all runnable keyless:
 *   `npm run eval`           baseline run, thirteen metrics, every honest note printed
 *   `npm run eval:ablation`  fifteen configurations, delta table, prediction audit
 *   `npm run eval:report`    writes docs/generated/EVAL-REPORT.md
 *   `npm run readiness`      hard gates (exit code) + measured + known gaps (never gated)
 *
 * The modules below are pure: no filesystem, no console, no `process`. Only `cli.ts`, `run.ts`,
 * `report.ts`, `readiness.ts` and `ablation/cli.ts` touch the outside world, which is what keeps the
 * suite importable from the browser build without dragging Node into a Vite bundle.
 */

/* --- the corpus (7.1) --- */
export {
  CORPUS_ROOT,
  CORPUS_VERSION,
  DEMO_FIXTURE_IDS,
  corpus,
} from "./corpus/data";
export { describeCorpus, compositionOf } from "./corpus/labels";
export type {
  Corpus,
  CorpusComposition,
  CorpusTier,
  FalsifyStep,
  LabelledAlternative,
  LabelledDecision,
  LabelledEpisode,
  LabelledPremise,
  LabelledQuestion,
  LabelledTranscript,
  Plant,
  PlantKind,
  PlantLevel,
  ResolvedAlternative,
  ResolvedCorpus,
  ResolvedDecision,
  ResolvedPremise,
  ResolvedTranscript,
} from "./corpus/labels";
export { describeLoad, findSpan, loadCorpus } from "./corpus/loader";
export type { LoadReport } from "./corpus/loader";

/* --- the harness (7.2) --- */
export {
  alternativesOf,
  decisionsOf,
  describeFailures,
  eventsOf,
  guardsOf,
  labelOf,
  premisesOf,
  runConfig,
} from "./harness";
export type {
  InterventionOutcome,
  QuestionRun,
  RunConfig,
  RunResult,
  TranscriptRun,
} from "./harness";

/* --- the metric suite (7.2) --- */
export {
  buildResolver,
  metricById,
  metricsWithoutComparator,
  renderSuite,
  scoreAll,
  unusualMetrics,
} from "./metrics";
export type { ScoredRun } from "./metrics";
export {
  COMPARATORS,
  METRIC_NAMES,
  UNUSUAL_METRICS,
  meanReciprocalRank,
  precisionAtK,
  precisionRecall,
} from "./metrics/types";
export type { EngineMetric, MetricId, MetricResult, PrecisionRecall } from "./metrics/types";
export { MATCH_RULE, align, overlapOf } from "./metrics/match";
export type { Alignment, AlignedPair, Span } from "./metrics/match";

/* --- the ablation study (7.3) --- */
export {
  DEFAULT_PARAMS,
  EXPECTED_DAMAGE,
  FULL,
  NOISE_FLOOR,
  TOGGLE_IDS,
  ablationPlan,
  describePlan,
  fullPlan,
  parameterPlan,
} from "./ablation/toggles";
export type { Ablation, AblationConfig, SweptParams } from "./ablation/toggles";
export { describeStudy, runAblation } from "./ablation/run";
export type { AblationOutcome, AblationStudy, StudyOptions } from "./ablation/run";
export {
  TABLE_METRICS,
  buildDeltaRows,
  renderAblationTable,
  renderPredictionAudit,
  summarizePredictionAudit,
} from "./ablation/table";
export type {
  DeltaRow,
  PredictionAuditSummary,
  PredictionVerdict,
  VerdictKind,
} from "./ablation/table";
export {
  ABLATION_CACHE_PATH,
  ABLATION_CACHE_SCHEMA,
  ablationCacheUsable,
  cacheFromStudy,
  persistAblationAudit,
  planFingerprint,
  readAblationCache,
  writeAblationCache,
} from "./ablation/cache";
export type { AblationCache } from "./ablation/cache";

/* --- hardening (7.4) --- */
export { checkDemoKillers, checkFailureModes, harden, renderHardening } from "./hardening";
export type { DemoKiller, FailureModeCheck, HardeningReport } from "./hardening";

/* --- the report (7.7) --- */
export { renderFullReport } from "./report";
