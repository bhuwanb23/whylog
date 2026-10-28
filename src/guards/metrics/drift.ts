/**
 * Drift Age — 4.4.
 *
 * Phase 4 · sub-phase 4.4
 *
 * Days since a failing guard was FIRST observed and has not passed since.
 *
 * A failure ignored for 30 days is a decision you no longer hold. The number is not a measure of
 * how broken the code is — it is a measure of how long the log and the code have been allowed to
 * disagree, which is the thing that turns a decision record into fiction.
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, GuardId, ISODateString } from "@/types/common";

export const MS_PER_DAY = 86_400_000;

export interface DriftEntry {
  readonly guardId: GuardId;
  readonly decisionId: DecisionId;
  readonly firstFailedAt: ISODateString;
  readonly days: number;
  readonly evidence: string;
  readonly severity: string;
}

export interface DriftResult {
  /** The oldest unresolved failure, in days. Zero when nothing is failing. */
  readonly worstDays: number;
  readonly worst: DriftEntry | null;
  readonly entries: readonly DriftEntry[];
}

/**
 * Compute drift age from `guard.firstFailedAt`, which the fold maintains: `GuardRan` with a
 * pass clears it, `GuardFailed` sets it if absent. Reading the stored field rather than
 * recomputing from the event log keeps this O(guards) and makes the number consistent with what
 * the guard record already says.
 */
export function driftAge(state: GraphState, now: number): DriftResult {
  const entries: DriftEntry[] = [];

  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted") continue;
    if (guard.firstFailedAt === undefined) continue;

    const first = Date.parse(guard.firstFailedAt);
    if (Number.isNaN(first)) continue;

    entries.push({
      guardId: guard.id,
      decisionId: guard.decisionId,
      firstFailedAt: guard.firstFailedAt,
      days: Math.max(0, Math.floor((now - first) / MS_PER_DAY)),
      evidence: guard.lastRun?.evidence ?? "",
      severity: guard.severity,
    });
  }

  entries.sort((a, b) => b.days - a.days || (a.guardId < b.guardId ? -1 : 1));

  return {
    worstDays: entries[0]?.days ?? 0,
    worst: entries[0] ?? null,
    entries,
  };
}

/** How long to wait before a failure is worth escalating in the UI. Not a threshold that
 *  changes behaviour — the guard fails immediately and stays failed — but the point at which
 *  "you have a failing guard" becomes "you have been living with a contradiction". */
export const DRIFT_ESCALATION_DAYS = 30;

export function describeDrift(result: DriftResult): string {
  if (result.entries.length === 0) {
    return "No unresolved guard failures, so nothing is drifting.";
  }

  const lines = [
    result.entries.length +
      " guard(s) failing. Worst: " +
      result.worstDays +
      " day(s) — " +
      (result.worst === null ? "" : result.worst.decisionId + " / " + result.worst.guardId + "."),
    "",
  ];

  for (const entry of result.entries.slice(0, 8)) {
    lines.push(
      "  " +
        entry.days +
        "d  " +
        entry.decisionId +
        " · " +
        entry.guardId +
        " (" +
        entry.severity +
        ")" +
        (entry.evidence.length > 0 ? " — " + truncate(entry.evidence) : ""),
    );
  }

  if (result.entries.length > 8) lines.push("  … " + (result.entries.length - 8) + " more");

  const escalated = result.entries.filter((entry) => entry.days >= DRIFT_ESCALATION_DAYS);
  if (escalated.length > 0) {
    lines.push("");
    lines.push(
      escalated.length +
        " of these have been failing for " +
        DRIFT_ESCALATION_DAYS +
        "+ days. A failure ignored that long is a decision you no longer hold — either reverse",
      "it in the log or fix the code. Leaving both in place is what turns a decision record into fiction.",
    );
  }

  return lines.join("\n");
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 90 ? flat : flat.slice(0, 87) + "...";
}
