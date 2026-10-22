/**
 * The 14 decision variables, plus OTHER.
 *
 * Phase 0 · sub-phase 0.7 · table A
 * Plan: plan/phase-0-foundation.md §0.7
 *
 * ---------------------------------------------------------------------------
 * WHY A CLOSED SET OF SLOTS
 *
 * An open-ended "topic" field produces "database choices", "db", "data layer"
 * and "storage" for the same thing, and no gate can fire on that. Fourteen typed
 * slots are enough to cover a solo/small-team AI-assisted project, and being
 * typed is what lets the structural contradiction gate run WITHOUT A MODEL:
 * two IN decisions on DATABASE whose values are an antonym pair is a
 * contradiction by table lookup.
 *
 * `OTHER` is an ESCAPE HATCH, not a category. Its usage rate is tracked
 * (`otherVariableRate` in src/substrate/graph-state.ts). Above ~15% of the
 * corpus the slots are not covering reality and Phase 1's numbers cannot be
 * trusted until this file is extended. That check is in the health panel, not in
 * a test, because it degrades silently with real data and never with fixtures.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";
import type { PremiseType } from "@/types/domain";

export interface VariableMeta {
  readonly variable: DecisionVariable;
  readonly label: string;
  /** One line, shown as the slot's tooltip. Written for a person deciding
   *  whether an extraction landed in the right bucket. */
  readonly description: string;
  /** Values that commonly appear. Seeds the local classifier's keyword table and
   *  gives the review UI something to suggest on a low-confidence extraction. */
  readonly commonValues: readonly string[];
  /** Premise types that typically JUSTIFY a decision in this slot. Used by
   *  `premiseTypeOf` to rank candidate types during premise recovery. */
  readonly typicalPremises: readonly PremiseType[];
  /** File globs this slot usually governs. Seeds `applies_to` in export
   *  (plan/phase-5 §5.3) and guard scoping (plan/phase-4 §4.2). */
  readonly typicalGlobs: readonly string[];
  /** Whether a decision in this slot can usually be checked mechanically.
   *  Drives guard-template coverage and the `unverifiable` flag — a decision
   *  with no synthesizable guard is MARKED unverifiable, never silently
   *  skipped (docs/04 §4.2). */
  readonly verifiableByTemplate: boolean;
}

