/**
 * The evidence contract — 3.7. ★
 *
 * Phase 3 · sub-phase 3.7
 * Plan: plan/phase-3-retrieval.md §3.7
 * Source: github.com/sophiatheofanidou/RepoRationale — the only prior art that binds an
 *         answer to a search budget and a citation-resolution rule.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE DIFFERENTIATED PART OF PHASE 3
 *
 * Retrieval is table stakes. Everyone ships it; agentmemory reports R@5 of 95.2% with
 * BM25 + vector + graph and RRF, and beating that number is not a hackathon project. What
 * almost nothing ships is a contract on the ANSWER:
 *
 *   1. A bounded number of searches — at most three, each recorded.
 *   2. A citation is valid ONLY if it points to a decision retrieved in THIS run.
 *   3. "Insufficient evidence" is a first-class answer, not an error and not a hedge.
 *   4. The run leaves a trace a reader can audit: what was searched, what came back, and
 *      why the search stopped.
 *
 * Together these make the answer FALSIFIABLE. Not "trust the model" and not "trust the
 * embedding" — here are the three searches, here are the citations, here is which ones
 * resolved, here is why it stopped. A reader who disagrees can point at the exact step.
 *
 * ---------------------------------------------------------------------------
 * THE BOUND IS NOT A PERFORMANCE OPTIMISATION
 *
 * Three searches is generous for a decision log of hundreds of entries; brute-force cosine
 * over that is sub-millisecond. The bound exists because an UNBOUNDED search converts "I
 * could not find it" into "I did not look hard enough yet" — and a system that can always
 * look again never has to say it does not know. The bound is what makes refusal reachable.
 *
 * `boundedOut` records the case where the budget ran out while the answer was still short of
 * evidence. That is a different situation from "searched and found nothing" and the
 * assessment says which one happened, because the remedy differs: the first needs a better
 * question, the second needs a better log.
 *
 * ---------------------------------------------------------------------------
 * THE CITATION-RESOLUTION RULE, STATED EXACTLY
 *
 *   A citation resolves iff the decision it names was retrieved in THIS run.
 *
 * Not "exists in the log". A model can name a decision id it has seen in context, or invent
 * one that happens to exist; neither has been checked against the claim it supports. Only
 * what this run actually retrieved has been read, scored and ranked, so only those ids count
 * as evidence. Anything else is rendered as an unresolved citation and reported in the
 * groundedness notes — never silently dropped, and never silently counted.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { Citation, Claim, IndexLevel, RunTrace, SearchStep } from "@/types/retrieval";

/** At most three searches per question. Mirrors `DEFAULT_MAX_SEARCH_STEPS` in
 *  `store/settings.ts`; both exist so the setting can be lowered by the user while the
 *  contract keeps a hard ceiling. */
export const MAX_SEARCHES = 3;

/* -------------------------------------------------------------------------- */
/* The trace                                                                  */
/* -------------------------------------------------------------------------- */

/** Mutable during a run, frozen into `RunTrace` when the answer is built. */
export class SearchTrace {
  private readonly steps: SearchStep[] = [];
  private readonly seen = new Set<DecisionId>();
  private bounded = false;
  /**
   * The budget for THIS run.
   *
   * Defaults to the contract ceiling. Lowering it is how the ablation measures what the contract
   * costs — a budget nobody can vary is a budget nobody has shown to be load-bearing. Clamped to
   * [1, MAX_SEARCHES]: the ceiling is the contract, so a caller may spend less but never more, and
   * a zero budget would refuse every question before searching, which measures nothing.
   */
  private readonly budget: number;

  constructor(budget: number = MAX_SEARCHES) {
    this.budget = Math.max(1, Math.min(Math.trunc(budget), MAX_SEARCHES));
  }

  /** Record one search. Returns false if the budget was already spent — the caller must
   *  then stop, which is the whole point of returning a value rather than throwing. */
  record(step: SearchStep): boolean {
    if (this.steps.length >= this.budget) {
      this.bounded = true;
      return false;
    }
    this.steps.push(step);
    return true;
  }

  /** Note that a search was ATTEMPTED but refused for budget. Distinct from a search that
   *  ran and returned nothing, and the assessment reports the difference. */
  markBoundedOut(): void {
    this.bounded = true;
  }

  /** Everything this run retrieved, across all searches, de-duplicated. This set IS the
   *  citation-resolution rule: a citation resolves iff its id is here. */
  note(ids: readonly DecisionId[]): void {
    for (const id of ids) this.seen.add(id);
  }

  get retrievedIds(): ReadonlySet<DecisionId> {
    return this.seen;
  }

  get searches(): readonly SearchStep[] {
    return this.steps;
  }

  get searchCount(): number {
    return this.steps.length;
  }

  /** The budget in force for THIS run. Exposed so the answer text and the stop reason describe the
   *  ceiling the run actually had rather than the module constant, which is what makes a lowered
   *  budget visible in the output instead of silently ignored. */
  get maxSearches(): number {
    return this.budget;
  }

  get isBoundedOut(): boolean {
    return this.bounded || this.steps.length >= this.budget;
  }

  /** Freeze into the immutable artifact stored on the answer. */
  freeze(sufficiencyAssessment: string): RunTrace {
    return {
      searches: [...this.steps],
      maxSearches: this.budget,
      boundedOut: this.bounded,
      sufficiencyAssessment,
    };
  }
}

export function searchStep(
  query: string,
  levels: readonly IndexLevel[],
  returned: number,
  topScore: number,
  why: string,
): SearchStep {
  return { query, levels: [...levels], returned, topScore, why };
}

