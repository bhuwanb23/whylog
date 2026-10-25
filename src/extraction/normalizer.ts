/**
 * The normaliser — 1.1's orchestrator.
 *
 * Phase 1 · sub-phase 1.1
 * Plan: plan/phase-1-extraction-pipeline.md §1.1
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRODUCES
 *
 * One `NormalizedTranscript` from any of the six supported input shapes, holding
 * BOTH texts:
 *
 *   `raw`  — untouched. Snippets are validated against it, the review pane
 *            highlights ranges in it, and the export quotes from it.
 *   `text` — what the recognisers read: tool noise collapsed, code fences lifted
 *            out, speaker markers stripped.
 *
 * and the `anchors` that map an index in `text` back to an index in `raw`. That
 * map is the acceptance criterion; everything else in this module exists to build
 * it honestly.
 *
 * ---------------------------------------------------------------------------
 * TWO COORDINATE SYSTEMS, ONE WALK
 *
 * Turn bounds are stored in NORMALISED coordinates because `NormalizedTurn.text`
 * is a slice of the normalised string and the recognisers work in that string.
 * Raw bounds are needed too — for highlighting and for episode display — so the
 * single walk that assembles `text` builds BOTH maps. Building them separately
 * would mean walking the claims twice and keeping two cursors in agreement, which
 * is how an offset bug gets written.
 *
 * ---------------------------------------------------------------------------
 * ORDER OF OPERATIONS
 *
 * Speaker attribution runs FIRST, on the raw text. It has to: the markers it looks
 * for (`⏺`, `User:`) are exactly the things a later stage strips, and a 400-line
 * tool dump can contain lines that look like markers. Attributing before
 * collapsing also means the turn list is complete, so a code block can be
 * attributed to the turn that contains it.
 * ---------------------------------------------------------------------------
 */

import type { ISODateString, TranscriptId } from "@/types/common";
import type {
  CodeBlock,
  InputShape,
  NoiseKind,
  NoiseRegion,
  NormalizationStats,
  NormalizedTranscript,
  NormalizedTurn,
} from "./types";
import { OffsetMapBuilder, identityMap, rawAt, rawBounds, type OffsetMap } from "./offset-map";
import { attributeSpeakers, detectShape, linesWithOffsets, type RawTurn } from "./speakers";
import { recoverTimestamp, type RecoveredTime } from "./timestamps";
import { placeholderFor, scanNoise } from "./noise";

export interface NormalizerOptions {
  readonly transcriptId: TranscriptId;
  /** Force a shape instead of detecting it. The review UI exposes this: a wrong
   *  guess must be correctable, not merely visible. */
  readonly shape?: InputShape;
  readonly occurredAt?: ISODateString;
  readonly label?: string;
  /** Default true. Set false to keep tool output in the extraction text — useful
   *  when a decision is ABOUT the noise ("we dropped the ORM because the
   *  migration output was 90 lines"). */
  readonly collapseNoise?: boolean;
  /** Default true. Code fences are lifted into `codeBlocks` either way; this only
   *  controls whether a placeholder marks the lift in `text`. */
  readonly liftCodeBlocks?: boolean;
}

/** A region of `raw` claimed by a stage, and what replaces it in `text`. Sorted
 *  and non-overlapping: two claims on one range would corrupt the map. */
interface Claim {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly kind: "code" | NoiseKind;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function normaliseTranscript(raw: string, options: NormalizerOptions): NormalizedTranscript {
  const shape: InputShape = options.shape ?? detectShape(raw);
  const attribution = attributeSpeakers(raw, shape);
  const time: RecoveredTime = recoverTimestamp(raw, options.occurredAt);

  const collected = collectClaims(raw, attribution.turns, options);
  const assembled = assemble(raw, collected.claims, attribution.turns);

  const turns: readonly NormalizedTurn[] = attribution.turns.map((turn, i) => {
    const bounds = assembled.turnBounds[i];
    const start = bounds?.start ?? 0;
    const end = bounds?.end ?? start;
    return {
      index: i,
      speaker: turn.speaker,
      text: assembled.text.slice(start, end),
      start,
      end,
      attribution: turn.attribution,
    };
  });

  const codeBlocks = collected.codeBlocks;
  const noise = assembled.noise;

  const stats: NormalizationStats = {
    rawChars: raw.length,
    normalisedChars: assembled.text.length,
    turns: turns.length,
    humanTurns: turns.filter((t) => t.speaker === "human").length,
    agentTurns: turns.filter((t) => t.speaker === "agent").length,
    unattributedTurns: turns.filter((t) => t.speaker === "unknown").length,
    codeBlocks: codeBlocks.length,
    noiseRegions: noise.length,
    noiseCharsCollapsed: noise.reduce((total, region) => total + (region.rawEnd - region.rawStart), 0),
  };

