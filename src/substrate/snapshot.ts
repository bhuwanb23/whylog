/**
 * Projection cache, keyed by `lastEventId`.
 *
 * Phase 0 · sub-phase 0.2
 * Plan: plan/phase-0-foundation.md §0.2
 *
 * ---------------------------------------------------------------------------
 * WHAT A SNAPSHOT IS
 *
 * A materialised state plus the id of the last event it consumed. That pair is the
 * whole trick: if the log's head is still that event, the snapshot is exactly
 * correct and can be used without recomputation; if not, the snapshot is a PREFIX
 * of the truth and the remaining events can be applied on top.
 *
 * This is what makes reload fast without making the state authoritative. The log
 * is still the only source of truth — a snapshot is a resumption point, and
 * throwing every snapshot away changes nothing except speed.
 * ---------------------------------------------------------------------------
 */

import type { EventId, ISODateString } from "@/types/common";
import type { AnyEvent } from "@/types/events";
import type { GraphState } from "./graph-state";
import { emptyState } from "./graph-state";
import { applyBatch, fold, type FoldOptions } from "./materialize";

export interface Snapshot {
  readonly state: GraphState;
  /** The last event this state has consumed. Null for an empty snapshot. */
  readonly lastEventId: EventId | null;
  readonly takenAt: ISODateString;
  readonly eventsConsumed: number;
}

export function takeSnapshot(state: GraphState, at: ISODateString): Snapshot {
  return {
    state,
    lastEventId: state.lastEventId,
    takenAt: at,
    eventsConsumed: state.events.length,
  };
}

/** Is this snapshot still exactly current? */
export function isCurrent(snapshot: Snapshot, log: readonly AnyEvent[]): boolean {
  if (log.length === 0) return snapshot.lastEventId === null;
  return snapshot.lastEventId === log[log.length - 1]?.id;
}

/**
 * Where a snapshot sits relative to a log.
 *
 *   `current`  — the snapshot consumed the whole log; use it as-is.
 *   `prefix`   — the snapshot is a valid prefix; apply the remainder.
 *   `diverged` — the log does not contain the snapshot's last event at the
 *                position the snapshot claims. The snapshot came from a different
 *                chain (an import, a rollback, another machine) and MUST be
 *                discarded rather than extended. Extending a diverged snapshot is
 *                how a state silently stops matching its log.
 */
export type SnapshotRelation =
  | { readonly kind: "current" }
  | { readonly kind: "prefix"; readonly remaining: readonly AnyEvent[] }
  | { readonly kind: "diverged"; readonly reason: string };

export function relate(snapshot: Snapshot, log: readonly AnyEvent[]): SnapshotRelation {
  if (snapshot.lastEventId === null) {
    return log.length === 0
      ? { kind: "current" }
      : { kind: "prefix", remaining: log };
  }

  const index = log.findIndex((e) => e.id === snapshot.lastEventId);
  if (index < 0) {
    return {
      kind: "diverged",
      reason: `event ${snapshot.lastEventId} is not in this log`,
    };
  }
  if (index + 1 !== snapshot.eventsConsumed) {
    return {
      kind: "diverged",
      reason: `the snapshot consumed ${snapshot.eventsConsumed} events but its head sits at position ${index + 1}`,
    };
  }
  if (index + 1 === log.length) return { kind: "current" };

  return { kind: "prefix", remaining: log.slice(index + 1) };
}

/**
 * Resolve a snapshot against a log: reuse, extend, or rebuild.
 *
 * This is the function the store calls on boot. It prefers the cheapest correct
 * answer and never returns a state that disagrees with the log.
 */
export function resolve(
  snapshot: Snapshot | null,
  log: readonly AnyEvent[],
  options: FoldOptions,
): { state: GraphState; via: "empty" | "snapshot" | "extended" | "rebuilt"; appliedCount: number } {
  if (log.length === 0) {
    return { state: emptyState(options.engine, options.now), via: "empty", appliedCount: 0 };
  }

  if (snapshot === null) {
    return { state: fold(log, options), via: "rebuilt", appliedCount: log.length };
  }

  const relation = relate(snapshot, log);

  switch (relation.kind) {
    case "current":
      return { state: snapshot.state, via: "snapshot", appliedCount: 0 };

    case "prefix":
      // Apply only the remainder. One `finalise` for the whole batch, so the
      // derived indexes are rebuilt once rather than once per event.
      return {
        state: applyBatch(snapshot.state, relation.remaining),
        via: "extended",
        appliedCount: relation.remaining.length,
      };

    case "diverged":
      // Discard and rebuild. Slower, and correct: a snapshot from another chain
      // cannot be extended into this one.
      return { state: fold(log, options), via: "rebuilt", appliedCount: log.length };
  }
}

/**
 * An LRU of snapshots, for the time machine.
 *
 * Scrubbing backwards through history would otherwise re-fold from genesis on
 * every frame. Keeping a handful of checkpoints turns a drag into a short replay
 * from the nearest one.
 */
export interface SnapshotCache {
  readonly entries: readonly Snapshot[];
  readonly maxSize: number;
}

export function emptyCache(maxSize = 8): SnapshotCache {
  return { entries: [], maxSize };
}

export function putSnapshot(cache: SnapshotCache, snapshot: Snapshot): SnapshotCache {
  const without = cache.entries.filter((s) => s.lastEventId !== snapshot.lastEventId);
  const entries = [snapshot, ...without].slice(0, cache.maxSize);
  return { entries, maxSize: cache.maxSize };
}

/** The nearest snapshot at or before a target event position. */
export function nearestBefore(
  cache: SnapshotCache,
  log: readonly AnyEvent[],
  targetIndex: number,
): Snapshot | null {
  const target = log[targetIndex];
  if (!target) return null;

  let best: Snapshot | null = null;
  let bestIndex = -1;

  for (const snapshot of cache.entries) {
    if (snapshot.lastEventId === null) continue;
    const index = log.findIndex((e) => e.id === snapshot.lastEventId);
    if (index < 0 || index > targetIndex) continue;
    if (index > bestIndex) {
      best = snapshot;
      bestIndex = index;
    }
  }

  return best;
}

/** Materialise the state at a position in the log, using the cache when it helps. */
export function stateAtIndex(
  cache: SnapshotCache,
  log: readonly AnyEvent[],
  index: number,
  options: FoldOptions,
): GraphState {
  const slice = log.slice(0, index + 1);
  const nearest = nearestBefore(cache, log, index);

  if (nearest === null) return fold(slice, options);

  const relation = relate(nearest, slice);
  if (relation.kind === "current") return nearest.state;
  if (relation.kind === "prefix") return applyBatch(nearest.state, relation.remaining);
  return fold(slice, options);
}
