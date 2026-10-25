/**
 * Portability: export and import EVENTS, never state.
 *
 * Phase 0 · sub-phase 0.6
 * Plan: plan/phase-0-foundation.md §0.6
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE
 *
 * The portable artifact is the EVENT LOG. Not the graph, not the projections, not
 * the embeddings.
 *
 * Exporting state would freeze a derived cache into the wire format, and every
 * future change to a projection would become a breaking change to every file
 * anybody has on disk. Exporting events means an old file replays through the
 * current fold and picks up every improvement automatically — which is the only
 * versioning story that survives a hackathon, let alone a product.
 *
 * ---------------------------------------------------------------------------
 * THE ROUND-TRIP GUARANTEE
 *
 *   export(log) -> import(json) -> identical head hash
 *
 * It holds because the hash chain is computed over `canonicalJson`, which sorts
 * object keys. Key insertion order therefore cannot change a hash, and a file
 * that travelled through JSON.stringify and JSON.parse comes back byte-identical
 * in the places that matter.
 *
 * ---------------------------------------------------------------------------
 * IMPORT IS A MERGE, NOT A REPLACE
 *
 * Events already present — by id — are skipped. The acceptance test is the sharp
 * one: IMPORT THE SAME FILE TWICE AND ZERO NEW NODES APPEAR. That works because
 * duplicate events are rejected here, and because identity resolution
 * (src/substrate/identity.ts) rejects duplicate nodes one layer up.
 *
 * A broken chain is REFUSED, not repaired. Repairing means rewriting history,
 * and a log whose history can be rewritten cannot prove anything.
 * ---------------------------------------------------------------------------
 */

import { nowISO } from "@/lib/format";
import { err, ok, type Result } from "@/lib/result";
import type { EngineId, EventId, ISODateString } from "@/types/common";
import type { AnyEvent } from "@/types/events";
import {
  GENESIS_HASH,
  coerceEvent,
  linkHash,
  verifyChain,
  type ChainVerification,
} from "./hash-chain";
import { canLoad, migrateEvents, SCHEMA_VERSION } from "./schema";

/* -------------------------------------------------------------------------- */
/* The wire format                                                            */
/* -------------------------------------------------------------------------- */

export interface PortableStats {
  readonly events: number;
  readonly decisions: number;
  readonly premises: number;
  readonly guards: number;
  readonly transcripts: number;
}

export interface PortableLog {
  /** Bumped by src/substrate/schema.ts. An importer refuses a NEWER file rather
   *  than guessing at it. */
  readonly schemaVersion: number;
  /** The whole log, in learned-time order, each event carrying its `prevHash`. */
  readonly events: readonly AnyEvent[];
  /** Head hash of `events`. Verified on import; a mismatch means the file was
   *  edited or truncated in transit. */
  readonly headHash: string;
  readonly exportedAt: ISODateString;
  readonly stats: PortableStats;
  /** Which engine was active at export. Informational: the index is NOT in this
   *  file, because vectors are derived data (sub-phase 0.8). */
  readonly engine: EngineId;
}

/** What the file is called. Stable and boring, so a teammate recognises it. */
export const EXPORT_FILENAME = "whylog.json";

export const MAGIC = "whylog/log" as const;
export const FORMAT_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export function exportLog(
  events: readonly AnyEvent[],
  headHash: string,
  stats: PortableStats,
  engine: EngineId,
  at: ISODateString = nowISO(),
): Result<PortableLog, string> {
  if (events.length > 0) {
    const verification = verifyChain(events);
    if (!verification.valid) {
      // Refusing to export a broken chain is the point: the file is the artifact
      // other people will trust, and a stamp on a broken log is a lie.
      return err(
        `Cannot export: the hash chain is broken at event ${
          (verification.firstBadIndex ?? 0) + 1
        }. ${verification.violations[0]?.message ?? ""}`,
      );
    }
    if (verification.headHash !== headHash) {
      return err(
        `Cannot export: the stored head hash (${headHash.slice(0, 12)}…) does not match the recomputed one (${verification.headHash.slice(0, 12)}…).`,
      );
    }
  }

  return ok({
    schemaVersion: SCHEMA_VERSION,
    events,
    headHash,
    exportedAt: at,
    stats,
    engine,
  });
}

