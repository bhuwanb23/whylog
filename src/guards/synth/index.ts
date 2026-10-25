/**
 * The synthesis pipeline — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 * Plan: plan/phase-4-executable-guards.md §4.2
 * Docs: docs/04-executable-decision-guards.md §4
 *
 * ---------------------------------------------------------------------------
 * COMPILE A DECISION INTO A GUARD SET
 *
 * Phase 1 produced a decision in a structured enough form to generate from — variable, value,
 * rejected alternatives, `applies_to` globs, premises. In every workflow the fitness-function
 * literature surveys, a human writes the check by hand, because nobody has the decision in that
 * form. This is the part that is nearly free once you do.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THAT KEEP IT HONEST
 *
 * **1. Guards are PROPOSED, never auto-installed.** Every guard leaves this pipeline with
 * `lifecycle: "proposed"`, and `eval/index.ts` refuses to run a proposed guard. A synthesised
 * guard that fails on day one is worse than no guard, because it teaches the user to ignore the
 * panel — and a panel that gets ignored stops being verification.
 *
 * **2. A decision with no synthesizable guard is marked `unverifiable`, never silently
 * skipped.** The literature's own test — "can I describe what a violation looks like?" — becomes
 * a visible property of the log. Unverifiable decisions are exactly the ones most likely to
 * drift, so hiding them is the worst available option, and a compliance score computed only over
 * the decisions that happened to be checkable is a score that flatters itself.
 *
 * ---------------------------------------------------------------------------
 * TEMPLATES FIRST, MODEL SECOND, AND THE RATIO IS MEASURED
 *
 * Templates cover the decision deterministically and are tried first. The model is consulted
 * only for what they miss, and everything it produces is flagged `requiresReview`. The
 * acceptance criterion is that at least 80% of proposed guards come from templates — so
 * `SynthesisReport` counts both, and the health panel prints the ratio rather than asserting it.
 *
 * ---------------------------------------------------------------------------
 * THE CAP IS APPLIED HERE, RANKED BY DETERMINISM
 *
 * Three guards per decision (§4.7). What gets dropped is always the least trustworthy kind,
 * never whichever happened to be generated last — `llm_judge` loses to `dependency_absent`
 * every time, which is the correct order for a system whose headline metric is deterministic.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { ProposedGuard, UnverifiableDecision } from "@/types/guards";
import type { PremiseSnapshot, WhyLogEngine } from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import { GUARDS_PER_DECISION_CAP, kindRank, type SynthesisReport, type TemplateInput } from "../types";
import { templateGuards, type AttributedGuard } from "../templates";
import { llmGuards } from "./llm";

export interface SynthesizeInput {
  readonly state: GraphState;
  readonly decisionId: DecisionId;
  readonly engine?: WhyLogEngine | null;
  readonly cap?: number;
  /** Force templates only, even when an engine is available. Used to measure the template
   *  coverage claim on its own, and by the keyless demo path. */
  readonly templatesOnly?: boolean | undefined;
  readonly signal?: AbortSignal;
}

/**
 * Compile one decision into a proposed guard set.
 *
 * Never throws. A decision with nothing checkable returns an empty set plus an
 * `UnverifiableDecision` saying why — which is a result, not a failure.
 */
