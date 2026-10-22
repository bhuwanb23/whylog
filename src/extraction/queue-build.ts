/**
 * Building the review queue from an extraction result — 1.8 + 1.7 joined.
 *
 * Phase 1 · sub-phases 1.7, 1.8
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM `pipeline.ts`
 *
 * The pipeline's job is ORDER: normalise, segment, recognise, validate, score,
 * resolve. This file's job is SHAPE: turning an `ExtractionResult` plus a list of
 * origin classifications into the `ResolvedCandidate[]` the review renders.
 *
 * They are separated because the two passes have to run in a specific order and
 * then be JOINED on the item key — tiering needs the whole decision list to compute
 * a premise's tier (one below its decision's), and resolution needs the whole
 * candidate list to pool against the graph. Interleaving them in one function would
 * make that dependency invisible.
 * ---------------------------------------------------------------------------
 */

import type { DecisionOrigin, Modality } from "@/types/domain";
import type { ExtractionResult } from "@/ai/types";
import type { EpisodeWindow } from "./types";
import type { ResolvedCandidate } from "./types";
import { tierOf } from "./types";
import {
  histogram,
  tierAlternative,
  tierDecision,
  tierPremise,
  type TieredDecision,
} from "./confidence";
import { classifyOrigin, type OriginClassification } from "./provenance";

/* -------------------------------------------------------------------------- */
/* Tiering                                                                    */
/* -------------------------------------------------------------------------- */

export interface Tiered {
  readonly queue: readonly ResolvedCandidate[];
  readonly histogram: ReturnType<typeof histogram>;
}

export function buildQueue(result: ExtractionResult, origins: readonly OriginClassification[]): Tiered {
  const queue: ResolvedCandidate[] = [];

  const decisions = result.decisions.map((candidate, i) =>
    tierDecision(candidate, origins[i]?.origin ?? "agent_inferred", candidate.confidence),
  );
  const premises = result.premises.map((candidate, i) =>
    tierPremise(candidate, candidate.confidence, decisionTierForPremise(decisions, i)),
  );
  const alternatives = result.alternatives.map((candidate) =>
    tierAlternative(candidate, candidate.confidence, decisions[candidate.decisionRef]?.tier ?? null),
  );

  decisions.forEach((tiered, i) => {
    const candidate = tiered.candidate;
    queue.push({
      key: `decision:${i}`,
      kind: "decision",
      decision: candidate,
      premise: null,
      alternative: null,
      resolution: unresolved(),
      origin: candidate.origin,
      confidence: tiered.confidence,
      tier: tiered.tier,
      snippet: candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: candidate.premiseRefs,
      outRefs: [],
    });
  });

  premises.forEach((tiered, i) => {
    const candidate = tiered.candidate;
    queue.push({
      key: `premise:${i}`,
      kind: "premise",
      decision: null,
      premise: candidate,
      alternative: null,
      resolution: unresolved(),
      origin: "agent_inferred",
      confidence: tiered.confidence,
      tier: tiered.tier,
      snippet: candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: [],
      outRefs: [],
    });
  });

  alternatives.forEach((tiered, i) => {
    const candidate = tiered.candidate;
    queue.push({
      key: `alternative:${i}`,
      kind: "alternative",
      decision: null,
      premise: null,
      alternative: candidate,
      resolution: unresolved(),
      origin: "agent_inferred",
      confidence: tiered.confidence,
      tier: tiered.tier,
      snippet: candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: [],
      outRefs: [],
    });
  });

  return { queue, histogram: histogram(decisions, premises, alternatives) };
}

/**
 * The tier of the decision a premise attaches to.
 *
 * Premises are tiered one level BELOW their decision (plan §1.8), which needs to
 * know which decision that is. The engine reports `premiseRefs` on the decision,
 * so the lookup runs backwards over it — and a premise no decision claims gets
 * `null`, which demotes it from `medium` rather than from a decision's tier.
 */
function decisionTierForPremise(
  decisions: readonly TieredDecision[],
  premiseIndex: number,
): ResolvedCandidate["tier"] | null {
  for (const decision of decisions) {
    if (decision.candidate.premiseRefs.includes(premiseIndex)) return decision.tier;
  }
  return null;
}

/** Resolution placeholder, replaced by `mergeTiers` once the ladder has run. */
function unresolved(): ResolvedCandidate["resolution"] {
  return {
    action: "create",
    rung: 6,
    matchedId: null,
    score: 0,
    explanation: "not yet resolved",
    needsReview: true,
    conflictsWith: [],
  };
}

/** The tiering pass and the resolution pass both produce a queue; the tier is the
 *  UI's business and the resolution is the graph's, so they are computed separately
 *  and joined here on the item key. */
export function mergeTiers(
  tiered: readonly ResolvedCandidate[],
  resolved: readonly ResolvedCandidate[],
): readonly ResolvedCandidate[] {
  const byKey = new Map(resolved.map((item) => [item.key, item]));

  return tiered.map((item) => {
    const match = byKey.get(item.key);
    if (match === undefined) return item;
    return { ...item, resolution: match.resolution };
  });
}

/* -------------------------------------------------------------------------- */
/* Origin                                                                     */
/* -------------------------------------------------------------------------- */

export const fallbackOrigin: OriginClassification = {
  origin: "agent_inferred",
  authority: 0.4,
  via: "unattributed",
  explanation: "The snippet could not be located in an episode turn.",
  acceptedInTurn: null,
  reversedInTurn: null,
};

/**
 * Origin from a snippet.
 *
 * The snippet carries RAW coordinates and `classifyOrigin` works in EPISODE
 * coordinates, and there is no honest conversion between them: the offset map is
 * piecewise, so a raw position does not have a single normalised equivalent. The
 * snippet text is therefore located inside the episode by literal search instead —
 * the same technique `decisions.ts` uses for its value, and for the same reason.
 *
 * When the text is not found — a snippet from a chunk boundary, or one that failed
 * validation and was emptied — the conservative fallback applies at the LOWEST
 * authority. Guessing high would inflate entrenchment.
 */
export function originOf(
  episodes: readonly EpisodeWindow[],
  snippetText: string,
  modality: Modality,
): OriginClassification {
  if (snippetText.trim().length === 0) return fallbackOrigin;

  const needle = snippetText.slice(0, 40).toLowerCase();

  for (const episode of episodes) {
    const at = episode.text.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    return classifyOrigin(episode, at, modality);
  }
  return fallbackOrigin;
}
