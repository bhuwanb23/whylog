/**
 * Excluded conditions ΓÇö the OUT-list vocabulary.
 *
 * Phase 1 ┬╖ sub-phase 1.4 (data authored in Phase 0.7's style)
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.4
 *
 * ---------------------------------------------------------------------------
 * WHY AN OUT-LIST EXISTS AT ALL
 *
 * "Use SQLite" is justified by `IN: [single_user, no_deploy_infrastructure]` **and**
 * `OUT: [concurrent_writers]`. A justification with a non-empty OUT-list is Doyle's
 * NON-MONOTONIC justification, and it is the only mechanism in the system that
 * detects invalidation when the user never states a contradiction:
 *
 *   nothing contradicts you ΓÇö the world just moved.
 *
 * That is gate (c), and gate (c) is the differentiator. Gate (a) fires when YOU
 * contradict yourself; gate (c) fires when reality does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DATA AND NOT DERIVED
 *
 * The mechanical alternative is to negate the premise: `scale.single_user = true`
 * becomes an OUT-list entry `scale.single_user = false`. That is correct logic and
 * unreadable English, and the OUT-list is displayed to the user in the decision
 * card's "EXCLUDES" row. "not single user" is not a sentence a person would write
 * down; "the app needs concurrent writers" is.
 *
 * So each entry pairs a predicate with the condition that would BREAK it, in words.
 * Predicates with no entry fall back to the mechanical negation in
 * `src/extraction/premise-linker.ts` ΓÇö the fallback is honest, just less readable.
 *
 * ---------------------------------------------------------------------------
 * EVERY `breaks` PREDICATE MUST BE A REAL PREDICATE IN THE TYPE TABLE
 *
 * `validateExclusions()` checks this, and `validateOntology()` calls it. An OUT-list
 * node whose predicate is not in `premise-types.ts` cannot be resolved by rung 1 of
 * the identity ladder, so it would create a fresh node on every import ΓÇö the exact
 * failure the closed vocabulary exists to prevent.
 * ---------------------------------------------------------------------------
 */

import type { PremiseType } from "@/types/domain";
import { PREMISE_TYPE_META } from "./premise-types";

export interface ExclusionRule {
  /** The predicate a SUPPORTING premise carries. */
  readonly whenPredicate: string;
  /** The condition that would break it ΓÇö the OUT-list entry's predicate. */
  readonly breaksPredicate: string;
  /** Its type, so the ladder can pool correctly. Cross-type premise comparison is
   *  forbidden, and an OUT-list node in the wrong pool is unreachable. */
  readonly breaksType: PremiseType;
  /** What the OUT-list node says, in words. Shown verbatim in the decision card. */
  readonly text: string;
  /** The value the broken condition carries. A count premise breaks at a count;
   *  a boolean breaks by flipping. */
  readonly breaksValue?: string | number | boolean;
  /** Why these two cannot both hold. Shown when gate (c) fires, so the user is
   *  told the RULE rather than shown a similarity score. */
  readonly why: string;
}

