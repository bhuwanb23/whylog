/**
 * Bi-temporal bookkeeping.
 *
 * Phase 0 · sub-phase 0.3
 * Plan: plan/phase-0-foundation.md §0.3 · docs/06 §3 (Zep/Graphiti)
 *
 * ---------------------------------------------------------------------------
 * THE RULE, IN ONE SENTENCE
 *
 * ORDERING, DISPLAY AND RECENCY USE **VALID** TIME (`window.valid` — when it
 * became true in the world). THE AUDIT TRAIL USES **LEARNED** TIME
 * (`window.learned` — when WhyLog found out).
 *
 * ---------------------------------------------------------------------------
 * WHY TWO CLOCKS
 *
 * A decision made on Monday and pasted into WhyLog on Friday has valid =
 * Monday, learned = Friday. If the timeline shows Friday, the user sees their
 * own history scrambled by the accident of when they remembered to paste it. If
 * the audit trail shows Monday, there is no way to answer "what did the system
 * believe on Wednesday?" — which is the question every truth-maintenance failure
 * eventually needs answered.
 *
 * Worse: entrenchment's recency term feeds a revision ORDER. Using learned time
 * would make a freshly-pasted OLD decision look maximally entrenched, exactly
 * backwards, and it would be unfixable afterwards because the timestamps are
 * already sealed into the hash chain.
 *
 * The two clocks are therefore not a feature. They are the reason the log can be
 * trusted later.
 *
 * ---------------------------------------------------------------------------
 * NODES ARE CLOSED OUT, NEVER DELETED (invariant I1)
 *
 * `invalidFrom` + `invalidatedBy` + `reason` close a window. A closed node is
 * still projected, still searchable, still exportable — with its interval shown.
 * Nothing in this module ever removes a node from a map.
 * ---------------------------------------------------------------------------
 */

import type { EventId, ISODateString, ValidityWindow } from "@/types/common";

const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/** An OPEN window: valid from a moment in the world, learned at a moment in the
 *  log, still current. This is the only constructor for a new node. */
export function openWindow(valid: ISODateString, learned: ISODateString): ValidityWindow {
  return { valid, learned };
}

/** A window that is already closed at construction — used when importing a
 *  historical transcript whose decision was later reversed, so the fold does not
 *  have to replay two events to reach the correct shape. */
export function closedWindow(
  valid: ISODateString,
  learned: ISODateString,
  invalidFrom: ISODateString,
  invalidatedBy: EventId,
  reason: string,
): ValidityWindow {
  return { valid, learned, invalidFrom, invalidatedBy, reason };
}

/**
 * Close a window.
 *
 * Idempotent: a window already closed at or before `invalidFrom` is returned
 * unchanged, so replaying a duplicate `PremiseInvalidated` cannot corrupt it.
 * Never mutates — the fold stays pure.
 */
export function closeWindow(
  window: ValidityWindow,
  invalidFrom: ISODateString,
  invalidatedBy: EventId,
  reason: string,
): ValidityWindow {
  if (window.invalidFrom !== undefined && window.invalidFrom <= invalidFrom) {
    return window;
  }
  return { ...window, invalidFrom, invalidatedBy, reason };
}

/**
 * Re-open a closed window: a node re-asserted after being invalidated.
 *
 * `learned` moves to now; `valid` restarts at the new moment; the closing
 * fields are cleared. On the timeline this renders as a gap and then a fresh
 * open interval — the honest picture of a revived belief.
 */
export function reopenWindow(valid: ISODateString, learned: ISODateString): ValidityWindow {
  return { valid, learned };
}

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

/** Still current — no closing event has arrived. */
export function isOpen(window: ValidityWindow): boolean {
  return window.invalidFrom === undefined;
}

/** Is the node valid at a given VALID-time instant? Half-open interval:
 *  `[valid, invalidFrom)`. */
export function isValidAt(window: ValidityWindow, at: ISODateString): boolean {
  if (at < window.valid) return false;
  if (window.invalidFrom !== undefined && at >= window.invalidFrom) return false;
  return true;
}

/** Had the system LEARNED of this node by a given LEARNED-time instant? */
export function isKnownAt(window: ValidityWindow, at: ISODateString): boolean {
  return window.learned <= at;
}

/**
 * The as-of filter used by every projection and by the time machine.
 *
 * `asOfValid` alone answers "what was true then?".
 * Both together answer "what did the system believe then, about what was true
 * then?" — strictly more conservative, and what the audit view uses.
 */
export interface AsOfFilter {
  readonly asOfValid?: ISODateString;
  readonly asOfLearned?: ISODateString;
}

export const NO_FILTER: AsOfFilter = {};

