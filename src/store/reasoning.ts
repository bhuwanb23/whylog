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

/* Imported from the module rather than the `@/guards` barrel: the barrel pulls in the CI
 * exporter and the metrics, none of which the reasoning store needs, and a narrower import keeps
 * the dependency edge honest about what is actually used. */
import { guardStatusMap } from "@/guards/feedback";
import { nowISO } from "@/lib/format";
import {
  formatJustificationId,
  formatPremiseId,
  formatProposalId,
  formatTranscriptId,
} from "@/lib/ids";
import type { Result } from "@/lib/result";
import { err, ok } from "@/lib/result";
import { foldKey } from "@/ontology/canonicalize";
import { canonicalPredicate } from "@/ontology/canonicalize";
import {
  type Assertion,
  type AssertionResult,
  type DecisionAssertion,
  type ReviseInput,
  type ReviseResult,
  type RevisionCase,
  type UnresolvedPremise,
  assertNewInformation,
  revise,
} from "@/reasoning";
import type { Newcomer } from "@/reasoning/adjudication";
import type { CandidatePair } from "@/reasoning/gates/semantic";
import type { GraphState } from "@/substrate/graph-state";
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
/* Both were used at `applyRejustification` since Phase 2 without being imported — the kind of
 * error the structural checker cannot see, because it verifies that imports RESOLVE, not that
 * every identifier used is declared. Found by a string-aware scan for undeclared identifiers. */
import type { EventType, NewEvent } from "@/types/events";
import { create } from "zustand";
import { useAsk } from "./ask";

