/**
 * The JTMS labeller ΓÇö 2.2.
 *
 * Phase 2 ┬╖ sub-phase 2.2
 * Plan: plan/phase-2-truth-maintenance.md ┬º2.2
 * Research: docs/02 ┬º2 (Doyle 1979), ┬º3 (validity + well-foundedness)
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * A node is IN iff at least one of its justifications is VALID, and a justification
 * is valid iff **every node in its IN-list is IN and no node in its OUT-list is IN**.
 *
 * That second clause is the whole product. A justification with a non-empty OUT-list
 * is Doyle's NON-MONOTONIC justification, and it is what lets WhyLog notice that a
 * decision stopped being true when nobody contradicted anything: the world satisfied
 * an excluded condition, the justification became invalid, and the decision lost its
 * support.
 *
 * ---------------------------------------------------------------------------
 * WHY WELL-FOUNDEDNESS IS CHECKED AND NOT ASSUMED
 *
 * Doyle's own words: it is "imprudentΓÇª nodes believed on tenuous circular bases lead
 * to ill-considered actions." A justification graph may legally contain G ΓçÆ H ΓçÆ G,
 * and a naive fixpoint labels both IN forever. An LLM extractor WILL produce this ΓÇö
 * it recovers "we chose X because Y" and "we chose Y because X" from the same
 * conversation without noticing.
 *
 * So a node whose support never reaches a premise is labelled **UNFOUNDED**, which is
 * a data-quality warning and NOT a truth claim. It is never silently IN, because a
 * circularly-supported decision that reads as sound is worse than one that reads as
 * broken: the broken one gets fixed.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 *
 * It reads a `GraphState` and returns a label map. It writes nothing and appends no
 * events ΓÇö `revise.ts` decides what to record. A labeller with side effects cannot
 * be iterated to a fixpoint, and cannot be run speculatively to answer "what would
 * happen if this premise died?", which is what the proposal preview needs.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, JustificationId, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import type { Justification } from "@/types/domain";

export type NodeId = DecisionId | PremiseId;

/** A label plus the reason for it. The reason is not decoration: the review UI
 *  shows WHY a node is OUT, naming the specific premise that failed, because
 *  "unsound" without a cause is not actionable. */
export interface Labelled {
  readonly label: DecisionLabel;
  readonly reason: LabelReason;
}

export type LabelReason =
  | { readonly kind: "valid-justification"; readonly justificationId: JustificationId }
  | { readonly kind: "all-justifications-invalid"; readonly failedPremiseId: PremiseId | null }
  | { readonly kind: "no-justification" }
  | { readonly kind: "circular"; readonly cycle: readonly NodeId[] }
  | { readonly kind: "unfounded"; readonly reachedOnly: readonly NodeId[] }
  | { readonly kind: "asserted-premise" }
  | { readonly kind: "unconfirmed-premise" }
  | { readonly kind: "invalidated"; readonly at: string };

export interface LabellingResult {
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  /** Decisions whose label CHANGED against the state that was passed in. This is
   *  what `revise.ts` turns into `LabelChanged` events, and what makes the audit
   *  trail per-flip rather than per-run. */
  readonly changed: readonly { readonly id: DecisionId; readonly from: DecisionLabel; readonly to: DecisionLabel; readonly reason: LabelReason }[];
  readonly iterations: number;
  readonly unfounded: readonly DecisionId[];
  readonly fixpointReached: boolean;
}

/** Hard ceiling on fixpoint iterations. The graph is shallow ΓÇö depth rarely exceeds
 *  4 ΓÇö so a label propagation that has not settled in this many passes is cycling,
 *  and cycling is a bug worth surfacing rather than hiding behind a spin. */
