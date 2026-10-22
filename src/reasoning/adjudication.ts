/**
 * Adjudication — 2.8.
 *
 * Phase 2 · sub-phase 2.8
 * Plan: plan/phase-2-truth-maintenance.md §2.8
 * Docs: docs/02-truth-maintenance-theory.md §3.5
 *
 * ---------------------------------------------------------------------------
 * THE POSTULATE WE REFUSE
 *
 * AGM belief revision includes Success: when new information arrives, it is accepted.
 * Every textbook treatment assumes it, and most implementations inherit it.
 *
 * It is wrong here. WhyLog's inputs are EXTRACTED PROSE from transcripts of
 * conversations with language models. If Success held, any passing remark — "yeah
 * maybe we should use Postgres after all" said while thinking aloud — could retract a
 * decision that took three days and six guards to make. A noisy input stream must not
 * be able to corrupt a well-founded log.
 *
 * So we use Hansson's NON-PRIORITIZED revision: the newcomer is screened against what
 * it contradicts, and it may be REFUSED.
 *
 * ---------------------------------------------------------------------------
 * THE SCREEN
 *
 *   The newcomer is accepted only if it OUTRANKS EVERY contradictor.
 *
 * Not "outranks the weakest". Not "outranks on average". Every one — because accepting
 * it means retracting all of them, and a single incumbent that is more entrenched than
 * the newcomer makes that trade a loss.
 *
 * When it fails, the newcomer goes to the CONTESTED queue. It is never silently
 * dropped and never silently applied. Silently dropping it loses information the user
 * may have meant; silently applying it corrupts the log. The queue is the third option
 * and it is surfaced as the `contest` review action.
 *
 * ---------------------------------------------------------------------------
 * WHAT "CONTRADICTOR" MEANS
 *
 * A decision on the same variable whose value is an antonym of the newcomer's, per the
 * ontology. That is the same test gate (a) uses, so the adjudicator and the detector
 * cannot disagree about what counts as a conflict — a disagreement there would produce
 * the worst possible failure: retracting something the system never claimed contradicted
 * anything.
 * ---------------------------------------------------------------------------
 */

import { areAntonyms, canonicalValueOf } from "@/ontology";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { Decision, DecisionOrigin, DecisionVariable } from "@/types/domain";
import type { AdjudicationOutcome, EntrenchmentBreakdown } from "@/types/reasoning";
import { type GuardStatus, entrenchmentOf } from "./entrenchment";

/* -------------------------------------------------------------------------- */
/* The newcomer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Information arriving from outside the log.
 *
 * Not a decision yet — it has no id, no event, no provenance beyond what is given
 * here. Adjudication decides whether it becomes one.
 */
export interface Newcomer {
  readonly variable: DecisionVariable;
  readonly value: string;
  /** What was said, verbatim. Quoted back in the refusal so the user can check that
   *  the system understood them. */
  readonly text: string;
  readonly origin: DecisionOrigin;
  readonly confidence: number;
  /** Valid time of the observation. Defaults to now. */
  readonly observedAt?: string;
  readonly source?: "transcript" | "guard" | "human" | "repo-scan";
}

