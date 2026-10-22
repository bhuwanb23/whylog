/**
 * STORAGE templates — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 * Plan: plan/phase-4-executable-guards.md §4.2 ("STORAGE → artifact present")
 *
 * Not one of the five template files STRUCTURE.md §9 lists — §18.4 records the addition. The
 * plan's own synthesis diagram names STORAGE as a fifth variable with its own rule, and folding
 * it into `generic.ts` would have buried a real rule inside the catch-all, where nobody reading
 * the generic template would think to look for it.
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput, TemplateOutput } from "../types";

interface StorageRule {
  readonly value: string;
  readonly packages: readonly string[];
  readonly artifacts: readonly string[];
  readonly excludes: readonly string[];
  /** Patterns that must not appear — typically the local-only path a cloud decision replaced,
   *  or the cloud endpoint a local-only decision forbids. */
  readonly forbiddenStrings: readonly string[];
}

const RULES: readonly StorageRule[] = [
  {
    value: "local",
    packages: [],
    artifacts: ["**/*.sqlite", "**/*.db", "data/**"],
    excludes: [
      "@aws-sdk/client-s3",
      "@supabase/supabase-js",
      "@azure/storage-blob",
      "@google-cloud/storage",
    ],
    forbiddenStrings: ["s3.amazonaws.com", "storage.googleapis.com", "blob.core.windows.net"],
  },
  {
    value: "filesystem",
    packages: [],
    artifacts: ["uploads/**", "data/**", "storage/**"],
    excludes: ["@aws-sdk/client-s3", "@supabase/supabase-js"],
    forbiddenStrings: ["s3.amazonaws.com"],
  },
  {
    value: "s3",
    packages: ["@aws-sdk/client-s3", "aws-sdk"],
    artifacts: [],
    excludes: ["@supabase/supabase-js", "@azure/storage-blob"],
    forbiddenStrings: [],
  },
  {
    value: "supabase",
    packages: ["@supabase/supabase-js"],
    artifacts: ["supabase/config.toml"],
    excludes: ["@aws-sdk/client-s3"],
    forbiddenStrings: [],
  },
  {
    value: "r2",
    packages: ["@cloudflare/r2"],
    artifacts: ["wrangler.toml"],
    excludes: ["@aws-sdk/client-s3"],
    forbiddenStrings: [],
  },
  {
    value: "indexeddb",
    packages: ["idb", "dexie", "localforage"],
    artifacts: [],
    excludes: ["@aws-sdk/client-s3"],
    forbiddenStrings: ["s3.amazonaws.com"],
  },
];

export function storageGuards(input: TemplateInput): TemplateOutput {
  const rule = RULES.find((candidate) => candidate.value === input.value.toLowerCase());
  if (rule === undefined) return [];

  const out: ProposedGuard[] = [];
  const scope = input.appliesTo.find((glob) => glob.includes("/")) ?? "src/**";

  const pkg = rule.packages[0];
  if (pkg !== undefined) {
    out.push({
      spec: { kind: "dependency_present", package: pkg, includeDev: false },
      rationale: `${input.decisionId} chose ${input.value} for storage, so \`${pkg}\` should be in the dependency tree.`,
      severity: DEFAULT_SEVERITY.dependency_present,
      generatedBy: "template",
      confidence: asConfidence(0.7),
      requiresReview: false,
    });
  }

  for (const excluded of rule.excludes) {
    out.push({
      spec: { kind: "dependency_absent", package: excluded, includeDev: true },
      rationale: `\`${excluded}\` is a competing storage backend and ${input.decisionId} settled on ${input.value}. Storage decisions drift by accretion: one upload path added for a single feature becomes a second backend with its own consistency story.`,
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(0.65),
      requiresReview: false,
    });
  }

  for (const needle of rule.forbiddenStrings) {
    out.push({
      spec: {
        kind: "string_absent_in_files",
        pattern: needle,
        glob: scope,
        wordBoundary: false,
        caseSensitive: false,
      },
      rationale: `No \`${needle}\` endpoint should appear while ${input.decisionId} (${input.value}) is IN. Scoped to \`${scope}\` and \`warning\` severity: a hostname can appear in a comment or a test fixture without the decision having drifted.`,
      severity: DEFAULT_SEVERITY.string_absent_in_files,
      generatedBy: "template",
      confidence: asConfidence(0.5),
      requiresReview: false,
    });
  }

  const artifact = rule.artifacts[0];
  if (artifact !== undefined) {
    out.push({
      spec: { kind: "path_glob_exists", glob: artifact },
      rationale: `Something matching \`${artifact}\` should exist if ${input.value} storage is really in use. Weakest check in the set — an absent file may just mean a partial listing.`,
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.4),
      requiresReview: false,
    });
  }

  return out;
}
