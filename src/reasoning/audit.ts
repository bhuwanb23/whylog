/**
 * Audit — 2.10.
 *
 * Phase 2 · sub-phase 2.10
 * Plan: plan/phase-2-truth-maintenance.md §2.10
 * Docs: docs/02-truth-maintenance-theory.md §5
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION
 *
 * "Why do you believe this?" is the question every other tool in this space cannot
 * answer, because they store decisions and not the structure that holds them up.
 *
 * The answer has to be a CHAIN, not a list. "It rests on three premises" is a list.
 * "It rests on P-0002, which is an assumption nobody ever justified, and on P-0004,
 * which was itself derived from WLD-0003, which rests on P-0001" is a chain — and the
 * chain is where the weak link shows up.
 *
 * ---------------------------------------------------------------------------
 * WHICH CLOCK
 *
 * LEARNED time, always. This is the one place in the whole system that orders by when
 * the system FOUND OUT rather than when the thing HAPPENED.
 *
 * An audit answers "how did this belief come to be held?" A transcript written in
 * March and imported in October produced a belief in October, and every step of the
 * reasoning that followed happened after that import. Ordering an audit by valid time
 * would claim the system reasoned about something before it knew about it, which is not
 * a small inaccuracy — it makes the audit untrustworthy in exactly the way an audit
 * cannot afford to be.
 *
 * `bi-temporal.ts` in the substrate is the source of both clocks; this module uses the
 * learned one and says so in the heading.
 *
 * ---------------------------------------------------------------------------
 * THE WEAK LINK
 *
 * Every chain is scored, and the weakest point is named. Weakness is not low
 * confidence — it is one of four specific structural defects, in order of how much they
 * should worry you:
 *
 *   1. UNSUPPORTED ASSUMPTION — a premise in an IN-list that has no evidence at all.
 *   2. CIRCULAR SUPPORT — a chain that returns to a node it already visited.
 *   3. SOLE SUPPORT — a decision held up by exactly one premise.
 *   4. STALE — nothing has corroborated it since it was learned.
 *
 * Naming the weak link is the point of the audit. A chain that looks solid and is not
 * is worse than no chain, because it converts a guess into a confidence.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, EventId, ISODateString, PremiseId } from "@/types/common";
import type { Decision, Justification, Premise } from "@/types/domain";
import { premisesOf } from "./entrenchment";
import type { Labelled, NodeId } from "./labeller";

/** Deeper than this the chain stops being readable and starts being a graph dump. */
export const MAX_AUDIT_DEPTH = 8;

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

export type WeaknessKind = "unsupported-assumption" | "circular-support" | "sole-support" | "stale";

export interface AuditStep {
  readonly depth: number;
  readonly nodeId: DecisionId | PremiseId;
  readonly kind: "decision" | "premise" | "justification";
  readonly text: string;
  readonly label: string;
  /** LEARNED time — when the system found out, not when it happened. */
  readonly learnedAt: ISODateString | null;
  /** The event that put this node in the log. The audit trail's actual anchor. */
  readonly learnedFrom: EventId | null;
  readonly children: readonly AuditStep[];
}

export interface WeakLink {
  readonly nodeId: DecisionId | PremiseId;
  readonly kind: WeaknessKind;
  readonly severity: number;
  readonly explanation: string;
}

