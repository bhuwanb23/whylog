/**
 * Guard contracts — the executable half of a decision.
 *
 * Phase 4 · sub-phases 4.1-4.7
 * Plan:     plan/phase-4-executable-guards.md
 * Research: docs/04-executable-decision-guards.md
 *
 * A guard is a machine-checkable assertion synthesised FROM a decision, which
 * fails when the observable state of the project stops matching what the
 * decision claims. It is not a lint rule: its failure is EVIDENCE, and evidence
 * enters the same REVISE() cycle as a transcript does.
 */

import type {
  Confidence,
  DecisionId,
  EngineId,
  EventId,
  GuardId,
  ISODateString,
} from "./common";

/* -------------------------------------------------------------------------- */
/* Kinds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Eight kinds, ordered from most deterministic to least.
 *
 * DESIGN RULE: prefer the highest-determinism kind that expresses the decision.
 * `llm_judge` is a last resort. The ratio of deterministic to judged guards is
 * itself a health metric (`Deterministic Ratio`, Phase 4.4).
 */
export type GuardKind =
  /** A package IS in the dependency tree. */
  | "dependency_present"
  /** A package is NOT present — typically a rejected alternative. */
  | "dependency_absent"
  /** Files matching a glob DO exist. */
  | "path_glob_exists"
  /** No files match a glob. */
  | "path_glob_absent"
  /** A pattern APPEARS within a glob. */
  | "string_in_files"
  /** A pattern does NOT appear within a glob. */
  | "string_absent_in_files"
  /** An arbitrary command exits 0. EXPORT ONLY — never run in the browser. */
  | "command_exit_zero"
  /** A rubric verdict over a diff or file set. Requires a key. */
  | "llm_judge";

/** The six kinds that evaluate deterministically with no model and no shell. */
export const DETERMINISTIC_GUARD_KINDS: readonly GuardKind[] = [
  "dependency_present",
  "dependency_absent",
  "path_glob_exists",
  "path_glob_absent",
  "string_in_files",
  "string_absent_in_files",
] as const;

/** The six kinds that can run against an in-browser virtual project. */
export const BROWSER_RUNNABLE_GUARD_KINDS: readonly GuardKind[] =
  DETERMINISTIC_GUARD_KINDS;

export function isDeterministic(kind: GuardKind): boolean {
  return (DETERMINISTIC_GUARD_KINDS as readonly GuardKind[]).includes(kind);
}

export function isBrowserRunnable(kind: GuardKind): boolean {
  return (BROWSER_RUNNABLE_GUARD_KINDS as readonly GuardKind[]).includes(kind);
}

/**
 * Severity. Mirrors the fitness-function distinction between failing the build
 * and flagging drift.
 *
 * Default policy: `blocking` for dependency and path guards, `warning` for
 * string guards — because a string pattern is far easier to match by accident
 * ("pg" inside "pgp") than a dependency entry is.
 */
export type GuardSeverity = "blocking" | "warning";

export const DEFAULT_SEVERITY: Readonly<Record<GuardKind, GuardSeverity>> = {
  dependency_present: "blocking",
  dependency_absent: "blocking",
  path_glob_exists: "warning",
  path_glob_absent: "warning",
  string_in_files: "warning",
  string_absent_in_files: "warning",
  command_exit_zero: "warning",
  llm_judge: "warning",
};

/* -------------------------------------------------------------------------- */
/* Specs — one shape per kind, so a malformed guard is unrepresentable         */
/* -------------------------------------------------------------------------- */

export interface DependencySpec {
  readonly kind: "dependency_present" | "dependency_absent";
  readonly package: string;
  /** Search devDependencies too. Default true for `_absent`, false for `_present`. */
  readonly includeDev?: boolean;
}

export interface PathGlobSpec {
  readonly kind: "path_glob_exists" | "path_glob_absent";
  readonly glob: string;
}

export interface StringSpec {
  readonly kind: "string_in_files" | "string_absent_in_files";
  readonly pattern: string;
  readonly glob: string;
  /** Match on word boundaries. Default TRUE — "pg" must not match "pgp",
   *  "pgsql-tools", or a passing mention in a comment. */
  readonly wordBoundary?: boolean;
  readonly caseSensitive?: boolean;
}

export interface CommandSpec {
  readonly kind: "command_exit_zero";
  readonly command: string;
  readonly cwd?: string;
}

export interface LlmJudgeSpec {
  readonly kind: "llm_judge";
  readonly rubric: string;
  readonly scopeGlobs: readonly string[];
}

export type GuardSpec =
  | DependencySpec
  | PathGlobSpec
  | StringSpec
  | CommandSpec
  | LlmJudgeSpec;

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export type GuardOutcome = "pass" | "fail" | "skip";

export interface GuardRunResult {
  readonly guardId: GuardId;
  readonly outcome: GuardOutcome;
  /**
   * The exact line or file that produced the result, quoted verbatim.
   *
   * Non-optional on `fail`: this string is quoted into the revision proposal,
   * because evidence without a quote is not evidence.
   */
  readonly evidence: string;
  readonly ranAt: ISODateString;
  readonly durationMs: number;
  /** Present when outcome is `skip`. */
  readonly skipReason?: string;
}

/* -------------------------------------------------------------------------- */
/* The guard record                                                           */
/* -------------------------------------------------------------------------- */

