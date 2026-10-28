/**
 * FRAMEWORK templates — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 *
 * A framework decision compiles to a build-config artifact plus a dependency, which is the
 * pattern the plan's diagram names: "FRAMEWORK → build config + dependency". The config file is
 * the stronger signal of the two — plenty of projects carry a framework dependency they do not
 * build with — but the dependency is the more reliable check, so both are proposed and the cap
 * keeps whichever ranks higher.
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput, TemplateOutput } from "../types";

interface FrameworkRule {
  readonly value: string;
  readonly packages: readonly string[];
  /** The build config whose presence proves the framework is actually in use. */
  readonly configFile: string;
  readonly excludes: readonly string[];
}

const RULES: readonly FrameworkRule[] = [
  {
    value: "vite",
    packages: ["vite"],
    configFile: "vite.config.*",
    excludes: ["next", "@remix-run/node", "nuxt"],
  },
  {
    value: "next",
    packages: ["next", "react", "react-dom"],
    configFile: "next.config.*",
    excludes: ["vite", "nuxt"],
  },
  {
    value: "remix",
    packages: ["@remix-run/node", "@remix-run/react"],
    configFile: "remix.config.*",
    excludes: ["next", "vite"],
  },
  { value: "nuxt", packages: ["nuxt"], configFile: "nuxt.config.*", excludes: ["next", "vite"] },
  {
    value: "svelte",
    packages: ["svelte", "@sveltejs/kit"],
    configFile: "svelte.config.*",
    excludes: ["react", "vue"],
  },
  { value: "vue", packages: ["vue"], configFile: "vite.config.*", excludes: ["react", "svelte"] },
  {
    value: "react",
    packages: ["react", "react-dom"],
    configFile: "",
    excludes: ["vue", "svelte", "@angular/core"],
  },
  {
    value: "angular",
    packages: ["@angular/core"],
    configFile: "angular.json",
    excludes: ["react", "vue"],
  },
  { value: "astro", packages: ["astro"], configFile: "astro.config.*", excludes: ["next", "nuxt"] },
];

export function frameworkGuards(input: TemplateInput): TemplateOutput {
  const rule = RULES.find((candidate) => candidate.value === input.value.toLowerCase());
  if (rule === undefined) return [];

  const out: ProposedGuard[] = [];
  const primary = rule.packages[0];

  if (primary !== undefined) {
    out.push({
      spec: { kind: "dependency_present", package: primary, includeDev: true },
      rationale:
        input.decisionId +
        " chose " +
        input.value +
        ", so `" +
        primary +
        "` must be present. devDependencies are in scope here — unlike a database driver, a build tool is legitimately a dev dependency.",
      severity: DEFAULT_SEVERITY.dependency_present,
      generatedBy: "template",
      confidence: asConfidence(0.8),
      requiresReview: false,
    });
  }

  if (rule.configFile.length > 0) {
    out.push({
      spec: { kind: "path_glob_exists", glob: rule.configFile },
      rationale:
        "A `" +
        rule.configFile +
        "` should exist if " +
        input.value +
        " is really the build system. This is the stronger signal of the two — a project can carry a framework dependency it never builds with — but it is `warning` severity, because a partial file listing makes it fail against a perfectly fine codebase.",
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.6),
      requiresReview: false,
    });
  }

  for (const excluded of rule.excludes) {
    out.push({
      spec: { kind: "dependency_absent", package: excluded, includeDev: true },
      rationale:
        "`" +
        excluded +
        "` is a competing " +
        input.variable.toLowerCase() +
        " and " +
        input.decisionId +
        " settled on " +
        input.value +
        ". Two frameworks in one dependency tree usually means a migration that was started and not finished — which is exactly the drift this guard exists to surface.",
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(0.65),
      requiresReview: false,
    });
  }

  for (const rejected of input.rejected) {
    const rejectedRule = RULES.find(
      (candidate) => candidate.value === rejected.value.toLowerCase(),
    );
    const pkg = rejectedRule?.packages[0];
    if (pkg === undefined) continue;
    if (out.some((guard) => guard.spec.kind === "dependency_absent" && guard.spec.package === pkg))
      continue;

    out.push({
      spec: { kind: "dependency_absent", package: pkg, includeDev: true },
      rationale:
        input.decisionId +
        " rejected " +
        rejected.value +
        (rejected.whyRejected === undefined ? "." : ' — "' + rejected.whyRejected + '".') +
        " `" +
        pkg +
        "` should not appear while that rejection stands.",
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(0.8),
      requiresReview: false,
    });
  }

  return out;
}
