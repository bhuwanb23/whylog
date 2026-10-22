/**
 * Variable-scoped antonym pairs.
 *
 * Phase 0 ┬╖ sub-phase 0.7
 * Plan: plan/phase-0-foundation.md ┬º0.7 ┬╖ docs/03 ┬º4 (gate a)
 *
 * ---------------------------------------------------------------------------
 * THE CHEAPEST CONTRADICTION DETECTOR IN THE SYSTEM
 *
 * Two IN-labelled decisions on the same VARIABLE whose values are a declared
 * antonym pair, with OVERLAPPING validity windows, is a structural
 * contradiction. No model. No embedding. No threshold. A table lookup and a date
 * comparison.
 *
 * This matters because of the load-bearing fact from docs/03: "use Postgres" and
 * "don't use Postgres" are ~0.9 cosine similar. Embeddings cannot detect
 * contradiction ΓÇö they detect TOPICAL similarity, and a negation changes almost
 * nothing in vector space. Gate (a) is what fires while the semantic gate is
 * still uncertain, and it fires deterministically.
 *
 * ---------------------------------------------------------------------------
 * SCOPED, NOT GLOBAL
 *
 * Pairs are declared PER VARIABLE. "none" is an antonym of "postgres" under
 * DATABASE and of "clerk" under AUTH, but "none" is not an antonym of "postgres"
 * under HOSTING. A global pair list would produce contradictions between
 * unrelated slots, which is the fastest route to a tool that cries wolf and gets
 * switched off.
 *
 * Every pair is over CANONICAL values ΓÇö aliases are folded first by
 * src/ontology/canonicalize.ts, so ("pg", "sqlite") is caught via
 * ("postgres", "sqlite").
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";

export interface AntonymPair {
  readonly a: string;
  readonly b: string;
  /** Why these two cannot both hold. Shown verbatim in the conflict view, so the
   *  user is told the RULE that fired rather than a similarity score. */
  readonly why: string;
}

