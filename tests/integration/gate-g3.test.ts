/**
 * Gate G3 — "it answers".
 *
 * Plan: plan/OVERVIEW.md §5.2
 *   "Can it answer a 'why' question with citations, and refuse when it can't?"
 *   Evidence: "'why did we drop auth?' -> GROUNDED with citations that expand to
 *   snippets. A question the log can't answer returns INSUFFICIENT EVIDENCE."
 *
 * Two halves, and the second half matters more than the first: a system that
 * always answers has not implemented the evidence contract, it has implemented a
 * guess.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createLocalEngine } from "@/ai/local";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { label } from "@/reasoning/labeller";
import { ask } from "@/retrieval";
import { buildIndex } from "@/retrieval/build-index";
import { useWhyLog } from "@/store/whylog";
import { type TranscriptId, asISO } from "@/types/common";

const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");

/** Paste the transcript, review it, commit it, build the index. */
async function buildIndexedLog() {
  const raw = readFileSync(FIXTURE, "utf-8");
  const engine = createLocalEngine();

  const run = await runExtraction(
    { transcriptId: "T-0001" as TranscriptId, raw, occurredAt: NOW },
    { engine, engineId: ENGINE_ID, state: useWhyLog.getState().state },
  );
  if (!run.ok) throw new Error(`extraction failed: ${run.failure.kind}`);

  const reviewed = run.outcome.queue.map((candidate) => applyAction(candidate, approve(false)));
  const committed = commitReview(
    {
      transcriptId: "T-0001" as TranscriptId,
      engine: ENGINE_ID,
      occurredAt: NOW,
      items: reviewed,
      machineDiscards: run.outcome.result.discarded.filter(
        (
          d,
        ): d is typeof d & {
          readonly discardedBy: "confidence-threshold" | "modality" | "duplicate";
        } => d.discardedBy !== "human",
      ),
    },
    useWhyLog.getState().state,
  );
  if (!committed.ok) throw new Error("commit failed");

  const recorded = useWhyLog.getState().recordBatch(committed.drafts, {
    reason: "Reviewed and approved: the Oct-3 transcript.",
    actor: { kind: "human" },
    occurredAt: NOW,
  });
  if (!recorded.ok) throw new Error(`record failed: ${recorded.error}`);

  const state = useWhyLog.getState().state;
  const built = await buildIndex({ state, engine, actor: { kind: "system" } });

  /* The index is part of the log's history: `IndexRebuilt` is a state-changing
   * event, and the retrieval gates L1/L2 on the STATE's view of the index. A
   * test that builds the artifacts and throws away the events is not the flow a
   * user gets — it is a flow with the dense levels silently switched off. */
  if (built.drafts.length > 0) {
    const committed = useWhyLog.getState().recordBatch(built.drafts, {
      reason: `Index rebuilt: ${built.embedded} decision(s) embedded, levels ${built.levels.join("/")}.`,
      actor: { kind: "system" },
    });
    if (!committed.ok) throw new Error(`index commit failed: ${committed.error}`);
  }

  const after = useWhyLog.getState().state;
  return {
    state: after,
    labels: label(after).labels,
    artifacts: built.artifacts,
    engine,
  };
}

describe("Gate G3 — it answers", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("half 1 — an answerable question returns GROUNDED, with citations", async () => {
    const { state, labels, artifacts, engine } = await buildIndexedLog();

    const answer = await ask({
      state,
      artifacts,
      labels,
      engine,
      engineId: ENGINE_ID,
      question: "Why did we choose SQLite over Postgres?",
    });

    expect(answer.verdict).toBe("GROUNDED");
    expect(answer.claims.length).toBeGreaterThan(0);

    // Every claim resolves to a citation that was resolved IN THIS RUN.
    for (const claim of answer.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
      expect(claim.grounded).toBe(true);
    }

    // A citation is valid ONLY if it points at a decision this run retrieved.
    for (const citation of answer.citations) {
      expect(citation.resolvedInRun).toBe(true);
      expect(answer.retrieved.some((hit) => hit.decisionId === citation.decisionId)).toBe(true);
    }

    // The groundedness score is a real fraction, not a constant.
    expect(answer.groundedness).toBeGreaterThan(0);
    expect(answer.groundedness).toBeLessThanOrEqual(1);

    // The trace says what was searched and why it stopped.
    expect(answer.trace.searches.length).toBeGreaterThan(0);
    expect(answer.trace.maxSearches).toBeGreaterThan(0);
    expect(answer.trace.sufficiencyAssessment.length).toBeGreaterThan(0);

    // The answer names the decision it is about.
    const cited = answer.citations.map((c) => c.decisionId);
    expect(cited.length).toBeGreaterThan(0);
  });

  it("half 2 — an unanswerable question returns INSUFFICIENT EVIDENCE and makes no claims", async () => {
    const { state, labels, artifacts, engine } = await buildIndexedLog();

    // Neither fixture mentions payments, Stripe, billing or checkout, so this
    // question genuinely has no answer in the log.
    const answer = await ask({
      state,
      artifacts,
      labels,
      engine,
      engineId: ENGINE_ID,
      question: "What did we decide about the payment provider?",
    });

    expect(answer.verdict).toBe("INSUFFICIENT_EVIDENCE");

    // 0/0 is NOT treated as 1. A refusal that claims perfect groundedness is a
    // refusal that is quietly lying about what it knows.
    expect(answer.claims.length).toBe(0);
    expect(answer.groundedness).toBeLessThan(1);

    // It offers the nearest related decisions instead of answering.
    expect(answer.nearestRelated).toBeDefined();
    expect(answer.nearestRelated?.length ?? 0).toBeGreaterThan(0);
  });
  it("the search budget is bounded — that is what makes refusal reachable", async () => {
    const { state, labels, artifacts, engine } = await buildIndexedLog();

    const answer = await ask({
      state,
      artifacts,
      labels,
      engine,
      engineId: ENGINE_ID,
      question: "What did we decide about the payment provider?",
    });

    expect(answer.trace.searches.length).toBeLessThanOrEqual(answer.trace.maxSearches);
    expect(answer.trace.maxSearches).toBe(3);
  });

  it("every search is recorded with a reason and a stop reason", async () => {
    const { state, labels, artifacts, engine } = await buildIndexedLog();

    const answer = await ask({
      state,
      artifacts,
      labels,
      engine,
      engineId: ENGINE_ID,
      question: "Why did we choose SQLite over Postgres?",
    });

    for (const search of answer.trace.searches) {
      expect(search.query.length).toBeGreaterThan(0);
      expect(search.why.length).toBeGreaterThan(0);
    }
  });
});
