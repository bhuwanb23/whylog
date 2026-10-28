/**
 * HOSTING templates — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 *
 * "HOSTING → config file + deploy manifest". A hosting decision is the one whose drift is most
 * expensive and least visible: the code keeps working locally while the deploy target quietly
 * changes, and the premises the decision rested on (no deploy infra, single region, free tier)
 * stop being true without anything in the source tree saying so.
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput, TemplateOutput } from "../types";

interface HostingRule {
  readonly value: string;
  readonly configFile: string;
  readonly packages: readonly string[];
  readonly excludes: readonly string[];
}

const RULES: readonly HostingRule[] = [
  {
    value: "vercel",
    configFile: "vercel.json",
    packages: ["vercel"],
    excludes: ["netlify-cli", "wrangler", "@railway/cli"],
  },
  {
    value: "netlify",
    configFile: "netlify.toml",
    packages: ["netlify-cli"],
    excludes: ["vercel", "wrangler"],
  },
  {
    value: "cloudflare",
    configFile: "wrangler.toml",
    packages: ["wrangler"],
    excludes: ["vercel", "netlify-cli"],
  },
  {
    value: "railway",
    configFile: "railway.json",
    packages: ["@railway/cli"],
    excludes: ["vercel", "netlify-cli"],
  },
  {
    value: "fly",
    configFile: "fly.toml",
    packages: ["@flydotio/dockerfile"],
    excludes: ["vercel", "netlify-cli"],
  },
  {
    value: "aws",
    configFile: "**/*serverless.yml",
    packages: ["aws-sdk", "@aws-sdk/client-s3"],
    excludes: [],
  },
  {
    value: "self-hosted",
    configFile: "docker-compose.yml",
    packages: [],
    excludes: ["vercel", "netlify-cli", "wrangler"],
  },
  { value: "docker", configFile: "Dockerfile", packages: [], excludes: [] },
  { value: "neon", configFile: "", packages: ["@neondatabase/serverless"], excludes: [] },
  {
    value: "local",
    configFile: "",
    packages: [],
    excludes: ["vercel", "netlify-cli", "wrangler", "@railway/cli"],
  },
  {
    value: "none",
    configFile: "",
    packages: [],
    excludes: ["vercel", "netlify-cli", "wrangler", "@railway/cli"],
  },
];

export function hostingGuards(input: TemplateInput): TemplateOutput {
  const rule = RULES.find((candidate) => candidate.value === input.value.toLowerCase());
  if (rule === undefined) return [];

  const out: ProposedGuard[] = [];

  if (rule.configFile.length > 0) {
    out.push({
      spec: { kind: "path_glob_exists", glob: rule.configFile },
      rationale:
        input.decisionId +
        " chose " +
        input.value +
        " for hosting, so a `" +
        rule.configFile +
        "` deploy manifest should exist. Hosting is the decision whose drift is most expensive and least visible: the code keeps working locally while the deploy target changes underneath it.",
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.6),
      requiresReview: false,
    });
  }

  for (const pkg of rule.packages) {
    out.push({
      spec: { kind: "dependency_present", package: pkg, includeDev: true },
      rationale:
        "`" +
        pkg +
        "` is how " +
        input.value +
        " hosting shows up in a dependency tree, and " +
        input.decisionId +
        " settled on it.",
      severity: DEFAULT_SEVERITY.dependency_present,
      generatedBy: "template",
      confidence: asConfidence(0.6),
      requiresReview: false,
    });
  }

  /* A LOCAL / no-hosting decision is the interesting case: every deploy CLI is evidence
   * against it. That is the guard which catches "we said this was a desktop app" drifting into
   * "someone added a Vercel deploy on Friday". */
  for (const excluded of rule.excludes) {
    out.push({
      spec: { kind: "dependency_absent", package: excluded, includeDev: true },
      rationale:
        input.decisionId +
        " settled hosting on " +
        input.value +
        (isUnhosted(input.value)
          ? ", which means no deploy tooling at all. `" +
            excluded +
            "` appearing would mean the project has acquired a deploy target the log does not know about — and every premise about scale, cost or single-user access that the decision rested on would need re-examining."
          : ", so `" + excluded + "` should not be present."),
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(isUnhosted(input.value) ? 0.8 : 0.6),
      requiresReview: false,
    });
  }

  for (const rejected of input.rejected) {
    const rejectedRule = RULES.find(
      (candidate) => candidate.value === rejected.value.toLowerCase(),
    );
    if (rejectedRule === undefined) continue;

    const pkg = rejectedRule.packages[0];
    if (
      pkg !== undefined &&
      !out.some((g) => g.spec.kind === "dependency_absent" && g.spec.package === pkg)
    ) {
      out.push({
        spec: { kind: "dependency_absent", package: pkg, includeDev: true },
        rationale:
          input.decisionId +
          " rejected " +
          rejected.value +
          " hosting" +
          (rejected.whyRejected === undefined ? "." : ' — "' + rejected.whyRejected + '".'),
        severity: DEFAULT_SEVERITY.dependency_absent,
        generatedBy: "template",
        confidence: asConfidence(0.75),
        requiresReview: false,
      });
    }

    if (rejectedRule.configFile.length > 0) {
      out.push({
        spec: { kind: "path_glob_absent", glob: rejectedRule.configFile },
        rationale:
          "A `" +
          rejectedRule.configFile +
          "` would mean " +
          rejected.value +
          " hosting was configured despite " +
          input.decisionId +
          " rejecting it.",
        severity: DEFAULT_SEVERITY.path_glob_absent,
        generatedBy: "template",
        confidence: asConfidence(0.6),
        requiresReview: false,
      });
    }
  }

  return out;
}

function isUnhosted(value: string): boolean {
  const folded = value.toLowerCase();
  return (
    folded === "local" || folded === "none" || folded === "self-hosted" || folded === "desktop"
  );
}
