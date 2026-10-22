/**
 * Line-level primitives for transcript attribution.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1 · STRUCTURE.md §6
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `speakers.ts` and `speakers-fallback.ts` were importing from each other: the
 * fallback needed `linesWithOffsets`, and the main module needed the fallback's
 * `attributeJsonl`. ESM hoisting made it work, which is the worst possible outcome
 * — a cycle that functions is a cycle nobody fixes, and it breaks the moment either
 * module grows a top-level initialiser that reads the other.
 *
 * So the primitives both sides need live here: line splitting WITH raw offsets,
 * speaker-marker matching, shape detection, and range trimming. Neither attribution
 * module imports the other's internals any more, and the dependency runs one way.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE FOR EVERY CONSUMER
 *
 * Every offset in this file is a RAW offset into the untouched input. No stage may
 * reconstruct an offset by summing line lengths, because `
`, a stripped BOM and
 * collapsed noise regions all make that sum wrong — and a wrong offset produces a
 * snippet that quotes the right words from the wrong place, which is undetectable
 * by reading it.
 * ---------------------------------------------------------------------------
 */

import type { InputShape, NormalizedTurn } from "./types";

/* -------------------------------------------------------------------------- */
/* The raw turn and its marker                                                */
/* -------------------------------------------------------------------------- */

/** A turn as found in the raw text, before normalisation. Bounds are RAW. */
export interface RawTurn {
  readonly index: number;
  readonly speaker: "human" | "agent" | "unknown";
  /** The whole turn INCLUDING its marker. Raw bounds. */
  readonly rawStart: number;
  readonly rawEnd: number;
  /** The turn body EXCLUDING its marker. Raw bounds. This is what gets read. */
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly marker: SpeakerMarker | null;
  readonly attribution: NormalizedTurn["attribution"];
}

export type SpeakerMarker =
  | "role-colon"
  | "claude-glyph"
  | "markdown-blockquote"
  | "jsonl-role"
  | "indentation"
  | "none";

export interface MarkerRule {
  readonly marker: SpeakerMarker;
  readonly speaker: "human" | "agent";
  readonly pattern: RegExp;
}

/**
 * Ordered. The first rule that matches a line wins, so the most specific markers
 * come first: Claude Code's glyphs are unambiguous, while `You:` collides with
 * ordinary prose often enough to be checked last.
 */
export const MARKER_RULES: readonly MarkerRule[] = [
  /* ---- Claude Code terminal ---- */
  { marker: "claude-glyph", speaker: "agent", pattern: /^⏺\s*/u },
  { marker: "claude-glyph", speaker: "agent", pattern: /^⎿\s*/u },
  { marker: "claude-glyph", speaker: "agent", pattern: /^●\s*/u },
  { marker: "claude-glyph", speaker: "human", pattern: /^>\s*/ },

  /* ---- explicit role names, with the product-specific ones first ---- */
  {
    marker: "role-colon",
    speaker: "agent",
    pattern: /^(claude|anthropic|assistant|ai|bot|model)\s*:?\s*/i,
  },
  { marker: "role-colon", speaker: "agent", pattern: /^(copilot|cursor|codex|agent)\s*:?\s*/i },
  { marker: "role-colon", speaker: "human", pattern: /^(user|human|me|you|developer)\s*:?\s*/i },

  /* ---- chat-export headings ---- */
  { marker: "role-colon", speaker: "human", pattern: /^#{1,6}\s*(user|human|me|you)\s*$/i },
  {
    marker: "role-colon",
    speaker: "agent",
    pattern: /^#{1,6}\s*(assistant|claude|ai|bot|copilot|cursor)\s*$/i,
  },

  /* ---- timestamped chat logs: "[12:04] Alice:" ---- */
  {
    marker: "role-colon",
    speaker: "human",
    pattern: /^\[[\d:.]+\]\s*(user|human|me|you)\s*:?\s*/i,
  },
  {
    marker: "role-colon",
    speaker: "agent",
    pattern: /^\[[\d:.]+\]\s*(assistant|claude|ai|bot)\s*:?\s*/i,
  },
];

/** Acceptance phrases: a human turn that consists only of these ACCEPTS whatever
 *  the agent proposed in the turn before. Drives
 *  `agent_proposed_human_accepted` and `human_override`. */

const ACCEPTANCE =
  /^(yeah|yep|yes|ok|okay|sure|fine|deal|agreed|sounds good|looks good|let'?s do that|ship it|go ahead|do it|perfect|nice|cool|lgtm|sgtm|wfm)[\s.,!]*$/i;

/* -------------------------------------------------------------------------- */
/* Line-level helpers                                                         */
/* -------------------------------------------------------------------------- */

export interface LineSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly blank: boolean;
}

/** Split raw text into lines WITH their raw offsets. Every downstream module uses
 *  this rather than `split("\n")` so that no stage ever has to reconstruct an
 *  offset by summing line lengths. */
export function linesWithOffsets(raw: string): readonly LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;

  for (let i = 0; i <= raw.length; i += 1) {
    if (i === raw.length || raw[i] === "\n") {
      const text = raw.slice(start, i);
      lines.push({
        text,
        start,
        end: i,
        blank: text.trim().length === 0,
      });
      start = i + 1;
    }
  }

  // A trailing newline produces one empty final line; drop it so turn counts are
  // honest.
  const last = lines[lines.length - 1];
  if (last !== undefined && last.text.length === 0 && lines.length > 1) lines.pop();
  return lines;
}