export const VARIABLE_META: Readonly<Record<DecisionVariable, VariableMeta>> = {
  DATABASE: {
    variable: "DATABASE",
    label: "Database",
    description: "The primary persistent store: engine, and embedded vs server.",
    commonValues: [
      "sqlite",
      "postgres",
      "mysql",
      "mongodb",
      "redis",
      "duckdb",
      "dynamodb",
      "supabase",
      "none",
    ],
    typicalPremises: ["scale", "deployment", "budget", "capability"],
    typicalGlobs: ["src/db/**", "src/**/db/**", "drizzle/**", "prisma/**", "migrations/**"],
    verifiableByTemplate: true,
  },

  AUTH: {
    variable: "AUTH",
    label: "Authentication",
    description: "How identity is established, including the choice to have none.",
    commonValues: [
      "none",
      "clerk",
      "auth0",
      "supabase-auth",
      "nextauth",
      "lucia",
      "magic-link",
      "password",
      "oauth",
      "api-key",
    ],
    typicalPremises: ["scale", "team", "requirement", "budget"],
    typicalGlobs: ["src/auth/**", "src/**/auth/**", "middleware.ts", "src/middleware/**"],
    verifiableByTemplate: true,
  },

  HOSTING: {
    variable: "HOSTING",
    label: "Hosting",
    description: "Where the thing runs: platform, and serverless vs long-lived.",
    commonValues: [
      "vercel",
      "netlify",
      "cloudflare-pages",
      "cloudflare-workers",
      "fly-io",
      "railway",
      "render",
      "aws",
      "gcp",
      "azure",
      "hetzner",
      "self-hosted",
      "local-only",
    ],
    typicalPremises: ["deployment", "budget", "scale", "external"],
    typicalGlobs: ["vercel.json", "netlify.toml", "wrangler.toml", "fly.toml", "Dockerfile", ".github/workflows/**"],
    verifiableByTemplate: true,
  },

  FRAMEWORK: {
    variable: "FRAMEWORK",
    label: "Framework",
    description: "The application framework and its rendering model.",
    commonValues: [
      "react",
      "next",
      "remix",
      "vite",
      "svelte",
      "sveltekit",
      "vue",
      "nuxt",
      "astro",
      "express",
      "fastify",
      "hono",
      "django",
      "rails",
    ],
    typicalPremises: ["capability", "team", "time", "requirement"],
    typicalGlobs: ["src/**", "app/**", "pages/**", "vite.config.*", "next.config.*"],
    verifiableByTemplate: true,
  },

  LANGUAGE: {
    variable: "LANGUAGE",
    label: "Language",
    description: "Implementation language, dialect and version floor.",
    commonValues: ["typescript", "javascript", "python", "go", "rust", "ruby", "java", "kotlin", "swift"],
    typicalPremises: ["team", "capability", "requirement"],
    typicalGlobs: ["tsconfig*.json", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"],
    verifiableByTemplate: true,
  },

  STORAGE: {
    variable: "STORAGE",
    label: "Blob & file storage",
    description: "Where files and large objects live — distinct from the database.",
    commonValues: ["s3", "r2", "gcs", "azure-blob", "local-fs", "indexeddb", "localstorage", "uploadthing", "none"],
    typicalPremises: ["budget", "scale", "deployment", "external"],
    typicalGlobs: ["src/storage/**", "src/**/uploads/**", "src/lib/storage*"],
    verifiableByTemplate: true,
  },

  API_STYLE: {
    variable: "API_STYLE",
    label: "API style",
    description: "The contract between client and server.",
    commonValues: ["rest", "graphql", "trpc", "grpc", "rpc", "websocket", "sse", "file-based", "none"],
    typicalPremises: ["team", "capability", "requirement", "scale"],
    typicalGlobs: ["src/api/**", "src/routes/**", "src/server/**", "src/trpc/**", "openapi.*"],
    verifiableByTemplate: false,
  },

  STATE: {
    variable: "STATE",
    label: "Client state",
    description: "How client-side state is held and synced.",
    commonValues: ["zustand", "redux", "jotai", "recoil", "mobx", "valtio", "context", "signals", "url", "local-component"],
    typicalPremises: ["capability", "team", "requirement"],
    typicalGlobs: ["src/store/**", "src/stores/**", "src/state/**", "src/hooks/**"],
    verifiableByTemplate: true,
  },

  TESTING: {
    variable: "TESTING",
    label: "Testing",
    description: "Test runner, and what is worth testing at all.",
    commonValues: ["vitest", "jest", "playwright", "cypress", "mocha", "pytest", "go-test", "none"],
    typicalPremises: ["time", "team", "requirement"],
    typicalGlobs: ["tests/**", "**/*.test.*", "**/*.spec.*", "playwright.config.*", "vitest.config.*"],
    verifiableByTemplate: true,
  },

  UI_KIT: {
    variable: "UI_KIT",
    label: "UI kit & styling",
    description: "Component library and styling approach.",
    commonValues: [
      "tailwind",
      "shadcn",
      "radix",
      "mui",
      "chakra",
      "mantine",
      "antd",
      "bootstrap",
      "css-modules",
      "styled-components",
      "vanilla-css",
      "none",
    ],
    typicalPremises: ["time", "capability", "requirement"],
    typicalGlobs: ["src/components/**", "src/ui/**", "src/styles/**", "tailwind.config.*", "src/index.css"],
    verifiableByTemplate: true,
  },

  PAYMENTS: {
    variable: "PAYMENTS",
    label: "Payments",
    description: "Billing provider, or the decision not to charge.",
    commonValues: ["stripe", "paddle", "lemonsqueezy", "gumroad", "braintree", "paypal", "crypto", "none"],
    typicalPremises: ["external", "budget", "requirement", "team"],
    typicalGlobs: ["src/billing/**", "src/payments/**", "src/**/stripe*", "app/api/webhooks/**"],
    verifiableByTemplate: true,
  },

  RETRIEVAL: {
    variable: "RETRIEVAL",
    label: "Search & retrieval",
    description: "How content is found: embeddings, lexical, hybrid, or none.",
    commonValues: [
      "embeddings",
      "bm25",
      "hybrid",
      "pgvector",
      "qdrant",
      "pinecone",
      "weaviate",
      "chroma",
      "sqlite-fts",
      "lucene",
      "none",
    ],
    typicalPremises: ["scale", "budget", "capability", "deployment"],
    typicalGlobs: ["src/retrieval/**", "src/search/**", "src/embeddings/**", "src/index/**"],
    verifiableByTemplate: false,
  },

  ARCHITECTURE: {
    variable: "ARCHITECTURE",
    label: "Architecture",
    description: "Shape of the system: monolith vs services, sync vs async.",
    commonValues: [
      "monolith",
      "modular-monolith",
      "microservices",
      "serverless",
      "event-driven",
      "queue-based",
      "edge",
      "client-only",
      "spa",
      "ssr",
      "ssg",
      "islands",
    ],
    typicalPremises: ["team", "scale", "deployment", "time"],
    typicalGlobs: ["src/**", "services/**", "packages/**", "apps/**"],
    verifiableByTemplate: false,
  },

  SCOPE: {
    variable: "SCOPE",
    label: "Scope",
    description: "What the product deliberately is and is not: users, platforms, features.",
    commonValues: [
      "single-user",
      "multi-user",
      "multi-tenant",
      "mvp",
      "prototype",
      "internal-tool",
      "oss",
      "browser-only",
      "desktop",
      "mobile",
    ],
    typicalPremises: ["scale", "team", "time", "requirement"],
    typicalGlobs: ["README.md", "docs/**", "plan/**"],
    verifiableByTemplate: false,
  },

  OTHER: {
    variable: "OTHER",
    label: "Other",
    description:
      "Escape hatch. Anything landing here is evidence the fourteen slots are incomplete — watch the rate.",
    commonValues: [],
    typicalPremises: ["requirement", "capability", "external", "time"],
    typicalGlobs: [],
    verifiableByTemplate: false,
  },
};

/** Slot order for display. Fixed, so the review queue and the export index do
 *  not reorder between renders. */
export const VARIABLE_ORDER: readonly DecisionVariable[] = [
  "DATABASE",
  "AUTH",
  "HOSTING",
  "FRAMEWORK",
  "LANGUAGE",
  "STORAGE",
  "API_STYLE",
  "STATE",
  "TESTING",
  "UI_KIT",
  "PAYMENTS",
  "RETRIEVAL",
  "ARCHITECTURE",
  "SCOPE",
  "OTHER",
];

/** The 14 typed slots, excluding OTHER. The denominator of the ontology's
 *  coverage claim. */
export const TYPED_VARIABLES: readonly DecisionVariable[] = VARIABLE_ORDER.filter(
  (v) => v !== "OTHER",
);

export const TYPED_VARIABLE_COUNT = TYPED_VARIABLES.length;

/** Slots whose decisions can usually be checked mechanically. Drives the
 *  verifiable-coverage metric and the honest "unverifiable" badge. */
export const TEMPLATE_VERIFIABLE_VARIABLES: readonly DecisionVariable[] =
  VARIABLE_ORDER.filter((v) => VARIABLE_META[v].verifiableByTemplate);

export function variableMeta(variable: DecisionVariable): VariableMeta {
  return VARIABLE_META[variable];
}

/** Keyword table for the local classifier: token -> slots it hints at. Built
 *  from `commonValues` and the slot label, so extending `commonValues` extends
 *  the classifier with no second edit. */
export function variableKeywords(): ReadonlyMap<string, readonly DecisionVariable[]> {
  const out = new Map<string, DecisionVariable[]>();

  const add = (token: string, variable: DecisionVariable): void => {
    const key = token.toLowerCase();
    const bucket = out.get(key);
    if (bucket) {
      if (!bucket.includes(variable)) bucket.push(variable);
    } else {
      out.set(key, [variable]);
    }
  };

  for (const variable of VARIABLE_ORDER) {
    const meta = VARIABLE_META[variable];
    add(meta.label, variable);
    for (const word of meta.label.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 2) add(word, variable);
    }
    for (const value of meta.commonValues) {
      add(value, variable);
      for (const part of value.split(/[-_/]/)) {
        if (part.length > 2) add(part, variable);
      }
    }
  }

  return out;
}
