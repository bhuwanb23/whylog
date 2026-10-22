/**
 * The reasoning store — Phase 2.
 *
 * Plan: plan/phase-2-truth-maintenance.md §2.1, §2.9
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LAYER OWNS
 *
 * Exactly one thing: turning a `ReviseResult` into log events, in the right order,
 * through `recordBatch`.
 *
 * `revise()` is pure and returns drafts. It cannot write. This store is the only place
 * in Phase 2 that can, and it does so by handing the drafts to `whylog.recordBatch`,
 * which appends → folds → persists as one unit. There is no partial commit: either the
 * whole run lands or none of it does.
 *
 * That split is invariant I4 mechanically enforced. The reasoning layer produces a
 * proposal; a human action produces the retraction. The two are different functions
 * called from different places, and there is no code path from the first to the second.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RESULT IS KEPT IN A STORE AT ALL
 *
 * A run takes real time — gate (b) calls a model. If the result lived only in a local
 * variable, switching views would throw it away and the user would re-pay for it. So
 * the last run is held here, along with its status, and the view renders it.
 *
 * It is NOT persisted. A reasoning run is a derived artifact: it can always be
 * recomputed from the log, and persisting it would create a second source of truth that
 * could disagree with the first. The EVENTS it produced are persisted, by the log.
 * ---------------------------------------------------------------------------
 */

import { create } from "zustand";
import type {
  Actor,
  DecisionId,
  EngineId,
  EventId,
  ISODateString,
  JustificationId,
  PremiseId,
  ProposalId,
  TranscriptId,
} from "@/types/common";
import { asConfidence } from "@/types/common";
import type { Justification, PremiseType } from "@/types/domain";
import { canonicalPredicate } from "@/ontology/canonicalize";
import {
  formatJustificationId,
  formatPremiseId,
  formatTranscriptId,
} from "@/lib/ids";
import type { Result } from "@/lib/result";
import { err, ok } from "@/lib/result";
import { nowISO } from "@/lib/format";
import {
  assertNewInformation,
  revise,
  type AssertContext,
  type Assertion,
  type AssertionResult,
  type DecisionAssertion,
  type ReviseInput,
  type ReviseResult,
  type RevisionCase,
} from "@/reasoning";
import type { Newcomer } from "@/reasoning/adjudication";
import { useWhyLog } from "./whylog";

export type ReasoningStatus = "idle" | "running" | "done" | "failed";

export interface ReasoningState {
  readonly status: ReasoningStatus;
  readonly result: ReviseResult | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly durationMs: number;
  /** The last run's cases, flattened for list views. */
  readonly cases: readonly RevisionCase[];
  /** Which case is expanded in the UI. */
  readonly selected: ProposalId | null;
  /** True when the last run produced drafts that were committed. */
  readonly committed: number;

  readonly run: (options?: RunOptions) => Promise<Result<number, string>>;
  /** §2.1 — assert new information, then run the cycle over the result. Two batches,
   *  because the labeller must see the state AFTER the assertion is folded. */
  readonly assertAndRevise: (
    assertion: Assertion,
  ) => Promise<Result<AssertionResult, string>>;
  readonly select: (proposalId: ProposalId | null) => void;
  readonly clear: () => void;
}

export interface RunOptions {
  /** Step 1 of the cycle. Absent means "re-examine the log as it stands". */
  readonly newcomer?: Newcomer;
  /** Skip gate (b) even when a retriever exists. */
  readonly skipSemantic?: boolean;
}

/**
 * The actor for reasoning events.
 *
 * `system`, not `engine`: the labeller, the gates and the cascade are deterministic
 * graph operations. Only gate (b) involves a model, and it records its own engine id on
 * the detection. Stamping the whole run as an engine act would claim the model produced
 * the structural findings, which it did not — and the provenance would be wrong in the
 * one place where provenance is the product.
 */
const REASONING_ACTOR: Actor = { kind: "system" };

