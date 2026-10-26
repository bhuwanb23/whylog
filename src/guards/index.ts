/**
 * The guard pipeline — Phase 4's entry point.
 *
 * Phase 4 · sub-phases 4.1–4.7
 * Plan: plan/phase-4-executable-guards.md
 * Docs: docs/04-executable-decision-guards.md — the whole document is this phase's spec
 *
 * ---------------------------------------------------------------------------
 * SYNTHESISE → REVIEW → RUN → SCORE → FEED BACK
 *
 * Five stages, and the order is the argument. A linter runs checks; this compiles them from
 * decisions, makes a human accept them before they can fire, scores what they found, and puts
 * the result back into the truth-maintenance cycle as evidence.
 *
 * The fitness-function literature has said for a decade that every important architectural
 * decision should have a corresponding fitness function. In every workflow it surveys, a human
 * writes the check by hand — because nobody has the decision in a structured enough form to
 * generate from. Phase 1 produced that form, so the compiler is nearly free, and it closes a
 * loop the literature only describes.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE WRITES
 *
 * Every stage returns events or reports. The store owns `append → fold → persist`, and the
 * reasoning cycle has to run on the state AFTER a guard failure is folded, not before — the same
 * two-batch split Phase 2's `assertAndRevise` uses. A pipeline that wrote its own events would
 * reason over a stale graph.
 * ---------------------------------------------------------------------------
 */

import type { Actor } from "@/types/common";
import type { DecisionId, GuardId, ISODateString } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { Guard, GuardBaseline, UnverifiableDecision, VirtualProject } from "@/types/guards";
import type { WhyLogEngine } from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import type { Assertion } from "@/reasoning/assert";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import type { EvaluatedGuard, GuardRunReport, SynthesisReport } from "./types";
import { GUARDS_PER_DECISION_CAP } from "./types";
import { buildProject, describeProject, type ProjectInput } from "./project";
import { runGuards, describeKindCoverage, lifecycleGate } from "./eval";
import { synthesize, synthesizeAll, describeSynthesis, templateShare, type SynthesizeInput } from "./synth";
import { applyBaseline, describeBaseline, freezeBaseline, hasBaseline, ratchetAfterRun } from "./baseline";
import { compliance, describeCompliance, type ComplianceResult } from "./metrics/compliance";
import { coverage, describeCoverage, type CoverageResult } from "./metrics/coverage";
import { soundness, describeSoundness, type SoundnessResult } from "./metrics/soundness";
import { driftAge, describeDrift, type DriftResult } from "./metrics/drift";
import { deterministicRatio, describeRatio, type RatioResult } from "./metrics/ratio";
import { feedbackFor, guardStatusMap, measuredCostCoverage, describeFeedbackLoop, type GuardFeedback } from "./feedback";
import { guardsForDecision, overCap, whyDisabled, describeReviewPolicy } from "./review";
import { exportCi, describeExport, type CiExport, type CiExportInput } from "./ci-export";

/* -------------------------------------------------------------------------- */
/* Stage 1 — synthesise                                                       */
/* -------------------------------------------------------------------------- */

export interface SynthesiseAllInput {
  readonly state: GraphState;
  readonly engine?: WhyLogEngine | null;
  readonly templatesOnly?: boolean | undefined;
  readonly cap?: number;
  readonly signal?: AbortSignal;
  /** Needed to build the `GuardSynthesised` drafts. Absent means "report only, propose nothing",
   *  which is what a read-only dashboard wants; a caller that intends to record the proposals passes
   *  both, because an event without an actor and a timestamp is not an event. */
  readonly actor?: Actor | undefined;
  readonly at?: ISODateString | undefined;
}

export interface SynthesiseAllResult {
  readonly reports: readonly SynthesisReport[];
  readonly unverifiable: readonly UnverifiableDecision[];
  /** The `GuardSynthesised` events to append. Every guard is PROPOSED. */
  readonly drafts: readonly NewEvent<EventType>[];
  readonly share: ReturnType<typeof templateShare>;
}

