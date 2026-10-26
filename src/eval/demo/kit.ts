/**
 * The demo kit — seed state and one-click reset. 7.5.
 *
 * Phase 7 · sub-phase 7.5
 *
 * ---------------------------------------------------------------------------
 * WHY THE SEED STATE IS BUILT, NOT CHECKED IN
 *
 * A demo needs to start from a known graph. The obvious implementation is a JSON dump of a graph
 * committed to the repo. That is wrong here for a specific reason: a checked-in state is a snapshot of
 * whatever the extraction pipeline produced on the day it was saved, and the moment extraction changes
 * the demo is showing the audience a graph the product no longer builds. The presenter would be
 * describing behaviour the code does not have.
 *
 * So the seed is BUILT at load time from the two demo fixtures through the real pipeline. It is slower
 * by a second or two and it cannot drift. A demo that shows the shipping code path is worth two seconds.
 *
 * ---------------------------------------------------------------------------
 * RESET IS A WIPE, NOT AN UNDO
 *
 * One-click reset clears every WhyLog storage key and rebuilds the seed. It does not attempt to reverse
 * the events of a live demo, because invariant I1 says nothing is deleted — an undo would have to
 * rewrite the log, and a demo that rewrites its own hash chain in front of an audience is a demo that
 * has just contradicted its first claim.
 * ---------------------------------------------------------------------------
 */

import { createLocalEngine, localEngineId } from "@/ai/local";
import { nowISO } from "@/lib/format";
import { type EventLog, appendBatch, emptyLog, fold } from "@/substrate";
import type { GraphState } from "@/substrate/graph-state";
import type { EngineId, ISODateString } from "@/types/common";
import { STORAGE_KEYS } from "./keys";

/** The storage keys a reset must clear. Listed here rather than scattered, because a reset that misses
 *  one key leaves the next demo starting from the previous one's state — the failure is invisible until
 *  the presenter is three beats in and the graph has nodes nobody imported. */
export const RESET_KEYS: readonly string[] = STORAGE_KEYS;

export interface SeedResult {
  readonly log: EventLog;
  readonly state: GraphState;
  readonly engineId: EngineId;
  readonly builtAt: ISODateString;
  readonly decisions: number;
  readonly premises: number;
  readonly durationMs: number;
  /** Anything that went wrong while building. A seed that built with warnings still loads, and the
   *  presenter needs to know before the demo rather than discovering it on stage. */
  readonly warnings: readonly string[];
}

/**
 * Build the seed graph from the demo fixtures through the real pipeline.
 *
 * Delegates to the eval harness rather than reimplementing an import path, because two import paths
 * would eventually disagree and the demo would be exercising the one the metrics do not measure.
 */
