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
 * Whatever gate (a) says. `findContradictors` delegates to `wouldContradict` rather
 * than re-implementing a test, because an adjudicator with a narrower rule than the
 * detector produces the worst possible failure: gate (a) reports a structural
 * contradiction while adjudication declines to screen against it, so nothing is
 * retracted and the conflict is warned about but never resolved.
 *
 * Gate (a) fires on TWO conditions — a declared antonym pair, or simply two different
 * live values for one variable — and excludes superseded decisions and non-overlapping
 * validity windows. All four of those properties are inherited here by delegation.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { Decision, DecisionOrigin, DecisionVariable } from "@/types/domain";
import type { AdjudicationOutcome, EntrenchmentBreakdown } from "@/types/reasoning";
import { ENTRENCHMENT_WEIGHTS } from "@/types/reasoning";
import { type GuardStatus, entrenchmentOf } from "./entrenchment";
import { wouldContradict } from "./gates/structural";

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
      /* §2.8 requires the FULL breakdown of both sides in the Contested queue. Two
       * totals cannot show that the newcomer lost on corroboration and implementation
       * cost rather than on authority, and "override anyway" is only an informed choice
       * if the arithmetic is visible. */
      newcomerBreakdown: newcomerBreakdownOf(input.newcomer),
      incumbentBreakdown: blocker.breakdown,
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
/** One incumbent the newcomer contradicts, with the rule that says so. */
export interface Contradictor {
  readonly decisionId: DecisionId;
  /** The structural reason, verbatim from gate (a). Shown to the user; never paraphrased. */
  readonly why: string;
  /** `"antonym-pair"` when the ontology table named the conflict, `"different-value"`
   *  when the two are simply different live answers to one question. */
  readonly via: "antonym-pair" | "different-value";
}

/**
 * Every live decision the newcomer contradicts.
 *
 * This DELEGATES to gate (a) rather than re-implementing the test. That is not
 * tidiness, it is correctness: if the adjudicator used a narrower rule than the
 * detector — antonym pairs only, say — then a newcomer could be ACCEPTED while gate (a)
 * was simultaneously reporting a structural contradiction between it and an incumbent.
 * The system would retract nothing and warn about a conflict it had just declined to
 * adjudicate. One predicate, one answer, everywhere.
 *
 * `wouldContradict` also carries the two conditions the adjudicator must not lose:
 * superseded and archived decisions are excluded (a reversal is not a contradiction),
 * and validity windows must overlap (two decisions true at different times are a
 * history, not a conflict).
 */
export function findContradictors(state: GraphState, newcomer: Newcomer): readonly Contradictor[] {
  const hits = wouldContradict(state, newcomer.variable, newcomer.value);

  return hits.map((hit) => ({
    decisionId: hit.decisionA,
    why: hit.explanation,
    via: hit.via,
  }));
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
  return newcomerBreakdownOf(newcomer).total;
}

/**
 * The newcomer's breakdown, in the SAME shape as an incumbent's.
 *
 * Two terms are structurally zero and one is unknown, and the shape makes that visible
 * rather than hiding it inside a total:
 *
 *   · corroboration 0 — one observation is one observation
 *   · implementation cost 0 — nothing is built on it yet
 *   · recency 1 — it just arrived
 *
 * `implementationCostUnknown` is true here for a different reason than it is for an
 * unguarded incumbent: an incumbent's cost is UNMEASURED (a guard could exist later),
 * while a newcomer's is genuinely ZERO (nothing can be built on a decision that is not
 * in the log). Both render as "unknown" in the breakdown, and the explanation string is
 * what tells them apart.
 */
export function newcomerBreakdownOf(newcomer: Newcomer): EntrenchmentBreakdown {
  const authority = authorityOf(newcomer.origin);
  const confidence = clamp01(newcomer.confidence);
  const w = ENTRENCHMENT_WEIGHTS;

  const total =
    w.sourceAuthority * authority +
    w.implementationCost * 0 +
    w.corroboration * 0 +
    w.confidence * confidence +
    w.recency * 1;

  return {
    total: round4(total),
    capped: round4(total),
    /* No premises yet, so the EE3 cap has nothing to bind to. A newcomer resting on
     * premises gets capped once it is asserted and the cycle re-runs. */
    ee3CapApplied: false,
    components: {
      sourceAuthority: round4(authority),
      implementationCost: 0,
      corroboration: 0,
      confidence: round4(confidence),
      recency: 1,
    },
    weights: w,
    implementationCostUnknown: true,
  };
}

/** What an unguarded incumbent's unknown cost means, versus a newcomer's zero. */
export function describeNewcomerCost(): string {
  return [
    "implementation cost 0.00 — nothing is built on it yet, so it costs nothing to give up.",
    "corroboration 0.00 — one observation. This is the term that stops a single remark",
    "from outranking a decision three independent sources agree on.",
    "An incumbent's unknown cost is UNMEASURED (a guard could exist later); a newcomer's",
    "is genuinely ZERO. Both show as unknown in the breakdown, and only this note tells",
    "them apart.",
  ].join("\n");
}

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
    blocker.via === "different-value"
      ? "Note that the ontology has no antonym pair for these two values — they conflict because one variable cannot hold two live answers, not because the table says so."
      : "",
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
