/**
 * AUTH templates — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 *
 * "AUTH → middleware / lib present or absent". Auth is the variable where an ABSENT check is as
 * informative as a present one: a decision to roll your own means no auth vendor SDK should
 * appear, and a decision to use a vendor means the hand-rolled session code should be gone.
 *
 * Auth guards are `warning` by default rather than `blocking`, because auth libraries are
 * frequently present for reasons unrelated to the decision — a JWT decode utility, a password
 * hashing library — and a blocking guard that fires on those trains the user to dismiss the
 * panel.
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput, TemplateOutput } from "../types";

interface AuthRule {
  readonly value: string;
  readonly packages: readonly string[];
  readonly excludes: readonly string[];
  /** Middleware or route files that indicate the approach was implemented. */
  readonly artifacts: readonly string[];
}

const RULES: readonly AuthRule[] = [
  {
    value: "clerk",
    packages: ["@clerk/clerk-react", "@clerk/nextjs", "@clerk/clerk-js"],
    excludes: ["next-auth", "@auth/core", "passport", "@supabase/auth-js"],
    artifacts: ["**/middleware.*"],
  },
  {
    value: "auth0",
    packages: ["@auth0/auth0-react", "@auth0/nextjs-auth0", "auth0"],
    excludes: ["next-auth", "@clerk/clerk-react", "passport"],
    artifacts: [],
  },
  {
    value: "next-auth",
    packages: ["next-auth", "@auth/core"],
    excludes: ["@clerk/clerk-react", "@auth0/auth0-react"],
    artifacts: ["**/auth/**", "app/api/auth/**"],
  },
  {
    value: "supabase",
    packages: ["@supabase/supabase-js", "@supabase/auth-js"],
    excludes: ["@clerk/clerk-react", "next-auth"],
    artifacts: [],
  },
  {
    value: "passport",
    packages: ["passport"],
    excludes: ["@clerk/clerk-react", "next-auth"],
    artifacts: [],
  },
  {
    value: "firebase",
    packages: ["firebase", "firebase-admin"],
    excludes: ["@clerk/clerk-react", "next-auth"],
    artifacts: ["firebase.json"],
  },
  {
    value: "custom",
    packages: [],
    excludes: [
      "@clerk/clerk-react",
      "@auth0/auth0-react",
      "next-auth",
      "@auth/core",
      "passport",
      "firebase",
    ],
    artifacts: ["**/auth/**", "**/session**"],
  },
  {
    value: "none",
    packages: [],
    excludes: ["@clerk/clerk-react", "@auth0/auth0-react", "next-auth", "@auth/core", "passport"],
    artifacts: [],
  },
];

export function authGuards(input: TemplateInput): TemplateOutput {
  const rule = RULES.find((candidate) => candidate.value === input.value.toLowerCase());
  if (rule === undefined) return [];

  const out: ProposedGuard[] = [];

  for (const pkg of rule.packages) {
    out.push({
      spec: { kind: "dependency_present", package: pkg, includeDev: false },
      rationale:
        input.decisionId +
        " chose " +
        input.value +
        " for auth, so `" +
        pkg +
        "` should be present. Only the first matching package needs to be there; if you use a different binding for the same vendor, edit this guard.",
      severity: DEFAULT_SEVERITY.dependency_present,
      generatedBy: "template",
      confidence: asConfidence(0.65),
      requiresReview: false,
    });
    /* One presence guard is enough: several bindings for one vendor means several guards that
     * all fail together and crowd out the exclusion checks under the cap. */
    break;
  }

  for (const excluded of rule.excludes) {
    out.push({
      spec: { kind: "dependency_absent", package: excluded, includeDev: true },
      rationale:
        "`" +
        excluded +
        "` is a competing auth approach and " +
        input.decisionId +
        " settled on " +
        input.value +
        (input.value.toLowerCase() === "custom" || input.value.toLowerCase() === "none"
          ? ". A vendor SDK appearing alongside a hand-rolled or absent auth decision is the most common form of auth drift there is — usually a dependency added to solve one endpoint, quietly becoming the real auth system."
          : ". Two auth systems in one tree means sessions, tokens and user records can diverge."),
      /* `warning`, not the dependency default: auth libraries are commonly present for
       * unrelated reasons, and a blocking guard that fires on those gets dismissed. */
      severity: "warning",
      generatedBy: "template",
      confidence: asConfidence(0.6),
      requiresReview: false,
    });
  }

  const artifact = rule.artifacts[0];
  if (artifact !== undefined) {
    out.push({
      spec: { kind: "path_glob_exists", glob: artifact },
      rationale:
        "Something matching `" +
        artifact +
        "` should exist if " +
        input.value +
        " auth was actually wired in rather than only installed. Weakest of the three: a partial listing makes it fail against a fine codebase.",
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.4),
      requiresReview: false,
    });
  }

  return out;
}
