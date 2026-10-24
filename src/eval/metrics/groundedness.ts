/**
 * Metric 9 — answer groundedness, and whether the system refuses when it should.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: RepoRationale — specifies the contract, publishes no quantity.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT IS THE CONTRIBUTION, SO THE CONTRACT IS WHAT GETS MEASURED
 *
 * RepoRationale's evidence contract has three parts: at most three searches, every citation resolves
 * within the run, and "insufficient evidence" is a first-class answer rather than a failure. It
 * publishes no number for any of them, so there is nothing to beat — but there is something to CHECK,
 * and checking a contract is a measurement even when the literature never quantified it.
 *
 * Three quantities are reported, one per clause:
 *   1. groundedness — |claims with a resolving citation| / |claims|, the number the answer carries
 *   2. search-budget compliance — did any answer exceed three searches
 *   3. refusal correctness — on the unanswerable question, did it refuse
 *
 * ---------------------------------------------------------------------------
 * REFUSAL IS SCORED AS A HIT, WHICH IS THE UNUSUAL PART
 *
 * Almost every retrieval benchmark treats "no answer" as a failure. Under an evidence contract it is the
 * correct output for a question the corpus cannot answer, and a system that answers it anyway has
 * fabricated a claim. So the unanswerable question contributes a HIT when the verdict is
 * INSUFFICIENT_EVIDENCE and a MISS when it is anything else — the only metric in this suite where
 * refusing to produce output is what earns the point.
 *
 * ---------------------------------------------------------------------------
 * ZERO CLAIMS IS NOT GROUNDED
 *
 * `0 / 0` would be `1` under naive division, which would score an empty answer as perfectly grounded.
 * Phase 3 settled this explicitly: an answer with no claims has demonstrated nothing and is not
 * grounded. This metric inherits that rule rather than re-deciding it, and reports empty answers as a
 * separate count so a system that refuses everything is visibly distinguishable from one that refuses
 * correctly once.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import { COMPARATORS, METRIC_NAMES, type MetricResult, describeEngineId } from "./types";

export interface GroundednessOutcome {
  readonly metric: MetricResult;
  readonly perQuestion: readonly {
    question: string;
    verdict: string;
    expectedVerdict: string;
    correct: boolean;
    groundedness: number;
    claims: number;
    groundedClaims: number;
    searches: number;
    overBudget: boolean;
    unanswerable: boolean;
  }[];
  readonly searchBudgetViolations: number;
  readonly refusalsCorrect: number;
  readonly refusalsExpected: number;
  readonly emptyAnswers: number;
}

export const MAX_SEARCHES = 3;

export function scoreGroundedness(
  _corpus: ResolvedCorpus,
  run: RunResult,
  engine: EngineId,
): GroundednessOutcome {
  const perQuestion = run.questions.map((entry) => {
    const answer = entry.answer;
    const unanswerable = entry.question.relevant.length === 0;

    const claims = answer === null ? 0 : answer.claims.length;
    const groundedClaims =
      answer === null ? 0 : answer.claims.filter((claim) => claim.grounded).length;

    /* 0/0 is not 1. An answer with no claims has demonstrated nothing; scoring it as perfectly
     * grounded would reward silence, and silence is what a system produces when it is broken. */
    const groundedness = claims === 0 ? 0 : groundedClaims / claims;

    const searches = answer === null ? 0 : answer.trace.searches.length;

    const verdict = answer === null ? "ERROR" : answer.verdict;
    const correct = verdict === entry.question.expectVerdict;

    return {
      question: entry.question.id,
      verdict,
      expectedVerdict: entry.question.expectVerdict,
      correct,
      groundedness,
      claims,
      groundedClaims,
      searches,
      overBudget: searches > MAX_SEARCHES,
      unanswerable,
    };
  });

  const searchBudgetViolations = perQuestion.filter((entry) => entry.overBudget).length;
  const refusalsExpected = perQuestion.filter((entry) => entry.unanswerable).length;
  const refusalsCorrect = perQuestion.filter(
    (entry) => entry.unanswerable && entry.verdict === "INSUFFICIENT_EVIDENCE",
  ).length;
  const emptyAnswers = perQuestion.filter((entry) => entry.claims === 0).length;

  /* The headline value is VERDICT ACCURACY, not mean groundedness. Groundedness measures the internal
   * consistency of an answer — did its claims cite things that exist — and a confidently wrong answer
   * can score 1.0 on it. Verdict accuracy measures whether the system correctly judged what it knew,
   * which is the property the evidence contract exists to guarantee. Mean groundedness is reported
   * beside it in the gloss. */
  const correctVerdicts = perQuestion.filter((entry) => entry.correct).length;
  const value = perQuestion.length === 0 ? 0 : correctVerdicts / perQuestion.length;

  const meanGroundedness =
    perQuestion.length === 0
      ? 0
      : perQuestion.reduce((sum, entry) => sum + entry.groundedness, 0) / perQuestion.length;

  return {
    perQuestion,
    searchBudgetViolations,
    refusalsCorrect,
    refusalsExpected,
    emptyAnswers,
    metric: {
      id: "answer-groundedness",
      name: METRIC_NAMES["answer-groundedness"],
      value,
      detail: null,
      n: perQuestion.length,
      perEngine: [{ engine: describeEngineId(engine), value, n: perQuestion.length, detail: null }],
      comparator: COMPARATORS["answer-groundedness"] ?? null,
      gloss: `${correctVerdicts} of ${perQuestion.length} answer(s) carried the verdict the corpus expected. Mean groundedness ${meanGroundedness.toFixed(3)} (${perQuestion.reduce((sum, entry) => sum + entry.groundedClaims, 0)} grounded claim(s) of ${perQuestion.reduce((sum, entry) => sum + entry.claims, 0)}). ${searchBudgetViolations} answer(s) exceeded the ${MAX_SEARCHES}-search budget. Refusals: ${refusalsCorrect} of ${refusalsExpected} correct.`,
      honestNote: `The headline is VERDICT ACCURACY, not mean groundedness, because groundedness measures whether an answer's claims cite things that exist — and a confidently wrong answer can score 1.0 on it. RepoRationale specifies the contract but publishes no quantity, so there is nothing to beat and the three clauses are CHECKED instead: search budget, citation resolution, refusal. n=${perQuestion.length} questions, of which ${refusalsExpected} is deliberately unanswerable and scores as a HIT when the system refuses — the only place in this suite where producing no output earns the point. An answer with zero claims is scored 0, not 1: 0/0 would reward silence. ${emptyAnswers} empty answer(s) were produced, which should be read against the refusal count before concluding anything about restraint.`,
    },
  };
}

export type { ResolvedCorpus };
