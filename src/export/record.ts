/**
 * The agent-optimized record — 5.3.
 *
 * Phase 5 · sub-phase 5.3
 * Plan: plan/phase-5-export-compiler.md §5.3
 * Docs: docs/01-prior-art-landscape.md §4.5
 *
 * ---------------------------------------------------------------------------
 * SIX PROPERTIES, AND WHERE EACH COMES FROM
 *
 *   scoped to file globs      Phase 1 extraction + guard globs
 *   imperative, not prose     compiled from variable, value and rejected alternatives
 *   verifiable                Phase 4 guards → `verify-command.ts`   ← nobody else can do this
 *   token-aware               `priority.ts` + `budget.ts`
 *   non-conflicting           Phase 2, enforced by `consistency-gate.ts`  ← nor this
 *   addressable               WLD-0007, never renumbered, never reused
 *
 * Two of the six are satisfied automatically and they are the two that require a reasoning layer.
 * Everything else here is Markdown generation — which is true and not the point.
 *
 * ---------------------------------------------------------------------------
 * THE `Because:` LINE CARRIES PREMISE IDS, NOT PROSE
 *
 * That is the single most important formatting decision in the file. An agent that reads
 * "Because: single user (P-0002)" can see WHAT WOULD HAVE TO CHANGE for this rule to stop
 * applying, and can tell you which record to supersede when it does. An agent that reads
 * "Because: we're a small team" can only repeat the sentence.
 *
 * The premise text is included alongside the id so the line is readable without a lookup, but the
 * id comes first and is never dropped — a record whose justification is only prose has thrown
 * away the part that makes it checkable.
 *
 * ---------------------------------------------------------------------------
 * THE CLOSING LINE IS THE ANTI-RE-LITIGATION INSTRUCTION
 *
 * "Do not re-litigate without superseding this record." That sentence is what makes the whole
 * exercise pay off: it tells the agent that disagreeing is allowed but has a FORM, and the form
 * is a recorded supersession rather than a quiet deviation in a pull request.
 * ---------------------------------------------------------------------------
 */

import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import type { Decision, DecisionLabel } from "@/types/domain";
import type { ExportRecord, RejectedBlockEntry } from "@/types/export";
import { verifyCommandFor } from "./verify-command";

export interface RecordInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly decision: Decision;
  readonly label: DecisionLabel;
  readonly tier: "inline" | "index";
  readonly priority: number;
  readonly now: number;
}

/**
 * Build one export record.
 *
 * Pure: it reads the graph and returns a record. It does not decide inclusion, ordering or
 * budget — `cif.ts` does that — so the same decision renders identically whichever emitter
 * asks for it.
 */
export function recordFor(input: RecordInput): ExportRecord {
  const { state, decision, label } = input;

  const premises = premisesOf(state, decision.id);
  const rejected = rejectedOf(state, decision.id);

  let passing = 0;
  let total = 0;
  let lastVerifiedAt: ISODateString | undefined;

  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    if (guard.lifecycle !== "accepted") continue;
    if (guard.disabledByDecisionLabel) continue;

    total += 1;
    if (guard.lastRun === undefined) continue;
    if (guard.lastRun.outcome === "pass") passing += 1;

    if (lastVerifiedAt === undefined || guard.lastRun.ranAt > lastVerifiedAt) {
      lastVerifiedAt = guard.lastRun.ranAt;
    }
  }

  const guards = acceptedGuardsOf(state, decision.id);
  const verify = verifyCommandFor(decision.id, guards);

  return {
    id: decision.id,
    imperative: imperativeFor(decision, rejected),
    appliesTo: decision.appliesTo,
    becausePremiseIds: premises.map((entry) => entry.id),
    becauseText:
      premises.length === 0
        ? ""
        : premises.map((entry) => `${entry.text} (${entry.id})`).join(", "),
    rejected: rejected.map((entry) =>
      entry.why === undefined ? { value: entry.value } : { value: entry.value, why: entry.why },
    ),
    ...(verify === null ? {} : { verifyCommand: verify.command }),
    status: label,
    guardsPassing: passing,
    guardsTotal: total,
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
    contestedPremise: premises.some((entry) => entry.contested),
    failingGuard: guards.some(
      (guard) => guard.lastRun !== undefined && guard.lastRun.outcome === "fail",
    ),
    tier: input.tier,
    priority: input.priority,
  };
}

/* -------------------------------------------------------------------------- */
/* The imperative form                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "MUST use SQLite (better-sqlite3). MUST NOT introduce Postgres."
 *
 * Normative keywords an agent can follow beat a paragraph it has to summarise first. The
 * decision's own `statement` is used when it is already imperative, because a human-written or
 * transcript-derived statement usually reads better than a generated one — and overriding it
 * would discard the only phrasing anyone actually said out loud.
 */