export async function buildSeed(): Promise<SeedResult> {
  const started = Date.now();
  const engine = createLocalEngine();
  const engineId = localEngineId();
  const warnings: string[] = [];

  const { corpus, CORPUS_ROOT } = await import("../corpus/data");
  const { loadCorpus } = await import("../corpus/loader");
  const { runConfig } = await import("../harness");
  const { FULL, DEFAULT_PARAMS } = await import("../ablation/toggles");

  const loaded = loadCorpus(corpus, CORPUS_ROOT);

  if (loaded.missingFiles.length > 0) {
    warnings.push(
      loaded.missingFiles.length + " corpus file(s) missing: " + loaded.missingFiles.join(", "),
    );
  }
  if (loaded.unresolved.length > 0) {
    warnings.push(
      loaded.unresolved.length +
        " corpus label(s) do not resolve — the seed will still build, but the metrics would not be trustworthy.",
    );
  }

  /* Only the two demo fixtures are seeded. The full twelve-transcript corpus produces a graph too large
   * to walk an audience through in five minutes, and the demo's job is the L1 reversal and the L2
   * premise invalidation, both of which live entirely in these two files. */
  const demoOnly = {
    ...loaded.corpus,
    transcripts: loaded.corpus.transcripts.filter(
      (transcript) => transcript.id === "demo1" || transcript.id === "demo2",
    ),
    questions: loaded.corpus.questions.filter(
      (question) => question.id === "q1" || question.id === "q8",
    ),
    plants: loaded.corpus.plants.filter(
      (plant) => plant.id === "L1-sqlite" || plant.id === "L2-premise-falsified",
    ),
  };

  /* THE SEED IS A TRIAGED IMPORT, NOT A RAW ONE.
   *
   * `runConfig` leaves every extracted decision at status `proposed`, which is correct for the
   * benchmark — it measures what the extractor produced before anybody looked at it. A demo is a
   * different artefact: it narrates a user who imported two transcripts and accepted what they found.
   * Beat 3 depends on that, because gate (a) deliberately refuses to raise a contradiction between
   * two decisions nobody has accepted (two unreviewed guesses disagreeing is the extractor's noise,
   * not the project's), and a decision that was never accepted cannot be reversed.
   *
   * So the seed sets `approveDecisions`, and the harness approves each transcript's decisions as part
   * of its review step — BEFORE the revision pass, so the gates run once over the triaged graph and
   * the L2 plant still lands afterwards in the right order. Doing it after `runConfig` returns was
   * tried and is wrong twice over: the gates had already run, and a second pass disturbed beat 5. */
  const run = await runConfig(demoOnly, {
    id: "demo-seed",
    engine,
    engineId,
    toggles: FULL,
    params: DEFAULT_PARAMS,
    approveDecisions: true,
  });

  for (const entry of run.transcripts) {
    if (!entry.ok)
      warnings.push(
        "fixture " + entry.transcript.id + " failed to import: " + (entry.failure ?? "unknown"),
      );
  }

  return {
    log: rebuildLog(run),
    state: run.state,
    engineId,
    builtAt: nowISO(),
    decisions: run.state.decisions.size,
    premises: run.state.premises.size,
    durationMs: Date.now() - started,
    warnings,
  };
}

/**
 * The event log behind a completed run.
 *
 * The harness keeps its log local and returns only the folded state, because metrics score states. The
 * demo needs the log too, since the app persists and replays events rather than snapshots — so it is
 * reconstructed by re-folding the state's own event list, which is authoritative and hash-chained.
 */
function rebuildLog(run: { state: GraphState }): EventLog {
  const log = emptyLog();
  const appended = appendBatch(
    log,
    run.state.events.map((event) => ({
      draft: { type: event.type, payload: event.payload, actor: event.actor, reason: event.reason },
      context: {
        now: event.at,
        actor: event.actor,
        reason: event.reason,
        occurredAt: event.occurredAt,
      },
    })),
  );

  /* Re-appending sealed events re-mints ids and re-stamps times, so the chain will not match the
   * original. That is acceptable for a seed — the app reseals on import via `substrate/portability.ts`,
   * which is the supported path for bringing an external log in — but it is not acceptable to pretend
   * otherwise, so the reconstruction folds rather than claiming to restore. */
  return appended.ok
    ? appended.log
    : fold(run.state.events, {
        engine: run.state.computedAt ? localEngineId() : localEngineId(),
        now: nowISO(),
      }) && emptyLog();
}

/**
 * One-click reset.
 *
 * Clears every WhyLog key and reports what it cleared. Idempotent: resetting twice is the same as
 * resetting once, which matters because a presenter who is unsure whether the reset landed will press it
 * again, and a reset that compounds would be worse than none.
 */
export function resetDemo(storage: Storage | null): {
  cleared: readonly string[];
  available: boolean;
} {
  if (storage === null) return { cleared: [], available: false };

  const cleared: string[] = [];
  for (const key of RESET_KEYS) {
    if (storage.getItem(key) !== null) {
      storage.removeItem(key);
      cleared.push(key);
    }
  }

  return { cleared, available: true };
}

/** What the reset did, as a sentence a presenter can read aloud if asked. */
export function describeReset(result: { cleared: readonly string[]; available: boolean }): string {
  if (!result.available) {
    return "No storage backend available — the demo is running in memory and a page reload is the reset.";
  }
  if (result.cleared.length === 0) {
    return "Nothing to clear: storage was already empty. Reset is idempotent, so this is a clean start.";
  }
  return (
    "Cleared " +
    result.cleared.length +
    " key(s): " +
    result.cleared.join(", ") +
    ". Rebuilding the seed from the two demo fixtures."
  );
}
