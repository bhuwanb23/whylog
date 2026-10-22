/**
 * Engine configuration.
 *
 * Phase 0 ú sub-phase 0.9
 *
 * ---------------------------------------------------------------------------
 * WHERE THE KEY LIVES, AND WHERE IT NEVER GOES
 *
 *   localStorage, under `whylog:config:v1`. Nowhere else.
 *
 * Never in an event. Never in a payload. Never in an export. Never in a stamp.
 * Never written to the console, not even in development, not even truncated.
 *
 * The reason is structural rather than a policy: the event log is DESIGNED to be
 * shared. The portable JSON is the product's own `requirement.portability`
 * premise made real — one file you can email, commit, or hand to a teammate. A
 * secret in a shareable artifact is a leaked secret, and "we redact on export" is
 * a control that fails the first time somebody forgets. So the secret is not in
 * the thing that gets shared.
 *
 * Corollary: switching engines writes an `EngineSwitched` event carrying only the
 * two `EngineId`s — kind and model name — which are not secrets and ARE history.
 * ---------------------------------------------------------------------------
 */

import { type Result, err, ok } from "@/lib/result";
import {
  type StoredConfig,
  clearApiKey as clearStoredKey,
  loadConfig,
  saveConfig,
} from "@/substrate/persistence";
import type { EngineId } from "@/types/common";

export type ProviderId = "openai" | "anthropic" | "openrouter" | "local";

export const PROVIDERS: readonly ProviderId[] = ["local", "openai", "anthropic", "openrouter"];

export interface EngineConfig {
  /** "local" is the default and is always available. */
  readonly provider: ProviderId;
  readonly model: string;
  /** Present only when a key has been saved. */
  readonly apiKey: string | null;
  /** The user asked for the LLM path but no key is present. The app then runs
   *  local and says so, rather than silently doing something other than what was
   *  requested. */
  readonly wantsLlmWithoutKey: boolean;
  /** Three-run majority voting. Off by default: it triples the cost and the
   *  benefit is measurable but not free (plan/phase-1 §1.8). */
  readonly voting: boolean;
  /** HyPE-style index-time questions. Costs one call per decision at index time
   *  and nothing at query time, which is why it defaults on for the LLM path. */
  readonly questionGeneration: boolean;
  /** Embedding dimensions the local vectoriser produces. Fixed at 512, matching
   *  the ~1 MB / 500 decisions budget in docs/03. */
  readonly localDimensions: number;
}

export const LOCAL_DIMENSIONS = 512;

export const DEFAULT_CONFIG: EngineConfig = {
  provider: "local",
  model: "deterministic-v1",
  apiKey: null,
  wantsLlmWithoutKey: false,
  voting: false,
  questionGeneration: false,
  localDimensions: LOCAL_DIMENSIONS,
};

/** Default model per provider. A guess, and labelled as one in Settings: the
 *  right model is whoever's the user is paying for. */
export const DEFAULT_MODELS: Readonly<Record<ProviderId, string>> = {
  local: "deterministic-v1",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  openrouter: "openai/gpt-4o-mini",
};

/** Embedding model per provider. Separate from the chat model because the two are
 *  priced and versioned independently, and because changing the EMBEDDING model
 *  invalidates the index while changing the chat model does not. */
export const EMBEDDING_MODELS: Readonly<Record<ProviderId, string>> = {
  local: "hashed-ngram-v1",
  openai: "text-embedding-3-small",
  anthropic: "",
  openrouter: "openai/text-embedding-3-small",
};

/* -------------------------------------------------------------------------- */
/* Read / write                                                               */
/* -------------------------------------------------------------------------- */

export function readConfig(): EngineConfig {
  const stored = loadConfig();
  if (!stored.ok || stored.value === null) return DEFAULT_CONFIG;
  return fromStored(stored.value);
}

