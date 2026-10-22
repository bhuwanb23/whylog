/**
 * Guards as evidence — 4.5. ★
 *
 * Phase 4 · sub-phase 4.5
 * Plan: plan/phase-4-executable-guards.md §4.5
 * Docs: docs/04-executable-decision-guards.md §6
 *
 * ---------------------------------------------------------------------------
 * THIS IS WHAT MAKES GUARDS PART OF THE REASONING CORE
 *
 * A linter reports. This feeds back:
 *
 *   PASS  → corroboration +1 for the decision, and `implementation_cost` becomes a
 *           MEASUREMENT rather than a guess, which raises entrenchment E(d).
 *   FAIL  → a `GuardFailed` event, then the SAME `assertNewInformation` entry point a
 *           transcript uses — so the reasoning code never learns that a guard arrived.
 *
 * ---------------------------------------------------------------------------
 * THE ENTRY POINT IS SHARED, AND THAT IS NOT A CONVENIENCE
 *
 * `reasoning/assert.ts` was written in Phase 2 with four assertion kinds and one rule: the
 * `switch` on `source` lives THERE AND NOWHERE ELSE, and everything downstream sees a
 * `GraphState` and nothing else. There is no `if (source === "guard")` in the labeller, the
 * gates, backtracking, cascade, entrenchment, adjudication or proposals.
 *
 * That is why a guard failure and a transcript remark are EQUIVALENT in the eyes of the
 * reasoner, and why `implementation_cost` can feed entrenchment without a special case. A
 * system that handled guards separately would have two reasoning paths, and only one of them
 * would be exercised.
 *
 * So this file produces an `Assertion` of kind `guard-result`. It does not call `revise`, does
 * not touch labels, and does not know which gate will fire. It supplies evidence; Phase 2
 * disposes of it.
 *
 * ---------------------------------------------------------------------------
 * WHICH GATE FIRES IS DECIDED HERE, AND CONSERVATIVELY
 *
 *   does this falsify a premise the decision rests on?
 *     YES → gate (c): premise invalidation → cascade
 *     NO  → gate (a): structural drift — the code disagrees with the decision directly
 *
 * The test is vocabulary overlap between what the guard checked and the text of each premise
 * the decision rests on. It is answered only when EXACTLY ONE premise matches. Zero matches
 * means the failure is about the decision, not its assumptions, so gate (a) takes it. Several
 * matches mean the run cannot tell which assumption broke — and guessing would produce
 * precisely the "confident, spectacular, entirely wrong cascade" §2.5 warns about, so the
 * ambiguity is reported and gate (a) handles it as drift instead.
 *
 * ---------------------------------------------------------------------------
 * DRIFT IS DETECTED WITH NO SEMANTIC MODEL AT ALL
 *
 * Gate (a) plus a failing guard is a fully deterministic contradiction detector: the ontology
 * says these two values are mutually exclusive, and a dependency check says both are in the
 * tree. No embedding, no threshold, no model. That is the strongest available answer to "is
 * this an LLM wrapper?" — and it is why the six deterministic guard kinds matter more than the
 * two flexible ones.
 * ---------------------------------------------------------------------------
 */

import type { Assertion, PremiseAssertion } from "@/reasoning/assert";
import type { GuardStatus } from "@/reasoning/entrenchment";
import type { GraphState } from "@/substrate/graph-state";
import type { Actor } from "@/types/common";
import type { DecisionId, GuardId, ISODateString, PremiseId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { Guard, GuardRunResult } from "@/types/guards";
import { isDeterministic } from "@/types/guards";

/* -------------------------------------------------------------------------- */
/* implementation_cost — a measurement, not a guess                           */
/* -------------------------------------------------------------------------- */

/**
 * The `GuardStatus` entrenchment reads.
 *
 * Returns `undefined` when the decision has no accepted guard, which is what makes
 * `implementation_cost` fall back to 0.5 and be reported as UNKNOWN. Absent is not zero: a
 * decision nobody has checked is not a decision that costs nothing to retract, and scoring it
 * as cheap would make every unverified decision the easiest one to overturn.
 *
 * Only ACCEPTED guards count, and only ones that actually ran. A proposed guard measures
 * nothing, and a skipped one measured nothing either — counting a skip as a pass would raise
 * entrenchment on the strength of data nobody pasted.
 */
export function guardStatusFor(state: GraphState, decisionId: DecisionId): GuardStatus | undefined {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return undefined;

  let total = 0;
  let passing = 0;

  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    if (guard.lifecycle !== "accepted") continue;
    if (guard.disabledByDecisionLabel) continue;
    if (guard.lastRun === undefined) continue;
    if (guard.lastRun.outcome === "skip") continue;

    total += 1;
    if (guard.lastRun.outcome === "pass") passing += 1;
  }

  if (total === 0) return undefined;

  return { passingFraction: passing / total, total, passing };
}