  return {
    transcriptId: options.transcriptId,
    shape,
    raw,
    text: assembled.text,
    turns,
    codeBlocks,
    noise,
    anchors: assembled.forward.anchors,
    occurredAt: time.at,
    timeUncertain: time.uncertain,
    stats,
  };
}

/* -------------------------------------------------------------------------- */
/* Claims                                                                     */
/* -------------------------------------------------------------------------- */

interface Collected {
  readonly claims: readonly Claim[];
  readonly codeBlocks: readonly CodeBlock[];
}

/**
 * Decide what gets replaced, in one place, so that the claim list is sorted and
 * non-overlapping BEFORE the walk. Two claims on one range would corrupt both
 * maps, and the only way to guarantee that is to never build the second claim
 * without seeing the first.
 */
function collectClaims(raw: string, turns: readonly RawTurn[], options: NormalizerOptions): Collected {
  const claims: Claim[] = [];
  const codeBlocks: CodeBlock[] = [];

  if (options.liftCodeBlocks !== false) {
    for (const block of findCodeBlocks(raw, turns)) {
      codeBlocks.push(block);
      claims.push({
        start: block.rawStart,
        end: block.rawEnd,
        replacement: codePlaceholder(block.lang, block.text),
        kind: "code",
      });
    }
  }

  if (options.collapseNoise !== false) {
    const lines = linesWithOffsets(raw);
    for (const run of scanNoise(raw)) {
      const first = lines[run.startLine];
      const last = lines[run.endLine];
      if (first === undefined || last === undefined) continue;

      // A run that overlaps an already-claimed code block is dropped: the block
      // owns those characters.
      const overlaps = claims.some((claim) => first.start < claim.end && last.end > claim.start);
      if (overlaps) continue;

      claims.push({
        start: first.start,
        end: last.end,
        replacement: placeholderFor(run.kind, run.endLine - run.startLine + 1),
        kind: run.kind,
      });
    }
  }

  return { claims: [...claims].sort((a, b) => a.start - b.start), codeBlocks };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

interface Assembled {
  readonly text: string;
  /** normalised → raw */
  readonly forward: OffsetMap;
  /** raw → normalised */
  readonly inverse: OffsetMap;
  readonly noise: readonly NoiseRegion[];
  /** Per turn, the bounds of its body in the NORMALISED text. */
  readonly turnBounds: readonly { start: number; end: number }[];
}

/**
 * One walk over the raw text.
 *
 * Prose is emitted verbatim and advances both maps together; a claim emits its
 * replacement and advances them apart. Because both builders are driven by the
 * same cursor, they cannot disagree.
 */
function assemble(raw: string, claims: readonly Claim[], turns: readonly RawTurn[]): Assembled {
  const forward = new OffsetMapBuilder();
  const inverse = new OffsetMapBuilder();
  const parts: string[] = [];
  const noise: NoiseRegion[] = [];

  let cursor = 0;

  for (const claim of claims) {
    if (claim.start < cursor) continue;

    if (claim.start > cursor) {
      const prose = raw.slice(cursor, claim.start);
      forward.keep(prose.length);
      inverse.keep(prose.length);
      parts.push(prose);
    }

    const rawLength = claim.end - claim.start;
    forward.skip(rawLength, claim.replacement.length);
    inverse.skip(claim.replacement.length, rawLength);
    parts.push(claim.replacement);

    cursor = claim.end;

    if (claim.kind !== "code") {
      noise.push({
        kind: claim.kind,
        rawStart: claim.start,
        rawEnd: claim.end,
        raw: raw.slice(claim.start, claim.end),
        replacedWith: claim.replacement,
      });
    }
  }

  if (cursor < raw.length) {
    const tail = raw.slice(cursor);
    forward.keep(tail.length);
    inverse.keep(tail.length);
    parts.push(tail);
  }

  const text = parts.join("");
  const forwardMap = forward.build(text, raw);
  const inverseMap = inverse.build(raw, text);

  // Turn bodies are known in RAW coordinates and must be reported in NORMALISED
  // ones, so they go through the inverse map. `rawAt` clamps, and a body that was
  // entirely inside a lifted region collapses to a zero-length range, which the
  // recognisers skip rather than mis-read.
  const turnBounds = turns.map((turn) => ({
    start: rawAt(inverseMap, turn.bodyStart),
    end: rawAt(inverseMap, turn.bodyEnd),
  }));

  return { text, forward: forwardMap, inverse: inverseMap, noise, turnBounds };
}

/* -------------------------------------------------------------------------- */
/* Code blocks                                                                */
/* -------------------------------------------------------------------------- */

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)\s*$/;

/**
 * Find fenced code blocks and the turn each sits in.
 *
 * Lifted because a fence is evidence for GUARDS (Phase 4), not decision text: a
 * 60-line config file between two turns is not a decision, and leaving it in
 * dilutes every cue scan. It is retained verbatim in `CodeBlock.text` with raw
 * bounds, so a decision that quotes a line of it still resolves.
 */
export function findCodeBlocks(raw: string, turns: readonly RawTurn[]): readonly CodeBlock[] {
  const lines = linesWithOffsets(raw);
  const blocks: CodeBlock[] = [];
  let open: { fence: string; lang: string | null; start: number } | null = null;

  for (const line of lines) {
    const match = FENCE.exec(line.text);

    if (open === null) {
      if (match === null) continue;
      open = {
        fence: (match[2] ?? "```").slice(0, 3),
        lang: (match[3] ?? "").length > 0 ? (match[3] as string) : null,
        start: line.start,
      };
      continue;
    }

    if (match !== null && (match[2] ?? "").startsWith(open.fence)) {
      blocks.push({
        lang: open.lang,
        text: raw.slice(open.start, line.end),
        rawStart: open.start,
        rawEnd: line.end,
        turnIndex: turnContaining(turns, open.start, line.end),
      });
      open = null;
    }
  }

  // An unterminated fence runs to the end of the input. Treat it as a block: the
  // alternative is to leave a half-transcript in the extraction text, which is
  // worse than lifting too much.
  if (open !== null) {
    blocks.push({
      lang: open.lang,
      text: raw.slice(open.start),
      rawStart: open.start,
      rawEnd: raw.length,
      turnIndex: turnContaining(turns, open.start, raw.length),
    });
  }

  return blocks;
}

function turnContaining(turns: readonly RawTurn[], start: number, end: number): number | null {
  for (const turn of turns) {
    if (turn.rawStart <= start && turn.rawEnd >= start) return turn.index;
    if (turn.rawStart >= start && turn.rawEnd <= end) return turn.index;
  }
  return null;
}

function codePlaceholder(lang: string | null, body: string): string {
  const lineCount = body.split("\n").length;
  const label = lang === null ? "code" : `${lang} code`;
  return `\n[${label} · ${lineCount} lines lifted]\n`;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/** How much of the transcript reached the recognisers. A normalisation that
 *  consumed most of the input is worth doubting out loud. */
export function describeNormalisation(result: NormalizedTranscript): string {
  const s = result.stats;
  const kept = s.rawChars === 0 ? 100 : Math.round((s.normalisedChars / s.rawChars) * 100);
  const parts = [
    `${s.turns} turns (${s.humanTurns} human · ${s.agentTurns} agent · ${s.unattributedTurns} unattributed)`,
    `${kept}% of the raw text reached the recognisers`,
  ];
  if (s.codeBlocks > 0) parts.push(`${s.codeBlocks} code block${s.codeBlocks === 1 ? "" : "s"} lifted`);
  if (s.noiseRegions > 0) parts.push(`${s.noiseRegions} noise region${s.noiseRegions === 1 ? "" : "s"} collapsed`);
  if (s.unattributedTurns > 0) {
    parts.push("unattributed turns default to the LOWEST authority, never to human");
  }
  return parts.join(" · ");
}

/** Raw bounds of a normalised range, for the review pane. Re-exported here so
 *  callers of the normaliser do not need a second import. */
export function toRawBounds(
  result: NormalizedTranscript,
  start: number,
  end: number,
): readonly [number, number] {
  return rawBounds({ anchors: result.anchors, normalisedLength: result.text.length, rawLength: result.raw.length }, start, end);
}

/** The identity normalisation, for callers that already have clean text. */
export function asAlreadyNormalised(
  transcriptId: TranscriptId,
  raw: string,
  occurredAt: ISODateString,
): NormalizedTranscript {
  const map = identityMap(raw);
  return {
    transcriptId,
    shape: "plain-prose",
    raw,
    text: raw,
    turns: [],
    codeBlocks: [],
    noise: [],
    anchors: map.anchors,
    occurredAt,
    timeUncertain: true,
    stats: {
      rawChars: raw.length,
      normalisedChars: raw.length,
      turns: 0,
      humanTurns: 0,
      agentTurns: 0,
      unattributedTurns: 0,
      codeBlocks: 0,
      noiseRegions: 0,
      noiseCharsCollapsed: 0,
    },
  };
}
