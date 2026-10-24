/**
 * Metrics 10 and 11 — retrieval precision@5 and MRR.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: agentmemory R@5 95.2% — A DIFFERENT TASK.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COMPARATOR IS CITED AND THEN DISMISSED
 *
 * agentmemory reports recall@5 of 95.2% using BM25 + vector + graph fusion with RRF — architecturally
 * the same retrieval stack as this one. It is the nearest published number and it is much higher than
 * anything measured here will be, so it has to be addressed rather than quietly omitted.
 *
 * It is not comparable, for one reason that is decisive: agentmemory retrieves CONVERSATION TURNS that
 * the query is usually a near-copy of. This retrieves DECISIONS, where the query is a question about
 * rationale and the answer is a node whose text may share no content words with it. "Why did we avoid
 * Postgres?" and "Use SQLite; single-user, no deploy infra" overlap on one word.
 *
 * Printing 95.2% beside a 0.6 without saying that would be misleading in the direction that flatters
 * the comparator; printing ours alone would be misleading in the direction that flatters us. So both
 * are printed, with the task difference in the comparator field where the report cannot drop it.
 *
 * ---------------------------------------------------------------------------
 * MRR IS REPORTED BECAUSE PRECISION@5 ALONE HIDES THE FAILURE
 *
 * A system that puts the right decision fifth scores 0.2 precision@5 and 0.2 MRR. A system that never
 * retrieves it at all scores 0 and 0. Those are different failures with different fixes — the first is
 * a ranking problem, the second a recall problem — and precision@5 cannot tell them apart at small k.
 * MRR can, because a query with no relevant result contributes exactly 0 under the standard convention
 * rather than being dropped from the denominator. Dropping failed queries is the usual way retrieval
 * numbers get inflated, and `meanReciprocalRank` in `types.ts` refuses to do it.
 *
 * ---------------------------------------------------------------------------
 * THE UNANSWERABLE QUESTION IS SCORED HERE, NOT DISCARDED
 *
 * One corpus question has an empty `relevant` set on purpose. A retrieval metric computed only over
 * answerable questions measures a system that has been told which questions have answers. This one is
 * included: it contributes no relevant results, so it can only lower the score, and the groundedness
 * metric is where its real behaviour — refusing to answer — is measured.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import type { Resolver } from "./resolve";
import { COMPARATORS, METRIC_NAMES, describeEngineId, meanReciprocalRank, precisionAtK, type MetricResult } from "./types";

const K = 5;

export interface RetrievalOutcome {
  readonly precision: MetricResult;
  readonly mrr: MetricResult;
  readonly perQuestion: readonly {
    question: string;
    relevant: readonly string[];
    relevantFound: number;
    retrieved: readonly string[];
    firstRelevantRank: number | null;
    unanswerable: boolean;
  }[];
}

export function scoreRetrieval(
  corpus: ResolvedCorpus,
  run: RunResult,
  resolver: Resolver,
  engine: EngineId,
): RetrievalOutcome {
  const perQuestion = run.questions.map((entry) => {
    const relevantIds = entry.question.relevant
      .map((key) => resolver.decision(key))
      .filter((id): id is DecisionId => id !== null);

    const retrieved = entry.answer === null ? [] : entry.answer.retrieved.slice(0, K).map((hit) => hit.decisionId);
    const relevantFound = retrieved.filter((id) => relevantIds.includes(id)).length;

    const firstRelevantRank = (() => {
      for (let rank = 0; rank < retrieved.length; rank += 1) {
        const id = retrieved[rank];
        if (id !== undefined && relevantIds.includes(id)) return rank + 1;
      }
      return null;
    })();

    return {
      question: entry.question.id,
      relevant: entry.question.relevant,
      relevantFound,
      retrieved: retrieved.map((id) => String(id)),
      firstRelevantRank,
      unanswerable: entry.question.relevant.length === 0,
    };
  });

  /* The expected number of relevant results in the top K, summed over questions. Precision@5 is
   * normally relevant-in-top-5 divided by 5, which is what `precisionAtK` computes — but for a question
   * with only one relevant decision, a perfect retrieval still scores 0.2. The cap below reports the
   * achievable precision beside it so the number is not read as a failure that is actually a ceiling. */
  const relevantInTopK = perQuestion.reduce((sum, entry) => sum + entry.relevantFound, 0);
  const slots = perQuestion.length * K;
  const precisionValue = precisionAtK(relevantInTopK, slots);

  const achievable = perQuestion.reduce(
    (sum, entry) => sum + Math.min(entry.relevant.length, K) / (entry.unanswerable ? 1 : K),
    0,
  );
  const achievableValue = perQuestion.length === 0 ? 0 : achievable / perQuestion.length;

  const ranks = perQuestion.filter((entry) => !entry.unanswerable).map((entry) => entry.firstRelevantRank);
  const mrrValue = meanReciprocalRank(ranks);

  const detail = {
    precision: precisionValue,
    recall: 0,
    f1: 0,
    truePositives: relevantInTopK,
    falsePositives: slots - relevantInTopK,
    falseNegatives: 0,
  };

  return {
    perQuestion,
    precision: {
      id: "retrieval-precision",
      name: METRIC_NAMES["retrieval-precision"],
      value: precisionValue,
      detail,
      n: perQuestion.length,
      perEngine: [{ engine: describeEngineId(engine), value: precisionValue, n: perQuestion.length, detail }],
      comparator: COMPARATORS["retrieval-precision"] ?? null,
      gloss:
        relevantInTopK + " relevant result(s) across " + slots + " top-" + K + " slots = " +
        (precisionValue * 100).toFixed(1) + "%. The achievable ceiling on these questions is " +
        (achievableValue * 100).toFixed(1) + "%, because " + perQuestion.filter((entry) => entry.relevant.length < K).length +
        " question(s) have fewer than " + K + " relevant decisions in the whole corpus.",
      honestNote:
        "precision@" + K + " over " + perQuestion.length + " questions, one of which is deliberately UNANSWERABLE and " +
        "contributes a guaranteed zero rather than being dropped — dropping it would inflate the score by deleting the " +
        "hardest case. The achievable ceiling is printed beside the value because most questions have one or two relevant " +
        "decisions in a twelve-transcript corpus, so a perfect system scores well under 1.0 and the raw number must not be " +
        "read as an error rate. agentmemory's R@5 95.2% is a DIFFERENT TASK (retrieving conversation turns the query " +
        "near-copies, not decisions the query paraphrases) and is cited as the nearest published figure, not as a baseline.",
    },
    mrr: {
      id: "retrieval-mrr",
      name: METRIC_NAMES["retrieval-mrr"],
      value: mrrValue,
      detail: null,
      n: ranks.length,
      perEngine: [{ engine: describeEngineId(engine), value: mrrValue, n: ranks.length, detail: null }],
      comparator: null,
      gloss:
        "MRR " + mrrValue.toFixed(3) + " over " + ranks.length + " answerable question(s). " +
        ranks.filter((rank) => rank === null).length + " returned no relevant decision in the top " + K + " at all.",
      honestNote:
        "MRR is reported because precision@5 cannot distinguish 'ranked fifth' from 'never retrieved', and those are " +
        "different failures with different fixes. n=" + ranks.length + " — the unanswerable question is EXCLUDED from MRR " +
        "(where it can only contribute a structural zero) but INCLUDED in precision@5, which is an inconsistency in " +
        "convention made deliberately and stated here rather than hidden: MRR answers 'when there is an answer, how high " +
        "is it', and the unanswerable question has no answer to rank. A query with no relevant result contributes 0 under " +
        "the standard convention; failed queries are never removed from the denominator.",
    },
  };
}
