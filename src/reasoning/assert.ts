/**
 * The assertion entry point ΓÇö 2.1.
 *
 * Phase 2 ┬╖ sub-phase 2.1
 * Plan: plan/phase-2-truth-maintenance.md ┬º2.1
 *
 * ---------------------------------------------------------------------------
 * ONE FUNCTION, FOUR INPUT KINDS, IDENTICAL DOWNSTREAM BEHAVIOUR
 *
 * Every source of new information enters here:
 *
 *   ┬╖ transcript     ΓÇö a reviewed extraction batch
 *   ┬╖ user-decision  ΓÇö something a human typed in
 *   ┬╖ guard-result   ΓÇö a check that ran against the repo (Phase 4)
 *   ┬╖ repo-scan      ΓÇö an observation about the codebase (Phase 4)
 *
 * The acceptance criterion is not that all four work. It is that **the reasoning code
 * never branches on which one arrived**. `labeller`, `gates`, `backtracking`,
 * `cascade`, `entrenchment`, `adjudication` and `proposals` see a `GraphState` and
 * nothing else. There is no `if (source === "guard")` anywhere downstream, and there
 * cannot be, because this module is the only place the source is known.
 *
 * That is what makes a guard failure and a transcript remark EQUIVALENT in the eyes of
 * the reasoner ΓÇö and it is the reason `implementation_cost` can feed entrenchment
 * without a special case. A system that handled guards separately would have two
 * reasoning paths, and only one of them would be tested.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRODUCES
 *
 * Event drafts, plus an optional `Newcomer` for the adjudicator. It appends nothing:
 * the store owns `append ΓåÆ fold ΓåÆ persist`, and the cycle has to run on the state
 * AFTER these events are folded, not before. So the orchestration is two batches:
 *
 *   1. assert  ΓåÆ append these drafts ΓåÆ fold ΓåÆ new state
 *   2. revise  ΓåÆ run the cycle over the new state ΓåÆ append its drafts ΓåÆ fold
 *
 * Running the labeller on the pre-assertion state would label the graph as it was
 * before the new information arrived, which is the one thing this module exists to
 * prevent.
 *
 * ---------------------------------------------------------------------------
 * WHAT A GUARD RESULT DOES IN PHASE 2
 *
 * It asserts a PREMISE, with evidence of kind `guard`. It does not emit `GuardFailed`,
 * because guards do not exist yet ΓÇö Phase 4 creates them, and a `GuardFailed` event
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
  GuardId,
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
  premiseFingerprint,
} from "@/lib/ids";
import type { GraphState } from "@/substrate/graph-state";
import type { Nogood } from "@/types/domain";
import type { Newcomer } from "./adjudication";
import { blocksConjunction } from "./nogoods";

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
   *  between them would put the wrong source in the reason string ΓÇö the one field whose
   *  entire job is to say where the information came from. */
  readonly source: AssertionSource;
  /** Human-authored text needs a transcript to be verbatim FROM. Created on demand
   *  and labelled as such; see `store/reasoning.ts` for why this is not a shortcut. */
  readonly humanTranscriptId?: TranscriptId;
  /** Valid time of the observation, when it is known. A transcript has one; a guard
   *  result does not, and defaults to `at`. */
  readonly occurredAt?: ISODateString;
}

/**
 * An assertion that could not be resolved to a premise node.
 *
 * ┬º2.11: "Exact predicate match only; ambiguous cases are surfaced for human
 * confirmation rather than guessed." ┬º2.5: a false premise resolution produces "a
 * confident, spectacular, entirely wrong cascade" ΓÇö so an unresolved or ambiguous match
 * is REPORTED, never acted on.
 */
export interface UnresolvedPremise {
  readonly assertion: PremiseAssertion;
  readonly kind: "no-match" | "ambiguous";
  /** The candidates a human should choose between. Empty for `no-match`. */
  readonly candidates: readonly PremiseId[];
  readonly explanation: string;
}

