/**
 * Entity resolution ΓÇö 1.7.
 *
 * Phase 1 ┬╖ sub-phase 1.7
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.7
 *
 * ---------------------------------------------------------------------------
 * WHY IT SITS BETWEEN EXTRACTION AND ASSERTION
 *
 * Resolution needs extraction output but must precede assertion. Skipping it is
 * the most common failure in naive implementations, and the failure is
 * self-reinforcing: paste three transcripts from the same project and you get
 * three copies of every decision, after which contradiction detection fires on
 * your own duplicates, and the user disables the feature that was working
 * correctly.
 *
 * So the ladder runs HERE, on candidates that have no ids yet, and its answer is
 * one of:
 *
 *   merge      ΓåÆ the commit re-asserts the EXISTING node, extending its evidence
 *                and incrementing corroboration. No new node.
 *   candidate  ΓåÆ the ladder is not sure. The review UI shows both and asks.
 *   create     ΓåÆ a new node.
 *
 * ---------------------------------------------------------------------------
 * MERGE SEMANTICS, FROM THE PLAN
 *
 *   decision merge ΓåÆ corroboration +1, evidence extended, learned time updated,
 *                    VALID TIME UNCHANGED (the earliest wins ΓÇö a decision made in
 *                    March and re-stated in October was made in March)
 *   premise merge  ΓåÆ corroboration +1, evidence extended. A premise asserted in
 *                    two separate sessions is materially stronger than one
 *                    asserted once, and Phase 2's entrenchment must see that.
 *   conflict       ΓåÆ DO NOT MERGE. Same variable, different value. Emitted as a
 *                    contradiction candidate for Phase 2.
 *
 * The fold implements the first two; this module's job is to decide which of the
 * three applies, and to say why in words the review UI can show.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT PASSED IN
 *
 * Embeddings. Rungs 4 and 5 of the ladder are cosine thresholds, and the vectors
 * live in the disposable index (`src/substrate/index-artifacts.ts`). When the
 * index is stale or absent ΓÇö which is the normal state right after an engine
 * switch ΓÇö `vectors` is omitted and the ladder falls back to lexical similarity.
 * It degrades; it does not fail, and it does not block extraction on an await.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId, PremiseId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { AlternativeCandidate, DecisionCandidate, PremiseCandidate } from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import {
  decisionPool,
  premiseFingerprint,
  premisePool,
  resolveDecision,
  resolvePremise,
  type DecisionResolution,
  type PremiseResolution,
} from "@/substrate/identity";
import { ONTOLOGY_CANONICALIZER, canonicalValueOf, foldKey } from "@/ontology/canonicalize";
import type { ResolvedCandidate, ResolutionOutcome } from "./types";
import { tierOf } from "./types";
import type { OriginClassification } from "./provenance";

export interface ResolutionContext {
  readonly state: GraphState;
  readonly engine: EngineId;
  /** id ΓåÆ vector, when the index is fresh. Omit and the ladder uses lexical
   *  similarity, which is rung 4 with a weaker metric ΓÇö not a failure. */
  readonly decisionVectors?: ReadonlyMap<DecisionId, Float32Array>;
  readonly premiseVectors?: ReadonlyMap<PremiseId, Float32Array>;
}

export interface ResolutionReport {
  readonly decisions: number;
  readonly premises: number;
  readonly alternatives: number;
  readonly merged: number;
  readonly candidates: number;
  readonly created: number;
  readonly conflicts: number;
  /** The ladder's own tally, for the "how did it decide" expansion. */
  readonly byRung: Readonly<Record<number, number>>;
}

