/**
 * The evaluation harness — 7.2's substrate.
 *
 * Phase 7 · sub-phase 7.2
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES, AND WHY IT IS NOT A TEST
 *
 * A test asks "does this function return what I expect". This asks "when the whole pipeline runs
 * over text nobody wrote for it, how much of the meaning survives". The difference is that a test
 * can be made to pass by fixing the test; a metric cannot, because the ground truth is a set of
 * quotes in files a reader can open and check.
 *
 * The harness drives the REAL pipeline — `runExtraction`, `appendBatch`, `materialize`, `revise`,
 * `label`, `ask` — with no shortcuts and no test doubles. Every number this produces is a number
 * about the shipping code path. If a metric is good, the product is good at that metric; if the
 * harness faked anything, that sentence would stop being true.
 *
 * ---------------------------------------------------------------------------
 * ONE MERGED GRAPH, NOT ONE PER TRANSCRIPT
 *
 * All twelve transcripts are appended into a single log in corpus order, producing one graph.
 * Questions are then asked against that graph.
 *
 * This is the realistic configuration: a user has one decision log and many transcripts in it. A
 * harness that gave each transcript a private graph would let retrieval win by construction, because
 * the distractors that make retrieval hard — twelve other decisions about databases, in other
 * transcripts — would be absent. Measuring on the easy configuration and reporting it as the product
 * is the kind of number that does not survive a judge's second question.
 *
 * Order is corpus order and ids are minted from the running counters, so the whole run is
 * deterministic and reproducible.
 * ---------------------------------------------------------------------------
 */

import type { AlternativeCandidate, DecisionCandidate, PremiseCandidate } from "@/ai/types";
import type { WhyLogEngine } from "@/ai/types";
import { PLACEHOLDER_EVENT_ID } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { isDerivedPremise } from "@/extraction/review";
import { DEFAULT_VOTING } from "@/extraction/voting";
import { synthesiseAll } from "@/guards";
import { guardStatusMap } from "@/guards/feedback";
import { monotonicNow, nowISO } from "@/lib/format";
import {
  formatAlternativeId,
  formatDecisionId,
  formatJustificationId,
  formatPremiseId,
  formatTranscriptId,
} from "@/lib/ids";
import { label } from "@/reasoning/labeller";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { type ReviseResult, revise } from "@/reasoning/revise";
import { ask } from "@/retrieval";
import { buildIndex } from "@/retrieval/build-index";
import { appendBatch, emptyLog, fold } from "@/substrate";
import type { EventLog } from "@/substrate/event-log";
import { validationMessage } from "@/substrate/event-validation";
import type { GraphState } from "@/substrate/graph-state";
import { asISO } from "@/types/common";
import type {
  Actor,
  AlternativeId,
  DecisionId,
  EngineId,
  EpisodeId,
  ISODateString,
  PremiseId,
  TranscriptId,
} from "@/types/common";
import type { Justification } from "@/types/domain";
import type { Decision, Premise, RejectedAlternative } from "@/types/domain";
import type { AnyEvent, EventType, NewEvent } from "@/types/events";
import type { Guard } from "@/types/guards";
import type { Answer } from "@/types/retrieval";
import type { AblationConfig, SweptParams } from "./ablation/toggles";
import type { LabelledQuestion, ResolvedCorpus, ResolvedTranscript } from "./corpus/labels";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface RunConfig {
  readonly id: string;
  readonly engine: WhyLogEngine;
  readonly engineId: EngineId;
  /** Every toggle, present and named, even when all are at their baseline value. A config that
   *  omits its toggles cannot be reproduced from its report. */
  readonly toggles: AblationConfig;
  /** Approve each transcript's extracted decisions as part of the review step, so the gates run
   *  over a TRIAGED graph. Off for the benchmark — it measures what the extractor produced before
   *  anybody looked at it, and gate (a) is deliberately silent between two unreviewed proposals.
   *  On for the demo seed, which narrates a user who accepted what they imported: a decision
   *  nobody accepted cannot be reversed, and beat 3 is a reversal. */
  readonly approveDecisions?: boolean;
  /** The swept parameters, separate from the toggles for the reason given in `ablation/toggles.ts`:
   *  a toggle answers "does this matter", a parameter answers "is this value right". */
  readonly params: SweptParams;
}

