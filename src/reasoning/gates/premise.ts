/**
 * Gate (c) — premise invalidation. 2.5. ★ THE DIFFERENTIATOR.
 *
 * Phase 2 · sub-phase 2.5
 * Plan: plan/phase-2-truth-maintenance.md §2.5
 * Research: docs/02 §2.1 (Doyle's non-monotonic justification),
 *           docs/05 §1.2 (Lehman's Principle of Software Uncertainty)
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS GATE WORTH MORE THAN THE OTHER TWO COMBINED
 *
 * Gates (a) and (b) require the user to SAY something inconsistent. Gate (c)
 * requires only that reality drift — which is what actually happens.
 *
 *     J-0007  ⟨ IN:  [P-0002 single-user, P-0005 no-deploy-infra]
 *               OUT: [P-0011 needs-concurrent-writers] ⟩  ⇒  WLD-0007 "SQLite"
 *
 *     six weeks later: "the sync worker writes while the UI writes"
 *       EXTRACT → premise assertion matching P-0011 by predicate
 *       ASSERT  → L(P-0011) := IN
 *       GATE (c)→ P-0011 ∈ OUT-list(J-0007) ⇒ J-0007 INVALID ⇒ WLD-0007 UNSOUND
 *
 * The user never mentioned SQLite. Never contradicted themselves. The decision is
 * unsound anyway — and this is the only gate that can see it.
 *
 * Lehman is the theoretical warrant: invalidation of assumptions is one of the
 * drivers of the need for continual software evolution. Every decision log stores
 * the decision. None stores the `given`, so none can notice when the `given` moves.
 *
 * ---------------------------------------------------------------------------
 * TWO FIRING CONDITIONS, ONE MECHANISM
 *
 *   IN-list falsified   a supporting premise stopped holding
 *   OUT-list satisfied  an excluded condition arrived      ← the non-monotonic case
 *
 * Both invalidate the justification identically, but they READ completely
 * differently and they imply different revisions, so `failedClause` is carried all
 * the way to the proposal. An IN-list failure says "your reason is gone"; an
 * OUT-list failure says "the thing you assumed away happened".
 *
 * ---------------------------------------------------------------------------
 * PRECISION DISCIPLINE
 *
 * Fires ONLY on resolved premise identity — an exact predicate match, or a merge
 * confirmed in review. NEVER on text similarity.
 *
 * A false premise resolution ("single user" merged with "single sign-on") produces a
 * confident, spectacular, entirely wrong cascade, and it is invisible in the output:
 * the proposal looks perfectly reasonable. Cross-type comparison is impossible by
 * construction (`premisePool` pre-filters), and this gate adds a second lock by
 * comparing predicate strings rather than embeddings.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, JustificationId, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import { type Labelled, type NodeId, validityOf } from "../labeller";

export type InvalidationClause = "in-list" | "out-list";

export interface PremiseInvalidation {
  readonly gate: "premise";
  readonly verdict: "premise-invalidation";
  readonly premiseId: PremiseId;
  readonly justificationId: JustificationId;
  readonly decisionId: DecisionId;
  readonly clause: InvalidationClause;
  /** What the premise says. Carried so the explanation can be built without a
   *  second graph lookup, and so the proposal cannot drift from the node. */
  readonly premiseText: string;
  readonly decisionStatement: string;
  readonly explanation: string;
}

