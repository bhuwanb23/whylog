/**
 * REVISE(newInfo) ΓÇö the nine-step cycle. 2.1
 *
 * Phase 2 ┬╖ sub-phase 2.1
 * Plan: plan/phase-2-truth-maintenance.md ┬º2.1
 * Docs: docs/02-truth-maintenance-theory.md ┬º5
 *
 * ---------------------------------------------------------------------------
 * THE ONLY ENTRY POINT
 *
 * Nothing outside this file calls the labeller, the gates, backtracking, the cascade,
 * the adjudicator or the proposal builder. Every one of them is a pure function that
 * takes the graph and returns a value; this module is the only place that decides the
 * ORDER they run in, and the order is the algorithm.
 *
 * That matters for one concrete reason: running the cascade before backtracking would
 * retract everything downstream of a premise that backtracking would have shown was not
 * the culprit. Running adjudication before detection would screen a newcomer against
 * conflicts the detector has not found yet. The sequence is not a stylistic choice.
 *
 *   1 EXTRACT     what the new information actually says
 *   2 RESOLVE     which existing node it refers to
 *   3 ASSERT      label the graph, find what is now unsound
 *   4 DETECT      gates (a) structural, (b) semantic, (c) premise
 *   5 BACKTRACK   the MINIMAL set of assumptions responsible
 *   6 CASCADE     what else falls, stopping at independent support
 *   7 ADJUDICATE  Hansson screening ΓÇö the newcomer may be REFUSED
 *   8 PROPOSE     seven parts, never auto-applied
 *   9 COMMIT      event drafts, appended by the store, not by us
 *
 * ---------------------------------------------------------------------------
 * STEP 9 DOES NOT WRITE
 *
 * This module returns drafts. The store appends them, because appending is
 * `append ΓåÆ fold ΓåÆ persist` and only the store owns all three. A reasoning module that
 * could write to the log could also write to it out of order, and the hash chain would
 * faithfully record a corrupted sequence.
 *
 * The drafts are ordered: `LabelChanged` first, then detections, then nogoods, then
 * cascades, then proposals. A proposal references the nogood that explains it, and a
 * nogood references the detection that produced it, so the order is not arbitrary ΓÇö it
 * is the order in which each event's referents come into existence.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCE
 *
 * Running REVISE twice over an unchanged log produces NO new events the second time.
 * Labels have already changed, so `changed` is empty. Detections have already been
 * recorded, so they are filtered against the log. Nogoods already exist, so
 * `isDuplicate` blocks them. Proposals already exist for these findings, so they are
 * not raised again.
 *
 * Without this the log fills with repeated identical warnings, and a queue the user
 * has already read looks permanently unread ΓÇö which is how a reasoning system gets
 * switched off.
 * ---------------------------------------------------------------------------
 */

import type { Actor, DecisionId, EventId, NogoodId, PremiseId } from "@/types/common";
import type { NewEvent } from "@/types/events";
import type {
  AdjudicationOutcome,
  BacktrackResult,
  CascadeResult,
  RevisionProposal,
} from "@/types/reasoning";
import type { Nogood } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import {
  label,
  type Labelled,
  type LabellingResult,
  type NodeId,
} from "./labeller";
import { runGates, describeRun, type CandidatePair, type GateFinding, type GateRun } from "./gates";
import { backtrack, describeBacktrack, splitCulprits } from "./backtracking";
import {
  blocksConjunction,
  isDuplicate,
  nogoodForFinding,
  type NogoodDraft,
} from "./nogoods";
import { cascade, describeCascade, MAX_CASCADE_DEPTH } from "./cascade";
import { entrenchmentOf, describeEntrenchment, type GuardStatus } from "./entrenchment";
import { adjudicate, findContradictors, type Newcomer } from "./adjudication";
import {
  buildProposal,
  evidenceForFinding,
  renderProposal,
  WHY_NOT_AUTO_APPLIED,
} from "./proposals";
import type { WhyLogEngine } from "@/ai/types";
import { formatNogoodId } from "@/lib/ids";