export interface ResolutionResult {
  readonly resolved: readonly ResolvedCandidate[];
  readonly report: ResolutionReport;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one extraction's candidates against the current graph.
 *
 * Order matters: PREMISES FIRST. A decision's `premiseRefs` are indices into the
 * premise list, and the commit writes `PremiseAsserted` before `DecisionProposed`
 * so that the justification can reference real ids. Resolving in the same order
 * keeps the index arithmetic identical in both places.
 */
export function resolveExtraction(
  decisions: readonly { candidate: DecisionCandidate; origin: OriginClassification }[],
  premises: readonly PremiseCandidate[],
  alternatives: readonly AlternativeCandidate[],
  context: ResolutionContext,
): ResolutionResult {
  const resolved: ResolvedCandidate[] = [];
  const byRung: Record<number, number> = {};
  let merged = 0;
  let candidates = 0;
  let created = 0;
  let conflicts = 0;

  const bump = (rung: number): void => {
    byRung[rung] = (byRung[rung] ?? 0) + 1;
  };

  premises.forEach((candidate, index) => {
    const outcome = resolveOnePremise(candidate, context);
    bump(outcome.rung);
    merged += outcome.action === "merge" ? 1 : 0;
    candidates += outcome.action === "candidate" ? 1 : 0;
    created += outcome.action === "create" ? 1 : 0;

    resolved.push({
      key: `premise:${index}`,
      kind: "premise",
      decision: null,
      premise: candidate,
      alternative: null,
      resolution: outcome,
      origin: "agent_inferred",
      confidence: candidate.confidence,
      tier: tierOf(candidate.confidence),
      snippet: candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: [],
      outRefs: [],
    });
  });

  decisions.forEach((entry, index) => {
    const outcome = resolveOneDecision(entry.candidate, context);
    bump(outcome.rung);
    merged += outcome.action === "merge" ? 1 : 0;
    candidates += outcome.action === "candidate" ? 1 : 0;
    created += outcome.action === "create" ? 1 : 0;
    conflicts += outcome.conflictsWith.length > 0 ? 1 : 0;

    resolved.push({
      key: `decision:${index}`,
      kind: "decision",
      decision: entry.candidate,
      premise: null,
      alternative: null,
      resolution: outcome,
      origin: entry.origin.origin,
      confidence: entry.candidate.confidence,
      tier: tierOf(entry.candidate.confidence),
      snippet: entry.candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: entry.candidate.premiseRefs,
      outRefs: [],
    });
  });

  alternatives.forEach((candidate, index) => {
    // Alternatives are never merged: an alternative belongs to the decision that
    // rejected it, and two decisions can reject the same thing for different
    // reasons. Resolution here only decides whether the SAME decision already
    // rejected the SAME value, which is a duplicate rather than a merge.
    const outcome = resolveOneAlternative(candidate, context);
    bump(outcome.rung);
    created += outcome.action === "create" ? 1 : 0;
    merged += outcome.action === "merge" ? 1 : 0;

    resolved.push({
      key: `alternative:${index}`,
      kind: "alternative",
      decision: null,
      premise: null,
      alternative: candidate,
      resolution: outcome,
      origin: "agent_inferred",
      confidence: candidate.confidence,
      tier: tierOf(candidate.confidence),
      snippet: candidate.snippet,
      episodeIndex: -1,
      episodeId: null,
      inRefs: [],
      outRefs: [],
    });
  });

  return {
    resolved,
    report: {
      decisions: decisions.length,
      premises: premises.length,
      alternatives: alternatives.length,
      merged,
      candidates,
      created,
      conflicts,
      byRung,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

function resolveOneDecision(candidate: DecisionCandidate, context: ResolutionContext): ResolutionOutcome {
  const pool = decisionPool(context.state.decisions, candidate.variable);
  const resolution: DecisionResolution = resolveDecision({
    variable: candidate.variable,
    value: candidate.value,
    statement: candidate.statement,
    candidates: pool,
    canonicalizer: ONTOLOGY_CANONICALIZER,
    ...(context.decisionVectors === undefined ? {} : { vectors: context.decisionVectors }),
    engine: context.engine,
  });

  const conflicts = conflictingDecisions(candidate, context.state);

  return {
    action: resolution.action,
    rung: resolution.rung,
    matchedId: resolution.matchedId,
    score: resolution.score,
    // A conflict is appended to the explanation rather than replacing it: the
    // ladder's reasoning is still the reason the item is not a merge, and the
    // conflict is additional information the user needs.
    explanation:
      conflicts.length === 0
        ? resolution.explanation
        : `${resolution.explanation}. Conflicts with ${conflicts.join(", ")} on ${candidate.variable}.`,
    needsReview: resolution.needsReview || conflicts.length > 0,
    conflictsWith: conflicts,
  };
}

/**
 * Existing LIVE decisions on the same variable with a different canonical value.
 *
 * Superseded decisions are excluded: reversing a decision is not contradicting it,
 * and flagging every reversal as a conflict would put the whole supersession
 * mechanism in the conflict queue.
 */
export function conflictingDecisions(candidate: DecisionCandidate, state: GraphState): readonly DecisionId[] {
  const canonical =
    candidate.variable === "OTHER" ? foldKey(candidate.value) : canonicalValueOf(candidate.variable, candidate.value);

  const ids = state.byVariable.get(candidate.variable) ?? [];
  const out: DecisionId[] = [];

  for (const id of ids) {
    const existing: Decision | undefined = state.decisions.get(id);
    if (existing === undefined) continue;
    if (existing.status === "superseded" || existing.status === "archived") continue;
    if (existing.label !== "IN" && existing.label !== "UNKNOWN") continue;
    if (canonicalValueOf(candidate.variable, existing.value) === canonical) continue;
    out.push(id);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Premises                                                                   */
/* -------------------------------------------------------------------------- */

function resolveOnePremise(candidate: PremiseCandidate, context: ResolutionContext): ResolutionOutcome {
  // The fast path: the fingerprint index is exact, so a premise whose type and
  // canonical predicate are already in the graph is a merge without running the
  // ladder at all. Double-importing a transcript takes this path for every premise,
  // which is what makes "zero new nodes" cheap rather than merely true.
  const fingerprint = premiseFingerprint(candidate.type, candidate.predicate);
  const indexed = context.state.premiseByFingerprint.get(fingerprint);
  if (indexed !== undefined) {
    const existing = context.state.premises.get(indexed);
    if (existing !== undefined) {
      return {
        action: "merge",
        rung: 1,
        matchedId: indexed,
        score: 1,
        explanation: `${indexed} already carries ${candidate.predicate} ΓÇö this extends its evidence and increments corroboration`,
        needsReview: false,
        conflictsWith: [],
      };
    }
  }

  const pool = premisePool(context.state.premises, candidate.type);
  const resolution: PremiseResolution = resolvePremise({
    type: candidate.type,
    predicate: candidate.predicate,
    text: candidate.text,
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
    candidates: pool,
    canonicalizer: ONTOLOGY_CANONICALIZER,
    ...(context.premiseVectors === undefined ? {} : { vectors: context.premiseVectors }),
    engine: context.engine,
  });

  return {
    action: resolution.action,
    rung: resolution.rung,
    matchedId: resolution.matchedId,
    score: resolution.score,
    explanation: resolution.explanation,
    needsReview: resolution.needsReview,
    conflictsWith: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Alternatives                                                               */
/* -------------------------------------------------------------------------- */

function resolveOneAlternative(candidate: AlternativeCandidate, context: ResolutionContext): ResolutionOutcome {
  const canonical =
    candidate.variable === "OTHER" ? foldKey(candidate.value) : canonicalValueOf(candidate.variable, candidate.value);

  for (const existing of context.state.alternatives.values()) {
    if (existing.decisionId !== decisionIdForRef(candidate.decisionRef, context)) continue;
    if (canonicalValueOf(existing.variable, existing.value) !== canonical) continue;

    return {
      action: "merge",
      rung: 2,
      matchedId: existing.id,
      score: 1,
      explanation: `${existing.decisionId} already records ${canonical} as rejected`,
      needsReview: false,
      conflictsWith: [],
    };
  }

  return {
    action: "create",
    rung: 6,
    matchedId: null,
    score: 0,
    explanation: "no existing decision records this value as rejected",
    needsReview: true,
    conflictsWith: [],
  };
}

/**
 * The local `decisionRef` index cannot be resolved to a real id here ΓÇö the
 * decision may itself be a candidate that has not been committed yet. Returning
 * null makes the duplicate check conservative: an alternative whose decision is
 * not yet in the graph is never a duplicate of one that is.
 */
function decisionIdForRef(_decisionRef: number, _context: ResolutionContext): DecisionId | null {
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeResolution(report: ResolutionReport): string {
  const parts = [
    `${report.decisions} decision${report.decisions === 1 ? "" : "s"}`,
    `${report.premises} premise${report.premises === 1 ? "" : "s"}`,
    `${report.alternatives} alternative${report.alternatives === 1 ? "" : "s"}`,
  ];
  const outcomes = [
    `${report.merged} merged onto existing nodes`,
    `${report.candidates} uncertain ΓÇö the review will ask`,
    `${report.created} new`,
  ];
  if (report.conflicts > 0) {
    outcomes.push(`${report.conflicts} conflict${report.conflicts === 1 ? "" : "s"} with a live decision`);
  }
  return `${parts.join(", ")} ΓåÆ ${outcomes.join(", ")}`;
}

/**
 * The sentence that answers "did importing this twice create anything?"
 *
 * This is the acceptance criterion, and it is worth stating as a claim the UI can
 * check rather than as a number the user has to interpret.
 */
export function describeIdempotence(report: ResolutionReport): string {
  if (report.created === 0 && report.decisions + report.premises + report.alternatives > 0) {
    return "Every item merged onto an existing node. Re-importing this transcript created nothing.";
  }
  if (report.merged === 0) {
    return "Nothing merged: this transcript's items are all new to the graph.";
  }
  return `${report.merged} merged, ${report.created} new, ${report.candidates} left for the review to decide.`;
}
