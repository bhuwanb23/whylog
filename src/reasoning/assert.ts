/**
 * The assertion entry point — 2.1.
 *
 * Phase 2 · sub-phase 2.1
 * Plan: plan/phase-2-truth-maintenance.md §2.1
 *
 * ---------------------------------------------------------------------------
 * ONE FUNCTION, FOUR INPUT KINDS, IDENTICAL DOWNSTREAM BEHAVIOUR
 *
 * Every source of new information enters here:
 *
 *   · transcript     — a reviewed extraction batch
 *   · user-decision  — something a human typed in
 *   · guard-result   — a check that ran against the repo (Phase 4)
 *   · repo-scan      — an observation about the codebase (Phase 4)
 *
 * The acceptance criterion is not that all four work. It is that **the reasoning code
 * never branches on which one arrived**. `labeller`, `gates`, `backtracking`,
 * `cascade`, `entrenchment`, `adjudication` and `proposals` see a `GraphState` and
 * nothing else. There is no `if (source === "guard")` anywhere downstream, and there
 * cannot be, because this module is the only place the source is known.
 *
 * That is what makes a guard failure and a transcript remark EQUIVALENT in the eyes of
 * the reasoner — and it is the reason `implementation_cost` can feed entrenchment
 * without a special case. A system that handled guards separately would have two
 * reasoning paths, and only one of them would be tested.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRODUCES
 *
 * Event drafts, plus an optional `Newcomer` for the adjudicator. It appends nothing:
 * the store owns `append → fold → persist`, and the cycle has to run on the state
 * AFTER these events are folded, not before. So the orchestration is two batches:
 *
 *   1. assert  → append these drafts → fold → new state
 *   2. revise  → run the cycle over the new state → append its drafts → fold
 *
 * Running the labeller on the pre-assertion state would label the graph as it was
 * before the new information arrived, which is the one thing this module exists to
 * prevent.
 *
 * ---------------------------------------------------------------------------
 * WHAT A GUARD RESULT DOES IN PHASE 2
 *
 * It asserts a PREMISE, with evidence of kind `guard`. It does not emit `GuardFailed`,
 * because guards do not exist yet — Phase 4 creates them, and a `GuardFailed` event
 * naming a guard id that was never synthesised would not fold. The observation is the
 * part that matters to the reasoner, and it arrives in the same shape as every other
 * observation. When Phase 4 lands, `GuardFailed` is emitted by the guard runner and
 * this path keeps doing what it does now.
 * ---------------------------------------------------------------------------
 */

import type {
  Actor,
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  EventId,
  ISODateString,
  JustificationId,
  PremiseId,
  SourceSpan,
  TranscriptId,
} from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionOrigin, DecisionVariable, Justification, PremiseType } from "@/types/domain";
import type { EventType, NewEvent } from "@/types/events";
import { canonicalPredicate, canonicalValueOf, foldKey } from "@/ontology/canonicalize";
import {
  formatDecisionId,
  formatEpisodeId,
  formatJustificationId,
  formatPremiseId,
  formatTranscriptId,
} from "@/lib/ids";
import type { GraphState } from "@/substrate/graph-state";
import type { Newcomer } from "./adjudication";

/* -------------------------------------------------------------------------- */
/* The four kinds                                                             */
/* -------------------------------------------------------------------------- */

export type AssertionSource = "transcript" | "user-decision" | "guard-result" | "repo-scan";

/** One premise being asserted or refuted. Shared by all four kinds. */
export interface PremiseAssertion {
  readonly type: PremiseType;
  /** Namespaced, e.g. "scale.max_users". Canonicalised here, not by the caller. */
  readonly predicate: string;
  readonly value?: string | number | boolean;
  /** Natural-language form, e.g. "the app now has two concurrent editors". */
  readonly text: string;
  /** False means this observation REFUTES the premise rather than supporting it. */
  readonly supports: boolean;
  readonly confidence: Confidence;
  /** Where it came from. Absent for a human typing it in, which is honest: there is
   *  no span to point at, and inventing one would claim a source that does not exist. */
  readonly span?: SourceSpan;
}

