/**
 * The WhyLog store.
 *
 * Phase 0 · sub-phase 0.10 — the app boots empty, renders, and survives reload
 * Plan: plan/phase-0-foundation.md §0.10
 *
 * ---------------------------------------------------------------------------
 * WHAT THE STORE IS
 *
 * A thin shell over two artifacts:
 *
 *   `log`    the EventLog. Authoritative. Append-only. Persisted.
 *   `state`  the GraphState. Derived by the fold. A cache. Rebuildable.
 *
 * Every mutation goes `append to log -> fold the new event -> persist the log`.
 * Nothing writes to `state` directly, and nothing persists `state`: on reload the
 * log is read, the chain is verified, and the state is folded back. That is the
 * whole of sub-phase 0.10, and it is also the reason a corrupt projection can
 * always be recovered — there is a rebuild action, and it is safe to press.
 *
 * ---------------------------------------------------------------------------
 * WHY BOOT REPORTS RATHER THAN THROWS
 *
 * A broken hash chain on load is bad news, but it is not a reason to show a blank
 * screen. The store boots read-only, reports exactly which event is damaged, and
 * offers an export of what it could read. Refusing to boot would turn an audit
 * finding into data loss, which is the opposite of what an append-only log is for.
 * ---------------------------------------------------------------------------
 */

import { DEFAULT_CONFIG, engineIdOf, readConfig } from "@/ai/config";
import { type ActiveEngine, getEngine, invalidateEngine } from "@/ai/engine";
import { nowISO } from "@/lib/format";
import { type Result, err, ok } from "@/lib/result";
import {
  type EventLog,
  appendBatch as appendBatchToLog,
  appendSealed,
  append as appendToLog,
  emptyLog,
  loadLog as sealLog,
  verify as verifyLog,
} from "@/substrate/event-log";
import { validationMessage } from "@/substrate/event-validation";
import type { GraphState } from "@/substrate/graph-state";
import { emptyState } from "@/substrate/graph-state";
import type { ChainVerification } from "@/substrate/hash-chain";
import { type FoldOptions, fold, rebuild } from "@/substrate/materialize";
import {
  type StorageReport,
  isPersistent,
  loadLog as loadStoredLog,
  reclaimSpace,
  saveEvents,
  report as storageReport,
  wipeAll,
} from "@/substrate/persistence";
import {
  type ImportOutcome,
  type PortableLog,
  describeImportOutcome,
  describeRejection,
  exportLog,
  importLog,
  reseal,
  serializeLog,
} from "@/substrate/portability";
import { SCHEMA_VERSION } from "@/substrate/schema";
import type { Actor, EngineId, EventId, ISODateString } from "@/types/common";
import type { AnyEvent, EventPayloadMap, EventType, NewEvent } from "@/types/events";
import { create } from "zustand";
import { type SettingsState, initialSettings } from "./settings";

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

export type BootStatus = "booting" | "empty" | "loaded" | "degraded" | "failed";

export interface Notice {
  readonly id: string;
  readonly tone: "info" | "warning" | "error";
  readonly title: string;
  readonly body: string;
  readonly at: ISODateString;
}

export interface WhyLogState {
  /* --- the two artifacts --- */
  readonly log: EventLog;
  readonly state: GraphState;

  /* --- boot --- */
  readonly status: BootStatus;
  readonly bootedAt: ISODateString | null;
  readonly verification: ChainVerification | null;
  readonly notices: readonly Notice[];
  readonly storage: StorageReport | null;
  /** True until the first user action; drives the empty-state screen. */
  readonly pristine: boolean;

  /* --- the engine --- */
  readonly engine: ActiveEngine | null;
  readonly engineId: EngineId;

  /* --- settings --- */
  readonly settings: SettingsState;

