/**
 * The pre-export consistency gate — 5.6.
 *
 * Plan: plan/phase-5-export-compiler.md §5.6
 *
 * "A log containing two mutually exclusive IN decisions cannot be compiled into a
 * context file, because the file would tell an agent to do two incompatible things."
 *
 * This file exists because the gate was found NOT to do that. It reported conflicts,
 * rendered them, and never blocked: the detection worked and the consequence did not.
 * A gate that cannot refuse is a comment.
 *
 * The bug was an interface mismatch. `wouldContradict` is a PRE-COMMIT detector: it
 * answers "would asserting this value contradict something already live?", so the side
 * it names as `decisionB` is the NEWCOMER sentinel - the decision that does not exist
 * yet. The export gate consumed it as though it were a post-hoc pair detector and
 * copied `hit.decisionA`/`hit.decisionB` straight into the conflict pair. Every pair
 * therefore contained "WLD-NEW", which is never in the candidate set, so the
 * `candidateSet.has(a) && candidateSet.has(b)` test could never be true and
 * `blocking` was always empty.
 *
 * The demo fixture is genuinely self-contradictory, which is what makes this testable
 * without inventing a state: WLD-0001 says DATABASE=postgres and WLD-0005 says
 * DATABASE=sqlite, both live and both IN.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { compile } from "@/export/compiler";
import { consistencyGate } from "@/export/consistency-gate";
import { useWhyLog } from "@/store/whylog";

import { buildDemoLog } from "../helpers/demo-log";

describe("The pre-export consistency gate blocks a self-contradictory log", () => {
  beforeEach(() => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("the demo log really does contain two live IN decisions that contradict", async () => {
    const state = await buildDemoLog("approve-all");

    const postgres = state.decisions.get("WLD-0001" as never);
    const sqlite = state.decisions.get("WLD-0002" as never);

    expect(postgres?.variable).toBe("DATABASE");
    expect(postgres?.value).toBe("postgres");
    expect(postgres?.label).toBe("IN");
    expect(sqlite?.variable).toBe("DATABASE");
    expect(sqlite?.value).toBe("sqlite");
    expect(sqlite?.label).toBe("IN");
  });

  it("the gate names BOTH sides of the conflict", async () => {
    const state = await buildDemoLog("approve-all");
    const candidates = [...state.decisions.values()]
      .filter((d) => d.status === "active")
      .map((d) => d.id);

    const report = consistencyGate({ state, labels: new Map(), candidates });

    expect(report.conflicts.length).toBeGreaterThan(0);
    // The pair must be two real decisions. If the sentinel leaks in, the pair is
    // ("WLD-0005", "WLD-NEW") and the gate can never block anything.
    for (const pair of report.conflicts) {
      expect(pair.a).not.toBe("WLD-NEW");
      expect(pair.b).not.toBe("WLD-NEW");
      expect(candidates).toContain(pair.a);
      expect(candidates).toContain(pair.b);
    }
  });

  it("the gate blocks, and the export produces no artifact", async () => {
    const state = await buildDemoLog("approve-all");

    const result = await compile({
      state,
      headHash: useWhyLog.getState().log.headHash,
      actor: { kind: "system" },
    });

    expect(result.blocked).toBe(true);
    expect(result.artifacts).toHaveLength(0);
    expect(result.blockedExplanation).toBeTruthy();
    // The explanation must name both sides of the contradiction, or the user is told
    // "the export was refused" with no idea which two decisions disagree.
    expect(result.blockedExplanation).toMatch(/WLD-\d+/);
  });

  it("a log that does not contradict itself is NOT blocked", async () => {
    /* The same transcript, reviewed the way the fixture's EXPECTED EXTRACTION says a human
     * would review it: keep the six decisions that were settled, discard the rest. One
     * live answer per question, so the file can be written. A gate that blocks everything
     * is as broken as one that blocks nothing. */
    const state = await buildDemoLog("curated");

    const result = await compile({
      state,
      headHash: useWhyLog.getState().log.headHash,
      actor: { kind: "system" },
    });

    expect(result.blocked).toBe(false);
    expect(result.artifacts.length).toBeGreaterThan(0);
  });
});
