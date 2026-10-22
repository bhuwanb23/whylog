/**
 * Guard review — 4.7.
 *
 * Phase 4 · sub-phase 4.7
 * Plan: plan/phase-4-executable-guards.md §4.7
 *
 * ---------------------------------------------------------------------------
 * NO GUARD RUNS UNTIL IT IS ACCEPTED
 *
 * §4.2's first rule, enforced here and in `eval/index.ts`. A synthesised guard that fails on day
 * one is worse than no guard, because it teaches the user to ignore the panel — and a panel that
 * gets ignored stops being verification. So every guard arrives `proposed`, and the review list
 * is where a human decides which checks are worth hearing about.
 *
 * ---------------------------------------------------------------------------
 * EDITING IS DELETE + RE-SYNTHESISE, BECAUSE THERE IS NO EDIT EVENT
 *
 * The closed vocabulary has `GuardSynthesised`, `GuardAccepted`, `GuardRan`, `GuardFailed`,
 * `GuardSuppressed` and `GuardDeleted` — and no `GuardEdited`. That is not an omission to work
 * around; it is invariant I1. Nothing is deleted and everything is an event, so an edited guard
 * must be two events: the old one deleted, a new one synthesised with `generatedBy: "user"`.
 *
 * The history survives, which matters more than the convenience: a guard whose spec was quietly
 * changed after it started failing is indistinguishable from a guard that was weakened to make a
 * failure go away, unless the log records both.
 *
 * ---------------------------------------------------------------------------
 * SUPPRESSION REQUIRES A REASON
 *
 * `GuardSuppressedPayload.suppressionReason` is a mandatory string, and this module refuses an
 * empty one rather than defaulting it. A suppressed guard with no reason is a guard nobody can
 * later judge — and suppressing a failing check is exactly the act most in need of a recorded
 * justification.
 *
 * ---------------------------------------------------------------------------
 * LABEL INHERITANCE IS MAINTAINED BY THE FOLD
 *
 * `materialize.ts` flips `disabledByDecisionLabel` on `LabelChanged`, so a decision that leaves
 * IN disables its guards and one that returns re-enables them. This module reads that state to
 * explain WHY a guard is disabled; it does not compute it, because two computations of one fact
 * eventually disagree.
 * ---------------------------------------------------------------------------
 */

import { formatGuardId } from "@/lib/ids";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, GuardId, ISODateString } from "@/types/common";
import type { Actor } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { Guard, GuardSeverity, GuardSpec, ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import { type DecisionGuards, GUARDS_PER_DECISION_CAP, kindRank } from "./types";

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

/** The guards on one decision, grouped by lifecycle, with the label inheritance resolved. */
export function guardsForDecision(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): DecisionGuards {
  const decision = state.decisions.get(decisionId);
  const guards: Guard[] = [];

  if (decision !== undefined) {
    for (const guardId of decision.guardIds) {
      const guard = state.guards.get(guardId);
      if (guard === undefined) continue;
      if (guard.lifecycle === "deleted") continue;
      guards.push(guard);
    }
  }

  guards.sort((a, b) => kindRank(a.spec.kind) - kindRank(b.spec.kind) || (a.id < b.id ? -1 : 1));

  const label = labels.get(decisionId)?.label ?? decision?.label ?? "UNKNOWN";

  return {
    decisionId,
    guards,
    accepted: guards.filter((guard) => guard.lifecycle === "accepted"),
    proposed: guards.filter((guard) => guard.lifecycle === "proposed"),
    suppressed: guards.filter((guard) => guard.lifecycle === "suppressed"),
    disabledByLabel: label !== "IN",
  };
}

/* -------------------------------------------------------------------------- */
/* The four review actions                                                    */
/* -------------------------------------------------------------------------- */

export interface ReviewContext {
  readonly actor: Actor;
  readonly at: ISODateString;
}

/** Accept a proposed guard. The moment it becomes able to run. */
export function acceptGuard(guard: Guard, context: ReviewContext): NewEvent<EventType> {
  return {
    type: "GuardAccepted",
    payload: { guardId: guard.id },
    actor: context.actor,
    reason: `A human accepted guard ${guard.id} (${guard.spec.kind}: ${describeTarget(guard)}) for ${guard.decisionId}. It was proposed by ${guard.generatedBy} and does not run before this point — an unaccepted check that fails is noise nobody agreed to hear.`,
    at: context.at,
  };
}

/**
 * Suppress an accepted or proposed guard. A reason is mandatory.
 *
 * Returns null rather than an event when the reason is empty: the caller shows the message
 * instead of writing a suppression nobody can later judge.
 */
export function suppressGuard(
  guard: Guard,
  reason: string,
  context: ReviewContext,
): NewEvent<EventType> | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;

  return {
    type: "GuardSuppressed",
    payload: { guardId: guard.id, suppressionReason: trimmed },
    actor: context.actor,
    reason: `A human suppressed guard ${guard.id} on ${guard.decisionId}: ${trimmed}. Suppression is recorded with its justification because silencing a failing check is the act most in need of one.`,
    at: context.at,
  };
}

