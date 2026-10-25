/**
 * Identity resolution: the six-rung ladder.
 *
 * Phase 0 · sub-phase 0.4
 * Plan: plan/phase-0-foundation.md §0.4
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 *
 * The same decision arrives twice: once as "we'll use sqlite", once as "SQLite
 * for the local store". If both become nodes, every downstream number is wrong —
 * corroboration doubles, the timeline shows a change of mind that never happened,
 * and the structural contradiction gate fires against the user's own history.
 *
 * The acceptance test is brutal and correct: IMPORT THE SAME FILE TWICE AND ZERO
 * NEW NODES MUST APPEAR. Not "few". Zero. A resolution ladder that is merely
 * good fails that test on the second pass through a 125-line transcript.
 *
 * ---------------------------------------------------------------------------
 * THE LADDER — STOP AT THE FIRST MATCH
 *
 *   1  exact predicate            -> MERGE
 *   2  variable + canonical value -> MERGE
 *   3  alias hit                  -> MERGE
 *   4  cosine >= tau_high         -> MERGE, flagged for review
 *   5  cosine >= tau_low          -> CANDIDATE, ask the human
 *   6  otherwise                  -> CREATE NEW
 *
 * The order is the design. Cheap, exact, deterministic tests run first, so the
 * common case never reaches an embedding — which means the ladder produces the
 * SAME answer with no API key as with one, and the local engine is not a
 * degraded mode. Rungs 4 and 5 only ever fire on genuinely novel phrasing.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HARD RULE
 *
 * MERGING ACROSS PREMISE TYPES IS FORBIDDEN, regardless of similarity.
 *
 * "single user" (scale) and "single sign-on user flow" (requirement) are close
 * in every embedding space and are never the same node. A false merge there does
 * not merely lose a premise: it wires two unrelated decisions to a shared
 * assumption, so invalidating one cascades into the other. That is the single
 * most damaging failure mode in the system, and it is prevented by a type check
 * rather than by a threshold.
 * ---------------------------------------------------------------------------
 */

import { cosine } from "@/lib/cosine";
import { contentTokens, normalise } from "@/lib/text";
import type { DecisionId, EngineId, EventId, PremiseId } from "@/types/common";
import type {
  Decision,
  DecisionVariable,
  Premise,
  PremiseType,
} from "@/types/domain";

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                 */
/* -------------------------------------------------------------------------- */

/** Above this, merge and flag. Two phrasings of one decision. */
export const TAU_HIGH = 0.92;

/** Between the two, ask the human. Getting this wrong in either direction is
 *  visible: too low and the review queue fills with noise, too high and
 *  duplicates slip through to corrupt the metrics. */
export const TAU_LOW = 0.78;

/** Below TAU_LOW, and for the LOCAL engine specifically: the hashed n-gram
 *  vectoriser produces a narrower similarity distribution than a trained
 *  embedding model, so its thresholds sit lower. Using the LLM thresholds on
 *  local vectors would send almost everything to rung 6 and quietly reintroduce
 *  the duplicate problem the ladder exists to prevent. */
export const LOCAL_TAU_HIGH = 0.86;
export const LOCAL_TAU_LOW = 0.68;