/** A decision being asserted. Only `user-decision` and `transcript` carry these. */
export interface DecisionAssertion {
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  readonly rationale?: string;
  readonly origin: DecisionOrigin;
  readonly confidence: Confidence;
  /** Indices into `premises`, resolved to real ids here. The caller never mints ids. */
  readonly premiseRefs?: readonly number[];
  readonly span?: SourceSpan;
  readonly appliesTo?: readonly string[];
}

export type Assertion =
  | {
      readonly source: "transcript";
      readonly transcriptId: TranscriptId;
      readonly premises: readonly PremiseAssertion[];
      readonly decisions: readonly DecisionAssertion[];
      readonly occurredAt?: ISODateString;
    }
  | {
      readonly source: "user-decision";
      readonly decision: DecisionAssertion;
      readonly premises: readonly PremiseAssertion[];
    }
  | {
      readonly source: "guard-result";
      readonly decisionId: DecisionId;
      readonly passed: boolean;
      /** What the guard observed. Becomes a premise with evidence of kind `guard`. */
      readonly observation: PremiseAssertion;
    }
  | {
      readonly source: "repo-scan";
      readonly observations: readonly PremiseAssertion[];
    };

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface AssertContext {
  readonly state: GraphState;
  readonly actor: Actor;
  readonly engine: EngineId;
  readonly at: ISODateString;
  /** Which of the four kinds this is. Carried explicitly rather than inferred from the
   *  actor: a guard run and a repo scan both arrive as a system actor, and guessing
   *  between them would put the wrong source in the reason string — the one field whose
   *  entire job is to say where the information came from. */
  readonly source: AssertionSource;
  /** Human-authored text needs a transcript to be verbatim FROM. Created on demand
   *  and labelled as such; see `store/reasoning.ts` for why this is not a shortcut. */
  readonly humanTranscriptId?: TranscriptId;
  /** Valid time of the observation, when it is known. A transcript has one; a guard
   *  result does not, and defaults to `at`. */
  readonly occurredAt?: ISODateString;
}

