/**
 * The interpreter dispatch — 4.3.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 *
 * ---------------------------------------------------------------------------
 * ONE FUNCTION, EIGHT KINDS, NO SPECIAL CASES
 *
 * Every evaluator takes a spec and the project and returns an `Evaluation`. The dispatcher
 * narrows the spec by kind and calls the right one; `command_exit_zero` and `llm_judge` return
 * a skip through the same shape rather than being handled outside it. A dispatcher with a
 * special case for the unrunnable kinds is a dispatcher that will grow more special cases.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD IS CHECKED BEFORE THE SPEC IS
 *
 * Lifecycle and label-inheritance are decided here, not in each evaluator, because they are
 * properties of the guard rather than of its kind:
 *
 *   proposed    NEVER RUNS. §4.7's rule — no guard runs until accepted. A synthesised guard
 *               that fails on day one is worse than no guard, because it teaches the user to
 *               ignore the panel.
 *   suppressed  never runs; shows its reason.
 *   deleted     never runs.
 *   disabled by label  never runs — the decision is OUT or superseded, so its guards must stop
 *               nagging without anyone remembering to turn them off.
 *
 * Each of those is a SKIP with a reason, never a pass and never a silent omission.
 * ---------------------------------------------------------------------------
 */

import type { WhyLogEngine } from "@/ai/types";
import { monotonicNow, nowISO } from "@/lib/format";
import type { EngineId, GuardId, ISODateString } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { Guard, GuardRunResult, VirtualProject } from "@/types/guards";
import { isBrowserRunnable } from "@/types/guards";
import type { EvaluatedGuard } from "../types";
import { evalCommand } from "./command";
import { evalDependency } from "./dependency";
import { type JudgeVerdict, evalLlmJudge } from "./llm-judge";
import { evalPath } from "./path";
import { evalString } from "./string";
import type { Evaluation } from "./types";

/** Stamped on an `llm_judge` verdict when the caller ran it without naming an engine, so the
 *  advisory line still says a model produced it rather than claiming an engine that was never
 *  there. `EngineId` is a `{ kind, model }` record, not a string — an engine is identified by
 *  both, because two vectors from different engines must never be compared. */
export const UNKNOWN_ENGINE: EngineId = { kind: "local", model: "unknown" };

export interface RunGuardInput {
  readonly guard: Guard;
  readonly project: VirtualProject;
  /** The decision's LIVE label. Passed in rather than read from the guard, because labels are
   *  computed from the graph and nothing stores them. */
  readonly decisionLabel: DecisionLabel;
  readonly decisionStatement: string;
  readonly engine?: WhyLogEngine | null;
  readonly engineId?: EngineId;
  readonly signal?: AbortSignal;
}

/**
 * Evaluate one guard.
 *
 * Pure apart from the `llm_judge` path, which needs the engine. The timestamp and duration are
 * stamped here rather than inside the evaluators, so the six deterministic kinds stay pure
 * functions of (spec, project) and remain reproducible.
 */
export async function runGuard(input: RunGuardInput): Promise<EvaluatedGuard> {
  const started = performanceSafeNow();
  const gate = lifecycleGate(input.guard, input.decisionLabel);

  if (gate !== null) {
    return finish(input.guard, gate, started, false);
  }

  const evaluation = await evaluate(input);
  return finish(input.guard, evaluation, started, false);
}

/** Evaluate without the label/lifecycle gate — used by CI export, which emits code for guards
 *  that will run outside the app and therefore outside the label logic. */
export async function evaluateSpec(guard: Guard, project: VirtualProject): Promise<Evaluation> {
  if (!isBrowserRunnable(guard.spec.kind)) {
    return evalCommand({ kind: "command_exit_zero", command: "" }, project);
  }

  switch (guard.spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return evalDependency(guard.spec, project);
    case "path_glob_exists":
    case "path_glob_absent":
      return evalPath(guard.spec, project);
    case "string_in_files":
    case "string_absent_in_files":
      return evalString(guard.spec, project);
    case "command_exit_zero":
      return evalCommand(guard.spec, project);
    case "llm_judge":
      return {
        outcome: "skip",
        evidence: "",
        skipReason:
          "Judging needs an engine, which this call site does not have. Run the guard through `runGuard` with an engine, or export it to CI.",
      };
  }
}