export interface AuditTrail {
  readonly root: DecisionId;
  readonly steps: readonly AuditStep[];
  readonly premiseCount: number;
  readonly assumptionCount: number;
  readonly derivedCount: number;
  readonly depthReached: number;
  readonly truncated: boolean;
  readonly weakLinks: readonly WeakLink[];
  readonly weakest: WeakLink | null;
  readonly nogoods: number;
  /** Verbatim: which clock this trail is ordered by. Never left implicit. */
  readonly clock: "learned";
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The full answer to "why do you believe this?".
 *
 * Pure and total: every decision has a trail, including one with no premises at all —
 * which is itself the most alarming possible finding and must be reported as such
 * rather than producing an empty result.
 */
export function auditDecision(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decisionId: DecisionId,
): AuditTrail {
  const visited = new Set<NodeId>();
  const weakLinks: WeakLink[] = [];
  let deepest = 0;
  let truncated = false;
  let premiseCount = 0;
  let assumptionCount = 0;
  let derivedCount = 0;

  const build = (nodeId: DecisionId | PremiseId, depth: number): AuditStep | null => {
    if (depth > MAX_AUDIT_DEPTH) {
      truncated = true;
      return null;
    }
    if (depth > deepest) deepest = depth;

    if (visited.has(nodeId)) {
      weakLinks.push({
        nodeId,
        kind: "circular-support",
        severity: 0.95,
        explanation:
          "This node appears twice in its own support chain. A circular justification cannot be well-founded: it is believed because it is believed. The labeller refuses to label cycles IN, so if this chain is holding a decision up, something is wrong above it.",
      });
      return {
        depth,
        nodeId,
        kind: "premise",
        text: "(already in this chain — circular)",
        label: labels.get(nodeId)?.label ?? "UNLABELLED",
        learnedAt: null,
        learnedFrom: null,
        children: [],
      };
    }
    visited.add(nodeId);

    const decision: Decision | undefined = state.decisions.get(nodeId as DecisionId);
    if (decision !== undefined) return decisionStep(state, labels, decision, depth, build);

    const premise: Premise | undefined = state.premises.get(nodeId as PremiseId);
    if (premise !== undefined) {
      premiseCount += 1;
      const isDerived = premise.justifications.length > 0;
      if (isDerived) derivedCount += 1;
      else assumptionCount += 1;
      return premiseStep(state, labels, premise, isDerived, depth, build, weakLinks);
    }

    return null;
  };

  const rootDecision: Decision | undefined = state.decisions.get(decisionId);
  const steps: AuditStep[] = [];

  if (rootDecision === undefined) {
    return {
      root: decisionId,
      steps: [],
      premiseCount: 0,
      assumptionCount: 0,
      derivedCount: 0,
      depthReached: 0,
      truncated: false,
      weakLinks: [
        {
          nodeId: decisionId,
          kind: "unsupported-assumption",
          severity: 1,
          explanation: "No such decision in the log. Nothing to audit.",
        },
      ],
      weakest: null,
      nogoods: 0,
      clock: "learned",
    };
  }

  const rootStep = build(decisionId, 0);
  if (rootStep !== null) steps.push(rootStep);

  /* A decision with no premises at all is the extreme case of sole support. */
  if (premiseCount === 0) {
    weakLinks.push({
      nodeId: decisionId,
      kind: "unsupported-assumption",
      severity: 1,
      explanation:
        "This decision rests on NO premise. It was recorded as a conclusion with nothing under it, so nothing can invalidate it and nothing can explain it. If it was stated without conditions that is honest; if conditions existed and were not extracted, the log is missing them.",
    });
  }

  const sorted = [...weakLinks].sort((a, b) => b.severity - a.severity);

  return {
    root: decisionId,
    steps,
    premiseCount,
    assumptionCount,
    derivedCount,
    depthReached: deepest,
    truncated,
    weakLinks: sorted,
    weakest: sorted[0] ?? null,
    nogoods: nogoodsForDecision(state, decisionId).length,
    clock: "learned",
  };
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

function decisionStep(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  decision: Decision,
  depth: number,
  build: (nodeId: DecisionId | PremiseId, depth: number) => AuditStep | null,
): AuditStep {
  const justifications = justificationsFor(state, decision.id);
  const children: AuditStep[] = [];

  /* A justification is a step of its own kind; its premises hang below it. `build` is
   * passed down so premises recurse through the same visited-set and depth cap. */
  for (const justification of justifications) {
    children.push(justificationStep(state, justification, depth + 1, build));
  }

  /* `Decision` carries no creating-event id. The justification informant does, and
   * materialize rewrites it to the event that created the decision — so the earliest
   * one is the honest answer to "which event taught the system this?". */
  const learnedFrom =
    justifications
      .map((justification) => informantEventId(justification))
      .filter((eventId): eventId is EventId => eventId !== null)
      .sort()[0] ?? null;

  return {
    depth,
    nodeId: decision.id,
    kind: "decision",
    text: `${decision.statement} — ${decision.value}`,
    label: labels.get(decision.id)?.label ?? decision.label,
    learnedAt: decision.temporal.learned,
    learnedFrom,
    children,
  };
}

/** The event behind a justification's informant, or null for a human assertion — which
 *  has no event, and saying so is more honest than pointing at an unrelated one. */
function informantEventId(justification: Justification): EventId | null {
  const informant = justification.informant;
  return "eventId" in informant ? informant.eventId : null;
}

function justificationStep(
  state: GraphState,
  justification: Justification,
  depth: number,
  build: (nodeId: DecisionId | PremiseId, depth: number) => AuditStep | null,
): AuditStep {
  const children: AuditStep[] = [];

  for (const premiseId of justification.inList) {
    const step = build(premiseId, depth + 1);
    if (step !== null) children.push(step);
  }

  /* OUT-list premises are part of the answer: "we believed this GIVEN that X was NOT
   * true" is half the justification, and omitting it makes a non-monotonic belief look
   * monotonic. */
  for (const premiseId of justification.outList) {
    const step = build(premiseId, depth + 1);
    if (step !== null) {
      children.push({ ...step, text: `EXCLUDED: ${step.text}` });
    }
  }

  return {
    depth,
    nodeId: justification.consequent,
    kind: "justification",
    text: `${justification.id} — ${justification.inList.length} in, ${justification.outList.length} out`,
    label: justification.informant.kind,
    learnedAt: justification.createdAt,
    learnedFrom: informantEventId(justification),
    children,
  };
}

function premiseStep(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  premise: Premise,
  isDerived: boolean,
  depth: number,
  build: (nodeId: DecisionId | PremiseId, depth: number) => AuditStep | null,
  weakLinks: WeakLink[],
): AuditStep {
  const supporting = premise.evidence.filter((entry) => entry.supports);

  if (!isDerived && supporting.length === 0) {
    weakLinks.push({
      nodeId: premise.id,
      kind: "unsupported-assumption",
      severity: 0.9,
      explanation: `"${premise.text}" is an assumption with no evidence behind it — nothing observed it, no guard checked it, nobody asserted it directly. It entered the log because a decision needed it. That is normal for a premise, but it means this is the link that will break first.`,
    });
  }

  if (isDerived === false && supporting.length === 1) {
    weakLinks.push({
      nodeId: premise.id,
      kind: "stale",
      severity: 0.35,
      explanation: `"${premise.text}" has exactly one supporting observation, from ${premise.temporal.learned}. Nothing has corroborated it since.`,
    });
  }

  const children: AuditStep[] = [];
  if (isDerived) {
    for (const justificationId of premise.justifications) {
      const justification = state.justifications.get(justificationId);
      if (justification === undefined) continue;
      children.push(justificationStep(state, justification, depth + 1, build));
    }
  }

  return {
    depth,
    nodeId: premise.id,
    kind: "premise",
    text: `${premise.text}${isDerived ? " (derived)" : " (assumption)"}`,
    label: labels.get(premise.id)?.label ?? premise.label,
    learnedAt: premise.temporal.learned,
    learnedFrom: supporting[0]?.eventId ?? null,
    children,
  };
}

/* -------------------------------------------------------------------------- */
/* Sole support                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Decisions held up by exactly one premise.
 *
 * Reported separately from the per-decision trail because it is a property of the LOG
 * rather than of a chain: a log where most decisions have sole support is a log where
 * any single retraction cascades widely, and that is worth knowing before it happens.
 */
export function soleSupportDecisions(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): readonly { decisionId: DecisionId; premiseId: PremiseId }[] {
  const out: { decisionId: DecisionId; premiseId: PremiseId }[] = [];

  for (const decisionId of state.decisions.keys()) {
    if (labels.get(decisionId)?.label !== "IN") continue;
    const premiseIds = premisesOf(state, decisionId);
    if (premiseIds.length !== 1) continue;
    const only = premiseIds[0];
    if (only === undefined) continue;
    out.push({ decisionId, premiseId: only });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every node touched by a trail, ordered by LEARNED time.
 *
 * This is the audit's spine and the reason the clock is named in the trail. Reading it
 * top to bottom is reading how the belief was assembled in the order the system
 * assembled it — which is not the order the conversation happened in, and pretending
 * otherwise would be the one lie an audit must not tell.
 */
export function chronologicalOrder(trail: AuditTrail): readonly AuditStep[] {
  const flat = flatten(trail.steps);
  return [...flat].sort((a, b) => {
    if (a.learnedAt === null && b.learnedAt === null) return 0;
    if (a.learnedAt === null) return 1;
    if (b.learnedAt === null) return -1;
    return a.learnedAt < b.learnedAt ? -1 : a.learnedAt > b.learnedAt ? 1 : 0;
  });
}

function flatten(steps: readonly AuditStep[]): readonly AuditStep[] {
  const out: AuditStep[] = [];
  const walk = (list: readonly AuditStep[]): void => {
    for (const step of list) {
      out.push(step);
      walk(step.children);
    }
  };
  walk(steps);
  return out;
}

function justificationsFor(state: GraphState, decisionId: DecisionId): readonly Justification[] {
  const out: Justification[] = [];
  for (const justification of state.justifications.values()) {
    if (justification.consequent === decisionId) out.push(justification);
  }
  return out;
}

function nogoodsForDecision(state: GraphState, decisionId: DecisionId) {
  const premiseIds = new Set<PremiseId>(premisesOf(state, decisionId));
  const out = [];
  for (const nogood of state.nogoods.values()) {
    if (nogood.premiseIds.some((premiseId) => premiseIds.has(premiseId))) out.push(nogood);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The indented tree.
 *
 * Labels are shown because they are the answer: a chain of IN nodes is a chain the
 * system currently believes, and a chain containing an OUT node is a chain with a hole
 * in it that the reader must be able to see without being told.
 */
export function renderTrail(trail: AuditTrail): string {
  if (trail.steps.length === 0) {
    return `${trail.root}: no support recorded. This decision rests on nothing.`;
  }

  const lines: string[] = [
    `Why ${trail.root} is believed — ordered by LEARNED time (when the system found out, not when it happened)`,
    "",
  ];

  const walk = (steps: readonly AuditStep[]): void => {
    for (const step of steps) {
      const indent = "  ".repeat(step.depth);
      const marker = step.kind === "justification" ? "├─" : step.depth === 0 ? "" : "└─";
      const when = step.learnedAt === null ? "" : `  [learned ${step.learnedAt}]`;
      lines.push(`${indent}${marker} ${step.text} — ${step.label}${when}`.trimEnd());
      walk(step.children);
    }
  };

  walk(trail.steps);

  lines.push(
    "",
    `${trail.premiseCount} premise(s): ${trail.assumptionCount} assumption(s), ${trail.derivedCount} derived.`,
  );

  if (trail.truncated) {
    lines.push(`Chain truncated at depth ${MAX_AUDIT_DEPTH}; there is more below this.`);
  }

  if (trail.nogoods > 0) {
    lines.push(`${trail.nogoods} recorded impossibility(ies) involve these premises.`);
  }

  return lines.join("\n");
}

/** The weak link, as the sentence the user should read first. */
export function renderWeakest(trail: AuditTrail): string {
  if (trail.weakest === null) {
    return "No structural weakness found: every premise has evidence, no chain is circular, and support is not single-threaded.";
  }

  const label = weaknessLabel(trail.weakest.kind);
  return `Weakest link — ${label}: ${trail.weakest.explanation}`;
}

export function weaknessLabel(kind: WeaknessKind): string {
  switch (kind) {
    case "unsupported-assumption":
      return "unsupported assumption";
    case "circular-support":
      return "circular support";
    case "sole-support":
      return "single point of support";
    case "stale":
      return "never corroborated";
  }
}

/** One line per decision, for the audit view's list. */
export function renderSummary(state: GraphState, trail: AuditTrail): string {
  const decision: Decision | undefined = state.decisions.get(trail.root);
  const name = decision === undefined ? trail.root : `${trail.root} "${decision.value}"`;
  const weak = trail.weakest === null ? "no weak link" : weaknessLabel(trail.weakest.kind);
  return `${name} — ${trail.premiseCount} premises (${trail.assumptionCount} assumed, ${trail.derivedCount} derived), ${weak}`;
}