export async function synthesize(input: SynthesizeInput): Promise<SynthesisReport> {
  const started = Date.now();
  const cap = input.cap ?? GUARDS_PER_DECISION_CAP;

  const decision = input.state.decisions.get(input.decisionId);
  if (decision === undefined) {
    return emptyReport(input.decisionId, "That decision is not in the log.", started);
  }

  const templateInput = templateInputFor(input.state, decision);
  const attributed = templateGuards(templateInput);
  const fromTemplates = attributed.length;

  let proposals: readonly ProposedGuard[] = attributed.map((entry) => entry.guard);
  let fromLlm = 0;
  let llmReason: string | null = null;

  /* ---- the model, only for what the templates missed ---- */
  const shouldAskModel =
    input.templatesOnly !== true &&
    input.engine !== undefined &&
    input.engine !== null &&
    attributed.length < cap;

  if (shouldAskModel && input.engine !== undefined && input.engine !== null) {
    const result = await llmGuards({
      engine: input.engine,
      decision,
      templateInput,
      premises: premiseSnapshotsFor(input.state, decision),
      alreadyProposed: proposals,
      slotsRemaining: Math.max(0, cap - proposals.length),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    fromLlm = result.guards.length;
    llmReason = result.reason;
    proposals = [...proposals, ...result.guards];
  }

  /* ---- cap, ranked by determinism ---- */
  const ranked = rankForCap(proposals);
  const capped = ranked.slice(0, cap);
  const dropped = ranked.length - capped.length;

  const unverifiable: UnverifiableDecision | null =
    capped.length === 0
      ? {
          decisionId: decision.id,
          reason: unverifiableReason(decision, templateInput, llmReason),
        }
      : null;

  return {
    decisionId: decision.id,
    proposed: capped,
    unverifiable,
    fromTemplates: Math.min(fromTemplates, capped.length),
    fromLlm: Math.min(fromLlm, Math.max(0, capped.length - fromTemplates)),
    cappedAt: dropped > 0 ? cap : null,
    durationMs: Date.now() - started,
  };
}

/**
 * Synthesise for every live decision in the log.
 *
 * Sequential rather than parallel: on the LLM path each call is a model request, and firing one
 * per decision at once is a rate limit and a bill. Templates are synchronous, so the keyless
 * path costs nothing here.
 */
export async function synthesizeAll(
  input: Omit<SynthesizeInput, "decisionId">,
): Promise<{ reports: readonly SynthesisReport[]; unverifiable: readonly UnverifiableDecision[] }> {
  const reports: SynthesisReport[] = [];
  const unverifiable: UnverifiableDecision[] = [];

  for (const decision of input.state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") continue;

    const report = await synthesize({ ...input, decisionId: decision.id });
    reports.push(report);
    if (report.unverifiable !== null) unverifiable.push(report.unverifiable);
  }

  return { reports, unverifiable };
}

/* -------------------------------------------------------------------------- */
/* Building the template input                                                */
/* -------------------------------------------------------------------------- */

/**
 * The decision, reduced to what a template needs.
 *
 * Built from the graph rather than from the decision record alone: rejected alternatives live
 * in `state.alternatives` and premises live behind the justification set, so a template that
 * only saw the `Decision` would never learn what was turned down — and "we chose X, not Y" is
 * the single most verifiable shape a decision has.
 */
export function templateInputFor(state: GraphState, decision: Decision): TemplateInput {
  const rejected: { value: string; whyRejected?: string }[] = [];

  for (const alternativeId of decision.alternativeIds) {
    const alternative = state.alternatives.get(alternativeId);
    if (alternative === undefined) continue;
    rejected.push(
      alternative.whyRejected === undefined
        ? { value: alternative.value }
        : { value: alternative.value, whyRejected: alternative.whyRejected },
    );
  }

  const premises: string[] = [];
  const seen = new Set<string>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;

    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);
      const premise = state.premises.get(premiseId);
      if (premise === undefined) continue;
      premises.push(premise.text);
    }
  }

  return {
    decisionId: decision.id,
    variable: decision.variable,
    value: decision.value,
    statement: decision.statement,
    rejected,
    appliesTo: decision.appliesTo,
    premises,
  };
}

/**
 * The decision's premises as the AI layer sees them.
 *
 * Separate from `templateInputFor` because templates want TEXT (for rationale phrasing) and the
 * engine wants ids, types and predicates. Building both from the same justification walk keeps
 * them consistent without either carrying fields the other does not use.
 */
