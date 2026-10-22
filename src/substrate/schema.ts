/**
 * Schema versioning and migration.
 *
 * Phase 0 · sub-phase 0.6
 * Plan: plan/phase-0-foundation.md §0.6
 *
 * ---------------------------------------------------------------------------
 * THE POLICY
 *
 * Migrations never rewrite history. A migration is itself an EVENT
 * (`SchemaMigrated`) appended to the log, carrying the from/to versions. That
 * keeps the hash chain intact across an upgrade — rewriting old events would
 * invalidate every hash after the change, which would destroy the one property
 * the chain exists to provide.
 *
 * Consequence: `applyEvent` must tolerate OLD payload shapes forever. Every
 * projector reads defensively. That cost is deliberate and is the price of an
 * append-only log that outlives its schema.
 * ---------------------------------------------------------------------------
 */

import { nowISO } from "@/lib/format";
import type { AnyEvent } from "@/types/events";

/** Current schema version. Bump when a payload shape changes incompatibly. */
export const SCHEMA_VERSION = 1;

/** Every version this build knows how to read. */
export const KNOWN_SCHEMA_VERSIONS: readonly number[] = [1];

/** Persistence key. Versioned in the KEY as well, so a v2 build can coexist
 *  with a v1 install in the same browser during development. */
export const STORAGE_KEY = "whylog:v1";

/** Key for the derived embedding index, which is deliberately NOT in the log. */
export const INDEX_STORAGE_KEY = "whylog:index:v1";

/** Key for engine configuration (API keys live here and nowhere else). */
export const CONFIG_STORAGE_KEY = "whylog:config:v1";

export type MigrationStep = (events: readonly AnyEvent[]) => readonly AnyEvent[];

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  /** Transform the event array. Must NOT alter existing events in place —
   *  return a new array, appending any new events at the end. */
  readonly migrate: MigrationStep;
}

/**
 * The migration table. Empty at v1 by design: there is nothing to migrate yet,
 * and an empty table is the honest state. Each entry must be pure and must be
 * accompanied by a fixture in tests/integration (Phase 0.6).
 */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrationOutcome {
  readonly ok: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly events: readonly AnyEvent[];
  /** Migration events to append, in order. */
  readonly appended: readonly AnyEvent[];
  readonly reason?: string;
}

/** Latest version reachable from `from` by following the table. */
export function reachableVersion(from: number): number {
  let current = from;
  const visited = new Set<number>([current]);

  for (;;) {
    const step = MIGRATIONS.find((m) => m.from === current);
    if (!step) break;
    if (visited.has(step.to)) break; // cycle guard
    visited.add(step.to);
    current = step.to;
  }

  return current;
}

/** Can a log at `version` be loaded by this build? */
export function canLoad(version: number): boolean {
  if (KNOWN_SCHEMA_VERSIONS.includes(version)) return true;
  return reachableVersion(version) === SCHEMA_VERSION;
}

/**
 * Migrate an imported event array up to the current schema.
 *
 * Returns the transformed events plus the `SchemaMigrated` payloads to append.
 * The CALLER appends them, because appending requires sealing with the current
 * head hash and only the event log knows that.
 */
export function migrateEvents(events: readonly AnyEvent[], fromVersion: number): MigrationOutcome {
  if (fromVersion === SCHEMA_VERSION) {
    return {
      ok: true,
      fromVersion,
      toVersion: SCHEMA_VERSION,
      events,
      appended: [],
    };
  }

  if (fromVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      fromVersion,
      toVersion: SCHEMA_VERSION,
      events,
      appended: [],
      reason: `This log was written by a newer version of WhyLog (schema v${fromVersion}). Update the app before importing.`,
    };
  }

  let current = events;
  let version = fromVersion;
  const appended: AnyEvent[] = [];
  const visited = new Set<number>([version]);

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      return {
        ok: false,
        fromVersion,
        toVersion: SCHEMA_VERSION,
        events: current,
        appended,
        reason: `No migration path from schema v${version} to v${SCHEMA_VERSION}.`,
      };
    }
    if (visited.has(step.to)) {
      return {
        ok: false,
        fromVersion,
        toVersion: SCHEMA_VERSION,
        events: current,
        appended,
        reason: `Migration cycle detected at schema v${version}.`,
      };
    }
    visited.add(step.to);

    current = step.migrate(current);
    version = step.to;
  }

  return { ok: true, fromVersion, toVersion: version, events: current, appended };
}

/** Build the `SchemaMigrated` payload for a completed upgrade. */
export function schemaMigratedPayload(
  from: number,
  to: number,
  description: string,
): {
  fromVersion: number;
  toVersion: number;
  description: string;
  at: string;
} {
  return { fromVersion: from, toVersion: to, description, at: nowISO() };
}

/** Read a schema version off an untyped imported object. */
export function readSchemaVersion(raw: unknown, fallback: number): number {
  if (typeof raw !== "object" || raw === null) return fallback;
  const value = (raw as Record<string, unknown>)["schemaVersion"];
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}
