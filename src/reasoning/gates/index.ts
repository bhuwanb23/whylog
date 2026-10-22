/**
 * Gate orchestration — 2.3–2.5.
 *
 * Phase 2 · sub-phases 2.3, 2.4, 2.5
 * Plan: plan/phase-2-truth-maintenance.md §2.3–2.5
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS THE DESIGN
 *
 *   (a) structural — O(1), no model, no network, no threshold. Always runs.
 *   (c) premise    — a label lookup over justifications. Always runs.
 *   (b) semantic   — retrieval plus a model call. Runs only if it is available.
 *
 * Cheapest and most certain first, for two reasons that are not about speed. One:
 * gate (a)'s answer is passed INTO gate (b) as `structuralVerdict`, so a model that
 * disagrees with an antonym-table lookup has to say so explicitly rather than
 * silently overruling it. Two: a deterministic gate that runs after a model call
 * inherits the model's latency in the user's perception of it, and "instant" is part
 * of what makes gate (a) believable.
 *
 * ---------------------------------------------------------------------------
 * ALL THREE RUN. THERE IS NO SHORT-CIRCUIT.
 *
 * The plan's diagram asks "any gate fired?" after the three, not between them.
 * Stopping at the first hit would mean a structural contradiction hides a premise
 * invalidation on the same decision, and the two have different remedies: one says
 * "you disagree with yourself", the other says "the world moved". A user who is only
 * told the first will fix the wrong thing.
 *
 * The results are UNIONED and de-duplicated by decision, and a decision that appears
 * in both gets both explanations.
 * ---------------------------------------------------------------------------
 */

import type { WhyLogEngine } from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, PremiseId } from "@/types/common";
import type { ContradictionGate, ContradictionVerdict } from "@/types/retrieval";
import type { Labelled, NodeId } from "../labeller";
import { type PremiseInvalidation, detectPremiseInvalidation } from "./premise";
import { type CandidatePair, type GateBResult, type SemanticHit, detectSemantic } from "./semantic";
import { type StructuralHit, detectStructural } from "./structural";

/** One finding, whichever gate produced it. The cycle downstream
 *  (`backtracking`, `cascade`, `adjudication`, `proposals`) reads this shape and
 *  never branches on which gate fired — which is the point of unifying it. */
export interface GateFinding {
  readonly gate: ContradictionGate;
  readonly verdict: ContradictionVerdict;
  readonly decisionId: DecisionId;
  readonly otherDecisionId: DecisionId | null;
  readonly premiseId: PremiseId | null;
  readonly explanation: string;
  readonly diagnostic: "M1" | "M2" | null;
  /** Deterministic findings are shown with more confidence than modelled ones, and
   *  the UI says which is which rather than blending them into one list. */
  readonly deterministic: boolean;
}

export interface GateRun {
  readonly findings: readonly GateFinding[];
  readonly structural: readonly StructuralHit[];
  readonly premise: readonly PremiseInvalidation[];
  readonly semantic: GateBResult;
  readonly anyFired: boolean;
  readonly durationMs: number;
}