export function imperativeFor(
  decision: Decision,
  rejected: readonly { value: string; why?: string }[],
): string {
  const parts: string[] = [];

  const statement = decision.statement.trim();
  if (isAlreadyImperative(statement)) {
    parts.push(`${statement.replace(/\.\s*$/, "")}.`);
  } else {
    parts.push(`MUST use ${decision.value}.`);
  }

  /* The MUST NOT clause is compiled from the rejected alternatives, which is why alternatives are
   * indexed first-class: without them there is nothing to forbid, and an agent is free to
   * propose the thing you already turned down. */
  if (rejected.length > 0) {
    const names = rejected.map((entry) => entry.value).slice(0, MUST_NOT_LIMIT);
    parts.push(
      `MUST NOT introduce ${names.join(", ")}${rejected.length > MUST_NOT_LIMIT ? ` (and ${rejected.length - MUST_NOT_LIMIT} other rejected options — see the Rejected section)` : ""}.`,
    );
  }

  return parts.join(" ");
}

/** Cap on how many rejections appear in the headline. More than three and the sentence stops
 *  being an instruction and starts being a list — the full list is one section below. */
export const MUST_NOT_LIMIT = 3;

function isAlreadyImperative(statement: string): boolean {
  return /^(MUST|DO NOT|USE|AVOID|ALWAYS|NEVER|PREFER|KEEP)\b/i.test(statement);
}

/* -------------------------------------------------------------------------- */
/* Premises and alternatives                                                  */
/* -------------------------------------------------------------------------- */

interface PremiseEntry {
  readonly id: PremiseId;
  readonly text: string;
  readonly label: DecisionLabel;
  /** True when the premise is contested — surfaced in the export so the agent knows this
   *  particular justification is under review. */
  readonly contested: boolean;
}

export function premisesOf(state: GraphState, decisionId: DecisionId): readonly PremiseEntry[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: PremiseEntry[] = [];
  const seen = new Set<PremiseId>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      out.push({
        id: premiseId,
        text: premise.text,
        label: premise.label,
        /* "Contested" means neither confirmed nor refuted — the decision rests on something the
         * log has not settled. `GraphState` has no `contestedPremises` set; UNKNOWN is the label
         * that carries it, and `rejected-block.ts` reads it the same way so the two cannot
         * disagree about which rejections are under review. */
        contested: premise.label === "UNKNOWN",
      });
    }
  }

  return out;
}

export function rejectedOf(
  state: GraphState,
  decisionId: DecisionId,
): readonly { value: string; why?: string }[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: { value: string; why?: string }[] = [];

  for (const alternativeId of decision.alternativeIds) {
    const alternative = state.alternatives.get(alternativeId);
    if (alternative === undefined) continue;
    out.push(
      alternative.whyRejected === undefined
        ? { value: alternative.value }
        : { value: alternative.value, why: alternative.whyRejected },
    );
  }

  return out;
}

function acceptedGuardsOf(state: GraphState, decisionId: DecisionId) {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out = [];
  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    out.push(guard);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The status line                                                            */
/* -------------------------------------------------------------------------- */

/**
 * "Status: IN · sound · guards 2/2 passing · last verified 2026-10-21"
 *
 * Carries the annotations the consistency gate asked for — contested premise, failing guard —
 * INLINE rather than in a footnote. An agent reading the record has to see them at the point of
 * use; a warning three sections away is a warning that does not exist.
 */
export function renderStatus(record: ExportRecord): string {
  const parts: string[] = [`Status: ${record.status}`];

  if (record.status === "IN") parts.push("sound");
  else if (record.status === "UNKNOWN") parts.push("justification incomplete");
  else if (record.status === "UNFOUNDED") parts.push("justification never reaches a premise");

  if (record.guardsTotal === 0) {
    parts.push("no guards — UNVERIFIABLE");
  } else {
    parts.push(`guards ${record.guardsPassing}/${record.guardsTotal} passing`);
  }

  if (record.lastVerifiedAt !== undefined)
    parts.push(`last verified ${record.lastVerifiedAt.slice(0, 10)}`);

  if (record.contestedPremise) parts.push("PREMISE CONTESTED");
  if (record.failingGuard) parts.push("VERIFY CURRENTLY FAILS");

  return parts.join(" · ");
}

/** The closing instruction. Present on every inline record. */
export const ANTI_RELITIGATION = "Do not re-litigate without superseding this record.";

export type { RejectedBlockEntry };