export interface AssertionResult {
  readonly drafts: readonly NewEvent<EventType>[];
  readonly unresolved: readonly UnresolvedPremise[];
  /** Set when the assertion is decision-level, so the adjudicator can screen it.
   *  Premise-only assertions produce no newcomer: there is nothing to screen against
   *  an incumbent, and inventing one would run adjudication on a premise. */
  readonly newcomer: Newcomer | null;
  /**
   * ┬º2.6 nogood REUSE, checked at the ASSERTION rather than at the proposal.
   *
   * Catching it here is strictly better: the warning arrives while the user is still
   * deciding whether to assert, instead of after the events are in the log and the
   * proposal has been generated. Non-null means these premises are a conjunction the log
   * has already recorded as impossible.
   */
  readonly reassertsNogood: Nogood | null;
  readonly summary: string;
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn new information into events.
 *
 * The `switch` on `source` is HERE AND NOWHERE ELSE. Each branch produces the same
 * kind of thing ΓÇö premise assertions and, where applicable, decision assertions ΓÇö and
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
       * it into evidence that refutes ΓÇö which is exactly what gate (c) reads. */
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
  const unresolved: UnresolvedPremise[] = [];
  const mintedPremiseIds: PremiseId[] = [];
  let premiseNumber = context.state.counters.premises;
  let justificationNumber = context.state.counters.justifications;
  let transcriptNumber = context.state.counters.transcripts;
  let decisionNumber = context.state.counters.decisions;
  let episodeNumber = context.state.counters.episodes;

  const transcriptId: TranscriptId =
    transcriptIdFor(assertion, context) ??
    nextTranscriptId(context, drafts, ++transcriptNumber);

  /* A human, a guard or a repo scan is its own authority: what it says is confirmed on
   * arrival. A transcript is not ΓÇö extracted prose enters as UNKNOWN and waits for
   * review, because nothing enters the log unreviewed. */
  const authoritative = assertion.source !== "transcript";

  for (const premise of premises) {
    const resolution = resolvePremise(context.state, premise);

    /* ---- unresolved: report, never guess ---- */
    if (resolution.kind !== "resolved") {
      if (!premise.supports) {
        /* Nothing to refute. Creating a premise just to invalidate it would put a node
         * in the graph whose entire history is "asserted and immediately killed", and
         * gate (c) would fire on a decision that never rested on it. */
        unresolved.push({
          assertion: premise,
          kind: resolution.kind,
          candidates: resolution.candidates,
          explanation:
            resolution.kind === "ambiguous"
              ? `Several premises match ${premise.type}.${premise.predicate}. A refutation aimed at the wrong one produces a spectacular, entirely wrong cascade, so pick the target rather than letting this guess.`
              : `No premise in the log matches ${premise.type}.${premise.predicate}, so there is nothing to refute. If this was meant to falsify something, the predicate does not match ΓÇö check the type as well, since premises of different types are never the same node however similar their text.`,
        });
        continue;
      }

      /* A new supporting premise with no match. Mint it. */
      premiseNumber += 1;
      const premiseId = formatPremiseId(premiseNumber);
      mintedPremiseIds.push(premiseId);
      drafts.push(premiseDraft(premise, premiseId, transcriptId, context));

      /* Confirming it makes it IN, which is what lets an OUT-list exclusion fire:
       * "an excluded condition arrived" only invalidates a justification once the
       * condition is actually believed. Left UNKNOWN for a transcript. */
      if (authoritative) drafts.push(confirmDraft(premiseId, premise, context));
      continue;
    }

    const existingId = resolution.premiseId;

    /* ---- resolved and REFUTING: this is what invalidates an IN-list premise ---- */
    if (!premise.supports) {
      drafts.push(invalidateDraft(existingId, premise, assertion.source, context));
      continue;
    }

    /* ---- resolved and SUPPORTING: re-assert on the EXISTING id ----
     * Invariant I2 ΓÇö premises are shared nodes. `PremiseAsserted` on an existing id
     * appends evidence and takes the max confidence; minting a second node would halve
     * the corroboration count on both and leave gate (c) looking at a premise that
     * nothing rests on. */
    drafts.push(premiseDraft(premise, existingId, transcriptId, context));
    mintedPremiseIds.push(existingId);

    /* If it was UNKNOWN and this source is authoritative, it becomes IN ΓÇö which is the
     * OUT-list half of gate (c). */
    const existing = context.state.premises.get(existingId);
    if (authoritative && existing !== undefined && existing.label !== "IN") {
      drafts.push(confirmDraft(existingId, premise, context));
    }
  }