export interface GateOptions {
  readonly engine: WhyLogEngine;
  /** Phase 3 supplies this. Absent means gate (b) reports itself unavailable rather
   *  than guessing at candidates. */
  readonly retrieve?: (state: GraphState) => Promise<readonly CandidatePair[]>;
  /** Skip gate (b) even when a retriever exists — used by the keyless demo path and
   *  by Phase 7 when measuring gates (a) and (c) in isolation. */
  readonly skipSemantic?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function runGates(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  options: GateOptions,
): Promise<GateRun> {
  const started = nowMs();

  /* ---- (a) structural: no await, no model, no threshold ---- */
  const structural = detectStructural(state);

  /* ---- (c) premise: a label lookup over the justification set ---- */
  const premiseGate = detectPremiseInvalidation(state, labels);

  /* ---- (b) semantic: retrieval + classification, when available ---- */
  const semantic =
    options.skipSemantic === true
      ? unavailable(
          "Skipped for this run. Gates (a) and (c) still ran; nothing was compared semantically.",
        )
      : await detectSemantic(state, options.engine, options.retrieve);

  const findings: GateFinding[] = [
    ...structural.map(fromStructural),
    ...premiseGate.invalidations.map(fromPremise),
    ...semantic.hits.map(fromSemantic),
  ];

  return {
    findings: dedupe(findings),
    structural,
    premise: premiseGate.invalidations,
    semantic,
    anyFired: findings.length > 0,
    durationMs: Math.round(nowMs() - started),
  };
}

function unavailable(reason: string): GateBResult {
  return { hits: [], pairsConsidered: 0, available: false, unavailableReason: reason };
}

/* -------------------------------------------------------------------------- */
/* Unifying the three shapes                                                  */
/* -------------------------------------------------------------------------- */

function fromStructural(hit: StructuralHit): GateFinding {
  return {
    gate: "structural",
    verdict: hit.verdict,
    decisionId: hit.decisionA,
    otherDecisionId: hit.decisionB,
    premiseId: null,
    explanation: hit.explanation,
    diagnostic: null,
    deterministic: true,
  };
}

function fromPremise(hit: PremiseInvalidation): GateFinding {
  return {
    gate: "premise",
    verdict: hit.verdict,
    decisionId: hit.decisionId,
    otherDecisionId: null,
    premiseId: hit.premiseId,
    explanation: hit.explanation,
    diagnostic: null,
    deterministic: true,
  };
}

function fromSemantic(hit: SemanticHit): GateFinding {
  return {
    gate: "semantic",
    verdict: hit.verdict,
    decisionId: hit.decisionA,
    otherDecisionId: hit.decisionB,
    premiseId: null,
    explanation: hit.explanation,
    diagnostic: hit.diagnostic,
    deterministic: false,
  };
}

/**
 * One finding per (decision, gate) pair.
 *
 * A decision can be invalidated by two premises at once, and both matter — but the
 * same premise reported twice through two justifications is one fact, not two, and
 * counting it twice would double the cascade and double the proposal.
 */
function dedupe(findings: readonly GateFinding[]): readonly GateFinding[] {
  const seen = new Set<string>();
  const out: GateFinding[] = [];

  for (const finding of findings) {
    const key = [
      finding.gate,
      finding.decisionId,
      finding.otherDecisionId ?? "",
      finding.premiseId ?? "",
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeRun(run: GateRun): string {
  if (!run.anyFired) {
    return [
      "no gate fired",
      `${run.structural.length} structural · ${run.premise.length} premise · ${run.semantic.hits.length} semantic`,
      run.semantic.available ? "" : "gate (b) unavailable",
      `${run.durationMs} ms`,
    ]
      .filter((part) => part.length > 0)
      .join(" · ");
  }

  const parts: string[] = [];
  if (run.structural.length > 0) {
    parts.push(`${run.structural.length} structural (deterministic, no model)`);
  }
  if (run.premise.length > 0) {
    const outList = run.premise.filter((p) => p.clause === "out-list").length;
    parts.push(
      `${run.premise.length} premise invalidation${run.premise.length === 1 ? "" : "s"}${outList > 0 ? `, ${outList} of them an excluded condition that arrived` : ""}`,
    );
  }
  if (run.semantic.hits.length > 0) parts.push(`${run.semantic.hits.length} semantic`);
  parts.push(`${run.durationMs} ms`);

  return parts.join(" · ");
}

/**
 * What ran and what did not, for the health panel.
 *
 * A gate that is unavailable must be reported as unavailable. Silence is
 * indistinguishable from "found nothing", and a user who reads silence as safety will
 * not go looking for the semantic contradictions that gate (b) would have caught.
 */
export function describeAvailability(run: GateRun): string {
  return [
    "gate (a) structural — available, deterministic, always runs",
    "gate (c) premise — available, deterministic, always runs",
    run.semantic.available
      ? `gate (b) semantic — available, considered ${run.semantic.pairsConsidered} candidate pairs`
      : `gate (b) semantic — UNAVAILABLE: ${run.semantic.unavailableReason}`,
  ].join("\n");
}

/** The findings for one decision, in gate order. A decision hit by both (a) and (c)
 *  gets both, because they have different remedies. */
export function findingsFor(run: GateRun, decisionId: DecisionId): readonly GateFinding[] {
  return run.findings.filter((finding) => finding.decisionId === decisionId);
}

/** Findings that came from a deterministic gate. Shown first: they are the ones the
 *  user can verify without forming an opinion about a model. */
export function deterministicFindings(run: GateRun): readonly GateFinding[] {
  return run.findings.filter((finding) => finding.deterministic);
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export { detectStructural, detectPremiseInvalidation, detectSemantic };
export type { StructuralHit, PremiseInvalidation, SemanticHit, GateBResult, CandidatePair };
