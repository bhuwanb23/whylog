/**
 * The closed set of 8 premise types.
 *
 * Phase 0 ┬╖ sub-phase 0.7 ┬╖ table B
 * Plan: plan/phase-0-foundation.md ┬º0.7 ┬╖ docs/05 ┬º2.1 (RAAM's precision problem)
 *
 * ---------------------------------------------------------------------------
 * BOUNDED RECOVERY BEATS OPEN-ENDED RECOVERY
 *
 * RAAM's own failure mode is unbounded assumption discovery: given "find the
 * premises", a model returns an unreviewable list of vague conditions, and
 * precision collapses. Eight typed slots with declared predicate namespaces turn
 * the task into classification, which is both more accurate and ΓÇö critically ΓÇö
 * REVIEWABLE, because a human can see at a glance that "we shipped fast" was
 * filed under `scale` and correct it in one click.
 *
 * Do not add a ninth type casually. Every new type dilutes the classifier and
 * every existing fixture's expected output changes.
 *
 * ---------------------------------------------------------------------------
 * THE FLAG THAT DRIVES EVERYTHING DOWNSTREAM
 *
 *   WORLD-OBSERVABLE  {scale, deployment, capability, external}
 *   INTENT-BASED      {team, budget, time, requirement}
 *
 * A world-observable premise can be FALSIFIED BY A GUARD OR A REPO SCAN. That is
 * gate (c) ΓÇö premise invalidation ΓÇö and it is the case where nothing contradicts
 * the user and reality simply moved.
 *
 * An intent-based premise can only be retracted by a human. There is no point
 * synthesising a guard for `budget`: no file in the repository records it, so any
 * check would either always pass (useless) or always fail (noise). Phase 4 skips
 * guard synthesis for these and marks the decision `unverifiable` instead.
 * ---------------------------------------------------------------------------
 */

import type { PremiseType } from "@/types/domain";
import { WORLD_OBSERVABLE_PREMISE_TYPES } from "@/types/domain";

export interface PremiseTypeMeta {
  readonly type: PremiseType;
  readonly label: string;
  readonly description: string;
  /** Predicate namespace, e.g. "scale". Predicates are `namespace.name`, and
   *  rung 1 of the identity ladder matches on the canonical predicate ΓÇö so the
   *  namespace is part of a premise's IDENTITY, not decoration. */
  readonly namespace: string;
  /** Can a guard or a repo scan falsify this? See the header. */
  readonly worldObservable: boolean;
  /** Standard predicates with their value shape. The extractor aims at these;
   *  anything else is allowed but reviewed harder. */
  readonly predicates: readonly PremisePredicate[];
  readonly example: string;
}

export interface PremisePredicate {
  readonly name: string;
  readonly label: string;
  readonly valueKind: "boolean" | "number" | "string" | "enum";
  /** For `enum`, the permitted values. For `number`, a unit. */
  readonly constraint?: string;
}

