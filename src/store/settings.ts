/**
 * Settings slice: engine choice, thresholds, caps.
 *
 * Phase 0 · sub-phase 0.9
 *
 * ---------------------------------------------------------------------------
 * KEYS LIVE HERE AND NOWHERE ELSE
 *
 * The API key is read from and written to `whylog:config:v1` in localStorage via
 * src/ai/config.ts. It never enters the Zustand tree as anything other than the
 * `hasKey` boolean and a redacted hint, because the store is what React reads —
 * and anything React can read can end up in a component's props, a DevTools
 * inspection, or an error boundary's serialised state.
 *
 * The log is the shareable artifact. The key is not in it, not in the store, and
 * not in an export. See src/ai/config.ts for the full argument.
 * ---------------------------------------------------------------------------
 */

import type { EngineCapabilities } from "@/ai/types";
import type { EngineConfig } from "@/ai/config";
import {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  engineIdOf,
  forgetKey,
  hasKey,
  readConfig,
  redacted,
  writeConfig,
  type ProviderId,
} from "@/ai/config";
import { invalidateEngine } from "@/ai/engine";
import { TAU_HIGH, TAU_LOW } from "@/substrate/identity";
import type { EngineId } from "@/types/common";
import type { Result } from "@/lib/result";

export interface SettingsState {
  readonly config: EngineConfig;
  readonly engineId: EngineId;
  readonly capabilities: EngineCapabilities | null;
  readonly hasKey: boolean;
  readonly keyHint: string | null;
  /** Set when the user asked for an LLM engine and got local instead. The UI must
   *  say so; a silent fallback is the one thing this seam may not do. */
  readonly fallbackNotice: string | null;
  readonly wantsLlm: boolean;

  /* --- thresholds, surfaced so a demo can show their effect --- */
  readonly tauHigh: number;
  readonly tauLow: number;
  /** Cascade depth cap. Beyond it, propagation stops and the count of nodes
   *  potentially affected is reported rather than hidden. */
  readonly cascadeDepthCap: number;
  /** Maximum searches per question, from the RepoRationale evidence contract. */
  readonly maxSearchSteps: number;

  /* --- actions --- */
  readonly reload: () => void;
  readonly setProvider: (provider: ProviderId) => Result<void, string>;
  readonly setModel: (model: string) => Result<void, string>;
  readonly setApiKey: (key: string) => Result<void, string>;
  readonly clearKey: () => Result<void, string>;
  readonly setVoting: (on: boolean) => Result<void, string>;
  readonly setQuestionGeneration: (on: boolean) => Result<void, string>;
  readonly setThresholds: (tauHigh: number, tauLow: number) => void;
  readonly setCascadeDepthCap: (cap: number) => void;
  readonly dismissFallbackNotice: () => void;
}

/**
 * Phase 2 §2.7: "Depth is capped (default 4); beyond it, report 'N more potentially
 * affected' rather than flipping them."
 *
 * This was 6 when the settings store was written in Phase 0, before §2.7 existed in
 * code. Four is the plan's number and it is the right one: a chain longer than four
 * links is no longer something a human can follow in one reading, and the truncated
 * report is more useful than a longer chain nobody verifies. Backtracking keeps its own
 * cap of 6 because it searches a different shape — it must reach bedrock, and bedrock
 * can sit deeper than a cascade usefully propagates.
 */
export const DEFAULT_CASCADE_DEPTH_CAP = 4;
export const DEFAULT_MAX_SEARCH_STEPS = 3;

export function initialSettings(): SettingsState {
  const config = readConfig();
  const view = redacted(config);

  /** Every mutation goes through `applyConfig`, which writes to localStorage and
   *  then invalidates the resolved-engine cache. Forgetting the invalidation would
   *  keep stamping new nodes with the old engine id — the exact failure the
   *  "badged, never mixed" rule exists to prevent. */
  const mutate = (patch: Partial<EngineConfig>): Result<void, string> => applyConfig(config, patch).result;

  const reloadFrom = (): Pick<SettingsState, "config" | "engineId" | "hasKey" | "keyHint" | "wantsLlm"> => {
    const next = readConfig();
    const nextView = redacted(next);
    return {
      config: next,
      engineId: engineIdOf(next),
      hasKey: hasKey(next),
      keyHint: nextView.apiKeyHint,
      wantsLlm: next.wantsLlmWithoutKey,
    };
  };

  // `reloadFrom` exists so a component can re-read after a write without the
  // store having to expose the whole config lifecycle; the store calls it from
  // `refreshEngine`.
  void reloadFrom;

  return {
    config,
    engineId: engineIdOf(config),
    capabilities: null,
    hasKey: hasKey(config),
    keyHint: view.apiKeyHint,
    fallbackNotice: config.wantsLlmWithoutKey
      ? `${config.provider} is selected but no API key is stored. WhyLog is running the local engine — nothing has been sent anywhere.`
      : null,
    tauHigh: TAU_HIGH,
    tauLow: TAU_LOW,
    cascadeDepthCap: DEFAULT_CASCADE_DEPTH_CAP,
    maxSearchSteps: DEFAULT_MAX_SEARCH_STEPS,

    /* The stateless actions are real: they persist and invalidate. The two that
       need a re-render (reload, dismissFallbackNotice) are wired by the store. */
    reload: () => {},
    setProvider: (provider) => mutate({ provider, model: DEFAULT_MODELS[provider] }),
    setModel: (model) => mutate({ model }),
    setApiKey: (apiKey) =>
      mutate({ apiKey: apiKey.trim().length === 0 ? null : apiKey.trim(), wantsLlmWithoutKey: false }),
    clearKey: () => {
      const result = forgetKey();
      if (result.ok) invalidateEngine();
      return result;
    },
    setVoting: (voting) => mutate({ voting }),
    setQuestionGeneration: (questionGeneration) => mutate({ questionGeneration }),
    setThresholds: () => {},
    setCascadeDepthCap: () => {},
    dismissFallbackNotice: () => {},
  };
}

/**
 * Apply a configuration change.
 *
 * One path for every mutation, so `invalidateEngine()` cannot be forgotten: the
 * resolved engine is cached, and a stale cache would keep stamping new nodes with
 * the old engine id — the exact failure the "badged, never mixed" rule exists to
 * prevent.
 */
export function applyConfig(
  current: EngineConfig,
  patch: Partial<EngineConfig>,
): { config: EngineConfig; result: Result<void, string> } {
  const next: EngineConfig = { ...current, ...patch };
  const result = writeConfig(next);
  if (result.ok) invalidateEngine();
  return { config: result.ok ? next : current, result };
}

export function defaultConfig(): EngineConfig {
  return DEFAULT_CONFIG;
}

export { forgetKey };