export interface GateCResult {
  readonly invalidations: readonly PremiseInvalidation[];
  /** Decisions that lost ALL support, not just one justification. A decision with a
   *  second valid justification survives, and the difference is the whole point of
   *  storing more than one. */
  readonly becameUnsound: readonly DecisionId[];
  /** Premises whose assertion triggered something. One premise can invalidate
   *  several decisions, and the count is what makes "shared premises" visible. */
  readonly triggeringPremises: readonly PremiseId[];
  readonly checked: number;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every justification in the graph whose validity has broken.
 *
 * @param labels the labeller's output. Passed in rather than recomputed because
 *               gate (c) must see the SAME labels the fixpoint converged on — a
 *               gate that re-derives them can disagree with the labeller, and a
 *               disagreement between two parts of one cycle is untraceable.
 */
export function detectPremiseInvalidation(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): GateCResult {
  const invalidations: PremiseInvalidation[] = [];
  const triggering = new Set<PremiseId>();
  let checked = 0;

  for (const justification of state.justifications.values()) {
    checked += 1;

    const verdict = validityOf(justification, labels);
    if (verdict.valid) continue;
    if (verdict.failedNode === null || verdict.failedClause === null) continue;

    // Only a PREMISE can invalidate a justification. A decision in an IN-list is a
    // derived node, and its failure is handled by the cascade — reporting it here
    // too would double-count every flip.
    if (!state.premises.has(verdict.failedNode as PremiseId)) continue;

    const premise = state.premises.get(verdict.failedNode as PremiseId);
    const decision = state.decisions.get(justification.consequent);
    if (premise === undefined) continue;

    triggering.add(premise.id);

    invalidations.push({
      gate: "premise",
      verdict: "premise-invalidation",
      premiseId: premise.id,
      justificationId: justification.id,
      decisionId: justification.consequent,
      clause: verdict.failedClause,
      premiseText: premise.text,
      decisionStatement: decision?.statement ?? justification.consequent,
      explanation:
        verdict.failedClause === "out-list"
          ? outListExplanation(
              premise.id,
              premise.text,
              justification.consequent,
              decision?.statement,
            )
          : inListExplanation(
              premise.id,
              premise.text,
              justification.consequent,
              decision?.statement,
            ),
    });
  }

  /* ---- which decisions lost ALL support ---- */
  const becameUnsound: DecisionId[] = [];
  const affected = new Set(invalidations.map((i) => i.decisionId));

  for (const decisionId of affected) {
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;
    if (labels.get(decisionId)?.label === "OUT") becameUnsound.push(decisionId);
  }

  return {
    invalidations,
    becameUnsound,
    triggeringPremises: [...triggering],
    checked,
  };
}

/* -------------------------------------------------------------------------- */
/* The two explanations                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An IN-list premise died: the reason is gone.
 *
 * Wording matters here. "Premise P-0002 is no longer IN" is a statement about the
 * system; "the assumption that it is a single-user tool no longer holds" is a
 * statement about the project. Only the second one tells the user what to do.
 */
function inListExplanation(
  premiseId: PremiseId,
  premiseText: string,
  decisionId: DecisionId,
  statement?: string,
): string {
  return [
    `${decisionId}${statement === undefined ? "" : ` — "${statement}"`} rests on ${premiseId}: "${premiseText}".`,
    "That assumption no longer holds, so the decision has lost its reason.",
    "Nothing contradicted the decision; one of the things it was true GIVEN has stopped being true.",
  ].join(" ");
}

/**
 * An OUT-list condition arrived: the thing assumed away happened.
 *
 * This is the sentence no other tool can produce, and it is worth getting right —
 * it is the moment the product earns its existence.
 */
function outListExplanation(
  premiseId: PremiseId,
  premiseText: string,
  decisionId: DecisionId,
  statement?: string,
): string {
  return [
    `${decisionId}${statement === undefined ? "" : ` — "${statement}"`} was made on the condition that ${premiseId} would NOT happen: "${premiseText}".`,
    "That condition has now been met.",
    "Nobody contradicted the decision and nothing was reversed — the world moved into the space the decision assumed would stay empty.",
  ].join(" ");
}

/* -------------------------------------------------------------------------- */
/* What a single new assertion would invalidate                               */
/* -------------------------------------------------------------------------- */

/**
 * Preview: if this premise became IN, what would break?
 *
 * Used by the review UI BEFORE a commit, so the user can see the blast radius of the
 * premise they are about to accept. It is also the only way to answer "what would
 * happen if…" without writing anything, which is what makes the labeller's purity
 * worth the extra parameter threading.
 */
export function previewInvalidation(
  state: GraphState,
  premiseId: PremiseId,
  labels: ReadonlyMap<NodeId, Labelled>,
): readonly PremiseInvalidation[] {
  const simulated = new Map<NodeId, Labelled>(labels);
  simulated.set(premiseId, { label: "IN", reason: { kind: "asserted-premise" } });

  const out: PremiseInvalidation[] = [];

  for (const decisionId of state.premiseToDecisions.get(premiseId) ?? []) {
    const decision = state.decisions.get(decisionId);
    if (decision === undefined) continue;

    for (const justificationId of decision.justificationIds) {
      const justification = state.justifications.get(justificationId);
      if (justification === undefined) continue;

      const verdict = validityOf(justification, simulated);
      if (verdict.valid || verdict.failedNode === null || verdict.failedClause === null) continue;
      if (verdict.failedNode !== premiseId) continue;

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      out.push({
        gate: "premise",
        verdict: "premise-invalidation",
        premiseId,
        justificationId,
        decisionId,
        clause: verdict.failedClause,
        premiseText: premise.text,
        decisionStatement: decision.statement,
        explanation:
          verdict.failedClause === "out-list"
            ? outListExplanation(premiseId, premise.text, decisionId, decision.statement)
            : inListExplanation(premiseId, premise.text, decisionId, decision.statement),
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/** How many decisions rest on each premise. The premise with the highest count is
 *  the one whose invalidation would hurt most, and it is worth showing BEFORE it
 *  fails rather than after. */
export function loadBearingPremises(
  state: GraphState,
  limit = 5,
): readonly { premiseId: PremiseId; decisions: number; text: string; label: DecisionLabel }[] {
  const out: { premiseId: PremiseId; decisions: number; text: string; label: DecisionLabel }[] = [];

  for (const [premiseId, decisions] of state.premiseToDecisions) {
    const premise = state.premises.get(premiseId);
    if (premise === undefined) continue;
    out.push({ premiseId, decisions: decisions.length, text: premise.text, label: premise.label });
  }

  return out
    .sort((a, b) => b.decisions - a.decisions || a.premiseId.localeCompare(b.premiseId))
    .slice(0, limit);
}

export function describeResult(result: GateCResult): string {
  if (result.invalidations.length === 0) {
    return `no premise invalidations — all ${result.checked} justifications still hold`;
  }

  const outList = result.invalidations.filter((i) => i.clause === "out-list").length;
  const inList = result.invalidations.length - outList;

  return [
    `${result.invalidations.length} broken justification${result.invalidations.length === 1 ? "" : "s"}`,
    `${inList} because a supporting premise died`,
    `${outList} because an excluded condition arrived`,
    `${result.becameUnsound.length} decision${result.becameUnsound.length === 1 ? "" : "s"} lost all support`,
    `${result.triggeringPremises.length} premise${result.triggeringPremises.length === 1 ? "" : "s"} triggered it`,
  ].join(" · ");
}

/**
 * The sentence that explains why this gate exists.
 *
 * Shown in the health panel and in the proposal footer, because gate (c) is the
 * claim the whole product rests on and it should be stated in words a user can
 * check against their own week.
 */
export function describeGate(): string {
  return [
    "Gate (c) does not look for contradictions.",
    "It looks for decisions whose assumptions stopped holding — the case where nobody said anything inconsistent and the decision became wrong anyway.",
    "It can only fire on a decision that was recorded WITH its premises, which is why Phase 1 recovers them and why every extracted premise goes through review.",
  ].join(" ");
}
