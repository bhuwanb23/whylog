/**
 * LLM guard synthesis — 4.2. For what the templates miss.
 *
 * Phase 4 · sub-phase 4.2
 * Plan: plan/phase-4-executable-guards.md §4.2
 *
 * ---------------------------------------------------------------------------
 * EVERY GUARD FROM HERE IS FLAGGED `requiresReview`
 *
 * Not as a courtesy — as the mechanism that keeps §4.2's first rule true. A model proposing a
 * check is a guess about what the decision means in code, and a guess that is installed
 * unreviewed is a guard that fails on day one, which is the failure that gets the whole panel
 * ignored.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL MAY ONLY PROPOSE KINDS THE INTERPRETER CAN RUN
 *
 * A proposed spec is validated against the eight-kind union and rejected if it does not fit:
 * unknown kind, empty package, empty glob, empty pattern. This is not distrust of the model so
 * much as distrust of JSON — a hallucinated field produces a guard that evaluates to something
 * nobody intended, and "pass" is the most dangerous thing it could produce.
 *
 * ---------------------------------------------------------------------------
 * NO KEY, NO GUESS
 *
 * When the engine cannot synthesise, this returns an empty set and a REASON. The reason is
 * carried into the `unverifiable` explanation, so a decision that could have been checked with
 * a key says so, rather than being marked unverifiable as though nothing could ever check it.
 * ---------------------------------------------------------------------------
 */

import type { PremiseSnapshot, WhyLogEngine } from "@/ai/types";
import { asConfidence } from "@/types/common";
import type { Decision } from "@/types/domain";
import type {
  CommandSpec,
  DependencySpec,
  GuardSeverity,
  GuardSpec,
  LlmJudgeSpec,
  PathGlobSpec,
  ProposedGuard,
  StringSpec,
} from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput } from "../types";

export interface LlmSynthInput {
  readonly engine: WhyLogEngine;
  readonly decision: Decision;
  readonly templateInput: TemplateInput;
  /** What the templates already proposed, so the model is asked for something DIFFERENT rather
   *  than for a second opinion on a check that already exists. */
  readonly alreadyProposed: readonly ProposedGuard[];
  /** The decision's REAL premises, with their real ids. Passed in rather than reconstructed
   *  from `templateInput.premises`, whose texts have no ids attached — inventing ids here would
   *  put fabricated `P-000n` strings into a model prompt, and a model that quotes one back
   *  would be citing a premise that does not exist. */
  readonly premises: readonly PremiseSnapshot[];
  readonly slotsRemaining: number;
  readonly signal?: AbortSignal;
}

export interface LlmSynthResult {
  readonly guards: readonly ProposedGuard[];
  /** Why nothing came back, when nothing did. Carried into the unverifiable explanation. */
  readonly reason: string | null;
}