export const ANTONYMS: Readonly<Record<DecisionVariable, readonly AntonymPair[]>> = {
  DATABASE: [
    { a: "sqlite", b: "postgres", why: "An embedded file database and a client-server database are different deployment shapes; one process cannot be both." },
    { a: "sqlite", b: "mysql", why: "Two different primary stores for the same data." },
    { a: "sqlite", b: "mongodb", why: "A relational embedded store and a document store cannot both be the primary store." },
    { a: "postgres", b: "mongodb", why: "Two different primary stores for the same data." },
    { a: "postgres", b: "mysql", why: "Two different primary stores for the same data." },
    { a: "none", b: "sqlite", why: "No persistent store and an embedded store are mutually exclusive." },
    { a: "none", b: "postgres", why: "No persistent store and a server database are mutually exclusive." },
    { a: "none", b: "mongodb", why: "No persistent store and a document database are mutually exclusive." },
    { a: "memory", b: "postgres", why: "In-memory only and a durable server database disagree about whether data survives a restart." },
    { a: "memory", b: "sqlite", why: "In-memory only and a file-backed store disagree about durability." },
    { a: "redis", b: "postgres", why: "A cache is not a primary store; if both are claimed as primary, one is wrong." },
  ],

  AUTH: [
    { a: "none", b: "clerk", why: "No authentication and a managed auth provider cannot both describe the same surface." },
    { a: "none", b: "auth0", why: "No authentication and a managed auth provider cannot both describe the same surface." },
    { a: "none", b: "nextauth", why: "No authentication and a self-hosted auth layer cannot both describe the same surface." },
    { a: "none", b: "supabase-auth", why: "No authentication and a managed auth provider cannot both describe the same surface." },
    { a: "none", b: "password", why: "No authentication and a credential flow are mutually exclusive." },
    { a: "none", b: "oauth", why: "No authentication and an OAuth flow are mutually exclusive." },
    { a: "none", b: "magic-link", why: "No authentication and a magic-link flow are mutually exclusive." },
    { a: "clerk", b: "auth0", why: "Two managed auth providers for the same identity." },
    { a: "clerk", b: "nextauth", why: "A managed provider and a self-hosted layer for the same identity." },
    { a: "auth0", b: "nextauth", why: "Two auth implementations for the same identity." },
    { a: "password", b: "magic-link", why: "Two primary sign-in mechanisms; one may exist as a fallback, but both cannot be primary." },
  ],

  HOSTING: [
    { a: "local-only", b: "vercel", why: "Never deployed and deployed to a platform contradict." },
    { a: "local-only", b: "netlify", why: "Never deployed and deployed to a platform contradict." },
    { a: "local-only", b: "aws", why: "Never deployed and deployed to a cloud contradict." },
    { a: "local-only", b: "cloudflare-workers", why: "Never deployed and deployed to an edge platform contradict." },
    { a: "local-only", b: "self-hosted", why: "Runs only on this machine and runs on a provisioned server contradict." },
    { a: "vercel", b: "aws", why: "Two primary hosting targets." },
    { a: "vercel", b: "netlify", why: "Two primary hosting targets." },
    { a: "cloudflare-pages", b: "vercel", why: "Two primary hosting targets." },
    { a: "self-hosted", b: "vercel", why: "Self-managed infrastructure and a managed platform are different operational models." },
  ],

  FRAMEWORK: [
    { a: "react", b: "svelte", why: "Two component models for the same UI." },
    { a: "react", b: "vue", why: "Two component models for the same UI." },
    { a: "next", b: "vite", why: "A full-stack framework and a bare bundler describe different application shells." },
    { a: "next", b: "remix", why: "Two full-stack frameworks for the same app." },
    { a: "svelte", b: "vue", why: "Two component models for the same UI." },
    { a: "none", b: "react", why: "No framework and a framework contradict." },
    { a: "express", b: "fastify", why: "Two server frameworks for the same API." },
  ],

  LANGUAGE: [
    { a: "typescript", b: "javascript", why: "Typed and untyped source for the same codebase ΓÇö one is a migration of the other, not a coexisting choice." },
    { a: "python", b: "typescript", why: "Two implementation languages for the same component." },
    { a: "go", b: "rust", why: "Two implementation languages for the same component." },
    { a: "java", b: "kotlin", why: "Two JVM languages for the same component; usually a migration, which should be recorded as a supersession." },
  ],

  STORAGE: [
    { a: "none", b: "s3", why: "No blob storage and an object store contradict." },
    { a: "none", b: "local-fs", why: "No blob storage and a filesystem target contradict." },
    { a: "local-fs", b: "s3", why: "Two blob targets; a serverless deployment cannot read the local filesystem." },
    { a: "localstorage", b: "s3", why: "Browser-local and remote object storage are different tiers." },
    { a: "indexeddb", b: "local-fs", why: "Browser-only storage and a server filesystem cannot both hold the same objects." },
  ],

  API_STYLE: [
    { a: "rest", b: "graphql", why: "Two API contracts for the same client." },
    { a: "rest", b: "trpc", why: "Two API contracts for the same client." },
    { a: "graphql", b: "trpc", why: "Two API contracts for the same client." },
    { a: "none", b: "rest", why: "No API and a REST API contradict." },
    { a: "none", b: "graphql", why: "No API and a GraphQL API contradict." },
    { a: "websocket", b: "sse", why: "Two transport choices for the same realtime channel." },
  ],

  STATE: [
    { a: "zustand", b: "redux", why: "Two global stores for the same client state." },
    { a: "zustand", b: "jotai", why: "Two global state models (store vs atoms) for the same state." },
    { a: "context", b: "redux", why: "Context-only and a dedicated store are different models; both cannot be the primary one." },
    { a: "local-component", b: "redux", why: "No global state and a global store contradict." },
    { a: "signals", b: "redux", why: "Two reactivity models for the same state." },
  ],

  TESTING: [
    { a: "none", b: "vitest", why: "No tests and a configured unit-test runner contradict." },
    { a: "none", b: "jest", why: "No tests and a configured unit-test runner contradict." },
    { a: "none", b: "playwright", why: "No tests and a configured end-to-end runner contradict." },
    { a: "vitest", b: "jest", why: "Two unit-test runners; running both doubles the cost and halves the coverage." },
    { a: "playwright", b: "cypress", why: "Two end-to-end runners for the same flows." },
  ],

  UI_KIT: [
    { a: "tailwind", b: "mui", why: "Utility-first CSS and an opinionated component library impose conflicting styling models." },
    { a: "tailwind", b: "bootstrap", why: "Two styling systems for the same components." },
    { a: "vanilla-css", b: "tailwind", why: "Hand-written CSS and a utility framework are different styling systems." },
    { a: "css-modules", b: "styled-components", why: "Two styling systems for the same components." },
    { a: "none", b: "tailwind", why: "No styling library and a styling framework contradict." },
    { a: "shadcn", b: "mui", why: "Two component libraries with incompatible primitives." },
  ],

  PAYMENTS: [
    { a: "none", b: "stripe", why: "Not charging and a configured payment provider contradict." },
    { a: "none", b: "paddle", why: "Not charging and a configured payment provider contradict." },
    { a: "stripe", b: "paddle", why: "Two payment providers for the same checkout." },
    { a: "stripe", b: "lemonsqueezy", why: "Two payment providers for the same checkout." },
    { a: "stripe", b: "gumroad", why: "Two payment providers for the same checkout." },
  ],

  RETRIEVAL: [
    { a: "none", b: "embeddings", why: "No retrieval and a semantic index contradict." },
    { a: "none", b: "bm25", why: "No retrieval and a lexical index contradict." },
    { a: "embeddings", b: "bm25", why: "Dense-only and sparse-only are different retrieval designs; if both exist the decision is `hybrid` and should say so." },
    { a: "pgvector", b: "pinecone", why: "Two vector backends for the same index." },
    { a: "qdrant", b: "pinecone", why: "Two vector backends for the same index." },
    { a: "sqlite-fts", b: "algolia", why: "Two search backends for the same corpus." },
  ],

  ARCHITECTURE: [
    { a: "monolith", b: "microservices", why: "One deployable and many deployables contradict." },
    { a: "client-only", b: "microservices", why: "No backend and a service topology contradict." },
    { a: "client-only", b: "serverless", why: "No backend and server-side functions contradict." },
    { a: "ssg", b: "ssr", why: "Build-time and request-time rendering are different rendering models." },
    { a: "spa", b: "ssg", why: "A client-rendered app and a statically generated site disagree about where HTML is produced." },
  ],

  SCOPE: [
    { a: "single-user", b: "multi-user", why: "One user and many users contradict ΓÇö and this pair is the one that invalidates the most downstream decisions." },
    { a: "single-user", b: "multi-tenant", why: "One user and a tenanted product contradict." },
    { a: "browser-only", b: "desktop", why: "Two target platforms." },
    { a: "cli", b: "browser-only", why: "A command-line tool and a browser-only app are different surfaces." },
    { a: "prototype", b: "oss", why: "Throwaway and maintained-in-public are different commitments." },
  ],

  OTHER: [],
};

