/**
 * The extraction slice: import → review → commit.
 *
 * Phase 1 · sub-phase 1.10 + 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9, §1.10
 *
 * ---------------------------------------------------------------------------
 * THIS SLICE DOES NOT TOUCH THE LOG
 *
 * Importing a transcript runs the pipeline and produces a QUEUE. Nothing is written
 * to the graph until `commit()` succeeds, and `commit()` delegates to
 * `useWhyLog.recordBatch` — the only route into the log. Keeping the two stores
 * separate is what makes "nothing enters the log unreviewed" structurally true
 * rather than a convention: this slice physically cannot append a decision.
 *
 * It writes exactly one event of its own, at import time: `TranscriptImported`.
 * That is not an extraction result, it is a record that a document entered the
 * system, and it should survive even if every candidate in it is discarded.
 *
 * ---------------------------------------------------------------------------
 * THE QUEUE SURVIVES A RELOAD
 *
 * Persisted to `whylog:review:v1` alongside the log. An extraction that took ten
 * seconds and a review that took five minutes are both lost on an accidental
 * refresh otherwise, and "survives reload" is an acceptance criterion that should
 * apply to work in progress and not only to committed state.
 *
 * What is persisted is the QUEUE plus enough of the run to commit it. The
 * normalised transcript is persisted too, because `commit()` needs the offset map
 * to be identical to the one that made the snippets — re-normalising would be
 * identical in practice and unprovable in principle.
 * ---------------------------------------------------------------------------
 */

import { create } from "zustand";
import type { EngineId, ISODateString, TranscriptId } from "@/types/common";
import { ok, err, type Result } from "@/lib/result";
import { nowISO } from "@/lib/format";
import { useWhyLog } from "./whylog";
import { getEngine } from "@/ai/engine";
import {
  DEFAULT_REVIEW_OPTIONS,
  commitReview,
  describeCommit,
  describeFailure,
  describeQueue,
  filterQueue,
  previewCommit,
  queueFromRun,
  sortQueue,
  summariseQueue,
  applyAction,
  applyBatch,
  approve,
  discard,
  type CommitPreview,
  type ReviewItem,
  type ReviewQueueOptions,
} from "@/extraction";
import { runExtraction, type PipelineFailure } from "@/extraction/pipeline";
import type { ExtractionRun, ResolvedCandidate, ReviewAction } from "@/extraction/types";
import { formatTranscriptId } from "@/lib/ids";

const REVIEW_KEY = "whylog:review:v1";

export type ExtractionStatus = "idle" | "running" | "reviewing" | "committing" | "error";

export interface ExtractionState {
  readonly status: ExtractionStatus;
  readonly run: ExtractionRun | null;
  readonly queue: readonly ResolvedCandidate[];
  readonly options: ReviewQueueOptions;
  readonly error: string | null;
  /** The last commit's preview, kept after the commit so the toast can quote it. */
  readonly lastPreview: CommitPreview | null;
  readonly lastSummary: string | null;

  /* --- derived, recomputed on read so the queue and the filters cannot drift --- */
  readonly items: () => readonly ReviewItem[];
  readonly visible: () => readonly ReviewItem[];
  readonly summary: () => ReturnType<typeof summariseQueue>;
  readonly preview: () => CommitPreview;

  /* --- actions --- */
  readonly importText: (raw: string, label?: string) => Promise<Result<number, string>>;
  readonly act: (key: string, action: ReviewAction) => void;
  readonly actOnVisible: (action: ReviewAction) => void;
  readonly approveAllExpanded: () => void;
  readonly discardAllCollapsed: () => void;
  readonly discardUnreviewed: () => void;
  readonly setOptions: (patch: Partial<ReviewQueueOptions>) => void;
  readonly commit: () => Result<number, string>;
  readonly clear: () => void;
  readonly restore: () => void;
}

