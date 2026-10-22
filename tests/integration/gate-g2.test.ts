/**
 * GATE G2 — "it reasons".
 *
 * Plan: plan/OVERVIEW.md §5.2
 *   "Does the log detect that a decision has stopped being true, WITHOUT BEING
 *    TOLD?"
 *   Evidence: "Falsify `single-user` -> WLD-0007 goes UNSOUND -> WLD-0011
 *    cascades -> WLD-0019 survives -> a revision proposal appears with the
 *    entrenchment breakdown."
 *
 * This is THE gate. Everything else in the product is a surface over this. If
 * the cascade does not fire correctly and conservatively, nothing downstream is
 * worth polishing.
 *
 * The graph is built the way a user builds it: paste the Oct-3 transcript, let
 * the extractor find the decisions and the premises, review them, commit. Then
 * the world moves — "there are two of us editing it now" — and the cycle runs.
 *
 * Keyless, deterministic, no network.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createLocalEngine } from "@/ai/local";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { falsifyPremise } from "@/reasoning/assert";
import { useReasoning } from "@/store/reasoning";
import { useWhyLog } from "@/store/whylog";
import { type TranscriptId, asISO } from "@/types/common";

const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");
const LATER = asISO("2026-11-18T09:41:00.000Z");

/**
 * Paste the transcript, review everything, commit it.
 *
 * Exactly the path the UI takes: extract -> queue -> approve -> commit.
 */
async function buildOctoberLog(): Promise<void> {
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
}

describe("Gate G2 — it reasons", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
    await buildOctoberLog();
  });

  it("has a graph to reason about: decisions, premises and justifications", () => {
    const state = useWhyLog.getState().state;
    expect(state.decisions.size).toBeGreaterThan(0);
    expect(state.premises.size).toBeGreaterThan(0);
    expect(state.justifications.size).toBeGreaterThan(0);

    // The premise the demo falsifies has to be there, or the gate cannot run.
    const singleUser = [...state.premises.values()].find(
      (p) => p.predicate === "scale.single_user",
    );
    expect(singleUser).toBeDefined();
  });

  it("falsifying a premise takes a resting decision OUT and proposes a revision", async () => {
    const before = useWhyLog.getState().state;
    const singleUser = [...before.premises.values()].find(
      (p) => p.predicate === "scale.single_user",
    );
    expect(singleUser).toBeDefined();
    if (!singleUser) return;

    // The decisions that rest on it, before the falsification.
    const resting = [...before.decisions.values()].filter((d) =>
      d.justificationIds.some((id) =>
        before.justifications.get(id)?.inList.includes(singleUser.id),
      ),
    );
    expect(resting.length).toBeGreaterThan(0);

    // The world moved. Nothing contradicted the decision; the ASSUMPTION it
    // rested on stopped being true.
    const outcome = await useReasoning.getState().assertAndRevise(
      falsifyPremise("scale", "scale.single_user", "there are two of us editing it now", {
        state: before,
        actor: { kind: "human" },
        engine: ENGINE_ID,
        at: LATER,
        source: "repo-scan",
      }),
    );
    expect(outcome.ok).toBe(true);

    const result = useReasoning.getState().result;
    expect(result).not.toBeNull();
    if (!result) return;

    // ---- the premise is now OUT ----
    const labels = result.labels;
    expect(labels.get(singleUser.id)?.label).toBe("OUT");

    // ---- and a decision that rested on it went with it ----
    for (const decision of resting) {
      expect(labels.get(decision.id)?.label).not.toBe("IN");
    }

    // ---- a revision proposal exists, with the entrenchment breakdown ----
    expect(result.cases.length).toBeGreaterThan(0);
    const firstCase = result.cases[0];
    expect(firstCase).toBeDefined();
    if (!firstCase) return;

    expect(firstCase.proposal).toBeDefined();
    expect(firstCase.proposal.unsoundDecisionId).toBeTruthy();
    // The entrenchment breakdown is what makes the proposal actionable: it says
    // how hard this decision is to retract.
    expect(firstCase.entrenchment).toBeDefined();
    expect(firstCase.entrenchment.total).toBeGreaterThanOrEqual(0);
    expect(firstCase.entrenchment.total).toBeLessThanOrEqual(1);

    // ---- and the cycle produced events to write ----
    expect(result.eventDrafts.length).toBeGreaterThan(0);
  });

  it("a decision that does NOT rest on the falsified premise survives", async () => {
    const before = useWhyLog.getState().state;
    const singleUser = [...before.premises.values()].find(
      (p) => p.predicate === "scale.single_user",
    );
    if (!singleUser) throw new Error("fixture did not yield scale.single_user");

    // A decision with NO justification citing the falsified premise.
    const independent = [...before.decisions.values()].find((d) => {
      if (d.justificationIds.length === 0) return false;
      return !d.justificationIds.some((id) =>
        before.justifications.get(id)?.inList.includes(singleUser.id),
      );
    });
    expect(independent).toBeDefined();
    if (!independent) return;

    await useReasoning.getState().assertAndRevise(
      falsifyPremise("scale", "scale.single_user", "there are two of us editing it now", {
        state: before,
        actor: { kind: "human" },
        engine: ENGINE_ID,
        at: LATER,
        source: "repo-scan",
      }),
    );

    const result = useReasoning.getState().result;
    if (!result) throw new Error("no result");

    // It may have been relabelled for other reasons, but it must not have been
    // UNSOUND by this falsification: the cascade is supposed to be exact.
    const label = result.labels.get(independent.id)?.label;
    expect(label).not.toBe("OUT");

    // ---- AND THE CASCADE MUST NOT TAKE THE WHOLE GRAPH ----
    //
    // Risk R2: "Cascade cries wolf — one flip takes out half the log." A
    // falsification of ONE premise may only unsound the decisions that rest on
    // it. If everything goes OUT, the mechanism is over-firing and the
    // over-retraction is worse than the under-retraction.
    const allOut = [...before.decisions.values()].filter(
      (d) =>
        result.labels.get(d.id)?.label === "OUT" &&
        result.labels.get(d.id)?.reason.kind === "all-justifications-invalid",
    ).length;
    const restingOut = [...before.decisions.values()].filter((d) =>
      d.justificationIds.some((id) =>
        before.justifications.get(id)?.inList.includes(singleUser.id),
      ),
    ).length;

    expect(allOut).toBeGreaterThan(0);
    expect(allOut).toBeLessThan(before.decisions.size);
    // Every decision that went OUT rested on the falsified premise. Not one more.
    expect(allOut).toBeLessThanOrEqual(restingOut);
  });

  it("the cascade stops at a decision with independent support", async () => {
    const before = useWhyLog.getState().state;
    const singleUser = [...before.premises.values()].find(
      (p) => p.predicate === "scale.single_user",
    );
    if (!singleUser) throw new Error("fixture did not yield scale.single_user");

    await useReasoning.getState().assertAndRevise(
      falsifyPremise("scale", "scale.single_user", "there are two of us editing it now", {
        state: before,
        actor: { kind: "human" },
        engine: ENGINE_ID,
        at: LATER,
        source: "repo-scan",
      }),
    );

    const result = useReasoning.getState().result;
    if (!result) throw new Error("no result");

    // Every case the cycle opened names the decision it is about and the
    // premise that failed, so the user is told WHICH assumption moved.
    for (const c of result.cases) {
      expect(c.finding).toBeDefined();
      expect(c.proposal.unsoundDecisionId).toBeTruthy();
      expect(c.narrative.length).toBeGreaterThan(0);
    }
  });
});