/** Delete. The guard record is retained — I1 — with lifecycle `deleted`. */
export function deleteGuard(
  guard: Guard,
  reason: string,
  context: ReviewContext,
): NewEvent<EventType> {
  return {
    type: "GuardDeleted",
    payload: { guardId: guard.id },
    actor: context.actor,
    reason: `A human deleted guard ${guard.id} (${guard.spec.kind}: ${describeTarget(guard)}) from ${guard.decisionId}${reason.trim().length > 0 ? `: ${reason.trim()}` : ". No reason given."} The record is retained with lifecycle \`deleted\`; nothing is ever removed from the log.`,
    at: context.at,
  };
}

/**
 * Edit a guard, as two events.
 *
 * There is no `GuardEdited` in the closed vocabulary, and adding one would let a spec change
 * without a record of the spec it replaced. Delete + re-synthesise keeps both, and marks the
 * replacement `generatedBy: "user"` so the provenance says a human wrote it rather than a
 * template or a model.
 */
export function editGuard(
  guard: Guard,
  spec: GuardSpec,
  rationale: string,
  severity: GuardSeverity | undefined,
  context: ReviewContext,
  nextSuffix: string,
): readonly NewEvent<EventType>[] {
  const newId = formatGuardId(guard.decisionId, nextSuffix);

  return [
    {
      type: "GuardDeleted",
      payload: { guardId: guard.id },
      actor: context.actor,
      reason: `Guard ${guard.id} was edited, and editing is delete + re-synthesise: there is no edit event, so the previous spec stays in the log. A guard whose spec changed quietly after it started failing would be indistinguishable from one weakened to make the failure go away.`,
      at: context.at,
    },
    {
      type: "GuardSynthesised",
      payload: {
        guardId: newId,
        decisionId: guard.decisionId,
        kind: spec.kind,
        spec,
        severity: severity ?? DEFAULT_SEVERITY[spec.kind],
        rationale: rationale.trim().length > 0 ? rationale.trim() : guard.rationale,
        generatedBy: "user",
      },
      actor: context.actor,
      reason: `Replacement for ${guard.id}, written by a human: ${spec.kind} on ${describeSpecTarget(spec)}.`,
      at: context.at,
    },
    /* An edited guard still needs accepting. Carrying the old one's acceptance over would let an
     * edit activate a check nobody reviewed — which is the one thing §4.2's first rule forbids. */
  ];
}

/** Turn a `ProposedGuard` into a `GuardSynthesised` event. The only way a guard enters the log. */
export function synthesiseEvent(
  decisionId: DecisionId,
  proposed: ProposedGuard,
  suffix: string,
  context: ReviewContext,
  _engine: Guard["engine"],
): NewEvent<EventType> {
  return {
    type: "GuardSynthesised",
    payload: {
      guardId: formatGuardId(decisionId, suffix),
      decisionId,
      kind: proposed.spec.kind,
      spec: proposed.spec,
      severity: proposed.severity,
      rationale: proposed.rationale,
      generatedBy: proposed.generatedBy,
    },
    actor: context.actor,
    reason: `Compiled from ${decisionId} by the ${proposed.generatedBy} path: ${proposed.spec.kind} on ${describeSpecTarget(proposed.spec)}. It is PROPOSED and will not run until accepted.`,
    at: context.at,
  };
}

