/**
 * Decision projection: read-side views over the decision nodes.
 *
 * Phase 0 · sub-phase 0.2
 *
 * These are QUERIES, not stores. Every one is a pure function of GraphState and
 * is recomputed on demand; the state already holds the nodes, and the derived
 * indexes (`byVariable`, `byFingerprint`) are rebuilt by the fold. What lives
 * here is the layer above: filtering, ordering and shaping for the views.
 *
 * The ordering rule is enforced here rather than left to each caller: lists are
 * ordered by VALID time, never by learned time. See src/substrate/bi-temporal.ts.
 */

import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import type { Decision, DecisionLabel, DecisionStatus, DecisionVariable } from "@/types/domain";
import { byIdAsc, byValidDesc, compare, formatInterval, isOpen } from "../bi-temporal";
import type { GraphState } from "../graph-state";

export type DecisionSort = "valid-desc" | "valid-asc" | "id" | "entrenchment";

const BY_VALID_TIME = compare<Decision>(byValidDesc, byIdAsc);

export function getDecision(state: GraphState, id: DecisionId): Decision | null {
  return state.decisions.get(id) ?? null;
}

export function allDecisions(
  state: GraphState,
  sort: DecisionSort = "valid-desc",
): readonly Decision[] {
  const out = [...state.decisions.values()];
  switch (sort) {
    case "valid-desc":
      return out.sort(BY_VALID_TIME);
    case "valid-asc":
      return out.sort((a, b) => -BY_VALID_TIME(a, b));
    case "id":
      return out.sort(byIdAsc);
    case "entrenchment":
      return out.sort((a, b) => b.entrenchment - a.entrenchment || BY_VALID_TIME(a, b));
    default:
      return out;
  }
}

/** Still current: not closed out, and not labelled OUT. This is the set an
 *  export contains and the set the timeline shows by default. */
export function liveDecisions(state: GraphState): readonly Decision[] {
  return allDecisions(state).filter(
    (d) => isOpen(d.temporal) && d.status !== "superseded" && d.status !== "archived",
  );
}

export function decisionsByLabel(state: GraphState, label: DecisionLabel): readonly Decision[] {
  return allDecisions(state).filter((d) => d.label === label);
}

export function decisionsByStatus(state: GraphState, status: DecisionStatus): readonly Decision[] {
  return allDecisions(state).filter((d) => d.status === status);
}

export function decisionsByVariable(
  state: GraphState,
  variable: DecisionVariable,
): readonly Decision[] {
  const ids = state.byVariable.get(variable) ?? [];
  const out: Decision[] = [];
  for (const id of ids) {
    const decision = state.decisions.get(id);
    if (decision) out.push(decision);
  }
  return out.sort(BY_VALID_TIME);
}

/** The review queue, oldest-valid first. Ordered so the person reviewing works
 *  through history rather than jumping around — a decision approved out of order
 *  can contradict one not yet seen. */
export function pendingReview(state: GraphState): readonly Decision[] {
  const out: Decision[] = [];
  for (const id of state.pendingReview) {
    const decision = state.decisions.get(id);
    if (decision) out.push(decision);
  }
  return out.sort((a, b) => -BY_VALID_TIME(a, b));
}

/** Decisions resting on a given premise. This is the cascade's first hop and it
 *  is O(1) because the fold materialised the reverse index. */
export function decisionsOnPremise(state: GraphState, premiseId: string): readonly Decision[] {
  const ids = state.premiseToDecisions.get(premiseId as PremiseId) ?? [];
  const out: Decision[] = [];
  for (const id of ids as readonly DecisionId[]) {
    const decision = state.decisions.get(id);
    if (decision) out.push(decision);
  }
  return out.sort(BY_VALID_TIME);
}

/** Decisions whose premises are all still standing. Soundness, from the read
 *  side — the reasoning layer owns the label, this only reports it. */
export function soundDecisions(state: GraphState): readonly Decision[] {
  return liveDecisions(state).filter((d) => d.label === "IN");
}

/** IN-labelled decisions with NO justification. A data-quality warning: an LLM
 *  extractor produces these, and labelling them is more honest than silently
 *  counting them as sound. */
export function unfoundedDecisions(state: GraphState): readonly Decision[] {
  return allDecisions(state).filter((d) => d.label === "UNFOUNDED");
}

/** Decisions in the contested queue — screened out by non-prioritized revision
 *  and waiting for a human. Never silently dropped, never silently applied. */
export function contestedDecisions(state: GraphState): readonly Decision[] {
  return decisionsByStatus(state, "contested");
}

/** Superseded chains, newest member first. The export compiler uses this to drop
 *  the old rule rather than shipping both. */
export function supersessionChain(state: GraphState, id: DecisionId): readonly Decision[] {
  const chain: Decision[] = [];
  const seen = new Set<DecisionId>();
  let cursor: DecisionId | undefined = id;

  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const decision = state.decisions.get(cursor);
    if (!decision) break;
    chain.push(decision);
    cursor = decision.edges.supersededBy[0];
  }

  return chain;
}

/** What was true at a given VALID time. The time machine's decision view. */
export function decisionsAsOf(state: GraphState, at: ISODateString): readonly Decision[] {
  return allDecisions(state).filter((d) => {
    if (d.temporal.valid > at) return false;
    if (d.temporal.invalidFrom !== undefined && d.temporal.invalidFrom <= at) return false;
    return true;
  });
}

/** Decisions governed by a file path, via `applies_to` globs. Drives the
 *  pre-emption notice (Phase 3.5) and guard scoping (Phase 4.3). */
export function decisionsForPath(
  state: GraphState,
  path: string,
  matchesGlob: (path: string, glob: string) => boolean,
): readonly Decision[] {
  return liveDecisions(state).filter((d) => d.appliesTo.some((glob) => matchesGlob(path, glob)));
}

/** A one-line summary for lists and exports. */
export function describeDecision(decision: Decision): string {
  const interval = formatInterval(decision.temporal);
  return `${decision.id} [${decision.label}] ${decision.statement} (${interval})`;
}

/** The Y-statement if the extractor recovered one, else a composed fallback.
 *  The full form is what makes an export self-justifying; the fallback is what
 *  keeps the export honest when it was not recovered. */
export function yStatementOrFallback(decision: Decision): string {
  if (decision.yStatement !== undefined && decision.yStatement.trim().length > 0) {
    return decision.yStatement;
  }
  const downside =
    decision.acceptedDownside !== undefined ? `, accepting ${decision.acceptedDownside}` : "";
  const rationale = decision.rationale !== undefined ? ` because ${decision.rationale}` : "";
  return `${decision.statement}${rationale}${downside}.`;
}
