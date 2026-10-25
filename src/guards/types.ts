/**
 * Guard types local to the interpreter — 4.1.
 *
 * Phase 4 · sub-phase 4.1
 * Plan: plan/phase-4-executable-guards.md §4.1
 * Docs: docs/04-executable-decision-guards.md
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT LIVES IN `src/types/guards.ts`, NOT HERE
 *
 * `GuardKind`, `GuardSpec`, `Guard`, `GuardRunResult`, `VirtualProject`, `ProposedGuard`,
 * `GuardMetrics` and `GuardBaseline` were all declared in Phase 0 and are re-exported below so
 * this layer has one import site. Nothing here redefines them.
 *
 * What this file ADDS is the working vocabulary of the interpreter: what a guard evaluates TO,
 * what a set of them looks like grouped by decision, and what parsing pasted project input
 * reports back. Those are implementation shapes, not contracts, and putting them in
 * `src/types/` would make the contract file depend on how the interpreter happens to work.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, GuardId, ISODateString } from "@/types/common";
import type { DecisionVariable } from "@/types/domain";
import type { ProposedGuard, UnverifiableDecision } from "@/types/guards";
import type {
  Guard,
  GuardKind,
  GuardOutcome,
  GuardRunResult,
  GuardSeverity,
  GuardSpec,
  VirtualProject,
} from "@/types/guards";

export type {
  Guard,
  GuardBaseline,
  GuardKind,
  GuardLifecycle,
  GuardMetrics,
  GuardOutcome,
  GuardRunResult,
  GuardSeverity,
  GuardSpec,
  ProposedGuard,
  UnverifiableDecision,
  VirtualProject,
  VirtualProjectSource,
  DependencySpec,
  PathGlobSpec,
  StringSpec,
  CommandSpec,
  LlmJudgeSpec,
} from "@/types/guards";

export {
  DETERMINISTIC_GUARD_KINDS,
  BROWSER_RUNNABLE_GUARD_KINDS,
  DEFAULT_SEVERITY,
  EMPTY_VIRTUAL_PROJECT,
  isDeterministic,
  isBrowserRunnable,
} from "@/types/guards";

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One guard, evaluated.
 *
 * `result` is the artifact that gets written to the log; the rest is what the UI needs in
 * order to explain it without re-running anything.
 */
export interface EvaluatedGuard {
  readonly guard: Guard;
  readonly result: GuardRunResult;
  /** True when the guard was not evaluated at all — because it is proposed, suppressed,
   *  deleted, disabled by its decision's label, or of a kind this target cannot run. A skip
   *  is never a pass, and the distinction is what keeps a compliance score honest. */
  readonly skipped: boolean;
  readonly skipReason: string | null;
  /** True when this failure is NEW relative to the frozen baseline. Baseline failures are
   *  reported but do not count as drift — see `baseline.ts`. */
  readonly newViolation: boolean;
}

/** Every guard on one decision, with the decision's live label attached. */
export interface DecisionGuards {
  readonly decisionId: DecisionId;
  readonly guards: readonly Guard[];
  readonly accepted: readonly Guard[];
  readonly proposed: readonly Guard[];
  readonly suppressed: readonly Guard[];
  /** Guards that will not run because the decision is no longer IN. Inherited, never chosen
   *  per guard: a reversed decision must stop nagging without anyone having to remember to
   *  turn its guards off. */
  readonly disabledByLabel: boolean;
}