/**
 * Compile every live decision into a proposed guard set.
 *
 * Decisions that already have guards are skipped, so running this twice over an unchanged log
 * proposes nothing new — the same idempotence property Phase 2's `revise` has. Without it,
 * every click on "synthesise" would add three more proposed guards to every decision.
 */
export async function synthesiseAll(input: SynthesiseAllInput): Promise<SynthesiseAllResult> {
  const { reports, unverifiable } = await synthesizeAll({
    state: input.state,
    ...(input.engine === undefined ? {} : { engine: input.engine }),
    ...(input.templatesOnly === undefined ? {} : { templatesOnly: input.templatesOnly }),
    ...(input.cap === undefined ? {} : { cap: input.cap }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  /* Without an actor and a timestamp there is nothing to stamp the events with, so this is the
   * report-only path. With them, every proposed guard becomes a `GuardSynthesised` draft — PROPOSED,
   * never accepted (I4), so it enters the graph but does not run until a human accepts it.
   *
   * This used to return an empty list unconditionally, which made the bulk path a no-op: the store
   * pushed `all.drafts` into its batch and nothing arrived, so "synthesise guards for every
   * decision" silently proposed nothing and the guard count stayed at zero. */
  if (input.actor === undefined || input.at === undefined) {
    return { reports, unverifiable, drafts: [], share: templateShare(reports) };
  }

  const drafts: NewEvent<EventType>[] = [];
  for (const report of reports) {
    let suffixIndex = usedSuffixCount(input.state, report.decisionId);

    for (const proposed of report.proposed) {
      const suffix = letterFor(suffixIndex);
      suffixIndex += 1;

      drafts.push({
        type: "GuardSynthesised",
        payload: {
          guardId: guardIdFor(report.decisionId, suffix),
          decisionId: report.decisionId,
          kind: proposed.spec.kind,
          spec: proposed.spec,
          severity: proposed.severity,
          rationale: proposed.rationale,
          generatedBy: proposed.generatedBy,
        },
        actor: input.actor,
        reason:
          "Compiled from " + report.decisionId + " by the " + proposed.generatedBy + " path: " +
          proposed.spec.kind + ". It is PROPOSED and will not run until a human accepts it.",
        at: input.at,
      });
    }
  }

  return { reports, unverifiable, drafts, share: templateShare(reports) };
}

/**
 * Compile one decision and return the events that record it.
 *
 * Separate from `synthesiseAll` because the events need an actor, a timestamp and the next free
 * id suffix — all of which the caller owns. Keeping event construction here rather than in the
 * store means the id scheme lives in one place.
 */
export async function synthesiseDecision(
  input: SynthesizeInput & { actor: Actor; at: ISODateString },
): Promise<{ report: SynthesisReport; drafts: readonly NewEvent<EventType>[] }> {
  const report = await synthesize(input);
  const drafts: NewEvent<EventType>[] = [];

  let suffixIndex = usedSuffixCount(input.state, input.decisionId);

  for (const proposed of report.proposed) {
    const suffix = letterFor(suffixIndex);
    suffixIndex += 1;

    drafts.push({
      type: "GuardSynthesised",
      payload: {
        guardId: guardIdFor(input.decisionId, suffix),
        decisionId: input.decisionId,
        kind: proposed.spec.kind,
        spec: proposed.spec,
        severity: proposed.severity,
        rationale: proposed.rationale,
        generatedBy: proposed.generatedBy,
      },
      actor: input.actor,
      reason:
        "Compiled from " + input.decisionId + " by the " + proposed.generatedBy + " path: " +
        proposed.spec.kind + ". It is PROPOSED and will not run until a human accepts it.",
      at: input.at,
    });
  }

  return { report, drafts };
}

function usedSuffixCount(state: GraphState, decisionId: DecisionId): number {
  let count = 0;
  for (const guard of state.guards.values()) {
    if (guard.decisionId === decisionId) count += 1;
  }
  return count;
}

function letterFor(index: number): string {
  if (index < 26) return String.fromCharCode(97 + index);
  return "z" + String(index - 25);
}

/** `G-0007a`. Mirrors `formatGuardId` in `lib/ids.ts`; duplicated here only because that helper
 *  takes a `DecisionId` and this one has already sliced it. */
function guardIdFor(decisionId: DecisionId, suffix: string): GuardId {
  return ("G-" + decisionId.slice(4) + suffix) as GuardId;
}

/* -------------------------------------------------------------------------- */
/* Stage 3 — run                                                              */
/* -------------------------------------------------------------------------- */

export interface RunInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly project: VirtualProject;
  readonly baseline: GuardBaseline | null;
  readonly engine?: WhyLogEngine | null;
  readonly engineId?: Guard["engine"];
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly report: GuardRunReport;
  readonly evaluated: readonly EvaluatedGuard[];
  /** The verification events: `GuardRan` for every guard, `GuardFailed` for the new failures. */
  readonly drafts: readonly NewEvent<EventType>[];
  /** The reasoning assertions, one per new failure. Feed these to `assertNewInformation`. */
  readonly assertions: readonly Assertion[];
  readonly feedback: readonly GuardFeedback[];
  readonly baseline: GuardBaseline;
}

/**
 * Run every accepted guard against the project.
 *
 * Produces three things, which the store consumes in order:
 *
 *   `drafts`      verification events — append, fold
 *   `assertions`  guard-result assertions — append their drafts, fold, THEN run `revise`
 *   `baseline`    the ratcheted baseline, to persist
 *
 * Only NEW violations produce assertions. A baselined failure is still recorded and still shown,
 * but it does not fire a revision proposal for something the user already knew about on the
 * first run — that queue would be the wall of red §4.4's baseline pattern exists to prevent.
 */
export async function runAll(input: RunInput & { actor: Actor; at: ISODateString }): Promise<RunResult> {
  const guards = acceptedGuards(input.state);

  const labelByGuard = new Map<GuardId, Labelled["label"]>();
  const statementByGuard = new Map<GuardId, string>();

  for (const guard of guards) {
    labelByGuard.set(guard.id, input.labels.get(guard.decisionId)?.label ?? "UNKNOWN");
    statementByGuard.set(guard.id, input.state.decisions.get(guard.decisionId)?.statement ?? "");
  }

  const evaluated = await runGuards(
    guards,
    labelByGuard,
    statementByGuard,
    input.project,
    input.engine,
    input.engineId,
    input.signal,
  );

  const withBaseline = applyBaseline(input.baseline, evaluated);

  const drafts: NewEvent<EventType>[] = [];
  const assertions: Assertion[] = [];
  const feedback: GuardFeedback[] = [];

  for (const entry of withBaseline) {
    const result = feedbackFor({
      state: input.state,
      guard: entry.guard,
      result: entry.result,
      actor: input.actor,
      at: input.at,
    });

    drafts.push(...result.drafts);
    feedback.push(result);

    /* A baselined failure is recorded but not asserted. See the header. */
    if (result.assertion !== null && entry.newViolation) assertions.push(result.assertion);
  }

  const blocking = withBaseline.filter(
    (entry) => entry.newViolation && entry.guard.severity === "blocking",
  ).length;
  const warnings = withBaseline.filter(
    (entry) => entry.newViolation && entry.guard.severity === "warning",
  ).length;

  const nothingCheckable = withBaseline.every((entry) => entry.skipped);

  return {
    report: {
      evaluated: withBaseline,
      project: input.project,
      ranAt: input.at,
      durationMs: withBaseline.reduce((total, entry) => total + entry.result.durationMs, 0),
      blockingFailures: blocking,
      warningFailures: warnings,
      nothingCheckable,
    },
    evaluated: withBaseline,
    drafts,
    assertions,
    feedback,
    baseline: hasBaseline(input.baseline) && input.baseline !== null
      ? ratchetAfterRun(input.baseline, withBaseline)
      : input.baseline ?? freezeBaseline(withBaseline, null),
  };
}

/** Accepted guards only. A proposed, suppressed or deleted guard is never evaluated — the
 *  interpreter would skip it anyway, but not selecting it keeps the run report honest about how
 *  many checks actually happened. */
export function acceptedGuards(state: GraphState): readonly Guard[] {
  const out: Guard[] = [];
  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted") continue;
    out.push(guard);
  }
  return out.sort((a, b) => (a.decisionId < b.decisionId ? -1 : a.decisionId > b.decisionId ? 1 : a.id < b.id ? -1 : 1));
}

/* -------------------------------------------------------------------------- */
/* Stage 4 — score                                                            */
/* -------------------------------------------------------------------------- */

export interface MetricsInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  readonly evaluated: readonly EvaluatedGuard[];
  readonly unverifiable: readonly UnverifiableDecision[];
  readonly now: number;
}