/** The map `ReviseInput.guards` expects, for every live decision. */
export function guardStatusMap(state: GraphState): ReadonlyMap<DecisionId, GuardStatus> {
  const out = new Map<DecisionId, GuardStatus>();

  for (const decision of state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") continue;

    const status = guardStatusFor(state, decision.id);
    if (status === undefined) continue;
    out.set(decision.id, status);
  }

  return out;
}

/**
 * How many decisions in the log now have a MEASURED implementation cost.
 *
 * This is the sentence Phase 4 exists to make possible: before guards, every decision's cost was
 * 0.5 UNKNOWN; after, the ones with passing guards have a number with evidence behind it.
 */
export function measuredCostCoverage(state: GraphState): { measured: number; unknown: number } {
  let measured = 0;
  let unknown = 0;

  for (const decision of state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") continue;
    if (guardStatusFor(state, decision.id) === undefined) unknown += 1;
    else measured += 1;
  }

  return { measured, unknown };
}

/* -------------------------------------------------------------------------- */
/* Which premise, if any, the failure falsifies                                */
/* -------------------------------------------------------------------------- */

export interface PremiseAttribution {
  /** Set only when EXACTLY ONE premise matched. */
  readonly premiseId: PremiseId | null;
  readonly candidates: readonly PremiseId[];
  /** "single" → gate (c). "none" or "ambiguous" → gate (a) handles it as structural drift. */
  readonly verdict: "single" | "none" | "ambiguous";
  readonly explanation: string;
}

/** Minimum shared content tokens between what the guard checked and a premise's text. Two, for
 *  the same reason retrieval uses two: a single shared token ("app", "server", "deploy") would
 *  attribute a failure to half the log's premises. */
export const MIN_ATTRIBUTION_TOKENS = 2;

/**
 * Does this failure falsify a premise the decision rests on?
 *
 * Compares the guard's TARGET — the package, glob or pattern it checked, plus the evidence it
 * produced — against the text of each IN-list premise. Vocabulary overlap is a weak instrument
 * and is treated as one: the answer is only acted on when exactly one premise matches.
 */
export function attributeFailure(
  state: GraphState,
  guard: Guard,
  result: GuardRunResult,
): PremiseAttribution {
  const decision = state.decisions.get(guard.decisionId);
  if (decision === undefined) {
    return {
      premiseId: null,
      candidates: [],
      verdict: "none",
      explanation:
        "The decision this guard protects is not in the log, so there are no premises to attribute the failure to.",
    };
  }

  const targetTokens = tokensOf(`${specTarget(guard)} ${result.evidence}`);
  const candidates: PremiseId[] = [];
  const scores: { id: PremiseId; shared: number }[] = [];

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (candidates.includes(premiseId)) continue;
      candidates.push(premiseId);

      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;

      const premiseTokens = tokensOf(`${premise.text} ${premise.predicate}`);
      let shared = 0;
      for (const token of premiseTokens) {
        if (targetTokens.has(token)) shared += 1;
      }

      if (shared >= MIN_ATTRIBUTION_TOKENS) scores.push({ id: premiseId, shared });
    }
  }

  if (scores.length === 0) {
    return {
      premiseId: null,
      candidates,
      verdict: "none",
      explanation: `Nothing the guard checked (${specTarget(guard)}) shares vocabulary with any of the ${candidates.length} premise(s) this decision rests on. The failure is about the DECISION, not its assumptions, so gate (a) treats it as structural drift: the code disagrees with what the log says was chosen.`,
    };
  }

  scores.sort((a, b) => b.shared - a.shared || (a.id < b.id ? -1 : 1));

  const best = scores[0];
  const second = scores[1];

  if (second !== undefined && best !== undefined && second.shared === best.shared) {
    return {
      premiseId: null,
      candidates,
      verdict: "ambiguous",
      explanation: `The failure matches ${scores.length} premises equally well (${scores.map((entry) => entry.id).join(", ")}), so the run cannot say which assumption broke. Guessing would produce a confident, spectacular and entirely wrong cascade, so the ambiguity is reported and gate (a) handles it as drift instead. Resolve it by asserting the premise directly.`,
    };
  }

  if (best === undefined) {
    return { premiseId: null, candidates, verdict: "none", explanation: "No premise matched." };
  }

  const premise = state.premises.get(best.id);

  return {
    premiseId: best.id,
    candidates,
    verdict: "single",
    explanation: `The failure falsifies ${best.id} "${premise?.text ?? ""}" — ${best.shared} shared token(s) with what the guard checked, and no other premise matched as well. Gate (c) takes it: the premise goes OUT and every decision resting on it is re-examined.`,
  };
}