/* -------------------------------------------------------------------------- */
/* Citation resolution                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Resolve citations against what THIS run retrieved.
 *
 * Every citation is kept — resolved or not — with `resolvedInRun` set. Dropping unresolved
 * ones would make the groundedness score look better than the answer is, and the reader
 * would never learn that a claim pointed at something nobody checked.
 */
export function resolveCitations(
  claims: readonly Claim[],
  retrieved: ReadonlySet<DecisionId>,
): { citations: readonly Citation[]; resolving: ReadonlySet<DecisionId> } {
  const citations: Citation[] = [];
  const resolving = new Set<DecisionId>();

  for (const [claimIndex, claim] of claims.entries()) {
    for (const decisionId of claim.citations) {
      const resolved = retrieved.has(decisionId);
      if (resolved) resolving.add(decisionId);

      citations.push({ decisionId, claimIndex, resolvedInRun: resolved });
    }
  }

  return { citations, resolving };
}

/** A claim is only grounded if it cites something that resolved. Recomputed here rather than
 *  trusted from the composer, because the composer does not know what the run retrieved. */
export function groundClaims(claims: readonly Claim[], resolving: ReadonlySet<DecisionId>): readonly Claim[] {
  return claims.map((claim) => ({
    text: claim.text,
    citations: claim.citations,
    grounded: claim.citations.length > 0 && claim.citations.some((id) => resolving.has(id)),
  }));
}

/** How many citations point at decisions this run never surfaced. A nonzero count is not an
 *  error to hide — it is the number the UI shows as "n citation(s) could not be checked". */
export function unresolvedCount(citations: readonly Citation[]): number {
  return citations.filter((citation) => !citation.resolvedInRun).length;
}

/* -------------------------------------------------------------------------- */
/* The sufficiency assessment                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Why the search stopped, in words.
 *
 * Four distinct situations, and conflating them is how a system ends up saying "I don't
 * know" when it actually means "I ran out of budget" or "your log is empty":
 *
 *   STOPPED_SUFFICIENT   evidence was found before the budget ran out
 *   STOPPED_BOUNDED      the budget ran out with evidence still missing
 *   STOPPED_EMPTY        searches ran and returned nothing on-topic
 *   STOPPED_NO_LOG       there was nothing to search
 */
export type StopReason =
  | "STOPPED_SUFFICIENT"
  | "STOPPED_BOUNDED"
  | "STOPPED_EMPTY"
  | "STOPPED_NO_LOG";

export function stopReason(
  trace: SearchTrace,
  groundedness: number,
  partialFloor: number,
  logSize: number,
): StopReason {
  if (logSize === 0) return "STOPPED_NO_LOG";
  if (trace.searchCount === 0 || trace.retrievedIds.size === 0) return "STOPPED_EMPTY";
  if (groundedness >= partialFloor) return "STOPPED_SUFFICIENT";
  return trace.isBoundedOut ? "STOPPED_BOUNDED" : "STOPPED_EMPTY";
}

export function assessSufficiency(
  reason: StopReason,
  trace: SearchTrace,
  groundedness: number,
  totalClaims: number,
): string {
  const budget = trace.searchCount + " of " + trace.maxSearches + " searches used";
  const score = (groundedness * 100).toFixed(0) + "% grounded (" + totalClaims + " claims)";

  switch (reason) {
    case "STOPPED_SUFFICIENT":
      return budget + ", " + score + ". Stopped because enough evidence was found, not because the budget ran out — a further search would have added candidates to rank, not changed the answer.";
    case "STOPPED_BOUNDED":
      return (
        budget + ", " + score + ". STOPPED BECAUSE THE BUDGET RAN OUT, not because the log was exhausted. " +
        "The answer is short of evidence and says so. A narrower or differently worded question may resolve within three searches; " +
        "if it does not, the gap is in the log rather than in the query."
      );
    case "STOPPED_EMPTY":
      return (
        budget + ", " + score + ". Searches ran and returned nothing on-topic. " +
        "This is a real result, not a failure to try: the log does not appear to contain a decision answering this question. " +
        "The nearest related decisions are offered instead of an invented answer."
      );
    case "STOPPED_NO_LOG":
      return (
        "No searches ran because the log is empty. Nothing has been recorded yet, so no question can be answered. " +
        "Paste a transcript on the Foundation tab to populate it."
      );
  }
}

/** The contract, printed. Shown in the health panel and in the Ask view's footer, because a
 *  contract the user has not read is a contract they cannot hold the system to. */
export function describeContract(): string {
  return [
    "The evidence contract — four rules this answer was produced under:",
    "",
    "  1. AT MOST " + MAX_SEARCHES + " SEARCHES per question, each recorded in the trace below.",
    "     The bound is not a performance optimisation. An unbounded search turns \"I could",
    "     not find it\" into \"I have not looked hard enough yet\", and a system that can",
    "     always look again never has to say it does not know.",
    "",
    "  2. A CITATION IS VALID ONLY IF IT POINTS TO A DECISION RETRIEVED IN THIS RUN.",
    "     Not \"exists in the log\". Only what this run retrieved has been read, scored and",
    "     ranked, so only those ids count as evidence. Anything else is shown as unresolved",
    "     and reported in the groundedness notes — never silently dropped, never counted.",
    "",
    "  3. \"INSUFFICIENT EVIDENCE\" IS A FIRST-CLASS ANSWER. Below the partial floor the",
    "     system refuses, states what is missing, and offers the nearest related decisions.",
    "",
    "  4. THE RUN LEAVES A TRACE: what was searched, what came back, the top score, why each",
    "     search ran, and why the search stopped. A reader who disagrees can point at the",
    "     exact step rather than argue with a number.",
    "",
    "Source: RepoRationale is the only prior art that binds an answer to a search budget and",
    "a citation-resolution rule. Everything else in this phase is table stakes.",
  ].join("\n");
}