export interface MetricsResult {
  readonly compliance: ComplianceResult;
  readonly coverage: CoverageResult;
  readonly soundness: SoundnessResult;
  readonly drift: DriftResult;
  readonly ratio: RatioResult;
  /** Decisions whose `implementation_cost` is now a measurement rather than 0.5 UNKNOWN. */
  readonly measuredCost: { measured: number; unknown: number };
}

export function metrics(input: MetricsInput): MetricsResult {
  const guardToDecision = new Map<string, DecisionId>();
  for (const guard of input.state.guards.values()) guardToDecision.set(guard.id, guard.decisionId);

  return {
    compliance: compliance(input.evaluated, input.labels, guardToDecision),
    coverage: coverage(input.state, input.labels, input.unverifiable),
    soundness: soundness(input.state, input.labels),
    drift: driftAge(input.state, input.now),
    ratio: deterministicRatio(input.state),
    measuredCost: measuredCostCoverage(input.state),
  };
}

/** The D4.2 dashboard, as text. All five metrics, with bars, plus the failing list and the
 *  unverifiable list — because a compliance number without its coverage is a number that
 *  flatters itself, and the two are never rendered apart. */
export function renderDashboard(result: MetricsResult): string {
  const lines = [
    row("DECISION COMPLIANCE", result.compliance.score, result.compliance.compliant + " / " + result.compliance.denominator),
    row("VERIFIABLE COVERAGE", result.coverage.score, result.coverage.covered + " / " + result.coverage.inDecisions),
    row("LOG SOUNDNESS", result.soundness.score, result.soundness.inCount + " / " + result.soundness.denominator),
    row("DETERMINISTIC RATIO", result.ratio.score, result.ratio.deterministic + " / " + result.ratio.total),
    "DRIFT AGE (worst)            " + (result.drift.worst === null ? "none" : result.drift.worstDays + " days · " + result.drift.worst.decisionId),
    "",
    "implementation_cost measured for " + result.measuredCost.measured + " decision(s); " +
      result.measuredCost.unknown + " still UNKNOWN at 0.5.",
  ];

  if (result.compliance.failing.length > 0) {
    lines.push("", "FAILING: " + result.compliance.failing.join(", "));
  }

  if (result.compliance.unchecked.length > 0) {
    lines.push("UNCHECKED (guards skipped): " + result.compliance.unchecked.join(", "));
  }

  if (result.coverage.unverifiable.length > 0) {
    lines.push(
      "",
      "UNVERIFIABLE (" + result.coverage.unverifiable.length + " decisions — no guard could be synthesised):",
      "  " + result.coverage.unverifiable.map((entry) => entry.decisionId).join(" · "),
    );
  }

  return lines.join("\n");
}