export async function llmGuards(input: LlmSynthInput): Promise<LlmSynthResult> {
  if (input.slotsRemaining <= 0) {
    return { guards: [], reason: "not consulted — the templates already filled the cap." };
  }

  if (
    !input.engine.capabilities().guardSynthesis ||
    input.engine.capabilities().guardSynthesis === "none"
  ) {
    return {
      guards: [],
      reason:
        "the active engine cannot synthesise guards. This decision may be checkable with an LLM engine configured in Settings, but nothing was proposed without one.",
    };
  }

  const result = await input.engine.synthesizeGuards({
    decisionId: input.decision.id,
    variable: input.decision.variable,
    value: input.decision.value,
    statement: input.decision.statement,
    appliesTo: input.decision.appliesTo,
    premises: input.premises,
    rejected: input.templateInput.rejected,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (result.guards.length === 0) {
    return {
      guards: [],
      reason: result.unverifiableReason ?? "the engine proposed nothing and gave no reason.",
    };
  }

  const existing = new Set(input.alreadyProposed.map((guard) => describeSpec(guard.spec)));
  const out: ProposedGuard[] = [];

  for (const proposed of result.guards) {
    if (out.length >= input.slotsRemaining) break;

    const validated = validate(proposed);
    if (validated === null) continue;

    /* Skip a proposal that duplicates something the templates already produced. Two guards for
     * the same check crowd out a different check under the cap. */
    const key = describeSpec(validated.spec);
    if (existing.has(key)) continue;
    existing.add(key);

    out.push({
      ...validated,
      /* Forced, whatever the engine claimed. See the header: this flag is the mechanism that
       * keeps guards proposed rather than installed, and it is not the model's to remove. */
      requiresReview: true,
      generatedBy: "llm",
    });
  }

  return { guards: out, reason: null };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Accept a proposed guard only if its spec is one the interpreter can actually run.
 *
 * Returns null — dropping the proposal — rather than repairing it. A repaired spec is a check
 * nobody proposed, and a guard that silently evaluates something other than what was asked for
 * is worse than no guard.
 */
export function validate(proposed: ProposedGuard): ProposedGuard | null {
  const spec = proposed.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent": {
      if (spec.package.trim().length === 0) return null;
      const fixed: DependencySpec = {
        kind: spec.kind,
        package: spec.package.trim(),
        ...(spec.includeDev === undefined ? {} : { includeDev: spec.includeDev }),
      };
      return withSpec(proposed, fixed);
    }

    case "path_glob_exists":
    case "path_glob_absent": {
      if (spec.glob.trim().length === 0) return null;
      const fixed: PathGlobSpec = { kind: spec.kind, glob: spec.glob.trim() };
      return withSpec(proposed, fixed);
    }

    case "string_in_files":
    case "string_absent_in_files": {
      if (spec.pattern.trim().length === 0 || spec.glob.trim().length === 0) return null;
      const fixed: StringSpec = {
        kind: spec.kind,
        pattern: spec.pattern,
        glob: spec.glob.trim(),
        /* Defaults forced to the safe side: word boundaries ON, because a bare substring match
         * on "pg" hits "pgp" and "pgsql-tools", which is the documented false-positive mode. */
        wordBoundary: spec.wordBoundary ?? true,
        caseSensitive: spec.caseSensitive ?? false,
      };
      return withSpec(proposed, fixed);
    }

    case "command_exit_zero": {
      if (spec.command.trim().length === 0) return null;
      const fixed: CommandSpec = {
        kind: spec.kind,
        command: spec.command.trim(),
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      };
      return withSpec(proposed, fixed);
    }

    case "llm_judge": {
      if (spec.rubric.trim().length === 0 || spec.scopeGlobs.length === 0) return null;
      const fixed: LlmJudgeSpec = {
        kind: spec.kind,
        rubric: spec.rubric.trim(),
        scopeGlobs: spec.scopeGlobs.filter((glob) => glob.trim().length > 0),
      };
      if (fixed.scopeGlobs.length === 0) return null;
      return withSpec(proposed, fixed);
    }

    default:
      /* An unknown kind. TypeScript says this is unreachable; JSON from a model says otherwise,
       * and this is the branch that catches it. */
      return null;
  }
}

function withSpec(proposed: ProposedGuard, spec: GuardSpec): ProposedGuard {
  const severity: GuardSeverity = proposed.severity === "blocking" ? "blocking" : "warning";

  return {
    spec,
    /* A rationale is mandatory (§4.1): a guard without a stated reason is indistinguishable
     * from a lint rule. A model that proposed none gets a placeholder that says so, rather than
     * the guard being dropped — the reviewer can then write the reason, which is a better
     * outcome than losing a check that was probably right. */
    rationale:
      proposed.rationale.trim().length > 0
        ? proposed.rationale.trim()
        : "Proposed by the model with no stated rationale. Write one before accepting: a guard without a reason is indistinguishable from a lint rule.",
    /* A model-proposed guard never gets `blocking` by default, whatever it asked for. Blocking
     * fails a build, and a guess should not be able to do that until a human has read it. */
    severity: severity === "blocking" ? DEFAULT_SEVERITY[spec.kind] : severity,
    generatedBy: "llm",
    confidence: asConfidence(Math.min(proposed.confidence, LLM_CONFIDENCE_CAP)),
    requiresReview: true,
  };
}

/** No model-proposed guard may claim more certainty than a template rule written by a person
 *  who knew what the variable meant. */
export const LLM_CONFIDENCE_CAP = 0.6;

/** A readable one-line description of a spec, for de-duplication against the template output. */
export function describeSpec(spec: GuardSpec): string {
  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return spec.kind + " " + spec.package;
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.kind + " " + spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return spec.kind + " " + JSON.stringify(spec.pattern) + " in " + spec.glob;
    case "command_exit_zero":
      return spec.kind + " " + spec.command;
    case "llm_judge":
      return spec.kind + " over " + spec.scopeGlobs.join(", ");
  }
}

export type { Decision };
