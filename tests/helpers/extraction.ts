/**
 * Run the real local pipeline over a hand-written transcript.
 *
 * These tests go through `runExtraction` rather than calling recognisers directly, because the bugs
 * they exist to catch were all in how the stages hand off to each other — a value picked in one
 * episode adopted by a cue in another, a variable guessed before the value was known, a rationale
 * clause minted as a second decision. Testing a stage in isolation cannot see any of that.
 */
import { runExtraction } from "@/extraction/pipeline";
import { emptyState } from "@/substrate/graph-state";
import { createLocalEngine } from "@/ai/local";
import { nowISO } from "@/lib/format";
import { LOCAL_ENGINE, transcriptId } from "./events";
import type { DecisionCandidate, ExtractionResult, PremiseCandidate } from "@/ai/types";

const engine = createLocalEngine();

export interface Extracted {
  readonly result: ExtractionResult;
  readonly decisions: readonly DecisionCandidate[];
  readonly premises: readonly PremiseCandidate[];
  readonly raw: string;
}

export async function extract(raw: string, id = transcriptId(900)): Promise<Extracted> {
  const outcome = await runExtraction(
    { transcriptId: id, raw, occurredAt: nowISO() },
    { engine, engineId: LOCAL_ENGINE, state: emptyState(LOCAL_ENGINE, nowISO()) },
  );

  if (!outcome.ok) throw new Error(`extraction failed: ${outcome.failure.kind}`);

  return {
    result: outcome.outcome.result,
    decisions: outcome.outcome.result.decisions,
    premises: outcome.outcome.result.premises,
    raw,
  };
}

/** The (variable → value) pairs a run produced, for assertions that do not care about order. */
export function pairs(extracted: Extracted): string[] {
  return extracted.decisions.map((d) => `${d.variable}=${d.value}`).sort();
}

export { engine as localEngine };