export type GuardLifecycle =
  /** Synthesised but not yet accepted. NEVER RUNS in this state. */
  | "proposed"
  | "accepted"
  | "suppressed"
  | "deleted";

export interface Guard {
  readonly id: GuardId;
  readonly decisionId: DecisionId;
  readonly spec: GuardSpec;

  /**
   * Why this check verifies that decision. MANDATORY — a guard without a
   * stated rationale is indistinguishable from a lint rule.
   */
  readonly rationale: string;

  readonly severity: GuardSeverity;
  readonly generatedBy: "template" | "llm" | "user";
  readonly engine: EngineId;
  readonly lifecycle: GuardLifecycle;

  /** Required when lifecycle is `suppressed`. */
  readonly suppressionReason?: string;

  readonly lastRun?: GuardRunResult;
  /** When this guard first started failing and has not passed since.
   *  Drives the `Drift Age` metric (Phase 4.4). */
  readonly firstFailedAt?: ISODateString;

  /**
   * Guards INHERIT their decision's label: a decision that is OUT or
   * SUPERSEDED has its guards auto-disabled, and re-enabling requires the
   * decision to return to IN. Prevents a reversed decision from nagging.
   */
  readonly disabledByDecisionLabel: boolean;

  readonly createdAt: ISODateString;
  readonly createdByEvent: EventId;
}

/* -------------------------------------------------------------------------- */
/* The virtual project — what guards are evaluated against                     */
/* -------------------------------------------------------------------------- */

/**
 * Guards must run somewhere. In the browser they run against a VIRTUAL PROJECT
 * built from pasted input: a package.json, a file listing, and optionally file
 * contents.
 *
 * This is the designed default, not a compromise. It is real evaluation of real
 * logic against real data, needs no shell and no network, works inside a
 * sandboxed preview, and makes the compliance score demonstrable in ten
 * seconds. The only thing missing is automatic file discovery, which is a
 * repo-connection concern (v2), not a correctness concern.
 */
export interface VirtualProject {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly filePaths: readonly string[];
  /** path -> text. Absent entries make `string_*` guards SKIP, not pass. */
  readonly fileContents: Readonly<Record<string, string>>;
  readonly sourcedFrom: VirtualProjectSource;
  readonly loadedAt: ISODateString;
}

export type VirtualProjectSource =
  | { readonly kind: "pasted-manifest" }
  | { readonly kind: "pasted-file-listing" }
  | { readonly kind: "repo-scan" }
  | { readonly kind: "fixture"; readonly name: string };

/** An empty project. String and path guards SKIP against it rather than
 *  passing, because absence of evidence is not evidence of absence. */
export const EMPTY_VIRTUAL_PROJECT: VirtualProject = {
  dependencies: {},
  devDependencies: {},
  filePaths: [],
  fileContents: {},
  sourcedFrom: { kind: "pasted-manifest" },
  loadedAt: "" as ISODateString,
};

/* -------------------------------------------------------------------------- */
/* Synthesis                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProposedGuard {
  readonly spec: GuardSpec;
  readonly rationale: string;
  readonly severity: GuardSeverity;
  readonly generatedBy: "template" | "llm";
  readonly confidence: Confidence;
  /** True when the synthesiser could not justify the guard from a template and
   *  fell back to the model. Such guards ALWAYS require review. */
  readonly requiresReview: boolean;
}

/**
 * A decision for which no guard could be synthesised.
 *
 * Marked `unverifiable`, NEVER silently skipped. The literature's own test —
 * "Can I describe what a violation looks like?" — becomes a visible property of
 * the log, and unverifiable decisions are exactly the ones most likely to drift.
 */
export interface UnverifiableDecision {
  readonly decisionId: DecisionId;
  readonly reason: string;
}

/* -------------------------------------------------------------------------- */
/* Metrics (Phase 4.4)                                                        */
/* -------------------------------------------------------------------------- */

export interface GuardMetrics {
  /** IN decisions whose guards all pass / IN decisions with >=1 accepted guard.
   *  The headline number. Deterministic guards ONLY — judged verdicts never
   *  enter it, or an LLM opinion launders itself into a compliance score. */
  readonly compliance: number;
  /** IN decisions with >=1 accepted guard / all IN decisions. */
  readonly verifiableCoverage: number;
  /** Deterministic guards / all guards. */
  readonly deterministicRatio: number;
  /** Days since the oldest unresolved failing guard. */
  readonly driftAgeDays: number;
  readonly counts: {
    readonly total: number;
    readonly proposed: number;
    readonly accepted: number;
    readonly passing: number;
    readonly failing: number;
    readonly skipped: number;
    readonly suppressed: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Baseline & ratchet                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A legacy codebase fails many guards on first run. Do not make that a wall of
 * red: freeze the initial state as a BASELINE, fail only on NEW violations, and
 * let the user shrink the baseline deliberately.
 *
 * "Never write fitness functions for the codebase you want — write them for the
 * one you have. The function is a lock, not a goal."
 */
export interface GuardBaseline {
  readonly frozenAt: ISODateString;
  /** guardId -> the evidence string at freeze time. */
  readonly frozenFailures: Readonly<Record<string, string>>;
  /** The ratchet: guard ids promoted from warning to enforced. Quality never
   *  decreases — a guard on this list cannot be demoted silently. */
  readonly enforced: readonly GuardId[];
}
