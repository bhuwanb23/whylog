/**
 * Export contracts — the compiler from decision graph to agent-readable files.
 *
 * Phase 5 · sub-phases 5.1-5.7
 * Plan:     plan/phase-5-export-compiler.md
 * Research: docs/01-prior-art-landscape.md §4.5 (the agent-optimized ADR spec)
 *           docs/04-executable-decision-guards.md §5.3
 */

import type { DecisionId, ExportId, ISODateString, PremiseId } from "./common";
import type { DecisionLabel } from "./domain";

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Five targets, all compiled from ONE canonical intermediate form in ONE pass.
 *
 * The ADR set is the system of record; these are DELIVERY FORMATS. Implementing
 * that literally is what stops the five formats from drifting apart.
 */
export type ExportTarget = "claude-md" | "agents-md" | "cursorrules" | "decisions-md" | "ci-guards";

export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "claude-md",
  "agents-md",
  "cursorrules",
  "decisions-md",
  "ci-guards",
] as const;

export const TARGET_FILENAMES: Readonly<Record<ExportTarget, string>> = {
  "claude-md": "CLAUDE.md",
  "agents-md": "AGENTS.md",
  cursorrules: ".cursorrules",
  "decisions-md": "DECISIONS.md",
  "ci-guards": "scripts/whylog-guards.cjs",
};

/* -------------------------------------------------------------------------- */
/* The canonical intermediate form                                            */
/* -------------------------------------------------------------------------- */

/**
 * One normalised, target-agnostic representation. Emitters are PURE FUNCTIONS
 * of this — they never read the graph directly.
 */
export interface ExportCif {
  readonly generatedAt: ISODateString;
  readonly headHash: string;
  readonly records: readonly ExportRecord[];
  readonly rejected: readonly RejectedBlockEntry[];
  readonly index: readonly IndexEntry[];
  readonly stats: ExportStats;
}

/**
 * The agent-optimized record.
 *
 * Six properties, from the published spec: scoped to file globs, imperative not
 * prose, verifiable, token-aware, non-conflicting, addressable. WhyLog satisfies
 * "verifiable" and "non-conflicting" automatically — the two no ADR tool
 * delivers, because both require a reasoning layer.
 */
export interface ExportRecord {
  /** Stable, addressable, never renumbered: WLD-0007 */
  readonly id: DecisionId;
  /** Imperative form: "MUST use SQLite (better-sqlite3). MUST NOT introduce
   *  Postgres." Normative keywords beat a paragraph an agent must summarise. */
  readonly imperative: string;
  /** File globs this record governs. An agent editing a stylesheet has no use
   *  for the database record, so loading it only burns context. */
  readonly appliesTo: readonly string[];
  /** The premise IDs, not prose — so a reader can see WHAT WOULD HAVE TO CHANGE
   *  for this rule to stop applying. */
  readonly becausePremiseIds: readonly PremiseId[];
  readonly becauseText: string;
  readonly rejected: readonly { value: string; why?: string }[];
  /** Generated from Phase 4 guards. Absent when the decision is unverifiable. */
  readonly verifyCommand?: string;
  readonly status: DecisionLabel;
  readonly guardsPassing: number;
  readonly guardsTotal: number;
  readonly lastVerifiedAt?: ISODateString;
  /** True when a premise in `becausePremiseIds` is contested. Annotated inline
   *  rather than hidden. */
  readonly contestedPremise: boolean;
  /** True when a guard on this decision currently fails. Annotated inline. */
  readonly failingGuard: boolean;
  readonly tier: "inline" | "index";
  readonly priority: number;
}

/**
 * The highest-value block in the exported file, and the one no competitor emits
 * — because none of them index rejected alternatives first-class.
 */
export interface RejectedBlockEntry {
  readonly value: string;
  readonly decisionId: DecisionId;
  readonly why: string;
  readonly premiseStatus: string;
  readonly contested: boolean;
}

/** Tier-2 one-liner for decisions that fell outside the token budget. */
export interface IndexEntry {
  readonly id: DecisionId;
  readonly imperative: string;
  readonly appliesTo: readonly string[];
  readonly seeAlso: string;
}