export function thresholdsFor(engine: EngineId): { high: number; low: number } {
  return engine.kind === "local"
    ? { high: LOCAL_TAU_HIGH, low: LOCAL_TAU_LOW }
    : { high: TAU_HIGH, low: TAU_LOW };
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export type ResolutionRung = 1 | 2 | 3 | 4 | 5 | 6;

export const RUNG_NAMES: Readonly<Record<ResolutionRung, string>> = {
  1: "exact-predicate",
  2: "variable-and-canonical-value",
  3: "alias",
  4: "dense-high",
  5: "dense-low",
  6: "new",
};

export type ResolutionAction = "merge" | "candidate" | "create";

export interface Resolution<TId> {
  readonly action: ResolutionAction;
  /** Which rung decided. Recorded on the node's `resolvedFrom` provenance so a
   *  wrong merge can be diagnosed rather than merely observed. */
  readonly rung: ResolutionRung;
  readonly matchedId: TId | null;
  readonly score: number;
  readonly explanation: string;
  /** Rung 4 merges are correct often enough to apply, and wrong often enough to
   *  show. This flag is what puts them in the review queue. */
  readonly needsReview: boolean;
}

export type DecisionResolution = Resolution<DecisionId>;
export type PremiseResolution = Resolution<PremiseId>;

const CREATE_DECISION: DecisionResolution = {
  action: "create",
  rung: 6,
  matchedId: null,
  score: 0,
  explanation: "no existing decision matched on predicate, value, alias or similarity",
  needsReview: false,
};

/* -------------------------------------------------------------------------- */
/* The canonicalisation seam                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Alias folding, injected rather than imported.
 *
 * `src/ontology/canonicalize.ts` supplies the real implementation; the fold and
 * the tests can supply an identity function. Injecting it keeps this module free
 * of the ontology's data tables and makes the ladder's behaviour on raw, unfolded
 * values directly observable — which is how you tell a canonicalisation bug from
 * a resolution bug.
 */
export interface Canonicalizer {
  /** Fold a value to its canonical form for a variable. "pg" -> "postgres". */
  readonly canonicalValue: (variable: DecisionVariable, value: string) => string;
  /** Fold a premise predicate to its canonical form. */
  readonly canonicalPredicate: (type: PremiseType, predicate: string) => string;
  /** True when `value` is a known alias of `canonical` for this variable. */
  readonly isAliasOf: (variable: DecisionVariable, value: string, canonical: string) => boolean;
}

/** The no-op canonicalizer. Everything falls to rung 2 on exact strings. */
export const IDENTITY_CANONICALIZER: Canonicalizer = {
  canonicalValue: (_variable, value) => normalise(value),
  canonicalPredicate: (_type, predicate) => normalise(predicate),
  isAliasOf: () => false,
};

/* -------------------------------------------------------------------------- */
/* Candidates                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The pool a new node is compared against.
 *
 * Pre-filtered BEFORE the ladder runs: decisions by variable, premises by type.
 * Comparing against the whole graph is O(n) per extraction with embeddings, and
 * comparing a `DATABASE` decision against an `AUTH` decision can only ever
 * produce a false merge.
 */
export interface DecisionCandidates {
  readonly decisions: readonly Decision[];
  readonly variable: DecisionVariable;
  readonly canonicalValue: string;
}

export interface PremiseCandidates {
  readonly premises: readonly Premise[];
  readonly type: PremiseType;
  readonly predicate: string;
}

/** Restrict to decisions on the same variable that are still live. A superseded
 *  decision is a legitimate merge target — re-importing history should find it —
 *  but an archived/rejected one is not: merging into it would resurrect a node
 *  the user deliberately closed. */
export function decisionPool(
  decisions: ReadonlyMap<DecisionId, Decision>,
  variable: DecisionVariable,
): readonly Decision[] {
  const out: Decision[] = [];
  for (const decision of decisions.values()) {
    if (decision.variable !== variable) continue;
    if (decision.status === "archived") continue;
    out.push(decision);
  }
  return out;
}

/** The hard rule, applied. Premises are pooled by TYPE FIRST and there is no
 *  code path that compares across types. */
export function premisePool(
  premises: ReadonlyMap<PremiseId, Premise>,
  type: PremiseType,
): readonly Premise[] {
  const out: Premise[] = [];
  for (const premise of premises.values()) {
    if (premise.type === type) out.push(premise);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Fingerprinting                                                             */
/* -------------------------------------------------------------------------- */

/** variable || canonical value. Used for dedup only — it is NOT identity,
 *  because two decisions on the same variable and value can legitimately differ
 *  in time (a reversal), and the fingerprint cannot see that. */
export function decisionFingerprint(
  variable: DecisionVariable,
  canonicalValue: string,
): string {
  return `${variable}\u0000${normalise(canonicalValue)}`;
}

/** type || canonical predicate. The premise analogue, and the strongest signal
 *  available: predicates are namespaced ("scale.max_users"), so an exact hit is
 *  an exact hit. */
export function premiseFingerprint(type: PremiseType, canonicalPredicate: string): string {
  return `${type}\u0000${normalise(canonicalPredicate)}`;
}

/* -------------------------------------------------------------------------- */
/* Text similarity for the local path                                         */
/* -------------------------------------------------------------------------- */

/**
 * A cheap lexical similarity, used when no embedding exists for a candidate.
 *
 * Token Jaccard over content tokens. It is NOT a substitute for the dense rung —
 * it is what makes rungs 4 and 5 usable at all with no API key, which is the
 * default configuration. Without it the local engine would fall straight to
 * rung 6 and create a duplicate on every re-import with different phrasing.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

/* -------------------------------------------------------------------------- */
/* The ladder — decisions                                                     */
/* -------------------------------------------------------------------------- */

export interface ResolveDecisionInput {
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  /** Predicate, when the extractor produced one. Rung 1 needs it. */
  readonly predicate?: string;
  readonly candidates: readonly Decision[];
  readonly canonicalizer: Canonicalizer;
  /** id -> vector, from src/substrate/index-artifacts.ts. Absent entries fall
   *  back to lexical similarity, so the ladder degrades rather than failing. */
  readonly vectors?: ReadonlyMap<DecisionId, Float32Array>;
  readonly queryVector?: Float32Array;
  readonly engine: EngineId;
}

export function resolveDecision(input: ResolveDecisionInput): DecisionResolution {
  const canonical = input.canonicalizer.canonicalValue(input.variable, input.value);
  const { high, low } = thresholdsFor(input.engine);

  /* ---- Rung 1: exact predicate ---- */
  if (input.predicate !== undefined) {
    const predicate = normalise(input.predicate);
    for (const candidate of input.candidates) {
      const candidateStatement = normalise(candidate.statement);
      if (candidateStatement === predicate || normalise(candidate.value) === predicate) {
        return decided(input.variable, candidate, 1, 1, `exact predicate match on "${predicate}"`);
      }
    }
  }

  /* ---- Rung 2: variable + canonical value ---- */
  for (const candidate of input.candidates) {
    const candidateCanonical = input.canonicalizer.canonicalValue(
      candidate.variable,
      candidate.value,
    );
    if (candidateCanonical === canonical) {
      return decided(
        input.variable,
        candidate,
        2,
        1,
        `same variable and canonical value "${canonical}"`,
      );
    }
  }

  /* ---- Rung 3: alias hit ---- */
  for (const candidate of input.candidates) {
    const candidateCanonical = input.canonicalizer.canonicalValue(
      candidate.variable,
      candidate.value,
    );
    if (input.canonicalizer.isAliasOf(input.variable, input.value, candidateCanonical)) {
      return decided(
        input.variable,
        candidate,
        3,
        0.99,
        `"${input.value}" is a known alias of "${candidateCanonical}"`,
      );
    }
  }

  /* ---- Rungs 4 & 5: similarity ---- */
  const scored = scoreAgainstDecisions(input, canonical);
  if (scored.length === 0) return CREATE_DECISION;

  const best = scored[0];
  if (!best) return CREATE_DECISION;

  if (best.score >= high) {
    return {
      action: "merge",
      rung: 4,
      matchedId: best.decision.id,
      score: best.score,
      explanation: `${best.via} similarity ${best.score.toFixed(3)} >= ${high.toFixed(2)} against ${best.decision.id}`,
      // Applied, but shown. A rung-4 merge is a judgement call the system is
      // allowed to make and the user is entitled to see.
      needsReview: true,
    };
  }

  if (best.score >= low) {
    return {
      action: "candidate",
      rung: 5,
      matchedId: best.decision.id,
      score: best.score,
      explanation: `${best.via} similarity ${best.score.toFixed(3)} is between ${low.toFixed(2)} and ${high.toFixed(2)} — too close to create silently, too far to merge silently`,
      needsReview: true,
    };
  }

  /* ---- Rung 6 ---- */
  return {
    ...CREATE_DECISION,
    score: best.score,
    explanation: `closest existing decision ${best.decision.id} scores ${best.score.toFixed(3)}, below ${low.toFixed(2)}`,
  };
}

function decided(
  variable: DecisionVariable,
  candidate: Decision,
  rung: ResolutionRung,
  score: number,
  why: string,
): DecisionResolution {
  return {
    action: "merge",
    rung,
    matchedId: candidate.id,
    score,
    explanation: `${variable}: ${why}`,
    needsReview: false,
  };
}

interface ScoredDecision {
  readonly decision: Decision;
  readonly score: number;
  readonly via: "embedding" | "lexical";
}

function scoreAgainstDecisions(
  input: ResolveDecisionInput,
  canonical: string,
): readonly ScoredDecision[] {
  const scored: ScoredDecision[] = [];

  for (const candidate of input.candidates) {
    const vector = input.vectors?.get(candidate.id);
    if (vector && input.queryVector) {
      scored.push({ decision: candidate, score: cosine(input.queryVector, vector), via: "embedding" });
      continue;
    }
    // No vector for this candidate: fall back to lexical rather than scoring it
    // 0, which would silently demote every un-embedded node to "definitely new".
    const text = `${candidate.statement} ${candidate.value}`;
    const query = `${input.statement} ${input.value} ${canonical}`;
    scored.push({ decision: candidate, score: lexicalSimilarity(query, text), via: "lexical" });
  }

  // Deterministic: score descending, then id ascending. Two candidates with the
  // same score must always resolve to the same one, or a replay of the same
  // import produces a different graph.
  scored.sort((a, b) =>
    b.score === a.score
      ? a.decision.id < b.decision.id
        ? -1
        : 1
      : b.score - a.score,
  );
  return scored;
}

/* -------------------------------------------------------------------------- */
/* The ladder — premises                                                      */
/* -------------------------------------------------------------------------- */

export interface ResolvePremiseInput {
  readonly type: PremiseType;
  readonly predicate: string;
  readonly text: string;
  readonly value?: string | number | boolean;
  readonly candidates: readonly Premise[];
  readonly canonicalizer: Canonicalizer;
  readonly vectors?: ReadonlyMap<PremiseId, Float32Array>;
  readonly queryVector?: Float32Array;
  readonly engine: EngineId;
}

export function resolvePremise(input: ResolvePremiseInput): PremiseResolution {
  const canonicalPredicate = input.canonicalizer.canonicalPredicate(input.type, input.predicate);
  const { high, low } = thresholdsFor(input.engine);

  /* ---- Rung 1: exact predicate ---- */
  for (const candidate of input.candidates) {
    const candidatePredicate = input.canonicalizer.canonicalPredicate(
      candidate.type,
      candidate.predicate,
    );
    if (candidatePredicate === canonicalPredicate) {
      // Values may still differ: "scale.max_users = 1" vs "= 1000" is the same
      // PREMISE NODE with a new observation, not two nodes. The merge appends
      // evidence and the newer value wins, which is exactly what gate (c) needs
      // in order to fire.
      return premiseDecided(input.type, candidate, 1, 1, `exact predicate "${canonicalPredicate}"`);
    }
  }

  /* ---- Rung 2: type + canonical text ---- */
  const canonicalText = normalise(input.text);
  for (const candidate of input.candidates) {
    if (normalise(candidate.text) === canonicalText) {
      return premiseDecided(input.type, candidate, 2, 1, "identical canonical text");
    }
  }

  /* ---- Rung 3: alias hit on the value ---- */
  if (typeof input.value === "string") {
    for (const candidate of input.candidates) {
      if (typeof candidate.value !== "string") continue;
      // Premise values are not scoped to a decision variable, so the alias table
      // is consulted unscoped here. "pg" means postgres in a premise value just
      // as it does in a DATABASE decision, and the one case where an alias is
      // variable-specific (e.g. "none" under AUTH) is caught by rung 1 first.
      if (input.canonicalizer.isAliasOf("OTHER", input.value, candidate.value)) {
        return premiseDecided(
          input.type,
          candidate,
          3,
          0.99,
          `"${input.value}" is a known alias of "${candidate.value}"`,
        );
      }
    }
  }

  /* ---- Rungs 4 & 5 ---- */
  const scored = scoreAgainstPremises(input);
  const best = scored[0];
  if (!best) {
    return {
      action: "create",
      rung: 6,
      matchedId: null,
      score: 0,
      explanation: `no ${input.type} premise matched`,
      needsReview: false,
    };
  }

  if (best.score >= high) {
    return {
      action: "merge",
      rung: 4,
      matchedId: best.premise.id,
      score: best.score,
      explanation: `${best.via} similarity ${best.score.toFixed(3)} >= ${high.toFixed(2)} against ${best.premise.id}`,
      needsReview: true,
    };
  }

  if (best.score >= low) {
    return {
      action: "candidate",
      rung: 5,
      matchedId: best.premise.id,
      score: best.score,
      explanation: `${best.via} similarity ${best.score.toFixed(3)} — asking rather than guessing`,
      needsReview: true,
    };
  }

  return {
    action: "create",
    rung: 6,
    matchedId: null,
    score: best.score,
    explanation: `closest ${input.type} premise ${best.premise.id} scores ${best.score.toFixed(3)}, below ${low.toFixed(2)}`,
    needsReview: false,
  };
}

function premiseDecided(
  type: PremiseType,
  candidate: Premise,
  rung: ResolutionRung,
  score: number,
  why: string,
): PremiseResolution {
  return {
    action: "merge",
    rung,
    matchedId: candidate.id,
    score,
    explanation: `${type}: ${why}`,
    needsReview: false,
  };
}

interface ScoredPremise {
  readonly premise: Premise;
  readonly score: number;
  readonly via: "embedding" | "lexical";
}

function scoreAgainstPremises(input: ResolvePremiseInput): readonly ScoredPremise[] {
  const scored: ScoredPremise[] = [];

  for (const candidate of input.candidates) {
    const vector = input.vectors?.get(candidate.id);
    if (vector && input.queryVector) {
      scored.push({ premise: candidate, score: cosine(input.queryVector, vector), via: "embedding" });
      continue;
    }
    scored.push({
      premise: candidate,
      score: lexicalSimilarity(input.text, candidate.text),
      via: "lexical",
    });
  }

  scored.sort((a, b) =>
    b.score === a.score ? (a.premise.id < b.premise.id ? -1 : 1) : b.score - a.score,
  );
  return scored;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a merge does to a node.
 *
 * Merging is NOT overwriting. The incoming observation is appended to
 * `resolvedFrom`, evidence is added, confidence takes the maximum, and the
 * existing identity — id, first-learned time, label — is preserved. A merge that
 * changed the label would let a re-import silently retract a decision.
 */
export interface MergeOutcome {
  readonly targetId: DecisionId | PremiseId;
  readonly rung: ResolutionRung;
  readonly mergedEventIds: readonly EventId[];
  readonly confidence: number;
  readonly needsReview: boolean;
}

/** Aggregate resolution statistics, for the health panel and for the
 *  double-import acceptance test. */
export interface ResolutionStats {
  readonly total: number;
  readonly merged: number;
  readonly candidates: number;
  readonly created: number;
  readonly byRung: Readonly<Record<ResolutionRung, number>>;
}

export function emptyResolutionStats(): ResolutionStats {
  return {
    total: 0,
    merged: 0,
    candidates: 0,
    created: 0,
    byRung: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };
}

export function recordResolution(
  stats: ResolutionStats,
  action: ResolutionAction,
  rung: ResolutionRung,
): ResolutionStats {
  const byRung: Record<ResolutionRung, number> = { ...stats.byRung };
  byRung[rung] += 1;

  return {
    total: stats.total + 1,
    merged: stats.merged + (action === "merge" ? 1 : 0),
    candidates: stats.candidates + (action === "candidate" ? 1 : 0),
    created: stats.created + (action === "create" ? 1 : 0),
    byRung,
  };
}

/** A one-line summary of where identity is being decided. A log whose merges are
 *  all rung 4 is a log whose canonicalisation is too weak; a log that is all
 *  rung 6 is creating duplicates. */
export function describeResolutionStats(stats: ResolutionStats): string {
  if (stats.total === 0) return "no resolution decisions yet";
  const dominant = (Object.entries(stats.byRung) as [string, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const rung = dominant ? (Number(dominant[0]) as ResolutionRung) : 6;
  return `${stats.merged}/${stats.total} merged (${stats.created} created, ${stats.candidates} queued); most decisions at rung ${rung} (${RUNG_NAMES[rung]})`;
}
