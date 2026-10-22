/**
 * Premise cue phrases, per premise type.
 *
 * Phase 1 · sub-phase 1.4 ★ (data authored here in Phase 0.7)
 * Plan: plan/phase-1-extraction-pipeline.md §1.4 · docs/05 §2
 *
 * ---------------------------------------------------------------------------
 * THE MOST IMPORTANT TABLE IN THE PROJECT
 *
 * Premise recovery is the differentiator, and it is also the highest risk in the
 * plan (R1: prototype §1.4 and MEASURE before building on it). Everything
 * downstream — gate (c), the cascade, entrenchment's EE3 cap, the novelty claim
 * itself — reads the output of the extractor this table drives.
 *
 * What makes premises hard is that they are rarely announced. "It's one person,
 * one machine, one log" contains no cue phrase at all; the premise is the whole
 * sentence. So the table carries TWO kinds of entry:
 *
 *   EXPLICIT  "we can't afford", "as long as", "assuming" — a marker that a
 *             condition is being stated.
 *   TOPICAL   "one person", "free tier", "no server", "weekend" — a phrase whose
 *             mere presence identifies the TYPE of condition, even with no
 *             marker. These are what recover the unannounced majority.
 *
 * Topical cues are lower weight and always go to the review queue. Guessing a
 * premise is acceptable when a human confirms it in one click; guessing silently
 * is how a false cascade starts.
 * ---------------------------------------------------------------------------
 */

import type { PremiseType } from "@/types/domain";

export type PremiseCueKind = "explicit" | "topical";

export interface PremiseCue {
  readonly phrase: string;
  readonly type: PremiseType;
  readonly kind: PremiseCueKind;
  /** 0..1. Explicit markers score high; topical hints score low and are always
   *  reviewed. */
  readonly weight: number;
  /** The predicate this cue most often introduces, e.g. "scale.single_user".
   *  A cue that maps to a predicate lets the extractor emit a NAMESPACED premise,
   *  which is what rung 1 of the identity ladder matches on. */
  readonly predicate?: string;
  /** Polarity the cue usually carries. "can't afford" is a NEGATIVE budget
   *  constraint; "only" is a restrictive one. */
  readonly polarity?: "positive" | "negative" | "restrictive";
}

