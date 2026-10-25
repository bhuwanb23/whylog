/**
 * Generic templates — 4.2. The catch-all, and the reason coverage is not five variables deep.
 *
 * Phase 4 · sub-phase 4.2
 *
 * ---------------------------------------------------------------------------
 * THREE STRATEGIES THAT WORK FOR ANY VARIABLE
 *
 * Most of the ontology's 14 slots have no specific template: TESTING, UI_KIT, PAYMENTS,
 * RETRIEVAL, ARCHITECTURE, SCOPE, LANGUAGE, API_STYLE, STATE, and OTHER. Rather than mark all
 * of them `unverifiable`, three variable-agnostic strategies apply:
 *
 *   generic-value      the chosen value, as a dependency or a path, must be present
 *   generic-rejected   every rejected alternative must be ABSENT
 *   generic-glob       the decision's own `applies_to` globs must match something
 *
 * `generic-rejected` is the strongest of the three and needs no knowledge of the variable at
 * all: whatever you decided, the thing you turned down should not have appeared in the tree
 * since. That single strategy is what makes "we chose X, not Y" verifiable across the whole
 * ontology rather than across five slots.
 *
 * ---------------------------------------------------------------------------
 * CONFIDENCE IS LOWER, AND SAYS SO
 *
 * A generic guard is a guess about what the decision means in code, where a variable-specific
 * template is a rule someone wrote down. Its confidence is lower, its rationale says it was
 * derived generically, and `requiresReview` is TRUE for the value-based ones — because
 * "the value must be present as a dependency" is wrong often enough that installing it
 * unreviewed would produce exactly the day-one failure §4.2 warns about.
 *
 * The rejection-based ones do NOT require review: "you rejected Y, so Y should be absent" is
 * true regardless of what Y is, and it is the rare generic rule that is as sound as a specific
 * one.
 * ---------------------------------------------------------------------------
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import { isGlob } from "@/lib/glob";
import type { TemplateInput, TemplateOutput } from "../types";

/** A value that looks like an npm package name: lowercase, possibly scoped, hyphenated. */
export function looksLikePackage(value: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(value);
}

/** A value that looks like a filename or path fragment. */
export function looksLikePath(value: string): boolean {
  return value.includes("/") || /\.[a-z]{1,5}$/i.test(value);
}

export function genericGuards(input: TemplateInput): TemplateOutput {
  const out: ProposedGuard[] = [];

  out.push(...rejectedGuards(input));
  out.push(...valueGuards(input));
  out.push(...globGuards(input));

  return out;
}

/**
 * Every rejected alternative must be absent.
 *
 * The most transferable rule in the synthesiser: it needs no variable-specific knowledge, it is
 * sound whatever the value is, and it catches the most common drift — installing the thing you
 * turned down.
 */
export function rejectedGuards(input: TemplateInput): TemplateOutput {
  const out: ProposedGuard[] = [];

  for (const rejected of input.rejected) {
    const value = rejected.value.trim();
    if (value.length === 0) continue;

    if (looksLikePackage(value)) {
      out.push({
        spec: { kind: "dependency_absent", package: value, includeDev: true },
        rationale:
          input.decisionId + " rejected " + value +
          (rejected.whyRejected === undefined ? "." : ' — "' + rejected.whyRejected + '".') +
          " Derived generically: whatever the variable, a rejected alternative should not have appeared in the dependency tree since. devDependencies are in scope, because a rejected package installed for tooling is still installed.",
        severity: DEFAULT_SEVERITY.dependency_absent,
        generatedBy: "template",
        confidence: asConfidence(0.75),
        /* Not flagged for review. This rule is sound for any variable, and requiring review on
         * the one generic strategy that never guesses would bury it under the ones that do. */
        requiresReview: false,
      });
      continue;
    }

    if (looksLikePath(value)) {
      out.push({
        spec: { kind: "path_glob_absent", glob: "**/" + value.replace(/^\/+/, "") + "*" },
        rationale:
          input.decisionId + " rejected " + value + ", which looks like a path, so nothing matching it should exist. Derived generically from the shape of the value rather than from the variable.",
        severity: DEFAULT_SEVERITY.path_glob_absent,
        generatedBy: "template",
        confidence: asConfidence(0.45),
        requiresReview: true,
      });
      continue;
    }

    /* Neither a package nor a path: the only deterministic thing left to check is that the name
     * does not appear in the files the decision governs. Low confidence and `warning` — a
     * rejected technology's name in a comment ("we considered Redis") is not drift, and this
     * guard cannot tell that from a real import. */
    out.push({
      spec: {
        kind: "string_absent_in_files",
        pattern: value,
        glob: input.appliesTo.find((glob) => glob.includes("/")) ?? "src/**",
        wordBoundary: true,
        caseSensitive: false,
      },
      rationale:
        input.decisionId + " rejected " + value +
        (rejected.whyRejected === undefined ? "" : ' ("' + rejected.whyRejected + '")') +
        ". `" + value + "` is neither a package name nor a path, so the only deterministic check available is that it does not appear in the files this decision governs. WEAK BY NATURE: a comment saying \"we considered " + value +
        "\" is not drift, and this guard cannot tell that from an import. Review it before accepting.",
      severity: "warning",
      generatedBy: "template",
      confidence: asConfidence(0.3),
      requiresReview: true,
    });
  }

  return out;
}

/**
 * The chosen value, as a dependency or a path.
 *
 * Flagged `requiresReview` because it is a guess about what the decision means in code. "Use
 * Tailwind" means a `tailwindcss` dependency; "use a hexagonal architecture" means nothing
 * checkable at all, and proposing a dependency guard for it would be proposing noise.
 */
export function valueGuards(input: TemplateInput): TemplateOutput {
  const value = input.value.trim();
  if (value.length === 0) return [];

  if (looksLikePackage(value)) {
    return [
      {
        spec: { kind: "dependency_present", package: value, includeDev: true },
        rationale:
          input.decisionId + " settled " + input.variable + " on " + value +
          ", which looks like a package name, so it should be present. Derived generically from the shape of the value: confirm the decision really is implemented by this package before accepting.",
        severity: "warning",
        generatedBy: "template",
        confidence: asConfidence(0.5),
        requiresReview: true,
      },
    ];
  }

  if (looksLikePath(value)) {
    return [
      {
        spec: { kind: "path_glob_exists", glob: "**/" + value.replace(/^\/+/, "") },
        rationale:
          input.decisionId + " settled " + input.variable + " on " + value +
          ", which looks like a path, so it should exist. Derived generically; review before accepting.",
        severity: "warning",
        generatedBy: "template",
        confidence: asConfidence(0.4),
        requiresReview: true,
      },
    ];
  }

  return [];
}

/**
 * The decision's own `applies_to` globs should match something.
 *
 * A decision that governs `src/db/**` in a project with no `src/db/` has either drifted or was
 * recorded against a tree that no longer exists. Either is worth surfacing, and neither is
 * specific to a variable.
 */
export function globGuards(input: TemplateInput): TemplateOutput {
  const out: ProposedGuard[] = [];

  for (const glob of input.appliesTo) {
    if (!isGlob(glob)) continue;
    /* package.json is a file, not a scope, and it is checked by the dependency guards already. */
    if (glob === "package.json") continue;

    out.push({
      spec: { kind: "path_glob_exists", glob },
      rationale:
        input.decisionId + " declares that it governs `" + glob +
        "`, so something matching it should exist. If nothing does, either the decision has drifted or it was recorded against a tree that no longer exists — both worth knowing, and neither is specific to " +
        input.variable + ".",
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.55),
      requiresReview: false,
    });
  }

  return out;
}