export function matchesAsOf(window: ValidityWindow, filter: AsOfFilter): boolean {
  if (filter.asOfValid !== undefined && !isValidAt(window, filter.asOfValid)) return false;
  if (filter.asOfLearned !== undefined && !isKnownAt(window, filter.asOfLearned)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/** Newest-first by VALID time. The timeline order, the default search order,
 *  and the recency input to entrenchment. */
export function byValidDesc<T extends { temporal: { readonly valid: ISODateString } }>(
  a: T,
  b: T,
): number {
  if (a.temporal.valid === b.temporal.valid) return 0;
  return a.temporal.valid < b.temporal.valid ? 1 : -1;
}

/** Oldest-first by VALID time. The order an export narrates in. */
export function byValidAsc<T extends { temporal: { readonly valid: ISODateString } }>(
  a: T,
  b: T,
): number {
  if (a.temporal.valid === b.temporal.valid) return 0;
  return a.temporal.valid < b.temporal.valid ? -1 : 1;
}

/** Oldest-first by LEARNED time. The audit trail order. */
export function byLearnedAsc<T extends { learned: ISODateString }>(a: T, b: T): number {
  if (a.learned === b.learned) return 0;
  return a.learned < b.learned ? -1 : 1;
}

/** Tie-break comparator: stable by id, so identical timestamps never produce a
 *  run-order-dependent rendering. */
export function byIdAsc<T extends { id: string }>(a: T, b: T): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Compose comparators. `compare(byValidDesc, byIdAsc)` gives a total order. */
export function compare<T>(
  primary: (a: T, b: T) => number,
  secondary: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => primary(a, b) || secondary(a, b);
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                 */
/* -------------------------------------------------------------------------- */

function parse(value: ISODateString): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Days of validity as of a reference instant.
 *
 * Feeds the recency term of entrenchment (30-day half-life, plan/phase-2 §2.4).
 * A closed-out node ages from `valid` to `invalidFrom` and then STOPS: it is no
 * longer the live belief, so its age is not the interesting question — whether
 * it is live is.
 */
export function validAgeDays(window: ValidityWindow, reference: ISODateString): number {
  const from = parse(window.valid);
  const end = window.invalidFrom !== undefined ? parse(window.invalidFrom) : parse(reference);
  return Math.max(0, (Math.min(end, parse(reference)) - from) / DAY_MS);
}

/** Days since WhyLog learned of the node. Used by the health panel to surface
 *  "this decision has sat unreviewed for N days". */
export function learnedAgeDays(window: ValidityWindow, reference: ISODateString): number {
  return Math.max(0, (parse(reference) - parse(window.learned)) / DAY_MS);
}

/** Days a node has been failing continuously (Drift Age, Phase 4.4). */
export function driftAgeDays(firstFailedAt: ISODateString, reference: ISODateString): number {
  return Math.max(0, (parse(reference) - parse(firstFailedAt)) / DAY_MS);
}

/**
 * Overlap between two validity windows, in days.
 *
 * Zero means they never coexisted — two decisions on the same variable in
 * disjoint intervals are a REFINEMENT over time, not a contradiction, and gate
 * (a) must not fire. This single check is what stops the timeline view from
 * accusing the user of contradicting themselves every time they change their
 * mind sequentially, which is the normal case.
 *
 * Returns `Infinity` when both are open, so callers compare with `> 0`.
 */
export function overlapDays(a: ValidityWindow, b: ValidityWindow): number {
  const start = Math.max(parse(a.valid), parse(b.valid));
  const aEnd = a.invalidFrom !== undefined ? parse(a.invalidFrom) : Number.POSITIVE_INFINITY;
  const bEnd = b.invalidFrom !== undefined ? parse(b.invalidFrom) : Number.POSITIVE_INFINITY;
  const end = Math.min(aEnd, bEnd);
  if (end === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.max(0, (end - start) / DAY_MS);
}

/** Cheap pre-check before `overlapDays`. */
export function overlaps(a: ValidityWindow, b: ValidityWindow): boolean {
  if (a.invalidFrom !== undefined && b.valid >= a.invalidFrom) return false;
  if (b.invalidFrom !== undefined && a.valid >= b.invalidFrom) return false;
  return true;
}

/** Exponential decay with a 30-day half-life, in (0, 1]. 1.0 for a decision
 *  made today. Exported here rather than in reasoning/ because the input is a
 *  validity window, not an entrenchment breakdown. */
export function recency(
  window: ValidityWindow,
  reference: ISODateString,
  halfLifeDays = 30,
): number {
  const age = validAgeDays(window, reference);
  return 0.5 ** (age / halfLifeDays);
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

function day(value: ISODateString): string {
  const t = parse(value);
  if (t === 0) return String(value);
  return new Date(t).toISOString().slice(0, 10);
}

/** "2026-10-03 – present" or "2026-10-03 – 2026-10-09". */
export function formatInterval(window: ValidityWindow): string {
  if (window.invalidFrom === undefined) return `${day(window.valid)} – present`;
  return `${day(window.valid)} – ${day(window.invalidFrom)}`;
}

/** The lag between the world and the log, in days. Shown on import so the user
 *  can see that WhyLog noticed the two clocks differ. */
export function ingestionLagDays(window: ValidityWindow): number {
  return Math.max(0, (parse(window.learned) - parse(window.valid)) / DAY_MS);
}

/** True when a node was learned materially after it became true — the signature
 *  of a back-dated historical import, worth flagging in the UI. */
export function isBackDated(window: ValidityWindow, thresholdDays = 1): boolean {
  return ingestionLagDays(window) > thresholdDays;
}