export const EXCLUSIONS: readonly ExclusionRule[] = [
  /* ===================== scale ===================== */
  {
    whenPredicate: "scale.single_user",
    breaksPredicate: "scale.concurrent_writers",
    breaksType: "scale",
    text: "the app needs concurrent writers",
    breaksValue: 2,
    why: "A single-user store assumes one writer at a time. Concurrent writers need locking, and an embedded file database has no server to arbitrate them.",
  },
  {
    whenPredicate: "scale.single_user",
    breaksPredicate: "scale.multi_tenant",
    breaksType: "scale",
    text: "the app becomes multi-tenant",
    breaksValue: true,
    why: "Tenant isolation is a server-side concern; a single local file cannot partition by tenant without the application doing it by hand.",
  },
  {
    whenPredicate: "scale.max_users",
    breaksPredicate: "scale.max_users",
    breaksType: "scale",
    text: "the user count grows past what was assumed",
    why: "A premise about how many users there are is a premise about a number; when the number moves, the premise moves with it.",
  },
  {
    whenPredicate: "scale.max_records",
    breaksPredicate: "scale.max_records",
    breaksType: "scale",
    text: "the record count grows past what was assumed",
    why: "Same shape as max_users: a counted premise is falsified by counting.",
  },
  {
    whenPredicate: "scale.concurrent_writers",
    breaksPredicate: "scale.concurrent_writers",
    breaksType: "scale",
    text: "more than one process needs to write at once",
    breaksValue: 2,
    why: "The premise states a writer count; exceeding it is the falsification.",
  },

  /* ===================== deployment ===================== */
  {
    whenPredicate: "deployment.local_only",
    breaksPredicate: "deployment.model",
    breaksType: "deployment",
    text: "the app gets deployed somewhere other than a local machine",
    breaksValue: "hosted",
    why: "A local-only deployment means no shared filesystem and no network access to the store. Deploying changes both.",
  },
  {
    whenPredicate: "deployment.has_infra",
    breaksPredicate: "deployment.has_infra",
    breaksType: "deployment",
    text: "infrastructure becomes available or required",
    breaksValue: true,
    why: "The decision avoided a dependency because there was nowhere to put it. Somewhere to put it removes the reason, though not the trade-off.",
  },
  {
    whenPredicate: "deployment.local_only",
    breaksPredicate: "deployment.regions",
    breaksType: "deployment",
    text: "the app runs in more than one region",
    breaksValue: 2,
    why: "A file-backed store on one machine is a database; the same file in two regions is two databases that will disagree.",
  },

  /* ===================== team ===================== */
  {
    whenPredicate: "team.solo",
    breaksPredicate: "team.size",
    breaksType: "team",
    text: "somebody else joins the project",
    breaksValue: 2,
    why: "A solo premise justifies skipping coordination machinery ΓÇö review, migrations discipline, access control. A second person makes each of those a real requirement.",
  },
  {
    whenPredicate: "team.expertise",
    breaksPredicate: "team.expertise",
    breaksType: "team",
    text: "the team's familiarity with the technology changes",
    why: "Expertise is the premise behind every 'we already know X' decision, and it changes when people do.",
  },

  /* ===================== budget ===================== */
  {
    whenPredicate: "budget.free_tier_only",
    breaksPredicate: "budget.monthly_usd",
    breaksType: "budget",
    text: "a paid service becomes affordable",
    breaksValue: 25,
    why: "A zero-budget premise rules out managed services on cost alone. A budget removes the rule, not the trade-off.",
  },
  {
    whenPredicate: "budget.monthly_usd",
    breaksPredicate: "budget.monthly_usd",
    breaksType: "budget",
    text: "the monthly budget changes",
    why: "A number premise is falsified by the number moving.",
  },

  /* ===================== capability ===================== */
  {
    whenPredicate: "capability.lacks",
    breaksPredicate: "capability.supports",
    breaksType: "capability",
    text: "the capability the project lacked becomes supported",
    why: "'We can't do X, so we chose Y' is falsified the moment X becomes possible ΓÇö and this is the premise type a repo scan can actually check.",
  },
  {
    whenPredicate: "capability.offline_required",
    breaksPredicate: "capability.offline_required",
    breaksType: "capability",
    text: "offline operation stops being a requirement",
    breaksValue: false,
    why: "An offline requirement rules out every networked service. Drop the requirement and the whole class comes back.",
  },

  /* ===================== requirement ===================== */
  {
    whenPredicate: "requirement.must",
    breaksPredicate: "requirement.must",
    breaksType: "requirement",
    text: "a stated requirement is dropped or changed",
    why: "A requirement premise is intent-based: only a human can retract it, and only a human can say it changed.",
  },
  {
    whenPredicate: "requirement.must_not",
    breaksPredicate: "requirement.must",
    breaksType: "requirement",
    text: "something that was forbidden becomes required",
    why: "A must-not premise rules out a whole class of solution. When the prohibition is lifted the class comes back, and the decision that avoided it loses its reason.",
  },
  {
    whenPredicate: "requirement.no_network",
    breaksPredicate: "requirement.no_network",
    breaksType: "requirement",
    text: "network access stops being forbidden",
    breaksValue: false,
    why: "An offline requirement rules out every networked service. Drop the requirement and the whole class comes back.",
  },

  /* ===================== time ===================== */
  {
    whenPredicate: "time.deadline",
    breaksPredicate: "time.deadline",
    breaksType: "time",
    text: "the deadline moves",
    why: "A deadline premise justifies shortcuts. A moved deadline un-justifies them, and the shortcut becomes debt with no reason attached.",
  },

  /* ===================== external ===================== */
  {
    whenPredicate: "external.provider_lacks",
    breaksPredicate: "external.provider_offers",
    breaksType: "external",
    text: "the external provider starts offering what it lacked",
    why: "An external premise is the one type the project has no control over, which is why it is world-observable and guard-eligible.",
  },
  {
    whenPredicate: "external.licence",
    breaksPredicate: "external.licence",
    breaksType: "external",
    text: "a dependency's licence changes",
    why: "A licence premise is checked by reading the licence, which is exactly what a guard can do.",
  },
];

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

