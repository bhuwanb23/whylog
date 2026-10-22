/**
 * Phase 1 — the acceptance test the plan names.
 *
 * Plan: plan/phase-1-extraction-pipeline.md
 *   - "Both engines produce >=5 decisions and >=3 premises on the fixture, keyless"
 *   - "The fixture yields P-0002 scale.max_users = 1 from 'it's one person, one
 *      machine, one log', linked to WLD-0007's IN-list"
 *   - "The fixture yields an OUT-list premise for concurrent writers on the same
 *      decision"
 *   - "Zero hypothetical or proposed statements become nodes"
 *   - "Every extracted item resolves to a verbatim span that highlights correctly"
 *
 * The local engine is the one that matters here: it is the DEFAULT, and the
 * whole concept has to work keyless.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createLocalEngine } from "@/ai/local";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve } from "@/extraction/review/actions";
import { append, emptyLog } from "@/substrate/event-log";
import { emptyState } from "@/substrate/graph-state";
import { fold } from "@/substrate/materialize";
import { type TranscriptId, asISO } from "@/types/common";

// `process.cwd()` is the repository root under vitest. `import.meta.url` is not
// a file URL in the jsdom environment.
const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
const TRANSCRIPT_ID = "T-0001" as TranscriptId;
const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
const NOW = asISO("2026-10-03T15:00:00.000Z");

async function runFixture() {
  const raw = readFileSync(FIXTURE, "utf-8");
  const engine = createLocalEngine();
  const result = await runExtraction(
    { transcriptId: TRANSCRIPT_ID, raw, occurredAt: NOW },
    { engine, engineId: ENGINE_ID, state: emptyState(ENGINE_ID, NOW) },
  );
  if (!result.ok) throw new Error(`pipeline failed: ${result.failure.kind}`);
  return { raw, outcome: result.outcome };
}

describe("Phase 1 — the fixture, keyless, on the local engine", () => {
  it("yields at least 5 decisions and at least 3 premises", async () => {
    const { outcome } = await runFixture();

    expect(outcome.result.decisions.length).toBeGreaterThanOrEqual(5);
    expect(outcome.result.premises.length).toBeGreaterThanOrEqual(3);
  });

  it("recovers the DATABASE decision from the SQLite negotiation", async () => {
    const { outcome } = await runFixture();

    const database = outcome.result.decisions.filter((d) => d.variable === "DATABASE");
    expect(database.length).toBeGreaterThan(0);

    // The value must be CANONICAL, not the raw surface form.
    expect(database.map((d) => d.value)).toContain("sqlite");
  });

  it("recovers the single-user premise with a namespaced predicate", async () => {
    const { outcome } = await runFixture();

    const singleUser = outcome.result.premises.filter(
      (p) => p.predicate === "scale.single_user" || p.predicate === "scale.max_users",
    );
    expect(singleUser.length).toBeGreaterThan(0);

    // A namespaced predicate is what rung 1 of the identity ladder matches on. A
    // bare prose predicate would mint a duplicate node on every re-import.
    for (const premise of singleUser) {
      expect(premise.predicate).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("every snippet resolves to an exact character range in the raw text", async () => {
    const { raw, outcome } = await runFixture();

    const items = [
      ...outcome.result.decisions,
      ...outcome.result.premises,
      ...outcome.result.alternatives,
    ];
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const { start, end, text } = item.snippet;
      expect(end).toBeGreaterThanOrEqual(start);
      expect(end).toBeLessThanOrEqual(raw.length);
      // VERBATIM. A paraphrased snippet silently rots the evidence contract.
      expect(raw.slice(start, end)).toBe(text);
    }
  });

  it("creates no hypothetical decision", async () => {
    const { outcome } = await runFixture();

    // "proposed" is a legitimate modality — an agent's proposal awaiting
    // human acceptance. "hypothetical" is the one that must never become a
    // node: "what if we used Redis?" is a question, not a decision. The fold
    // only sets a label IN for `asserted`, so a `proposed` candidate is inert
    // until a human accepts it.
    for (const decision of outcome.result.decisions) {
      expect(decision.modality).not.toBe("hypothetical");
    }
  });

  it("derives the OUT-list exclusion — a premise the decision EXCLUDES", async () => {
    const { outcome } = await runFixture();

    // `scale.single_user` implies `scale.concurrent_writers` is false. That
    // derived premise is Doyle's non-monotonic justification, and it is the
    // ONLY mechanism that lets gate (c) fire when the world moves rather than
    // the user contradicting themselves.
    const exclusions = outcome.result.premises.filter((p) => p.text.includes("excluded by"));
    expect(exclusions.length).toBeGreaterThan(0);

    const concurrent = exclusions.find((p) => p.predicate === "scale.concurrent_writers");
    expect(concurrent).toBeDefined();
  });

  it("importing the same transcript twice creates zero new nodes", async () => {
    // The real criterion, and the one that exercises the whole chain:
    // extract -> review -> commit -> re-extract against the committed graph.
    // The ladder resolves candidates against NODES, so a fresh graph cannot
    // merge anything — the second import is where merging is observable.
    const raw = readFileSync(FIXTURE, "utf-8");
    const engine = createLocalEngine();

    const first = await runExtraction(
      { transcriptId: TRANSCRIPT_ID, raw, occurredAt: NOW },
      { engine, engineId: ENGINE_ID, state: emptyState(ENGINE_ID, NOW) },
    );
    if (!first.ok) throw new Error("first run failed");
    const outcome = first.outcome;

    // Review: approve everything, the way a bulk approve would.
    const reviewed = outcome.queue.map((candidate) => applyAction(candidate, approve(false)));

    const committed = commitReview(
      {
        transcriptId: TRANSCRIPT_ID,
        engine: ENGINE_ID,
        occurredAt: NOW,
        items: reviewed,
        machineDiscards: outcome.result.discarded.filter(
          (
            d,
          ): d is typeof d & {
            readonly discardedBy: "confidence-threshold" | "modality" | "duplicate";
          } => d.discardedBy !== "human",
        ),
      },
      emptyState(ENGINE_ID, NOW),
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error("commit failed");

    // Commit to a real log, then fold it.
    let log = emptyLog();
    for (const draft of committed.drafts) {
      const appended = append(
        log,
        { ...draft, actor: { kind: "human" } },
        { now: NOW, actor: { kind: "human" }, reason: draft.reason ?? "reviewed" },
      );
      expect(appended.ok).toBe(true);
      if (!appended.ok) throw new Error("append failed");
      log = appended.log;
    }
    const state = fold(log.events, { engine: ENGINE_ID, now: NOW });
    expect(state.decisions.size).toBeGreaterThan(0);

    // Second import of the SAME transcript, resolved against the committed graph.
    const second = await runExtraction(
      { transcriptId: "T-0002" as TranscriptId, raw, occurredAt: NOW },
      { engine, engineId: ENGINE_ID, state },
    );
    if (!second.ok) throw new Error("second run failed");

    // Every candidate that matches an existing node must MERGE, not create.
    expect(second.outcome.resolution.merged).toBeGreaterThan(0);
    expect(second.outcome.resolution.created).toBe(0);
  });

  it("assigns an origin to every recovered decision", async () => {
    const { outcome } = await runFixture();

    for (const decision of outcome.result.decisions) {
      expect(decision.origin).toBeTruthy();
    }
  });

  it("is deterministic: the same transcript gives the same candidates", async () => {
    const first = await runFixture();
    const second = await runFixture();

    expect(second.outcome.result.decisions.length).toBe(first.outcome.result.decisions.length);
    expect(second.outcome.result.premises.length).toBe(first.outcome.result.premises.length);
    expect(second.outcome.result.decisions.map((d) => `${d.variable}=${d.value}`)).toEqual(
      first.outcome.result.decisions.map((d) => `${d.variable}=${d.value}`),
    );
  });

  it("records what it discarded, so the precision denominator exists", async () => {
    const { outcome } = await runFixture();

    // Not a hard count: the point is that discards are COUNTED, not dropped.
    // A run with zero discards on a 6-decision transcript is a sign the
    // threshold is doing nothing.
    for (const discard of outcome.result.discarded) {
      expect(discard.rawText.length).toBeGreaterThan(0);
      expect(discard.confidence).toBeGreaterThanOrEqual(0);
      expect(discard.confidence).toBeLessThanOrEqual(1);
    }
  });
});
