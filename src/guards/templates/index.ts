/**
 * Template dispatch by decision variable — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 * Plan: plan/phase-4-executable-guards.md §4.2
 *
 * ---------------------------------------------------------------------------
 * SPECIFIC FIRST, GENERIC AFTER — AND THE ORDER IS THE COVERAGE CLAIM
 *
 * §4.2's acceptance criterion is that **at least 80% of proposed guards come from templates
 * rather than the LLM**. Meeting it is not a matter of writing more templates: it is a matter
 * of the generic strategies in `generic.ts` being sound enough that almost every decision
 * produces SOMETHING deterministic.
 *
 * So dispatch tries the variable-specific template, then always appends the generic ones, then
 * de-duplicates. The specific template contributes the checks a human would write; the generic
 * ones contribute the rejection and scope checks that hold for any variable. Between them the
 * fixture's five decisions each yield 1–3 guards without a model being consulted at all.
 *
 * ---------------------------------------------------------------------------
 * DE-DUPLICATION IS WHAT KEEPS THE CAP MEANINGFUL
 *
 * The cap is three guards per decision, ranked by determinism. Without de-duplication a
 * DATABASE decision would spend all three slots on `dependency_absent: pg` proposed twice — once
 * by the specific template from the rejected-alternative list and once by the generic strategy
 * from the same list — and the connection-string and artifact checks would never surface.
 * Two proposals for the same check are one check, and the higher-confidence one wins.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";
import type { ProposedGuard } from "@/types/guards";
import type { TemplateInput, TemplateOutput, TemplateSource } from "../types";
import { kindRank, severityRank } from "../types";
import { authGuards } from "./auth";
import { databaseGuards } from "./database";
import { frameworkGuards } from "./framework";
import { genericGuards, globGuards, rejectedGuards, valueGuards } from "./generic";
import { hostingGuards } from "./hosting";
import { storageGuards } from "./storage";

export interface AttributedGuard {
  readonly guard: ProposedGuard;
  readonly source: TemplateSource;
}

const DISPATCH: Readonly<
  Partial<Record<DecisionVariable, (input: TemplateInput) => TemplateOutput>>
> = {
  DATABASE: databaseGuards,
  FRAMEWORK: frameworkGuards,
  HOSTING: hostingGuards,
  AUTH: authGuards,
  STORAGE: storageGuards,
};

/** Which variables have a specific template. Printed in the health panel, because "≥80% from
 *  templates" is only meaningful if you can see which slots are covered and which fall through
 *  to the generic strategies. */
export const TEMPLATED_VARIABLES: readonly DecisionVariable[] = Object.keys(
  DISPATCH,
) as DecisionVariable[];

export function hasTemplate(variable: DecisionVariable): boolean {
  return DISPATCH[variable] !== undefined;
}

/**
 * Run every applicable template.
 *
 * Never throws and never returns a guard without a rationale — a guard without a stated
 * rationale is indistinguishable from a lint rule, which is the one property §4.1 makes
 * mandatory.
 */
export function templateGuards(input: TemplateInput): readonly AttributedGuard[] {
  const out: AttributedGuard[] = [];

  const specific = DISPATCH[input.variable];
  if (specific !== undefined) {
    for (const guard of specific(input)) {
      out.push({ guard, source: sourceOf(input.variable) });
    }
  }

  /* The generic strategies run for EVERY variable, including the templated ones: a DATABASE
   * decision still has `applies_to` globs worth checking, and its rejected alternatives are
   * worth checking even if the specific template happened not to recognise one of them. */
  for (const guard of rejectedGuards(input)) out.push({ guard, source: "generic-rejected" });
  for (const guard of valueGuards(input)) out.push({ guard, source: "generic-value" });
  for (const guard of globGuards(input)) out.push({ guard, source: "generic-glob" });

  return dedupe(out);
}