export const useReasoning = create<ReasoningState>()((set, get) => ({
  status: "idle",
  result: null,
  error: null,
  startedAt: null,
  durationMs: 0,
  cases: [],
  selected: null,
  committed: 0,

  /* ---------------------------------------------------------------------- */
  /* The run                                                                */
  /* ---------------------------------------------------------------------- */

  run: async (options) => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message = "The log is read-only: its hash chain is broken. Reasoning needs to append events.";
      set({ status: "failed", error: message });
      return err(message);
    }

    if (whylog.engine === null) {
      const message = "No engine is available. Boot the app before running a revision.";
      set({ status: "failed", error: message });
      return err(message);
    }

    if (get().status === "running") return err("A revision is already running.");

    const startedAt = nowISO() as ISODateString;
    set({ status: "running", error: null, startedAt });

    const input: ReviseInput = {
      state: whylog.state,
      engine: whylog.engine.engine,
      actor: REASONING_ACTOR,
      now: startedAt,
      ...(options?.newcomer === undefined ? {} : { newcomer: options.newcomer }),
      /* Gate (b) needs retrieval, which is Phase 3. Until there is a retriever it is
       * skipped explicitly, so the run reports it unavailable rather than guessing at
       * candidate pairs — see gates/semantic.ts. */
      skipSemantic: options?.skipSemantic ?? true,
    };

    let result: ReviseResult;
    try {
      result = await revise(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "failed", error: message });
      return err(message);
    }

    /* ---- step 9: commit, in the order revise produced ---- */
    let committed = 0;

    if (result.eventDrafts.length > 0) {
      const outcome = whylog.recordBatch(result.eventDrafts, {
        reason: `Revision run at ${startedAt}: ${result.cases.length} finding(s).`,
        actor: REASONING_ACTOR,
      });

      if (!outcome.ok) {
        set({
          status: "failed",
          error: `Reasoning completed but nothing was recorded: ${outcome.error}`,
          result,
          cases: result.cases,
          durationMs: result.durationMs,
        });
        return err(outcome.error);
      }

      committed = outcome.value.length;
    }

    set({
      status: "done",
      result,
      cases: result.cases,
      error: null,
      durationMs: result.durationMs,
      committed,
      selected: result.cases[0]?.proposal.id ?? null,
    });

    return ok(committed);
  },

  /* ---------------------------------------------------------------------- */
  /* The applying actions — separate functions, called by a human            */
  /* ---------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------- */
  /* §2.1 — the assertion entry point                                        */
  /* ---------------------------------------------------------------------- */

  assertAndRevise: async (assertion) => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message = "The log is read-only: its hash chain is broken. Nothing can be asserted.";
      set({ status: "failed", error: message });
      return err(message);
    }
    if (whylog.engine === null) {
      const message = "No engine is available. Boot the app before asserting anything.";
      set({ status: "failed", error: message });
      return err(message);
    }

    const at = nowISO() as ISODateString;

    /* ---- batch 1: ASSERT ---- */
    const asserted = assertNewInformation(assertion, {
      state: whylog.state,
      actor: actorFor(assertion.source, whylog.engineId),
      engine: whylog.engineId,
      at,
      source: assertion.source,
      ...(assertion.source === "transcript" && assertion.occurredAt !== undefined
        ? { occurredAt: assertion.occurredAt }
        : {}),
    });

    if (asserted.drafts.length > 0) {
      const outcome = whylog.recordBatch(asserted.drafts, {
        reason: `Assertion from ${assertion.source}: ${asserted.summary}`,
        actor: actorFor(assertion.source, whylog.engineId),
        ...(assertion.source === "transcript" && assertion.occurredAt !== undefined
          ? { occurredAt: assertion.occurredAt }
          : {}),
      });
      if (!outcome.ok) {
        set({ status: "failed", error: outcome.error });
        return err(outcome.error);
      }
    }

    /* ---- batch 2: REVISE, over the state the assertion produced ----
     * `run` reads `useWhyLog.getState()` itself, so it sees the post-assertion graph.
     * That is the whole point of the two-batch split: labelling the pre-assertion state
     * would label the graph as it was before the new information arrived. */
    const reviseOutcome = await get().run({
      ...(asserted.newcomer === null ? {} : { newcomer: asserted.newcomer }),
    });

    if (!reviseOutcome.ok) return err(reviseOutcome.error);

    return ok(asserted);
  },

  select: (proposalId) => set({ selected: proposalId }),

  clear: () =>
    set({
      status: "idle",
      result: null,
      cases: [],
      error: null,
      selected: null,
      committed: 0,
      durationMs: 0,
    }),
}));

