/**
 * Phase 0 — the round-trip test the plan demands.
 *
 * Plan: plan/phase-0-foundation.md §0.10 acceptance criteria
 *   "A round-trip test exists: append events -> materialise -> export -> import
 *    -> materialise -> assert identical state and head hash."
 *
 * This is the load-bearing test of the whole substrate. If it fails, the audit
 * trail, the time machine (Phase 6.7) and the export stamp (Phase 5) are all
 * worthless, because each of them assumes that an event list uniquely determines
 * a state.
 *
 * Everything here is local: no key, no network, no fixtures on disk.
 */

import { describe, expect, it } from "vitest";

import { type EventLog, append, emptyLog } from "@/substrate/event-log";
import type { GraphState } from "@/substrate/graph-state";
import { verifyChain } from "@/substrate/hash-chain";
import { type FoldOptions, fold, materializeAsOf, rebuild } from "@/substrate/materialize";
import { type PortableStats, exportLog, importLog, serializeLog } from "@/substrate/portability";
import {
  type Actor,
  type EngineId,
  type EpisodeId,
  type EventId,
  type TranscriptId,
  asConfidence,
  asDecisionId,
  asISO,
  asPremiseId,
} from "@/types/common";
import type { AnyEvent } from "@/types/events";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ENGINE: EngineId = { kind: "local", model: "hashed-ngram-v1" };
const HUMAN: Actor = { kind: "human" };

const T0 = asISO("2026-10-03T09:00:00.000Z");
const T1 = asISO("2026-10-03T09:05:00.000Z");
const T2 = asISO("2026-10-03T09:10:00.000Z");

const TRANSCRIPT_ID = "T-0001" as TranscriptId;
const EPISODE_ID = "E-0001" as EpisodeId;
const DECISION_ID = asDecisionId("WLD-0001");
const PREMISE_ID = asPremiseId("P-0001");

const FOLD_OPTIONS: FoldOptions = { engine: ENGINE, now: T2 };

/**
 * A three-event log: a transcript, a decision resting on a premise, and the
 * approval that moves the decision out of the review queue.
 */
function buildLog(): EventLog {
  let log = emptyLog();

  const imported = append(
    log,
    {
      type: "TranscriptImported",
      payload: {
        transcriptId: TRANSCRIPT_ID,
        rawChars: 128,
        label: "oct 3",
        occurredAt: T0,
        engine: ENGINE,
      },
      actor: HUMAN,
      reason: "pasted a transcript",
      at: T0,
      occurredAt: T0,
    },
    { now: T0, actor: HUMAN, reason: "pasted a transcript" },
  );
  expect(imported.ok).toBe(true);
  if (!imported.ok) throw new Error("setup failed");
  log = imported.log;

  const proposed = append(
    log,
    {
      type: "DecisionProposed",
      payload: {
        decisionId: DECISION_ID,
        transcriptId: TRANSCRIPT_ID,
        episodeId: EPISODE_ID,
        variable: "DATABASE",
        value: "sqlite",
        statement: "Use SQLite, not Postgres",
        rationale: "no deploy infrastructure",
        origin: "human_stated",
        modality: "asserted",
        confidence: asConfidence(0.9),
        engine: ENGINE,
        snippet: { transcriptId: TRANSCRIPT_ID, start: 0, end: 24, text: "we will use sqlite" },
        premiseIds: [PREMISE_ID],
        alternativeIds: [],
      },
      actor: HUMAN,
      reason: "extracted from transcript",
      at: T1,
      occurredAt: T1,
    },
    { now: T1, actor: HUMAN, reason: "extracted from transcript" },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) throw new Error("setup failed");
  log = proposed.log;

  const approved = append(
    log,
    {
      type: "DecisionApproved",
      payload: { decisionId: DECISION_ID, viaBulkApprove: false },
      actor: HUMAN,
      reason: "reviewed and approved",
      at: T2,
      occurredAt: T2,
    },
    { now: T2, actor: HUMAN, reason: "reviewed and approved" },
  );
  expect(approved.ok).toBe(true);
  if (!approved.ok) throw new Error("setup failed");
  log = approved.log;

  return log;
}

function statsOf(state: GraphState): PortableStats {
  return {
    events: state.events.length,
    decisions: state.decisions.size,
    premises: state.premises.size,
    guards: state.guards.size,
    transcripts: state.transcripts.size,
  };
}

/* -------------------------------------------------------------------------- */
/* The tests                                                                   */
/* -------------------------------------------------------------------------- */

