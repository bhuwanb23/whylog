/**
 * Rejected-alternative pre-emption — 3.6 / 3.10.
 *
 * Phase 3 · sub-phases 3.6, 3.10
 * Plan: plan/phase-3-retrieval.md §3.10
 *
 * ---------------------------------------------------------------------------
 * THE HIGHEST-VALUE SENTENCE THE RETRIEVAL LAYER CAN PRODUCE
 *
 *   "You're asking about Supabase. You REJECTED it on 3 Oct — reason: hosted dependency,
 *    no budget. That rejection rests on P-0004 (budget = none), which is still IN.
 *    Has that changed?"
 *
 * Everything else in this layer answers a question that was asked. This one answers the
 * question that SHOULD have been asked, and it catches the mistake BEFORE the decision
 * rather than after — which is the entire difference between a memory and an immune system.
 *
 * It is only possible because alternatives are indexed first-class (Phase 1.5). A tool that
 * stores decisions and not the things it turned down cannot produce this sentence at any
 * retrieval quality.
 *
 * ---------------------------------------------------------------------------
 * ONLY CONFIRMED REJECTIONS WITH A REASON
 *
 * §3.10's contract, and the reason this is not spam. An alternative enters the pre-emption
 * index only when it has a `whyRejected` AND explicit human confirmation, because **a false
 * pre-emption is worse than no pre-emption**: telling a user they already rejected something
 * they merely discussed, and then being wrong about why, destroys trust in every correct
 * pre-emption that follows.
 *
 * An alternative with no `whyRejected` is stored but never pre-empts. Phase 1 made that a
 * rule; this is where it pays off.
 *
 * ---------------------------------------------------------------------------
 * `stillHolds` IS THE POINT
 *
 * The notice says whether the reason still holds, by checking the LIVE LABELS of the
 * premises the rejection rests on. A rejection whose premises are all still IN is a reason
 * not to revisit; a rejection resting on a premise that has since gone OUT is an invitation
 * to. Without that check the notice is a nag. With it, it is a question worth answering.
 * ---------------------------------------------------------------------------
 */

import { foldKey } from "@/ontology/canonicalize";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { PreemptionNotice } from "@/types/retrieval";
import { isClassifiable } from "./contradiction";

/* -------------------------------------------------------------------------- */
/* Detection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Does this query match a REJECTED alternative rather than an accepted decision?
 *
 * Matching is lexical and exact — the alternative's canonical value folded against the
 * query's folded tokens. Not semantic: a pre-emption that fires on a vague topical match is
 * a false pre-emption, and the cost of one is higher than the cost of missing one.
 */
export function findPreemptions(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  query: string,
  queryTerms: readonly string[],
): readonly PreemptionNotice[] {
  const foldedQuery = foldKey(query);
  const foldedTerms = new Set(queryTerms.map((term) => foldKey(term)));
  const out: PreemptionNotice[] = [];

  for (const alternative of state.alternatives.values()) {
    /* §3.10 requires BOTH conditions, and this is the contract's whole point:
     *
     *   a `whyRejected`, because "you rejected this" without a reason is just nagging; and
     *   `confirmedByHuman`, because a rejection the model inferred was never a rejection the
     *   user made.
     *
     * Phase 1 measured alternatives at 15.4% precision. On that base rate, an unconfirmed
     * inferred rejection is far more likely to be wrong than right, and a false pre-emption
     * — telling someone they already rejected something they merely discussed, with a reason
     * they never gave — costs more trust than every correct pre-emption in the session earns
     * back. Missing one is a small loss; inventing one is why the feature gets switched off.
     */
    if (alternative.whyRejected === undefined || alternative.whyRejected.length === 0) continue;
    if (!alternative.confirmedByHuman) continue;

    const decision = state.decisions.get(alternative.decisionId);
    if (decision === undefined) continue;

    /* Only a rejection made by a LIVE decision counts. Pre-empting on the basis of a
     * superseded or proposed one would cite a reason the log has already withdrawn — or one
     * it never adopted. `isClassifiable` is the same predicate the classifier uses, so a
     * decision the classifier refuses to judge cannot pre-empt either. */
    if (!isClassifiable(decision.status)) continue;

    const canonical = foldKey(alternative.value);
    const matched =
      foldedQuery.includes(canonical) ||
      [...foldedTerms].some(
        (term) => term.length > 2 && (canonical.includes(term) || term.includes(canonical)),
      );

    if (!matched) continue;

    const restsOn = restsOnFor(state, labels, decision.id);

    out.push({
      alternativeValue: alternative.value,
      rejectedByDecisionId: decision.id,
      whyRejected: alternative.whyRejected,
      rejectedAt: decision.temporal.valid,
      restsOn,
      stillHolds: restsOn.length > 0 && restsOn.every((entry) => entry.label === "IN"),
    });
  }

  /* Most recently rejected first: the freshest rejection is the one most likely to be the
   * one the user is about to repeat. */
  out.sort((a, b) => (a.rejectedAt < b.rejectedAt ? 1 : a.rejectedAt > b.rejectedAt ? -1 : 0));

  return out;
}

