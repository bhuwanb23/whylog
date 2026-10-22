/**
 * Tool-call, diff and stack-trace collapsing — 1.1.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * ---------------------------------------------------------------------------
 * COLLAPSED FOR EXTRACTION, RETAINED VERBATIM FOR SNIPPETS
 *
 * Those are two different requirements and the design has to satisfy both:
 *
 *   • A 400-line `npm install` output between two turns is not decision text.
 *     Left in, it dilutes every cue scan, inflates the chunk count, and gives the
 *     episode segmenter a 400-line "topic" to split on. It gets replaced by a
 *     placeholder in the text the recognisers read.
 *
 *   • But a decision CAN cite it — "we dropped the ORM because the migration
 *     output was 90 lines of ALTER TABLE" is a real rationale, and the evidence
 *     contract requires that quote to resolve. So the raw characters stay in
 *     `NormalizedTranscript.raw`, and `NoiseRegion.raw` keeps the verbatim text.
 *
 * The offset map is what makes both true at once: the placeholder occupies
 * normalised characters that map to a raw range, and `spanFrom` refuses to build a
 * span across that discontinuity unless the caller asks for the raw text
 * explicitly. See `offset-map.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY DETECTION IS CONSERVATIVE
 *
 * A false collapse destroys evidence permanently — the recogniser never sees the
 * text. A missed collapse only costs precision. So every detector here requires
 * either a strong marker or a minimum run length, and anything ambiguous is left
 * alone. The stats are reported so a transcript that collapsed 80% of itself is
 * visibly suspicious in the review header.
 * ---------------------------------------------------------------------------
 */

import type { NoiseKind, NoiseRegion } from "./types";
import { linesWithOffsets, type LineSpan } from "./speakers";
import { OffsetMapBuilder } from "./offset-map";

/** Shortest run of lines that may be collapsed. Below this, leave it: a
 *  three-line diff is often quoted deliberately. */
const MIN_RUN_LINES = 4;

/** A diff or a file listing may be shorter if its marker density is perfect. */
const MIN_DENSE_RUN_LINES = 3;

