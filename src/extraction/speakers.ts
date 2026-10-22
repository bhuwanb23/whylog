/**
 * Speaker attribution — 1.1, and the input to 1.6.
 *
 * Phase 1 · sub-phases 1.1 and 1.6
 * Plan: plan/phase-1-extraction-pipeline.md §1.1, §1.6
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NON-NEGOTIABLE
 *
 * Origin classification (1.6) produces `source_authority`, which is the largest
 * single term in the entrenchment function (docs/02 §3.4). Entrenchment decides
 * WHICH NODE GETS RETRACTED when two conflict. So a misattributed turn is not a
 * cosmetic error in a badge — it changes what the system throws away.
 *
 * That is why the failure mode is asymmetric and hard-coded here:
 *
 *   **An unattributable turn falls back to the LOWEST authority, never the
 *   highest.** `unknown` → `agent_inferred` (0.4). Guessing "human" would inflate
 *   entrenchment on every decision in a transcript the parser did not understand,
 *   and the inflation would be invisible until a real conflict arrived.
 *
 * ---------------------------------------------------------------------------
 * `src/lib/text.ts` also has `detectSpeaker`. That one is a two-regex utility for
 * anything that needs a quick answer. This module is the real attributor: it
 * knows all six input shapes, it records HOW it decided, and it propagates
 * attribution across unmarked continuation lines.
 * ---------------------------------------------------------------------------
 */

import type { InputShape, NormalizedTurn } from "./types";
import {
  acceptsOpeningClause,
  detectShape,
  isAcceptanceOnly,
  linesWithOffsets,
  matchMarker,
  trimTrailing,
  type AttributionResult,
  type RawTurn,
  type SpeakerMarker,
} from "./lines";
import { attributeJsonl, attributeUnmarked } from "./speakers-fallback";

/* The primitives moved to `./lines` to break the import cycle with
 * `speakers-fallback.ts`. They are re-exported so that `@/extraction/speakers`
 * keeps the surface STRUCTURE.md §6 describes. */
export {
  detectShape,
  isAcceptanceOnly,
  linesWithOffsets,
  looksLikeJsonl,
  matchMarker,
  trimTrailing,
  type AttributionResult,
  type LineSpan,
  type RawTurn,
  type SpeakerMarker,
} from "./lines";

/* -------------------------------------------------------------------------- */
/* Turn extraction                                                            */
/* -------------------------------------------------------------------------- */

/** A turn under construction. `closeTurn` fills `index` and the end offsets are
 *  filled by `seal()`, which is the only place that knows where the NEXT turn
 *  starts. */
interface MutableTurn {
  index: number;
  speaker: "human" | "agent" | "unknown";
  rawStart: number;
  rawEnd: number;
  bodyStart: number;
  bodyEnd: number;
  marker: SpeakerMarker | null;
  attribution: NormalizedTurn["attribution"];
}

function openTurn(
  speaker: "human" | "agent" | "unknown",
  rawStart: number,
  bodyStart: number,
  marker: SpeakerMarker | null,
  attribution: NormalizedTurn["attribution"],
): MutableTurn {
  return { index: -1, speaker, rawStart, rawEnd: rawStart, bodyStart, bodyEnd: bodyStart, marker, attribution };
}

function closeTurn(turns: MutableTurn[], current: MutableTurn | null): MutableTurn | null {
  if (current === null) return null;
  turns.push(current);
  return null;
}

/** Fill in `index`, `rawEnd` and `bodyEnd` now that the following turn's start is
 *  known. */
function seal(turns: readonly MutableTurn[], raw: string): readonly RawTurn[] {
  return turns.map((turn, i) => {
    const next = turns[i + 1];
    const rawEnd = next === undefined ? raw.length : next.rawStart;
    return {
      index: i,
      speaker: turn.speaker,
      rawStart: turn.rawStart,
      rawEnd,
      bodyStart: turn.bodyStart,
      bodyEnd: trimTrailing(raw, turn.bodyStart, rawEnd),
      marker: turn.marker,
      attribution: turn.attribution,
    };
  });
}

/** Trim trailing whitespace from a raw range WITHOUT moving the start, so the
 *  body bounds still point at real text. */
/* -------------------------------------------------------------------------- */
/* Attribution                                                                */
/* -------------------------------------------------------------------------- */

export function attributeSpeakers(raw: string, shape: InputShape = detectShape(raw)): AttributionResult {
  if (shape === "jsonl") return attributeJsonl(raw);

  const lines = linesWithOffsets(raw);
  const turns: MutableTurn[] = [];
  let current: MutableTurn | null = null;
  let marked = 0;

  for (const line of lines) {
    const found = matchMarker(line.text);

    if (found !== null) {
      current = closeTurn(turns, current);
      current = openTurn(
        found.rule.speaker,
        line.start,
        line.start + found.bodyOffset,
        found.rule.marker,
        "marker",
      );
      marked += 1;
      continue;
    }

    if (current === null) {
      // Text before the first marker. Keep it as its own unattributed turn rather
      // than discarding it: a preamble often carries the premise ("it's just me
      // and one laptop") that the first marked decision rests on.
      if (line.blank) continue;
      current = openTurn("unknown", line.start, line.start, null, "none");
      continue;
    }

    if (line.blank) {
      // A blank line ends a turn only when the NEXT line has a marker; otherwise
      // it is a paragraph break inside one turn. Decided by closing lazily: keep
      // the turn open and let the marker scan close it.
      continue;
    }

    current.attribution = current.attribution === "marker" ? "marker" : "inherited";
  }

  closeTurn(turns, current);

  if (marked === 0) return attributeUnmarked(raw, lines, shape);

  const sealed = seal(turns, raw);
  return {
    turns: sealed,
    shape,
    marked,
    inherited: sealed.filter((t) => t.attribution === "inherited").length,
    unattributed: sealed.filter((t) => t.speaker === "unknown").length,
  };
}


/* -------------------------------------------------------------------------- */
/* Origin evidence                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Does this human turn accept what came before it?
 *
 * Used by `provenance.ts` to distinguish `agent_proposed_human_accepted` (0.8)
 * from `agent_inferred` (0.4). Kept here because it is a property of the turn
 * text, and `provenance.ts` should not have to know the phrase list.
 */
export function accepts(text: string): boolean {
  return isAcceptanceOnly(text) || acceptsOpeningClause(text);
}

/** Does this human turn REVERSE what came before it? A reversal outranks an
 *  acceptance: `human_override` is 0.9. */
export function reverses(text: string): boolean {
  return /\b(no[,!]?\s+(actually|wait|let'?s|we'?re)|actually,?\s+(let'?s|we'?ll|use|go)|instead|on second thought|scratch that|never mind|not \w+ after all|revert)\b/i.test(
    text,
  );
}