function row(label: string, value: number, fraction: string): string {
  const filled = Math.max(0, Math.min(10, Math.round(value * 10)));
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
  return label.padEnd(28) + bar + "  " + (value * 100).toFixed(0).padStart(3) + "%   " + fraction;
}

/* -------------------------------------------------------------------------- */
/* Barrels — one import site for the view and the store                       */
/* -------------------------------------------------------------------------- */

export { buildProject, describeProject, type ProjectInput } from "./project";
export { runGuard, runGuards, lifecycleGate, describeKindCoverage, UNKNOWN_ENGINE } from "./eval";
export { synthesize, synthesizeAll, describeSynthesis, templateShare, TEMPLATE_SHARE_TARGET } from "./synth";
export { llmGuards, validate as validateProposedGuard, describeSpec } from "./synth/llm";
export { templateGuards, TEMPLATED_VARIABLES, hasTemplate, describeCoverage as describeTemplateCoverage } from "./templates";
export {
  freezeBaseline, applyBaseline, isNewViolation, shrinkBaseline, ratchetUp, ratchetAfterRun,
  baselinedFailures, newViolations, describeBaseline, hasBaseline, NO_BASELINE,
} from "./baseline";
export { compliance, describeCompliance } from "./metrics/compliance";
export { coverage, describeCoverage } from "./metrics/coverage";
export { soundness, describeSoundness } from "./metrics/soundness";
export { driftAge, describeDrift, DRIFT_ESCALATION_DAYS } from "./metrics/drift";
export { deterministicRatio, describeRatio } from "./metrics/ratio";
export {
  feedbackFor, guardStatusFor, guardStatusMap, measuredCostCoverage,
  attributeFailure, specTarget, describeFeedbackLoop, GUARD_CONFIDENCE, JUDGED_CONFIDENCE,
} from "./feedback";
export {
  guardsForDecision, acceptGuard, suppressGuard, deleteGuard, editGuard,
  synthesiseEvent, nextSuffix, overCap, whyDisabled, describeTarget, describeReviewPolicy,
} from "./review";
export { exportCi, renderRunner, renderWorkflow, describeExport } from "./ci-export";
/* Imported for local use AS WELL AS re-exported. A re-export does not bind the name inside this
 * module, and `describeGuards()` below calls `describeTaxonomy()` — so without the import line
 * that call would be unresolved. Same trap as a namespaced re-export not flattening names. */