const TOOL_OPEN = /^\s*(?:⏺|●)\s*[A-Za-z][\w.-]*\s*\(/u;
const TOOL_CONTINUATION = /^\s*⎿/u;
const TOOL_LABEL = /^\s*(?:Bash|Read|Write|Edit|Grep|Glob|LS|WebFetch|WebSearch|Task|TodoWrite|NotebookEdit|MultiEdit)\s*\(/;

const DIFF_HEADER = /^(?:diff --git|index [0-9a-f]{7,}\.\.|---\s+a\/|\+\+\+\s+b\/|@@\s)/;
const DIFF_LINE = /^[+-]\s?\S/;

const TRACE_START = /^\s*(?:at\s+[\w$.<>/[\]-]+\s*\(|(?:[\w$.]+\.)?(?:Error|Exception|Failure|panic|Traceback)\b)/;
const TRACE_FRAME = /^\s*(?:at\s+|File\s+"|Caused by:|\s+from\s+|\tat\s)/;
const TRACE_PATH = /^\s*(?:node_modules|dist|build|src|\.\/|\.\.\/|\/)[\w./@-]+\.(?:ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h)[:(]\d+/;

const FILE_LINE = /^\s*(?:[-*•]\s+)?[\w.@/-]+\.(?:ts|tsx|js|jsx|json|md|py|rb|go|rs|css|html|yml|yaml|toml|svg|sh)(?:\s+\(\d+\s+(?:lines?|bytes?)\))?\s*$/;
const FILE_HEADER = /^\s*(?:file listing|files changed|\d+ files? changed)/i;

const INDENTED_OUTPUT = /^\s{2,}\S/;

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

export interface NoiseScan {
  readonly regions: readonly NoiseRegion[];
  readonly charsCollapsed: number;
  readonly byKind: Readonly<Record<NoiseKind, number>>;
}

export const EMPTY_NOISE_SCAN: NoiseScan = {
  regions: [],
  charsCollapsed: 0,
  byKind: { "tool-call": 0, diff: 0, "stack-trace": 0, "long-output": 0, "file-listing": 0 },
};

/** A single run of consecutive noisy lines. */
interface Run {
  readonly kind: NoiseKind;
  readonly startLine: number;
  readonly endLine: number;
}

/* -------------------------------------------------------------------------- */
/* Scan                                                                       */
/* -------------------------------------------------------------------------- */

/** Find the noisy runs. Does not modify anything — `collapseNoise` applies them. */
export function scanNoise(raw: string): readonly Run[] {
  const lines = linesWithOffsets(raw);
  const runs: Run[] = [];

  let i = 0;
  while (i < lines.length) {
    const detected =
      detectToolCall(lines, i) ??
      detectStackTrace(lines, i) ??
      detectDiff(lines, i) ??
      detectFileListing(lines, i) ??
      detectLongOutput(lines, i);

    if (detected === null) {
      i += 1;
      continue;
    }
    runs.push(detected);
    i = detected.endLine + 1;
  }

  return runs;
}

/**
 * Apply the runs: produce the extraction text and the retained regions.
 *
 * The builder advances the offset map through `keep()` for prose and `skip()` for
 * each collapsed run, which is the only way the map stays exact.
 */
export function collapseNoise(
  raw: string,
  runs: readonly Run[],
  builder: OffsetMapBuilder,
  parts: string[],
): NoiseScan {
  if (runs.length === 0) {
    builder.keep(raw.length);
    parts.push(raw);
    return EMPTY_NOISE_SCAN;
  }

  const lines = linesWithOffsets(raw);
  const regions: NoiseRegion[] = [];
  const byKind: Record<NoiseKind, number> = {
    "tool-call": 0,
    diff: 0,
    "stack-trace": 0,
    "long-output": 0,
    "file-listing": 0,
  };
  let charsCollapsed = 0;
  let cursor = 0;

  for (const run of runs) {
    const first = lines[run.startLine];
    const last = lines[run.endLine];
    if (first === undefined || last === undefined) continue;

    const start = first.start;
    const end = last.end;
    if (start < cursor) continue; // overlapping runs: the first one wins

    // Prose before this run.
    if (start > cursor) {
      const prose = raw.slice(cursor, start);
      builder.keep(prose.length);
      parts.push(prose);
    }

    const regionRaw = raw.slice(start, end);
    const lineCount = run.endLine - run.startLine + 1;
    const placeholder = placeholderFor(run.kind, lineCount);

    builder.skip(regionRaw.length, placeholder.length);
    parts.push(placeholder);

    regions.push({
      kind: run.kind,
      rawStart: start,
      rawEnd: end,
      raw: regionRaw,
      replacedWith: placeholder,
    });

    byKind[run.kind] += 1;
    charsCollapsed += regionRaw.length;
    cursor = end;
  }

  if (cursor < raw.length) {
    const tail = raw.slice(cursor);
    builder.keep(tail.length);
    parts.push(tail);
  }

  return { regions, charsCollapsed, byKind };
}

/** The placeholder is stable text rather than a counter, so the same transcript
 *  normalises to the same string on every run. Determinism is what makes the
 *  local path's output comparable across runs and fixtures. */
export function placeholderFor(kind: NoiseKind, lineCount: number): string {
  const label: Record<NoiseKind, string> = {
    "tool-call": "tool call",
    diff: "diff",
    "stack-trace": "stack trace",
    "long-output": "command output",
    "file-listing": "file listing",
  };
  return `\n[${label[kind]} · ${lineCount} lines collapsed]\n`;
}

/* -------------------------------------------------------------------------- */
/* Detectors                                                                  */
/* -------------------------------------------------------------------------- */

function detectToolCall(lines: readonly LineSpan[], at: number): Run | null {
  const line = lines[at];
  if (line === undefined) return null;
  if (!TOOL_OPEN.test(line.text) && !TOOL_LABEL.test(line.text) && !TOOL_CONTINUATION.test(line.text)) return null;

  let end = at;
  for (let i = at + 1; i < lines.length; i += 1) {
    const next = lines[i];
    if (next === undefined) break;
    const continues =
      TOOL_CONTINUATION.test(next.text) ||
      INDENTED_OUTPUT.test(next.text) ||
      next.blank;
    // A blank line only continues the run if something noisy follows it.
    if (!continues) break;
    if (next.blank && !hasNoiseWithin(lines, i + 1, 2)) break;
    end = i;
  }

  if (end - at + 1 < 2) return null; // a lone tool header is a decision-adjacent fact, keep it
  return { kind: "tool-call", startLine: at, endLine: end };
}

function detectStackTrace(lines: readonly LineSpan[], at: number): Run | null {
  const line = lines[at];
  if (line === undefined) return null;
  if (!TRACE_START.test(line.text) && !TRACE_PATH.test(line.text)) return null;

  let end = at;
  let frames = 0;
  for (let i = at + 1; i < lines.length; i += 1) {
    const next = lines[i];
    if (next === undefined) break;
    if (TRACE_FRAME.test(next.text) || TRACE_PATH.test(next.text)) {
      frames += 1;
      end = i;
      continue;
    }
    if (next.blank && hasTraceWithin(lines, i + 1, 2)) {
      end = i;
      continue;
    }
    break;
  }

  if (frames < 2 || end - at + 1 < MIN_RUN_LINES) return null;
  return { kind: "stack-trace", startLine: at, endLine: end };
}

function detectDiff(lines: readonly LineSpan[], at: number): Run | null {
  const line = lines[at];
  if (line === undefined) return null;

  const startsWithHeader = DIFF_HEADER.test(line.text);
  if (!startsWithHeader && !DIFF_LINE.test(line.text)) return null;

  let end = at;
  let diffLines = 0;
  for (let i = at; i < lines.length; i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) break;
    if (DIFF_HEADER.test(candidate.text) || DIFF_LINE.test(candidate.text)) {
      diffLines += 1;
      end = i;
      continue;
    }
    if (candidate.blank && i > at) {
      end = i;
      continue;
    }
    break;
  }

  const length = end - at + 1;
  const dense = diffLines / Math.max(length, 1);
  if (dense < 0.6) return null;
  if (length < (startsWithHeader ? MIN_DENSE_RUN_LINES : MIN_RUN_LINES)) return null;
  return { kind: "diff", startLine: at, endLine: end };
}

function detectFileListing(lines: readonly LineSpan[], at: number): Run | null {
  const line = lines[at];
  if (line === undefined) return null;

  const startsWithHeader = FILE_HEADER.test(line.text);
  if (!startsWithHeader && !FILE_LINE.test(line.text)) return null;

  let end = at;
  let fileLines = 0;
  for (let i = at; i < lines.length; i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) break;
    if (FILE_LINE.test(candidate.text)) {
      fileLines += 1;
      end = i;
      continue;
    }
    if (startsWithHeader && i === at) {
      end = i;
      continue;
    }
    break;
  }

  const length = end - at + 1;
  if (fileLines < MIN_DENSE_RUN_LINES) return null;
  if (fileLines / Math.max(length, 1) < 0.7) return null;
  return { kind: "file-listing", startLine: at, endLine: end };
}

/**
 * A long run of indented, non-prose lines with no decision cue in it.
 *
 * The weakest detector, so it has the highest bar: 15 lines minimum, and it stops
 * immediately at anything that looks like a sentence. Command output is what this
 * catches — the `npm install` wall, the test-runner summary, the `ls -R`.
 */
function detectLongOutput(lines: readonly LineSpan[], at: number): Run | null {
  const line = lines[at];
  if (line === undefined || line.blank) return null;
  if (!INDENTED_OUTPUT.test(line.text)) return null;
  if (TOOL_OPEN.test(line.text) || DIFF_LINE.test(line.text)) return null;

  let end = at;
  let count = 0;
  for (let i = at; i < lines.length; i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) break;
    if (candidate.blank) {
      end = i;
      continue;
    }
    if (!INDENTED_OUTPUT.test(candidate.text)) break;
    if (looksLikeProse(candidate.text)) break;
    count += 1;
    end = i;
  }

  if (count < 15) return null;
  return { kind: "long-output", startLine: at, endLine: end };
}

/** Ends in sentence punctuation, or has a subject-verb shape. Prose is never
 *  collapsed, because prose is where decisions live. */
function looksLikeProse(text: string): boolean {
  const trimmed = text.trim();
  if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 6) return true;
  return /^(so|then|because|but|and|we|i|you|the|this|that|if|when|let'?s)\b/i.test(trimmed);
}

function hasNoiseWithin(lines: readonly LineSpan[], from: number, depth: number): boolean {
  for (let i = from; i < Math.min(from + depth, lines.length); i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) continue;
    if (TOOL_CONTINUATION.test(candidate.text) || INDENTED_OUTPUT.test(candidate.text)) return true;
  }
  return false;
}

function hasTraceWithin(lines: readonly LineSpan[], from: number, depth: number): boolean {
  for (let i = from; i < Math.min(from + depth, lines.length); i += 1) {
    const candidate = lines[i];
    if (candidate === undefined) continue;
    if (TRACE_FRAME.test(candidate.text) || TRACE_PATH.test(candidate.text)) return true;
  }
  return false;
}
