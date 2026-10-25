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
import { create } from "zustand";
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

  return {
    config,
    engineId: engineIdOf(config),
    capabilities: null,
    hasKey: hasKey(config),
    keyHint: view.apiKeyHint,
    wantsLlm: config.wantsLlmWithoutKey,
    fallbackNotice: config.wantsLlmWithoutKey
      ? `${config.provider} is selected but no API key is stored. WhyLog is running the local engine — nothing has been sent anywhere.`
      : null,
    tauHigh: useTuning.getState().tauHigh,
    tauLow: useTuning.getState().tauLow,
    cascadeDepthCap: useTuning.getState().cascadeDepthCap,
    maxSearchSteps: useTuning.getState().maxSearchSteps,

    /* The stateless actions are real: they persist and invalidate. The two that
       need a re-render (reload, dismissFallbackNotice) are wired by the store. */
    /* `reloadFrom` is what `reload` does: re-read the persisted config after a write made outside
     * this object. It was declared and then discarded with a `void` statement, so `reload()` did
     * nothing — a settings control that silently no-ops is worse than one that is absent. */
    reload: () => reloadFrom(),
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
    /* These two are reasoning tuning, not engine config, so they persist separately — see
     * `useTuning` below. Delegating keeps ONE implementation of each setting rather than a second
     * copy that the Settings view could disagree with. */
    setThresholds: (tauHigh, tauLow) => {
      useTuning.getState().setThresholds(tauHigh, tauLow);
    },
    setCascadeDepthCap: (cap) => {
      useTuning.getState().setCascadeDepthCap(cap);
    },
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

/* -------------------------------------------------------------------------- */
/* Reasoning tuning — persisted, and actually consumed                        */
/* -------------------------------------------------------------------------- */

/**
 * The reasoning knobs §6.8 requires, persisted on their own key.
 *
 * Kept OUT of `EngineConfig` deliberately. These are reasoning settings, not engine settings, and
 * `EngineConfig` travels through the redaction and export paths — a confidence threshold has no
 * business being serialised next to an API key hint.
 *
 * Before this existed, `tauHigh`, `tauLow` and `cascadeDepthCap` were module constants surfaced in
 * `SettingsState` with setters that did nothing, and `revise()` never passed a depth cap to
 * `cascade()` — so the setting was inert end to end. A settings panel that renders a control which
 * cannot change anything is worse than no control, because it teaches the user that the panel is
 * decorative.
 */
export const TUNING_KEY = "whylog:settings:v1";

export interface TuningState {
  readonly tauHigh: number;
  readonly tauLow: number;
  readonly cascadeDepthCap: number;
  readonly maxSearchSteps: number;
  readonly setThresholds: (tauHigh: number, tauLow: number) => void;
  readonly setCascadeDepthCap: (cap: number) => void;
  readonly setMaxSearchSteps: (steps: number) => void;
  readonly reset: () => void;
}

interface PersistedTuning {
  readonly tauHigh?: number;
  readonly tauLow?: number;
  readonly cascadeDepthCap?: number;
  readonly maxSearchSteps?: number;
}

function readTuning(): Required<PersistedTuning> {
  const fallback = {
    tauHigh: TAU_HIGH,
    tauLow: TAU_LOW,
    cascadeDepthCap: DEFAULT_CASCADE_DEPTH_CAP,
    maxSearchSteps: DEFAULT_MAX_SEARCH_STEPS,
  };

  try {
    const raw = localStorage.getItem(TUNING_KEY);
    if (raw === null) return fallback;

    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return fallback;

    const record = parsed as PersistedTuning;
    return {
      tauHigh: numberOr(record.tauHigh, fallback.tauHigh, 0.5, 1),
      tauLow: numberOr(record.tauLow, fallback.tauLow, 0, 0.99),
      cascadeDepthCap: numberOr(record.cascadeDepthCap, fallback.cascadeDepthCap, 1, 12),
      maxSearchSteps: numberOr(record.maxSearchSteps, fallback.maxSearchSteps, 1, 3),
    };
  } catch {
    /* A corrupt tuning blob is not worth failing the app over; the defaults are safe and the user
     * can set them again. */
    return fallback;
  }
}

/** Clamped, because these values are consumed by algorithms with real assumptions: `tauLow` above
 *  `tauHigh` would make the identity resolver accept nothing and reject everything, and a cascade
 *  cap of 0 would silently disable the cascade rather than shorten it. */
function numberOr(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function writeTuning(state: Omit<TuningState, "setThresholds" | "setCascadeDepthCap" | "setMaxSearchSteps" | "reset">): void {
  try {
    localStorage.setItem(
      TUNING_KEY,
      JSON.stringify({
        tauHigh: state.tauHigh,
        tauLow: state.tauLow,
        cascadeDepthCap: state.cascadeDepthCap,
        maxSearchSteps: state.maxSearchSteps,
      }),
    );
  } catch {
    /* Quota or disabled storage. The values still apply for this session. */
  }
}

export const useTuning = create<TuningState>()((set, get) => ({
  ...readTuning(),

  setThresholds: (tauHigh, tauLow) => {
    /* Re-ordered rather than rejected when inverted, and the reason is reported by the caller's
     * clamp: a resolver whose low threshold sits above its high one has no ambiguous band at all,
     * so every comparison resolves as either a match or a miss and nothing is ever surfaced for
     * human confirmation. */
    const high = numberOr(tauHigh, TAU_HIGH, 0.5, 1);
    const low = numberOr(Math.min(tauLow, high - 0.01), TAU_LOW, 0, 0.99);
    set({ tauHigh: high, tauLow: low });
    writeTuning({ tauHigh: high, tauLow: low, cascadeDepthCap: get().cascadeDepthCap, maxSearchSteps: get().maxSearchSteps });
  },

  setCascadeDepthCap: (cap) => {
    const next = numberOr(cap, DEFAULT_CASCADE_DEPTH_CAP, 1, 12);
    set({ cascadeDepthCap: next });
    writeTuning({ tauHigh: get().tauHigh, tauLow: get().tauLow, cascadeDepthCap: next, maxSearchSteps: get().maxSearchSteps });
  },

  setMaxSearchSteps: (steps) => {
    /* Hard-capped at 3: the evidence contract's ceiling is not a user preference, because an
     * unbounded search turns "I could not find it" into "I have not looked hard enough yet". This
     * setting can only lower it. */
    const next = numberOr(steps, DEFAULT_MAX_SEARCH_STEPS, 1, 3);
    set({ maxSearchSteps: next });
    writeTuning({ tauHigh: get().tauHigh, tauLow: get().tauLow, cascadeDepthCap: get().cascadeDepthCap, maxSearchSteps: next });
  },

  reset: () => {
    const fresh = {
      tauHigh: TAU_HIGH,
      tauLow: TAU_LOW,
      cascadeDepthCap: DEFAULT_CASCADE_DEPTH_CAP,
      maxSearchSteps: DEFAULT_MAX_SEARCH_STEPS,
    };
    set(fresh);
    writeTuning(fresh);
  },
}));
