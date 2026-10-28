/**
 * The ablation harness — 7.3. One import site.
 */

export {
  DEFAULT_PARAMS,
  FULL,
  TOGGLE_IDS,
  ablationPlan,
  describePlan,
  fullPlan,
  parameterPlan,
  type Ablation,
  type AblationConfig,
  type SweptParams,
} from "./toggles";
export { runAblation, type AblationOutcome, type AblationStudy } from "./run";
export {
  renderAblationTable,
  renderPredictionAudit,
  summarizePredictionAudit,
  type DeltaRow,
  type PredictionAuditSummary,
} from "./table";
export {
  ABLATION_CACHE_PATH,
  ABLATION_CACHE_SCHEMA,
  ablationCacheUsable,
  cacheFromStudy,
  persistAblationAudit,
  planFingerprint,
  readAblationCache,
  writeAblationCache,
  type AblationCache,
} from "./cache";