export const PREMISE_CUES: readonly PremiseCue[] = [
  /* ===================== scale ===================== */
  { phrase: "one person", type: "scale", kind: "topical", weight: 0.8, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "single user", type: "scale", kind: "topical", weight: 0.9, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "one user", type: "scale", kind: "topical", weight: 0.9, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "just me", type: "scale", kind: "topical", weight: 0.85, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "only me", type: "scale", kind: "topical", weight: 0.85, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "one machine", type: "scale", kind: "topical", weight: 0.8, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "personal project", type: "scale", kind: "topical", weight: 0.75, predicate: "scale.single_user" },
  { phrase: "nobody else", type: "scale", kind: "topical", weight: 0.75, predicate: "scale.single_user", polarity: "restrictive" },
  { phrase: "no other users", type: "scale", kind: "topical", weight: 0.85, predicate: "scale.single_user", polarity: "negative" },
  { phrase: "how many users", type: "scale", kind: "explicit", weight: 0.7, predicate: "scale.max_users" },
  { phrase: "concurrent", type: "scale", kind: "topical", weight: 0.55, predicate: "scale.concurrent_writers" },
  { phrase: "at scale", type: "scale", kind: "explicit", weight: 0.6, predicate: "scale.max_users" },
  { phrase: "scale to", type: "scale", kind: "explicit", weight: 0.7, predicate: "scale.max_users" },
  { phrase: "won't scale", type: "scale", kind: "explicit", weight: 0.7, predicate: "scale.max_records", polarity: "negative" },
  { phrase: "too much data", type: "scale", kind: "topical", weight: 0.6, predicate: "scale.max_records" },
  { phrase: "millions of rows", type: "scale", kind: "topical", weight: 0.75, predicate: "scale.max_records" },
  { phrase: "thousands of", type: "scale", kind: "topical", weight: 0.6, predicate: "scale.max_records" },
  { phrase: "hundreds of", type: "scale", kind: "topical", weight: 0.55, predicate: "scale.max_records" },
  { phrase: "traffic", type: "scale", kind: "topical", weight: 0.45, predicate: "scale.requests_per_second" },
  { phrase: "load", type: "scale", kind: "topical", weight: 0.4, predicate: "scale.requests_per_second" },
  { phrase: "multi-tenant", type: "scale", kind: "topical", weight: 0.8, predicate: "scale.multi_tenant" },
  { phrase: "tenants", type: "scale", kind: "topical", weight: 0.7, predicate: "scale.multi_tenant" },
  { phrase: "residency", type: "scale", kind: "topical", weight: 0.6, predicate: "scale.data_residency" },

  /* ===================== team ===================== */
  { phrase: "team of", type: "team", kind: "explicit", weight: 0.85, predicate: "team.size" },
  { phrase: "just me", type: "team", kind: "topical", weight: 0.8, predicate: "team.solo", polarity: "restrictive" },
  { phrase: "on my own", type: "team", kind: "topical", weight: 0.8, predicate: "team.solo", polarity: "restrictive" },
  { phrase: "solo", type: "team", kind: "topical", weight: 0.85, predicate: "team.solo", polarity: "restrictive" },
  { phrase: "only developer", type: "team", kind: "topical", weight: 0.9, predicate: "team.solo", polarity: "restrictive" },
  { phrase: "no team", type: "team", kind: "topical", weight: 0.85, predicate: "team.solo", polarity: "negative" },
  { phrase: "we're two", type: "team", kind: "topical", weight: 0.7, predicate: "team.size" },
  { phrase: "nobody to review", type: "team", kind: "explicit", weight: 0.8, predicate: "team.review_required", polarity: "negative" },
  { phrase: "code review", type: "team", kind: "topical", weight: 0.5, predicate: "team.review_required" },
  { phrase: "don't know", type: "team", kind: "explicit", weight: 0.6, predicate: "team.expertise", polarity: "negative" },
  { phrase: "never used", type: "team", kind: "explicit", weight: 0.65, predicate: "team.expertise", polarity: "negative" },
  { phrase: "not familiar", type: "team", kind: "explicit", weight: 0.65, predicate: "team.expertise", polarity: "negative" },
  { phrase: "learning curve", type: "team", kind: "explicit", weight: 0.6, predicate: "team.expertise", polarity: "negative" },
  { phrase: "on call", type: "team", kind: "topical", weight: 0.7, predicate: "team.on_call" },
  { phrase: "nobody to page", type: "team", kind: "explicit", weight: 0.8, predicate: "team.on_call", polarity: "negative" },

  /* ===================== budget ===================== */
  { phrase: "can't afford", type: "budget", kind: "explicit", weight: 0.9, predicate: "budget.monthly_usd", polarity: "negative" },
  { phrase: "cant afford", type: "budget", kind: "explicit", weight: 0.9, predicate: "budget.monthly_usd", polarity: "negative" },
  { phrase: "no budget", type: "budget", kind: "explicit", weight: 0.95, predicate: "budget.free_tier_only", polarity: "negative" },
  { phrase: "free tier", type: "budget", kind: "topical", weight: 0.85, predicate: "budget.free_tier_only", polarity: "restrictive" },
  { phrase: "free plan", type: "budget", kind: "topical", weight: 0.85, predicate: "budget.free_tier_only", polarity: "restrictive" },
  { phrase: "costs money", type: "budget", kind: "explicit", weight: 0.75, predicate: "budget.monthly_usd", polarity: "negative" },
  { phrase: "too expensive", type: "budget", kind: "explicit", weight: 0.85, predicate: "budget.monthly_usd", polarity: "negative" },
  { phrase: "per month", type: "budget", kind: "topical", weight: 0.6, predicate: "budget.monthly_usd" },
  { phrase: "a month", type: "budget", kind: "topical", weight: 0.55, predicate: "budget.monthly_usd" },
  { phrase: "$", type: "budget", kind: "topical", weight: 0.5, predicate: "budget.monthly_usd" },
  { phrase: "pay for", type: "budget", kind: "explicit", weight: 0.7, predicate: "budget.monthly_usd" },
  { phrase: "not paying", type: "budget", kind: "explicit", weight: 0.9, predicate: "budget.free_tier_only", polarity: "negative" },
  { phrase: "won't pay", type: "budget", kind: "explicit", weight: 0.9, predicate: "budget.free_tier_only", polarity: "negative" },
  { phrase: "no paid", type: "budget", kind: "explicit", weight: 0.85, predicate: "budget.no_paid_saas", polarity: "negative" },
  { phrase: "saas", type: "budget", kind: "topical", weight: 0.4, predicate: "budget.no_paid_saas" },
  { phrase: "api costs", type: "budget", kind: "explicit", weight: 0.75, predicate: "budget.token_budget" },
  { phrase: "token budget", type: "budget", kind: "explicit", weight: 0.8, predicate: "budget.token_budget" },
  { phrase: "tokens add up", type: "budget", kind: "explicit", weight: 0.7, predicate: "budget.token_budget", polarity: "negative" },
  { phrase: "openai bill", type: "budget", kind: "topical", weight: 0.7, predicate: "budget.token_budget" },
  { phrase: "no api key", type: "budget", kind: "explicit", weight: 0.85, predicate: "budget.no_paid_saas", polarity: "negative" },
  { phrase: "without a key", type: "budget", kind: "explicit", weight: 0.8, predicate: "budget.no_paid_saas", polarity: "negative" },

  /* ===================== time ===================== */
  { phrase: "deadline", type: "time", kind: "explicit", weight: 0.85, predicate: "time.deadline" },
  { phrase: "by sunday", type: "time", kind: "topical", weight: 0.85, predicate: "time.deadline", polarity: "restrictive" },
  { phrase: "by friday", type: "time", kind: "topical", weight: 0.85, predicate: "time.deadline", polarity: "restrictive" },
  { phrase: "this weekend", type: "time", kind: "topical", weight: 0.8, predicate: "time.deadline", polarity: "restrictive" },
  { phrase: "hackathon", type: "time", kind: "topical", weight: 0.9, predicate: "time.hackathon", polarity: "restrictive" },
  { phrase: "demo day", type: "time", kind: "topical", weight: 0.85, predicate: "time.hackathon", polarity: "restrictive" },
  { phrase: "no time", type: "time", kind: "explicit", weight: 0.85, predicate: "time.hours_available", polarity: "negative" },
  { phrase: "don't have time", type: "time", kind: "explicit", weight: 0.9, predicate: "time.hours_available", polarity: "negative" },
  { phrase: "ship fast", type: "time", kind: "explicit", weight: 0.7, predicate: "time.hours_available", polarity: "restrictive" },
  { phrase: "quickly", type: "time", kind: "topical", weight: 0.4, predicate: "time.hours_available" },
  { phrase: "for now", type: "time", kind: "explicit", weight: 0.6, predicate: "time.prototype_only", polarity: "restrictive" },
  { phrase: "throwaway", type: "time", kind: "explicit", weight: 0.8, predicate: "time.prototype_only", polarity: "restrictive" },
  { phrase: "throw it away", type: "time", kind: "explicit", weight: 0.8, predicate: "time.prototype_only", polarity: "restrictive" },
  { phrase: "prototype", type: "time", kind: "topical", weight: 0.65, predicate: "time.prototype_only" },
  { phrase: "revisit later", type: "time", kind: "explicit", weight: 0.7, predicate: "time.prototype_only", polarity: "restrictive" },
  { phrase: "we'll revisit", type: "time", kind: "explicit", weight: 0.7, predicate: "time.prototype_only", polarity: "restrictive" },
  { phrase: "not worth it yet", type: "time", kind: "explicit", weight: 0.65, predicate: "time.hours_available" },

  /* ===================== deployment ===================== */
  { phrase: "no server", type: "deployment", kind: "explicit", weight: 0.95, predicate: "deployment.local_only", polarity: "negative" },
  { phrase: "no backend", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.local_only", polarity: "negative" },
  { phrase: "never deployed", type: "deployment", kind: "explicit", weight: 0.95, predicate: "deployment.local_only", polarity: "negative" },
  { phrase: "not deployed", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.local_only", polarity: "negative" },
  { phrase: "runs locally", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.local_only" },
  { phrase: "on my laptop", type: "deployment", kind: "topical", weight: 0.85, predicate: "deployment.local_only" },
  { phrase: "my machine", type: "deployment", kind: "topical", weight: 0.8, predicate: "deployment.local_only" },
  { phrase: "localhost", type: "deployment", kind: "topical", weight: 0.75, predicate: "deployment.local_only" },
  { phrase: "in the browser", type: "deployment", kind: "explicit", weight: 0.85, predicate: "deployment.model", polarity: "restrictive" },
  { phrase: "browser only", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.model", polarity: "restrictive" },
  { phrase: "client side", type: "deployment", kind: "topical", weight: 0.7, predicate: "deployment.model" },
  { phrase: "serverless", type: "deployment", kind: "topical", weight: 0.75, predicate: "deployment.serverless" },
  { phrase: "no infra", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.has_infra", polarity: "negative" },
  { phrase: "no infrastructure", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.has_infra", polarity: "negative" },
  { phrase: "don't want to manage", type: "deployment", kind: "explicit", weight: 0.85, predicate: "deployment.has_infra", polarity: "negative" },
  { phrase: "ops", type: "deployment", kind: "topical", weight: 0.45, predicate: "deployment.has_infra" },
  { phrase: "no persistent disk", type: "deployment", kind: "explicit", weight: 0.9, predicate: "deployment.persistent_disk", polarity: "negative" },
  { phrase: "ephemeral", type: "deployment", kind: "explicit", weight: 0.7, predicate: "deployment.persistent_disk", polarity: "negative" },
  { phrase: "filesystem is read-only", type: "deployment", kind: "explicit", weight: 0.85, predicate: "deployment.persistent_disk", polarity: "negative" },
  { phrase: "cold start", type: "deployment", kind: "topical", weight: 0.6, predicate: "deployment.serverless" },
  { phrase: "container", type: "deployment", kind: "topical", weight: 0.55, predicate: "deployment.model" },
  { phrase: "docker", type: "deployment", kind: "topical", weight: 0.55, predicate: "deployment.model" },
  { phrase: "ci", type: "deployment", kind: "topical", weight: 0.45, predicate: "deployment.ci_present" },
  { phrase: "github actions", type: "deployment", kind: "topical", weight: 0.6, predicate: "deployment.ci_present" },
  { phrase: "offline", type: "deployment", kind: "topical", weight: 0.6, predicate: "deployment.local_only" },

  /* ===================== capability ===================== */
  { phrase: "doesn't support", type: "capability", kind: "explicit", weight: 0.95, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "does not support", type: "capability", kind: "explicit", weight: 0.95, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "can't do", type: "capability", kind: "explicit", weight: 0.9, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "cannot", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "no support for", type: "capability", kind: "explicit", weight: 0.9, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "isn't available", type: "capability", kind: "explicit", weight: 0.85, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "not available", type: "capability", kind: "explicit", weight: 0.8, predicate: "capability.lacks", polarity: "negative" },
  { phrase: "supports", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.supports" },
  { phrase: "has built-in", type: "capability", kind: "explicit", weight: 0.8, predicate: "capability.supports" },
  { phrase: "out of the box", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.supports" },
  { phrase: "requires node", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.version_floor" },
  { phrase: "needs at least", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.version_floor" },
  { phrase: "version", type: "capability", kind: "topical", weight: 0.4, predicate: "capability.version_floor" },
  { phrase: "api is", type: "capability", kind: "topical", weight: 0.45, predicate: "capability.browser_api" },
  { phrase: "browser api", type: "capability", kind: "explicit", weight: 0.75, predicate: "capability.browser_api" },
  { phrase: "web crypto", type: "capability", kind: "topical", weight: 0.6, predicate: "capability.browser_api" },
  { phrase: "indexeddb is", type: "capability", kind: "topical", weight: 0.6, predicate: "capability.browser_api" },
  { phrase: "synchronous", type: "capability", kind: "topical", weight: 0.5, predicate: "capability.supports" },
  { phrase: "async only", type: "capability", kind: "explicit", weight: 0.7, predicate: "capability.lacks", polarity: "restrictive" },

  /* ===================== requirement ===================== */
  { phrase: "must be", type: "requirement", kind: "explicit", weight: 0.9, predicate: "requirement.must" },
  { phrase: "has to be", type: "requirement", kind: "explicit", weight: 0.85, predicate: "requirement.must" },
  { phrase: "needs to be", type: "requirement", kind: "explicit", weight: 0.8, predicate: "requirement.must" },
  { phrase: "must not", type: "requirement", kind: "explicit", weight: 0.95, predicate: "requirement.must_not", polarity: "negative" },
  { phrase: "must never", type: "requirement", kind: "explicit", weight: 0.95, predicate: "requirement.must_not", polarity: "negative" },
  { phrase: "cannot be", type: "requirement", kind: "explicit", weight: 0.75, predicate: "requirement.must_not", polarity: "negative" },
  { phrase: "requirement", type: "requirement", kind: "explicit", weight: 0.85, predicate: "requirement.must" },
  { phrase: "i want", type: "requirement", kind: "explicit", weight: 0.7, predicate: "requirement.must" },
  { phrase: "i need", type: "requirement", kind: "explicit", weight: 0.75, predicate: "requirement.must" },
  { phrase: "we need", type: "requirement", kind: "explicit", weight: 0.75, predicate: "requirement.must" },
  { phrase: "portable", type: "requirement", kind: "topical", weight: 0.7, predicate: "requirement.portability" },
  { phrase: "one file", type: "requirement", kind: "topical", weight: 0.75, predicate: "requirement.portability", polarity: "restrictive" },
  { phrase: "single file", type: "requirement", kind: "topical", weight: 0.75, predicate: "requirement.portability", polarity: "restrictive" },
  { phrase: "plain text", type: "requirement", kind: "topical", weight: 0.7, predicate: "requirement.portability" },
  { phrase: "human readable", type: "requirement", kind: "topical", weight: 0.65, predicate: "requirement.portability" },
  { phrase: "auditable", type: "requirement", kind: "topical", weight: 0.75, predicate: "requirement.auditability" },
  { phrase: "audit trail", type: "requirement", kind: "topical", weight: 0.8, predicate: "requirement.auditability" },
  { phrase: "no network", type: "requirement", kind: "explicit", weight: 0.9, predicate: "requirement.no_network", polarity: "negative" },
  { phrase: "works offline", type: "requirement", kind: "explicit", weight: 0.85, predicate: "requirement.no_network" },
  { phrase: "private", type: "requirement", kind: "topical", weight: 0.55, predicate: "requirement.must" },
  { phrase: "no data leaves", type: "requirement", kind: "explicit", weight: 0.9, predicate: "requirement.no_network", polarity: "negative" },
  { phrase: "accessible", type: "requirement", kind: "topical", weight: 0.5, predicate: "requirement.accessibility" },
  { phrase: "deterministic", type: "requirement", kind: "topical", weight: 0.7, predicate: "requirement.must" },
  { phrase: "reproducible", type: "requirement", kind: "topical", weight: 0.7, predicate: "requirement.must" },
  { phrase: "no dependencies", type: "requirement", kind: "explicit", weight: 0.8, predicate: "requirement.must_not", polarity: "negative" },
  { phrase: "tiny dependency", type: "requirement", kind: "explicit", weight: 0.7, predicate: "requirement.must", polarity: "restrictive" },

  /* ===================== external ===================== */
  { phrase: "the provider", type: "external", kind: "topical", weight: 0.6, predicate: "external.provider_offers" },
  { phrase: "their api", type: "external", kind: "topical", weight: 0.6, predicate: "external.third_party_api" },
  { phrase: "third party", type: "external", kind: "explicit", weight: 0.75, predicate: "external.third_party_api" },
  { phrase: "third-party", type: "external", kind: "explicit", weight: 0.75, predicate: "external.third_party_api" },
  { phrase: "licence", type: "external", kind: "topical", weight: 0.7, predicate: "external.licence" },
  { phrase: "license", type: "external", kind: "topical", weight: 0.7, predicate: "external.licence" },
  { phrase: "licensing", type: "external", kind: "topical", weight: 0.7, predicate: "external.licence" },
  { phrase: "gpl", type: "external", kind: "topical", weight: 0.8, predicate: "external.licence" },
  { phrase: "mit licensed", type: "external", kind: "topical", weight: 0.6, predicate: "external.licence" },
  { phrase: "legal", type: "external", kind: "topical", weight: 0.6, predicate: "external.legal" },
  { phrase: "gdpr", type: "external", kind: "topical", weight: 0.85, predicate: "external.legal" },
  { phrase: "compliance", type: "external", kind: "topical", weight: 0.6, predicate: "external.legal" },
  { phrase: "rate limit", type: "external", kind: "explicit", weight: 0.8, predicate: "external.provider_lacks", polarity: "restrictive" },
  { phrase: "rate limited", type: "external", kind: "explicit", weight: 0.8, predicate: "external.provider_lacks", polarity: "restrictive" },
  { phrase: "terms of service", type: "external", kind: "explicit", weight: 0.75, predicate: "external.legal" },
  { phrase: "tos", type: "external", kind: "topical", weight: 0.5, predicate: "external.legal" },
  { phrase: "upstream", type: "external", kind: "topical", weight: 0.5, predicate: "external.third_party_api" },
  { phrase: "deprecated", type: "external", kind: "explicit", weight: 0.7, predicate: "external.provider_lacks", polarity: "negative" },
  { phrase: "the repo", type: "external", kind: "topical", weight: 0.4, predicate: "external.third_party_api" },

  /* ===================== generic condition markers =====================
     These carry NO type. They mark that a condition is being stated, and the
     type comes from the clause that follows. They are the explicit half of
     premise recovery and are what an LLM prompt should be seeded with. */
  { phrase: "because", type: "requirement", kind: "explicit", weight: 0.5 },
  { phrase: "since", type: "requirement", kind: "explicit", weight: 0.4 },
  { phrase: "given that", type: "requirement", kind: "explicit", weight: 0.7 },
  { phrase: "given", type: "requirement", kind: "explicit", weight: 0.5 },
  { phrase: "assuming", type: "requirement", kind: "explicit", weight: 0.75 },
  { phrase: "as long as", type: "requirement", kind: "explicit", weight: 0.75, polarity: "restrictive" },
  { phrase: "provided that", type: "requirement", kind: "explicit", weight: 0.75, polarity: "restrictive" },
  { phrase: "unless", type: "requirement", kind: "explicit", weight: 0.7, polarity: "negative" },
  { phrase: "until", type: "time", kind: "explicit", weight: 0.65, polarity: "restrictive" },
  { phrase: "for now", type: "time", kind: "explicit", weight: 0.6, polarity: "restrictive" },
  { phrase: "the problem is", type: "requirement", kind: "explicit", weight: 0.6 },
  { phrase: "the catch is", type: "requirement", kind: "explicit", weight: 0.65 },
  { phrase: "the constraint is", type: "requirement", kind: "explicit", weight: 0.85 },
  { phrase: "constrained by", type: "requirement", kind: "explicit", weight: 0.8 },
  { phrase: "limited to", type: "requirement", kind: "explicit", weight: 0.75, polarity: "restrictive" },
  { phrase: "only", type: "requirement", kind: "explicit", weight: 0.35, polarity: "restrictive" },
];

export const PREMISE_CUE_INDEX: ReadonlyMap<string, readonly PremiseCue[]> = (() => {
  const map = new Map<string, PremiseCue[]>();
  for (const cue of PREMISE_CUES) {
    const bucket = map.get(cue.phrase);
    if (bucket) bucket.push(cue);
    else map.set(cue.phrase, [cue]);
  }
  return map;
})();

export function cuesFor(type: PremiseType): readonly PremiseCue[] {
  return PREMISE_CUES.filter((c) => c.type === type).sort((a, b) => b.weight - a.weight);
}

export function explicitCues(): readonly PremiseCue[] {
  return PREMISE_CUES.filter((c) => c.kind === "explicit");
}

export function topicalCues(): readonly PremiseCue[] {
  return PREMISE_CUES.filter((c) => c.kind === "topical");
}

/** The minimum weight at which a topical cue is allowed to create a premise
 *  candidate WITHOUT going to the review queue. Nothing topical clears it — that
 *  is the point. Topical recovery always asks. */
export const TOPICAL_AUTO_ACCEPT_THRESHOLD = 1.0;

/** The minimum weight for an explicit cue to skip review. */
export const EXPLICIT_AUTO_ACCEPT_THRESHOLD = 0.9;

export function needsReview(cue: PremiseCue): boolean {
  return cue.kind === "topical" || cue.weight < EXPLICIT_AUTO_ACCEPT_THRESHOLD;
}

/** Cue counts per type — a quick check that the table is not lopsided. A type
 *  with three cues will be recovered far less often than one with twenty, and
 *  that asymmetry shows up as a premise-type histogram that has nothing to do
 *  with the corpus. */
export function cueCountByType(): Readonly<Record<PremiseType, number>> {
  const out: Record<PremiseType, number> = {
    scale: 0, team: 0, budget: 0, time: 0,
    deployment: 0, capability: 0, requirement: 0, external: 0,
  };
  for (const cue of PREMISE_CUES) out[cue.type] += 1;
  return out;
}