/** What the guard actually looked at, as text. */
export function specTarget(guard: Guard): string {
  const spec = guard.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return spec.package;
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return `${spec.pattern} ${spec.glob}`;
    case "command_exit_zero":
      return spec.command;
    case "llm_judge":
      return `${spec.rubric} ${spec.scopeGlobs.join(" ")}`;
  }
}

function tokensOf(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

/* -------------------------------------------------------------------------- */
/* Turning a run into evidence                                                */
/* -------------------------------------------------------------------------- */

export interface FeedbackInput {
  readonly state: GraphState;
  readonly guard: Guard;
  readonly result: GuardRunResult;
  readonly actor: Actor;
  readonly at: ISODateString;
}

export interface GuardFeedback {
  /** Verification events: `GuardRan` always, `GuardFailed` instead when it failed. */
  readonly drafts: readonly NewEvent<EventType>[];
  /** The reasoning assertion. Null when there is nothing to assert — a skip, or a pass, which
   *  corroborates through the guard record rather than through a premise. */
  readonly assertion: Assertion | null;
  readonly attribution: PremiseAttribution | null;
  readonly summary: string;
}

/**
 * One guard result → verification events + a reasoning assertion.
 *
 * Two kinds of output, deliberately separate:
 *
 *   `drafts`     what the LOG needs to remember: that the guard ran, what it found, and when it
 *                first started failing. These are verification facts.
 *   `assertion`  what the REASONER needs: an observation about the world, in the same shape a
 *                transcript produces. The store feeds this to `assertNewInformation`.
 *
 * Keeping them apart is what lets the guard record be complete even when the reasoning produces
 * nothing — a passing guard is worth recording and asserts no premise.
 */
export function feedbackFor(input: FeedbackInput): GuardFeedback {
  const { guard, result } = input;

  /* ---- a skip is not evidence ---- */
  if (result.outcome === "skip") {
    return {
      drafts: [ranEvent(input)],
      assertion: null,
      attribution: null,
      summary: `${guard.id} skipped: ${result.skipReason ?? "no reason given"} Nothing is asserted, because a guard that could not run says nothing about the world.`,
    };
  }

  /* ---- a pass corroborates, through the guard record ---- */
  if (result.outcome === "pass") {
    return {
      drafts: [ranEvent(input)],
      assertion: null,
      attribution: null,
      summary: `${guard.id} passed for ${guard.decisionId}. Corroboration and \`implementation_cost\` are recomputed from the guard record — no premise is asserted, because a check confirming what the log already says is not new information.`,
    };
  }

  /* ---- a failure is evidence, and it enters the same door as a transcript ---- */
  const attribution = attributeFailure(input.state, guard, result);
  const premise =
    attribution.premiseId === null ? null : input.state.premises.get(attribution.premiseId);

  const observation: PremiseAssertion = {
    /* A failure attributed to a premise refutes THAT premise, using its own type and predicate
     * so the resolver finds the existing node rather than minting a duplicate — the Phase 2
     * audit's first and worst gap. An unattributed failure asserts a premise about the decision
     * itself, which gate (a) then reads as drift. */
    type: premise?.type ?? "requirement",
    predicate: premise?.predicate ?? driftPredicate(guard),
    text: observationText(guard, result, attribution.verdict),
    /* False: the guard's finding REFUTES what the log believed. */
    supports: false,
    /* A deterministic guard is direct observation of the project, so it is the most confident
     * evidence source in the system — more confident than a human remark, which can be
     * misremembered, and incomparably more than a model's reading. A judged guard is not: it is
     * a model's opinion, and it gets the confidence of one. */
    confidence: asConfidence(
      isDeterministic(guard.spec.kind) ? GUARD_CONFIDENCE : JUDGED_CONFIDENCE,
    ),
  };

  const assertion: Assertion = {
    source: "guard-result",
    decisionId: guard.decisionId,
    passed: false,
    observation,
  };

  /* `actor` and `reason` are mandatory on every `NewEvent`, and `GuardFailed` is one of the 19
   * state-changing types whose reason the event log rejects when empty. The reason names the
   * guard, the decision and the finding, because this is the field whose whole job is to say
   * where the information came from — and a guard failure arriving with a generic reason is
   * indistinguishable, in the audit trail, from one that was asserted by hand. */
  const drafts: NewEvent<EventType>[] = [
    {
      type: "GuardFailed",
      payload: {
        guardId: guard.id,
        result: "fail",
        evidence: result.evidence,
        ranAt: result.ranAt,
        firstFailedAt: guard.firstFailedAt ?? result.ranAt,
        ...(attribution.premiseId === null ? {} : { falsifiesPremiseId: attribution.premiseId }),
      },
      actor: input.actor,
      reason: `Guard ${guard.id} (${guard.spec.kind}) failed while protecting ${guard.decisionId}: ${result.evidence}${
        attribution.premiseId === null
          ? " No premise matched, so this is recorded as drift against the decision itself."
          : ` Attributed to premise ${attribution.premiseId}.`
      }`,
      at: input.at,
      occurredAt: result.ranAt,
    },
  ];

  return {
    drafts,
    assertion,
    attribution,
    summary: `${guard.id} FAILED for ${guard.decisionId}. Evidence: ${result.evidence} ${attribution.explanation}`,
  };
}

/** The predicate for an unattributed failure. Namespaced under `drift` so the resolver cannot
 *  confuse it with an extracted premise, and so a drift observation is recognisable in the log
 *  as something a check produced rather than something a person said. */
function driftPredicate(guard: Guard): string {
  return `drift.${guard.spec.kind}.${slug(specTarget(guard))}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** What the guard observed, as a sentence. This becomes premise text, so it has to read as an
 *  observation about the world and not as a log message. */
function observationText(
  guard: Guard,
  result: GuardRunResult,
  verdict: PremiseAttribution["verdict"],
): string {
  const target = specTarget(guard);

  const observed =
    guard.spec.kind === "dependency_absent" ||
    guard.spec.kind === "path_glob_absent" ||
    guard.spec.kind === "string_absent_in_files"
      ? `the project now contains ${target}`
      : `the project no longer contains ${target}`;

  return `${observed} — observed by guard ${guard.id} (${guard.spec.kind}), which ${guard.decisionId} is protected by. Evidence: ${result.evidence}${
    verdict === "none"
      ? " This is drift against the decision itself, not against any premise it rests on."
      : verdict === "ambiguous"
        ? " Which premise this falsifies could not be determined, so it is reported as drift."
        : ""
  }`;
}

function ranEvent(input: FeedbackInput): NewEvent<EventType> {
  return {
    type: "GuardRan",
    payload: {
      guardId: input.guard.id,
      result: input.result.outcome,
      evidence: input.result.evidence,
      ranAt: input.result.ranAt,
    },
    actor: input.actor,
    /* `GuardRan` is not state-changing, so the log would accept an empty reason — but a run
     * recorded without saying what it found is a run nobody can audit later, and the field
     * costs nothing to fill. */
    reason: `Guard ${input.guard.id} ran against the pasted project and ${
      input.result.outcome === "pass"
        ? `passed: ${input.result.evidence}`
        : input.result.outcome === "skip"
          ? `SKIPPED: ${input.result.skipReason ?? "no reason given"}`
          : `failed: ${input.result.evidence}`
    }`,
    at: input.at,
    occurredAt: input.result.ranAt,
  };
}

/** A deterministic guard is direct observation; a judged one is an opinion. */
export const GUARD_CONFIDENCE = 0.9;
export const JUDGED_CONFIDENCE = 0.4;

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeFeedbackLoop(): string {
  return [
    "Guards are evidence, not lint. A run feeds back two ways:",
    "",
    "  PASS   corroboration +1, and `implementation_cost` becomes a MEASUREMENT — the fraction",
    "         of the decision's accepted guards that ran and passed. That raises entrenchment",
    "         E(d), so a decision with six passing guards is correctly expensive to retract.",
    "         A decision with NO accepted guard stays at 0.5 and is reported as UNKNOWN, never",
    "         as 'medium': a missing measurement must not masquerade as a measurement.",
    "",
    "  FAIL   a GuardFailed event, then the SAME assertNewInformation entry point a transcript",
    "         uses. The reasoning code never learns a guard arrived — there is no",
    '         `if (source === "guard")` downstream, and there cannot be, because the switch on',
    "         source lives in reasoning/assert.ts and nowhere else.",
    "",
    "           does it falsify a premise the decision rests on?",
    "             YES (exactly one match) → gate (c) → premise OUT → cascade",
    "             NO or AMBIGUOUS         → gate (a) → structural drift → reversal proposal",
    "",
    "Ambiguity is reported, never guessed: a wrong premise attribution produces a confident,",
    "spectacular and entirely wrong cascade.",
    "",
    "Consequence worth stating plainly: gate (a) plus a failing guard is a fully deterministic",
    `contradiction detector. No embedding, no threshold, no model. Confidence ${GUARD_CONFIDENCE} for a deterministic guard (direct observation) against ${JUDGED_CONFIDENCE} for a judged one (an opinion).`,
  ].join("\n");
}

export type { GuardId, NewEvent };
