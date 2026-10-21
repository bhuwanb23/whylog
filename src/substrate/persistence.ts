/**
 * Persistence: the log lives in localStorage.
 *
 * Phase 0 · sub-phase 0.6
 * Plan: plan/phase-0-foundation.md §0.6
 *
 * ---------------------------------------------------------------------------
 * WHY localStorage AND NOT A DATABASE
 *
 * No DB client is in the dependency budget, and the honest reason is that a
 * decision log for one person on one machine does not need one. The portable
 * artifact is a JSON file of EVENTS; localStorage is the working copy. Anything
 * that can hold a string can hold a WhyLog log, which is what makes the
 * `requirement.portability` premise of the product itself true of the product.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED AND WHAT IS NOT
 *
 *   STORED   `whylog:v1`        events + head hash. The log.
 *   STORED   `whylog:index:v1`  embeddings and derived indexes. DISPOSABLE.
 *   STORED   `whylog:config:v1` engine choice and API keys. Never exported.
 *
 * The index is deliberately separate: it is derived data that can be rebuilt, it
 * is the largest thing on disk (~1 MB at 500 decisions x 512 float32), and it is
 * the first thing to drop when the quota is hit. Losing it costs a re-embed.
 * Losing an event costs history that cannot be recovered.
 *
 * ---------------------------------------------------------------------------
 * FAILURE IS EXPECTED, NOT EXCEPTIONAL
 *
 * localStorage throws in private-mode Safari, in sandboxed iframes, when the
 * quota is full, and when the browser has been configured to block it. Every
 * function here returns a Result rather than throwing, and there is an in-memory
 * backend so the app still boots and still works for one session. A tool that
 * cannot remember anything is still more useful than a blank screen.
 * ---------------------------------------------------------------------------
 */

import { err, ok, type Result } from "@/lib/result";
import { nowISO } from "@/lib/format";
import type { ISODateString } from "@/types/common";
import type { AnyEvent } from "@/types/events";
import { CONFIG_STORAGE_KEY, INDEX_STORAGE_KEY, STORAGE_KEY, SCHEMA_VERSION } from "./schema";

/* -------------------------------------------------------------------------- */
/* The storage backend                                                        */
/* -------------------------------------------------------------------------- */

export interface StorageBackend {
  readonly kind: "local-storage" | "memory";
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Approximate bytes in use across our keys. */
  usage(): number;
}

/** In-memory fallback. Survives a reload only in the sense that it does not —
 *  but it lets the app boot, render, and be used for one session. */
function memoryBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    kind: "memory",
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    usage: () => {
      let total = 0;
      for (const [key, value] of map) total += key.length + value.length;
      return total * 2; // UTF-16
    },
  };
}

function detectLocalStorage(): StorageBackend | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__whylog_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);

    return {
      kind: "local-storage",
      get: (key) => localStorage.getItem(key),
      set: (key, value) => {
        localStorage.setItem(key, value);
      },
      remove: (key) => {
        localStorage.removeItem(key);
      },
      usage: () => {
        let total = 0;
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key === null || !key.startsWith("whylog:")) continue;
          total += key.length + (localStorage.getItem(key)?.length ?? 0);
        }
        return total * 2;
      },
    };
  } catch {
    return null;
  }
}

let backend: StorageBackend | null = null;

/** The resolved backend. Never throws; falls back to memory. */
export function storage(): StorageBackend {
  if (backend) return backend;
  backend = detectLocalStorage() ?? memoryBackend();
  return backend;
}

/** Force the in-memory backend. Used by tests and by the "start a fresh log"
 *  action, which must not touch a real browser profile. */
export function useMemoryStorage(): void {
  backend = memoryBackend();
}

export function resetStorageBackend(): void {
  backend = null;
}

export function isPersistent(): boolean {
  return storage().kind === "local-storage";
}

/* -------------------------------------------------------------------------- */
/* The stored shapes                                                          */
/* -------------------------------------------------------------------------- */

export interface StoredLog {
  readonly schemaVersion: number;
  readonly events: readonly AnyEvent[];
  readonly headHash: string;
  readonly savedAt: ISODateString;
}