/** Which marker rule, if any, opens this line. */
export function matchMarker(line: string): { rule: MarkerRule; bodyOffset: number } | null {
  const trimmed = line.replace(/^\s+/, "");
  const indent = line.length - trimmed.length;

  for (const rule of MARKER_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match !== null) {
      return { rule, bodyOffset: indent + match[0].length };
    }
  }
  return null;
}

/** Is this line ONLY an acceptance? See `ACCEPTANCE`. */
export function isAcceptanceOnly(text: string): boolean {
  return ACCEPTANCE.test(text.trim());
}

/**
 * Does a turn OPEN with an acceptance?
 *
 * "yeah ok, and can you also add a guard" is not ONLY an acceptance, but it does
 * accept what came before it — and that is what `provenance.ts` needs in order to
 * tell `agent_proposed_human_accepted` (0.8) from `agent_inferred` (0.4). Split
 * from `isAcceptanceOnly` so the two tests stay visibly different: one is "nothing
 * but yes", the other is "yes, and also".
 */
export function acceptsOpeningClause(text: string): boolean {
  const first = text.trim().split(/[.!?\n]/)[0] ?? "";
  return ACCEPTANCE.test(first.trim());
}

/**
 * Guess the input shape.
 *
 * Reported to the user rather than trusted silently: a wrong guess is visible in
 * the review header and correctable, whereas a wrong guess that is hidden shows
 * up only as mysteriously bad attribution.
 */
export function detectShape(raw: string): InputShape {
  const sample = raw.slice(0, 8000);

  if (looksLikeJsonl(sample)) return "jsonl";
  if (/^⏺|^⎿|^●/mu.test(sample)) return "claude-code";
  if (/^(copilot|github copilot)\s*:?$/imu.test(sample)) return "copilot-chat";
  if (/^(cursor|composer|agent)\s*:?$/imu.test(sample)) return "cursor-chat";
  if (/^\s*(codex|> codex)\b/imu.test(sample)) return "codex-cli";

  const marked = MARKER_RULES.some((rule) =>
    new RegExp(`^\\s*${rule.pattern.source}`, "imu").test(sample),
  );
  if (marked) return "generic-marked";

  if (sample.trim().length === 0) return "unknown";
  return "plain-prose";
}

/** JSONL: every non-blank line parses as an object with a recognisable role key.
 *  Checked on a sample, because a transcript can be large. */
export function looksLikeJsonl(sample: string): boolean {
  const lines = sample
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (lines.length === 0) return false;

  let hits = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    if (/"(role|speaker|author|type)"\s*:/.test(trimmed)) hits += 1;
  }
  return hits === lines.length;
}

/** Trim trailing whitespace from a raw range WITHOUT moving the start, so the
 *  body bounds still point at real text. Exported for `speakers-fallback.ts`. */
export function trimTrailing(raw: string, start: number, end: number): number {
  let e = end;
  while (e > start && /\s/.test(raw[e - 1] ?? "")) e -= 1;
  return e;
}

/* -------------------------------------------------------------------------- */
/* What attribution returns                                                   */
/* -------------------------------------------------------------------------- */

export interface AttributionResult {
  readonly turns: readonly RawTurn[];
  readonly shape: InputShape;
  /** How many turns were attributed by marker versus inherited versus left
   *  unknown. Reported in the review UI. */
  readonly marked: number;
  readonly inherited: number;
  readonly unattributed: number;
}

/**
 * Find turn boundaries and attribute speakers.
 *
 * Three passes:
 *   1. marker scan — every line that opens with a role marker starts a turn;
 *   2. inheritance — a following line with no marker joins the current turn;
 *   3. fallback — when NO marker was found anywhere, split on blank lines and
 *      attribute by first-person versus imperative voice, so that a transcript
 *      pasted as plain prose still segments sensibly (acceptance criterion 1.1).
 */
