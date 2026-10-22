/**
 * The engine facade — `getEngine()`.
 *
 * Phase 0 · sub-phase 0.9
 *
 * ---------------------------------------------------------------------------
 * THE ONE CALL SITE
 *
 * Everything above the seam asks for an engine here and nowhere else. That is
 * what makes "badged, never mixed" enforceable: there is a single place where the
 * active engine is decided, a single place that stamps results, and a single place
 * that can be inspected when a node's provenance looks wrong.
 *
 * Resolution order:
 *   1. read the stored configuration
 *   2. if the requested engine is usable, build it
 *   3. otherwise build the LOCAL engine and report the fallback
 *
 * Step 3 is not an error and is not silent. `getEngine()` returns the reason
 * alongside the engine so the UI can say "you asked for GPT, there is no key, this
 * is local" — the one behaviour the seam must never have is a quiet substitution.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import {
  DEFAULT_CONFIG,
  type EngineConfig,
  embeddingEngineIdOf,
  readConfig,
  resolveEngine,
} from "./config";
import { EngineError, describeError } from "./errors";
import { createEngine, listEngines, nullEngine } from "./registry";
import type { WhyLogEngine } from "./types";
import type { LOCAL_CAPABILITIES } from "./types";

export interface ActiveEngine {
  readonly engine: WhyLogEngine;
  readonly id: EngineId;
  readonly config: EngineConfig;
  /** True when the user asked for something else and got local instead. */
  readonly fellBack: boolean;
  readonly fallbackReason: string | null;
  /** The engine id that will be stamped on EMBEDDINGS, which can differ from the
   *  chat engine id (Anthropic has no first-party embedding model). */
  readonly embeddingId: EngineId;
}

let cached: ActiveEngine | null = null;
let cachedKey: string | null = null;

function configKey(config: EngineConfig): string {
  // The key is part of the identity of the resolved engine: adding one must
  // invalidate the cache even when nothing else changed.
  return `${config.provider}|${config.model}|${config.apiKey === null ? "" : "key"}|${config.voting}|${config.questionGeneration}`;
}

/**
 * The active engine.
 *
 * Cached on the resolved configuration, so repeated calls during one render pass
 * do not reconstruct an HTTP client. `invalidateEngine()` clears it after any
 * configuration write.
 */
export function getEngine(): ActiveEngine {
  const config = readConfig();
  const key = configKey(config);

  if (cached !== null && cachedKey === key) return cached;

  const resolved = resolveEngine(config);
  const engineId = resolved.config.provider;

  let engine: WhyLogEngine;
  let fellBack = resolved.fellBack;
  let reason = resolved.reason;

  try {
    engine = createEngine(engineId, {
      model: resolved.config.model,
      apiKey: resolved.config.apiKey,
      dimensions: resolved.config.localDimensions,
      voting: resolved.config.voting,
      questionGeneration: resolved.config.questionGeneration,
    });
  } catch (error) {
    // Construction failed. Fall back to local rather than returning a dead app;
    // if local itself is unregistered something is deeply wrong and the null
    // engine keeps the UI alive with everything disabled.
    fellBack = true;
    reason = error instanceof EngineError ? describeError(error) : String(error);
    engine = tryLocal(resolved.config) ?? nullEngine(reason);
  }

  const active: ActiveEngine = {
    engine,
    id: engine.id(),
    config: resolved.config,
    fellBack,
    fallbackReason: reason,
    embeddingId: embeddingEngineIdOf(resolved.config),
  };

  cached = active;
  cachedKey = key;
  return active;
}

function tryLocal(config: EngineConfig): WhyLogEngine | null {
  try {
    return createEngine("local", {
      model: DEFAULT_CONFIG.model,
      apiKey: null,
      dimensions: config.localDimensions,
      voting: false,
      questionGeneration: false,
    });
  } catch {
    return null;
  }
}

/** Call after any configuration write, or after registering a new engine. */
export function invalidateEngine(): void {
  cached = null;
  cachedKey = null;
}

/** The local engine specifically, regardless of configuration. Used by the
 *  ablation harness (Phase 7.6) and by anything that must be reproducible. */
export function getLocalEngine(): WhyLogEngine {
  return (
    tryLocal(readConfig()) ??
    nullEngine("The local engine is not registered. This is a build error.")
  );
}

/** The engine id that will stamp the NEXT extraction. Shown next to the Extract
 *  button, before the user presses it — the badge is a promise, not a footnote. */
export function activeEngineId(): EngineId {
  return getEngine().id;
}

export function activeCapabilities() {
  return getEngine().engine.capabilities();
}

/** Can the app do this at all, right now? One call, one answer, and the UI never
 *  has to reason about providers. */
export function can(capability: keyof typeof LOCAL_CAPABILITIES): boolean {
  const capabilities = activeCapabilities();
  const value = capabilities[capability];
  return value === true || value === "template-only" || value === "llm";
}

export { listEngines };