export interface AssertionResult {
  readonly drafts: readonly NewEvent<EventType>[];
  /** Set when the assertion is decision-level, so the adjudicator can screen it.
   *  Premise-only assertions produce no newcomer: there is nothing to screen against
   *  an incumbent, and inventing one would run adjudication on a premise. */
  readonly newcomer: Newcomer | null;
  readonly summary: string;
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn new information into events.
 *
 * The `switch` on `source` is HERE AND NOWHERE ELSE. Each branch produces the same
 * kind of thing — premise assertions and, where applicable, decision assertions — and
 * the shared tail below turns those into drafts identically. That is the mechanism by
 * which the acceptance criterion holds: the branches differ in what they collect, not
 * in what the reasoner later sees.
 */
export function assertNewInformation(
  assertion: Assertion,
  context: AssertContext,
): AssertionResult {
  const premises: PremiseAssertion[] = [];
  const decisions: DecisionAssertion[] = [];
  let newcomer: Newcomer | null = null;

  switch (assertion.source) {
    case "transcript": {
      premises.push(...assertion.premises);
      decisions.push(...assertion.decisions);
      break;
    }

    case "user-decision": {
      premises.push(...assertion.premises);
      decisions.push(assertion.decision);
      break;
    }

    case "guard-result": {
      /* A guard that FAILED asserts the negation of what the decision assumed. The
       * observation carries `supports: false` in that case, and the shared tail turns
       * it into evidence that refutes — which is exactly what gate (c) reads. */
      premises.push({
        ...assertion.observation,
        supports: assertion.passed ? assertion.observation.supports : false,
      });
      break;
    }

    case "repo-scan": {
      premises.push(...assertion.observations);
      break;
    }
  }

  /* ---- the shared tail: identical for all four kinds ---- */

  const drafts: NewEvent<EventType>[] = [];
  const mintedPremiseIds: PremiseId[] = [];
  let premiseNumber = context.state.counters.premises;
  let justificationNumber = context.state.counters.justifications;
  let transcriptNumber = context.state.counters.transcripts;
  let decisionNumber = context.state.counters.decisions;
  let episodeNumber = context.state.counters.episodes;

  const transcriptId: TranscriptId =
    transcriptIdFor(assertion, context) ??
    nextTranscriptId(context, drafts, ++transcriptNumber);

  for (const premise of premises) {
    premiseNumber += 1;
    const premiseId = formatPremiseId(premiseNumber);
    mintedPremiseIds.push(premiseId);

    drafts.push(premiseDraft(premise, premiseId, transcriptId, context));
  }

  for (const decision of decisions) {
    /* Local refs resolve against the premises minted in THIS assertion, in order. */
    const inList: PremiseId[] = (decision.premiseRefs ?? [])
      .map((index) => mintedPremiseIds[index])
      .filter((id): id is PremiseId => id !== undefined);

    const existing = findExistingDecision(context.state, decision);
    if (existing !== null) {
      /* Not a new decision — the same one, asserted again. Attaching a justification
       * is the honest response: it corroborates rather than duplicating, and identity
       * resolution has already decided these are the same node. */
      justificationNumber += 1;
      drafts.push(
        justificationDraft(
          formatJustificationId(justificationNumber),
          existing,
          inList,
          context,
        ),
      );
      continue;
    }

    decisionNumber += 1;
    episodeNumber += 1;

    drafts.push(
      ...decisionDraft(
        decision,
        formatDecisionId(decisionNumber),
        formatEpisodeId(episodeNumber),
        inList,
        transcriptId,
        context,
        () => {
          justificationNumber += 1;
          return formatJustificationId(justificationNumber);
        },
      ),
    );
  }

  /* A decision-level assertion becomes a newcomer for the adjudicator. */
  const firstDecision = decisions[0];
  if (firstDecision !== undefined) {
    newcomer = {
      variable: firstDecision.variable,
      value: canonicalValueOf(firstDecision.variable, firstDecision.value),
      text: firstDecision.statement,
      origin: firstDecision.origin,
      confidence: firstDecision.confidence,
      source: sourceOf(assertion.source),
    };
  }

  return {
    drafts,
    newcomer,
    summary: summarise(assertion, drafts, mintedPremiseIds.length, decisions.length),
  };
}

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

function premiseDraft(
  premise: PremiseAssertion,
  premiseId: PremiseId,
  transcriptId: TranscriptId,
  context: AssertContext,
): NewEvent<"PremiseAsserted"> {
  const text = premise.text.trim();

  return {
    type: "PremiseAsserted",
    payload: {
      premiseId,
      transcriptId,
      type: premise.type,
      predicate: canonicalPredicate(premise.type, premise.predicate),
      ...(premise.value === undefined ? {} : { value: premise.value }),
      /* A refuting observation is still a TRUE fact about the world — "there are now
       * two editors" is true, and it is what falsifies `single-user`. The polarity
       * lives in the justification's IN/OUT lists, never in the premise text. */
      text: premise.supports ? text : `refuted: ${text}`,
      confidence: premise.confidence,
      engine: context.engine,
      snippet:
        premise.span ?? {
          transcriptId,
          start: 0,
          end: text.length,
          text,
        },
    },
    actor: context.actor,
    reason: reasonFor(premise, context),
    at: context.at,
  };
}

function justificationDraft(
  justificationId: JustificationId,
  consequent: DecisionId,
  inList: readonly PremiseId[],
  context: AssertContext,
): NewEvent<"JustificationAttached"> {
  const justification: Justification = {
    id: justificationId,
    consequent,
    inList,
    outList: [],
    informant: informantFor(context),
    createdAt: context.at,
  };

  return {
    type: "JustificationAttached",
    payload: { justificationId, consequent, justification },
    actor: context.actor,
    reason: `${consequent} gains an additional justification resting on ${inList.join(", ")}. Corroboration, not a new decision.`,
    at: context.at,
  };
}

function decisionDraft(
  decision: DecisionAssertion,
  decisionId: DecisionId,
  episodeId: EpisodeId,
  inList: readonly PremiseId[],
  transcriptId: TranscriptId,
  context: AssertContext,
  nextJustificationId: () => JustificationId,
): readonly NewEvent<EventType>[] {
  const justificationId = nextJustificationId();
  const statement = decision.statement.trim();

  const justification: Justification = {
    id: justificationId,
    consequent: decisionId,
    inList,
    outList: [],
    informant: informantFor(context),
    createdAt: context.at,
  };

  return [
    {
      type: "DecisionProposed",
      payload: {
        decisionId,
        transcriptId,
        episodeId,
        variable: decision.variable,
        value: canonicalValueOf(decision.variable, decision.value),
        statement,
        ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
        origin: decision.origin,
        modality: "asserted",
        confidence: decision.confidence,
        engine: context.engine,
        snippet:
          decision.span ?? { transcriptId, start: 0, end: statement.length, text: statement },
        premiseIds: inList,
        alternativeIds: [],
        ...(decision.appliesTo === undefined ? {} : { appliesTo: decision.appliesTo }),
      },
      actor: context.actor,
      reason: `Asserted from ${sourceLabel(context.source)}: ${statement}`,
      at: context.at,
      ...(assertionOccurredAt(context) === null ? {} : { occurredAt: assertionOccurredAt(context) as ISODateString }),
    },
    {
      type: "JustificationAttached",
      payload: { justificationId, consequent: decisionId, justification },
      actor: context.actor,
      reason:
        inList.length === 0
          ? `${decisionId} rests on NO premise. It is an unsupported assertion, and the labeller will report it as such rather than silently marking it IN.`
          : `${decisionId} rests on ${inList.join(", ")}.`,
      at: context.at,
    },
  ];
}

/** Valid time, when the assertion carries it. A transcript knows when the conversation
 *  happened; a guard result happens now. */
function assertionOccurredAt(context: AssertContext): ISODateString | null {
  return context.occurredAt ?? null;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Is this decision already in the log?
 *
 * Same variable and same canonical value. That is rung 1 of the identity ladder and it
 * is exact enough here: a decision assertion arriving through this entry point has
 * already been canonicalised, and a fuzzy match belongs to the extraction pipeline,
 * which has context this function does not.
 */
export function findExistingDecision(
  state: GraphState,
  decision: DecisionAssertion,
): DecisionId | null {
  const canonical = foldKey(canonicalValueOf(decision.variable, decision.value));

  for (const existing of state.decisions.values()) {
    if (existing.variable !== decision.variable) continue;
    if (foldKey(existing.value) === canonical) return existing.id;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Transcripts, informants, reasons                                           */
/* -------------------------------------------------------------------------- */

function transcriptIdFor(
  assertion: Assertion,
  context: AssertContext,
): TranscriptId | null {
  if (assertion.source === "transcript") return assertion.transcriptId;
  return context.humanTranscriptId ?? null;
}

/**
 * Create a transcript to hold human- or machine-authored text.
 *
 * `PremiseAsserted` requires a verbatim snippet from SOME transcript. For text nobody
 * said in a recorded conversation, the honest container is a new transcript labelled
 * with its actual origin — not a fabricated span inside the user's real one, which
 * would claim they said something they did not.
 */
function nextTranscriptId(
  context: AssertContext,
  drafts: NewEvent<EventType>[],
  n: number,
): TranscriptId {
  const transcriptId = formatTranscriptId(n);

  drafts.unshift({
    type: "TranscriptImported",
    payload: {
      transcriptId,
      rawChars: 0,
      label: "asserted outside a transcript",
      engine: context.engine,
    },
    actor: context.actor,
    reason:
      "Premises asserted by hand, by a guard or by a repo scan have no transcript to be verbatim from. This one exists to hold exactly that text, so every snippet in the log points at something real.",
    at: context.at,
  });

  return transcriptId;
}

function informantFor(context: AssertContext): Justification["informant"] {
  /* A human informant has no event to point at, and pointing at an unrelated one would
   * be worse than saying so. */
  return context.actor.kind === "human" ? { kind: "human" } : { kind: "rejustification", eventId: PLACEHOLDER_EVENT_ID };
}

/** Resolved to the creating event by the materialiser on fold. */
const PLACEHOLDER_EVENT_ID = "EV-000000-000000" as EventId;

function reasonFor(premise: PremiseAssertion, context: AssertContext): string {
  const verb = premise.supports ? "supports" : "REFUTES";
  return `${verb} ${premise.type}.${canonicalPredicate(premise.type, premise.predicate)}: "${premise.text}" — observed by ${context.actor.kind}, confidence ${premise.confidence.toFixed(2)}.`;
}

function sourceOf(source: AssertionSource): Newcomer["source"] {
  switch (source) {
    case "transcript":
      return "transcript";
    case "user-decision":
      return "human";
    case "guard-result":
      return "guard";
    case "repo-scan":
      return "repo-scan";
  }
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

export function sourceLabel(source: AssertionSource): string {
  switch (source) {
    case "transcript":
      return "a reviewed transcript";
    case "user-decision":
      return "a decision you entered by hand";
    case "guard-result":
      return "a guard run";
    case "repo-scan":
      return "a repo scan";
  }
}

function summarise(
  assertion: Assertion,
  drafts: readonly NewEvent<EventType>[],
  premiseCount: number,
  decisionCount: number,
): string {
  const refuting =
    assertion.source === "guard-result" && !assertion.passed
      ? " The guard FAILED, so the observation refutes what the decision assumed."
      : "";

  const tally = drafts
    .map((draft) => draft.type)
    .reduce<Record<string, number>>((accumulator, type) => {
      accumulator[type] = (accumulator[type] ?? 0) + 1;
      return accumulator;
    }, {});

  const parts = Object.entries(tally).map(([type, count]) => `${count} × ${type}`);

  return [
    `Asserted from ${sourceLabel(assertion.source)}: ${premiseCount} premise(s), ${decisionCount} decision(s).`,
    parts.length === 0 ? "No events — everything was already in the log." : `Events: ${parts.join(", ")}.`,
    refuting.trim(),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/* -------------------------------------------------------------------------- */
/* Convenience constructors                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Falsify a premise by predicate.
 *
 * The single most common assertion in the whole product, and the one the G2 demo runs
 * on: "there are now two users" against a log built on `single-user`. It is a function
 * rather than a form because Phase 4 calls it from the guard runner with the same
 * arguments, and a demo path that differs from the production path is a demo that
 * proves nothing.
 */
export function falsifyPremise(
  type: PremiseType,
  predicate: string,
  observedText: string,
  context: AssertContext,
): Assertion {
  return {
    source: "repo-scan",
    observations: [
      {
        type,
        predicate,
        text: observedText,
        supports: false,
        confidence: asConfidence(0.9),
      },
    ],
  };
}

/** A decision entered by hand, with the premises it rests on. */
export function userDecision(
  decision: DecisionAssertion,
  premises: readonly PremiseAssertion[] = [],
): Assertion {
  return { source: "user-decision", decision, premises };
}

/** A guard's verdict on a decision. Phase 4 calls this. */
export function guardResult(
  decisionId: DecisionId,
  passed: boolean,
  observation: PremiseAssertion,
): Assertion {
  return { source: "guard-result", decisionId, passed, observation };
}