export interface StoredConfig {
  readonly schemaVersion: number;
  readonly engineKind: "local" | "llm";
  readonly provider?: string;
  readonly model?: string;
  /**
   * The API key.
   *
   * Lives HERE and nowhere else: never in an event, never in a payload, never in
   * an export, never in a log line. The event log is designed to be shared —
   * that is the whole point of the portable JSON — so anything that must not be
   * shared must not be in it.
   */
  readonly apiKey?: string;
  readonly savedAt: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* Read / write                                                               */
/* -------------------------------------------------------------------------- */

export type LoadResult<T> = Result<T | null, string>;

function readJson<T>(key: string): Result<T | null, string> {
  const raw = storage().get(key);
  if (raw === null) return ok(null);

  try {
    return ok(JSON.parse(raw) as T);
  } catch (error) {
    // A corrupt blob is treated as absent rather than fatal: the log is the only
    // irreplaceable artifact, and even then an import can restore it.
    return err(`${key} is not valid JSON (${String(error)})`);
  }
}

function writeJson(key: string, value: unknown): Result<void, string> {
  try {
    storage().set(key, JSON.stringify(value));
    return ok(undefined);
  } catch (error) {
    return err(quotaMessage(key, error));
  }
}

function quotaMessage(key: string, error: unknown): string {
  const text = String(error);
  const isQuota =
    text.includes("QuotaExceeded") ||
    text.includes("quota") ||
    text.includes("NS_ERROR_DOM_QUOTA_REACHED");
  return isQuota
    ? `Browser storage is full and "${key}" could not be written. Export your log to a file now — that is what the portable JSON is for — then drop the embedding index from Settings to free ~1 MB.`
    : `Could not write "${key}": ${text}`;
}

export function loadLog(): LoadResult<StoredLog> {
  return readJson<StoredLog>(STORAGE_KEY);
}

export function saveLog(log: StoredLog): Result<void, string> {
  return writeJson(STORAGE_KEY, log);
}

/** Save with a timestamp supplied by the caller, so the write stays pure with
 *  respect to the fold. */
export function saveEvents(
  events: readonly AnyEvent[],
  headHash: string,
  at: ISODateString = nowISO(),
): Result<void, string> {
  return saveLog({ schemaVersion: SCHEMA_VERSION, events, headHash, savedAt: at });
}

export function clearLog(): void {
  storage().remove(STORAGE_KEY);
}

export function loadIndexBlob(): LoadResult<unknown> {
  return readJson<unknown>(INDEX_STORAGE_KEY);
}

export function saveIndexBlob(blob: unknown): Result<void, string> {
  return writeJson(INDEX_STORAGE_KEY, blob);
}

/**
 * Drop the embedding index.
 *
 * Safe by construction: the index is derived data, and the log records only an
 * `IndexRebuilt` event, never a vector. Clearing this is the recovery path for a
 * full quota and costs one re-embed.
 */
export function clearIndexBlob(): void {
  storage().remove(INDEX_STORAGE_KEY);
}

export function loadConfig(): LoadResult<StoredConfig> {
  return readJson<StoredConfig>(CONFIG_STORAGE_KEY);
}

export function saveConfig(config: Omit<StoredConfig, "savedAt">, at: ISODateString = nowISO()): Result<void, string> {
  return writeJson(CONFIG_STORAGE_KEY, { ...config, schemaVersion: SCHEMA_VERSION, savedAt: at });
}

export function clearConfig(): void {
  storage().remove(CONFIG_STORAGE_KEY);
}

/** Remove the API key but keep the engine choice. "Stop sending my transcript to
 *  a provider" must not mean "lose my settings". */
export function clearApiKey(): Result<void, string> {
  const current = loadConfig();
  if (!current.ok) return current;
  if (current.value === null) return ok(undefined);

  const { apiKey: _dropped, ...rest } = current.value;
  return writeJson(CONFIG_STORAGE_KEY, rest);
}

/* -------------------------------------------------------------------------- */
/* Introspection                                                              */
/* -------------------------------------------------------------------------- */

export interface StorageReport {
  readonly backend: "local-storage" | "memory";
  readonly persistent: boolean;
  readonly logBytes: number;
  readonly indexBytes: number;
  readonly configBytes: number;
  readonly totalBytes: number;
  readonly eventCount: number;
  /** Rough quota headroom. Browsers do not expose the real limit, so this is an
   *  estimate against the 5 MB figure most engines use per origin. */
  readonly estimatedQuotaBytes: number;
  readonly headroomBytes: number;
}

const ESTIMATED_QUOTA = 5 * 1024 * 1024;

export function report(): StorageReport {
  const store = storage();
  const sizeOf = (key: string): number => (store.get(key)?.length ?? 0) * 2;

  const logBytes = sizeOf(STORAGE_KEY);
  const indexBytes = sizeOf(INDEX_STORAGE_KEY);
  const configBytes = sizeOf(CONFIG_STORAGE_KEY);
  const total = logBytes + indexBytes + configBytes;

  let eventCount = 0;
  const loaded = loadLog();
  if (loaded.ok && loaded.value) eventCount = loaded.value.events.length;

  return {
    backend: store.kind,
    persistent: store.kind === "local-storage",
    logBytes,
    indexBytes,
    configBytes,
    totalBytes: total,
    eventCount,
    estimatedQuotaBytes: ESTIMATED_QUOTA,
    headroomBytes: Math.max(0, ESTIMATED_QUOTA - total),
  };
}

/** Bytes, human-readable. Used by the health panel's storage row. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Free space by dropping derived data, in the order it costs least.
 *
 * Returns what was dropped so the UI can say so. Never touches the log: if the
 * log itself does not fit, the answer is "export it to a file", not "delete
 * events".
 */
export function reclaimSpace(): { dropped: readonly string[]; freedBytes: number } {
  const before = report();
  const dropped: string[] = [];

  if (before.indexBytes > 0) {
    clearIndexBlob();
    dropped.push("embedding index");
  }

  const after = report();
  return { dropped, freedBytes: Math.max(0, before.totalBytes - after.totalBytes) };
}

/** Wipe everything. Only reachable from an explicit, confirmed action. */
export function wipeAll(): void {
  clearLog();
  clearIndexBlob();
  clearConfig();
}
