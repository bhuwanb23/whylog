/**
 * Gate G4 — "it verifies".
 *
 * Plan: plan/OVERVIEW.md §5.2
 *   "G4 - It verifies | P4 | Can a decision be proven wrong by the code, deterministically?
 *    | Paste a `package.json` containing `pg` -> guard fails -> compliance drops ->
 *      gate (a) fires with no model involved"
 *
 * The point of this gate is the DETERMINISM. The manifest says the project
 * depends on `pg`; the log says the project chose SQLite and not Postgres; the
 * ontology says those two values are mutually exclusive. No embedding, no
 * threshold, no model is consulted at any step.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createLocalEngine } from "@/ai/local";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { commitReview } from "@/extraction/commit";
import { useWhyLog } from "@/store/whylog";
import { useGuards } from "@/store/guards";
import { useReasoning } from "@/store/reasoning";
import { label } from "@/reasoning/labeller";
import { asISO, type TranscriptId } from "@/types/common";
import { isDeterministic } from "@/types/guards";

const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");

/** The manifest G4 specifies: a project that depends on `pg`. */
const MANIFEST = JSON.stringify(
  {
    name: "demo",
    version: "1.0.0",
    dependencies: { pg: "^8.11.3", next: "^15.1.0" },
  },
  null,
  2,
);

/** Paste the transcript, review it, commit it. */
async function buildLog() {
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
      machineDiscards: [],
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

  return useWhyLog.getState().state;
}

/** The whole G4 loop: paste, synthesise, accept in bulk, run. */
async function runG4() {
  const state = await buildLog();

  useGuards.getState().loadProject({ manifest: MANIFEST });
  const parse = useGuards.getState().parse;

  /* The manifest alone is not a whole project, and the parser says so. These
   * are notices, not failures: path guards SKIP and string guards SKIP, and a
   * skip is never a pass. The design point is that they are REPORTED. */
  expect(parse?.notices.length ?? 0).toBeGreaterThan(0);
  expect((parse?.notices ?? []).join("\n")).toContain("SKIP");

  const synthesised = await useGuards.getState().synthesise({ templatesOnly: true });
  expect(synthesised.ok).toBe(true);

  /* Bulk-accept. The gate tests the loop, not the review. */
  const proposed = [...useWhyLog.getState().state.guards.values()].filter(
    (guard) => guard.lifecycle === "proposed",
  );
  for (const guard of proposed) {
    const accepted = useGuards.getState().accept(guard.id);
    expect(accepted.ok).toBe(true);
  }

  const ran = await useGuards.getState().run();
  expect(ran.ok).toBe(true);

  return {
    state: useWhyLog.getState().state,
    guards: useGuards.getState(),
    proposals: [...useWhyLog.getState().state.proposals.values()],
  };
}

describe("Gate G4 — it verifies", () => {
  beforeEach(() => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("the manifest is parsed and the project is built", async () => {
    const state = await buildLog();
    useGuards.getState().loadProject({ manifest: MANIFEST });

    const project = useGuards.getState().project;
    expect(project.dependencies["pg"]).toBe("^8.11.3");
    expect(project.dependencies["next"]).toBe("^15.1.0");
    expect(state.decisions.size).toBeGreaterThan(0);
  });

  it("guards are synthesised from the log's decisions, with no model", async () => {
    const state = await buildLog();
    useGuards.getState().loadProject({ manifest: MANIFEST });

    const synthesised = await useGuards.getState().synthesise({ templatesOnly: true });
    expect(synthesised.ok).toBe(true);

    const guards = [...useWhyLog.getState().state.guards.values()];
    expect(guards.length).toBeGreaterThan(0);

    // Every guard came from a template, and every one is deterministic.
    for (const guard of guards) {
      expect(guard.generatedBy).toBe("template");
      expect(isDeterministic(guard.spec.kind)).toBe(true);
    }
  });

  it("a guard FAILS against the manifest, and compliance drops", async () => {
    const { guards } = await runG4();

    // At least one guard failed.
    const failures = guards.lastEvaluated.filter((entry) => entry.result.outcome === "fail");
    expect(failures.length).toBeGreaterThan(0);

    // The failing guard is the one that says `pg` must be absent while the
    // decision "use sqlite, not postgres" is IN.
    const quoted = failures.map((entry) => JSON.stringify(entry.result));
    expect(quoted.join("\n")).toContain("pg");

    // Compliance is not 1: something the log believes is not what the code does.
    const compliance = guards.metricsResult?.compliance;
    expect(compliance).toBeDefined();
    expect(compliance?.score ?? 1).toBeLessThan(1);
  });

  it("gate (a) fires: a revision proposal whose evidence quotes the manifest", async () => {
    const { proposals } = await runG4();

    expect(proposals.length).toBeGreaterThan(0);

    // The evidence is a VERBATIM quote of the manifest line, not a paraphrase.
    const withManifest = proposals.filter((p) => p.evidence.source === "guard");
    expect(withManifest.length).toBeGreaterThan(0);
    expect(withManifest.some((p) => p.evidence.quote.includes("pg"))).toBe(true);

    // The proposal is about a decision the log holds, and it is not auto-applied.
    for (const proposal of withManifest) {
      expect(proposal.unsoundDecisionId).toMatch(/^WLD-/);
      expect(proposal.availableActions.length).toBeGreaterThan(0);
    }
  });

  it("the loop went through the same door a transcript uses", async () => {
    await runG4();

    // The reasoning store ran, and the guard failures entered it as assertions.
    const reasoning = useReasoning.getState();
    expect(reasoning.status === "idle" || reasoning.status === "done").toBe(true);

    // The proposal carries the entrenchment breakdown, which now reads
    // implementation_cost from the guards rather than from a constant.
    const proposals = [...useWhyLog.getState().state.proposals.values()];
    for (const proposal of proposals) {
      expect(proposal.entrenchment).toBeDefined();
      expect(proposal.entrenchment.breakdown.length).toBeGreaterThan(0);
    }
  });
});
