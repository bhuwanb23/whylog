/**
 * Candidate generation for gate (b) — Phase 3 · sub-phase 3.6.
 *
 * Plan: plan/phase-3-retrieval.md §3.6
 *       plan/phase-2-truth-maintenance.md §2.5 (gate b)
 *
 * ---------------------------------------------------------------------------
 * WHAT GATE (b) ASKS RETRIEVAL FOR
 *
 * Gate (b) is the semantic gate: find pairs of decisions that MIGHT contradict each other,
 * so the classifier can judge them. It cannot compare every pair — that is O(n²) over the
 * whole log and almost all of it is wasted, since two decisions about different variables in
 * different months are not candidates for anything.
 *
 * So retrieval proposes a short list of pairs. `gates/semantic.ts` takes them as
 * `CandidatePair[]` and disposes of them.
 *
 * ---------------------------------------------------------------------------
 * ZERO EMBEDDING CALLS
 *
 * The L1 vectors already exist in the index artifacts — they were computed at extraction time
 * and are exactly what a candidate generator needs. This reads them; it never calls
 * `engine.embed`. Gate (b) therefore runs keyless and offline, like the rest of the reasoning
 * layer, and its cost is a pairwise cosine over vectors already in memory.
 *
 * ---------------------------------------------------------------------------
 * SIMILARITY SELECTS, AND IS THEN DISCARDED
 *
 * `CandidatePair.similarity` is carried because the UI shows it and because a reviewer needs
 * to know how the pair was surfaced. It is NEVER a verdict. "Use Postgres" and "don't use
 * Postgres" are ~0.9 cosine similar, so a threshold on this number is a contradiction
 * detector that fires on agreement — which is invariant I3's whole subject.
 *
 * That is also why the pair list is seeded from THREE sources rather than similarity alone:
 *
 *   dense neighbours    pairs close in embedding space
 *   shared premises     pairs resting on the same assumption — the gate (c) neighbourhood,
 *                       which is where premise invalidation turns into a conflict
 *   same variable       pairs settling the same slot, whatever their wording — the only
 *                       pairs that can be reversals or refinements at all
 *
 * A similarity-only candidate list would miss the third kind whenever the wording differs, and
 * "we chose SQLite" vs "the database is sqlite" is a plausible pair that embeddings may not
 * rank highly.
 *
 * ---------------------------------------------------------------------------
 * ONLY LIVE DECISIONS ARE CANDIDATES
 *
 * A `proposed` decision never became a belief and a `superseded` one has been withdrawn;
 * neither can contradict a live decision. Filtering here means the classifier's
 * `isClassifiable` guard is never the thing standing between a proposal and a false finding —
 * it is a second line of defence, not the only one.
 * ---------------------------------------------------------------------------
 */

import { cosine } from "@/lib/cosine";
import type { CandidatePair } from "@/reasoning/gates/semantic";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { IndexArtifacts } from "@/types/retrieval";
import { isClassifiable } from "./contradiction";

/** How many dense neighbours each decision is compared against. Small on purpose: gate (b)
 *  classifies every pair it is given, and each classification on the LLM path is a model call.
 *  Five neighbours per decision keeps a 200-decision log to a few hundred pairs. */
export const NEIGHBOURS_PER_DECISION = 5;

/** Below this cosine two decisions are not dense neighbours. Not a contradiction threshold —
 *  a candidate threshold, and a deliberately loose one, because the classifier is what decides
 *  and it costs little to give it one more pair to reject. */
export const NEIGHBOUR_FLOOR = 0.35;

/** Hard ceiling on pairs returned, whatever the log size. Without it a large log produces a
 *  pair list long enough to make gate (b) the slowest thing in the app, and a slow gate gets
 *  skipped — which is worse than a bounded one. */
export const MAX_CANDIDATE_PAIRS = 200;