const BY_PREDICATE: ReadonlyMap<string, readonly ExclusionRule[]> = indexByPredicate();

function indexByPredicate(): ReadonlyMap<string, readonly ExclusionRule[]> {
  const index = new Map<string, ExclusionRule[]>();
  for (const rule of EXCLUSIONS) {
    const existing = index.get(rule.whenPredicate);
    if (existing === undefined) index.set(rule.whenPredicate, [rule]);
    else existing.push(rule);
  }
  return index;
}

/** What would break this predicate. May be several: `scale.single_user` is broken
 *  by concurrent writers AND by multi-tenancy. */
export function exclusionsFor(predicate: string): readonly ExclusionRule[] {
  return BY_PREDICATE.get(predicate) ?? [];
}

/** The first rule, for callers that want one OUT-list entry per premise. */
export function primaryExclusion(predicate: string): ExclusionRule | null {
  return exclusionsFor(predicate)[0] ?? null;
}

/** Is this predicate covered by the table? An uncovered one falls back to the
 *  mechanical negation, and the coverage rate is worth reporting: a low rate means
 *  the OUT-list is mostly unreadable English. */
export function hasExclusion(predicate: string): boolean {
  return BY_PREDICATE.has(predicate);
}

export function exclusionCount(): number {
  return EXCLUSIONS.length;
}

/** How many distinct predicates have a curated exclusion. */
export function exclusionCoverage(): number {
  return BY_PREDICATE.size;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every predicate named in this table must exist in `premise-types.ts`.
 *
 * Called by `validateOntology()`. Without it a typo here produces an OUT-list node
 * whose predicate the identity ladder cannot resolve, which means a fresh node on
 * every import ΓÇö invisible until the graph fills with duplicates.
 */
export function validateExclusions(): readonly string[] {
  const problems: string[] = [];

  const known = new Set<string>();
  for (const meta of Object.values(PREMISE_TYPE_META)) {
    for (const predicate of meta.predicates) {
      known.add(`${meta.namespace}.${predicate.name}`);
    }
  }

  for (const rule of EXCLUSIONS) {
    if (!known.has(rule.whenPredicate)) {
      problems.push(`exclusions.ts: whenPredicate "${rule.whenPredicate}" is not a declared predicate`);
    }
    if (!known.has(rule.breaksPredicate)) {
      problems.push(`exclusions.ts: breaksPredicate "${rule.breaksPredicate}" is not a declared predicate`);
    }

    const meta = PREMISE_TYPE_META[rule.breaksType];
    if (meta !== undefined && !rule.breaksPredicate.startsWith(`${meta.namespace}.`)) {
      problems.push(
        `exclusions.ts: "${rule.breaksPredicate}" is typed ${rule.breaksType} but its namespace is not "${meta.namespace}"`,
      );
    }
    if (rule.text.trim().length === 0) {
      problems.push(`exclusions.ts: ${rule.whenPredicate} has an empty exclusion text`);
    }
  }

  return problems;
}