/** One label flip, as the labeller reports it. `revise` turns these into events. */
export type LabelChange = LabellingResult["changed"][number];

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface ReviseInput {
  readonly state: GraphState;
  readonly engine: WhyLogEngine;
  readonly actor: Actor;
  readonly now: string;
  /** Step 1. Absent means "re-examine what is already in the log", which is what a
   *  boot-time run does: gates (a) and (c) can fire on a log nobody has touched. */
  readonly newcomer?: Newcomer;
  /** Phase 3. Absent means gate (b) reports itself unavailable. */
  readonly retrieve?: (state: GraphState) => Promise<readonly CandidatePair[]>;
  readonly skipSemantic?: boolean;
  /** Phase 4. Absent means implementation cost is UNKNOWN, never assumed. */
  readonly guards?: ReadonlyMap<DecisionId, GuardStatus>;
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

/** One finding, fully worked through steps 5-8. This is what the UI renders. */
export interface RevisionCase {
  readonly finding: GateFinding;
  readonly backtrack: BacktrackResult;
  readonly cascade: CascadeResult;
  readonly entrenchment: ReturnType<typeof entrenchmentOf>;
  readonly nogood: NogoodDraft | null;
  readonly nogoodId: NogoodId | null;
  readonly proposal: RevisionProposal;
  /** Steps 5 and 6 in words. The diagnosis, not a rendering of the data. */
  readonly narrative: string;
  /**
   * ┬º2.6 nogood REUSE: this revision would re-assert a conjunction the log has already
   * recorded as impossible. Null when it would not.
   *
   * Surfaced as a warning rather than a block, because the earlier nogood may itself
   * have been wrong ΓÇö but a user who is about to re-assert something the system proved
   * impossible on a known date deserves to be told the date before they click.
   */
  readonly reassertsNogood: Nogood | null;
}

export interface ReviseResult {
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly labelChanges: readonly LabelChange[];
  readonly gates: GateRun;
  readonly cases: readonly RevisionCase[];
  readonly adjudication: (AdjudicationOutcome & { readonly considered: readonly DecisionId[] }) | null;
  /** Step 9. Ordered, ready for `appendBatch`. EMPTY on an unchanged log. */
  readonly eventDrafts: readonly EventDraftAny[];
  readonly durationMs: number;
  readonly summary: string;
}

/** The draft shape `event-log.append` accepts: type, payload, actor, reason. */
export type EventDraftAny =
  | NewEvent<"LabelChanged">
  | NewEvent<"ContradictionDetected">
  | NewEvent<"PremiseInvalidated">
  | NewEvent<"NogoodRecorded">
  | NewEvent<"CascadePropagated">
  | NewEvent<"RevisionProposed">;

/**
 * The event id is not known until the log seals it.
 *
 * `event-log.append` mints ids from its own monotonic counter, so any id this module
 * wrote into a payload would be wrong. The materialiser rewrites these placeholders to
 * the creating event on fold ΓÇö the same mechanism `commit.ts` uses for justification
 * informants, and the reason a payload can reference its own event without a cycle.
 */
const PLACEHOLDER_EVENT_ID = "EV-000000-000000" as EventId;

/* -------------------------------------------------------------------------- */
/* The cycle                                                                  */
/* -------------------------------------------------------------------------- */

export async function revise(input: ReviseInput): Promise<ReviseResult> {
  const started = nowMs();
  const { state } = input;

  /* ---- 1 EXTRACT + 2 RESOLVE ----
   * Both happened upstream: `extraction/commit.ts` resolved candidates against the
   * identity ladder and appended events before this ran. What is left of step 2 here is
   * the only part that cannot be done at commit time ΓÇö finding which EXISTING decisions
   * a newcomer contradicts, which needs the graph as it stands after the assert. */
  const resolvedAgainst =
    input.newcomer === undefined ? [] : findContradictors(state, input.newcomer);

  /* ---- 3 ASSERT ---- */
  const labelling = label(state);
  const labels = labelling.labels;

  /* ---- 4 DETECT ---- */
  const gates = await runGates(state, labels, {
    engine: input.engine,
    ...(input.retrieve === undefined ? {} : { retrieve: input.retrieve }),
    ...(input.skipSemantic === undefined ? {} : { skipSemantic: input.skipSemantic }),
  });

  /* ---- 7 ADJUDICATE ----
   * Before 5 and 6, not after: a REFUSED newcomer produces no backtracking and no
   * cascade at all, because nothing is being retracted. Screening first is what keeps
   * a passing remark from triggering a retraction run. */
  const adjudication =
    input.newcomer === undefined
      ? null
      : adjudicate(state, {
          newcomer: input.newcomer,
          now: Date.parse(input.now),
          ...(input.guards === undefined ? {} : { guards: input.guards }),
        });

  const refused = adjudication?.kind === "reject-newcomer";

  /* ---- 5 BACKTRACK + 6 CASCADE + 8 PROPOSE ---- */
  const cases: RevisionCase[] = [];
  const drafts: EventDraftAny[] = [];
  let nogoodNumber = state.counters.nogoods;
  let proposalNumber = state.counters.proposals;

  /* Label flips are recorded first: every later event refers to a graph whose labels
   * have already moved. */
  for (const change of labelling.changed) {
    drafts.push(labelChangedDraft(input, change));
  }

  for (const finding of gates.findings) {
    if (alreadyRecorded(state, finding)) continue;

    drafts.push(detectionDraft(input, finding));

    if (finding.gate === "premise" && finding.premiseId !== null) {
      drafts.push(premiseInvalidatedDraft(input, finding.premiseId));
    }

    /* ---- 5 BACKTRACK ---- */
    const backtrackResult = backtrack(state, labels, finding.decisionId);

    /* ---- ┬º2.6 NOGOOD REUSE ----
     * Checked BEFORE the proposal is built, so the warning is part of the proposal
     * rather than a footnote added after the user has already read it. */
    const reasserts = blocksConjunction(state, backtrackResult.culpritPremises);

    /* ---- 3 (nogood) ---- */
    const nogoodDraft = nogoodForFinding(state, labels, finding);
    let nogoodId: NogoodId | null = null;

    if (nogoodDraft !== null && !isDuplicate(state, nogoodDraft)) {
      nogoodNumber += 1;
      nogoodId = nextNogoodIdInRun(nogoodNumber);
      drafts.push(nogoodDraftEvent(input, nogoodId, nogoodDraft));
    }

    /* ---- 6 CASCADE ----
     * From the CULPRITS, not from the finding: propagating from the decision would
     * retract the decision's own dependents on the strength of a conflict that
     * backtracking may have localised to a single premise. */
    const retracted = refused ? [] : backtrackResult.culpritPremises;
    const cascadeResult: CascadeResult =
      retracted.length === 0
        ? { steps: [], flipped: [], survivors: [], truncated: false, potentiallyAffectedBeyondCap: 0 }
        : cascade(state, labels, retracted);

    for (const step of cascadeResult.steps) {
      drafts.push(cascadeDraft(input, step));
    }

    /* ---- 5 (entrenchment) ---- */
    const guardStatus =
      input.guards === undefined ? undefined : input.guards.get(finding.decisionId);
    const entrenchment = entrenchmentOf(
      state,
      finding.decisionId,
      Date.parse(input.now),
      guardStatus,
    );

    /* ---- 8 PROPOSE ---- */
    proposalNumber += 1;
    const proposal = buildProposal({
      state,
      finding,
      cascade: cascadeResult,
      entrenchment,
      ...(nogoodId === null || nogoodDraft === null
        ? {}
        : {
            nogood: {
              id: nogoodId,
              premiseIds: nogoodDraft.premiseIds,
              explanation: nogoodDraft.explanation,
              derivedFrom: PLACEHOLDER_EVENT_ID,
            },
          }),
      ...(adjudication === null ? {} : { adjudication }),
      evidence: evidenceForFinding(state, finding),
      createdBy: PLACEHOLDER_EVENT_ID,
      proposalNumber,
    });

    cases.push({
      finding,
      backtrack: backtrackResult,
      cascade: cascadeResult,
      entrenchment,
      nogood: nogoodDraft,
      nogoodId,
      proposal,
      narrative: narrate(
        state,
        finding,
        backtrackResult,
        cascadeResult,
        entrenchment,
        refused,
        reasserts,
      ),
      reassertsNogood: reasserts,
    });

    drafts.push(proposalDraft(input, proposal, nogoodId, adjudication));
  }

  return {
    labels,
    labelChanges: labelling.changed,
    gates,
    cases,
    adjudication,
    eventDrafts: drafts,
    durationMs: Math.round(nowMs() - started),
    summary: summarise(input, gates, cases, adjudication, drafts, resolvedAgainst.length),
  };
}

/* A single run can mint several nogoods, so the number is threaded explicitly rather
 * than read from a counter this module does not own and must not mutate. */
function nextNogoodIdInRun(n: number): NogoodId {
  return formatNogoodId(n);
}

/* -------------------------------------------------------------------------- */
/* Idempotence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Has this finding already been recorded?
 *
 * Compared against the log rather than against the in-memory run, because the question
 * is "does the log already say this?" ΓÇö and a run that has not been committed yet must
 * not suppress a finding that a PREVIOUS committed run recorded.
 */
function alreadyRecorded(state: GraphState, finding: GateFinding): boolean {
  for (const detection of state.contradictions) {
    if (detection.gate !== finding.gate) continue;
    if (detection.decisionA !== finding.decisionId) continue;
    if ((detection.decisionB ?? null) !== finding.otherDecisionId) continue;
    if ((detection.premiseId ?? null) !== finding.premiseId) continue;
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Step 9 ΓÇö the drafts                                                        */
/* -------------------------------------------------------------------------- */

function labelChangedDraft(
  input: ReviseInput,
  change: LabelChange,
): NewEvent<"LabelChanged"> {
  const trigger =
    change.reason.kind === "all-justifications-invalid" ? change.reason.failedPremiseId : null;
  const invalidJustificationId =
    change.reason.kind === "valid-justification" ? change.reason.justificationId : null;

  return {
    type: "LabelChanged",
    payload: {
      nodeId: change.id,
      from: change.from,
      to: change.to,
      ...(invalidJustificationId === null ? {} : { invalidJustificationId }),
      ...(trigger === null || trigger === undefined ? {} : { triggerPremiseId: trigger }),
      gate: "cascade",
    },
    actor: input.actor,
    reason: `${change.id} moved from ${change.from} to ${change.to}: ${change.reason.kind.replace(/-/g, " ")}.`,
    at: input.now,
  };
}

function detectionDraft(input: ReviseInput, finding: GateFinding): EventDraftAny {
  if (finding.gate === "premise" && finding.premiseId !== null) {
    return {
      type: "ContradictionDetected",
      payload: {
        gate: "premise",
        verdict: finding.verdict,
        decisionA: finding.decisionId,
        premiseId: finding.premiseId,
        explanation: finding.explanation,
        engine: input.engine.id(),
      },
      actor: input.actor,
      reason: finding.explanation,
      at: input.now,
    };
  }

  return {
    type: "ContradictionDetected",
    payload: {
      gate: finding.gate === "semantic" ? "semantic" : "structural",
      verdict: finding.verdict,
      decisionA: finding.decisionId,
      ...(finding.otherDecisionId === null ? {} : { decisionB: finding.otherDecisionId }),
      explanation: finding.explanation,
      ...(finding.diagnostic === null ? {} : { diagnostic: finding.diagnostic }),
      engine: input.engine.id(),
    },
    actor: input.actor,
    reason: finding.explanation,
    at: input.now,
  };
}

function premiseInvalidatedDraft(input: ReviseInput, premiseId: PremiseId): NewEvent<"PremiseInvalidated"> {
  return {
    type: "PremiseInvalidated",
    payload: {
      premiseId,
      invalidatedBy: { kind: "assertion", eventId: PLACEHOLDER_EVENT_ID },
    },
    actor: input.actor,
    reason: `${premiseId} is no longer true. Every decision resting on it is re-examined; this event is the record that it was, and of what falsified it.`,
    at: input.now,
  };
}

function nogoodDraftEvent(
  input: ReviseInput,
  nogoodId: NogoodId,
  draft: NogoodDraft,
): NewEvent<"NogoodRecorded"> {
  return {
    type: "NogoodRecorded",
    payload: {
      nogoodId,
      premiseIds: draft.premiseIds,
      derivedFrom: PLACEHOLDER_EVENT_ID,
    },
    actor: input.actor,
    reason: draft.explanation,
    at: input.now,
  };
}

function cascadeDraft(
  input: ReviseInput,
  step: CascadeResult["steps"][number],
): NewEvent<"CascadePropagated"> {
  return {
    type: "CascadePropagated",
    payload: {
      from: step.from,
      to: step.to,
      depth: step.depth,
      stoppedAtIndependentSupport: step.stoppedAtIndependentSupport,
    },
    actor: input.actor,
    reason: step.stoppedAtIndependentSupport
      ? `Propagation stopped at ${step.to}: it has an independent justification that does not depend on any retracted premise. Recorded so the absence of a retraction here is visible as a decision, not an oversight.`
      : `${step.to} became ${step.became} at depth ${step.depth}. ${step.reason}`,
    at: input.now,
  };
}

function proposalDraft(
  input: ReviseInput,
  proposal: RevisionProposal,
  nogoodId: NogoodId | null,
  adjudication: ReviseResult["adjudication"],
): NewEvent<"RevisionProposed"> {
  return {
    type: "RevisionProposed",
    payload: {
      proposalId: proposal.id,
      unsoundDecisionId: proposal.unsoundDecisionId,
      failedPremiseId: proposal.failedPremiseId,
      ...(nogoodId === null ? {} : { nogoodId }),
      cascade: proposal.cascade.steps
        .filter((step) => !step.stoppedAtIndependentSupport)
        .map((step) => ({ decisionId: step.to, became: step.became })),
      survivors: proposal.cascade.survivors,
      entrenchment: proposal.entrenchment,
      ...(adjudication?.kind === "reject-newcomer"
        ? { rejectedNewcomer: { eventId: PLACEHOLDER_EVENT_ID, why: adjudication.why } }
        : {}),
      availableActions: proposal.availableActions,
    },
    actor: input.actor,
    reason: `${WHY_NOT_AUTO_APPLIED} Proposed for ${proposal.unsoundDecisionId} instead.`,
    at: input.now,
  };
}

/* -------------------------------------------------------------------------- */
/* The narrative                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Steps 5, 6 and the refusal, in prose.
 *
 * Not a rendering of the fields ΓÇö the UI renders those. This is the paragraph a user
 * reads first, and it has to answer "what is wrong and what is the least I have to
 * give up?" before it answers anything else.
 */
function narrate(
  state: GraphState,
  finding: GateFinding,
  backtrackResult: BacktrackResult,
  cascadeResult: CascadeResult,
  entrenchment: ReturnType<typeof entrenchmentOf>,
  refused: boolean,
  reasserts: Nogood | null,
): string {
  const parts: string[] = [finding.explanation];

  /* First, before the diagnosis: a user about to re-assert a proven-impossible
   * combination needs to see that before they read anything else. */
  if (reasserts !== null) {
    parts.push(
      `WARNING ΓÇö you are re-asserting a combination this log already found impossible on ${reasserts.recordedAt.slice(0, 10)} (${reasserts.id}). ` +
        reasserts.explanation,
    );
  }

  if (refused) {
    parts.push(
      "The incoming information was REFUSED by non-prioritized screening, so nothing was retracted and no cascade ran. It is in the Contested queue.",
    );
    return parts.join(" ");
  }

  parts.push(describeBacktrack(state, backtrackResult));

  const culprits = splitCulprits(state, backtrackResult.culpritPremises);
  if (culprits.intentBased.length > 0 && culprits.worldObservable.length === 0) {
    parts.push(
      "Every culprit here expresses intent rather than a state of the world, so no guard can check it. Only you can retract these.",
    );
  }

  parts.push(describeCascade(state, cascadeResult));
  parts.push(describeEntrenchment(state, finding.decisionId, entrenchment));

  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

function summarise(
  input: ReviseInput,
  gates: GateRun,
  cases: readonly RevisionCase[],
  adjudication: ReviseResult["adjudication"],
  drafts: readonly EventDraftAny[],
  contradictors: number,
): string {
  const lines: string[] = [`REVISE ΓÇö ${describeRun(gates)}`];

  if (input.newcomer !== undefined) {
    lines.push(
      `Newcomer: "${input.newcomer.text}" (${input.newcomer.variable} ΓåÆ ${input.newcomer.value}), contradicting ${contradictors} recorded decision(s).`,
    );
  }

  if (adjudication !== null && adjudication.kind === "reject-newcomer") {
    lines.push(`Screening: REFUSED. ${adjudication.why}`);
  } else if (adjudication !== null && adjudication.kind === "apply") {
    lines.push(`Screening: accepted, retracting weakest-first: ${adjudication.retract.join(", ")}.`);
  }

  lines.push(`${cases.length} case(s) worked through backtracking, cascade and entrenchment.`);

  if (drafts.length === 0) {
    lines.push("No events to append ΓÇö this log has already been revised against these findings.");
  } else {
    lines.push(`${drafts.length} event(s) to append, in referent order.`);
  }

  return lines.join("\n");
}

/** The full readable report: summary, then every case with its rendered proposal. */
export function renderResult(state: GraphState, result: ReviseResult): string {
  const blocks: string[] = [result.summary];

  for (const caseOf of result.cases) {
    blocks.push("", "---", "", caseOf.narrative, "", renderProposal(state, caseOf.proposal));
  }

  if (result.gates.semantic.available === false) {
    blocks.push("", "---", "", `Gate (b) did not run: ${result.gates.semantic.unavailableReason}`);
  }

  return blocks.join("\n");
}

/** How deep the deepest cascade went, for the health panel. */
export function deepestCascade(result: ReviseResult): number {
  return result.cases.reduce(
    (max, entry) =>
      Math.max(
        max,
        entry.cascade.steps.reduce((inner, step) => Math.max(inner, step.depth), 0),
      ),
    0,
  );
}

export { MAX_CASCADE_DEPTH, PLACEHOLDER_EVENT_ID as REVISION_PLACEHOLDER_EVENT_ID };

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