export const PREMISE_TYPE_META: Readonly<Record<PremiseType, PremiseTypeMeta>> = {
  scale: {
    type: "scale",
    label: "Scale",
    description: "How many users, records, requests or machines. The premise that dies most often, and the one whose death invalidates the most.",
    namespace: "scale",
    worldObservable: true,
    predicates: [
      { name: "single_user", label: "single user", valueKind: "boolean" },
      { name: "max_users", label: "maximum users", valueKind: "number", constraint: "count" },
      { name: "max_records", label: "maximum records", valueKind: "number", constraint: "count" },
      { name: "concurrent_writers", label: "concurrent writers", valueKind: "number", constraint: "count" },
      { name: "requests_per_second", label: "requests per second", valueKind: "number", constraint: "rps" },
      { name: "multi_tenant", label: "multi-tenant", valueKind: "boolean" },
      { name: "data_residency", label: "data residency requirement", valueKind: "string" },
    ],
    example: "scale.single_user = true ΓÇö \"it's one person, one machine, one log\"",
  },

  team: {
    type: "team",
    label: "Team",
    description: "Who builds and maintains it: size, skills, availability.",
    namespace: "team",
    worldObservable: false,
    predicates: [
      { name: "size", label: "team size", valueKind: "number", constraint: "people" },
      { name: "solo", label: "solo developer", valueKind: "boolean" },
      { name: "expertise", label: "team expertise", valueKind: "string" },
      { name: "review_required", label: "code review required", valueKind: "boolean" },
      { name: "on_call", label: "somebody is on call", valueKind: "boolean" },
    ],
    example: "team.solo = true ΓÇö \"I'm the only one who'll ever read this\"",
  },

  budget: {
    type: "budget",
    label: "Budget",
    description: "What may be spent, per month or in total.",
    namespace: "budget",
    worldObservable: false,
    predicates: [
      { name: "monthly_usd", label: "monthly spend ceiling", valueKind: "number", constraint: "USD" },
      { name: "free_tier_only", label: "free tier only", valueKind: "boolean" },
      { name: "no_paid_saas", label: "no paid SaaS", valueKind: "boolean" },
      { name: "token_budget", label: "LLM token budget", valueKind: "number", constraint: "tokens" },
    ],
    example: "budget.free_tier_only = true ΓÇö \"I'm not paying for a database\"",
  },

  time: {
    type: "time",
    label: "Time",
    description: "Deadlines and how much effort is available.",
    namespace: "time",
    worldObservable: false,
    predicates: [
      { name: "deadline", label: "deadline", valueKind: "string", constraint: "date" },
      { name: "hackathon", label: "hackathon / demo deadline", valueKind: "boolean" },
      { name: "hours_available", label: "hours available", valueKind: "number", constraint: "hours" },
      { name: "prototype_only", label: "prototype, will be discarded", valueKind: "boolean" },
    ],
    example: "time.hackathon = true ΓÇö \"I have until Sunday\"",
  },

  deployment: {
    type: "deployment",
    label: "Deployment",
    description: "Where and how it runs. The premise a repo scan can usually check.",
    namespace: "deployment",
    worldObservable: true,
    predicates: [
      { name: "model", label: "deployment model", valueKind: "enum", constraint: "local-only | serverless | container | vm | edge | static" },
      { name: "serverless", label: "serverless", valueKind: "boolean" },
      { name: "local_only", label: "runs only on this machine", valueKind: "boolean" },
      { name: "has_infra", label: "infrastructure is provisioned", valueKind: "boolean" },
      { name: "persistent_disk", label: "a persistent disk is available", valueKind: "boolean" },
      { name: "regions", label: "regions", valueKind: "number", constraint: "count" },
      { name: "ci_present", label: "CI is configured", valueKind: "boolean" },
    ],
    example: "deployment.local_only = true ΓÇö \"this never leaves my laptop\"",
  },

  capability: {
    type: "capability",
    label: "Capability",
    description: "What the chosen tool or platform can and cannot do.",
    namespace: "capability",
    worldObservable: true,
    predicates: [
      { name: "supports", label: "the dependency supports X", valueKind: "string" },
      { name: "lacks", label: "the dependency lacks X", valueKind: "string" },
      { name: "browser_api", label: "a browser API is available", valueKind: "string" },
      { name: "version_floor", label: "minimum version", valueKind: "string", constraint: "semver" },
      { name: "offline_required", label: "must work offline", valueKind: "boolean" },
    ],
    example: "capability.lacks = \"server-side runtime\" ΓÇö \"there's no backend to put it on\"",
  },

  requirement: {
    type: "requirement",
    label: "Requirement",
    description: "A stated product or non-functional requirement.",
    namespace: "requirement",
    worldObservable: false,
    predicates: [
      { name: "must", label: "hard requirement", valueKind: "string" },
      { name: "must_not", label: "hard exclusion", valueKind: "string" },
      { name: "portability", label: "must be portable", valueKind: "boolean" },
      { name: "auditability", label: "must be auditable", valueKind: "boolean" },
      { name: "no_network", label: "no network calls", valueKind: "boolean" },
      { name: "accessibility", label: "accessibility level", valueKind: "string" },
    ],
    example: "requirement.portability = true ΓÇö \"one JSON file I can email to someone\"",
  },

  external: {
    type: "external",
    label: "External",
    description: "Facts about third parties: providers, licences, laws, other repos.",
    namespace: "external",
    worldObservable: true,
    predicates: [
      { name: "provider_offers", label: "the provider offers X", valueKind: "string" },
      { name: "provider_lacks", label: "the provider lacks X", valueKind: "string" },
      { name: "licence", label: "licence constraint", valueKind: "string" },
      { name: "legal", label: "legal constraint", valueKind: "string" },
      { name: "third_party_api", label: "a third-party API is depended on", valueKind: "string" },
    ],
    example: "external.provider_lacks = \"managed postgres on the free tier\"",
  },
};

