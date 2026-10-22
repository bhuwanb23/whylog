/**
 * Revision proposals — 2.9.
 *
 * Phase 2 · sub-phase 2.9
 * Plan: plan/phase-2-truth-maintenance.md §2.9
 * Docs: docs/02-truth-maintenance-theory.md §4
 *
 * ---------------------------------------------------------------------------
 * SEVEN PARTS, EVERY TIME
 *
 * A proposal that says "WLD-0001 may be invalid" is a notification. A proposal that
 * says what failed, what the evidence was, what cannot both hold, what else falls with
 * it, how costly it is to change, what you can do about it, and why the system did not
 * just do it — is a diagnosis.
 *
 *   1. WHAT FAILED          the decision and the premise that broke under it
 *   2. THE EVIDENCE         the verbatim quote, its span, its source, its confidence
 *   3. THE NOGOOD           the conjunction that cannot hold
 *   4. THE CASCADE          what else became unsound, and what survived and why
 *   5. ENTRENCHMENT         the arithmetic, with the EE3 cap named
 *   6. ACTIONS              reverse / rejustify / contest — always at least one
 *   7. WHY NOT AUTO-APPLIED the standing explanation of invariant I4
 *
 * Part 7 is not boilerplate padding. It is the answer to the question every user asks
 * the first time: "why didn't you just fix it?" Veritas auto-retracts, because its
 * inputs are programmatic assertions with declared reliability. Ours are extracted
 * prose, and extracted prose must not be allowed to silently rewrite a considered
 * decision. Saying so every time is cheaper than being wrong once.
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I4 — THE SYSTEM PROPOSES, THE HUMAN DISPOSES
 *
 * Nothing in this module produces an event. It produces a `RevisionProposal`, which is
 * a value. Applying one is a separate act with its own event type and its own reason
 * string, performed by the review layer. There is no code path from a gate firing to a
 * log mutation.
 * ---------------------------------------------------------------------------
 */

import { formatProposalId } from "@/lib/ids";
import type { GraphState } from "@/substrate/graph-state";
import type { Confidence, DecisionId, EventId, PremiseId, SourceSpan } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { Premise } from "@/types/domain";
import type {
  AdjudicationOutcome,
  CascadeResult,
  EntrenchmentBreakdown,
  NogoodRecord,
  RevisionAction,
  RevisionProposal,
} from "@/types/reasoning";
import { entrenchmentBand } from "@/types/reasoning";
import type { GateFinding } from "./gates";

/* -------------------------------------------------------------------------- */
/* Part 7, written once                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The standing explanation.
 *
 * Deliberately a constant rather than generated per proposal: it must not vary with
 * confidence, gate, or anything else, because a justification for not acting
 * automatically that changes with the situation is not a principle.
 */
export const WHY_NOT_AUTO_APPLIED = [
  "Not applied automatically.",
  "This conclusion came from extracted prose, not from a measurement you made.",
  "Extraction is wrong often enough that acting on it silently would corrupt the log —",
  "and a log you cannot trust is worth less than no log.",
  "The proposal is recorded either way, so nothing is lost by waiting for you.",
].join(" ");

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProposalInput {
  readonly state: GraphState;
  readonly finding: GateFinding;
  readonly cascade: CascadeResult;
  readonly entrenchment: EntrenchmentBreakdown;
  readonly nogood?: NogoodRecord;
  readonly adjudication?: AdjudicationOutcome;
  /** The evidence for the failure. When it came from a guard run or a human, the
   *  span is absent and `source` says where it came from instead. */
  readonly evidence: ProposalEvidence;
  /** The event that records this proposal. Minted by the caller — this module never
   *  creates events. */
  readonly createdBy: EventId;
  readonly proposalNumber: number;
}