function restsOnFor(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): readonly { premiseId: PremiseId; text: string; label: DecisionLabel }[] {
  const out: { premiseId: PremiseId; text: string; label: DecisionLabel }[] = [];
  const seen = new Set<PremiseId>();

  for (const justification of state.justifications.values()) {
    if (justification.consequent !== decisionId) continue;
    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      out.push({
        premiseId,
        text: premise.text,
        label: labels.get(premiseId)?.label ?? premise.label,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* The sentence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The pre-emption, as the user reads it.
 *
 * Leads with the fact that this was REJECTED, then the reason, then whether the reason still
 * holds, then the question. That order matters: the question last is what makes it a
 * question rather than a verdict, and a verdict here would be the system telling the user
 * they are wrong about their own project.
 */
export function renderPreemption(notice: PreemptionNotice): string {
  const decided = notice.rejectedAt.slice(0, 10);
  const premises =
    notice.restsOn.length === 0
      ? "It rests on no recorded premise, so there is nothing to check it against."
      : notice.restsOn
          .map((entry) => entry.premiseId + ' "' + entry.text + '" (' + entry.label + ")")
          .join(", ");

  const status = notice.stillHolds
    ? "That reason still holds — every premise it rests on is still IN."
    : "At least one premise it rests on is no longer IN, so the reason may have expired.";

  return [
    "You are asking about " +
      notice.alternativeValue +
      ". You REJECTED it on " +
      decided +
      " in " +
      notice.rejectedByDecisionId +
      ".",
    "Reason: " + notice.whyRejected,
    "It rests on " + premises + ".",
    status,
    notice.stillHolds
      ? "Has anything changed since then?"
      : "This is worth revisiting: the condition that made it wrong may no longer hold.",
  ].join(" ");
}

/** How many alternatives are pre-emption eligible — both §3.10 conditions met. The gap
 *  between this and the total alternative count is what Phase 1's 15.4% precision costs,
 *  and showing it is more honest than showing a pre-emption feature that never fires. */
export function countPreemptions(state: GraphState): {
  eligible: number;
  total: number;
  missingReason: number;
  unconfirmed: number;
} {
  let eligible = 0;
  let total = 0;
  let missingReason = 0;
  let unconfirmed = 0;

  for (const alternative of state.alternatives.values()) {
    total += 1;
    const hasReason = alternative.whyRejected !== undefined && alternative.whyRejected.length > 0;
    if (!hasReason) missingReason += 1;
    else if (!alternative.confirmedByHuman) unconfirmed += 1;
    else eligible += 1;
  }

  return { eligible, total, missingReason, unconfirmed };
}

/** Whether the answer should LEAD with the pre-emption rather than bury it.
 *  A rejection whose premises have expired always leads — that is the case the user most
 *  needs to see and the one most likely to be scrolled past. */
export function leadsTheAnswer(notice: PreemptionNotice): boolean {
  return !notice.stillHolds;
}

export type { ISODateString };