export function premiseSnapshotsFor(state: GraphState, decision: Decision): readonly PremiseSnapshot[] {
  const out: PremiseSnapshot[] = [];
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
        type: premise.type,
        predicate: premise.predicate,
        text: premise.text,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Ranking and reporting                                                      */
/* -------------------------------------------------------------------------- */

/** Most deterministic first, then blocking before warning, then higher confidence. This is the
 *  order the cap cuts in, so the guards that survive are the ones whose results can be
 *  trusted without a model. */
export function rankForCap(guards: readonly ProposedGuard[]): readonly ProposedGuard[] {
  return [...guards].sort((a, b) => {
    const byKind = kindRank(a.spec.kind) - kindRank(b.spec.kind);
    if (byKind !== 0) return byKind;

    const bySeverity = (a.severity === "blocking" ? 0 : 1) - (b.severity === "blocking" ? 0 : 1);
    if (bySeverity !== 0) return bySeverity;

    return b.confidence - a.confidence;
  });
}

function unverifiableReason(
  decision: Decision,
  templateInput: TemplateInput,
  llmReason: string | null,
): string {
  const parts: string[] = [];

  parts.push(
    "No guard could be synthesised for " + decision.id + " (" + decision.variable + " = " + decision.value + ").",
  );

  if (templateInput.rejected.length === 0) {
    parts.push(
      "It records no rejected alternative, and a rejection is the most verifiable thing a decision carries — whatever the variable, the thing you turned down should not have appeared in the tree since.",
    );
  }

  if (templateInput.appliesTo.length === 0) {
    parts.push("It declares no `applies_to` globs, so there is no scope to check within.");
  }

  if (decision.value.trim().length === 0) {
    parts.push("Its value is empty, so there is nothing to look for.");
  }

  parts.push(
    "The literature's test is whether you can describe what a VIOLATION looks like. For this decision you cannot yet — which makes it unverifiable, not fine. Unverifiable decisions are the ones most likely to drift, because nothing would tell you if they did.",
  );

  if (llmReason !== null) parts.push("Model synthesis: " + llmReason);

  return parts.join(" ");
}

function emptyReport(decisionId: DecisionId, reason: string, started: number): SynthesisReport {
  return {
    decisionId,
    proposed: [],
    unverifiable: { decisionId, reason },
    fromTemplates: 0,
    fromLlm: 0,
    cappedAt: null,
    durationMs: Date.now() - started,
  };
}

/** The ≥80% claim, measured rather than asserted. */
export function templateShare(reports: readonly SynthesisReport[]): {
  templates: number;
  llm: number;
  share: number;
  meetsTarget: boolean;
} {
  let templates = 0;
  let llm = 0;

  for (const report of reports) {
    templates += report.fromTemplates;
    llm += report.fromLlm;
  }

  const total = templates + llm;
  const share = total === 0 ? 0 : templates / total;

  return { templates, llm, share, meetsTarget: total > 0 && share >= TEMPLATE_SHARE_TARGET };
}

export const TEMPLATE_SHARE_TARGET = 0.8;

export function describeSynthesis(reports: readonly SynthesisReport[]): string {
  const share = templateShare(reports);
  const unverifiable = reports.filter((report) => report.unverifiable !== null);
  const capped = reports.filter((report) => report.cappedAt !== null);

  return [
    reports.length + " decision(s) put through synthesis.",
    "  proposed guards   " + reports.reduce((total, report) => total + report.proposed.length, 0),
    "  from templates    " + share.templates,
    "  from the model    " + share.llm + (share.llm > 0 ? "  (every one flagged requiresReview)" : ""),
    "  template share    " + (share.share * 100).toFixed(0) + "%" + (share.meetsTarget ? "  — meets the ≥80% target" : "  — BELOW the ≥80% target"),
    "  unverifiable      " + unverifiable.length + (unverifiable.length > 0 ? "  — " + unverifiable.map((report) => report.decisionId).join(", ") : ""),
    "  capped at " + GUARDS_PER_DECISION_CAP + "        " + capped.length + " decision(s) had more proposed than the cap allows; the least deterministic were dropped",
    "",
    "Nothing here is installed. Every guard is `proposed` until accepted on the review list, and",
    "a proposed guard does not run — a synthesised guard that fails on day one teaches you to",
    "ignore the panel, which is worse than having no guard at all.",
  ].join("\n");
}

export type { AttributedGuard };