export interface ProposalEvidence {
  readonly quote: string;
  readonly span?: SourceSpan;
  readonly source: "transcript" | "guard" | "human" | "repo-scan";
  readonly confidence: Confidence;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build one proposal.
 *
 * Total: every finding produces a proposal, including findings whose decision has
 * since been retracted and findings with no evidence quote. A finding that produces no
 * proposal is a finding that vanishes, and the user is left wondering why the gate
 * count and the proposal count disagree.
 */
export function buildProposal(input: ProposalInput): RevisionProposal {
  const { state, finding } = input;

  const failedPremise: Premise | undefined =
    finding.premiseId === null ? undefined : state.premises.get(finding.premiseId);

  const failedPremiseId = failedPremise?.id ?? firstInListPremise(state, finding.decisionId);
  const failedPremiseText =
    failedPremise?.text ??
    (failedPremiseId === null
      ? "No single premise failed — the conflict is between two decisions."
      : (state.premises.get(failedPremiseId)?.text ?? failedPremiseId));

  return {
    id: formatProposalId(input.proposalNumber),
    createdAt: input.createdBy,

    /* 1 */
    unsoundDecisionId: finding.decisionId,
    failedPremiseId: failedPremiseId ?? (finding.decisionId as unknown as PremiseId),
    failedPremiseText,

    /* 2 */
    evidence: {
      quote: input.evidence.quote,
      ...(input.evidence.span === undefined ? {} : { span: input.evidence.span }),
      source: input.evidence.source,
      confidence: input.evidence.confidence,
    },

    /* 3 */
    ...(input.nogood === undefined ? {} : { nogood: input.nogood }),

    /* 4 */
    cascade: input.cascade,

    /* 5 */
    entrenchment: input.entrenchment,
    entrenchmentBand: entrenchmentBand(input.entrenchment.capped),

    /* 6 */
    availableActions: actionsFor(finding, input.adjudication),

    /* 7 */
    whyNotAutoApplied: WHY_NOT_AUTO_APPLIED,

    status: "open",
  };
}

/**
 * Which actions are actually available.
 *
 * Always at least one — a proposal with no action is a dead end and reads as a bug.
 * `dismiss` is not listed because it is always available in the UI; listing it here
 * would imply the other three are sometimes not.
 */
export function actionsFor(
  finding: GateFinding,
  adjudication?: AdjudicationOutcome,
): readonly RevisionAction[] {
  const actions: RevisionAction[] = [];

  /* REVERSE — there is something to reverse: another decision, or this one. */
  if (finding.otherDecisionId !== null || finding.gate === "premise") actions.push("reverse");

  /* REJUSTIFY — the premise is intent-based (a requirement, a team shape) or the
   * failure is a refinement rather than a reversal. The decision may still be right;
   * its stated reason is what is stale. */
  if (finding.gate === "semantic" || finding.verdict === "refinement") actions.push("rejustify");
  if (finding.gate === "premise" && !actions.includes("rejustify")) actions.push("rejustify");

  /* CONTEST — the adjudicator refused a newcomer, or a semantic finding is weak enough
   * that two readings are defensible. */
  if (adjudication?.kind === "reject-newcomer") actions.push("contest");
  if (finding.gate === "semantic" && finding.diagnostic !== null) actions.push("contest");

  if (actions.length === 0) actions.push("rejustify");

  return actions;
}

function firstInListPremise(state: GraphState, decisionId: DecisionId): PremiseId | null {
  for (const justification of state.justifications.values()) {
    if (justification.consequent !== decisionId) continue;
    const first = justification.inList[0];
    if (first !== undefined) return first;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Evidence for a finding                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The quote that supports a proposal, taken from the log rather than composed.
 *
 * For a premise finding the evidence is the premise's own recorded evidence — a span
 * from a transcript, a guard result, or a human assertion. For a decision-pair finding
 * there is no single quote, so the evidence is the two decisions' snippets, and the
 * `source` is `transcript` because that is where both came from.
 *
 * The quote is VERBATIM in every case. A proposal whose evidence has been paraphrased
 * cannot be checked, and an unchecked proposal is an assertion, not a diagnosis.
 */
export function evidenceForFinding(state: GraphState, finding: GateFinding): ProposalEvidence {
  if (finding.premiseId !== null) {
    const premise = state.premises.get(finding.premiseId);
    const best = premise?.evidence.find((entry) => entry.supports && entry.span !== undefined);

    if (best?.span !== undefined) {
      return {
        quote: best.span.text,
        span: best.span,
        source: best.kind,
        confidence: asConfidence(premise?.confidence ?? 0.5),
      };
    }

    return {
      quote: premise?.text ?? finding.explanation,
      source: "transcript",
      confidence: asConfidence(premise?.confidence ?? 0.4),
    };
  }

  const a = state.decisions.get(finding.decisionId);
  const b =
    finding.otherDecisionId === null ? undefined : state.decisions.get(finding.otherDecisionId);

  const quote =
    b === undefined
      ? (a?.provenance.snippet.text ?? finding.explanation)
      : [a?.provenance.snippet.text ?? "", b.provenance.snippet.text ?? ""]
          .filter((part) => part.length > 0)
          .join("\n—\n");

  return {
    quote,
    ...(a?.provenance.snippet === undefined ? {} : { span: a.provenance.snippet }),
    source: "transcript",
    confidence: asConfidence(finding.deterministic ? 0.9 : 0.6),
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The proposal as the user reads it: all seven parts, in order, with headings.
 *
 * This is also the shape that goes into `DECISIONS.md` under a "Contested" section and
 * into the agent export as a warning block — one renderer, three destinations, so the
 * explanation cannot drift between them.
 */
export function renderProposal(state: GraphState, proposal: RevisionProposal): string {
  const decision = state.decisions.get(proposal.unsoundDecisionId);
  const heading =
    decision === undefined
      ? proposal.unsoundDecisionId
      : `${proposal.unsoundDecisionId} — ${decision.statement}`;

  const lines: string[] = [`## ${heading}`, ""];

  lines.push("### 1. What failed", proposal.failedPremiseText, "");

  lines.push(
    "### 2. The evidence",
    `> ${proposal.evidence.quote.replace(/\n/g, "\n> ")}`,
    `Source: ${proposal.evidence.source} · confidence ${proposal.evidence.confidence.toFixed(2)}`,
    proposal.evidence.span === undefined
      ? ""
      : `Span: ${proposal.evidence.span.transcriptId} @ ${proposal.evidence.span.start}–${proposal.evidence.span.end}`,
    "",
  );

  if (proposal.nogood !== undefined) {
    lines.push("### 3. What cannot both hold", proposal.nogood.explanation, "");
  } else {
    lines.push("### 3. What cannot both hold", "No conjunction recorded for this finding.", "");
  }

  lines.push("### 4. What else it affects", describeCascadeOf(proposal.cascade), "");

  lines.push(
    "### 5. How costly is it to change",
    `Entrenchment ${proposal.entrenchment.capped.toFixed(2)} — ${proposal.entrenchmentBand}`,
    proposal.entrenchment.ee3CapApplied
      ? `Capped by its weakest premise (${proposal.entrenchment.weakestPremiseId ?? "unnamed"}).`
      : "Not capped by any premise.",
    proposal.entrenchment.implementationCostUnknown
      ? "Implementation cost UNKNOWN — no guard exists yet, so nothing was measured."
      : `Implementation cost ${proposal.entrenchment.components.implementationCost.toFixed(2)} — measured from guards.`,
    "",
  );

  lines.push(
    "### 6. What you can do",
    ...proposal.availableActions.map((action) => `- ${describeAction(action)}`),
    "- dismiss — record that you considered it and disagreed",
    "",
  );

  lines.push("### 7. Why this was not applied for you", proposal.whyNotAutoApplied, "");

  return lines.filter((line) => line !== undefined).join("\n");
}

function describeCascadeOf(cascade: CascadeResult): string {
  if (cascade.steps.length === 0) return "Nothing else depended on it.";

  const parts: string[] = [];
  if (cascade.flipped.length > 0) {
    parts.push(`Became unsound: ${cascade.flipped.join(", ")}.`);
  }
  if (cascade.survivors.length > 0) {
    parts.push(`Kept independent support: ${cascade.survivors.join(", ")}.`);
  }
  if (cascade.truncated) {
    parts.push(`Stopped at the depth cap with ${cascade.potentiallyAffectedBeyondCap} unexamined.`);
  }
  return parts.join(" ");
}

/** What each action DOES, in the words the button uses. */
export function describeAction(action: RevisionAction): string {
  switch (action) {
    case "reverse":
      return "reverse — retract this decision and record the replacement";
    case "rejustify":
      return "rejustify — keep the decision, replace the reason it rests on";
    case "contest":
      return "contest — hold both, unresolved, and stop treating either as settled";
  }
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                     */
/* -------------------------------------------------------------------------- */

/** Open proposals, oldest first. The review queue for Phase 2. */
export function openProposals(state: GraphState): readonly RevisionProposal[] {
  const out: RevisionProposal[] = [];
  for (const proposal of state.proposals.values()) {
    if (proposal.status === "open") out.push(proposal);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Proposals whose band is HIGH — the ones that will be hardest to accept, listed
 *  first because they are the ones most likely to be dismissed unread. */
export function highEntrenchmentProposals(state: GraphState): readonly RevisionProposal[] {
  return openProposals(state).filter((proposal) => proposal.entrenchmentBand === "HIGH");
}

/** The next proposal number, from the counter. Never a module-level variable. */
export function nextProposalNumber(state: GraphState): number {
  return state.counters.proposals + 1;
}

export function countOpen(state: GraphState): number {
  return openProposals(state).length;
}