export interface TranscriptRun {
  readonly transcript: ResolvedTranscript;
  /** The id the log actually minted. Corpus keys are stable labels; runtime ids depend on import
   *  order and on what earlier transcripts already consumed. Every metric that matches a label to a
   *  node needs this one, because two transcripts have overlapping character offsets and a span
   *  alone cannot say which transcript it belongs to. */
  readonly runtimeId: TranscriptId;
  readonly ok: boolean;
  readonly failure: string | null;
  readonly durationMs: number;
  readonly decisionIds: readonly DecisionId[];
  readonly premiseIds: readonly PremiseId[];
  readonly alternativeIds: readonly AlternativeId[];
  readonly candidatesFound: number;
  readonly candidatesDiscarded: number;
}

export interface InterventionOutcome {
  readonly plant: string;
  readonly predicate: string;
  readonly applied: boolean;
  readonly premiseId: PremiseId | null;
  /** What was done, or why it could not be. Printed verbatim in the report. */
  readonly reason: string;
}

export interface QuestionRun {
  readonly question: LabelledQuestion;
  readonly answer: Answer | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface RunResult {
  readonly configId: string;
  readonly engine: EngineId;
  readonly toggles: AblationConfig;
  readonly params: SweptParams;
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly transcripts: readonly TranscriptRun[];
  readonly questions: readonly QuestionRun[];
  readonly proposalsRaised: number;
  /** Batches the log REFUSED — a revision pass or the guard synthesis — with the validation message.
   *
   *  Recorded rather than thrown: a revision the log rejects is a finding about the reasoner, and
   *  abandoning the run would bury it under a stack trace. Left visible because the alternative —
   *  silently keeping the pre-revision graph — reports every cascade as a no-op that passed. */
  readonly revisionFailures: readonly string[];
  /** Every planted intervention, applied or not. An unapplied one means the plant it belongs to was
   *  never tested, and the metrics that depend on it must say so rather than report a pass. */
  readonly interventions: readonly InterventionOutcome[];
  readonly startedAt: ISODateString;
  readonly durationMs: number;
}

const ACTOR: Actor = { kind: "system" };

/**
 * Commit a revision pass and re-fold.
 *
 * `revise` returns DRAFTS, not a graph. Nothing changes until they are appended and the log is
 * re-folded, so a caller that reads a state off the result scores every gate against the
 * PRE-revision graph — and the cascade then looks like a no-op that always passed. That is the one
 * failure mode this harness cannot have, because cascade correctness is the headline metric and the
 * only one of the thirteen with no published comparator.
 *
 * `proposals` counts RevisionProposed drafts alone. A proposal is a revision the system declines to
 * apply itself (I4: the system proposes, the human disposes). LabelChanged and CascadePropagated are
 * applications, not proposals; counting them would inflate the number the report presents as "how
 * often the reasoner asked a human for help".
 */
function commitRevision(
  log: EventLog,
  revised: ReviseResult,
  clock: EvalClock,
  engineId: EngineId,
  reason: string,
): { log: EventLog; state: GraphState; proposals: number; failure: string | null } {
  const proposals = revised.eventDrafts.filter((draft) => draft.type === "RevisionProposed").length;
  const unchanged = {
    log,
    state: fold(log.events, { engine: engineId, now: clock.next() }),
    proposals,
    failure: null,
  };

  if (revised.eventDrafts.length === 0) return unchanged;

  const committed = appendBatch(
    log,
    revised.eventDrafts.map((draft) => ({
      draft,
      context: { now: clock.next(), actor: ACTOR, reason },
    })),
  );

  if (!committed.ok) {
    return {
      ...unchanged,
      failure: "revision-rejected: " + validationMessage(committed.validation),
    };
  }

  return {
    log: committed.log,
    state: fold(committed.log.events, { engine: engineId, now: clock.next() }),
    proposals,
    failure: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Run the whole pipeline over the corpus under one configuration.
 *
 * Never throws on a per-transcript failure: a transcript that fails to extract is recorded as a
 * failure and scored as producing nothing, which is a real result. Throwing instead would abort the
 * run and leave the failure mode unmeasured — and "the pipeline dies on messy input" is precisely
 * one of the failure modes this benchmark exists to measure.
 */
export async function runConfig(corpus: ResolvedCorpus, config: RunConfig): Promise<RunResult> {
  const startedAt = nowISO();
  const t0 = monotonicNow();

  let log = emptyLog();
  const clock = new EvalClock(startedAt);
  let state = fold(log.events, { engine: config.engineId, now: clock.next() });
  const transcripts: TranscriptRun[] = [];
  let proposalsRaised = 0;
  const revisionFailures: string[] = [];

  for (const transcript of corpus.transcripts) {
    const tStart = monotonicNow();
    const transcriptId = formatTranscriptId(state.counters.transcripts + 1) as TranscriptId;

    const result = await runExtraction(
      {
        transcriptId,
        raw: transcript.raw,
        label: transcript.id,
        occurredAt: asISO(transcript.occurredAt),
      },
      {
        engine: config.engine,
        engineId: config.engineId,
        state,
        ...(config.toggles.noiseCollapse ? {} : { collapseNoise: false }),
        /* Voting is OFF unless a VotingOptions is supplied (pipeline.ts gates on
         * `options.voting !== undefined && runs > 1`), so the toggle has to pass one to enable
         * it. Passing `undefined` instead left the toggle inert in both positions. It is still
         * unmeasurable keyless — the local engine reports capabilities().voting === false — but
         * an LLM run now genuinely exercises it. */
        ...(config.toggles.voting ? { voting: DEFAULT_VOTING } : {}),
        ...(config.toggles.negationCues ? {} : { negationCues: false }),
        ...(config.toggles.modalityFilter ? {} : { modalityFilter: false }),
      },
    );

    if (!result.ok) {
      transcripts.push({
        transcript,
        runtimeId: transcriptId,
        ok: false,
        failure: result.failure.kind,
        durationMs: monotonicNow() - tStart,
        decisionIds: [],
        premiseIds: [],
        alternativeIds: [],
        candidatesFound: 0,
        candidatesDiscarded: 0,
      });
      continue;
    }

    /* ---- candidates → events ---- */
    /* Ids are minted here, not by the pipeline, because the pipeline emits local keys and the log
     * requires branded ids. The premise/alternative refs on a decision candidate are indices into
     * the run's own arrays, so they are resolved by SNIPPET IDENTITY against those arrays: the
     * queue reorders and drops items, but a snippet's offsets are unique within a run. */
    const run = result.outcome.run;
    const premiseIdByIndex = new Map<number, PremiseId>();
    const decisionIdByIndex = new Map<number, DecisionId>();
    const drafts: NewEvent<EventType>[] = [];

    /* The import event comes first: it is what makes the transcript a node in the graph, and every
     * decision below carries its id. Emitting decisions without it would leave provenance pointing at
     * a transcript the fold has never seen. */
    drafts.push(transcriptImported(transcriptId, transcript, config.engineId));

    /* Premises and decisions are minted BEFORE alternatives, because `AlternativeRejectedPayload`
     * requires the `decisionId` that rejected the alternative. An alternative is not a free-floating
     * node — it is a road not taken on a specific decision — so the ordering is forced by the payload
     * rather than chosen. */
    let premiseSeq = 0;
    for (const candidate of run.premises) {
      premiseSeq += 1;
      const id = formatPremiseId(state.counters.premises + premiseSeq) as PremiseId;
      premiseIdByIndex.set(indexOfPremise(run.premises, candidate), id);
      drafts.push(premiseProposed(id, transcriptId, candidate, config.engineId));
    }

    const decisionIds: DecisionId[] = [];
    const alternativeIds: AlternativeId[] = [];

    let decisionSeq = 0;
    for (const candidate of run.decisions) {
      decisionSeq += 1;
      const id = formatDecisionId(state.counters.decisions + decisionSeq) as DecisionId;
      decisionIds.push(id);
      decisionIdByIndex.set(indexOfDecision(run.decisions, candidate), id);
      drafts.push(
        decisionProposed(id, transcriptId, candidate, config.engineId, {
          premiseIds: candidate.premiseRefs
            .map((ref) => premiseIdByIndex.get(ref))
            .filter(isDefined),
        }),
      );
    }

    /* ---- justifications: the IN/OUT-lists that make the graph non-monotonic ----
     *
     * Emitted after the decisions, because a justification's consequent is a decision id and its
     * lists are premise ids, so both must already be minted.
     *
     * Without this step the graph held decisions and premises with nothing connecting them:
     * `state.justifications` was empty, no OUT-list existed anywhere in the corpus, and gate (c) was
     * therefore structurally incapable of firing. That silently zeroed premise-invalidation recall,
     * cascade correctness and survivor preservation — the three metrics with no published comparator,
     * and the whole reason this is not another decision log. A monotonic graph cannot be fixed by
     * tuning; it has no mechanism to fix.
     *
     * The IN/OUT split is by the derived-premise marker, the same rule `commit.resolvePremiseRefs`
     * applies: an OUT-list entry was INFERRED from a supporting premise rather than quoted, and
     * `premise-linker.ts` says so in its text. Copying the rule rather than importing the function
     * because that one resolves queue items by human action, and the harness never acts as a human. */
    let justificationSeq = 0;
    for (const candidate of run.decisions) {
      const consequent = decisionIdByIndex.get(indexOfDecision(run.decisions, candidate));
      if (consequent === undefined) continue;

      const inList: PremiseId[] = [];
      const outList: PremiseId[] = [];
      for (const ref of candidate.premiseRefs) {
        const premiseId = premiseIdByIndex.get(ref);
        if (premiseId === undefined) continue;
        const source = run.premises[ref];
        if (source !== undefined && isDerivedPremise(source.predicate, source.text))
          outList.push(premiseId);
        else inList.push(premiseId);
      }

      /* A decision with no premise at all gets no justification. Attaching an empty one would make it
       * vacuously valid — IN-list empty, OUT-list empty — and a decision that rests on nothing would
       * be reported as sound forever, which is worse than reporting it as unfounded. */
      if (inList.length === 0 && outList.length === 0) continue;

      justificationSeq += 1;
      const justificationId = formatJustificationId(
        state.counters.justifications + justificationSeq,
      );
      const occurredAt = asISO(transcript.occurredAt);
      const justification: Justification = {
        id: justificationId,
        consequent,
        inList,
        outList,
        informant: { kind: "extraction", engine: config.engineId, eventId: PLACEHOLDER_EVENT_ID },
        createdAt: occurredAt,
      };

      drafts.push({
        type: "JustificationAttached",
        payload: { justificationId, consequent, justification },
        actor: ACTOR,
        reason:
          `Attaching a justification for ${consequent}: ${inList.length} supporting premise` +
          (inList.length === 1 ? "" : "s") +
          (outList.length === 0
            ? "."
            : ` and ${outList.length} excluded condition` +
              (outList.length === 1 ? "" : "s") +
              " — non-monotonic, so it can be invalidated by the world rather than only by a contradiction."),
      });
    }

    let alternativeSeq = 0;
    for (const candidate of run.alternatives) {
      /* An alternative whose decision was not minted — because the decision was discarded, or the ref
       * is out of range — is dropped rather than attached to an arbitrary decision. Attaching it
       * anyway would create a rejection that never happened, which is a false positive manufactured by
       * the harness rather than found by the system, and it would corrupt alternative precision. */
      const decisionId = decisionIdByIndex.get(candidate.decisionRef);
      if (decisionId === undefined) continue;

      alternativeSeq += 1;
      /* The id is scoped to its decision (`A-<decision>-<n>`), so the sequence is per-transcript
       * and the decision prefix keeps it unique across the merged graph. There is no global
       * alternatives counter and there should not be one: alternatives belong to decisions. */
      const id = formatAlternativeId(decisionId, alternativeSeq);
      alternativeIds.push(id);
      drafts.push(alternativeRejected(id, decisionId, candidate, config.engineId));
    }

    const premiseIds = [...premiseIdByIndex.values()];

    /* ---- append, fold, revise ---- */
    const appended = appendBatch(
      log,
      drafts.map((draft) => ({
        draft,
        context: {
          now: clock.next(),
          actor: ACTOR,
          reason: "Eval harness importing " + transcript.id,
          occurredAt: asISO(transcript.occurredAt),
        },
      })),
    );

    if (!appended.ok) {
      transcripts.push({
        transcript,
        runtimeId: transcriptId,
        ok: false,
        failure: "append-rejected: " + validationMessage(appended.validation),
        durationMs: monotonicNow() - tStart,
        decisionIds,
        premiseIds,
        alternativeIds,
        candidatesFound: drafts.length,
        candidatesDiscarded: run.discarded.length,
      });
      continue;
    }

    log = appended.log;
    state = fold(log.events, { engine: config.engineId, now: clock.next() });

    /* ---- THE REVIEW STEP ----
     *
     * Without this block the entire benchmark measured a graph nobody had accepted, and every number
     * downstream of the labels was structurally zero rather than empirically low.
     *
     * A premise is UNKNOWN until a human confirms it (I4: the system proposes, the human disposes).
     * A justification is valid only when every node in its IN-list is IN, so with every premise
     * UNKNOWN no justification is valid, and the labeller marks every decision OUT. The first
     * instrumented run of this harness produced:
     *
     *     decisions 34 -> IN 0, OUT 27, UNKNOWN 7
     *     premises  98 -> IN 0, OUT 21, UNKNOWN 77
     *
     * Not one IN node in the graph. That is why the false-positive metric reported 26 "unexplained
     * retractions" (they were every decision in the corpus), why survivor preservation was 0.000
     * (nothing can survive when nothing was ever standing), why precision@5 was 0.050 and why answer
     * groundedness scored 0.000 — all four were measuring an unreviewed graph, not a weak system.
     *
     * `tests/helpers/events.ts` states the rule this harness was breaking: "Fixtures that test gate
     * (c) must start from a REVIEWED graph or they test a graph nobody has accepted yet."
     *
     * WHAT IS BEING MODELLED. The harness stands in for the reviewer, exactly as the demo seed does.
     * It confirms everything the extractor produced, which is the bulk-approve path the Review view
     * offers. That is a real cost and it is not hidden: a premise the extractor invented becomes an
     * IN node, and if it later contradicts something the false-positive metric will count the
     * interruption. Confirming only the premises the corpus labels would leak ground truth into the
     * run and make the extraction metrics meaningless, so it is deliberately not done. */
    if (config.approveDecisions === true && decisionIds.length > 0) {
      const approved = appendBatch(
        log,
        decisionIds.map((decisionId) => ({
          draft: {
            type: "DecisionApproved" as const,
            payload: { decisionId, viaBulkApprove: true },
            actor: { kind: "human" as const },
            reason:
              "Demo seed review step: bulk-approving this transcript's decisions so gate (a) runs " +
              "over a triaged graph. A human actor, because approval is the disposition step in I4 " +
              "and stamping it as the system would record the graph as having accepted itself.",
          },
          context: {
            now: clock.next(),
            actor: { kind: "human" as const },
            reason: "Demo seed bulk approval.",
          },
        })),
      );
      if (approved.ok) {
        log = approved.log;
        state = fold(log.events, { engine: config.engineId, now: clock.next() });
      } else {
        revisionFailures.push(
          "decision-approve-rejected: " + validationMessage(approved.validation),
        );
      }
    }

    if (premiseIds.length > 0) {
      const confirmed = appendBatch(
        log,
        premiseIds.map((premiseId) => ({
          draft: {
            type: "PremiseConfirmed" as const,
            payload: { premiseId },
            actor: ACTOR,
            reason:
              "Eval harness review step: bulk-accepting the extraction so the reasoning layer is " +
              "measured on a graph somebody has accepted, not one nobody has.",
          },
          context: {
            now: clock.next(),
            actor: ACTOR,
            reason:
              "Eval harness review step (context): bulk-accepting this transcript's premises.",
          },
        })),
      );
      if (confirmed.ok) {
        log = confirmed.log;
        state = fold(log.events, { engine: config.engineId, now: clock.next() });
      } else {
        revisionFailures.push(
          "premise-confirm-rejected: " + validationMessage(confirmed.validation),
        );
      }
    }

    /* The revision pass runs even when nothing was extracted, because "no contradiction raised" is a
     * result and must be measured against the same baseline as "one was". */
    const revised = await revise({
      state,
      engine: config.engine,
      actor: ACTOR,
      now: clock.next(),
      guards: guardStatusMap(state),
      ...(config.params.cascadeDepthCap === null
        ? {}
        : { cascadeDepthCap: config.params.cascadeDepthCap }),
      ...(config.toggles.semanticContradiction ? {} : { skipSemantic: true }),
      ...(config.toggles.structuralContradiction ? {} : { skipStructural: true }),
      ...(config.toggles.premiseInvalidation ? {} : { skipPremiseInvalidation: true }),
      ...(config.toggles.cascade ? {} : { disableCascade: true }),
      ...(config.toggles.entrenchment ? {} : { disableEntrenchment: true }),
    });

    const afterImport = commitRevision(
      log,
      revised,
      clock,
      config.engineId,
      "Eval harness revision pass after importing " + transcript.id,
    );
    log = afterImport.log;
    state = afterImport.state;
    proposalsRaised += afterImport.proposals;
    if (afterImport.failure !== null) revisionFailures.push(afterImport.failure);

    transcripts.push({
      transcript,
      runtimeId: transcriptId,
      ok: true,
      failure: null,
      durationMs: monotonicNow() - tStart,
      decisionIds,
      premiseIds,
      alternativeIds,
      candidatesFound: drafts.length,
      candidatesDiscarded: run.discarded.length,
    });
  }

  /* ---- planted interventions ---- */
  /* Applied AFTER every transcript is imported, so the intervention reacts to the graph the corpus
   * actually produced rather than to a graph built for the intervention's convenience. An intervention
   * whose premise was never extracted is recorded as unapplied and reported: the cascade cannot be
   * measured on a premise the system does not have, and silently skipping it would report a clean
   * cascade result that was never tested. */
  const interventions: InterventionOutcome[] = [];

  /* Gate (c) off has to mean two things at once, or the ablation measures nothing. Skipping the
   * gate alone is not enough: the harness PLANTS the PremiseInvalidated events, so the premise
   * would still go OUT through the fold and the labeller would still retract its dependents —
   * the world would still have told the log, just by a different door. So the interventions are
   * not applied either, and each one is recorded as unapplied with the reason, because an
   * intervention that never happened is not the same as one that happened and did nothing. */
  if (!config.toggles.premiseInvalidation) {
    for (const plant of corpus.plants) {
      for (const step of plant.falsify ?? []) {
        interventions.push({
          plant: plant.id,
          predicate: step.predicate,
          applied: false,
          premiseId: null,
          reason:
            "Not applied: the premiseInvalidation toggle is OFF for this configuration, so the " +
            "invalidation is never planted and gate (c) is never consulted. L2 and L3 have no " +
            "denominator in this row by construction.",
        });
      }
    }
  }

  for (const plant of config.toggles.premiseInvalidation ? corpus.plants : []) {
    for (const step of plant.falsify ?? []) {
      const owner = transcripts.find((entry) => entry.transcript.id === step.transcript);
      if (owner === undefined) {
        interventions.push({
          plant: plant.id,
          predicate: step.predicate,
          applied: false,
          premiseId: null,
          reason: "transcript not imported",
        });
        continue;
      }

      const target = [...state.premises.values()].find(
        (premise) =>
          premise.predicate === step.predicate &&
          premise.evidence.some((evidence) => evidence.span?.transcriptId === owner.runtimeId),
      );

      if (target === undefined) {
        interventions.push({
          plant: plant.id,
          predicate: step.predicate,
          applied: false,
          premiseId: null,
          reason:
            "no extracted premise with that predicate in that transcript — the cascade is UNTESTED, not passed",
        });
        continue;
      }

      const falsified = appendBatch(log, [
        {
          draft: {
            type: "PremiseInvalidated",
            actor: ACTOR,
            reason: step.reason,
            payload: {
              premiseId: target.id,
              invalidatedBy: { kind: "human" },
            },
          } as NewEvent<EventType>,
          context: { now: clock.next(), actor: ACTOR, reason: step.reason },
        },
      ]);

      if (!falsified.ok) {
        interventions.push({
          plant: plant.id,
          predicate: step.predicate,
          applied: false,
          premiseId: target.id,
          reason: "append rejected: " + validationMessage(falsified.validation),
        });
        continue;
      }

      log = falsified.log;
      state = fold(log.events, { engine: config.engineId, now: clock.next() });

      const afterFalsify = await revise({
        state,
        engine: config.engine,
        actor: ACTOR,
        now: clock.next(),
        guards: guardStatusMap(state),
        ...(config.params.cascadeDepthCap === null
          ? {}
          : { cascadeDepthCap: config.params.cascadeDepthCap }),
        ...(config.toggles.semanticContradiction ? {} : { skipSemantic: true }),
        ...(config.toggles.structuralContradiction ? {} : { skipStructural: true }),
        ...(config.toggles.premiseInvalidation ? {} : { skipPremiseInvalidation: true }),
        ...(config.toggles.cascade ? {} : { disableCascade: true }),
        ...(config.toggles.entrenchment ? {} : { disableEntrenchment: true }),
      });
      const afterIntervention = commitRevision(
        log,
        afterFalsify,
        clock,
        config.engineId,
        "Eval harness revision pass after falsifying " + step.predicate,
      );
      log = afterIntervention.log;
      state = afterIntervention.state;
      proposalsRaised += afterIntervention.proposals;
      if (afterIntervention.failure !== null) revisionFailures.push(afterIntervention.failure);

      interventions.push({
        plant: plant.id,
        predicate: step.predicate,
        applied: true,
        premiseId: target.id,
        reason: step.reason,
      });
    }
  }

  /* ---- guard synthesis, once over the merged graph ----
   *
   * Templates need no repository state: they compile a decision into the check that would falsify
   * it, which is the central novelty claim and the one that needs no fixture repo to demonstrate.
   * `templatesOnly` keeps the run keyless and deterministic. Every guard enters as PROPOSED — the
   * harness never acts as a human, so invariant I4 holds and the hardening check "0 guards
   * auto-accepted without a human" stays true.
   *
   * Without this step the graph contained no guards at all: guard precision reported NOT MEASURED,
   * synthesis rate read 0%, the demo seed had nothing to show in beat 7, and `guards:ci` exported an
   * empty runner. */
  const synthesised = await synthesiseAll({
    state,
    engine: config.engine,
    templatesOnly: true,
    actor: ACTOR,
    at: clock.next(),
  });

  if (synthesised.drafts.length > 0) {
    const guardsCommitted = appendBatch(
      log,
      synthesised.drafts.map((draft) => ({
        draft,
        context: {
          now: clock.next(),
          actor: ACTOR,
          reason: "Eval harness compiling guards from decisions",
        },
      })),
    );

    if (guardsCommitted.ok) {
      log = guardsCommitted.log;
      state = fold(log.events, { engine: config.engineId, now: clock.next() });
    } else {
      revisionFailures.push(
        "guard-synthesis-rejected: " + validationMessage(guardsCommitted.validation),
      );
    }
  }

  /* ---- labelling runs once over the merged graph ---- */
  const labelled = label(state);

  /* ---- questions ---- */
  const built = await buildIndex({
    state,
    engine: config.engine,
    actor: ACTOR,
    /* Embeddings stay local on both paths — a locked design decision, and the reason the whole
     * benchmark runs keyless. The LLM path never sends decision text to a provider to embed it. */
  });
  const artifacts = built.artifacts;
  const questions: QuestionRun[] = [];

  for (const question of corpus.questions) {
    const qStart = monotonicNow();
    try {
      const answer = await ask({
        state,
        artifacts,
        labels: labelled.labels,
        engine: config.engine,
        engineId: config.engineId,
        question: question.question,
        ...(config.params.maxSearches === null ? {} : { maxSearches: config.params.maxSearches }),
        ...(config.toggles.reranking ? {} : { skipRerank: true }),
        /* Dense is L1 (statement embeddings) and L2 (HyPE questions, also embedded). Off leaves
         * L3 sparse/BM25, L4 structural and L5 premises — a genuine lexical-only baseline. The
         * toggle's own doc comment used to say "L3", which is the sparse level; it was wrong and
         * has been corrected in toggles.ts. */
        ...(config.toggles.denseRetrieval ? {} : { options: { levels: ["L3", "L4", "L5"] } }),
      });
      questions.push({ question, answer, error: null, durationMs: monotonicNow() - qStart });
    } catch (error) {
      questions.push({
        question,
        answer: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: monotonicNow() - qStart,
      });
    }
  }

  return {
    configId: config.id,
    engine: config.engineId,
    toggles: config.toggles,
    params: config.params,
    state,
    labels: labelled.labels,
    transcripts,
    questions,
    proposalsRaised,
    revisionFailures,
    interventions,
    startedAt,
    durationMs: monotonicNow() - t0,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate → event                                                          */
/* -------------------------------------------------------------------------- */

function transcriptImported(
  transcriptId: TranscriptId,
  transcript: ResolvedTranscript,
  engine: EngineId,
): NewEvent<EventType> {
  return {
    type: "TranscriptImported",
    actor: ACTOR,
    reason: "Eval harness importing " + transcript.id,
    payload: {
      transcriptId,
      rawChars: transcript.raw.length,
      label: transcript.id,
      occurredAt: asISO(transcript.occurredAt),
      engine,
    },
  } as NewEvent<EventType>;
}

function decisionProposed(
  id: DecisionId,
  transcriptId: TranscriptId,
  candidate: DecisionCandidate,
  engine: EngineId,
  links: { premiseIds: readonly PremiseId[] },
): NewEvent<EventType> {
  return {
    type: "DecisionProposed",
    actor: ACTOR,
    reason: "Extracted from transcript " + transcriptId,
    payload: {
      decisionId: id,
      transcriptId,
      episodeId: formatEpisodeId(transcriptId, candidate.snippet.start) as EpisodeId,
      variable: candidate.variable,
      value: candidate.value,
      statement: candidate.statement,
      ...(candidate.rationale === undefined ? {} : { rationale: candidate.rationale }),
      ...(candidate.acceptedDownside === undefined
        ? {}
        : { acceptedDownside: candidate.acceptedDownside }),
      origin: candidate.origin,
      modality: candidate.modality,
      confidence: candidate.confidence,
      engine,
      snippet: candidate.snippet,
      premiseIds: links.premiseIds,
      alternativeIds: [],
      ...(candidate.yStatement === undefined ? {} : { yStatement: candidate.yStatement }),
      ...(candidate.appliesTo.length === 0 ? {} : { appliesTo: candidate.appliesTo }),
    },
  } as NewEvent<EventType>;
}

function premiseProposed(
  id: PremiseId,
  transcriptId: TranscriptId,
  candidate: PremiseCandidate,
  engine: EngineId,
): NewEvent<EventType> {
  return {
    type: "PremiseAsserted",
    actor: ACTOR,
    reason: "Extracted from transcript " + transcriptId,
    payload: {
      premiseId: id,
      transcriptId,
      type: candidate.type,
      predicate: candidate.predicate,
      ...(candidate.value === undefined ? {} : { value: candidate.value }),
      text: candidate.text,
      confidence: candidate.confidence,
      engine,
      snippet: candidate.snippet,
    },
  } as NewEvent<EventType>;
}

function alternativeRejected(
  id: AlternativeId,
  decisionId: DecisionId,
  candidate: AlternativeCandidate,
  engine: EngineId,
): NewEvent<EventType> {
  return {
    type: "AlternativeRejected",
    actor: ACTOR,
    reason: "Extracted alongside decision " + decisionId,
    payload: {
      alternativeId: id,
      decisionId,
      variable: candidate.variable,
      value: candidate.value,
      ...(candidate.whyRejected === undefined ? {} : { whyRejected: candidate.whyRejected }),
      confidence: candidate.confidence,
      engine,
      snippet: candidate.snippet,
    },
  } as NewEvent<EventType>;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Episode ids are derived, not minted.
 *
 * The harness has no episode table of its own — the pipeline segments episodes internally and does
 * not expose their ids on the candidate. Deriving a stable id from the transcript and the snippet
 * offset keeps every decision in one episode pointing at the same episode id, which is what the
 * graph needs, without inventing a counter that would disagree with the pipeline's own.
 */
function formatEpisodeId(transcriptId: TranscriptId, offset: number): string {
  return transcriptId + "#e" + offset;
}

function indexOfDecision(all: readonly DecisionCandidate[], one: DecisionCandidate): number {
  return all.findIndex(
    (candidate) => candidate.snippet.start === one.snippet.start && candidate.value === one.value,
  );
}

function indexOfPremise(all: readonly PremiseCandidate[], one: PremiseCandidate): number {
  return all.findIndex(
    (candidate) =>
      candidate.snippet.start === one.snippet.start && candidate.predicate === one.predicate,
  );
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * A strictly increasing learned-time source.
 *
 * Validation rule 4 requires `at >= previous.at`, and rule 3 requires the hash chain to line up, so
 * two events stamped in the same millisecond are legal but two events stamped out of order are not.
 * `nowISO()` reads the wall clock and can return the same millisecond repeatedly on a fast machine;
 * `monotonicNow()` is a DURATION clock and returns a number, not a timestamp. Neither is what an
 * append loop needs, so the harness advances its own counter instead — which also makes learned time
 * independent of how fast the machine happens to be, and the run reproducible.
 */
class EvalClock {
  private cursor: number;

  constructor(start: ISODateString) {
    const parsed = Date.parse(start);
    this.cursor = Number.isFinite(parsed) ? parsed : Date.now();
  }

  next(): ISODateString {
    this.cursor += 1;
    return new Date(this.cursor).toISOString() as ISODateString;
  }
}

/* -------------------------------------------------------------------------- */
/* Read access, used by every metric                                          */
/* -------------------------------------------------------------------------- */

export function decisionsOf(run: RunResult): readonly Decision[] {
  return [...run.state.decisions.values()];
}

export function premisesOf(run: RunResult): readonly Premise[] {
  return [...run.state.premises.values()];
}

export function alternativesOf(run: RunResult): readonly RejectedAlternative[] {
  return [...run.state.alternatives.values()];
}

export function guardsOf(run: RunResult): readonly Guard[] {
  return [...run.state.guards.values()];
}

export function labelOf(run: RunResult, id: NodeId): Labelled | null {
  return run.labels.get(id) ?? null;
}

export function eventsOf(run: RunResult): readonly AnyEvent[] {
  return run.state.events;
}

/** The transcript runs that failed, with their reasons. Printed before the metrics, because a run in
 *  which half the corpus failed to import produces numbers that look like poor recall and are
 *  actually a crash. */
export function describeFailures(run: RunResult): string {
  const failed = run.transcripts.filter((entry) => !entry.ok);
  if (failed.length === 0)
    return "All " + run.transcripts.length + " transcripts imported without failure.";

  const lines = [
    failed.length + " of " + run.transcripts.length + " transcript(s) FAILED to import.",
    "Metrics below are computed over what survived. A failure is scored as producing nothing,",
    "which is a real result, but it is not the same result as low recall:",
  ];
  for (const entry of failed)
    lines.push("  " + entry.transcript.id + " · " + (entry.failure ?? "unknown"));
  return lines.join("\n");
}
