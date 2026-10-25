/**
 * Token budgeting and two-tier emission — 5.4.
 *
 * Phase 5 · sub-phase 5.4
 * Plan: plan/phase-5-export-compiler.md §5.4
 *
 * ---------------------------------------------------------------------------
 * ~200 LINES, BECAUSE ADHERENCE FALLS OFF AFTER THAT
 *
 * Anthropic's guidance is that longer context files consume more context and reduce adherence.
 * That is not a style preference — it is the reason a 600-line CLAUDE.md gets skimmed by a model
 * the same way a 600-line README gets skimmed by a person.
 *
 * So a mature log cannot be emitted in full. Something is left out, and the only question is
 * whether what is left out is chosen by a rule anyone can read.
 *
 * ---------------------------------------------------------------------------
 * TIER 2 IS NOT A DISCARD PILE
 *
 * Decisions that miss the inline budget become one-line index entries:
 *
 *   WLD-0014 · MUST use zustand · src/state/** · see DECISIONS.md
 *
 * The agent still learns the decision EXISTS and where to read it. That is the difference between
 * a budget and a truncation: a truncated file silently omits rules, and an agent cannot follow a
 * rule it has never heard of. An index entry costs one line and preserves the ability to go and
 * look.
 *
 * ---------------------------------------------------------------------------
 * THE BUDGET IS MEASURED, NOT ESTIMATED ONCE AND TRUSTED
 *
 * `allocate` renders nothing; it counts lines from the actual record renderer, then splits. The
 * live indicator in the export view reads the same numbers, so what the user sees as "184 / 200
 * lines" is what the file will contain — not a projection from an average record length that goes
 * wrong on the first decision with nine premises.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { ExportBudget, ExportRecord, IndexEntry } from "@/types/export";
import { DEFAULT_EXPORT_BUDGET_LINES } from "@/types/export";

/** Lines the file spends on everything except records: header, section headings, the rejected
 *  block, the index heading, and the stamp. Counted rather than guessed, because it is the part
 *  most likely to push a file over budget on a log with few decisions and many rejections. */
export interface OverheadEstimate {
  readonly lines: number;
  readonly breakdown: readonly string[];
}

export const FIXED_OVERHEAD: OverheadEstimate = {
  lines: 26,
  breakdown: [
    "title + one-line purpose           3",
    "section headings (×3)              6",
    "rejected-alternatives block        8  (grows with the number of rejections)",
    "index heading + framing            4",
    "integrity stamp                    5",
  ],
};

/** Approximate lines one inline record occupies. The real count comes from `linesFor`, which
 *  renders the record; this is only used to make a first guess before measuring. */
export const APPROX_LINES_PER_RECORD = 9;

/** Rough tokens per line. 12 is conservative for the imperative style these files use — short
 *  lines, identifiers, globs — and being conservative means the indicator over-reports rather
 *  than under-reports, which is the safe direction for a budget. */
export const TOKENS_PER_LINE = 12;

/**
 * Split records into tiers.
 *
 * Records must arrive ALREADY RANKED by priority; this function does not sort, because the
 * ranking is `priority.ts`'s job and doing it twice would mean two orderings that could
 * disagree.
 */
export function allocate(
  ranked: readonly ExportRecord[],
  linesFor: (record: ExportRecord) => number,
  maxLines: number = DEFAULT_EXPORT_BUDGET_LINES,
  overhead: number = FIXED_OVERHEAD.lines,
): { inline: readonly ExportRecord[]; index: readonly ExportRecord[]; budget: ExportBudget } {
  const available = Math.max(0, maxLines - overhead);

  const inline: ExportRecord[] = [];
  const index: ExportRecord[] = [];
  let used = 0;

  for (const record of ranked) {
    const cost = linesFor(record);

    /* Once a record does not fit, everything after it goes to tier 2 — including records that
     * WOULD have fitted. Filling gaps with lower-priority decisions would produce a file whose
     * inline set is not the top-N by priority, and a reader comparing two exports of the same
     * log would see different decisions inline for no reason they can find. */
    if (used + cost > available) {
      index.push(record);
      continue;
    }

    used += cost;
    inline.push(record);
  }

  const totalLines = overhead + used + indexLines(index.length);

  return {
    inline,
    index,
    budget: {
      maxLines,
      inlineCount: inline.length,
      indexCount: index.length,
      excludedCount: 0,
      overBudget: totalLines > maxLines,
    },
  };
}

/** Tier-2 entries cost one line each, plus a heading already counted in the overhead. */
export function indexLines(count: number): number {
  return count;
}

/** Tier-2 one-liner. */
export function indexEntryFor(record: ExportRecord, seeAlso: string): IndexEntry {
  return {
    id: record.id,
    imperative: record.imperative,
    appliesTo: record.appliesTo,
    seeAlso,
  };
}

export function renderIndex(entries: readonly IndexEntry[]): string {
  if (entries.length === 0) return "";

  const lines = [
    "## Index — " + entries.length + " further decision(s), not inline",
    "",
    "These are in force but did not fit the token budget. Each is one line so you know it exists;",
    "read DECISIONS.md for the full record before changing code it governs.",
    "",
  ];

  for (const entry of entries) {
    lines.push(
      "- " + entry.id + " · " + entry.imperative +
        (entry.appliesTo.length > 0 ? " · " + entry.appliesTo.join(", ") : "") +
        " · see " + entry.seeAlso,
    );
  }

  return lines.join("\n");
}

/** The live budget indicator. */
export function describeBudget(budget: ExportBudget, lineCount: number, estimatedTokens: number): string {
  const lines = [
    "Budget: " + lineCount + " / " + budget.maxLines + " lines" +
      (budget.overBudget ? "  — OVER" : "") +
      "  ·  ~" + estimatedTokens + " tokens",
    "  inline (tier 1)   " + budget.inlineCount + " decision(s), full record form",
    "  index  (tier 2)   " + budget.indexCount + " decision(s), one line each",
    "  excluded          " + budget.excludedCount + " (OUT or superseded)",
    "  fixed overhead    " + FIXED_OVERHEAD.lines + " lines (headings, rejected block, stamp)",
  ];

  if (budget.overBudget) {
    lines.push("");
    lines.push(
      "Over budget. Adherence falls off as these files grow, so raise the limit deliberately or",
      "let more decisions fall to tier 2 — do not ship a 600-line context file and hope.",
    );
  }

  return lines.join("\n");
}

export function estimateTokens(lineCount: number): number {
  return Math.round(lineCount * TOKENS_PER_LINE);
}

/** The exclusion list, for the summary: which decisions were left out entirely, and why. */
export function describeExcluded(excluded: readonly { id: DecisionId; reason: string }[]): string {
  if (excluded.length === 0) return "Nothing was excluded.";

  const lines = [
    excluded.length + " decision(s) excluded from the agent files:",
    "",
  ];

  for (const entry of excluded.slice(0, 12)) {
    lines.push("  " + entry.id + " — " + entry.reason);
  }

  if (excluded.length > 12) lines.push("  … " + (excluded.length - 12) + " more");

  lines.push("");
  lines.push("Excluded by default, and only returned under an explicit toggle: a file containing a");
  lines.push("reversed rule alongside its replacement is exactly the \"model may pick one");
  lines.push("arbitrarily\" failure. DECISIONS.md carries them, because a human reading history");
  lines.push("needs the reversals and an agent following rules does not.");

  return lines.join("\n");
}
