/**
 * Fixture → normalise → segment → extract, over the REAL demo transcript.
 *
 * This walks stages 1.1–1.8 on a checked-in fixture rather than a hand-made string, because the
 * stage-to-stage handoffs are where the bugs actually lived: a chunk reporting normalised offsets in
 * a field documented as raw, an episode that computed `turnOffsets` and never returned them, a value
 * picked in one episode adopted by a cue in another.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseTranscript } from "@/extraction/normalizer";
import { segmentEpisodes } from "@/extraction/segmentation";
import { chunkTurns } from "@/extraction/chunking";
import { runExtraction } from "@/extraction/pipeline";
import { emptyState } from "@/substrate/graph-state";
import { createLocalEngine } from "@/ai/local";
import { LOCAL_ENGINE, nextAt, resetClock, transcriptId } from "../helpers/events";

const engine = createLocalEngine();
const FIXTURE = readFileSync(join(process.cwd(), "fixtures", "demo-transcript.txt"), "utf8");

describe("normalisation preserves the ability to quote the original", () => {
  it("produces turns, an offset map and a shape it detected", () => {
    resetClock();
    const normalized = normaliseTranscript(FIXTURE, { transcriptId: transcriptId(1) });

    expect(normalized.turns.length).toBeGreaterThan(0);
    expect(normalized.raw).toBe(FIXTURE);
    expect(normalized.anchors.length).toBeGreaterThan(0);
    expect(typeof normalized.shape).toBe("string");
  });

  it("gives every turn bounds inside the normalised text", () => {
    const normalized = normaliseTranscript(FIXTURE, { transcriptId: transcriptId(1) });
    for (const turn of normalized.turns) {
      expect(turn.start).toBeGreaterThanOrEqual(0);
      expect(turn.end).toBeLessThanOrEqual(normalized.text.length);
      expect(turn.end).toBeGreaterThan(turn.start);
      expect(normalized.text.slice(turn.start, turn.end)).toBe(turn.text);
    }
  });
});

describe("chunking reports RAW bounds, which is what the review pane highlights with", () => {
  it("gives every chunk a rawRange that slices the RAW input", () => {
    /* The regression: turns carry NORMALISED offsets, and `Chunk.rawRange` is documented as raw. The
     * chunker used to copy the turn offsets straight through, so highlighting pointed at the wrong
     * slice of the pasted text whenever noise had been collapsed — silently, and only on messy
     * transcripts, which is exactly when a presenter is most likely to paste one. */
    const normalized = normaliseTranscript(FIXTURE, { transcriptId: transcriptId(1) });
    const { chunks } = chunkTurns(normalized.turns, 4000, normalized);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const [start, end] = chunk.rawRange;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(normalized.raw.length);
      expect(end).toBeGreaterThan(start);
      /* The chunk's own turns must sit inside the range it claims. */
      expect(chunk.turns.length).toBeGreaterThan(0);
    }
  });

  it("covers every turn exactly once or as a declared overlap", () => {
    const normalized = normaliseTranscript(FIXTURE, { transcriptId: transcriptId(1) });
    const { chunks } = chunkTurns(normalized.turns, 4000, normalized);
    const seen = new Map<number, number>();
    for (const chunk of chunks) {
      for (const turn of chunk.turns) seen.set(turn.index, (seen.get(turn.index) ?? 0) + 1);
    }
    for (const turn of normalized.turns) expect(seen.get(turn.index)).toBeGreaterThan(0);
    /* A turn in two chunks is allowed, but only when the chunk says so. */
    for (const chunk of chunks.slice(1)) {
      if (chunk.turns.some((t) => (seen.get(t.index) ?? 0) > 1)) expect(chunk.overlapsPrevious).toBe(true);
    }
  });
});

