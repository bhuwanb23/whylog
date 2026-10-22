/**
 * Formatting helpers for dates, numbers, and Markdown emission.
 *
 * Phase 5 (export) and Phase 6 (presentation).
 *
 * All date formatting is explicit-locale ("en-GB" style ordering is avoided in
 * favour of ISO and long-form) so output is stable across machines. The export
 * compiler's output must be byte-identical for the same graph, or the integrity
 * stamp is meaningless.
 */

import type { ISODateString } from "@/types/common";

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

export function toISO(date: Date): ISODateString {
  return date.toISOString() as ISODateString;
}

export function nowISO(): ISODateString {
  return toISO(new Date());
}

export function parseISO(value: ISODateString | string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A monotonic-ish millisecond clock, safe where `performance` is not.
 *
 * The engines time their own operations to report `durationMs`, and `performance`
 * does not exist in every environment a test may run in. Falling back to
 * `Date.now()` keeps the number meaningful rather than crashing the engine.
 */
export function performanceSafeNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** 2026-10-03 */
export function formatDate(value: ISODateString | string): string {
  const d = parseISO(value);
  if (!d) return String(value);
  return d.toISOString().slice(0, 10);
}

/** 3 Oct 2026 */
export function formatLongDate(value: ISODateString | string): string {
  const d = parseISO(value);
  if (!d) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "18 days ago" / "4 minutes ago" / "just now" */
export function formatRelative(value: ISODateString | string, from: Date = new Date()): string {
  const d = parseISO(value);
  if (!d) return String(value);

  const seconds = Math.round((from.getTime() - d.getTime()) / 1000);
  if (seconds < 45) return "just now";

  const abs = Math.abs(seconds);
  const units: [number, string, string][] = [
    [60, "second", "seconds"],
    [3600, "minute", "minutes"],
    [86400, "hour", "hours"],
    [2592000, "day", "days"],
    [31536000, "month", "months"],
  ];

  let divisor = 1;
  let singular = "second";
  let plural = "seconds";
  for (const [limit, s, p] of units) {
    if (abs < limit * (limit === 60 ? 60 : limit === 3600 ? 60 : limit === 86400 ? 30 : 12)) {
      divisor = limit;
      singular = s;
      plural = p;
      break;
    }
    divisor = limit;
    singular = s;
    plural = p;
  }

  const n = Math.round(abs / divisor);
  const suffix = seconds < 0 ? "from now" : "ago";
  return `${n} ${n === 1 ? singular : plural} ${suffix}`;
}

/** Whole days between two timestamps. Used by the recency term of entrenchment
 *  and by Drift Age. */
export function daysBetween(a: ISODateString | string, b: ISODateString | string): number {
  const da = parseISO(a);
  const db = parseISO(b);
  if (!da || !db) return 0;
  return Math.abs(db.getTime() - da.getTime()) / 86_400_000;
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

export function formatPercent(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatScore(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/** Rough token estimate for budget indicators: ~4 chars per token. Coarse, but
 *  the budget indicator only needs to be directionally honest. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/* -------------------------------------------------------------------------- */
/* Markdown emission                                                          */
/* -------------------------------------------------------------------------- */

/** Escape Markdown control characters in user-authored text. Decision
 *  statements and rationale come from transcripts and routinely contain
 *  backticks, asterisks and angle brackets. */
export function escapeMarkdown(input: string): string {
  return input.replace(/([\\`*_{}[\]<>|])/g, "\\$1");
}

/** Inline code, safe for values that may contain backticks. */
export function inlineCode(input: string): string {
  const fence = input.includes("`") ? "``" : "`";
  return `${fence}${input}${fence}`;
}

export function bulletList(items: readonly string[], indent = 0): string {
  const pad = " ".repeat(indent);
  return items.map((item) => `${pad}- ${item}`).join("\n");
}

export function heading(level: 1 | 2 | 3 | 4 | 5 | 6, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

/** Join non-empty lines, dropping blanks — keeps exported files inside the
 *  ~200-line budget without accidental gaps. */
export function joinLines(lines: readonly (string | null | undefined)[]): string {
  return lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0).join("\n");
}

/* -------------------------------------------------------------------------- */
/* Text truncation for UI                                                     */
/* -------------------------------------------------------------------------- */

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
