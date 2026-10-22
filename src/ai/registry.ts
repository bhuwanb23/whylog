/**
 * The engine registry.
 *
 * Phase 0 ú sub-phase 0.9
 *
 * Engines register themselves here; the app resolves one by id. Keeping
 * registration separate from construction means a provider adapter can be
 * lazy-loaded — an OpenAI client is only fetched when an OpenAI key exists, which
 * matters because the default build must work offline with no key.
 */

import type { EngineId } from "@/types/common";
import { EngineError } from "./errors";
import type { WhyLogEngine } from "./types";
import { NULL_CAPABILITIES } from "./types";

/** Constructs an engine from its configuration. May throw `EngineError`. */
export type EngineFactory = (options: EngineOptions) => WhyLogEngine;

export interface EngineOptions {
  readonly model: string;
  readonly apiKey: string | null;
  readonly dimensions: number;
  readonly voting: boolean;
  readonly questionGeneration: boolean;
}

interface Registration {
  readonly id: string;
  readonly label: string;
  readonly factory: EngineFactory;
  readonly requiresKey: boolean;
  readonly available: boolean;
}

const registry = new Map<string, Registration>();

export function registerEngine(registration: {
  id: string;
  label: string;
  factory: EngineFactory;
  requiresKey: boolean;
  available?: boolean;
}): void {
  registry.set(registration.id, {
    id: registration.id,
    label: registration.label,
    factory: registration.factory,
    requiresKey: registration.requiresKey,
    available: registration.available ?? true,
  });
}

export function unregisterEngine(id: string): void {
  registry.delete(id);
}

export interface EngineChoice {
  readonly id: string;
  readonly label: string;
  readonly requiresKey: boolean;
  readonly available: boolean;
}

/** Every registered engine, for the Settings dropdown. `local` sorts first
 *  because it is the default, not because of its id. */
export function listEngines(): readonly EngineChoice[] {
  return [...registry.values()]
    .map(
      (r): EngineChoice => ({
        id: r.id,
        label: r.label,
        requiresKey: r.requiresKey,
        available: r.available,
      }),
    )
    .sort((a, b) => {
      if (a.id === "local") return -1;
      if (b.id === "local") return 1;
      return a.label.localeCompare(b.label);
    });
}

/** Build an engine, or throw an `EngineError` naming the problem. */
export function createEngine(id: string, options: EngineOptions): WhyLogEngine {
  const registration = registry.get(id);
  if (registration === undefined) {
    throw new EngineError("unsupported", `No engine is registered under "${id}".`, { engine: id });
  }
  if (registration.requiresKey && (options.apiKey === null || options.apiKey.length === 0)) {
    throw new EngineError("no-key", `${registration.label} requires an API key.`, { engine: id });
  }
  return registration.factory(options);
}

/* -------------------------------------------------------------------------- */
/* The null engine                                                            */
/* -------------------------------------------------------------------------- */

/**
 * An engine that declares no capabilities.
 *
 * Returned when construction fails, so the app keeps running with everything
 * disabled rather than crashing on a bad key. Every control reads
 * `capabilities()` and greys out; the log, the graph and the exports all still
 * work, because none of them need an engine.
 */
export function nullEngine(reason: string): WhyLogEngine {
  const id: EngineId = { kind: "local", model: "unavailable" };

  const unsupported = async (): Promise<never> => {
    throw new EngineError("unsupported", reason, { engine: "null" });
  };

  return {
    id: () => id,
    capabilities: () => ({ ...NULL_CAPABILITIES, notes: reason }),
    dimensions: 0,
    extract: unsupported,
    classify: unsupported,
    embed: unsupported,
    rerank: unsupported,
    compose: unsupported,
    synthesizeGuards: unsupported,
  };
}

/** Clear everything. Used by tests and by a hard reset. */
export function clearRegistry(): void {
  registry.clear();
}