export const MAX_ITERATIONS = 64;

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function label(state: GraphState): LabellingResult {
  const labels = new Map<NodeId, Labelled>();

  /* ---- premises are the foundation: they are IN by assertion, not by argument ---- */
  for (const premise of state.premises.values()) {
    if (premise.temporal.invalidFrom !== undefined) {
      labels.set(premise.id, {
        label: "OUT",
        reason: { kind: "invalidated", at: premise.temporal.invalidFrom },
      });
      continue;
    }
    labels.set(premise.id, {
      label: premise.label === "UNKNOWN" ? "UNKNOWN" : premise.label,
      reason: premise.label === "UNKNOWN"
        ? { kind: "unconfirmed-premise" }
        : { kind: "asserted-premise" },
    });
  }

  /* ---- decisions start from their stored label and are corrected below ---- */
  for (const decision of state.decisions.values()) {
    labels.set(decision.id, { label: decision.label, reason: { kind: "no-justification" } });
  }

  /* ---- well-foundedness first: a circular node can never become IN, and
         letting the fixpoint see it as a candidate would propagate the cycle ---- */
  const founded = wellFoundedness(state);
  for (const [id, problem] of founded.problems) {
    labels.set(id, {
      label: "UNFOUNDED",
      reason: problem.kind === "circular"
        ? { kind: "circular", cycle: problem.cycle }
        : { kind: "unfounded", reachedOnly: problem.reachedOnly },
    });
  }

  /* ---- fixpoint ---- */
  let iterations = 0;
  let dirty = true;

  while (dirty && iterations < MAX_ITERATIONS) {
    dirty = false;
    iterations += 1;

    for (const decision of state.decisions.values()) {
      // An UNFOUNDED label is a statement about the SHAPE of the support graph, and
      // no amount of relabelling its neighbours changes that shape. Overwriting it
      // here would let a circular decision flicker back to IN on the next pass.
      if (labels.get(decision.id)?.label === "UNFOUNDED") continue;
      if (decision.status === "superseded" || decision.status === "archived") continue;

      const next = labelDecision(decision.id, decision.justificationIds, state, labels);
      const previous = labels.get(decision.id);
      if (previous === undefined || previous.label !== next.label) {
        labels.set(decision.id, next);
        dirty = true;
      }
    }
  }

  /* ---- diff against the stored labels ---- */
  const changed: LabellingResult["changed"][number][] = [];
  for (const decision of state.decisions.values()) {
    const next = labels.get(decision.id);
    if (next === undefined) continue;
    if (next.label === decision.label) continue;
    changed.push({ id: decision.id, from: decision.label, to: next.label, reason: next.reason });
  }

  const unfounded: DecisionId[] = [];
  for (const id of founded.problems.keys()) unfounded.push(id as DecisionId);

  return { labels, changed, iterations, unfounded, fixpointReached: !dirty };
}

/* -------------------------------------------------------------------------- */
/* One decision                                                               */
/* -------------------------------------------------------------------------- */

function labelDecision(
  id: DecisionId,
  justificationIds: readonly JustificationId[],
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): Labelled {
  if (justificationIds.length === 0) {
    // A decision with no justification is not unsound, it is UNVERIFIED. Calling it
    // OUT would retract every manually recorded decision in the log, and calling it
    // IN would assert something nothing supports.
    return { label: "UNKNOWN", reason: { kind: "no-justification" } };
  }

  let firstFailure: PremiseId | null = null;

  for (const justificationId of justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    const verdict = validityOf(justification, labels);
    if (verdict.valid) return { label: "IN", reason: { kind: "valid-justification", justificationId } };
    if (firstFailure === null) firstFailure = verdict.failedNode;
  }

  return { label: "OUT", reason: { kind: "all-justifications-invalid", failedPremiseId: firstFailure } };
}

export interface ValidityVerdict {
  readonly valid: boolean;
  /** The specific node that broke it ΓÇö an IN-list member that is not IN, or an
   *  OUT-list member that IS. Naming it is what makes the failure actionable. */
  readonly failedNode: PremiseId | null;
  readonly failedClause: "in-list" | "out-list" | null;
  readonly explanation: string;
}

/**
 * Doyle's SL-justification validity, evaluated against a label map.
 *
 * Exported on its own because gate (c) needs it to say WHICH CLAUSE broke: an
 * IN-list failure means a supporting premise died, an OUT-list failure means an
 * excluded condition arrived. They read completely differently to a user and they
 * imply different revisions, but they invalidate the justification identically.
 */
export function validityOf(
  justification: Justification,
  labels: ReadonlyMap<NodeId, Labelled>,
): ValidityVerdict {
  for (const premiseId of justification.inList) {
    const entry = labels.get(premiseId);
    if (entry === undefined || entry.label !== "IN") {
      return {
        valid: false,
        failedNode: premiseId,
        failedClause: "in-list",
        explanation: `${justification.id} requires ${premiseId} to hold, and it is ${entry?.label ?? "missing from the graph"}.`,
      };
    }
  }

  for (const premiseId of justification.outList) {
    const entry = labels.get(premiseId);
    if (entry !== undefined && entry.label === "IN") {
      return {
        valid: false,
        failedNode: premiseId,
        failedClause: "out-list",
        explanation: `${justification.id} excludes ${premiseId}, and it now holds. Nothing was contradicted ΓÇö the world moved.`,
      };
    }
  }

  return { valid: true, failedNode: null, failedClause: null, explanation: `${justification.id} is valid.` };
}

/* -------------------------------------------------------------------------- */
/* Well-foundedness                                                           */
/* -------------------------------------------------------------------------- */

export type FoundingProblem =
  | { readonly kind: "circular"; readonly cycle: readonly NodeId[] }
  | { readonly kind: "unfounded"; readonly reachedOnly: readonly NodeId[] };

export interface WellFoundedness {
  readonly problems: ReadonlyMap<DecisionId, FoundingProblem>;
  readonly checked: number;
}

/**
 * Does every decision's support chain bottom out in a PREMISE?
 *
 * A premise is an assumption: it is IN because somebody observed it, not because
 * something else argued for it. A decision whose support only ever reaches other
 * decisions is believed on an argument with no ground, and Doyle's warning applies
 * directly.
 *
 * Depth-bounded, because the same traversal on a pathological graph could otherwise
 * run for as long as the graph is deep.
 */