/**
 * The actor for an assertion, from its source.
 *
 * A guard result and a repo scan are system acts; a hand-entered decision is a human
 * act; a reviewed transcript is an engine act that a human approved, and the approval
 * is recorded separately by the review layer. Getting this wrong would mis-stamp
 * `source_authority`, which feeds entrenchment, which decides what gets retracted.
 */
function actorFor(source: Assertion["source"], engineId: EngineId): Actor {
  switch (source) {
    case "user-decision":
      return { kind: "human" };
    case "guard-result":
    case "repo-scan":
      return { kind: "system" };
    case "transcript":
      return { kind: "engine", engine: engineId };
  }
}

/* -------------------------------------------------------------------------- */
/* The two assertions the UI can make directly                                */
/* -------------------------------------------------------------------------- */

/**
 * Falsify a premise: the G2 demonstration, and the path a repo scan will take.
 *
 * The premise is named by id and the observation is the user's own words, so the event
 * records exactly what was claimed and by whom. `assertAndRevise` then appends it and
 * runs the cycle over the result — the same nine steps, with no branch anywhere for the
 * fact that this arrived from a button rather than a transcript.
 */
export async function assertPremiseFalsified(
  premiseId: PremiseId,
  observedText: string,
): Promise<Result<string, string>> {
  const state = useWhyLog.getState().state;
  const premise = state.premises.get(premiseId);

  if (premise === undefined) return err(`No premise ${premiseId} in the log.`);
  if (observedText.trim().length === 0) {
    return err("Say what you observed. A falsification with no observation is an opinion, and the log records observations.");
  }

  const assertion: Assertion = {
    source: "repo-scan",
    observations: [
      {
        type: premise.type,
        predicate: premise.predicate,
        ...(premise.value === undefined ? {} : { value: premise.value }),
        text: observedText.trim(),
        supports: false,
        confidence: asConfidence(0.9),
      },
    ],
  };

  const outcome = await useReasoning.getState().assertAndRevise(assertion);
  if (!outcome.ok) return err(outcome.error);

  return ok(`${premiseId} falsified: "${observedText.trim()}" — ${outcome.value.summary}`);
}

/** Assert a decision by hand, with the premises it rests on. */
export async function assertUserDecision(
  variable: DecisionAssertion["variable"],
  value: string,
  statement: string,
  reason: string,
): Promise<Result<string, string>> {
  if (statement.trim().length === 0) return err("A decision needs a statement.");
  if (reason.trim().length === 0) return err("A hand-entered decision needs a reason: it is the only provenance it will ever have.");

  const assertion: Assertion = {
    source: "user-decision",
    decision: {
      variable,
      value,
      statement: statement.trim(),
      rationale: reason.trim(),
      /* `human_override`, not `human_stated`: entering a decision here can contradict
       * something already in the log, and override is the origin that carries the
       * authority to do that. It also scores 0.9 rather than 1.0 in entrenchment, so a
       * hand-entered decision does not automatically outrank everything. */
      origin: "human_override",
      confidence: asConfidence(0.95),
    },
    premises: [],
  };

  const outcome = await useReasoning.getState().assertAndRevise(assertion);
  if (!outcome.ok) return err(outcome.error);

  return ok(`Asserted ${variable} → ${value}: ${outcome.value.summary}`);
}

/* -------------------------------------------------------------------------- */
/* Applying a proposal                                                        */
/* -------------------------------------------------------------------------- */

/** Resolved to the creating event by the materialiser on fold. */
const PLACEHOLDER_EVENT_ID = "EV-000000-000000" as EventId;

/**
 * Reverse: retract the decision and record what replaces it.
 *
 * This is the human's act, not the system's. It takes a `reason` because
 * `DecisionReversed` is state-changing and the reason is what the audit shows later.
 */
export function applyReversal(
  decisionId: DecisionId,
  newValue: string,
  reason: string,
): Result<string, string> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A reversal needs a reason. Without one the log cannot say why it changed.");
  }

  const outcome = whylog.record(
    {
      type: "DecisionReversed",
      payload: {
        decisionId,
        newValue,
        /* The event that established the OLD value. It is not known here — the
         * materialiser resolves the placeholder to the creating event on fold, the same
         * mechanism the extraction commit and the revision cycle both use. */
        supersedesEventId: PLACEHOLDER_EVENT_ID,
      },
      actor: { kind: "human" },
      reason,
      at,
    },
    { reason },
  );

  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