/** The next free letter suffix for a decision's guard ids: `G-0007a`, `G-0007b`, … */
export function nextSuffix(state: GraphState, decisionId: DecisionId): string {
  const used = new Set<string>();

  for (const guard of state.guards.values()) {
    if (guard.decisionId !== decisionId) continue;
    const suffix = guard.id.slice(`G-${decisionId.slice(4)}`.length);
    used.add(suffix);
  }

  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(letter)) return letter;
  }

  /* Past 26 guards on one decision — which the cap makes unreachable in practice, but an id
   * generator that returns a duplicate is worse than one that returns an ugly id. */
  return String(used.size + 1);
}

/* -------------------------------------------------------------------------- */
/* The cap                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Guards over the cap, ranked by determinism so the least trustworthy are the ones flagged.
 *
 * The cap is applied at synthesis, but a decision can acquire more guards later — a user adding
 * one by hand, or a second synthesis run. Reporting the overflow rather than silently dropping
 * it means the user chooses which check to keep.
 */
export function overCap(
  group: DecisionGuards,
  cap: number = GUARDS_PER_DECISION_CAP,
): readonly Guard[] {
  const active = group.guards.filter((guard) => guard.lifecycle !== "suppressed");
  if (active.length <= cap) return [];

  return [...active]
    .sort((a, b) => kindRank(b.spec.kind) - kindRank(a.spec.kind))
    .slice(0, active.length - cap);
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

export function describeTarget(guard: Guard): string {
  return describeSpecTarget(guard.spec);
}

export function describeSpecTarget(spec: GuardSpec): string {
  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return spec.package + (spec.includeDev === true ? " (including devDependencies)" : "");
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return `${JSON.stringify(spec.pattern)} in ${spec.glob}${spec.wordBoundary === false ? " (no word boundary)" : ""}`;
    case "command_exit_zero":
      return spec.command;
    case "llm_judge":
      return `rubric over ${spec.scopeGlobs.join(", ")}`;
  }
}

/** Why a guard is not running. Every case says what would make it run, because a disabled guard
 *  with no explanation reads as a broken one. */
export function whyDisabled(guard: Guard, group: DecisionGuards): string | null {
  if (guard.lifecycle === "proposed") {
    return "Proposed, not yet accepted. Accept it to activate — no guard runs before a human has read it.";
  }
  if (guard.lifecycle === "suppressed") {
    return `Suppressed${guard.suppressionReason === undefined || guard.suppressionReason.length === 0 ? "." : `: ${guard.suppressionReason}`}`;
  }
  if (guard.lifecycle === "deleted") {
    return "Deleted. The record is retained as history.";
  }
  if (group.disabledByLabel) {
    return "Its decision is not labelled IN, so this guard is disabled. Guards inherit their decision's label: a reversed or unsupported decision must stop nagging. It re-enables automatically if the decision returns to IN.";
  }
  if (guard.disabledByDecisionLabel) {
    return "Disabled by its decision's label. The fold maintains this whenever the label changes.";
  }
  return null;
}

export function describeReviewPolicy(): string {
  return [
    "Guard review — four actions, and the rules behind them:",
    "",
    "  accept    the moment a guard becomes able to run. Before this it is PROPOSED and the",
    "            interpreter refuses to evaluate it.",
    "  edit      delete + re-synthesise, as two events. There is no GuardEdited in the closed",
    "            vocabulary, and adding one would let a spec change without a record of the spec",
    "            it replaced. The replacement is marked generatedBy: user, and still needs",
    "            accepting — an edit does not inherit the old guard's acceptance.",
    "  suppress  requires a reason, and an empty one is refused rather than defaulted. Silencing a",
    "            failing check is the act most in need of a recorded justification.",
    "  delete    the record is retained with lifecycle `deleted`. Nothing is ever removed (I1).",
    "",
    "Label inheritance: a decision that is not IN has its guards auto-disabled, maintained by the",
    "fold on LabelChanged. Re-enabling requires the decision to return to IN — not a click here.",
    "",
    `Cap: ${GUARDS_PER_DECISION_CAP} guards per decision, ranked by determinism, so what gets dropped is always`,
    "the least trustworthy kind. Passing guards collapse into a count in the panel, because a",
    "list of green checks is noise that hides the one red line.",
  ].join("\n");
}

export type { GuardId };