export const useExtraction = create<ExtractionState>()((set, get) => ({
  status: "idle",
  run: null,
  queue: [],
  options: DEFAULT_REVIEW_OPTIONS,
  error: null,
  lastPreview: null,
  lastSummary: null,

  /* ---------------- derived ---------------- */

  items: () => {
    const { run, queue } = get();
    if (run === null) return [];
    return queueFromRun(run, queue);
  },

  visible: () => {
    const { options } = get();
    return sortQueue(filterQueue(get().items(), options), options.sort);
  },

  summary: () => summariseQueue(get().items()),

  preview: () => previewCommit(get().queue, get().run?.discarded ?? []),

  /* ---------------- import ---------------- */

  importText: async (raw, label) => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message = "The log is read-only: its hash chain is broken. Nothing can be imported until it is restored.";
      set({ status: "error", error: message });
      return err(message);
    }
    if (raw.trim().length === 0) {
      set({ status: "error", error: "Nothing was pasted." });
      return err("Nothing was pasted.");
    }

    const active = whylog.engine ?? getEngine();
    const transcriptId = formatTranscriptId(whylog.state.counters.transcripts + 1);
    const at = nowISO() as ISODateString;

    set({ status: "running", error: null });

    /* The transcript is a document that entered the system, whatever the
     * extraction makes of it. Recorded before the pipeline runs so a crash
     * mid-extraction still leaves a trace of the import. */
    const imported = whylog.record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId,
          rawChars: raw.length,
          ...(label === undefined || label.trim().length === 0 ? {} : { label: label.trim() }),
          engine: active.id,
        },
      },
      { reason: `Imported a ${raw.length.toLocaleString("en-IN")}-character transcript for extraction.`, occurredAt: at },
    );
    if (!imported.ok) {
      set({ status: "error", error: imported.error });
      return err(imported.error);
    }

    // `occurredAt` is deliberately NOT passed: the normaliser recovers it from the
    // transcript's own header ("Started: Oct 3, 14:22") and sets `timeUncertain`
    // when it cannot. Passing the import time here would stamp every decision with
    // the moment of import and silently destroy the bi-temporal split (0.3) for the
    // whole pipeline — which is exactly the failure the two clocks exist to prevent.
    const outcome = await runExtraction(
      {
        transcriptId,
        raw,
        ...(label === undefined ? {} : { label }),
      },
      {
        engine: active.engine,
        engineId: active.id as EngineId,
        state: useWhyLog.getState().state,
        voting: active.config.voting ? { runs: 3, temperature: 0.2 } : { runs: 1, temperature: 0 },
      },
    );

    if (!outcome.ok) {
      const message = failureMessage(outcome.failure);
      set({ status: "error", error: message });
      return err(message);
    }

    const queue = outcome.outcome.queue;
    set({
      status: "reviewing",
      run: outcome.outcome.run,
      queue,
      error: null,
      options: DEFAULT_REVIEW_OPTIONS,
    });
    persist(get());

    return ok(queue.length);
  },

  /* ---------------- review ---------------- */

  act: (key, action) => {
    const queue = get().queue.map((item) => (item.key === key ? applyAction(item, action) : item));
    set({ queue });
    persist(get());
  },

  actOnVisible: (action) => {
    const visible = new Set(get().visible().map((item) => item.key));
    const queue = get().queue.map((item) =>
      visible.has(item.key) && item.action === null ? applyAction(item, action) : item,
    );
    set({ queue });
    persist(get());
  },

  approveAllExpanded: () => {
    // `viaBulk: true`, so the fold keeps every one of them at UNKNOWN. Ten
    // decisions promoted to IN by a single click is how a machine inference ends up
    // driving a cascade, so the fast path is fast without being authoritative.
    const expanded = new Set(
      get().items().filter((item) => item.expanded && item.action === null).map((item) => item.key),
    );
    const queue = get().queue.map((item) =>
      expanded.has(item.key) ? applyAction(item, approve(true)) : item,
    );
    set({ queue });
    persist(get());
  },

  discardAllCollapsed: () => {
    const collapsed = new Set(
      get().items().filter((item) => !item.expanded && item.action === null).map((item) => item.key),
    );
    const queue = get().queue.map((item) =>
      collapsed.has(item.key) ? applyAction(item, discard("collapsed and discarded in bulk")) : item,
    );
    set({ queue });
    persist(get());
  },

  discardUnreviewed: () => {
    const queue = get().queue.map((item) =>
      item.action === null ? applyAction(item, discard("left unreviewed")) : item,
    );
    set({ queue });
    persist(get());
  },

  setOptions: (patch) => {
    set({ options: { ...get().options, ...patch } });
  },

  /* ---------------- commit ---------------- */

  commit: () => {
    const { run, queue } = get();
    if (run === null) return err("There is no extraction to commit.");

    const whylog = useWhyLog.getState();
    if (whylog.status === "degraded") return err("The log is read-only: its hash chain is broken.");

    set({ status: "committing" });

    const built = commitReview(
      {
        transcriptId: run.transcriptId,
        engine: run.engine,
        occurredAt: run.normalized.occurredAt,
        items: queue,
        machineDiscards: run.discarded.map((d) => ({
          kind: d.kind,
          discardedBy: d.discardedBy === "human" ? "duplicate" : d.discardedBy,
          rawText: d.rawText,
          confidence: d.confidence,
        })),
      },
      whylog.state,
    );

    if (!built.ok) {
      const message = describeFailure(built);
      set({ status: "reviewing", error: message });
      return err(message);
    }

    const preview = previewCommit(queue, run.discarded);
    const appended = whylog.recordBatch(built.drafts, {
      reason: `Committed a reviewed extraction from ${run.transcriptId}: ${describeCountsOf(built.counts)}.`,
      occurredAt: run.normalized.occurredAt,
    });

    if (!appended.ok) {
      set({ status: "reviewing", error: appended.error });
      return err(appended.error);
    }

    set({
      status: "idle",
      run: null,
      queue: [],
      error: null,
      lastPreview: preview,
      lastSummary: describeCommit(preview, 0),
    });
    clearPersisted();

    return ok(appended.value.length);
  },

  clear: () => {
    set({ status: "idle", run: null, queue: [], error: null, options: DEFAULT_REVIEW_OPTIONS });
    clearPersisted();
  },

  restore: () => {
    if (get().run !== null) return;
    const stored = readPersisted();
    if (stored === null) return;
    set({ status: "reviewing", run: stored.run, queue: stored.queue });
  },
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function failureMessage(failure: PipelineFailure): string {
  switch (failure.kind) {
    case "empty-input":
      return "The transcript was empty after trimming.";
    case "no-turns":
      return "No speaker turns were found. WhyLog needs a transcript with recognisable turns — paste the conversation, not a summary of it.";
    case "engine-unsupported":
      return "The active engine does not support extraction. Switch to the local engine in Settings.";
    case "engine-error":
      return `The engine failed: ${failure.message}`;
    case "cancelled":
      return "Extraction was cancelled.";
    default:
      return "Extraction failed.";
  }
}

