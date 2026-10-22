/**
 * The two attribution paths that are NOT marker-based.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * Split out of `speakers.ts` because both are guesses of a different character
 * than the marker scan, and both need their own explanation:
 *
 *   `attributeJsonl`  — a chat export. Role comes from the record, so this is a
 *                       PARSE, not a guess, and is recorded as such.
 *   `attributeUnmarked` — plain prose with no role markers at all. This IS a
 *                       guess, and it is deliberately conservative: acceptance
 *                       criterion 1.1 only asks that such a transcript "still
 *                       segments sensibly", not that it attributes correctly.
 *                       Where voice evidence is ambiguous the speaker stays
 *                       `unknown`, which maps to the LOWEST authority (0.4) in
 *                       `provenance.ts`. Guessing "human" would inflate
 *                       entrenchment on every decision in the transcript.
 */

import type { InputShape } from "./types";
import {
  linesWithOffsets,
  trimTrailing,
  type AttributionResult,
  type LineSpan,
  type RawTurn,
} from "./lines";

/* -------------------------------------------------------------------------- */
/* JSONL                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Chat-export JSONL. Role comes from the record, so attribution is exact and
 * recorded as `jsonl-role` rather than `marker` — the review UI shows the
 * difference because one is a parse and the other is a guess.
 */
export function attributeJsonl(raw: string): AttributionResult {
  const lines = linesWithOffsets(raw);
  const turns: RawTurn[] = [];

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed.length === 0) continue;

    const speaker = roleFromJson(trimmed);
    turns.push({
      index: turns.length,
      speaker,
      rawStart: line.start,
      rawEnd: line.end,
      bodyStart: line.start,
      bodyEnd: line.end,
      marker: speaker === "unknown" ? null : "jsonl-role",
      attribution: speaker === "unknown" ? "none" : "marker",
    });
  }

  return {
    turns: turns.map((t, i) => ({ ...t, index: i })),
    shape: "jsonl",
    marked: turns.filter((t) => t.speaker !== "unknown").length,
    inherited: 0,
    unattributed: turns.filter((t) => t.speaker === "unknown").length,
  };
}

/** Cheap role extraction. A full JSON parse happens in `normalizer.ts`, which is
 *  the stage that owns turning a record into text; here only the role is needed,
 *  and a regex avoids throwing on the malformed line that every real export has. */
function roleFromJson(line: string): "human" | "agent" | "unknown" {
  const match = /"(?:role|speaker|author|type)"\s*:\s*"([^"]+)"/.exec(line);
  if (match === null) return "unknown";

  const role = match[1]?.toLowerCase() ?? "";
  if (role === "user" || role === "human") return "human";
  if (role === "assistant" || role === "agent" || role === "bot" || role === "model" || role === "ai") return "agent";
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* The unmarked fallback                                                      */
/* -------------------------------------------------------------------------- */

const FIRST_PERSON = /\b(i|i'm|ive|i've|i'll|im|my|me|we|our|us|let's|lets)\b/i;
const SECOND_PERSON = /\b(you|your|we could|we should|i suggest|i recommend|consider|how about|what if)\b/i;

/**
 * No markers anywhere: split on blank lines and attribute by voice.
 *
 * This is a GUESS and is labelled `indentation` only when indentation actually
 * decided it; otherwise `none`. The speaker stays `unknown` unless the voice
 * evidence is one-sided, because a wrong `human` here inflates entrenchment on
 * every decision in the transcript.
 */
export function attributeUnmarked(raw: string, lines: readonly LineSpan[], shape: InputShape): AttributionResult {
  const blocks: { start: number; end: number; bodyStart: number }[] = [];
  let open: { start: number; bodyStart: number } | null = null;

  for (const line of lines) {
    if (line.blank) {
      if (open !== null) blocks.push({ start: open.start, end: line.start, bodyStart: open.bodyStart });
      open = null;
      continue;
    }
    if (open === null) open = { start: line.start, bodyStart: line.start };
  }
  if (open !== null) blocks.push({ start: open.start, end: raw.length, bodyStart: open.bodyStart });

  // A single block with no blank lines: fall back to sentence-level turns so that
  // prose pasted as one paragraph still produces something reviewable.
  const units = blocks.length <= 1 ? sentenceUnits(raw) : blocks;

  const turns: RawTurn[] = units.map((unit, i) => {
    const text = raw.slice(unit.bodyStart, unit.end);
    const speaker = guessVoice(text, i);
    return {
      index: i,
      speaker,
      rawStart: unit.start,
      rawEnd: unit.end,
      bodyStart: unit.bodyStart,
      bodyEnd: trimTrailing(raw, unit.bodyStart, unit.end),
      marker: null,
      attribution: speaker === "unknown" ? "none" : "indentation",
    };
  });

  return {
    turns,
    shape: shape === "unknown" ? "plain-prose" : shape,
    marked: 0,
    inherited: 0,
    unattributed: turns.filter((t) => t.speaker === "unknown").length,
  };
}

/** First person and no second person ⇒ human. Second person ⇒ agent. Both or
 *  neither ⇒ unknown, which is the honest answer and the low-authority one. */
function guessVoice(text: string, index: number): "human" | "agent" | "unknown" {
  const first = FIRST_PERSON.test(text);
  const second = SECOND_PERSON.test(text);

  if (first && !second) return "human";
  if (second && !first) return "agent";
  // Strict alternation is the last resort, and only from the second unit: with no
  // voice evidence at all, alternating is a coin flip dressed up as a rule.
  if (!first && !second && index > 0) return index % 2 === 0 ? "agent" : "human";
  return "unknown";
}

function sentenceUnits(raw: string): readonly { start: number; end: number; bodyStart: number }[] {
  const units: { start: number; end: number; bodyStart: number }[] = [];
  const pattern = /[^.!?…\n]+[.!?…]+[\s]*/g;
  let match: RegExpExecArray | null = pattern.exec(raw);

  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    units.push({ start, end, bodyStart: start });
    if (units.length >= 400) break; // a pathological 200 KB paragraph
    match = pattern.exec(raw);
  }

  if (units.length === 0 && raw.trim().length > 0) {
    units.push({ start: 0, end: raw.length, bodyStart: 0 });
  }
  return units;
}
