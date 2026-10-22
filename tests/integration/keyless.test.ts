/**
 * The keyless path, end to end.
 *
 * CI runs this file by name (`.github/workflows/ci.yml`, "Keyless end-to-end
 * path"), and it is the one test that exercises the WHOLE product rather than
 * one phase: a transcript is imported, reviewed, committed, reasoned over,
 * checked against code, and compiled into an agent file — with no API key, no
 * network and no model.
 *
 * "Invariant territory: the whole product must work keyless." If this file
 * fails, the product has a dependency it never admitted to.
 */

import { compile } from "@/export/compiler";
import { checkGateG5 } from "@/export/gate-g5";
import { parseStamp, verifyStamp } from "@/export/stamp/verify";
import { label } from "@/reasoning/labeller";
import { useGuards } from "@/store/guards";
import { useReasoning } from "@/store/reasoning";
import { useWhyLog } from "@/store/whylog";
import { beforeEach, describe, expect, it } from "vitest";

import { buildDemoLog } from "../helpers/demo-log";

const MANIFEST = JSON.stringify({
  name: "demo",
  version: "1.0.0",
  dependencies: { pg: "^8.11.3", next: "^15.1.0" },
});

describe("the keyless path, end to end", () => {
  beforeEach(() => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("transcript in, agent file out, with no key and no model", async () => {
    /* 1. IMPORT — the local engine reads a transcript and proposes decisions. */
    /* 2. REVIEW — a human approves what was proposed: the six decisions the fixture's
     *    EXPECTED EXTRACTION names, and discards the rest. The local engine also proposes
     *    the assistant's QUESTIONS and the REJECTED ALTERNATIVES, and approving those would
     *    leave the log contradicting itself — which the pre-export gate (5.6) refuses to
     *    compile, correctly. See tests/helpers/demo-log.ts. */
    const state = await buildDemoLog("curated");

    /* 3. THE LOG — decisions and premises, with labels. */
    expect(state.decisions.size).toBeGreaterThan(0);
    expect(state.premises.size).toBeGreaterThan(0);

    const labels = label(state).labels;
    const live = [...state.decisions.values()].filter((d) => labels.get(d.id)?.label === "IN");
    expect(live.length).toBeGreaterThan(0);

    /* 4. THE REASONING — the labeller reaches a fixpoint. */
    const labelled = label(state);
    expect(labelled.fixpointReached).toBe(true);

    /* 5. THE CHECK — guards are compiled from the decisions and run against the
     *    project. No model is consulted: templates only. */
    useGuards.getState().loadProject({ manifest: MANIFEST });
    const synthesised = await useGuards.getState().synthesise({ templatesOnly: true });
    expect(synthesised.ok).toBe(true);

    for (const guard of [...useWhyLog.getState().state.guards.values()].filter(
      (g) => g.lifecycle === "proposed",
    )) {
      const accepted = useGuards.getState().accept(guard.id);
      expect(accepted.ok).toBe(true);
    }

    const ran = await useGuards.getState().run();
    expect(ran.ok).toBe(true);

    /* 6. THE EXPORT — one graph becomes agent files, in one pass. */
    const headHash = useWhyLog.getState().log.headHash;
    const result = await compile({
      state: useWhyLog.getState().state,
      headHash,
      actor: { kind: "system" },
    });

    expect(result.blocked).toBe(false);
    expect(result.artifacts.length).toBeGreaterThan(0);

    const claude = result.artifacts.find((a) => a.target === "claude-md");
    expect(claude).toBeDefined();
    if (!claude) return;

    const parsed = parseStamp(claude.contents);
    expect(parsed?.headHash).toBe(headHash);

    /* 7. THE GATE — the artifact carries the reasoning AND the check. */
    const checks = checkGateG5(claude.contents);
    const failed = checks.filter((check) => !check.passed);
    expect(failed.map((check) => check.property)).toEqual([]);

    /* 8. THE STAMP — the artifact is tied back to the log that produced it. */
    const verification = verifyStamp({
      contents: claude.contents,
      currentHeadHash: headHash,
    });
    if (!verification.ok) {
      throw new Error(
        `stamp verification failed: ${verification.reason} (expected ${verification.expected}, found ${verification.found ?? "nothing"})`,
      );
    }
    expect(verification.ok).toBe(true);
  });

  it("the reasoning store runs keyless and reports no error", async () => {
    await buildDemoLog("curated");

    const reasoning = useReasoning.getState();
    expect(reasoning.error).toBeNull();
  });
});