import { TAXONOMY, describeTaxonomy } from "./taxonomy";
export { TAXONOMY, describeTaxonomy, describeKind, runnableHere, deterministicKinds } from "./taxonomy";
export { GUARDS_PER_DECISION_CAP, KIND_ORDER, kindRank, severityRank, outcomeRank } from "./types";
export type {
  EvaluatedGuard, DecisionGuards, GuardRunReport, ProjectParseReport,
  SynthesisReport, TemplateInput, TemplateOutput, TemplateSource,
} from "./types";
export type { AttributedGuard } from "./templates";
export type { CiExport, CiExportInput, ExportedGuard } from "./ci-export";
export type { ComplianceResult, CoverageResult, SoundnessResult, DriftResult, RatioResult };

/**
 * Reconstruct evaluated guards from the graph, for callers that need metrics but did not run the
 * evaluation themselves — the export compiler stamping compliance, or the store recomputing after
 * a review action.
 *
 * `newViolation` cannot be recovered here: a stored `lastRun` does not record whether the baseline
 * knew about it. Every stored failure is therefore treated as new, which is the conservative
 * direction for a caller that has no baseline in hand. The run path in `runAll` computes it
 * properly; this is only for between-run recomputation.
 */
export function evaluatedFromState(state: GraphState): readonly EvaluatedGuard[] {
  const out: EvaluatedGuard[] = [];

  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted") continue;
    if (guard.lastRun === undefined) continue;

    out.push({
      guard,
      result: guard.lastRun,
      skipped: guard.lastRun.outcome === "skip",
      skipReason: guard.lastRun.skipReason ?? null,
      newViolation: guard.lastRun.outcome === "fail",
    });
  }

  return out;
}

/** Everything the health panel prints about this phase, in one call. */
export function describeGuards(state: GraphState): string {
  return [
    describeTaxonomy(),
    "",
    "──────── synthesis ────────",
    describeReviewPolicy(),
    "",
    "──────── feedback loop ────────",
    describeFeedbackLoop(),
    "",
    "──────── baseline ────────",
    describeBaseline(null),
    "",
    "──────── this log ────────",
    state.guards.size + " guard record(s), " + acceptedGuards(state).length + " accepted.",
    "Cap: " + GUARDS_PER_DECISION_CAP + " per decision, ranked by determinism.",
  ].join("\n");
}