async function evaluate(input: RunGuardInput): Promise<Evaluation> {
  const spec = input.guard.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return evalDependency(spec, input.project);
    case "path_glob_exists":
    case "path_glob_absent":
      return evalPath(spec, input.project);
    case "string_in_files":
    case "string_absent_in_files":
      return evalString(spec, input.project);
    case "command_exit_zero":
      return evalCommand(spec, input.project);
    case "llm_judge": {
      const verdict: JudgeVerdict = await evalLlmJudge({
        spec,
        project: input.project,
        engine: input.engine ?? null,
        engineId: input.engineId ?? UNKNOWN_ENGINE,
        decisionStatement: input.decisionStatement,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return verdict.evaluation;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The gates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Should this guard run at all?
 *
 * Returns a SKIP evaluation when it should not, and null when it should.
 */
export function lifecycleGate(guard: Guard, decisionLabel: DecisionLabel): Evaluation | null {
  switch (guard.lifecycle) {
    case "proposed":
      return {
        outcome: "skip",
        evidence: "",
        skipReason:
          "This guard is PROPOSED and has not been accepted, so it does not run. A synthesised guard that fails on day one is worse than no guard — it teaches you to ignore the panel. Accept it on the review list to activate it.",
      };
    case "suppressed":
      return {
        outcome: "skip",
        evidence: "",
        skipReason: `Suppressed${
          guard.suppressionReason === undefined || guard.suppressionReason.length === 0
            ? "."
            : `: ${guard.suppressionReason}`
        }`,
      };
    case "deleted":
      return {
        outcome: "skip",
        evidence: "",
        skipReason: "This guard has been deleted and is retained only as history.",
      };
    case "accepted":
      break;
  }

  if (guard.disabledByDecisionLabel || !runsForLabel(decisionLabel)) {
    return {
      outcome: "skip",
      evidence: "",
      skipReason: `Its decision is labelled ${decisionLabel}, so this guard is disabled. Guards inherit their decision's label: a reversed or unsupported decision must stop nagging, and re-enabling requires the decision to return to IN.`,
    };
  }

  return null;
}

/** Only an IN decision's guards run. Every other label means the decision is not currently
 *  believed, and a check on something you do not believe is noise. */
export function runsForLabel(label: DecisionLabel): boolean {
  return label === "IN";
}

/* -------------------------------------------------------------------------- */
/* Stamping                                                                   */
/* -------------------------------------------------------------------------- */

function finish(
  guard: Guard,
  evaluation: Evaluation,
  started: number,
  newViolation: boolean,
): EvaluatedGuard {
  const ranAt = nowISO() as ISODateString;

  const result: GuardRunResult = {
    guardId: guard.id,
    outcome: evaluation.outcome,
    evidence: evaluation.evidence,
    ranAt,
    durationMs: Math.max(0, Math.round(performanceSafeNow() - started)),
    ...(evaluation.skipReason === undefined ? {} : { skipReason: evaluation.skipReason }),
  };

  return {
    guard,
    result,
    skipped: evaluation.outcome === "skip",
    skipReason: evaluation.skipReason ?? null,
    newViolation: evaluation.outcome === "fail" && newViolation,
  };
}

/** The shared monotonic clock. Imported rather than copied: `ai/local`, `ai/llm` and this
 *  interpreter all measure durations, and a duration measured against two different clock
 *  fallbacks can come out negative. */
const performanceSafeNow = monotonicNow;

/* -------------------------------------------------------------------------- */
/* Batch                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Run a whole guard set against the project.
 *
 * Failures are sorted to the front and, within failures, `blocking` before `warning` — because
 * the point of the panel is the thing you have to act on, and a list ordered by guard id makes
 * you hunt for it.
 */
export async function runGuards(
  guards: readonly Guard[],
  labels: ReadonlyMap<GuardId, DecisionLabel>,
  statements: ReadonlyMap<GuardId, string>,
  project: VirtualProject,
  engine?: WhyLogEngine | null,
  engineId?: EngineId,
  signal?: AbortSignal,
): Promise<readonly EvaluatedGuard[]> {
  const out: EvaluatedGuard[] = [];

  for (const guard of guards) {
    out.push(
      await runGuard({
        guard,
        project,
        /* A guard whose decision is not in the label map still gets evaluated: defaulting to
         * "IN" means it runs rather than being silently dropped. Dropping it would understate
         * coverage, and running it is the honest default because the map is built from the same
         * state the guards came from. */
        decisionLabel: labels.get(guard.id) ?? "IN",
        decisionStatement: statements.get(guard.id) ?? "",
        ...(engine === undefined ? {} : { engine }),
        ...(engineId === undefined ? {} : { engineId }),
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  }

  return out.sort((a, b) => {
    const byOutcome = outcomeOrder(a.result.outcome) - outcomeOrder(b.result.outcome);
    if (byOutcome !== 0) return byOutcome;

    const bySeverity =
      (a.guard.severity === "blocking" ? 0 : 1) - (b.guard.severity === "blocking" ? 0 : 1);
    if (bySeverity !== 0) return bySeverity;

    return a.guard.id < b.guard.id ? -1 : a.guard.id > b.guard.id ? 1 : 0;
  });
}

function outcomeOrder(outcome: GuardRunResult["outcome"]): number {
  switch (outcome) {
    case "fail":
      return 0;
    case "skip":
      return 1;
    case "pass":
      return 2;
  }
}

export function describeKindCoverage(project: VirtualProject): string {
  const manifest =
    Object.keys(project.dependencies).length + Object.keys(project.devDependencies).length > 0;
  const listing = project.filePaths.length > 0;
  const contents = Object.keys(project.fileContents).length > 0;

  return [
    "What can run against the pasted project:",
    `  dependency_present / dependency_absent   ${manifest ? "yes" : "SKIP — no manifest"}`,
    `  path_glob_exists / path_glob_absent      ${listing ? "yes" : "SKIP — no listing"}`,
    `  string_in_files / string_absent_in_files ${listing && contents ? "yes" : "SKIP — needs both a listing and contents"}`,
    "  command_exit_zero                        SKIP always — export to CI, there is no shell here",
    "  llm_judge                                needs a key; advisory only, never in compliance",
    "",
    "The six deterministic kinds need no model and no shell. command_exit_zero is deterministic",
    "in principle but environment-dependent, so it is export-only.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export { evalDependency } from "./dependency";
export { evalPath, globHasMatches, EVIDENCE_PATH_LIMIT } from "./path";
export { evalString } from "./string";
export { evalCommand, commandLine, shellQuote } from "./command";
export { evalLlmJudge, ADVISORY_NOTICE, JUDGE_CHAR_BUDGET, JUDGE_FILE_LIMIT } from "./llm-judge";
export type { Evaluation } from "./types";
export type { JudgeVerdict, JudgeInput } from "./llm-judge";
