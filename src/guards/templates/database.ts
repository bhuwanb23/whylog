/**
 * DATABASE templates — 4.2.
 *
 * Phase 4 · sub-phase 4.2
 * Docs: docs/04-executable-decision-guards.md §4.1 (the worked example is a DATABASE decision)
 *
 * The best-covered variable in the ontology, and the one the whole approach was designed
 * against: "Use SQLite, not Postgres" compiles to a driver that must be present, a driver that
 * must be absent, and a connection string that must not appear. Three checks, all deterministic,
 * none of them needing a model.
 */

import { asConfidence } from "@/types/common";
import type { ProposedGuard } from "@/types/guards";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { TemplateInput, TemplateOutput } from "../types";

interface DatabaseRule {
  /** The canonical value this rule applies to, folded lowercase. */
  readonly value: string;
  /** Packages that indicate the decision was implemented. Any one of them satisfies it, so the
   *  guard proposes the most common and names the others in the rationale. */
  readonly drivers: readonly string[];
  /** Connection-string prefixes that must NOT appear while this decision is IN. Scoped, and
   *  `warning` severity — a string is easier to match by accident than a dependency is. */
  readonly connectionStrings: readonly string[];
  /** Paths that should exist if the decision was implemented. */
  readonly artifacts: readonly string[];
  /** Values that are mutually exclusive with this one, and therefore must be absent. */
  readonly excludes: readonly string[];
}

const RULES: readonly DatabaseRule[] = [
  {
    value: "sqlite",
    drivers: ["better-sqlite3", "sql.js", "libsql", "@libsql/client", "sqlite3"],
    connectionStrings: ["postgres://", "postgresql://", "mysql://"],
    artifacts: ["src/db/schema.*", "**/*.sqlite", "**/*.db"],
    excludes: ["pg", "postgres", "postgresql", "mysql2", "mongodb", "supabase"],
  },
  {
    value: "postgres",
    drivers: ["pg", "postgres", "postgresql", "@neondatabase/serverless", "drizzle-orm"],
    connectionStrings: ["sqlite:", "file:./"],
    artifacts: ["**/migrations/**", "src/db/schema.*"],
    excludes: ["better-sqlite3", "sqlite3", "sql.js"],
  },
  {
    value: "supabase",
    drivers: ["@supabase/supabase-js"],
    connectionStrings: [],
    artifacts: ["supabase/config.toml", "supabase/migrations/**"],
    excludes: ["better-sqlite3", "sqlite3"],
  },
  {
    value: "mysql",
    drivers: ["mysql2", "mariadb"],
    connectionStrings: ["postgres://", "sqlite:"],
    artifacts: ["**/migrations/**"],
    excludes: ["pg", "better-sqlite3"],
  },
  {
    value: "mongodb",
    drivers: ["mongodb", "mongoose"],
    connectionStrings: ["postgres://", "sqlite:"],
    artifacts: [],
    excludes: ["pg", "better-sqlite3", "mysql2"],
  },
];

export function databaseGuards(input: TemplateInput): TemplateOutput {
  const rule = RULES.find((candidate) => candidate.value === input.value.toLowerCase());
  if (rule === undefined) return [];

  const out: ProposedGuard[] = [];
  const scope = scopeGlob(input);

  /* ---- 1. the driver must be present ---- */
  const driver = rule.drivers[0];
  if (driver !== undefined) {
    const alternatives = rule.drivers.slice(1);
    out.push({
      spec: { kind: "dependency_present", package: driver, includeDev: false },
      rationale:
        input.decisionId +
        " chose " +
        input.value +
        ", so a " +
        input.value +
        " driver must be in the dependency tree." +
        (alternatives.length > 0
          ? " `" +
            driver +
            "` is the usual one; " +
            alternatives.join(", ") +
            " would also satisfy the decision, and if you use one of those, edit this guard rather than suppressing it."
          : ""),
      severity: DEFAULT_SEVERITY.dependency_present,
      generatedBy: "template",
      confidence: asConfidence(0.8),
      requiresReview: false,
    });
  }

  /* ---- 2. each REJECTED alternative's driver must be absent ---- */
  for (const rejected of input.rejected) {
    const rejectedRule = RULES.find(
      (candidate) => candidate.value === rejected.value.toLowerCase(),
    );
    const rejectedDriver = rejectedRule?.drivers[0];
    if (rejectedDriver === undefined) continue;

    out.push({
      spec: { kind: "dependency_absent", package: rejectedDriver, includeDev: true },
      rationale:
        input.decisionId +
        " rejected " +
        rejected.value +
        (rejected.whyRejected === undefined ? "." : ' — "' + rejected.whyRejected + '".') +
        " No " +
        rejectedDriver +
        " driver should appear while this decision is IN. devDependencies are in scope: a rejected database installed as a dev dependency is still installed.",
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(0.85),
      requiresReview: false,
    });
  }

  /* ---- 3. the mutually exclusive packages must be absent ---- */
  for (const excluded of rule.excludes) {
    /* Skip anything already covered by a rejected-alternative guard, so one decision does not
     * get two guards for the same package and crowd out a different check under the cap. */
    if (
      out.some(
        (guard) => guard.spec.kind === "dependency_absent" && guard.spec.package === excluded,
      )
    )
      continue;

    out.push({
      spec: { kind: "dependency_absent", package: excluded, includeDev: true },
      rationale:
        "`" +
        excluded +
        "` is mutually exclusive with " +
        input.value +
        " under " +
        input.variable +
        ", which " +
        input.decisionId +
        " settled. Its presence would mean the decision has been reversed in code without being reversed in the log.",
      severity: DEFAULT_SEVERITY.dependency_absent,
      generatedBy: "template",
      confidence: asConfidence(0.7),
      requiresReview: false,
    });
  }

  /* ---- 4. no foreign connection string ---- */
  for (const needle of rule.connectionStrings) {
    out.push({
      spec: {
        kind: "string_absent_in_files",
        pattern: needle,
        glob: scope,
        wordBoundary: false,
        caseSensitive: false,
      },
      rationale:
        "No " +
        needle +
        " connection string should appear while " +
        input.decisionId +
        " (" +
        input.value +
        ") is IN. Scoped to `" +
        scope +
        "` and matched WITHOUT word boundaries, because a URL prefix has no word boundary to match — which is also why this guard is `warning`, not `blocking`.",
      severity: DEFAULT_SEVERITY.string_absent_in_files,
      generatedBy: "template",
      confidence: asConfidence(0.6),
      requiresReview: false,
    });
  }

  /* ---- 5. the artifact the decision governs should exist ---- */
  const artifact = rule.artifacts[0];
  if (artifact !== undefined) {
    out.push({
      spec: { kind: "path_glob_exists", glob: artifact },
      rationale:
        input.decisionId +
        " governs the data layer, so something matching `" +
        artifact +
        "` should exist. This is the weakest check in the set — an absent file may just mean a partial listing — which is why it is `warning` and ranked last.",
      severity: DEFAULT_SEVERITY.path_glob_exists,
      generatedBy: "template",
      confidence: asConfidence(0.45),
      requiresReview: false,
    });
  }

  return out;
}

/** The decision's own globs when it has them, otherwise a conservative default. Scoping to the
 *  decision's `applies_to` is what keeps a string guard from failing on an unrelated file. */
function scopeGlob(input: TemplateInput): string {
  const source = input.appliesTo.find((glob) => glob.includes("/"));
  return source ?? "src/**";
}