export interface ExportStats {
  readonly decisionsIncluded: number;
  readonly decisionsLinkedOut: number;
  readonly decisionsExcluded: number;
  readonly lineCount: number;
  readonly estimatedTokens: number;
  readonly compliance: number;
  readonly verifiableCoverage: number;
}

/* -------------------------------------------------------------------------- */
/* Budgeting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Anthropic's guidance is ~200 lines per context file, because "longer files
 * consume more context and reduce adherence".
 *
 * priority(d) = 0.35 · soundness + 0.25 · entrenchment + 0.20 · scope breadth
 *             + 0.15 · guard severity + 0.05 · recency
 *
 * Tier 1 goes inline; tier 2 becomes a one-line index entry. SUPERSEDED and OUT
 * decisions are EXCLUDED by default — a file containing a reversed rule
 * alongside its replacement is exactly the "model may pick one arbitrarily"
 * failure.
 */
export interface ExportBudget {
  readonly maxLines: number;
  readonly inlineCount: number;
  readonly indexCount: number;
  readonly excludedCount: number;
  readonly overBudget: boolean;
}

export const DEFAULT_EXPORT_BUDGET_LINES = 200;

export const EXPORT_PRIORITY_WEIGHTS = Object.freeze({
  soundness: 0.35,
  entrenchment: 0.25,
  scopeBreadth: 0.2,
  guardSeverity: 0.15,
  recency: 0.05,
} as const);

/* -------------------------------------------------------------------------- */
/* Consistency gate                                                           */
/* -------------------------------------------------------------------------- */

/**
 * "A human reconciles contradictions on the fly. An agent needs them reconciled
 * in advance."
 *
 * This is the only place in the product where the truth-maintenance layer
 * directly prevents a bad outcome in the agent's context window — and it is why
 * the two pillars visibly interlock.
 *
 * A blocked export shows the conflicting pair, the nogood, and a link to the
 * revision proposal. NEVER silently drop one side.
 */
export type ConsistencyGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly blocking: readonly ConflictPair[];
      readonly warnings: readonly ExportWarning[];
    };

export interface ConflictPair {
  readonly a: DecisionId;
  readonly b: DecisionId;
  readonly explanation: string;
}

export type ExportWarning =
  | { readonly kind: "out-decision-excluded"; readonly decisionId: DecisionId }
  | {
      readonly kind: "contested-premise";
      readonly decisionId: DecisionId;
      readonly premiseId: PremiseId;
    }
  | { readonly kind: "failing-guard"; readonly decisionId: DecisionId }
  | { readonly kind: "over-budget"; readonly dropped: number };

/* -------------------------------------------------------------------------- */
/* Integrity stamp                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Auditability, not security. You are handing this file to an agent that can
 * rewrite files; the requirement is to be able to say "this artifact corresponds
 * to log head a3f91c..." and later detect that it no longer does.
 */
export interface IntegrityStamp {
  readonly headHash: string;
  readonly generatedAt: ISODateString;
  readonly schemaVersion: number;
  readonly decisions: {
    readonly total: number;
    readonly inLabel: number;
    readonly out: number;
    readonly superseded: number;
  };
  readonly premises: {
    readonly total: number;
    readonly inLabel: number;
    readonly out: number;
    readonly contested: number;
  };
  readonly compliance: number;
  readonly verifiableCoverage: number;
  readonly guards: { readonly passing: number; readonly failing: number };
  readonly engineAtGeneration: string;
}

export type StampVerification =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "head-mismatch"
        | "digest-mismatch"
        | "missing-stamp"
        | "schema-incompatible";
      readonly expected?: string;
      readonly found?: string;
    };

/* -------------------------------------------------------------------------- */
/* Compiled artifact                                                          */
/* -------------------------------------------------------------------------- */

export interface CompiledArtifact {
  readonly exportId: ExportId;
  readonly target: ExportTarget;
  readonly filename: string;
  readonly contents: string;
  readonly stamp: IntegrityStamp;
  readonly budget: ExportBudget;
  readonly warnings: readonly ExportWarning[];
}