import { useTuning } from "./settings";
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
  /**
   * Assertions that matched no premise and were therefore NOT acted on.
   *
   * §2.11: ambiguous cases are surfaced for human confirmation rather than guessed.
   * Surfacing means keeping them visible after the run, not mentioning them once in a
   * summary string that scrolls away.
   */
  readonly unresolved: readonly UnresolvedPremise[];
  /** True when the last run produced drafts that were committed. */
  readonly committed: number;

  readonly run: (options?: RunOptions) => Promise<Result<number, string>>;
  /** §2.1 — assert new information, then run the cycle over the result. Two batches,
   *  because the labeller must see the state AFTER the assertion is folded. */
  readonly assertAndRevise: (assertion: Assertion) => Promise<Result<AssertionResult, string>>;
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
  unresolved: [],

  /* ---------------------------------------------------------------------- */
  /* The run                                                                */
  /* ---------------------------------------------------------------------- */

  run: async (options) => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message =
        "The log is read-only: its hash chain is broken. Reasoning needs to append events.";
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

    /* Gate (b) asks retrieval for candidate pairs. The retriever reads the L1 vectors already
     * in the index, so it makes zero embedding calls and runs keyless — but it needs an index
     * to read, so one is ensured here rather than inside the gate. A gate that silently found
     * nothing because no index existed would report "no contradictions", which is a different
     * claim from "gate (b) was unavailable", and the first one is false. */
    const skippingSemantic = options?.skipSemantic === true;
    if (!skippingSemantic) {
      await useAsk.getState().ensureIndex();
    }

    const retriever = (state: GraphState): Promise<readonly CandidatePair[]> =>
      useAsk.getState().candidatesFor(state);

    const input: ReviseInput = {
      state: whylog.state,
      engine: whylog.engine.engine,
      actor: REASONING_ACTOR,
      now: startedAt,
      ...(options?.newcomer === undefined ? {} : { newcomer: options.newcomer }),
      /* Phase 4: `implementation_cost` is now a MEASUREMENT rather than a guess.
       *
       * `entrenchmentOf` reads this map and uses each decision's passing-guard fraction as its
       * implementation cost. A decision with six passing guards is baked in — reversing it means
       * changing six things that are already built and verified — and the system can now say so
       * with evidence. A decision with NO accepted guard is absent from the map, which makes the
       * cost fall back to 0.5 and be reported as UNKNOWN: absent is not zero, and scoring an
       * unverified decision as cheap to retract would make it the easiest one to overturn.
       *
       * This is the term no belief-revision system has, because none is attached to a codebase. */
      guards: guardStatusMap(whylog.state),
      /* The user's cascade depth cap, from the persisted tuning store. Until this line the setting
       * existed, was displayed, and changed nothing. */
      cascadeDepthCap: useTuning.getState().cascadeDepthCap,
      /* Gate (b) is WIRED as of Phase 3. It was hardcoded off in Phase 2 because there was no
       * retriever to ask; now there is one, so the default flips to "run it" and `skipSemantic`
       * becomes what it was always meant to be — an opt-out for the keyless demo and for
       * Phase 7's ablation, which measures gates (a) and (c) in isolation. */
      ...(options?.skipSemantic === true ? { skipSemantic: true } : { retrieve: retriever }),
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

    /* Kept on the store rather than only in the returned value: the view needs it after
     * the run completes, and a summary string is not a confirmation queue. */
    set({ unresolved: asserted.unresolved });

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
      unresolved: [],
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
    return err(
      "Say what you observed. A falsification with no observation is an opinion, and the log records observations.",
    );
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
  if (reason.trim().length === 0)
    return err(
      "A hand-entered decision needs a reason: it is the only provenance it will ever have.",
    );

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

/**
 * Re-run the cycle after a human action.
 *
 * §2.9 requires "Keep & re-justify" to RESTORE THE DECISION TO IN, and the only thing
 * that can do that is the labeller — a rejustification event changes the graph, and the
 * label follows from the graph, never from the event. The same holds for a reversal and
 * a contest: each one moves support, and support is what the label reports.
 *
 * Without this the UI would show a stale label until the next unrelated run, and the
 * user would reasonably conclude the action did nothing.
 */
async function relabelAfterAction(): Promise<void> {
  /* `get` is only in scope inside the `create()` body. These helpers are module-level, so they
   * reach the store the way any out-of-store caller does. Safe because every caller is an async
   * action invoked after module initialisation, never during it. */
  await useReasoning.getState().run();
}

/** Resolved to the creating event by the materialiser on fold. */
const PLACEHOLDER_EVENT_ID = "EV-000000-000000" as EventId;

/**
 * Reverse: retract the decision and record what replaces it.
 *
 * This is the human's act, not the system's. It takes a `reason` because
 * `DecisionReversed` is state-changing and the reason is what the audit shows later.
 */
export async function applyReversal(
  decisionId: DecisionId,
  newValue: string,
  reason: string,
): Promise<Result<string, string>> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A reversal needs a reason. Without one the log cannot say why it changed.");
  }

  const reversed = whylog.record(
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

  if (!reversed.ok) return err(reversed.error);
  await relabelAfterAction();
  return ok(reversed.value);
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
export async function applyRejustification(
  decisionId: DecisionId,
  input: {
    /** What the user says the decision actually rests on. */
    readonly premiseText: string;
    readonly premiseType: PremiseType;
    /** Namespaced, e.g. "scale.max_users". Canonicalised before it is stored. */
    readonly predicate: string;
    readonly reason: string;
  },
): Promise<Result<string, string>> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;
  const state = whylog.state;

  if (input.reason.trim().length === 0) {
    return err("A rejustification needs a reason: it changes what a decision rests on.");
  }
  if (input.premiseText.trim().length === 0) {
    return err(
      "A rejustification needs the new premise. Without it the decision still rests on the old one.",
    );
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

  /* §2.9: "re-run the labeller". The decision is only restored to IN by relabelling. */
  await relabelAfterAction();

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
export async function linkRejustification(
  decisionId: DecisionId,
  newPremiseId: PremiseId,
  newJustificationId: JustificationId,
  reason: string,
): Promise<Result<string, string>> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err("A rejustification needs a reason: it changes what a decision rests on.");
  }
  if (whylog.state.premises.get(newPremiseId) === undefined) {
    return err(
      `${newPremiseId} does not exist. Create the premise first — an id that points at nothing makes the decision unfounded, not rejustified.`,
    );
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

  if (!outcome.ok) return err(outcome.error);
  await relabelAfterAction();
  return ok(outcome.value);
}

/**
 * Contest: hold both, unresolved.
 *
 * Used when adjudication refused a newcomer and the user agrees the conflict is real
 * but does not want to resolve it yet. The premise stays in the log, marked contested,
 * and every decision resting on it is flagged rather than retracted.
 */
export async function applyContest(
  premiseId: PremiseId,
  reason: string,
): Promise<Result<string, string>> {
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

  if (!outcome.ok) return err(outcome.error);
  await relabelAfterAction();
  return ok(outcome.value);
}

/**
 * OVERRIDE ANYWAY — §2.8's explicit escape from non-prioritized screening.
 *
 * The adjudicator refused this newcomer. A human says refuse the refusal. Two events,
 * in this order:
 *
 *   1. the newcomer is asserted as a decision with origin `human_override`
 *   2. `HumanOverride` names it, which the materialiser already implements as: raise
 *      its source_authority to 0.9, move it out of `contested`, and resolve the proposal
 *
 * Step 2 is not a Phase 2 invention — `materialize.ts` has done exactly this since
 * Phase 0, and the comment there says why: "which is how a screened-out newcomer
 * eventually wins the next adjudication instead of sitting in the contested queue
 * forever." Until now nothing ever called it.
 *
 * Raising the authority to 0.9 rather than to 1.0 is deliberate and it is the plan's
 * number: an override outranks every extracted origin, but it does not outrank a
 * directly human-stated decision, so a second override can still be needed if genuinely
 * better evidence arrives. An override that could never be overridden is not a queue,
 * it is a dead end.
 */
export async function applyOverride(
  newcomer: Newcomer,
  proposalId: ProposalId | null,
  reason: string,
): Promise<Result<string, string>> {
  const whylog = useWhyLog.getState();

  if (reason.trim().length === 0) {
    return err(
      "An override needs a reason. It is the one action that overrules the system's own arithmetic, so the log has to carry the human's.",
    );
  }

  /* Step 1: assert the newcomer. It has to exist as a decision before it can be
   * overridden into force, and asserting it through the normal entry point means it
   * carries the same provenance as any other decision. */
  const asserted = await assertUserDecision(
    newcomer.variable,
    newcomer.value,
    newcomer.text,
    `Override of non-prioritized screening: ${reason.trim()}`,
  );
  if (!asserted.ok) return err(asserted.error);

  /* Step 2: find the decision that assertion produced, and override it. */
  const state = useWhyLog.getState().state;
  const created = findNewestDecision(state, newcomer.variable, newcomer.value);
  if (created === null) {
    return err(
      "The newcomer was asserted but could not be located in the folded graph, so the override was not recorded. The decision is in the log; run the cycle again and override from the proposal.",
    );
  }

  const at = nowISO() as ISODateString;
  const outcome = whylog.record(
    {
      type: "HumanOverride",
      payload: {
        /* `proposalId` is required by the payload. When there is none — an override
         * driven straight from the Contested queue rather than from a proposal — the
         * most recent open proposal for this decision is the honest referent, and if
         * there is not one either, the override still stands on its own event. */
        proposalId: proposalId ?? findProposalFor(state, created),
        overriddenDecisionId: created,
      },
      actor: { kind: "human" },
      reason: `Override anyway: ${reason.trim()}`,
      at,
    },
    { reason },
  );

  if (!outcome.ok) return err(outcome.error);
  await relabelAfterAction();

  return ok(
    `${created} forced through over screening. Its source authority is now 0.9, so it wins subsequent adjudications.`,
  );
}

/**
 * KEEP IT — the human vouches for the incumbent and the proposal goes away.
 *
 * This was previously called "dismiss" and wired to `HumanOverride` on the incumbent,
 * which is the same event but was described as though it meant "ignore this". It does
 * not mean that, and calling it dismissal hid what it actually does.
 *
 * What it does: a human personally vouches for a decision the system called unsound.
 * `HumanOverride` raises that decision's origin to `human_override` (0.9) and resolves
 * the proposal — so the decision is now harder to retract, which is exactly right,
 * because a human has staked their own judgement on it. It is the incumbent-side use of
 * the same mechanism `applyOverride` uses on the newcomer side.
 *
 * Recorded, never deleted (§2.10: nothing disappears silently). Phase 7 counts these
 * per gate to report false-positive rates, and that count is only possible because
 * vouching is an event rather than a removal.
 */
export async function applyVouch(
  proposalId: ProposalId,
  reason: string,
): Promise<Result<string, string>> {
  const whylog = useWhyLog.getState();
  const at = nowISO() as ISODateString;

  if (reason.trim().length === 0) {
    return err(
      "Vouching needs a reason. It raises this decision's authority to 0.9, and the log has to say why a human overruled the system's own diagnosis.",
    );
  }

  const proposal = whylog.state.proposals.get(proposalId);
  if (proposal === undefined) return err(`No proposal ${proposalId} in the log.`);

  const outcome = whylog.record(
    {
      type: "HumanOverride",
      payload: { proposalId, overriddenDecisionId: proposal.unsoundDecisionId },
      actor: { kind: "human" },
      reason: `Kept, vouched for by a human: ${reason.trim()}`,
      at,
    },
    { reason },
  );

  if (!outcome.ok) return err(outcome.error);
  await relabelAfterAction();

  return ok(
    `${proposal.unsoundDecisionId} kept. Its source authority is now 0.9 and the proposal is resolved.`,
  );
}

/* -------------------------------------------------------------------------- */

/** The most recently numbered decision matching a variable and value. */
function findNewestDecision(
  state: GraphState,
  variable: Newcomer["variable"],
  value: string,
): DecisionId | null {
  const canonical = foldKey(value);
  let best: DecisionId | null = null;

  for (const decision of state.decisions.values()) {
    if (decision.variable !== variable) continue;
    if (foldKey(decision.value) !== canonical) continue;
    if (best === null || decision.id > best) best = decision.id;
  }

  return best;
}

function findProposalFor(state: GraphState, decisionId: DecisionId): ProposalId {
  for (const proposal of state.proposals.values()) {
    if (proposal.unsoundDecisionId === decisionId && proposal.status === "open") return proposal.id;
  }
  /* No open proposal for it. The payload requires an id, so the newest one in the log
   * is used rather than inventing one; a `HumanOverride` whose proposal reference is
   * stale is still a true record of the override itself. */
  let newest: ProposalId | null = null;
  for (const proposal of state.proposals.values()) {
    if (newest === null || proposal.id > newest) newest = proposal.id;
  }
  return newest ?? (formatProposalId(1) as ProposalId);
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
