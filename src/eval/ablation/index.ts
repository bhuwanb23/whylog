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
export { renderAblationTable, renderPredictionAudit, type DeltaRow } from "./table";