  for (const decision of decisions) {
    /* Local refs resolve against the premises this assertion touched, in order. */
    const inList: PremiseId[] = (decision.premiseRefs ?? [])
      .map((index) => mintedPremiseIds[index])
      .filter((id): id is PremiseId => id !== undefined);

    const existingDecision = findExistingDecision(context.state, decision);
    if (existingDecision !== null) {
      /* Not a new decision ΓÇö the same one, asserted again. Attaching a justification
       * corroborates rather than duplicating; identity resolution already decided these
       * are the same node. */
      justificationNumber += 1;
      drafts.push(
        justificationDraft(formatJustificationId(justificationNumber), existingDecision, inList, context),
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

  /* Existing premises named by a decision assertion, plus any premise this assertion
   * refutes, form the conjunction being asserted. Checked against the recorded nogoods
   * so the user is warned BEFORE the batch is committed rather than after. */
  const conjunction = conjunctionOf(context.state, decisions, mintedPremiseIds);
  const reassertsNogood = blocksConjunction(context.state, conjunction);

  return {
    drafts,
    unresolved,
    newcomer,
    reassertsNogood,
    summary: summarise(
      assertion,
      drafts,
      mintedPremiseIds.length,
      decisions.length,
      reassertsNogood,
      unresolved,
    ),
  };
}

/** The premises this assertion would place in the log together. */
function conjunctionOf(
  state: GraphState,
  decisions: readonly DecisionAssertion[],
  minted: readonly PremiseId[],
): readonly PremiseId[] {
  const found = new Set<PremiseId>(minted);

  for (const decision of decisions) {
    const existing = findExistingDecision(state, decision);
    if (existing === null) continue;
    for (const justification of state.justifications.values()) {
      if (justification.consequent !== existing) continue;
      for (const premiseId of justification.inList) found.add(premiseId);
    }
  }

  return [...found];
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
      /* A refuting observation is still a TRUE fact about the world ΓÇö "there are now
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

export type PremiseResolution =
  | { readonly kind: "resolved"; readonly premiseId: PremiseId }
  | { readonly kind: "ambiguous"; readonly candidates: readonly PremiseId[] }
  | { readonly kind: "no-match"; readonly candidates: readonly PremiseId[] };

/**
 * Exact (type, predicate) match, or nothing.
 *
 * ┬º2.5's precision discipline, implemented as a refusal to be clever. Gate (c) fires
 * only on RESOLVED premise identity, and the failure mode of getting this wrong is not
 * a missed detection ΓÇö it is a confident, spectacular, entirely wrong cascade.
 *
 * Two rules that are not negotiable:
 *
 *   ┬╖ Predicates are canonicalised before comparison, so "max users" and "max_users"
 *     match and "max user" does not silently become something else.
 *   ┬╖ Premises of DIFFERENT TYPES never match, however similar their text. "single user"
 *     (scale) and "single sign-on user flow" (requirement) are different nodes, and a
 *     false merge between them is the exact scenario the identity ladder forbids.
 *
 * A near-match is NOT promoted to a match. It is reported as `no-match` and the
 * candidates are handed to a human, which is what ┬º2.11 means by "surfaced for human
 * confirmation rather than guessed".
 */
export function resolvePremise(
  state: GraphState,
  assertion: PremiseAssertion,
): PremiseResolution {
  const canonical = canonicalPredicate(assertion.type, assertion.predicate);

  /* The fold's OWN identity index, keyed by `premiseFingerprint(type, predicate)`.
   *
   * Using it rather than scanning `state.premises` is not an optimisation, though it is
   * one. It is the guarantee that the reasoner and the fold agree about what the same
   * premise IS. A resolver with its own notion of identity would eventually resolve a
   * premise the fold considers distinct, and gate (c) would fire on a node nothing
   * actually rests on ΓÇö the "confident, spectacular, entirely wrong cascade" ┬º2.5 warns
   * about, arriving through the front door instead of through fuzzy matching. */
  const byFingerprint = state.premiseByFingerprint.get(
    premiseFingerprint(assertion.type, canonical),
  );

  if (byFingerprint !== undefined && state.premises.has(byFingerprint)) {
    return { kind: "resolved", premiseId: byFingerprint };
  }

  /* Not in the index. Enumerate anyway, because the index can lag a node that was
   * created before canonicalisation settled, and reporting those as candidates is what
   * turns a silent no-match into a human decision. */
  const matches: PremiseId[] = [];
  for (const premise of state.premises.values()) {
    if (premise.type !== assertion.type) continue;
    if (premise.predicate !== canonical) continue;
    matches.push(premise.id);
  }

  if (matches.length === 1) return { kind: "resolved", premiseId: matches[0] as PremiseId };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "no-match", candidates: [] };
}

/**
 * Predicates that ALMOST match, for the human-confirmation UI.
 *
 * Deliberately separate from `resolvePremise` and never consulted by it: a resolver
 * that can see near-matches will eventually be tempted to use them, and the whole
 * precision discipline rests on it not being able to.
 */
export function nearMatches(
  state: GraphState,
  assertion: PremiseAssertion,
  limit = 5,
): readonly PremiseId[] {
  const canonical = canonicalPredicate(assertion.type, assertion.predicate);
  const wanted = foldKey(canonical.split(".").pop() ?? canonical);
  const out: { id: PremiseId; score: number }[] = [];

  for (const premise of state.premises.values()) {
    const have = foldKey(premise.predicate.split(".").pop() ?? premise.predicate);
    if (have === wanted) continue;
    if (!have.includes(wanted) && !wanted.includes(have)) continue;
    /* Same type scores higher. Cross-type near-matches are shown LAST and labelled,
     * because they are the ones a human is most likely to accept wrongly. */
    const score = premise.type === assertion.type ? 1 : 0;
    out.push({ id: premise.id, score });
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.id);
}

/* -------------------------------------------------------------------------- */
/* The three premise events                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Refute an existing premise.
 *
 * This is the event that makes gate (c) fire on the IN-list side: the materialiser sets
 * `label: OUT` and closes the validity window, the labeller propagates, and every
 * decision whose IN-list named it loses support.
 *
 * `invalidatedBy.kind` has three members and a repo scan is not one of them ΓÇö it maps to
 * `"assertion"`, which is what it is: an assertion about the world that happens to have
 * come from a scan rather than a conversation.
 */
function invalidateDraft(
  premiseId: PremiseId,
  premise: PremiseAssertion,
  source: AssertionSource,
  context: AssertContext,
): NewEvent<"PremiseInvalidated"> {
  const invalidatedBy: PremiseInvalidatedBy =
    source === "guard-result"
      ? { kind: "guard", guardId: PLACEHOLDER_GUARD_ID }
      : source === "user-decision"
        ? { kind: "human" }
        : { kind: "assertion", eventId: PLACEHOLDER_EVENT_ID };

  return {
    type: "PremiseInvalidated",
    payload: {
      premiseId,
      invalidatedBy,
      ...(premise.span === undefined ? {} : { evidenceSpan: premise.span }),
    },
    actor: context.actor,
    reason: `${premiseId} is no longer true: "${premise.text}" ΓÇö observed by ${sourceLabel(source)}. Every decision resting on it is re-examined, and this event is the record of what falsified it.`,
    at: context.at,
    ...(context.occurredAt === undefined ? {} : { occurredAt: context.occurredAt }),
  };
}

/**
 * Make a premise IN.
 *
 * Only for sources that are their own authority. Without this, an OUT-list exclusion
 * stays UNKNOWN and gate (c) never fires on it ΓÇö "an excluded condition arrived" is only
 * an invalidation once the condition is actually believed.
 */
function confirmDraft(
  premiseId: PremiseId,
  premise: PremiseAssertion,
  context: AssertContext,
): NewEvent<"PremiseConfirmed"> {
  return {
    type: "PremiseConfirmed",
    payload: { premiseId },
    actor: context.actor,
    reason: `Confirmed by ${context.actor.kind}: "${premise.text}". This makes it IN, which is what lets an excluded condition invalidate a justification that ruled it out.`,
    at: context.at,
    ...(context.occurredAt === undefined ? {} : { occurredAt: context.occurredAt }),
  };
}

/** `PremiseInvalidatedPayload["invalidatedBy"]`, named so the union is readable. */
type PremiseInvalidatedBy = NewEvent<"PremiseInvalidated">["payload"]["invalidatedBy"];

/** Phase 4 mints real guard ids. Until then a guard-sourced invalidation records the
 *  placeholder and the materialiser resolves it to the creating event, exactly as it
 *  does for every other forward reference in this codebase. */
const PLACEHOLDER_GUARD_ID = "WLD-0000.g0" as GuardId;



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
 * with its actual origin ΓÇö not a fabricated span inside the user's real one, which
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
  return `${verb} ${premise.type}.${canonicalPredicate(premise.type, premise.predicate)}: "${premise.text}" ΓÇö observed by ${context.actor.kind}, confidence ${premise.confidence.toFixed(2)}.`;
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
  reassertsNogood: Nogood | null,
  unresolved: readonly UnresolvedPremise[],
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

  const parts = Object.entries(tally).map(([type, count]) => `${count} ├ù ${type}`);

  const unresolvedNote =
    unresolved.length === 0
      ? ""
      : `${unresolved.length} assertion(s) matched no premise and were NOT acted on ΓÇö see the unresolved list.`;

  const nogoodWarning =
    reassertsNogood === null
      ? ""
      : `WARNING: this re-asserts ${reassertsNogood.id}, recorded impossible on ${reassertsNogood.recordedAt.slice(0, 10)}.`;

  return [
    nogoodWarning,
    unresolvedNote,
    `Asserted from ${sourceLabel(assertion.source)}: ${premiseCount} premise(s), ${decisionCount} decision(s).`,
    parts.length === 0 ? "No events ΓÇö everything was already in the log." : `Events: ${parts.join(", ")}.`,
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