/** Flat lookup built once: "variable\u0000a\u0000b" -> why. Both orderings are
 *  inserted, so a caller never has to sort the pair before asking. */
const PAIR_INDEX: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const variable of Object.keys(ANTONYMS) as DecisionVariable[]) {
    for (const pair of ANTONYMS[variable]) {
      map.set(`${variable}\u0000${pair.a}\u0000${pair.b}`, pair.why);
      map.set(`${variable}\u0000${pair.b}\u0000${pair.a}`, pair.why);
    }
  }
  return map;
})();

/**
 * Are these two canonical values mutually exclusive under this variable?
 *
 * This is gate (a) in one function. It returns the REASON as well as the verdict
 * because the conflict view must show the rule that fired ΓÇö "these two cannot
 * both hold because X" is actionable, and "similarity 0.91" is not.
 */
export function areAntonyms(
  variable: DecisionVariable,
  a: string,
  b: string,
): { antonym: true; why: string } | { antonym: false } {
  if (a === b) return { antonym: false };
  const why = PAIR_INDEX.get(`${variable}\u0000${a}\u0000${b}`);
  return why === undefined ? { antonym: false } : { antonym: true, why };
}

/** All values that contradict `value` under `variable`. Used to pre-empt a
 * decision at authoring time rather than detecting it afterwards. */
export function antonymsOf(variable: DecisionVariable, value: string): readonly string[] {
  return ANTONYMS[variable].filter((p) => p.a === value || p.b === value).map((p) =>
    p.a === value ? p.b : p.a,
  );
}

export function pairsFor(variable: DecisionVariable): readonly AntonymPair[] {
  return ANTONYMS[variable];
}

export function antonymPairCount(): number {
  let n = 0;
  for (const variable of Object.keys(ANTONYMS) as DecisionVariable[]) {
    n += ANTONYMS[variable].length;
  }
  return n;
}

/**
 * Values that are SELF-contradictory when asserted twice: a variable where the
 * same canonical value appears in two live IN decisions is a DUPLICATE, not a
 * contradiction, and the identity ladder should have merged them. Surfaced
 * separately so the health panel can distinguish "the gate fired" from
 * "resolution failed".
 */
export function isDuplicateNotContradiction(a: string, b: string): boolean {
  return a === b;
}
