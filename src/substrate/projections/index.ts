/**
 * Projections: read-side views over the materialised state.
 *
 * Every projection is a pure function of `GraphState`. None of them stores
 * anything, and none of them is authoritative — the log is. Deleting this whole
 * directory would cost performance and nothing else.
 */

export * as decisions from "./decisions";
export * as premises from "./premises";
export * as justifications from "./justifications";
export * as labels from "./labels";
export * as edges from "./edges";
export * as indexes from "./indexes";
export * as metrics from "./metrics";