function describeCountsOf(counts: { decisions: number; premises: number; events: number }): string {
  return `${counts.decisions} decisions, ${counts.premises} premises, ${counts.events} events`;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

interface Persisted {
  readonly run: ExtractionRun;
  readonly queue: readonly ResolvedCandidate[];
  readonly savedAt: ISODateString;
}

function persist(state: ExtractionState): void {
  if (state.run === null) return;
  try {
    const payload: Persisted = { run: state.run, queue: state.queue, savedAt: nowISO() as ISODateString };
    localStorage.setItem(REVIEW_KEY, JSON.stringify(payload));
  } catch {
    // A review that cannot be persisted is still a review. Failing loudly here
    // would interrupt the user's work over something that only matters on reload.
  }
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.run === undefined || parsed.queue === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersisted(): void {
  try {
    localStorage.removeItem(REVIEW_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Is there an unfinished review waiting? Read at boot so the app can offer to
 *  resume it rather than silently dropping five minutes of work. */
export function hasPendingReview(): boolean {
  return readPersisted() !== null;
}

/** How old the pending review is, for the resume prompt. */
export function pendingReviewAge(): string | null {
  const stored = readPersisted();
  return stored === null ? null : stored.savedAt;
}

export { REVIEW_KEY, describeQueue };