/** A whole run over a project. */
export interface GuardRunReport {
  readonly evaluated: readonly EvaluatedGuard[];
  readonly project: VirtualProject;
  readonly ranAt: ISODateString;
  readonly durationMs: number;
  readonly blockingFailures: number;
  readonly warningFailures: number;
  /** True when the project had no file listing, so every path and string guard skipped.
   *  Surfaced because a run where nothing could be checked must not look like a clean run. */
  readonly nothingCheckable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Project parsing                                                            */
/* -------------------------------------------------------------------------- */

/** What pasting produced, and what it could not produce. */
export interface ProjectParseReport {
  readonly project: VirtualProject;
  readonly dependenciesParsed: number;
  readonly devDependenciesParsed: number;
  readonly filesParsed: number;
  readonly contentsParsed: number;
  /** Every line that could not be interpreted, kept rather than dropped. A parse that
   *  silently ignores a line produces a project missing a file, and a missing file makes a
   *  `path_glob_exists` guard fail for a reason that has nothing to do with the codebase. */
  readonly unparsed: readonly string[];
  readonly notices: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* -------------------------------------------------------------------------- */

/** Which template produced a guard, so the ≥80% acceptance criterion can be measured rather
 *  than asserted. */
export type TemplateSource =
  | "database"
  | "framework"
  | "hosting"
  | "auth"
  | "storage"
  | "generic-value"
  | "generic-rejected"
  | "generic-glob";

export interface SynthesisReport {
  readonly decisionId: DecisionId;
  readonly proposed: readonly ProposedGuard[];
  readonly unverifiable: UnverifiableDecision | null;
  readonly fromTemplates: number;
  readonly fromLlm: number;
  readonly cappedAt: number | null;
  readonly durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Template synthesis                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a per-variable template is given.
 *
 * Deliberately the decision and nothing else: no graph state, no engine, no project. A
 * template is a pure function from a structured decision to a set of proposed checks, which is
 * what makes the ≥80%-from-templates acceptance criterion measurable and the whole synthesiser
 * reproducible. Everything a template would need state for — labels, premises' liveness,
 * whether a glob matches anything — is the SYNTHISER's job, in `synth/index.ts`.
 */
export interface TemplateInput {
  readonly decisionId: DecisionId;
  readonly variable: DecisionVariable;
  /** Canonicalised via the ontology alias table, so a template matches on `sqlite` and not on
   *  the eleven spellings that fold to it. */
  readonly value: string;
  readonly statement: string;
  /** Rejected alternatives. A rejection is a guard waiting to happen: the natural check for
   *  "we chose X, not Y" is that Y is absent. */
  readonly rejected: readonly { readonly value: string; readonly whyRejected?: string }[];
  /** File globs the decision governs. Used to scope string and path guards, because an
   *  unscoped `string_absent_in_files: "postgres"` fails on the migration script that moves
   *  data OUT of Postgres — a file whose existence is evidence FOR the decision. */
  readonly appliesTo: readonly string[];
  /** Premise texts, for rationale phrasing only. A rationale that names the condition the
   *  check protects is one a reviewer can judge; one that just restates the guard is not. */
  readonly premises: readonly string[];
}

/** A template's output. Empty means "this template has nothing to say about this decision",
 *  which is a normal answer and not an error — the synthesiser then tries the generic
 *  templates, and only marks the decision `unverifiable` if those are empty too. */
export type TemplateOutput = readonly ProposedGuard[];

/** The cap from §4.7. Ranked by determinism, so what gets dropped is always the least
 *  trustworthy guard rather than an arbitrary one. */
export const GUARDS_PER_DECISION_CAP = 3;

/** How a kind ranks for the cap and for display: most deterministic first. */
export const KIND_ORDER: readonly GuardKind[] = [
  "dependency_present",
  "dependency_absent",
  "path_glob_absent",
  "path_glob_exists",
  "string_absent_in_files",
  "string_in_files",
  "command_exit_zero",
  "llm_judge",
];

export function kindRank(kind: GuardKind): number {
  const index = KIND_ORDER.indexOf(kind);
  return index < 0 ? KIND_ORDER.length : index;
}

export function severityRank(severity: GuardSeverity): number {
  return severity === "blocking" ? 0 : 1;
}

export function outcomeRank(outcome: GuardOutcome): number {
  /* Failures first, then skips, then passes. A skip ranks above a pass because a guard that
   * could not be checked is a gap in coverage and a pass is not — collapsing skips into
   * passes is how a panel shows green over a project it never saw. */
  switch (outcome) {
    case "fail":
      return 0;
    case "skip":
      return 1;
    case "pass":
      return 2;
  }
}

export type { DecisionId, GuardId };