function fromStored(stored: StoredConfig): EngineConfig {
  // `engineKind` is the authority on WHICH engine runs; `provider` only says
  // which remote provider to use when that engine is the LLM one. Reading the
  // provider alone would report "openai" for a log that is running locally.
  const requested = stored.engineKind === "local" ? "local" : stored.provider;
  const provider: ProviderId = isProvider(requested) ? requested : "local";

  return {
    provider,
    model: stored.model ?? DEFAULT_MODELS[provider],
    apiKey: stored.apiKey ?? null,
    wantsLlmWithoutKey: stored.engineKind === "llm" && stored.apiKey === undefined,
    voting: false,
    questionGeneration: provider !== "local",
    localDimensions: LOCAL_DIMENSIONS,
  };
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export function writeConfig(config: EngineConfig): Result<void, string> {
  const stored: StoredConfig = {
    schemaVersion: 1,
    engineKind: config.provider === "local" ? "local" : "llm",
    ...(config.provider === "local" ? {} : { provider: config.provider }),
    model: config.model,
    ...(config.apiKey === null ? {} : { apiKey: config.apiKey }),
    savedAt: new Date().toISOString() as never,
  };
  return saveConfig(stored);
}

export function forgetKey(): Result<void, string> {
  const cleared = clearStoredKey();
  return cleared.ok ? ok(undefined) : err(cleared.error);
}

/* -------------------------------------------------------------------------- */
/* Derived                                                                    */
/* -------------------------------------------------------------------------- */

/** The `EngineId` this configuration produces. Stored on every node. */
export function engineIdOf(config: EngineConfig): EngineId {
  return config.provider === "local"
    ? { kind: "local", model: config.model }
    : { kind: "llm", model: `${config.provider}/${config.model}` };
}

/** The embedding engine id. Different from the chat id when the provider has a
 *  separate embedding model, and it is THIS id the index is tagged with. */
export function embeddingEngineIdOf(config: EngineConfig): EngineId {
  if (config.provider === "local") return { kind: "local", model: EMBEDDING_MODELS.local };
  const model = EMBEDDING_MODELS[config.provider];
  // Anthropic has no first-party embedding model; the index therefore stays local
  // unless the user routes embeddings elsewhere. Saying so beats pretending.
  if (model.length === 0) return { kind: "local", model: EMBEDDING_MODELS.local };
  return { kind: "llm", model };
}

/** Can the LLM path actually be used? The single check the UI and the resolver
 *  both need, in one place so they cannot disagree. */
export function isLlmUsable(config: EngineConfig): boolean {
  return config.provider !== "local" && config.apiKey !== null && config.apiKey.length > 0;
}

/**
 * Resolve what the app will actually run.
 *
 * Returns the requested engine when it is usable, and the local engine otherwise —
 * with `fellBack` set, so the caller can TELL THE USER. A silent fallback is the
 * one behaviour this seam must not have: the user would believe their transcript
 * went to a provider when it did not, or vice versa.
 */
export function resolveEngine(config: EngineConfig): {
  readonly config: EngineConfig;
  readonly fellBack: boolean;
  readonly reason: string | null;
} {
  if (config.provider === "local") {
    return { config, fellBack: false, reason: null };
  }
  if (isLlmUsable(config)) {
    return { config, fellBack: false, reason: null };
  }
  return {
    config: { ...DEFAULT_CONFIG, apiKey: null, wantsLlmWithoutKey: true },
    fellBack: true,
    reason: `${config.provider} was selected but no API key is stored. Running the local engine instead — nothing was sent anywhere.`,
  };
}

/** A redacted view, safe to log and to render. The key becomes a shape hint so
 *  the user can confirm WHICH key is loaded without it being readable. */
export function redacted(config: EngineConfig): Omit<EngineConfig, "apiKey"> & {
  apiKeyHint: string | null;
} {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    apiKeyHint: apiKey === null ? null : keyHint(apiKey),
  };
}

function keyHint(key: string): string {
  if (key.length < 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
}

/** Never returns the key. Exists so a code reviewer can grep for the one place
 *  the raw value is read, which is `readConfig`, and nowhere else. */
export function hasKey(config: EngineConfig): boolean {
  return config.apiKey !== null && config.apiKey.length > 0;
}