  /* --- actions --- */
  readonly boot: () => void;
  readonly record: <T extends EventType>(
    /* `actor` and `reason` are optional ON THE DRAFT because the implementation fills them from
     * `context` (then from the active engine's default actor). Declaring them required forced every
     * caller to duplicate a reason the context already carries. */
    draft: Omit<NewEvent<T>, "actor" | "reason"> & {
      readonly actor?: Actor | undefined;
      readonly reason?: string | undefined;
    },
    context: { reason: string; actor?: Actor; occurredAt?: ISODateString },
  ) => Result<EventId, string>;
  readonly recordBatch: (
    drafts: readonly NewEvent<EventType>[],
    context: { reason: string; actor?: Actor; occurredAt?: ISODateString },
  ) => Result<readonly EventId[], string>;
  readonly rebuildProjections: () => void;
  readonly importJson: (raw: string) => Result<ImportOutcome, string>;
  readonly exportJson: () => Result<{ json: string; log: PortableLog }, string>;
  readonly dismissNotice: (id: string) => void;
  readonly reset: () => void;
  readonly reclaim: () => void;
  readonly refreshEngine: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

let noticeSeq = 0;

function notice(tone: Notice["tone"], title: string, body: string, at: ISODateString): Notice {
  noticeSeq += 1;
  return { id: `N-${noticeSeq}`, tone, title, body, at };
}

/** Sanitize user-generated content before storage to prevent XSS */
export function sanitizeUserContent(text: string): string {
  // Strip HTML tags and script content
  const cleaned = text.replace(/<[^>]*>/g, "");
  // Strip event handlers and dangerous protocols
  const safe = cleaned.replace(/on[a-zA-Z]+\s*=/g, "");
  // Bound length to prevent storage exhaustion
  const maxLength = 1_000_000;
  return safe.length > maxLength ? safe.slice(0, maxLength) : safe;
}

/** Detect potentially malicious content in stored events */
export function detectMaliciousContent(text: string): {
  safe: boolean;
  type: string;
  detail: string;
} {
  const scriptCheck = /<script[^>]*>.*?<\/script>/gi.test(text);
  const handlerCheck = /on[a-zA-Z]+\s*=/gi.test(text);
  const protocolCheck = /javascript:/gi.test(text) || /data:[^;]*;/gi.test(text);

  if (scriptCheck) return { safe: false, type: "script", detail: "Script tag detected" };
  if (handlerCheck) return { safe: false, type: "handler", detail: "Event handler detected" };
  if (protocolCheck) return { safe: false, type: "html", detail: "Dangerous protocol detected" };
  return { safe: true, type: "none", detail: "Content appears safe" };
}

function foldOptions(engineId: EngineId, at: ISODateString): FoldOptions {
  return { engine: engineId, now: at };
}

/** The actor for an event with none supplied: the active engine, so every node
 *  produced by a machine is stamped as machine-made. */
function defaultActor(active: ActiveEngine | null): Actor {
  if (active === null) return { kind: "system" };
  return { kind: "engine", engine: active.id };
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

export const useWhyLog = create<WhyLogState>()((set, get) => ({
  log: emptyLog(),
  state: emptyState(engineIdOf(DEFAULT_CONFIG), nowISO() as ISODateString),
  status: "booting",
  bootedAt: null,
  verification: null,
  notices: [],
  storage: null,
  pristine: true,
  engine: null,
  engineId: engineIdOf(DEFAULT_CONFIG),
  settings: initialSettings(),

  /* ---------------- boot ---------------- */

  boot: () => {
    const at = nowISO() as ISODateString;

    // Resolve fresh: `invalidateEngine()` drops any cache left by an earlier
    // session in this tab, so a key added or removed since the last render is
    // picked up. The local engine's registration is a side-effect import in
    // main.tsx, which runs before this.
    invalidateEngine();
    const resolved = getEngine();
    const engineId = resolved.id;

    const stored = loadStoredLog();
    const notices: Notice[] = [];

    if (resolved.fellBack && resolved.fallbackReason !== null) {
      notices.push(notice("warning", "Running the local engine", resolved.fallbackReason, at));
    }

    if (!stored.ok) {
      set({
        status: "failed",
        bootedAt: at,
        engine: resolved,
        engineId: resolved.id,
        storage: storageReport(),
        notices: [...notices, notice("error", "Stored log could not be read", stored.error, at)],
      });
      return;
    }

    if (stored.value === null) {
      const empty = emptyState(engineId, at);
      set({
        log: emptyLog(),
        state: empty,
        status: "empty",
        bootedAt: at,
        engine: resolved,
        engineId: resolved.id,
        storage: storageReport(),
        notices: [
          ...notices,
          notice(
            "info",
            "No log yet",
            "Paste an AI-coding transcript to extract decisions from it, or record one by hand. Everything stays in this browser; nothing is sent anywhere unless you add an API key.",
            at,
          ),
        ],
        pristine: true,
      });
      return;
    }

    const { log, verification } = sealLog(stored.value.events, stored.value.schemaVersion);

    if (!verification.valid) {
      // Boot READ-ONLY rather than refusing to boot. The user can still export
      // what is readable, and the report says exactly where the damage is.
      const partial = fold(log.events, foldOptions(engineId, at));
      set({
        log,
        state: partial,
        status: "degraded",
        bootedAt: at,
        verification,
        engine: resolved,
        engineId: resolved.id,
        storage: storageReport(),
        notices: [
          ...notices,
          notice(
            "error",
            "The hash chain is broken",
            `Event ${
              (verification.firstBadIndex ?? 0) + 1
            } of ${verification.eventCount} does not link to its predecessor: ${
              verification.violations[0]?.message ?? "unknown cause"
            }. The log is shown read-only. Export it now and investigate before recording anything new — appending would extend a chain that no longer proves anything.`,
            at,
          ),
        ],
        pristine: false,
      });
      return;
    }

    const state = fold(log.events, foldOptions(engineId, at));
    const indexNotice = indexStalenessNotice(state, resolved.id, at);

    set({
      log,
      state,
      status: "loaded",
      bootedAt: at,
      verification,
      engine: resolved,
      engineId: resolved.id,
      storage: storageReport(),
      notices: [...notices, ...(indexNotice === null ? [] : [indexNotice])],
      pristine: false,
    });
  },

  /* ---------------- record ---------------- */

  record: (draft, context) => {
    const { log, status } = get();
    const at = nowISO() as ISODateString;

    if (status === "degraded") {
      return err(
        "The log is read-only: its hash chain is broken. Export what is readable, then start a fresh log or restore from a good export.",
      );
    }

    const active = get().engine;
    const outcome = appendToLog(
      log,
      {
        type: draft.type,
        payload: draft.payload,
        actor: draft.actor ?? context.actor ?? defaultActor(active),
        reason: draft.reason ?? context.reason,
        ...(draft.at === undefined ? {} : { at: draft.at }),
        ...(draft.occurredAt === undefined
          ? context.occurredAt === undefined
            ? {}
            : { occurredAt: context.occurredAt }
          : { occurredAt: draft.occurredAt }),
      },
      { now: at, actor: defaultActor(active), reason: context.reason },
    );

    if (!outcome.ok) return err(validationMessage(outcome.validation));

    const nextState = fold(outcome.log.events, foldOptions(get().engineId, at));
    const saved = saveEvents(outcome.log.events, outcome.log.headHash, at);

    set((current) => ({
      log: outcome.log,
      state: nextState,
      status: current.status === "empty" ? "loaded" : current.status,
      pristine: false,
      storage: storageReport(),
      notices: saved.ok
        ? current.notices
        : [
            ...current.notices,
            notice("error", "The event was recorded but could not be saved", saved.error, at),
          ],
    }));

    return ok(outcome.event.id);
  },

  recordBatch: (drafts, context) => {
    const { log, status } = get();
    const at = nowISO() as ISODateString;

    if (status === "degraded") {
      return err("The log is read-only: its hash chain is broken.");
    }
    if (drafts.length === 0) return ok([]);

    const active = get().engine;
    const actor = context.actor ?? defaultActor(active);

    const outcome = appendBatchToLog(
      log,
      drafts.map((draft) => ({
        draft: {
          type: draft.type,
          payload: draft.payload as EventPayloadMap[EventType],
          actor: draft.actor ?? actor,
          reason: draft.reason ?? context.reason,
          // The two clocks MUST survive the mapping. Phase 1 commits a whole
          // extraction as one batch whose `occurredAt` is the transcript time,
          // not now: dropping these fields would stamp every imported decision
          // with the moment of import, which silently destroys the bi-temporal
          // split (0.3) for the entire pipeline.
          ...(draft.at === undefined ? {} : { at: draft.at }),
          ...(draft.occurredAt === undefined
            ? context.occurredAt === undefined
              ? {}
              : { occurredAt: context.occurredAt }
            : { occurredAt: draft.occurredAt }),
        },
        context: {
          now: at,
          actor,
          reason: draft.reason ?? context.reason,
          ...(context.occurredAt === undefined ? {} : { occurredAt: context.occurredAt }),
        },
      })),
    );

    if (!outcome.ok) return err(validationMessage(outcome.validation));

    const nextState = fold(outcome.log.events, foldOptions(get().engineId, at));
    const saved = saveEvents(outcome.log.events, outcome.log.headHash, at);

    set((current) => ({
      log: outcome.log,
      state: nextState,
      status: current.status === "empty" ? "loaded" : current.status,
      pristine: false,
      storage: storageReport(),
      notices: saved.ok
        ? current.notices
        : [...current.notices, notice("error", "Recorded but not saved", saved.error, at)],
    }));

    return ok(outcome.events.map((e) => e.id));
  },

  /* ---------------- rebuild ---------------- */

  rebuildProjections: () => {
    const at = nowISO() as ISODateString;
    const { log } = get();
    // Throw the cache away and re-fold from the log. Safe by construction: the
    // projections are derived and the log is untouched.
    const state = rebuild(get().state, foldOptions(get().engineId, at));
    set((current) => ({
      state,
      notices: [
        ...current.notices,
        notice(
          "info",
          "Projections rebuilt",
          `${log.events.length} events replayed from the log. Nothing was written.`,
          at,
        ),
      ],
    }));
  },

  /* ---------------- import ---------------- */

  importJson: (raw) => {
    const at = nowISO() as ISODateString;
    const { log, status } = get();

    if (status === "degraded") {
      return err("Cannot import into a log whose hash chain is broken. Start a fresh log first.");
    }

    const existingIds = new Set<EventId>(log.events.map((e) => e.id));
    const result = importLog(raw, {
      existingIds,
      existingHeadHash: log.headHash,
    });

    if (!result.ok) return err(describeRejection(result.rejection));

    const outcome = result.outcome;

    if (outcome.newEvents.length === 0) {
      set((current) => ({
        notices: [
          ...current.notices,
          notice(
            "info",
            "Nothing to import",
            `All ${outcome.totalInFile} events in that file are already in the log. Zero new nodes — which is the correct answer, and the one the double-import test checks for.`,
            at,
          ),
        ],
      }));
      return ok(outcome);
    }

    // Re-seal onto the local chain: an imported file's prevHash values point at
    // ITS genesis, and appending them unmodified would fork the chain.
    const resealed = reseal(outcome.newEvents, log.headHash);
    const nextLog = appendSealed(log, resealed as readonly AnyEvent[]);
    const verification = verifyLog(nextLog);

    if (!verification.valid) {
      return err(
        `The import was refused: re-sealing produced a broken chain at event ${
          (verification.firstBadIndex ?? 0) + 1
        }. Nothing was written.`,
      );
    }

    const nextState = fold(nextLog.events, foldOptions(get().engineId, at));
    const saved = saveEvents(nextLog.events, nextLog.headHash, at);

    // The log records that an import happened, with the counts. That event is what
    // makes "importing twice creates nothing" auditable rather than merely true.
    const withImportEvent = appendToLog(
      nextLog,
      {
        type: "LogImported",
        payload: {
          sourceHeadHash: outcome.headHashAfter,
          eventsImported: outcome.totalInFile,
          merged: outcome.duplicates,
          created: outcome.newEvents.length,
        },
        actor: { kind: "system" },
        reason: `Imported a portable log: ${describeImportOutcome(outcome)}.`,
      },
      { now: at, actor: { kind: "system" }, reason: "log import" },
    );

    const finalLog = withImportEvent.ok ? withImportEvent.log : nextLog;
    const finalState = withImportEvent.ok
      ? fold(finalLog.events, foldOptions(get().engineId, at))
      : nextState;
    if (withImportEvent.ok) saveEvents(finalLog.events, finalLog.headHash, at);

    set((current) => ({
      log: finalLog,
      state: finalState,
      status: "loaded",
      pristine: false,
      storage: storageReport(),
      notices: [
        ...current.notices,
        notice(
          saved.ok ? "info" : "error",
          "Log imported",
          saved.ok
            ? describeImportOutcome(outcome)
            : `Imported, but could not be saved: ${saved.error}`,
          at,
        ),
      ],
    }));

    return ok(outcome);
  },

  /* ---------------- export ---------------- */

  exportJson: () => {
    const at = nowISO() as ISODateString;
    const { log, state } = get();

    const portable = exportLog(
      log.events,
      log.headHash,
      {
        events: log.events.length,
        decisions: state.decisions.size,
        premises: state.premises.size,
        guards: state.guards.size,
        transcripts: state.transcripts.size,
      },
      get().engineId,
      at,
    );

    if (!portable.ok) return err(portable.error);
    return ok({ json: serializeLog(portable.value), log: portable.value });
  },

  /* ---------------- housekeeping ---------------- */

  dismissNotice: (id) => {
    set((current) => ({ notices: current.notices.filter((n) => n.id !== id) }));
  },

  reset: () => {
    const at = nowISO() as ISODateString;
    wipeAll();
    invalidateEngine();
    const resolved = getEngine();
    set({
      log: emptyLog(),
      state: emptyState(resolved.id, at),
      status: "empty",
      bootedAt: at,
      verification: null,
      engine: resolved,
      engineId: resolved.id,
      storage: storageReport(),
      pristine: true,
      notices: [
        notice(
          "info",
          "Log cleared",
          "Every event, the embedding index and the stored configuration were removed from this browser. If you exported first, the file is unaffected.",
          at,
        ),
      ],
    });
  },

  reclaim: () => {
    const at = nowISO() as ISODateString;
    const { dropped, freedBytes } = reclaimSpace();
    set((current) => ({
      storage: storageReport(),
      notices: [
        ...current.notices,
        notice(
          "info",
          "Space reclaimed",
          dropped.length === 0
            ? "Nothing disposable was stored."
            : `Dropped ${dropped.join(", ")} (~${Math.round(freedBytes / 1024)} KB). These are derived data; re-index to rebuild them. No event was touched.`,
          at,
        ),
      ],
    }));
  },

  refreshEngine: () => {
    invalidateEngine();
    const resolved = getEngine();
    const config = readConfig();
    const at = nowISO() as ISODateString;
    set((current) => ({
      engine: resolved,
      engineId: resolved.id,
      settings: { ...current.settings, config },
      // Re-fold so the engine id stamped on derived state matches the new one.
      // Events already written keep the engine they were produced by — that is the
      // point of storing it on the node.
      state: fold(current.log.events, foldOptions(resolved.id, at)),
    }));
  },
}));

/* -------------------------------------------------------------------------- */
/* Boot-time notices                                                          */
/* -------------------------------------------------------------------------- */

function indexStalenessNotice(
  state: GraphState,
  engineId: EngineId,
  at: ISODateString,
): Notice | null {
  if (state.index.builtBy === undefined) return null;
  if (!state.index.stale) return null;

  return notice(
    "warning",
    "The embedding index is stale",
    `Those vectors were produced by ${describeEngine(state.index.builtBy)} and the active engine is ${describeEngine(engineId)}. Cosine similarity across embedding spaces is meaningless, so semantic retrieval is disabled until you re-index. Lexical, structural and premise retrieval are unaffected.`,
    at,
  );
}

function describeEngine(engine: EngineId): string {
  return engine.model.length > 0 ? `${engine.kind}:${engine.model}` : engine.kind;
}

/* -------------------------------------------------------------------------- */
/* Convenience                                                                */
/* -------------------------------------------------------------------------- */

/** Boot once, from the React entry. Idempotent: a second call is a no-op, so
 *  StrictMode's double-invoke in development cannot double-load. */
let booted = false;

export function bootOnce(): void {
  if (booted) return;
  booted = true;
  useWhyLog.getState().boot();
}

export function isBooted(): boolean {
  return booted;
}

/** Whether the browser will actually remember this log across a reload. The UI
 *  says so up front, because "your log is in memory only" is the difference
 *  between a tool and a toy and must not be discovered by losing work. */
export function persistenceAvailable(): boolean {
  return isPersistent();
}

export { SCHEMA_VERSION };