export interface AdjudicationInput {
  readonly newcomer: Newcomer;
  readonly now: number;
  /** Guard status per decision, from Phase 4. Absent => implementation cost unknown. */
  readonly guards?: ReadonlyMap<DecisionId, GuardStatus>;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Screen a newcomer against everything it contradicts.
 *
 * Pure: reads the graph, computes entrenchments, returns a verdict. Commits nothing —
 * the cycle in `revise.ts` owns event creation, and an adjudicator that wrote to the
 * log could not be reasoned about.
 */
export function adjudicate(
  state: GraphState,
  input: AdjudicationInput,
): AdjudicationOutcome & { readonly considered: readonly DecisionId[] } {
  const contradictors = findContradictors(state, input.newcomer);
  const considered = contradictorIds(contradictors);

  if (contradictors.length === 0) return { kind: "none", considered };

  const newcomerScore = scoreNewcomer(input.newcomer);

  /* Score every contradictor once. Both branches below need the full set: the refusal
   * names the MOST entrenched blocker, and acceptance retracts WEAKEST-FIRST. */
  const scored = contradictors.map((contradictor) => ({
    ...contradictor,
    breakdown: entrenchmentOf(
      state,
      contradictor.decisionId,
      input.now,
      input.guards?.get(contradictor.decisionId),
    ),
  }));

  const blockers = scored.filter((entry) => entry.breakdown.capped >= newcomerScore);

  if (blockers.length > 0) {
    const blocker = blockers.reduce((best, entry) =>
      entry.breakdown.capped > best.breakdown.capped ? entry : best,
    );
    return {
      kind: "reject-newcomer",
      why: explainRefusal(state, input.newcomer, blocker, newcomerScore),
      blockingDecisionId: blocker.decisionId,
      newcomerEntrenchment: round4(newcomerScore),
      incumbentEntrenchment: blocker.breakdown.capped,
      considered,
    };
  }

  /* The newcomer outranks every contradictor. Weakest-first is the retraction order:
   * give up the cheapest belief first and stop as soon as the conflict is resolved. */
  const retract = [...scored]
    .sort((a, b) => a.breakdown.capped - b.breakdown.capped)
    .map((entry) => entry.decisionId);

  return { kind: "apply", retract, considered };
}

/* -------------------------------------------------------------------------- */
/* Finding contradictors                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every IN-labelled decision on the same variable with an antonym value.
 *
 * Same-variable alone is not contradiction: "use SQLite" and "use SQLite with WAL"
 * are a refinement, and treating refinements as conflicts would fire on almost every
 * log. The antonym test is what separates "changed your mind" from "added detail".
 *
 * Only IN-labelled decisions count. An OUT or UNSOUND incumbent is already retracted;
 * refusing a newcomer because it contradicts something the log has given up would be
 * absurd.
 */
/** One incumbent the newcomer contradicts, with the ontology rule that says so. */
export interface Contradictor {
  readonly decisionId: DecisionId;
  /** The antonym-table reason, verbatim. Shown to the user; never paraphrased. */
  readonly why: string;
}

export function findContradictors(state: GraphState, newcomer: Newcomer): readonly Contradictor[] {
  const canonicalNew = canonicalValueOf(newcomer.variable, newcomer.value);
  const out: Contradictor[] = [];

  for (const decision of state.decisions.values()) {
    if (decision.variable !== newcomer.variable) continue;
    if (decision.label !== "IN") continue;

    const canonicalIncumbent = canonicalValueOf(decision.variable, decision.value);
    if (canonicalIncumbent === canonicalNew) continue;

    const verdict = areAntonyms(decision.variable, canonicalIncumbent, canonicalNew);
    if (verdict.antonym) out.push({ decisionId: decision.id, why: verdict.why });
  }

  return out;
}

/** Just the ids, for callers that only need the set. */
export function contradictorIds(contradictors: readonly Contradictor[]): readonly DecisionId[] {
  return contradictors.map((entry) => entry.decisionId);
}

/* -------------------------------------------------------------------------- */
/* Scoring something that is not in the log yet                               */
/* -------------------------------------------------------------------------- */

/**
 * The entrenchment a newcomer WOULD have if it were accepted.
 *
 * It cannot be looked up — it has no corroboration, no justifications, no guards. So
 * it is scored on the two terms it does have, and penalised on the two it cannot have:
 *
 *   · source authority — from `origin`, same table as an incumbent
 *   · confidence — from the extraction or the human
 *   · corroboration — ZERO. One observation is one observation. This is the term that
 *     stops a single remark from outranking a decision three sources agree on.
 *   · implementation cost — ZERO. Nothing is built on it yet, so it costs nothing to
 *     give up. Symmetric with corroboration: the newcomer is cheap in both directions.
 *   · recency — full score. It just arrived.
 *
 * The asymmetry is deliberate and it is the whole mechanism: an incumbent has had time
 * to accumulate corroboration and guards; a newcomer has had time to accumulate
 * nothing. New information wins on freshness and loses on everything else, which is
 * exactly the trade-off Hansson's screening is meant to make explicit.
 */
export function scoreNewcomer(newcomer: Newcomer): number {
  const authority = authorityOf(newcomer.origin);

  const w = WEIGHTS;
  const score =
    w.sourceAuthority * authority +
    w.implementationCost * 0 +
    w.corroboration * 0 +
    w.confidence * clamp01(newcomer.confidence) +
    w.recency * 1;

  return round4(score);
}

const WEIGHTS = {
  sourceAuthority: 0.3,
  implementationCost: 0.2,
  corroboration: 0.2,
  confidence: 0.15,
  recency: 0.15,
} as const;

function authorityOf(origin: Newcomer["origin"]): number {
  const table: Record<string, number> = {
    human_stated: 1.0,
    human_override: 0.9,
    agent_proposed_human_accepted: 0.8,
    agent_inferred: 0.4,
  };
  return table[origin] ?? 0.4;
}

/* -------------------------------------------------------------------------- */
/* The refusal, in words                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Why the newcomer was refused.
 *
 * This text is shown to the user verbatim and is the difference between a system that
 * looks arbitrary and one that looks principled. It names the blocking decision, both
 * scores, the term that decided it, and — critically — what would change the answer.
 * A refusal with no path to overturning it is just a veto.
 */
export function explainRefusal(
  state: GraphState,
  newcomer: Newcomer,
  blocker: Contradictor & { readonly breakdown: EntrenchmentBreakdown },
  newcomerScore: number,
): string {
  const blockingId = blocker.decisionId;
  const blocking: Decision | undefined = state.decisions.get(blockingId);
  const blockingName =
    blocking === undefined ? blockingId : `${blockingId} "${blocking.statement}"`;

  return [
    `Refused: "${newcomer.text}" would contradict ${blockingName}.`,
    blocker.why,
    `The newcomer scores ${newcomerScore.toFixed(2)}; the incumbent scores ${blocker.breakdown.capped.toFixed(2)}.`,
    `The newcomer has one observation, no corroboration and nothing built on it. ${blockingName} has had time to accumulate both.`,
    `What decides it: ${dominantTerm(state, blockingId)}.`,
    "This is a refusal, not a deletion — it is in the Contested queue.",
    `To overturn it: retract or weaken ${blockingId} first, or record this as a human override, which outranks everything.`,
  ].join(" ");
}

/** The single term contributing most to the incumbent's score, named in plain words. */
function dominantTerm(state: GraphState, decisionId: DecisionId): string {
  const breakdown = entrenchmentOf(state, decisionId, Date.now());
  const c = breakdown.components;
  const w = breakdown.weights;

  const contributions: { readonly name: string; readonly amount: number }[] = [
    {
      name: `who stated it (${c.sourceAuthority.toFixed(2)})`,
      amount: w.sourceAuthority * c.sourceAuthority,
    },
    {
      name: `how many sources agree (${c.corroboration.toFixed(2)})`,
      amount: w.corroboration * c.corroboration,
    },
    {
      name: `extraction confidence (${c.confidence.toFixed(2)})`,
      amount: w.confidence * c.confidence,
    },
    { name: `how recent it is (${c.recency.toFixed(2)})`, amount: w.recency * c.recency },
  ];

  if (!breakdown.implementationCostUnknown) {
    contributions.push({
      name: `how much is built on it (${c.implementationCost.toFixed(2)} of guards passing)`,
      amount: w.implementationCost * c.implementationCost,
    });
  }

  let best = contributions[0];
  for (const entry of contributions) {
    if (best !== undefined && entry.amount > best.amount) best = entry;
  }

  return best?.name ?? "no term dominated";
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Human-readable form of a screening result, for the audit trail. */
export function describeOutcome(outcome: AdjudicationOutcome): string {
  switch (outcome.kind) {
    case "none":
      return "Nothing in the log contradicts this. Accepted without screening.";
    case "apply":
      return `Accepted. Retracting weakest-first: ${outcome.retract.join(", ")}.`;
    case "reject-newcomer":
      return outcome.why;
  }
}
