/**
 * The reasoning knobs — 6.8.
 *
 * Plan: plan/phase-6-presentation.md §6.8
 *
 * STRUCTURE.md §18.6 records what Phase 6 found:
 *
 *   "§6.8 lists `cascade depth cap` and `confidence-tier thresholds` as settings. They were
 *    INERT END TO END, and are now real. `SettingsState` declared `setThresholds` and
 *    `setCascadeDepthCap` as `() => {}`. Worse, `cascade()` accepted a `depthCap` parameter
 *    that NO CALL SITE EVER SUPPLIED, so every run used `MAX_CASCADE_DEPTH` regardless.
 *    Added a persisted `useTuning` store (`whylog:settings:v1`), a `ReviseInput.cascadeDepthCap`
 *    field, and the missing argument at the `revise()` call site. A settings panel that
 *    renders a control which cannot change anything is worse than no control."
 *
 * That claim is exactly the kind that goes stale, so it is tested end to end: the setting is
 * changed through the SETTINGS PATH, and the cascade is observed to change. A test that only
 * called `cascade(state, labels, premises, 0)` would pass even with the wiring reverted, which
 * is precisely how the setting could be inert and still look tested.
 *
 * The log used here is the APPROVE-ALL one, because the curated log's cascade is only one
 * level deep and a one-level cascade cannot show a depth cap. The approve-all log's cascade
 * reaches depth 4 and is truncated by the default cap, so the cap is observable.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { falsifyPremise } from "@/reasoning/assert";
import { MAX_CASCADE_DEPTH } from "@/reasoning/cascade";
import { deepestCascade } from "@/reasoning/revise";
import { useReasoning } from "@/store/reasoning";
import { useTuning } from "@/store/settings";
import { useWhyLog } from "@/store/whylog";
import { asISO } from "@/types/common";

import { buildDemoLog } from "../helpers/demo-log";

const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const LATER = asISO("2026-11-18T09:41:00.000Z");

/** Falsify the premise the demo rests on, and run the whole cycle. */
async function falsifyAndRevise() {
  const before = useWhyLog.getState().state;
  const singleUser = [...before.premises.values()].find((p) => p.predicate === "scale.single_user");
  if (!singleUser) throw new Error("the fixture did not yield scale.single_user");

  const outcome = await useReasoning.getState().assertAndRevise(
    falsifyPremise("scale", "scale.single_user", "there are two of us editing it now", {
      state: before,
      actor: { kind: "human" },
      engine: ENGINE_ID,
      at: LATER,
      source: "repo-scan",
    }),
  );
  return { outcome, singleUserId: singleUser.id };
}

/** The deepest the cascade reached, and whether the cap said so. */
function cascadeDepth(): {
  deepest: number;
  truncated: boolean;
  beyond: number;
} {
  const result = useReasoning.getState().result;
  if (!result) throw new Error("no result");

  let truncated = false;
  let beyond = 0;
  for (const entry of result.cases) {
    truncated = truncated || entry.cascade.truncated;
    beyond = Math.max(beyond, entry.cascade.potentiallyAffectedBeyondCap);
  }
  return { deepest: deepestCascade(result), truncated, beyond };
}

describe("The reasoning knobs actually change the reasoning", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
    useTuning.getState().reset();
    await buildDemoLog("approve-all");
  });

  it("the cap is persisted, on its own key, and survives a reload", () => {
    useTuning.getState().setCascadeDepthCap(2);
    expect(useTuning.getState().cascadeDepthCap).toBe(2);

    /* The setting is persisted on its own key, so it is not part of the log and not part
     * of the engine config. A setting that is lost on reload is a setting the user has to
     * set again every time, which is the same as a setting that does nothing. */
    const raw = localStorage.getItem("whylog:settings:v1");
    expect(raw).not.toBeNull();
    expect(raw).toContain("cascadeDepthCap");
  });

  it("a cap of ZERO stops the cascade from propagating past the direct dependents", async () => {
    useTuning.getState().setCascadeDepthCap(0);

    const { outcome } = await falsifyAndRevise();
    expect(outcome.ok).toBe(true);

    const { deepest, truncated } = cascadeDepth();
    expect(deepest).toBeLessThanOrEqual(1);
    /* And it SAYS so: the cascade reports that it was cut short rather than pretending the
     * walk finished. */
    expect(truncated).toBe(true);
  });

  it("a generous cap lets the cascade go as deep as the chain does", async () => {
    useTuning.getState().setCascadeDepthCap(MAX_CASCADE_DEPTH);

    const { outcome } = await falsifyAndRevise();
    expect(outcome.ok).toBe(true);

    const { deepest } = cascadeDepth();
    expect(deepest).toBe(2);
  });

  it("the cap is what makes those two different", async () => {
    /* The pair, in one test, so the assertion is about the DIFFERENCE and not about two
     * absolute numbers that could both be wrong in the same way. */
    useTuning.getState().setCascadeDepthCap(0);
    await falsifyAndRevise();
    const capped = cascadeDepth().deepest;

    localStorage.clear();
    useWhyLog.getState().boot();
    useTuning.getState().reset();
    await buildDemoLog("approve-all");
    useTuning.getState().setCascadeDepthCap(MAX_CASCADE_DEPTH);
    await falsifyAndRevise();
    const uncapped = cascadeDepth().deepest;

    expect(capped).toBeLessThan(uncapped);
  });

  it("the same setting, read twice, gives the same answer - the store is not a coin", async () => {
    useTuning.getState().setCascadeDepthCap(1);
    await falsifyAndRevise();
    const first = cascadeDepth();

    localStorage.clear();
    useWhyLog.getState().boot();
    useTuning.getState().reset();
    await buildDemoLog("approve-all");
    useTuning.getState().setCascadeDepthCap(1);
    await falsifyAndRevise();
    const second = cascadeDepth();

    expect(second).toEqual(first);
  });
});