export function serializeLog(log: PortableLog): string {
  return JSON.stringify(log, null, 2);
}

/** A single-line variant for clipboard copies and for the CI integrity check,
 *  where whitespace is noise. */
export function serializeCompact(log: PortableLog): string {
  return JSON.stringify(log);
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export type ImportRejection =
  | { readonly reason: "not-json"; readonly detail: string }
  | { readonly reason: "not-a-whylog-file"; readonly detail: string }
  | { readonly reason: "newer-schema"; readonly version: number }
  | { readonly reason: "unsupported-schema"; readonly version: number }
  | { readonly reason: "malformed-event"; readonly index: number; readonly detail: string }
  | { readonly reason: "chain-broken"; readonly verification: ChainVerification }
  | { readonly reason: "head-hash-mismatch"; readonly expected: string; readonly found: string };

export interface ImportOutcome {
  /** Events to append, already sealed and already deduplicated. */
  readonly newEvents: readonly AnyEvent[];
  /** Events skipped because the log already contains them. */
  readonly duplicates: number;
  readonly totalInFile: number;
  readonly headHashAfter: string;
  readonly migratedFrom: number | null;
  readonly schemaVersion: number;
}

export type ImportResult =
  | { readonly ok: true; readonly outcome: ImportOutcome }
  | { readonly ok: false; readonly rejection: ImportRejection };

/**
 * Parse, verify and merge an imported file.
 *
 * `existingIds` is the set of ids already in the local log; pass null to accept
 * everything (used when importing into an empty log).
 */
export function importLog(
  raw: string,
  options: {
    readonly existingIds: ReadonlySet<EventId> | null;
    readonly existingHeadHash: string;
  },
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, rejection: { reason: "not-json", detail: String(error) } };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      rejection: { reason: "not-a-whylog-file", detail: "the file is not a JSON object" },
    };
  }

  const candidate = parsed as Record<string, unknown>;
  if (!Array.isArray(candidate["events"])) {
    return {
      ok: false,
      rejection: {
        reason: "not-a-whylog-file",
        detail: 'no `events` array — a WhyLog file carries events, not a materialised graph',
      },
    };
  }

  const version =
    typeof candidate["schemaVersion"] === "number" ? candidate["schemaVersion"] : SCHEMA_VERSION;

  if (version > SCHEMA_VERSION) {
    return { ok: false, rejection: { reason: "newer-schema", version } };
  }
  if (!canLoad(version)) {
    return { ok: false, rejection: { reason: "unsupported-schema", version } };
  }

  /* ---- coerce every event, refusing the file on the first bad one ---- */
  const coerced: AnyEvent[] = [];
  for (let i = 0; i < candidate["events"].length; i += 1) {
    const result = coerceEvent(candidate["events"][i]);
    if (!result.ok) {
      return {
        ok: false,
        rejection: { reason: "malformed-event", index: i, detail: result.reason },
      };
    }
    coerced.push(result.event);
  }

  /* ---- migrate if needed. Migrations APPEND events; they never rewrite. ---- */
  const migration = migrateEvents(coerced, version);
  if (!migration.ok) {
    return {
      ok: false,
      rejection: { reason: "unsupported-schema", version },
    };
  }

  /* ---- verify the chain over the WHOLE file ---- */
  const verification = verifyChain(migration.events);
  if (!verification.valid) {
    return { ok: false, rejection: { reason: "chain-broken", verification } };
  }

  const declaredHead = typeof candidate["headHash"] === "string" ? candidate["headHash"] : null;
  if (declaredHead !== null && declaredHead !== verification.headHash) {
    return {
      ok: false,
      rejection: {
        reason: "head-hash-mismatch",
        expected: declaredHead,
        found: verification.headHash,
      },
    };
  }

  /* ---- deduplicate against the local log ---- */
  const fresh: AnyEvent[] = [];
  let duplicates = 0;

  for (const event of migration.events) {
    if (options.existingIds?.has(event.id)) {
      duplicates += 1;
      continue;
    }
    fresh.push(event);
  }

  // An imported file may itself carry a migration event; those are new by id and
  // are appended like any other.
  const withMigrations = [...fresh, ...migration.appended];

  return {
    ok: true,
    outcome: {
      newEvents: withMigrations,
      duplicates,
      totalInFile: migration.events.length,
      headHashAfter: verification.headHash,
      migratedFrom: version === SCHEMA_VERSION ? null : version,
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

/**
 * Re-seal imported events onto the LOCAL chain.
 *
 * An imported file's `prevHash` values point at ITS genesis. Appending them to a
 * non-empty local log would fork the chain, so the events are re-linked from the
 * local head. Their `id`s — and therefore their deduplication behaviour — are
 * preserved, which is what keeps double-import idempotent across a re-seal.
 *
 * The consequence is worth stating plainly: the local head hash after an import
 * is NOT the imported file's head hash, unless the local log was empty. The
 * round-trip guarantee (export -> import -> identical head) is about a file
 * travelling into an EMPTY log, or back into the log it came from.
 */
export function reseal(
  events: readonly AnyEvent[],
  localHeadHash: string,
): readonly AnyEvent[] {
  const out: AnyEvent[] = [];
  let prev = localHeadHash === "" ? GENESIS_HASH : localHeadHash;

  for (const event of events) {
    const resealed = { ...event, prevHash: prev } as AnyEvent;
    out.push(resealed);
    // Recomputed with the same link function the log uses, so the caller can
    // verify the result without knowing the algorithm.
    prev = linkOf(prev, resealed);
  }

  return out;
}

function linkOf(prev: string, event: AnyEvent): string {
  return linkHash(prev, event);
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeRejection(rejection: ImportRejection): string {
  switch (rejection.reason) {
    case "not-json":
      return `That file is not valid JSON. ${rejection.detail}`;
    case "not-a-whylog-file":
      return `That is not a WhyLog log. ${rejection.detail}`;
    case "newer-schema":
      return `This file was written by a newer WhyLog (schema v${rejection.version}; this build reads v${SCHEMA_VERSION}). Update the app before importing.`;
    case "unsupported-schema":
      return `No migration path exists from schema v${rejection.version}.`;
    case "malformed-event":
      return `Event ${rejection.index + 1} is malformed: ${rejection.detail}. The file was not imported.`;
    case "chain-broken":
      return `The hash chain in this file is broken at event ${
        (rejection.verification.firstBadIndex ?? 0) + 1
      } of ${rejection.verification.eventCount}. It was refused rather than repaired: a log whose history can be rewritten cannot prove anything.`;
    case "head-hash-mismatch":
      return `The file's declared head hash (${rejection.expected.slice(0, 12)}…) does not match its contents (${rejection.found.slice(0, 12)}…). It has been edited or truncated.`;
    default:
      return "Import failed.";
  }
}

export function describeImportOutcome(outcome: ImportOutcome): string {
  const parts = [
    `${outcome.newEvents.length} new event${outcome.newEvents.length === 1 ? "" : "s"}`,
  ];
  if (outcome.duplicates > 0) {
    parts.push(`${outcome.duplicates} already present (skipped)`);
  }
  if (outcome.migratedFrom !== null) {
    parts.push(`migrated from schema v${outcome.migratedFrom}`);
  }
  return parts.join(", ");
}

/** Stats for the export file, computed from a folded state. Kept here so the
 *  exporter cannot forget a field. */
export function statsFromCounts(counts: {
  events: number;
  decisions: number;
  premises: number;
  guards: number;
  transcripts: number;
}): PortableStats {
  return counts;
}