describe("Phase 0 round-trip", () => {
  it("appends, materialises, exports, imports and reproduces the same state", () => {
    const log = buildLog();
    const original = fold(log.events, FOLD_OPTIONS);

    expect(original.headHash).not.toBe("");
    expect(original.events.length).toBe(3);

    const exported = exportLog(log.events, log.headHash, statsOf(original), ENGINE, T2);
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.error);

    const raw = serializeLog(exported.value);
    const imported = importLog(raw, { existingIds: null, existingHeadHash: "" });
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.rejection.reason);

    expect(imported.outcome.newEvents.length).toBe(3);
    expect(imported.outcome.duplicates).toBe(0);

    const roundTripped = fold(imported.outcome.newEvents, FOLD_OPTIONS);

    // THE assertion the plan names: identical head hash.
    expect(roundTripped.headHash).toBe(original.headHash);

    // And identical materialised state — the head hash matching is necessary
    // but not sufficient; a fold that hashed correctly and built the wrong
    // graph would still pass the hash check.
    expect(roundTripped.decisions.size).toBe(original.decisions.size);
    expect(roundTripped.premises.size).toBe(original.premises.size);
    expect([...roundTripped.decisions.keys()].sort()).toEqual(
      [...original.decisions.keys()].sort(),
    );
    expect(roundTripped.counters).toEqual(original.counters);
  });

  it("re-importing the same file into the same log adds nothing", () => {
    const log = buildLog();
    const original = fold(log.events, FOLD_OPTIONS);
    const exported = exportLog(log.events, log.headHash, statsOf(original), ENGINE, T2);
    if (!exported.ok) throw new Error(exported.error);
    const raw = serializeLog(exported.value);

    const existingIds = new Set<EventId>(log.events.map((e) => e.id));
    const imported = importLog(raw, { existingIds, existingHeadHash: log.headHash });
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.rejection.reason);

    expect(imported.outcome.newEvents.length).toBe(0);
    expect(imported.outcome.duplicates).toBe(3);
  });
});

describe("Phase 0 invariants", () => {
  it("the fold is pure: the same events always produce the same state", () => {
    const log = buildLog();
    const a = fold(log.events, FOLD_OPTIONS);
    const b = fold(log.events, FOLD_OPTIONS);

    expect(a.headHash).toBe(b.headHash);
    expect(a.counters).toEqual(b.counters);
    expect([...a.decisions.keys()]).toEqual([...b.decisions.keys()]);
  });

  it("projections are rebuildable from scratch (delete and rebuild)", () => {
    const log = buildLog();
    const state = fold(log.events, FOLD_OPTIONS);
    const rebuilt = rebuild(state, FOLD_OPTIONS);

    expect(rebuilt.headHash).toBe(state.headHash);
    expect(rebuilt.decisions.size).toBe(state.decisions.size);
    expect(rebuilt.premises.size).toBe(state.premises.size);
  });

  it("the hash chain detects an edited payload AT the edited event", () => {
    const log = buildLog();
    expect(verifyChain(log.events).valid).toBe(true);

    const tampered = [...log.events] as AnyEvent[];
    const victim = tampered[1];
    if (!victim) throw new Error("setup failed");
    tampered[1] = {
      ...victim,
      payload: { ...(victim.payload as unknown as Record<string, unknown>), value: "postgres" },
    } as AnyEvent;

    const verification = verifyChain(tampered);
    expect(verification.valid).toBe(false);

    // The edit is reported at index 1 — the event that was edited — not at the
    // next one. That is what the event's own `selfHash` buys.
    expect(verification.firstBadIndex).toBe(1);
    const first = verification.violations[0];
    expect(first?.kind).toBe("self-hash-mismatch");
    expect(first?.index).toBe(1);
  });

  it("an edit to the LAST event is detected too", () => {
    const log = buildLog();
    const tampered = [...log.events] as AnyEvent[];
    const last = tampered[tampered.length - 1];
    if (!last) throw new Error("setup failed");
    tampered[tampered.length - 1] = {
      ...last,
      reason: "a different reason",
    } as AnyEvent;

    // Without a per-event content hash, nothing downstream references the last
    // event, so only the head-hash comparison would catch this.
    const verification = verifyChain(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.firstBadIndex).toBe(tampered.length - 1);
  });

  it("a broken chain is refused on export rather than stamped", () => {
    const log = buildLog();
    const tampered = [...log.events] as AnyEvent[];
    const victim = tampered[0];
    tampered[0] = { ...victim, reason: "a different reason" } as AnyEvent;

    const exported = exportLog(
      tampered,
      log.headHash,
      statsOf(fold(log.events, FOLD_OPTIONS)),
      ENGINE,
      T2,
    );
    expect(exported.ok).toBe(false);
  });

  it("bi-temporal: what was known on Oct 3 is answerable by learned time", () => {
    const log = buildLog();
    const state = fold(log.events, FOLD_OPTIONS);
    expect(state.decisions.size).toBe(1);

    // Before the approval, the decision existed but had not been approved.
    const earlier = materializeAsOf(log.events, T1, FOLD_OPTIONS);
    expect(earlier.decisions.size).toBe(1);
    expect(earlier.pendingReview.length).toBe(1);

    const later = materializeAsOf(log.events, T2, FOLD_OPTIONS);
    expect(later.pendingReview.length).toBe(0);
  });
});
