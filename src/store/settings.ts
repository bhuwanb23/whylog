/**
 * WhyLog settings — persisted tuning state under `whylog:settings:v1`.
 *
 * Phase 2 · sub-phase 2.7 (the settings store)
 *
 * SECURITY NOTE: The provider API key is stored in `localStorage` under the same
 * origin as this settings store. This is acceptable ONLY because WhyLog is a
 * browser-only app with no backend and no server auth. The key is safe here only
 * while the origin has no XSS. See README § Security posture.
 */

import {
  type EngineConfig,
  type EngineId,
  applyConfig,
  engineIdOf,
  forgetKey,
  hasKey,
  readConfig,
} from "../ai/config";
import type { Result } from "../lib/result";

const SETTINGS_KEY = "whylog:settings:v1";

export const DEFAULT_MODELS: Readonly<Record<string, string>> = {
  openai: "gpt-5",
  openrouter: "openai/gpt-oss-20b",
  anthropic: "claude-sonnet-4-6",
  local: "local",
};

export const DEFAULT_CASCADE_DEPTH_CAP = 4;
export const DEFAULT_MAX_SEARCH_STEPS = 3;

export interface SettingsState {
  readonly config: EngineConfig;
  readonly engineId: EngineId;
  readonly capabilities: unknown | null;
  readonly hasKey: boolean;
  readonly keyHint: string | undefined;
  readonly wantsLlm: boolean;
  readonly fallbackNotice: string | null;
  readonly tauHigh: number;
  readonly tauLow: number;
  readonly cascadeDepthCap: number;
  readonly maxSearchSteps: number;
  readonly reload: () => SettingsState;
  readonly setProvider: (provider: string) => Result<void, string>;
  readonly setModel: (model: string) => Result<void, string>;
  readonly setApiKey: (apiKey: string) => Result<void, string>;
  readonly clearKey: () => Result<void, string>;
  readonly setVoting: (voting: boolean) => Result<void, string>;
  readonly setQuestionGeneration: (questionGeneration: boolean) => Result<void, string>;
  readonly setThresholds: (tauHigh: number, tauLow: number) => void;
  readonly setCascadeDepthCap: (cap: number) => void;
  readonly dismissFallbackNotice: () => void;
}

function settingsKeyHint(config: EngineConfig): string | undefined {
  if (config.apiKey === null) return undefined;
  const head = config.apiKey.slice(0, 8);
  if (head.length === 0) return undefined;
  return head + "…";
}

function redacted(config: EngineConfig): EngineConfig {
  return { ...config, apiKey: null };
}

interface TuningState {
  tauHigh: number;
  tauLow: number;
  cascadeDepthCap: number;
  maxSearchSteps: number;
}

function makeTuningStore(seed?: Partial<TuningState>) {
  const state: TuningState = {
    tauHigh: 0.9,
    tauLow: 0.6,
    cascadeDepthCap: DEFAULT_CASCADE_DEPTH_CAP,
    maxSearchSteps: DEFAULT_MAX_SEARCH_STEPS,
    ...seed,
  };

  const actions = {
    setThresholds: (tauHigh: number, tauLow: number) => {
      state.tauHigh = tauHigh;
      state.tauLow = tauLow;
      persistTuning();
    },
    setCascadeDepthCap: (cap: number) => {
      state.cascadeDepthCap = cap;
      persistTuning();
    },
    setMaxSearchSteps: (n: number) => {
      state.maxSearchSteps = n;
      persistTuning();
    },
    reset: () => {
      state.tauHigh = 0.9;
      state.tauLow = 0.6;
      state.cascadeDepthCap = DEFAULT_CASCADE_DEPTH_CAP;
      state.maxSearchSteps = DEFAULT_MAX_SEARCH_STEPS;
      persistTuning();
    },
  };

  return {
    getState() {
      return {
        get tauHigh() {
          return state.tauHigh;
        },
        get tauLow() {
          return state.tauLow;
        },
        get cascadeDepthCap() {
          return state.cascadeDepthCap;
        },
        get maxSearchSteps() {
          return state.maxSearchSteps;
        },
        ...actions,
      };
    },
    subscribe: () => () => {},
  };
}

function persistTuning() {
  try {
    const s = tuningStore.getState();
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        tauHigh: s.tauHigh,
        tauLow: s.tauLow,
        cascadeDepthCap: s.cascadeDepthCap,
        maxSearchSteps: s.maxSearchSteps,
      }),
    );
  } catch (_) {
    /* storage full or unavailable — the setting the user just changed is one they
     * have to set again next session, not a crash. */
  }
}

const tuningStore = makeTuningStore();

// The barrel symbol is the store itself. Call sites do
// `useTuning.getState().setCascadeDepthCap(...)` exactly as the integration
// test and the reasoning store do.
export const useTuning = tuningStore;

export function initialSettings(): SettingsState {
  const config = readConfig();
  const mutate = (patch: Partial<EngineConfig>): Result<void, string> => applyConfig(config, patch);

  const reloadFrom = (): SettingsState => {
    const next = readConfig();
    const s = tuningStore.getState();
    return {
      config: next,
      engineId: engineIdOf(next),
      capabilities: null,
      hasKey: hasKey(next),
      keyHint: settingsKeyHint(next),
      wantsLlm: next.wantsLlmWithoutKey,
      fallbackNotice: next.wantsLlmWithoutKey
        ? `${next.provider} is selected but no API key is stored. WhyLog is running the local engine — nothing has been sent anywhere.`
        : null,
      tauHigh: s.tauHigh,
      tauLow: s.tauLow,
      cascadeDepthCap: s.cascadeDepthCap,
      maxSearchSteps: s.maxSearchSteps,
      reload: reloadFrom,
      setProvider: (provider: string) =>
        mutate({
          provider: provider as any,
          model: DEFAULT_MODELS[provider] ?? "gpt-5",
        }),
      setModel: (model: string) => mutate({ model }),
      setApiKey: (apiKey: string) => {
        mutate({
          apiKey: apiKey.trim().length === 0 ? null : apiKey.trim(),
          wantsLlmWithoutKey: false,
        });
        return { ok: true, value: undefined };
      },
      clearKey: () => {
        const result = forgetKey();
        if (result.ok) invalidateEngine();
        return result;
      },
      setVoting: (voting: boolean) => mutate({ voting } as Partial<EngineConfig>),
      setQuestionGeneration: (questionGeneration: boolean) =>
        mutate({ questionGeneration } as Partial<EngineConfig>),
      setThresholds: (tauHigh: number, tauLow: number) =>
        tuningStore.getState().setThresholds(tauHigh, tauLow),
      setCascadeDepthCap: (cap: number) => tuningStore.getState().setCascadeDepthCap(cap),
      dismissFallbackNotice: () => {},
    };
  };

  return reloadFrom();
}

function invalidateEngine(): void {
  void 0;
}