/**
 * Rejustify: keep the decision, replace the premise it rests on.
 *
 * The most common real outcome, and the one no prior system supports. The user is
 * saying "the decision was right, the stated reason was stale" — which is different
 * from both reversing and dismissing, and needs its own event so the log can tell them
 * apart six months later.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS FOUR EVENTS AND NOT ONE
 *
 * `DecisionRejustified` names a `newPremiseId` and a `newJustificationId`. Neither
 * exists yet, and neither can be invented: ids come from the folded counters, so an id
 * made up here would either collide with a real node or point at nothing.
 *
 * So the premise and its justification are created first, in the order their referents
 * come into existence:
 *
 *   1. TranscriptImported — a human-authored transcript to hold the new premise's text.
 *      A `PremiseAsserted` event requires a verbatim snippet from SOME transcript, and
 *      fabricating a span inside the user's real transcript would claim they said
 *      something in a conversation they did not. A one-line transcript labelled as human
 *      input is the honest container, and the snippet really is verbatim from it.
 *   2. PremiseAsserted     — the new premise node.
 *   3. JustificationAttached — the new SL justification naming it.
 *   4. DecisionRejustified — the link that says which decision now rests on it.
 *
 * One `recordBatch`, so all four land or none do.
 * ---------------------------------------------------------------------------
 */
export function applyRejustification(
  decisionId: DecisionId,
  input: {
    /** What the user says the decision actually rests on. */
    readonly premiseText: string;
    readonly premiseType: PremiseType;
    /** Namespaced, e.g. "scale.max_users". Canonicalised before it is stored. */
    readonly predicate: string;
    readonly reason: string;
  },
): Result<string, string> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;
  const state = whylog.state;

  if (input.reason.trim().length === 0) {
    return err("A rejustification needs a reason: it changes what a decision rests on.");
  }
  if (input.premiseText.trim().length === 0) {
    return err("A rejustification needs the new premise. Without it the decision still rests on the old one.");
  }
  if (state.decisions.get(decisionId) === undefined) {
    return err(`No decision ${decisionId} in the log.`);
  }

  const transcriptId: TranscriptId = formatTranscriptId(state.counters.transcripts + 1);
  const premiseId: PremiseId = formatPremiseId(state.counters.premises + 1);
  const justificationId: JustificationId = formatJustificationId(state.counters.justifications + 1);
  const engineId = whylog.engineId;
  const text = input.premiseText.trim();

  const justification: Justification = {
    id: justificationId,
    consequent: decisionId,
    inList: [premiseId],
    outList: [],
    /* `human`, not `rejustification`: there is no creating event to point at yet, and
     * the informant kind is exactly the fact being recorded — a person vouched for this. */
    informant: { kind: "human" },
    createdAt: at,
  };

  const drafts: readonly NewEvent<EventType>[] = [
    {
      type: "TranscriptImported",
      payload: {
        transcriptId,
        rawChars: text.length,
        label: "human input — rejustification",
        engine: engineId,
      },
      actor: { kind: "human" },
      reason: `A premise asserted by hand needs somewhere verbatim to live. This transcript holds exactly that text and nothing else, so the snippet on ${premiseId} is honest about its source.`,
      at,
    },
    {
      type: "PremiseAsserted",
      payload: {
        premiseId,
        transcriptId,
        type: input.premiseType,
        predicate: canonicalPredicate(input.premiseType, input.predicate),
        text,
        confidence: asConfidence(1),
        engine: engineId,
        snippet: { transcriptId, start: 0, end: text.length, text },
      },
      actor: { kind: "human" },
      reason: input.reason,
      at,
    },
    {
      type: "JustificationAttached",
      payload: { justificationId, consequent: decisionId, justification },
      actor: { kind: "human" },
      reason: `${decisionId} now rests on ${premiseId}. ${input.reason}`,
      at,
    },
    {
      type: "DecisionRejustified",
      payload: { decisionId, newPremiseId: premiseId, newJustificationId: justificationId },
      actor: { kind: "human" },
      reason: input.reason,
      at,
    },
  ];

  const outcome = whylog.recordBatch(drafts, { reason: input.reason, actor: { kind: "human" } });
  if (!outcome.ok) return err(outcome.error);

  return ok(`${decisionId} rejustified on ${premiseId} (${outcome.value.length} events)`);
}

