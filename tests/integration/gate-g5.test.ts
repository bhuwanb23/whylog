/**
 * Gate G5 — "it closes the loop".
 *
 * Plan: plan/OVERVIEW.md §5.2
 *   "G5 - It closes the loop | P5 | Does the export carry the reasoning *and* the check?
 *    | Generated `CLAUDE.md` shows WLD-0007 with MUST/MUST NOT, `applies_to`,
 *      rejected alternatives, and a runnable verify command"
 *
 * G5 is the only gate that was never executed, and the reason it could not be
 * executed is that `checkGateG5` lived inside a React component: the nine
 * predicates that make the gate a gate were reachable only by clicking a button
 * in a browser. They now live in `src/export/gate-g5.ts` and are called here
 * against a real compiled artifact.
 *
 * The chain matters. A verify command exists only for an ACCEPTED guard, so the
 * gate needs Phase 4 to have run: synthesise the guards, accept them, run them,
 * and only then compile. On a log with no accepted guards the artifact honestly
 * says `Verify: none — UNVERIFIABLE` and the gate fails — which is the correct
 * outcome, not a broken test.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createLocalEngine } from "@/ai/local";
import { compile } from "@/export/compiler";
import { checkGateG5, renderGateG5 } from "@/export/gate-g5";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { useGuards } from "@/store/guards";
import { useWhyLog } from "@/store/whylog";
import { type TranscriptId, asISO } from "@/types/common";

const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");

/** The manifest G4 uses, so the guards have something to check. */
const MANIFEST = JSON.stringify({
  name: "demo",
  version: "1.0.0",
  dependencies: { pg: "^8.11.3", next: "^15.1.0" },
});

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

/** Synthesise, accept and run the guards, so the decisions have verify commands. */
async function runGuards() {
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
}

/** Compile the export and hand back the CLAUDE.md artifact. */
async function compileClaudeMd() {
  const state = useWhyLog.getState().state;
  const result = await compile({
    state,
    headHash: useWhyLog.getState().log.headHash,
    actor: { kind: "system" },
  });

  const claude = result.artifacts.find((a) => a.target === "claude-md");
  expect(claude).toBeDefined();
  if (!claude) throw new Error("no CLAUDE.md artifact");
  return claude;
}

describe("Gate G5 — it closes the loop", () => {
  beforeEach(() => {
    localStorage.clear();
    useWhyLog.getState().boot();
  });

  it("the gate refuses an artifact that has not been compiled", () => {
    const checks = checkGateG5(null);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.passed).toBe(false);
    expect(checks[0]?.evidence).toContain("Nothing has been compiled");
  });

  it("every clause of the gate is a predicate, and all nine are present", async () => {
    await buildLog();
    await runGuards();
    const claude = await compileClaudeMd();

    const checks = checkGateG5(claude.contents);
    expect(checks).toHaveLength(9);
    for (const check of checks) {
      expect(typeof check.property).toBe("string");
      expect(typeof check.passed).toBe("boolean");
      expect(check.evidence.length).toBeGreaterThan(0);
    }
  });

  it("a compiled artifact with accepted guards passes every clause", async () => {
    await buildLog();
    await runGuards();
    const claude = await compileClaudeMd();

    const checks = checkGateG5(claude.contents);
    const failed = checks.filter((check) => !check.passed);

    expect(renderGateG5(failed)).toBe("");
    expect(failed.map((check) => check.property)).toEqual([]);
  });

  it("the artifact carries the reasoning AND the check", async () => {
    await buildLog();
    await runGuards();
    const claude = await compileClaudeMd();
    const contents = claude.contents;

    // The reasoning: an imperative rule, a scope, the premises it rests on, and
    // the alternatives that were turned down.
    expect(contents).toMatch(/\bMUST\b/);
    expect(contents).toMatch(/^Applies to:\s*\S/m);
    expect(contents).toMatch(/^Because:.*\bP-[0-9]/m);
    expect(contents).toMatch(/^Rejected:/m);

    // The check: a runnable command, and a stamp tying it to the log.
    expect(contents).toMatch(/^Verify:\s*(?!none)/m);
    expect(contents).toContain("<!-- whylog:stamp");
    expect(contents).toContain("Do not re-litigate without superseding this record.");
  });

  it("without accepted guards the artifact says UNVERIFIABLE and the gate fails", async () => {
    // No guard run: no accepted guard, so no verify command.
    await buildLog();
    const claude = await compileClaudeMd();

    expect(claude.contents).toMatch(/^Verify:\s*none/m);

    const checks = checkGateG5(claude.contents);
    const verify = checks.find((check) => check.property === "a runnable verify command");
    expect(verify?.passed).toBe(false);
  });
});