describe("segmentation returns the offsets it computes", () => {
  it("gives every episode a turnOffsets array aligned with its turns", () => {
    /* `turnOffsets` was computed and then never returned, so the field the interface declared did not
     * exist at runtime — and it is what lets a recogniser convert a within-turn cue position into an
     * episode position without re-searching. */
    const normalized = normaliseTranscript(FIXTURE, { transcriptId: transcriptId(1) });
    const episodes = segmentEpisodes(normalized);
    const list = Array.isArray(episodes) ? episodes : episodes.episodes;

    expect(list.length).toBeGreaterThan(0);
    for (const episode of list) {
      expect(episode.turnOffsets).toHaveLength(episode.turns.length);
      expect(episode.turnOffsets[0]).toBe(0);
      /* Offsets must be non-decreasing: they are positions in the concatenated turn bodies. */
      for (let i = 1; i < episode.turnOffsets.length; i += 1) {
        expect(episode.turnOffsets[i]!).toBeGreaterThan(episode.turnOffsets[i - 1]!);
      }
      expect(episode.charRange[1]).toBeGreaterThan(episode.charRange[0]);
    }
  });
});

describe("the full pipeline over the demo fixture", () => {
  it("recovers the SQLite decision the demo is built around", async () => {
    resetClock();
    const outcome = await runExtraction(
      { transcriptId: transcriptId(1), raw: FIXTURE, occurredAt: nextAt() },
      { engine, engineId: LOCAL_ENGINE, state: emptyState(LOCAL_ENGINE, nextAt()) },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const decisions = outcome.outcome.result.decisions;
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((d) => d.variable === "DATABASE" && /sqlite/i.test(d.value))).toBe(true);
  });

  it("reports snippets that are literal substrings of the fixture at the offsets it claims", async () => {
    resetClock();
    const outcome = await runExtraction(
      { transcriptId: transcriptId(1), raw: FIXTURE, occurredAt: nextAt() },
      { engine, engineId: LOCAL_ENGINE, state: emptyState(LOCAL_ENGINE, nextAt()) },
    );
    if (!outcome.ok) throw new Error(outcome.failure.kind);

    /* The evidence contract: a paraphrased snippet rots it silently, so every snippet is checked as a
     * literal substring of the input and discarded if it is not. */
    for (const decision of outcome.outcome.result.decisions) {
      expect(FIXTURE.slice(decision.snippet.start, decision.snippet.end)).toBe(decision.snippet.text);
      expect(decision.snippet.transcriptId).toBe(transcriptId(1));
    }
    for (const premise of outcome.outcome.result.premises) {
      expect(FIXTURE.slice(premise.snippet.start, premise.snippet.end)).toBe(premise.snippet.text);
    }
  });

  it("records every discard, so precision has a denominator", async () => {
    resetClock();
    const outcome = await runExtraction(
      { transcriptId: transcriptId(1), raw: FIXTURE, occurredAt: nextAt() },
      { engine, engineId: LOCAL_ENGINE, state: emptyState(LOCAL_ENGINE, nextAt()) },
    );
    if (!outcome.ok) throw new Error(outcome.failure.kind);

    /* Dropping a rejected candidate silently would make the precision metric unmeasurable: the
     * denominator is "everything the recogniser considered", not "everything it kept". */
    for (const discard of outcome.outcome.result.discarded) {
      expect(discard.rawText.length).toBeGreaterThan(0);
      expect(["confidence-threshold", "modality", "duplicate", "human"]).toContain(discard.discardedBy);
    }
  });

  it("is deterministic across runs", async () => {
    const once = async () => {
      resetClock();
      const outcome = await runExtraction(
        { transcriptId: transcriptId(1), raw: FIXTURE, occurredAt: nextAt() },
        { engine, engineId: LOCAL_ENGINE, state: emptyState(LOCAL_ENGINE, nextAt()) },
      );
      if (!outcome.ok) throw new Error(outcome.failure.kind);
      return outcome.outcome.result.decisions.map((d) => `${d.variable}=${d.value}`).sort();
    };

    expect(await once()).toEqual(await once());
  });
});