export const PREMISE_TYPE_ORDER: readonly PremiseType[] = [
  "scale",
  "team",
  "budget",
  "time",
  "deployment",
  "capability",
  "requirement",
  "external",
];

export const PREMISE_TYPE_COUNT = PREMISE_TYPE_ORDER.length;

/** Derived from the domain constant so the two cannot disagree. */
export const WORLD_OBSERVABLE: readonly PremiseType[] = WORLD_OBSERVABLE_PREMISE_TYPES;

export const INTENT_BASED: readonly PremiseType[] = PREMISE_TYPE_ORDER.filter(
  (t) => !WORLD_OBSERVABLE_PREMISE_TYPES.includes(t),
);

export function premiseMeta(type: PremiseType): PremiseTypeMeta {
  return PREMISE_TYPE_META[type];
}

/** The flag the whole downstream depends on. */
export function isWorldObservable(type: PremiseType): boolean {
  return PREMISE_TYPE_META[type].worldObservable;
}

/** Can a guard plausibly verify a premise of this type? Phase 4 skips synthesis
 *  when this is false and marks the decision `unverifiable`. */
export function isGuardable(type: PremiseType): boolean {
  return isWorldObservable(type);
}

/** Every known predicate, namespaced: "scale.single_user". The extractor's
 *  target vocabulary, and rung 1 of the identity ladder's matching key. */
export function allPredicates(): readonly string[] {
  const out: string[] = [];
  for (const type of PREMISE_TYPE_ORDER) {
    for (const predicate of PREMISE_TYPE_META[type].predicates) {
      out.push(`${type}.${predicate.name}`);
    }
  }
  return out;
}

/** Look a namespaced predicate up. Returns the type and the predicate meta. */
export function lookupPredicate(
  namespaced: string,
): { type: PremiseType; predicate: PremisePredicate } | null {
  const dot = namespaced.indexOf(".");
  if (dot < 0) return null;

  const type = namespaced.slice(0, dot) as PremiseType;
  const name = namespaced.slice(dot + 1);
  const meta = PREMISE_TYPE_META[type];
  if (!meta) return null;

  const predicate = meta.predicates.find((p) => p.name === name);
  return predicate ? { type, predicate } : null;
}

/** Split a namespaced predicate. Tolerates a bare name by assuming the caller
 *  already knows the type. */
export function splitPredicate(namespaced: string): { type: string | null; name: string } {
  const dot = namespaced.indexOf(".");
  if (dot < 0) return { type: null, name: namespaced };
  return { type: namespaced.slice(0, dot), name: namespaced.slice(dot + 1) };
}

/** Rank premise types for a given decision variable, so the extractor tries the
 *  likely ones first. Reads `typicalPremises` off the variable table, which
 *  keeps one source of truth for the pairing. */
export function premiseTypesForVariable(
  typical: readonly PremiseType[],
): readonly PremiseType[] {
  const ranked = [...typical];
  for (const type of PREMISE_TYPE_ORDER) {
    if (!ranked.includes(type)) ranked.push(type);
  }
  return ranked;
}
