/**
 * Timestamp recovery — 1.1.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * ---------------------------------------------------------------------------
 * WHY `uncertain` IS A FIELD AND NOT A FALLBACK
 *
 * `occurredAt` is the VALID time of everything extracted from the transcript. It
 * is what the timeline sorts on, what the time machine cuts on, and what
 * `recency()` feeds into entrenchment. Defaulting it to import time and saying
 * nothing would place a decision made in March at the moment it was pasted in
 * October — and the error would be invisible, because the date would look
 * perfectly reasonable.
 *
 * So: recover a timestamp where the text has one; otherwise use the value the
 * user supplied; otherwise use import time AND SET `uncertain`. The review UI
 * shows the flag and offers a date field. Nothing is silently wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY A YEAR-LESS DATE RESOLVES BACKWARDS
 *
 * "Oct 3, 14:22" has no year. Resolving it forwards would put a transcript from
 * last October nine months in the future, and a future `occurredAt` is worse than
 * an uncertain one: rule 5 of the event log deliberately does NOT check
 * `occurredAt` against the present, so nothing downstream would catch it. The
 * most recent past occurrence is the only safe reading.
 * ---------------------------------------------------------------------------
 */

import type { ISODateString } from "@/types/common";
import { nowISO, toISO } from "@/lib/format";
import { linesWithOffsets } from "./speakers";

export interface RecoveredTime {
  readonly at: ISODateString;
  readonly uncertain: boolean;
  /** Where it came from, for the review UI. */
  readonly source: "user-supplied" | "transcript-header" | "inline" | "import-time";
  /** The verbatim text it was read from, when it was read from the transcript. */
  readonly evidence?: string;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/** ISO 8601, with or without time: `2026-10-03`, `2026-10-03T14:22`,
 *  `2026-10-03T14:22:07.123Z`. */
const ISO_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** `Oct 3`, `October 3rd`, `3 Oct 2026`, `Oct 3, 2026`, optionally with a time. */
const MONTH_NAME_PATTERN =
  /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?(?:,?\s*(\d{1,2}):(\d{2}))?\b|\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{4}))?/;

/** `[14:22]`, `(14:22:07)`, `14:22 —` at the start of a line. Time only: it is
 *  attached to the date recovered from the header, or to today. */
const TIME_ONLY_PATTERN = /^\s*[\[(<]?(\d{1,2}):(\d{2})(?::(\d{2}))?[\])>]?\s*[—–-]?\s/;

/**
 * How far into the transcript to look for a header timestamp.
 *
 * Chat exports put it in the first few lines; scanning the whole thing would pick
 * up a date mentioned in the MIDDLE of a discussion ("we shipped this on Oct 3")
 * and mistake it for the session time. A header is a header.
 */
const HEADER_WINDOW_LINES = 12;

export function recoverTimestamp(
  raw: string,
  userSupplied?: ISODateString,
  reference: Date = new Date(),
): RecoveredTime {
  if (userSupplied !== undefined && userSupplied.length > 0) {
    return { at: userSupplied, uncertain: false, source: "user-supplied" };
  }

  const header = headerLines(raw);

  const fromHeader = parseAny(header.text, reference);
  if (fromHeader !== null) {
    return {
      at: fromHeader.at,
      uncertain: false,
      source: "transcript-header",
      evidence: fromHeader.evidence,
    };
  }

  // No date anywhere in the header, but a bare clock time: attach it to the
  // reference date. Still uncertain — the DAY is a guess even though the hour
  // is not.
  const timeOnly = TIME_ONLY_PATTERN.exec(header.text);
  if (timeOnly !== null) {
    const at = buildDate(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate(),
      Number(timeOnly[1] ?? 0),
      Number(timeOnly[2] ?? 0),
      Number(timeOnly[3] ?? 0),
    );
    if (at !== null) {
      return {
        at,
        uncertain: true,
        source: "inline",
        evidence: timeOnly[0].trim(),
      };
    }
  }

  return { at: nowISO(), uncertain: true, source: "import-time" };
}

function headerLines(raw: string): { text: string; lines: number } {
  const lines = linesWithOffsets(raw).slice(0, HEADER_WINDOW_LINES);
  return { text: lines.map((l) => l.text).join("\n"), lines: lines.length };
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

interface Parsed {
  readonly at: ISODateString;
  readonly evidence: string;
}

function parseAny(text: string, reference: Date): Parsed | null {
  return parseIso(text) ?? parseMonthName(text, reference);
}

function parseIso(text: string): Parsed | null {
  const match = ISO_PATTERN.exec(text);
  if (match === null) return null;

  const at = buildDate(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  if (at === null) return null;
  return { at, evidence: match[0] };
}

function parseMonthName(text: string, reference: Date): Parsed | null {
  const match = MONTH_NAME_PATTERN.exec(text);
  if (match === null) return null;

  // Two orderings are handled by one regex, so the groups differ.
  const monthName = (match[1] ?? match[8] ?? "").toLowerCase().replace(/\.$/, "");
  const month = MONTHS[monthName];
  if (month === undefined) return null;

  const day = Number(match[1] !== undefined ? match[2] : match[6]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const explicitYear = match[1] !== undefined ? match[3] : match[9];
  const year = explicitYear === undefined ? resolveYear(month, day, reference) : Number(explicitYear);

  const at = buildDate(
    year,
    month,
    day,
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    0,
  );
  if (at === null) return null;
  return { at, evidence: match[0] };
}

/**
 * A year-less date means the MOST RECENT PAST occurrence of that month and day.
 * See the file header for why forwards resolution is not an option.
 */
export function resolveYear(month: number, day: number, reference: Date): number {
  const thisYear = reference.getFullYear();
  const candidate = new Date(Date.UTC(thisYear, month, day));
  const today = new Date(Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()));
  return candidate.getTime() <= today.getTime() ? thisYear : thisYear - 1;
}

function buildDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): ISODateString | null {
  if (!Number.isFinite(year) || year < 1970 || year > 2999) return null;
  if (!Number.isFinite(month) || month < 0 || month > 11) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  // Date.UTC rolls overflow forwards (month 13 becomes next January), which would
  // silently turn a bad parse into a plausible date. Reject instead.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  if (Number.isNaN(date.getTime())) return null;

  return toISO(date);
}

/** How the review UI words the uncertainty. Deliberately specific: "unknown date"
 *  invites the user to shrug, whereas naming the consequence invites a fix. */
export function describeUncertainty(result: RecoveredTime): string | null {
  if (!result.uncertain) return null;
  if (result.source === "inline") {
    return `The transcript gives a clock time (${result.evidence ?? "?"}) but no date, so the day is assumed to be the import day. Correct it if that is wrong — the timeline and the recency term in entrenchment both read this date.`;
  }
  return "No timestamp was found in the transcript, so every decision from it is dated at the moment of import. Correct it in the review header — the timeline and the recency term in entrenchment both read this date.";
}
