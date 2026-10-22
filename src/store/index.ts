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
