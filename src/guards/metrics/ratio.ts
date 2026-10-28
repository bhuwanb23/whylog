/**
 * Deterministic Ratio — 4.4.
 *
 * Phase 4 · sub-phase 4.4
 *
 *       deterministic guards
 *       ────────────────────────
 *          all guards
 *
 * "How much of your verification is trustworthy without a model." §4.1 makes this ratio a health
 * metric for the log in its own right, because it is the direct answer to "is this an LLM
 * wrapper?" — a log verified entirely by the six deterministic kinds needs no key, no network
 * and no model, and produces the same result every time it runs.
 */

import type { GraphState } from "@/substrate/graph-state";
import { isDeterministic } from "@/types/guards";
import type { TAXONOMY } from "../taxonomy";

export interface RatioResult {
  readonly score: number;
  readonly deterministic: number;
  readonly judged: number;
  readonly environmentDependent: number;
  readonly total: number;
  /** Count by kind, for the breakdown. Only kinds actually in use appear. */
  readonly byKind: readonly { kind: string; count: number; deterministic: boolean }[];
}

/**
 * Over ACCEPTED guards only.
 *
 * Proposed and suppressed guards are excluded: a ratio that counted guards nobody activated
 * would measure the synthesiser's preferences rather than the log's verification.
 */
export function deterministicRatio(state: GraphState): RatioResult {
  const counts = new Map<string, number>();
  let deterministic = 0;
  let judged = 0;
  let environment = 0;
  let total = 0;

  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted") continue;

    total += 1;
    counts.set(guard.spec.kind, (counts.get(guard.spec.kind) ?? 0) + 1);

    if (isDeterministic(guard.spec.kind)) deterministic += 1;
    else if (guard.spec.kind === "llm_judge") judged += 1;
    else environment += 1;
  }

  const byKind = [...counts.entries()]
    .map(([kind, count]) => ({
      kind,
      count,
      deterministic: isDeterministic(kind as (typeof TAXONOMY)[number]["kind"]),
    }))
    .sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1));

  return {
    score: total === 0 ? 0 : deterministic / total,
    deterministic,
    judged,
    environmentDependent: environment,
    total,
    byKind,
  };
}

export function describeRatio(result: RatioResult): string {
  if (result.total === 0) {
    return "No accepted guards yet, so there is no ratio. Synthesise and accept some — the six deterministic kinds need no key and no network.";
  }

  const lines = [
    "Deterministic ratio: " +
      result.deterministic +
      " of " +
      result.total +
      " accepted guards (" +
      (result.score * 100).toFixed(0) +
      "%) produce the same result every run, with no model and no shell.",
  ];

  if (result.environmentDependent > 0) {
    lines.push(
      "  " +
        result.environmentDependent +
        " command guard(s) — deterministic in principle, environment-dependent in practice, run only in CI.",
    );
  }

  if (result.judged > 0) {
    lines.push(
      "  " +
        result.judged +
        " judged guard(s) — ADVISORY. Non-reproducible, and excluded from the compliance score entirely.",
    );
  }

  lines.push("");
  lines.push("Breakdown by kind:");
  for (const entry of result.byKind) {
    lines.push(
      "  " +
        entry.kind.padEnd(24) +
        entry.count +
        (entry.deterministic ? "" : "  (non-deterministic)"),
    );
  }

  lines.push("");
  lines.push(
    'This ratio is the direct answer to "is this an LLM wrapper?". At 100%, the whole',
    "verification loop — synthesis, evaluation, compliance, drift, and the revision a failure",
    "triggers — runs keyless and reproduces exactly.",
  );

  return lines.join("\n");
}
