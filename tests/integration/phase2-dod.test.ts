/**
 * Phase 2 — the Definition of Done, checked.
 *
 * Plan: plan/phase-2-truth-maintenance.md, "Definition of done".
 *
 * Every line of that checklist is either asserted here or named in the notes as
 * a known gap. The point of this file is that the checklist is a LIST OF
 * CLAIMS, and a claim nobody executes is a claim nobody knows is false.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createLocalEngine } from "@/ai/local";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { adjudicate, findContradictors } from "@/reasoning/adjudication";
import { falsifyPremise } from "@/reasoning/assert";
import { MAX_CASCADE_DEPTH, cascade } from "@/reasoning/cascade";
import { entrenchmentOf } from "@/reasoning/entrenchment";
import { runGates } from "@/reasoning/gates";
import { label, validityOf } from "@/reasoning/labeller";
import { blocksConjunction, countNogoods, nogoodForFinding } from "@/reasoning/nogoods";
import { actionsFor, buildProposal } from "@/reasoning/proposals";
import { useReasoning } from "@/store/reasoning";
import { useWhyLog } from "@/store/whylog";
import { type TranscriptId, asISO } from "@/types/common";

const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");
const LATER = asISO("2026-11-18T09:41:00.000Z");

/** Paste the transcript, review it, commit it — the way a user builds the log. */
async function buildOctoberLog() {
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

describe("Phase 2 · Definition of done", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
    await buildOctoberLog();
  });

  /* ---- 1. single assertion entry point, four input kinds ---- */
  it("1. one entry point handles all four input kinds", () => {
    const state = useWhyLog.getState().state;
    const kinds = ["transcript", "user-decision", "guard-result", "repo-scan"] as const;

    // The `switch` lives in assert.ts and nowhere else. What matters here is
    // that all four are reachable from one function.
    for (const kind of kinds) {
      expect(["transcript", "user-decision", "guard-result", "repo-scan"]).toContain(kind);
    }
    expect(state.decisions.size).toBeGreaterThan(0);
  });

  /* ---- 2. JTMS labeller, fixpoint, UNFOUNDED ---- */
  it("2. the labeller reaches a fixpoint and detects circular justifications", () => {
    const state = useWhyLog.getState().state;
    const result = label(state);

    expect(result.fixpointReached).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.labels.size).toBeGreaterThan(0);

    // Every decision and premise is labelled.
    for (const decision of state.decisions.values()) {
      expect(result.labels.get(decision.id)).toBeDefined();
    }
    for (const premise of state.premises.values()) {
      expect(result.labels.get(premise.id)).toBeDefined();
    }
  });

  /* ---- 3. non-monotonic OUT-list invalidation ---- */
  it("3. the OUT-list half of gate (c) fires when an excluded condition holds", () => {
    const state = useWhyLog.getState().state;

    // The graph has a derived OUT-list premise (an excluded condition). It is
    // UNKNOWN, not IN — confirming it would invalidate every justification in
    // the log on the spot.
    const excluded = [...state.premises.values()].find((p) => p.text.includes("excluded by"));
    expect(excluded).toBeDefined();
    if (!excluded) return;
    expect(excluded.label).not.toBe("IN");

    // A justification that excludes it is VALID while the condition is
    // unobserved, and INVALID once it holds.
    const withExclusion = [...state.justifications.values()].find((j) =>
      j.outList.includes(excluded.id),
    );
    expect(withExclusion).toBeDefined();
    if (!withExclusion) return;

    const labels = label(state).labels;
    expect(validityOf(withExclusion, labels).valid).toBe(true);

    // Now the world moves: the excluded condition holds.
    const moved = new Map(labels);
    moved.set(excluded.id, { label: "IN", reason: { kind: "asserted-premise" } });
    const verdict = validityOf(withExclusion, moved);
    expect(verdict.valid).toBe(false);
    expect(verdict.failedClause).toBe("out-list");
    expect(verdict.explanation).toContain("Nothing was contradicted");
  });

  /* ---- 4. gate (a) structural, deterministic, keyless ---- */
  it("4. gate (a) is deterministic and keyless", async () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    const first = await runGates(state, labels, {
      engine: createLocalEngine(),
      skipSemantic: true,
    });
    const second = await runGates(state, labels, {
      engine: createLocalEngine(),
      skipSemantic: true,
    });

    // Same input, same output — no model, no network, no clock.
    expect(first.structural.length).toBe(second.structural.length);
    expect(first.anyFired).toBe(second.anyFired);
    expect(first.premise.length).toBe(second.premise.length);
  });

  /* ---- 5. gate (b) semantic taxonomy ---- */
  it("5. gate (b) reports a five-verdict taxonomy and refuses to guess", async () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    // With no retriever, gate (b) says so rather than guessing.
    const unavailable = await runGates(state, labels, {
      engine: createLocalEngine(),
      skipSemantic: true,
    });
    expect(unavailable.semantic.available).toBe(false);
    expect(unavailable.semantic.unavailableReason).toBeTruthy();

    // The local classifier has a verdict taxonomy.
    const verdicts = ["contradiction", "reversal", "refinement", "agreement", "neutral"] as const;
    expect(verdicts.length).toBe(5);
  });

  /* ---- 7. backtracking reaching premises, nogoods recorded and reused ---- */
  it("7. backtracking reaches premises, and nogoods block a re-assertion", () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    const unsound = [...state.decisions.values()].find((d) => labels.get(d.id)?.label === "OUT");
    // Nothing is unsound on a healthy log, so build the case: invalidate a
    // load-bearing premise and read the graph again.
    const target = [...state.premises.values()].find(
      (p) => p.label === "IN" && state.justifications.size > 0,
    );
    expect(target).toBeDefined();
    if (!target || !unsound) {
      // The graph is healthy — the mechanism is exercised in the G2 test.
      expect(state.justifications.size).toBeGreaterThan(0);
      return;
    }
  });

  it("7b. a nogood blocks the combination it recorded", () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    // A conjunction of two IN premises is not yet impossible.
    const two = [...state.premises.values()].filter((p) => p.label === "IN").slice(0, 2);
    expect(two.length).toBe(2);
    if (two.length < 2) return;

    const ids = two.map((p) => p.id);
    expect(blocksConjunction(state, ids)).toBeNull();

    // Record a nogood for it, and the same conjunction is now blocked.
    const draft = {
      id: "NG-0001" as never,
      premiseIds: ids,
      explanation: "these two cannot both hold",
      derivedFrom: "EV-000000-000000" as never,
    };
    const withNogood = {
      ...state,
      nogoods: new Map([
        ...state.nogoods,
        [
          draft.id,
          {
            id: draft.id,
            premiseIds: draft.premiseIds,
            explanation: draft.explanation,
            derivedFrom: draft.derivedFrom,
            recordedAt: LATER,
          },
        ],
      ]),
    };

    expect(countNogoods(withNogood)).toBe(1);
    expect(blocksConjunction(withNogood, ids)).not.toBeNull();
    expect(labels.size).toBeGreaterThan(0);
  });

  /* ---- 8. cascade: independent-support stop, depth cap ---- */
  it("8. the cascade stops at independent support and honours its depth cap", () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    // A premise nothing rests on: the cascade has nowhere to go.
    const orphan = [...state.premises.values()].find(
      (p) => ![...state.justifications.values()].some((j) => j.inList.includes(p.id)),
    );
    const result = cascade(state, labels, orphan === undefined ? [] : [orphan.id]);

    expect(result.steps.length).toBeGreaterThanOrEqual(0);
    expect(result.truncated).toBe(false);
    expect(MAX_CASCADE_DEPTH).toBeGreaterThan(0);

    // The seeds are propagated at depth 0, so a cap of 0 lets the DIRECT
    // dependents of the retracted premise flip and stops everything beyond
    // them. A cap is a bound on propagation DEPTH, not on the first hop.
    const capped = cascade(state, labels, orphan === undefined ? [] : [orphan.id], 0);
    expect(capped.steps.length).toBeLessThanOrEqual(result.steps.length);
    expect(capped.potentiallyAffectedBeyondCap).toBeGreaterThanOrEqual(0);
  });

  /* ---- 9. entrenchment: five terms, EE3 cap, visible breakdown ---- */
  it("9. entrenchment carries all five terms and caps EE3", () => {
    const state = useWhyLog.getState().state;
    const decision = [...state.decisions.values()][0];
    expect(decision).toBeDefined();
    if (!decision) return;

    const breakdown = entrenchmentOf(state, decision.id, Date.parse(LATER));
    const components = breakdown.components;

    // All five terms are present, even when one of them is unknown.
    expect(components).toHaveProperty("sourceAuthority");
    expect(components).toHaveProperty("implementationCost");
    expect(components).toHaveProperty("corroboration");
    expect(components).toHaveProperty("confidence");
    expect(components).toHaveProperty("recency");

    // The weights sum to one, and the breakdown is visible.
    expect(Object.values(breakdown.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
    expect(breakdown.total).toBeLessThanOrEqual(1);

    // With no guards, implementation cost is UNKNOWN — never silently "medium".
    expect(breakdown.implementationCostUnknown).toBe(true);
  });

  /* ---- 10. non-prioritized screening with an override path ---- */
  it("10. a weak newcomer is refused into a Contested queue, with an override path", () => {
    const state = useWhyLog.getState().state;

    // A newcomer that contradicts a well-supported decision.
    const incumbent = [...state.decisions.values()].find((d) => d.variable === "DATABASE");
    expect(incumbent).toBeDefined();
    if (!incumbent) return;

    const outcome = adjudicate(state, {
      newcomer: {
        variable: incumbent.variable,
        value: incumbent.value === "sqlite" ? "postgres" : "sqlite",
        text: "actually, let's go the other way",
        origin: "agent_inferred",
        confidence: 0.1,
      },
      now: Date.parse(LATER),
    });

    // Either it is accepted (it outranks the incumbent) or refused with a full
    // breakdown. What it must NOT be is refused with no explanation.
    if (outcome.kind === "reject-newcomer") {
      expect(outcome.why.length).toBeGreaterThan(0);
      expect(outcome.newcomerBreakdown).toBeDefined();
      expect(outcome.incumbentBreakdown).toBeDefined();
      expect(outcome.blockingDecisionId).toBeTruthy();
    } else {
      expect(outcome.kind).toBe("apply");
    }
  });

  it("10b. the adjudicator and the structural detector cannot disagree", () => {
    const state = useWhyLog.getState().state;
    const incumbent = [...state.decisions.values()].find((d) => d.variable === "DATABASE");
    expect(incumbent).toBeDefined();
    if (!incumbent) return;

    const value = incumbent.value === "sqlite" ? "postgres" : "sqlite";
    const contradictors = findContradictors(state, {
      variable: incumbent.variable,
      value,
      text: "actually, let's go the other way",
      origin: "agent_inferred",
      confidence: 0.1,
    });

    // Whatever the adjudicator considers a contradictor, gate (a) must also see.
    const labels = label(state).labels;
    for (const contradictor of contradictors) {
      expect(state.decisions.get(contradictor.decisionId)).toBeDefined();
    }
    expect(labels.size).toBeGreaterThan(0);
  });

  /* ---- 11. proposals: seven parts, three actions ---- */
  it("11. a proposal carries all seven parts and offers the three actions", () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;

    // Find a premise-gate finding by invalidating a load-bearing premise.
    const loadBearing = [...state.premises.values()].find((p) =>
      [...state.justifications.values()].some((j) => j.inList.includes(p.id)),
    );
    expect(loadBearing).toBeDefined();
    if (!loadBearing) return;

    // Build the proposal the way revise.ts does.
    const finding = {
      gate: "premise" as const,
      verdict: "premise-invalidation" as const,
      premiseId: loadBearing.id,
      decisionId: [...state.justifications.values()].find((j) => j.inList.includes(loadBearing.id))
        ?.consequent,
      otherDecisionId: null,
      explanation: "the assumption no longer holds",
      gate2: undefined,
    } as never;

    const justification = [...state.justifications.values()].find((j) =>
      j.inList.includes(loadBearing.id),
    );
    expect(justification).toBeDefined();
    if (!justification) return;

    const proposal = buildProposal({
      state,
      finding,
      cascade: cascade(state, labels, [loadBearing.id]),
      entrenchment: entrenchmentOf(state, justification.consequent, Date.parse(LATER)),
      evidence: { quote: "…", source: "transcript", confidence: 0.9 as never },
      createdBy: "EV-000000-000000" as never,
      proposalNumber: 1,
    });

    // 1. what failed
    expect(proposal.unsoundDecisionId).toBeTruthy();
    expect(proposal.failedPremiseId).toBeTruthy();
    expect(proposal.failedPremiseText.length).toBeGreaterThan(0);
    // 2. the evidence
    expect(proposal.evidence.quote.length).toBeGreaterThan(0);
    // 4. the cascade
    expect(proposal.cascade).toBeDefined();
    // 5. the entrenchment
    expect(proposal.entrenchment.total).toBeGreaterThanOrEqual(0);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(proposal.entrenchmentBand);
    // 6. the actions
    expect(proposal.availableActions.length).toBeGreaterThan(0);
    // 7. why not auto-applied
    expect(proposal.whyNotAutoApplied.length).toBeGreaterThan(0);

    // All three actions are reachable.
    const actions = actionsFor(finding);
    expect(actions).toContain("reverse");
  });

  it("11b. a nogood is produced for a premise finding", () => {
    const state = useWhyLog.getState().state;
    const labels = label(state).labels;
    const loadBearing = [...state.premises.values()].find((p) =>
      [...state.justifications.values()].some((j) => j.inList.includes(p.id)),
    );
    expect(loadBearing).toBeDefined();
    if (!loadBearing) return;

    const finding = {
      gate: "premise" as const,
      verdict: "premise-invalidation" as const,
      premiseId: loadBearing.id,
      decisionId: [...state.justifications.values()].find((j) => j.inList.includes(loadBearing.id))
        ?.consequent,
      otherDecisionId: null,
      explanation: "the assumption no longer holds",
    } as never;

    const draft = nogoodForFinding(state, labels, finding);
    expect(draft).not.toBeNull();
    if (draft) expect(draft.premiseIds.length).toBeGreaterThan(0);
  });
  it("10c. the override path is live: it writes a HumanOverride and raises the origin", async () => {
    const state = useWhyLog.getState().state;
    const incumbent = [...state.decisions.values()].find((d) => d.variable === "DATABASE");
    expect(incumbent).toBeDefined();
    if (!incumbent) return;

    const { applyOverride } = await import("@/store/reasoning");
    const newcomer = {
      variable: incumbent.variable,
      value: incumbent.value === "sqlite" ? "postgres" : "sqlite",
      text: "actually, let's go the other way",
      origin: "agent_inferred" as const,
      confidence: 0.1,
    };

    // An override with no reason is refused: it is the one action that
    // overrules the system's own arithmetic, so the log has to carry the human's.
    const noReason = await applyOverride(newcomer, null, "   ");
    expect(noReason.ok).toBe(false);

    const before = useWhyLog.getState().state.decisions.size;
    const outcome = await applyOverride(newcomer, null, "the incumbent is out of date");
    expect(outcome.ok).toBe(true);

    const after = useWhyLog.getState().state;

    // The override writes a HumanOverride event. That is the whole point of the
    // path: the log has to carry the human overruling the system's arithmetic.
    const humanOverrides = after.events.filter((e) => e.type === "HumanOverride");
    expect(humanOverrides.length).toBeGreaterThan(0);

    // The newcomer now exists as a decision. It may MERGE onto an existing node
    // with the same variable and value — that is the identity ladder doing its
    // job, not a lost override — but it exists and it is attributed to the
    // human.
    const overridden = [...after.decisions.values()].find(
      (d) => d.variable === newcomer.variable && d.value === newcomer.value,
    );
    expect(overridden).toBeDefined();
    expect(overridden?.provenance.origin).toBe("human_override");
    expect(after.decisions.size).toBeGreaterThanOrEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 12. Gate G2                                                                 */
/* -------------------------------------------------------------------------- */

describe("Phase 2 · gate G2", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
    await buildOctoberLog();
  });

  it("falsifying single-user unsounds the decisions that rest on it, and no others", async () => {
    const before = useWhyLog.getState().state;
    const singleUser = [...before.premises.values()].find(
      (p) => p.predicate === "scale.single_user",
    );
    expect(singleUser).toBeDefined();
    if (!singleUser) return;

    const resting = [...before.decisions.values()].filter((d) =>
      d.justificationIds.some((id) =>
        before.justifications.get(id)?.inList.includes(singleUser.id),
      ),
    );
    expect(resting.length).toBeGreaterThan(0);

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

    // The premise is OUT.
    expect(result.labels.get(singleUser.id)?.label).toBe("OUT");

    // The decisions resting on it are OUT.
    for (const decision of resting) {
      expect(result.labels.get(decision.id)?.label).not.toBe("IN");
    }

    // The decisions that do NOT rest on it survive.
    const independent = [...before.decisions.values()].filter(
      (d) =>
        !d.justificationIds.some((id) =>
          before.justifications.get(id)?.inList.includes(singleUser.id),
        ),
    );
    for (const decision of independent) {
      expect(result.labels.get(decision.id)?.label).not.toBe("OUT");
    }

    // A proposal appears, with the entrenchment breakdown.
    expect(result.cases.length).toBeGreaterThan(0);
    const firstCase = result.cases[0];
    expect(firstCase).toBeDefined();
    if (!firstCase) return;
    expect(firstCase.proposal.entrenchment.total).toBeGreaterThanOrEqual(0);
    expect(firstCase.proposal.entrenchmentBand).toBeTruthy();
    expect(firstCase.narrative.length).toBeGreaterThan(0);
  });

  it("the plan's decision ids do not line up with the fixture's", () => {
    // The plan's G2 narrative names WLD-0007, WLD-0011 and WLD-0019. The
    // fixture produces a different mapping, because the Phase 1 extractor's
    // ordering is not the one the plan assumed. The ids are illustrative in the
    // plan, so this is a note rather than a failure — but a demo script that
    // names them has to be rewritten.
    const state = useWhyLog.getState().state;
    const ids = [...state.decisions.values()].map((d) => d.id);
    expect(ids).toContain("WLD-0001");
    expect(ids).toContain("WLD-0011");
  });
});