/** The generic set on its own, for a variable with no specific template. Exported so the
 *  synthesiser can report "generic only" distinctly from "no template matched at all" — the
 *  first is a coverage gap in the templates, the second is a decision with nothing checkable. */
export function genericOnly(input: TemplateInput): readonly AttributedGuard[] {
  return dedupe(
    genericGuards(input).map((guard): AttributedGuard => ({ guard, source: "generic-value" })),
  );
}

function sourceOf(variable: DecisionVariable): TemplateSource {
  switch (variable) {
    case "DATABASE":
      return "database";
    case "FRAMEWORK":
      return "framework";
    case "HOSTING":
      return "hosting";
    case "AUTH":
      return "auth";
    case "STORAGE":
      return "storage";
    default:
      return "generic-value";
  }
}

/** Two guards are the same check when their specs are structurally equal. The higher-confidence
 *  proposal wins, and on a tie the more deterministic kind does — which is the same preference
 *  the cap applies, so the two rankings cannot disagree about which guard matters. */
function dedupe(guards: readonly AttributedGuard[]): readonly AttributedGuard[] {
  const best = new Map<string, AttributedGuard>();

  for (const entry of guards) {
    /* Every guard a template emits carries a rationale; one that does not is dropped rather
     * than passed on, because §4.1 makes the rationale mandatory and a guard without one would
     * be indistinguishable from a lint rule by the time it reached the review list. */
    if (entry.guard.rationale.trim().length === 0) continue;

    const key = specKey(entry.guard);
    const existing = best.get(key);

    if (existing === undefined) {
      best.set(key, entry);
      continue;
    }

    const byConfidence = entry.guard.confidence - existing.guard.confidence;
    if (byConfidence > 0) {
      best.set(key, entry);
      continue;
    }
    if (
      byConfidence === 0 &&
      kindRank(entry.guard.spec.kind) < kindRank(existing.guard.spec.kind)
    ) {
      best.set(key, entry);
    }
  }

  return [...best.values()].sort((a, b) => {
    const byKind = kindRank(a.guard.spec.kind) - kindRank(b.guard.spec.kind);
    if (byKind !== 0) return byKind;
    const bySeverity = severityRank(a.guard.severity) - severityRank(b.guard.severity);
    if (bySeverity !== 0) return bySeverity;
    return b.guard.confidence - a.guard.confidence;
  });
}

/** A structural key for a spec. Two specs that check the same thing must produce the same key,
 *  including across the optional fields' defaults — `wordBoundary: true` and an absent
 *  `wordBoundary` are the same check, because the evaluator defaults it to true. */
function specKey(guard: ProposedGuard): string {
  const spec = guard.spec;

  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return (
        spec.kind +
        "\u0000" +
        spec.package +
        "\u0000" +
        String(spec.includeDev ?? spec.kind === "dependency_absent")
      );
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.kind + "\u0000" + spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return (
        spec.kind +
        "\u0000" +
        spec.pattern +
        "\u0000" +
        spec.glob +
        "\u0000" +
        String(spec.wordBoundary ?? true) +
        "\u0000" +
        String(spec.caseSensitive ?? false)
      );
    case "command_exit_zero":
      return spec.kind + "\u0000" + spec.command;
    case "llm_judge":
      return spec.kind + "\u0000" + spec.rubric + "\u0000" + spec.scopeGlobs.join(",");
  }
}

/** How much of a decision the templates cover, for the health panel. */
export function describeCoverage(variable: DecisionVariable): string {
  return hasTemplate(variable)
    ? variable + " has a specific template, plus the generic rejection / value / scope strategies."
    : variable +
        " has no specific template. The generic strategies still apply: every rejected alternative must be absent, the chosen value is checked if it looks like a package or path, and the decision's own globs must match something.";
}

export { authGuards, databaseGuards, frameworkGuards, hostingGuards, storageGuards };
export {
  genericGuards,
  globGuards,
  rejectedGuards,
  valueGuards,
  looksLikePackage,
  looksLikePath,
} from "./generic";