export function wellFoundedness(state: GraphState): WellFoundedness {
  const problems = new Map<DecisionId, FoundingProblem>();
  const grounded = new Set<DecisionId>();

  for (const decision of state.decisions.values()) {
    if (decision.justificationIds.length === 0) continue;
    if (problems.has(decision.id) || grounded.has(decision.id)) continue;

    const path: NodeId[] = [];
    const onPath = new Set<NodeId>();
    const result = walk(decision.id, state, path, onPath, grounded, 0);

    if (result.kind === "grounded") grounded.add(decision.id);
    else problems.set(decision.id, result.problem);
  }

  return { problems, checked: state.decisions.size };
}

const FOUNDING_DEPTH_CAP = 12;

type WalkResult =
  | { readonly kind: "grounded" }
  | { readonly kind: "problem"; readonly problem: FoundingProblem };

function walk(
  node: NodeId,
  state: GraphState,
  path: NodeId[],
  onPath: Set<NodeId>,
  grounded: ReadonlySet<DecisionId>,
  depth: number,
): WalkResult {
  // A premise IS the ground. Reaching one means the chain is founded.
  if (state.premises.has(node as PremiseId)) return { kind: "grounded" };

  if (onPath.has(node)) {
    const start = path.indexOf(node);
    return { kind: "problem", problem: { kind: "circular", cycle: [...path.slice(start), node] } };
  }
  if (depth >= FOUNDING_DEPTH_CAP) {
    return { kind: "problem", problem: { kind: "unfounded", reachedOnly: [...path] } };
  }
  if (grounded.has(node as DecisionId)) return { kind: "grounded" };

  const decision = state.decisions.get(node as DecisionId);
  if (decision === undefined) return { kind: "problem", problem: { kind: "unfounded", reachedOnly: [...path] } };
  if (decision.justificationIds.length === 0) {
    // No justification and not a premise: nothing grounds it.
    return { kind: "problem", problem: { kind: "unfounded", reachedOnly: [...path, node] } };
  }

  path.push(node);
  onPath.add(node);

  let sawAny = false;
  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    // An OUT-list member does not ground anything: it is a condition that must NOT
    // hold, so reaching one is not evidence for the decision.
    for (const antecedent of justification.inList) {
      sawAny = true;
      const result = walk(antecedent, state, path, onPath, grounded, depth + 1);
      if (result.kind === "grounded") {
        path.pop();
        onPath.delete(node);
        return { kind: "grounded" };
      }
      if (result.problem.kind === "circular") {
        path.pop();
        onPath.delete(node);
        return result;
      }
    }
  }

  path.pop();
  onPath.delete(node);

  if (!sawAny) return { kind: "problem", problem: { kind: "unfounded", reachedOnly: [node] } };
  return { kind: "problem", problem: { kind: "unfounded", reachedOnly: [...path, node] } };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export const LABEL_MEANING: Readonly<Record<DecisionLabel, string>> = {
  IN: "Sound ΓÇö at least one justification is valid and well-founded",
  OUT: "Unsound ΓÇö every justification is invalid",
  UNKNOWN: "Unverified ΓÇö nothing has confirmed or refuted the premises",
  UNFOUNDED: "Unfounded ΓÇö the support chain is circular or never reaches a premise. A data-quality warning, not a truth claim",
};

export function describeReason(reason: LabelReason, state: GraphState): string {
  switch (reason.kind) {
    case "valid-justification":
      return `${reason.justificationId} is valid: every premise it requires holds and nothing it excludes does.`;
    case "all-justifications-invalid":
      return reason.failedPremiseId === null
        ? "Every justification is invalid."
        : `Every justification is invalid. The first to fail did so on ${reason.failedPremiseId} ΓÇö "${state.premises.get(reason.failedPremiseId)?.text ?? "unknown premise"}".`;
    case "no-justification":
      return "No justification is attached, so nothing supports it and nothing refutes it.";
    case "circular":
      return `Circular support: ${reason.cycle.join(" ΓåÆ ")}. Believed on an argument with no ground.`;
    case "unfounded":
      return `The support chain never reaches a premise (reached: ${reason.reachedOnly.join(", ") || "nothing"}).`;
    case "asserted-premise":
      return "Asserted as a premise.";
    case "unconfirmed-premise":
      return "Neither confirmed nor refuted.";
    case "invalidated":
      return `Invalidated at ${reason.at}.`;
  }
}

export function describeLabelling(result: LabellingResult): string {
  const parts = [
    `${result.labels.size} nodes labelled in ${result.iterations} iteration${result.iterations === 1 ? "" : "s"}`,
  ];
  if (!result.fixpointReached) {
    parts.push(`DID NOT REACH A FIXPOINT within ${MAX_ITERATIONS} iterations ΓÇö this is a bug, not a graph property`);
  }
  if (result.changed.length > 0) {
    parts.push(`${result.changed.length} label${result.changed.length === 1 ? "" : "s"} changed`);
  }
  if (result.unfounded.length > 0) {
    parts.push(`${result.unfounded.length} UNFOUNDED ΓÇö circular or groundless support`);
  }
  return parts.join(" ┬╖ ");
}