export interface CandidateOptions {
  readonly neighboursPerDecision?: number;
  readonly neighbourFloor?: number;
  readonly maxPairs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Generate gate (b)'s candidate pairs.
 *
 * Synchronous and allocation-light: it reads vectors already in memory. The `Promise` in
 * gate (b)'s `retrieve` signature is for implementations that DO need to embed; this one
 * does not, and the wrapper in `store/reasoning.ts` adapts it.
 */
export function candidatePairs(
  state: GraphState,
  artifacts: IndexArtifacts,
  options?: CandidateOptions,
): readonly CandidatePair[] {
  const neighboursPerDecision = options?.neighboursPerDecision ?? NEIGHBOURS_PER_DECISION;
  const floor = options?.neighbourFloor ?? NEIGHBOUR_FLOOR;
  const maxPairs = options?.maxPairs ?? MAX_CANDIDATE_PAIRS;

  const live = liveDecisions(state);
  if (live.length < 2) return [];

  const liveSet = new Set(live.map((id) => id as DecisionId));
  const pairs = new Map<string, MutablePair>();

  /* ---- source 1: dense neighbours ---- */
  if (!artifacts.stale) {
    const vectors = new Map<DecisionId, Float32Array>();
    for (const entry of artifacts.dense) {
      if (entry.level !== "L1") continue;
      if (!liveSet.has(entry.decisionId)) continue;
      vectors.set(entry.decisionId, entry.vector);
    }

    const ids = [...vectors.keys()];

    for (const a of ids) {
      const vectorA = vectors.get(a);
      if (vectorA === undefined) continue;

      const scored: { id: DecisionId; score: number }[] = [];
      for (const b of ids) {
        if (a >= b) continue;
        const vectorB = vectors.get(b);
        if (vectorB === undefined) continue;
        const score = cosine(vectorA, vectorB);
        if (score < floor) continue;
        scored.push({ id: b, score });
      }

      scored.sort((x, y) => y.score - x.score);

      for (const neighbour of scored.slice(0, neighboursPerDecision)) {
        addPair(pairs, a, neighbour.id, neighbour.score, "dense");
      }
    }
  }

  /* ---- source 2: shared premises ---- */
  for (const [premiseId, dependents] of state.premiseToDecisions) {
    const shared = dependents.filter((id) => liveSet.has(id));
    if (shared.length < 2) continue;

    for (let i = 0; i < shared.length; i += 1) {
      for (let j = i + 1; j < shared.length; j += 1) {
        const a = shared[i];
        const b = shared[j];
        if (a === undefined || b === undefined) continue;
        addPair(pairs, a, b, 0, "shared-premise", premiseId);
      }
    }
  }

  /* ---- source 3: same variable ---- */
  for (const [, decisionIds] of state.byVariable) {
    const live_ = decisionIds.filter((id) => liveSet.has(id));
    if (live_.length < 2) continue;

    for (let i = 0; i < live_.length; i += 1) {
      for (let j = i + 1; j < live_.length; j += 1) {
        const a = live_[i];
        const b = live_[j];
        if (a === undefined || b === undefined) continue;
        addPair(pairs, a, b, 0, "same-variable");
      }
    }
  }

  /* Highest similarity first, then stable by key, so a truncated list keeps the pairs most
   * likely to be interesting and the run is reproducible. */
  const ordered = [...pairs.values()].sort((x, y) =>
    y.similarity === x.similarity
      ? x.a < y.a
        ? -1
        : x.a > y.a
          ? 1
          : x.b < y.b
            ? -1
            : 1
      : y.similarity - x.similarity,
  );

  return ordered.slice(0, maxPairs).map(
    (pair): CandidatePair => ({
      a: pair.a,
      b: pair.b,
      similarity: pair.similarity,
      sharedPremises: [...pair.sharedPremises],
    }),
  );
}

interface MutablePair {
  readonly a: DecisionId;
  readonly b: DecisionId;
  similarity: number;
  readonly sharedPremises: Set<PremiseId>;
  readonly via: Set<string>;
}

function addPair(
  into: Map<string, MutablePair>,
  rawA: DecisionId,
  rawB: DecisionId,
  similarity: number,
  via: string,
  premiseId?: PremiseId,
): void {
  const a = rawA < rawB ? rawA : rawB;
  const b = rawA < rawB ? rawB : rawA;
  const key = a + "\u0000" + b;

  const existing = into.get(key);
  if (existing === undefined) {
    into.set(key, {
      a,
      b,
      similarity,
      sharedPremises: new Set(premiseId === undefined ? [] : [premiseId]),
      via: new Set([via]),
    });
    return;
  }

  existing.via.add(via);
  if (similarity > existing.similarity) existing.similarity = similarity;
  if (premiseId !== undefined) existing.sharedPremises.add(premiseId);
}

/** Live decisions only. `contested` counts as live: that is the state where a conflict is
 *  awaiting a human call, so it must keep being examined. */
function liveDecisions(state: GraphState): readonly DecisionId[] {
  const out: DecisionId[] = [];
  for (const decision of state.decisions.values()) {
    if (!isClassifiable(decision.status)) continue;
    out.push(decision.id);
  }
  return out;
}

/** Why a pair is a candidate at all. Printed next to the finding so a reviewer can see that
 *  the pair was surfaced by an exact relation rather than by a similarity score — which
 *  matters, because the two have completely different trustworthiness. */
export function describeSource(pair: CandidatePair, state: GraphState): string {
  const a = state.decisions.get(pair.a);
  const b = state.decisions.get(pair.b);
  if (a === undefined || b === undefined) return "candidate";

  const reasons: string[] = [];

  if (a.variable === b.variable) {
    reasons.push(
      "both settle " +
        a.variable +
        (a.value === b.value
          ? ' on "' + a.value + '"'
          : ' — one on "' + a.value + '", one on "' + b.value + '"'),
    );
  }

  if (pair.sharedPremises.length > 0) {
    reasons.push(
      "they share " +
        pair.sharedPremises.length +
        " premise(s): " +
        pair.sharedPremises.map((id) => id).join(", "),
    );
  }

  if (pair.similarity > 0) {
    reasons.push("embedding similarity " + pair.similarity.toFixed(3));
  }

  if (reasons.length === 0) return "candidate";

  /* The similarity is stated LAST and labelled, because it is the weakest of the three and
   * the one a reader is most likely to mistake for the reason a contradiction was reported. */
  return reasons.join("; ");
}

export function describeCandidatePolicy(): string {
  return [
    "Gate (b) candidates come from three sources, unioned and de-duplicated:",
    "",
    "  dense neighbours    cosine >= " +
      NEIGHBOUR_FLOOR +
      ", top " +
      NEIGHBOURS_PER_DECISION +
      " per decision, read from the",
    "                      L1 vectors already in the index — ZERO embedding calls",
    "  shared premises     pairs resting on the same assumption, wherever similarity puts them",
    "  same variable       pairs settling the same slot, whatever their wording",
    "",
    "Ceiling: " +
      MAX_CANDIDATE_PAIRS +
      " pairs. Only live decisions are candidates — a proposal never became a",
    "belief and a superseded decision has been withdrawn, so neither can contradict one.",
    "",
    "The similarity carried on each pair SELECTS it and is then discarded. It is never a",
    "verdict: 'use Postgres' and 'don't use Postgres' are ~0.9 similar, so a threshold on",
    "this number is a contradiction detector that fires on agreement. Invariant I3.",
    "",
    "A similarity-only list would miss the same-variable pairs whenever the wording differs,",
    "which is why there are three sources rather than one.",
  ].join("\n");
}