/**
 * The low-level variant, for a caller that has ALREADY created the premise and its
 * justification — a Phase 6 form that walks the user through both.
 *
 * Kept separate because the two must not be confused: this one trusts its ids, and
 * trusting an id that does not exist produces a justification pointing at nothing,
 * which the labeller will report as unfounded rather than as an error.
 */
export function linkRejustification(
  decisionId: DecisionId,
  newPremiseId: PremiseId,
  newJustificationId: JustificationId,
  reason: string,
): Result<string, string> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A rejustification needs a reason: it changes what a decision rests on.");
  }
  if (whylog.state.premises.get(newPremiseId) === undefined) {
    return err(`${newPremiseId} does not exist. Create the premise first — an id that points at nothing makes the decision unfounded, not rejustified.`);
  }

  const outcome = whylog.record(
    {
      type: "DecisionRejustified",
      payload: { decisionId, newPremiseId, newJustificationId },
      actor: { kind: "human" },
      reason,
      at,
    },
    { reason },
  );

  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

/**
 * Contest: hold both, unresolved.
 *
 * Used when adjudication refused a newcomer and the user agrees the conflict is real
 * but does not want to resolve it yet. The premise stays in the log, marked contested,
 * and every decision resting on it is flagged rather than retracted.
 */
export function applyContest(premiseId: PremiseId, reason: string): Result<string, string> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A contest needs a reason: it records that a conflict is real and unresolved.");
  }

  const outcome = whylog.record(
    {
      type: "PremiseContested",
      payload: { premiseId },
      actor: { kind: "human" },
      reason,
      at,
    },
    { reason },
  );

  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

/**
 * Dismiss: the user considered it and disagreed.
 *
 * Recorded, never deleted. A dismissed proposal is evidence about the system's
 * precision — Phase 7 counts dismissals per gate to report false-positive rates, and
 * that count is only possible because dismissal is an event rather than a removal.
 */
export function applyDismissal(proposalId: ProposalId, reason: string): Result<string, string> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A dismissal needs a reason: it is the only record that this was considered.");
  }

  /* There is no `ProposalDismissed` event in the closed vocabulary. A dismissal is a
   * human override of the system's judgement about a proposal, and `HumanOverride` is
   * the event that carries exactly that: a proposal id, the decision it concerned, and
   * a reason. */
  const proposal = whylog.state.proposals.get(proposalId);
  if (proposal === undefined) return err(`No proposal ${proposalId} in the log.`);

  const outcome = whylog.record(
    {
      type: "HumanOverride",
      payload: {
        proposalId,
        overriddenDecisionId: proposal.unsoundDecisionId,
      },
      actor: { kind: "human" },
      reason: `Dismissed: ${reason}`,
      at,
    },
    { reason },
  );

  return outcome.ok ? ok(outcome.value) : err(outcome.error);
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

/** Cases whose gate was deterministic. Shown first: verifiable without a model. */
export function deterministicCases(cases: readonly RevisionCase[]): readonly RevisionCase[] {
  return cases.filter((entry) => entry.finding.deterministic);
}

/** Cases the adjudicator refused. These go to the Contested queue. */
export function contestedCases(cases: readonly RevisionCase[]): readonly RevisionCase[] {
  return cases.filter((entry) => entry.proposal.availableActions.includes("contest"));
}

/** Cases with a cascade that reached the depth cap — the ones whose diagnosis is
 *  knowingly incomplete. */
export function truncatedCases(cases: readonly RevisionCase[]): readonly RevisionCase[] {
  return cases.filter((entry) => entry.cascade.truncated || entry.backtrack.truncated);
}

/** The single most load-bearing case: highest entrenchment, because that is the one
 *  the user will find hardest to accept and most likely to dismiss unread. */
export function hardestCase(cases: readonly RevisionCase[]): RevisionCase | null {
  if (cases.length === 0) return null;
  return cases.reduce((best, entry) =>
    entry.entrenchment.capped > best.entrenchment.capped ? entry : best,
  );
}
