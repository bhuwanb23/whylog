/**
 * Decision Compliance — 4.4. The headline number.
 *
 * Phase 4 · sub-phase 4.4
 * Plan: plan/phase-4-executable-guards.md §4.4
 * Docs: docs/04-executable-decision-guards.md §7
 *
 * ---------------------------------------------------------------------------
 *       Σ | IN decisions whose guards all pass |
 *       ─────────────────────────────────────────
 *       Σ | IN decisions with ≥1 accepted guard |
 *
 * ---------------------------------------------------------------------------
 * DETERMINISTIC GUARDS ONLY, AND THAT IS STRUCTURAL
 *
 * A judged verdict never enters this number. Not because it is labelled advisory elsewhere and
 * we trust the label — because this file filters on `isDeterministic(kind)` and there is no code
 * path from an `llm_judge` result to the quotient. A compliance score that included a model's
 * opinion would change when the model changed, and would stop being a measurement of the
 * codebase.
 *
 * ---------------------------------------------------------------------------
 * THE DENOMINATOR IS THE PART THAT CAN BE GAMED, SO IT IS NAMED
 *
 * Only decisions WITH an accepted guard appear in the denominator. A log with one guard that
 * passes scores 100%, and that is why Verifiable Coverage sits next to this number in every
 * rendering of it. Compliance without coverage is a score that flatters itself, and the two are
 * never shown apart.
 *
 * ---------------------------------------------------------------------------
 * SKIPS ARE NOT PASSES
 *
 * A decision whose guards all skipped has no passing guard and no failing guard. It is counted
 * as NOT compliant — because "we could not check it" is not "it holds" — but it is reported
 * separately as `unchecked`, so a low score caused by a missing paste is distinguishable from a
 * low score caused by real drift. Conflating the two would make the number measure how much the
 * user pasted.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { DecisionId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import { isDeterministic } from "@/types/guards";
import type { EvaluatedGuard } from "../types";

export interface ComplianceResult {
  readonly score: number;
  readonly compliant: number;
  readonly denominator: number;
  /** Decisions whose guards all skipped — no pass and no fail. */
  readonly unchecked: readonly DecisionId[];
  readonly failing: readonly DecisionId[];
  /** Compliance counting only violations NEW since the baseline. The two numbers are always
   *  shown together: raw hides nothing, baseline-relative is what you act on. */
  readonly excludingBaselined: number;
  readonly baselinedOnly: readonly DecisionId[];
}

/**
 * Compute compliance from a completed run.
 *
 * `labels` supplies the decision label, because labels are computed from the graph and nothing
 * stores them. Only IN decisions count: a decision the log does not currently believe is not a
 * decision the codebase is failing to honour.
 */
export function compliance(
  evaluated: readonly EvaluatedGuard[],
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionOfGuard: ReadonlyMap<string, DecisionId>,
): ComplianceResult {
  const byDecision = new Map<DecisionId, readonly EvaluatedGuard[]>();

  for (const entry of evaluated) {
    /* Only deterministic guards, and only accepted ones that actually ran. */
    if (!isDeterministic(entry.guard.spec.kind)) continue;
    if (entry.guard.lifecycle !== "accepted") continue;

    const decisionId = decisionOfGuard.get(entry.guard.id) ?? entry.guard.decisionId;
    const label: DecisionLabel = labels.get(decisionId)?.label ?? "UNKNOWN";
    if (label !== "IN") continue;

    const existing = byDecision.get(decisionId);
    if (existing === undefined) byDecision.set(decisionId, [entry]);
    else (existing as EvaluatedGuard[]).push(entry);
  }

  let compliant = 0;
  const unchecked: DecisionId[] = [];
  const failing: DecisionId[] = [];
  const baselinedOnly: DecisionId[] = [];

  for (const [decisionId, guards] of byDecision) {
    /* A decision whose guards were ALL disabled by label or skipped has nothing to say. */
    const ran = guards.filter((entry) => !entry.skipped);
    if (ran.length === 0) {
      unchecked.push(decisionId);
      continue;
    }

    const failures = ran.filter((entry) => entry.result.outcome === "fail");

    if (failures.length === 0) {
      compliant += 1;
      continue;
    }

    failing.push(decisionId);

    /* Every failure is one the baseline already knew about: the decision is not drifting, it
     * was already like this when the baseline froze. */
    if (failures.every((entry) => !entry.newViolation)) baselinedOnly.push(decisionId);
  }

  const denominator = byDecision.size - unchecked.length;
  const score = denominator === 0 ? 0 : compliant / denominator;

  /* Same quotient, but decisions failing only on baselined violations count as compliant. */
  const excludingBaselined =
    denominator === 0 ? 0 : (compliant + baselinedOnly.length) / denominator;

  return {
    score,
    compliant,
    denominator,
    unchecked,
    failing,
    excludingBaselined,
    baselinedOnly,
  };
}

/** The headline sentence. Written for a person, because this is the number the plan pitches:
 *  "your codebase has quietly stopped believing 3 of your 12 decisions." */
export function describeCompliance(result: ComplianceResult, inDecisions: number): string {
  if (result.denominator === 0) {
    return result.unchecked.length > 0
      ? "No compliance score: " +
          result.unchecked.length +
          " decision(s) have accepted guards but none of them could run against the pasted project. Paste a package.json or a file listing and the score becomes meaningful."
      : "No compliance score: no IN decision has an accepted guard yet. Synthesise and accept guards first — until then there is nothing to measure.";
  }

  const drifted = result.denominator - result.compliant;

  return [
    drifted === 0
      ? "All " +
        result.denominator +
        " checkable decision(s) hold. The code still does what the log says it does."
      : "Your codebase has quietly stopped believing " +
        drifted +
        " of " +
        result.denominator +
        " checkable decision(s): " +
        result.failing.join(", ") +
        ".",
    "",
    "  raw compliance              " +
      percent(result.score) +
      "  (" +
      result.compliant +
      "/" +
      result.denominator +
      ")",
    "  excluding baselined         " +
      percent(result.excludingBaselined) +
      "  (" +
      (result.compliant + result.baselinedOnly.length) +
      "/" +
      result.denominator +
      ")",
    "  verifiable coverage         " +
      percent(result.denominator / Math.max(1, inDecisions)) +
      "  (" +
      result.denominator +
      " of " +
      inDecisions +
      " IN decisions have an accepted deterministic guard)",
    result.unchecked.length > 0
      ? "  unchecked                   " +
        result.unchecked.length +
        " decision(s) whose guards all skipped — not counted either way, because 'could not check' is not 'holds'"
      : "",
    "",
    "Compliance and coverage are NEVER shown apart: a log with one passing guard scores 100%",
    "compliance, so the number on its own flatters itself. Deterministic guards only — a judged",
    "verdict cannot reach this quotient, because a score that moved when the model changed would",
    "not be a measurement of the codebase.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function percent(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

/** Bar for the dashboard, ten cells, as in the plan's D4.2 mock. */
export function bar(value: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
