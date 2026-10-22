/**
 * Alias table: many surface forms, one canonical value.
 *
 * Phase 0 ┬╖ sub-phase 0.7
 * Plan: plan/phase-0-foundation.md ┬º0.7
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "pg", "postgres", "postgresql" and "postgre" (the typo people actually make)
 * are one value. Without folding, rung 2 of the identity ladder misses and a
 * second DATABASE node appears ΓÇö and then the structural contradiction gate
 * accuses the user of holding two database decisions at once.
 *
 * Alias folding is also what makes gate (a) work at all. Antonym pairs are
 * declared over CANONICAL values, so a contradiction between "pg" and "sqlite"
 * is only detectable if "pg" has already become "postgres".
 *
 * Cost: 100 lines of table. Benefit: the difference between a system that
 * recognises its own history and one that duplicates it.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";

/** alias (lowercased, trimmed) -> canonical value. */
export type AliasTable = Readonly<Record<string, string>>;

/** Per-variable tables. Scoped, because "none" means something different under
 *  AUTH than under DATABASE, and "local" is a hosting target and a storage
 *  location. An unscoped table would fold them together. */
export const ALIASES: Readonly<Record<DecisionVariable, AliasTable>> = {
  DATABASE: {
    pg: "postgres",
    postgresql: "postgres",
    postgre: "postgres",
    "postgre sql": "postgres",
    psql: "postgres",
    "supabase db": "postgres",
    "supabase database": "postgres",
    neon: "postgres",
    "neon db": "postgres",

    "sqlite3": "sqlite",
    "sql lite": "sqlite",
    "better sqlite3": "better-sqlite3",
    "better-sqlite 3": "better-sqlite3",
    bsql: "better-sqlite3",
    "wa sql": "wa-sqlite",
    "sql.js": "sql-js",
    "libsql": "turso",
    "turso db": "turso",

    mongo: "mongodb",
    "mongo db": "mongodb",
    atlas: "mongodb",
    "mongo atlas": "mongodb",
    documentdb: "mongodb",

    mysql: "mysql",
    mariadb: "mysql",
    "planetscale": "mysql",
    tidb: "mysql",

    redis: "redis",
    valkey: "redis",
    upstash: "redis",
    "upstash redis": "redis",
    keyvalue: "redis",
    "key-value store": "redis",

    duckdb: "duckdb",
    "duck db": "duckdb",

    dynamo: "dynamodb",
    dynamodb: "dynamodb",
    "ddb": "dynamodb",

    "no database": "none",
    "no db": "none",
    "nothing": "none",
    "in memory": "memory",
    "in-memory": "memory",
    "localstorage": "memory",
  },

  AUTH: {
    "no auth": "none",
    "none": "none",
    "nothing": "none",
    "open": "none",
    "public": "none",
    "no authentication": "none",
    "no login": "none",
    "skip auth": "none",

    "clerk dev": "clerk",
    "clerk.com": "clerk",

    "auth0": "auth0",
    "okta": "auth0",

    "next auth": "nextauth",
    "next-auth": "nextauth",
    "auth js": "nextauth",
    "authjs": "nextauth",

    "supabase auth": "supabase-auth",
    "supabase auth js": "supabase-auth",
    "go true": "supabase-auth",
    gotrue: "supabase-auth",

    lucia: "lucia",
    "lucia auth": "lucia",
    osso: "lucia",

    "magic link": "magic-link",
    magiclink: "magic-link",
    "email link": "magic-link",
    "passwordless": "magic-link",

    "username password": "password",
    "email password": "password",
    credentials: "password",
    bcrypt: "password",
    argon2: "password",

    oauth: "oauth",
    oauth2: "oauth",
    "google sign in": "oauth",
    "github sign in": "oauth",
    oidc: "oauth",
    "open id connect": "oauth",
    sso: "oauth",

    "api key": "api-key",
    apikey: "api-key",
    token: "api-key",
    "bearer token": "api-key",
    "shared secret": "api-key",
  },

  HOSTING: {
    vercel: "vercel",
    "vercel inc": "vercel",
    now: "vercel",

    netlify: "netlify",
    "netlify drop": "netlify",

    "cloudflare pages": "cloudflare-pages",
    cfpages: "cloudflare-pages",
    pages: "cloudflare-pages",

    "cloudflare workers": "cloudflare-workers",
    workers: "cloudflare-workers",
    wrangler: "cloudflare-workers",

    "fly.io": "fly-io",
    fly: "fly-io",
    "fly io": "fly-io",

    railway: "railway",
    "railway app": "railway",

    render: "render",
    "render.com": "render",

    heroku: "heroku",

    aws: "aws",
    amazon: "aws",
    ec2: "aws",
    lambda: "aws",
    amplify: "aws",
    "elastic beanstalk": "aws",

    gcp: "gcp",
    "google cloud": "gcp",
    "cloud run": "gcp",
    "app engine": "gcp",

    azure: "azure",
    "azure static web apps": "azure",

    hetzner: "hetzner",
    "hetzner cloud": "hetzner",
    digitalocean: "digitalocean",
    droplet: "digitalocean",
    linode: "linode",
    vultr: "vultr",

    docker: "self-hosted",
    compose: "self-hosted",
    "docker compose": "self-hosted",
    kubernetes: "self-hosted",
    k8s: "self-hosted",
    "self hosted": "self-hosted",
    vps: "self-hosted",
    "own server": "self-hosted",

    "my laptop": "local-only",
    "my machine": "local-only",
    localhost: "local-only",
    local: "local-only",
    "runs locally": "local-only",
    offline: "local-only",
    "no deploy": "local-only",
    "not deployed": "local-only",
    "never deployed": "local-only",
    electron: "local-only",
    tauri: "local-only",
  },

  FRAMEWORK: {
    react: "react",
    reactjs: "react",
    "react js": "react",
    cra: "react",
    "create react app": "react",

    next: "next",
    nextjs: "next",
    "next js": "next",
    "next.js": "next",

    remix: "remix",
    "react router": "remix",

    vite: "vite",
    "vanilla vite": "vite",
    "vite react": "vite",
    "vite + react": "vite",

    svelte: "svelte",
    sveltekit: "sveltekit",
    "svelte kit": "sveltekit",

    vue: "vue",
    vuejs: "vue",
    nuxt: "nuxt",
    nuxtjs: "nuxt",

    astro: "astro",
    "astro js": "astro",

    solid: "solid",
    solidjs: "solid",

    express: "express",
    expressjs: "express",
    fastify: "fastify",
    hono: "hono",
    koa: "koa",
    nest: "nestjs",
    nestjs: "nestjs",

    django: "django",
    flask: "flask",
    fastapi: "fastapi",
    rails: "rails",
    "ruby on rails": "rails",
    laravel: "laravel",

    "no framework": "none",
    "vanilla js": "none",
    "plain html": "none",
  },

  LANGUAGE: {
    ts: "typescript",
    typescript: "typescript",
    "type script": "typescript",
    tsx: "typescript",
    js: "javascript",
    javascript: "javascript",
    node: "javascript",
    esm: "javascript",
    py: "python",
    python: "python",
    python3: "python",
    golang: "go",
    go: "go",
    rs: "rust",
    rust: "rust",
    rb: "ruby",
    ruby: "ruby",
    java: "java",
    kt: "kotlin",
    kotlin: "kotlin",
    "c sharp": "csharp",
    csharp: "csharp",
    "c#": "csharp",
    cpp: "cpp",
    "c++": "cpp",
    elixir: "elixir",
    php: "php",
    swift: "swift",
    zig: "zig",
  },

  STORAGE: {
    s3: "s3",
    "aws s3": "s3",
    "s3 bucket": "s3",
    minio: "s3",
    "s3 compatible": "s3",

    r2: "r2",
    "cloudflare r2": "r2",

    gcs: "gcs",
    "google cloud storage": "gcs",

    "azure blob": "azure-blob",
    blob: "azure-blob",

    "local fs": "local-fs",
    filesystem: "local-fs",
    "file system": "local-fs",
    disk: "local-fs",
    "on disk": "local-fs",
    uploads: "local-fs",

    indexeddb: "indexeddb",
    idb: "indexeddb",
    "dexie": "indexeddb",

    localstorage: "localstorage",
    "local storage": "localstorage",
    "browser storage": "localstorage",

    uploadthing: "uploadthing",
    cloudinary: "cloudinary",

    "no storage": "none",
    none: "none",
  },

  API_STYLE: {
    rest: "rest",
    "rest api": "rest",
    "restful": "rest",
    http: "rest",
    "json api": "rest",

    graphql: "graphql",
    gql: "graphql",
    apollo: "graphql",
    urql: "graphql",

    trpc: "trpc",
    "t rpc": "trpc",
    "typescript rpc": "trpc",

    grpc: "grpc",
    protobuf: "grpc",

    rpc: "rpc",
    jsonrpc: "rpc",

    websocket: "websocket",
    ws: "websocket",
    sockets: "websocket",
    socketio: "websocket",
    "socket.io": "websocket",

    sse: "sse",
    "server sent events": "sse",
    eventsource: "sse",
    streaming: "sse",

    "file based": "file-based",
    "no api": "none",
    none: "none",
    "direct import": "none",
  },

  STATE: {
    zustand: "zustand",
    redux: "redux",
    "redux toolkit": "redux",
    rtk: "redux",
    jotai: "jotai",
    recoil: "recoil",
    mobx: "mobx",
    valtio: "valtio",
    xstate: "xstate",
    "react context": "context",
    context: "context",
    "use context": "context",
    provider: "context",
    signals: "signals",
    preact: "signals",
    nanostores: "signals",
    url: "url",
    "url state": "url",
    "query params": "url",
    "search params": "url",
    "local state": "local-component",
    "component state": "local-component",
    "use state": "local-component",
    useState: "local-component",
    "no global state": "local-component",
    "tanstack query": "server-cache",
    "react query": "server-cache",
    swr: "server-cache",
  },

  TESTING: {
    vitest: "vitest",
    "vite test": "vitest",
    jest: "jest",
    playwright: "playwright",
    pw: "playwright",
    cypress: "cypress",
    mocha: "mocha",
    chai: "mocha",
    jasmine: "jest",
    "testing library": "jest",
    pytest: "pytest",
    unittest: "pytest",
    "go test": "go-test",
    rspec: "rspec",
    "no tests": "none",
    none: "none",
    "not tested": "none",
    "skip tests": "none",
    "we'll test later": "none",
  },

  UI_KIT: {
    tailwind: "tailwind",
    tailwindcss: "tailwind",
    tw: "tailwind",
    "tailwind v4": "tailwind",
    "tailwind css": "tailwind",
    windicss: "tailwind",

    shadcn: "shadcn",
    "shad cn": "shadcn",
    "shadcn/ui": "shadcn",
    "shadcn ui": "shadcn",

    radix: "radix",
    "radix ui": "radix",
    "radix primitives": "radix",
    headless: "radix",

    mui: "mui",
    "material ui": "mui",
    material: "mui",

    chakra: "chakra",
    "chakra ui": "chakra",
    mantine: "mantine",
    antd: "antd",
    "ant design": "antd",
    bootstrap: "bootstrap",
    bulma: "bootstrap",

    "css modules": "css-modules",
    cssmodules: "css-modules",
    "styled components": "styled-components",
    emotion: "styled-components",
    vanilla: "vanilla-css",
    "plain css": "vanilla-css",
    "no styling library": "vanilla-css",
    "no ui kit": "none",
    none: "none",
  },

  PAYMENTS: {
    stripe: "stripe",
    "stripe checkout": "stripe",
    "stripe billing": "stripe",
    paddle: "paddle",
    lemonsqueezy: "lemonsqueezy",
    "lemon squeezy": "lemonsqueezy",
    "lemon sqeezy": "lemonsqueezy",
    gumroad: "gumroad",
    braintree: "braintree",
    paypal: "paypal",
    "apple pay": "stripe",
    "google pay": "stripe",
    crypto: "crypto",
    bitcoin: "crypto",
    "no payments": "none",
    none: "none",
    "not charging": "none",
    free: "none",
    "open source": "none",
  },

  RETRIEVAL: {
    embeddings: "embeddings",
    embedding: "embeddings",
    vectors: "embeddings",
    "vector search": "embeddings",
    "semantic search": "embeddings",
    dense: "embeddings",
    "openai embeddings": "embeddings",

    bm25: "bm25",
    tfidf: "bm25",
    "tf-idf": "bm25",
    lexical: "bm25",
    keyword: "bm25",
    "sparse retrieval": "bm25",

    hybrid: "hybrid",
    "hybrid search": "hybrid",
    rrf: "hybrid",
    "reciprocal rank fusion": "hybrid",

    pgvector: "pgvector",
    "pg vector": "pgvector",
    qdrant: "qdrant",
    pinecone: "pinecone",
    weaviate: "weaviate",
    chroma: "chroma",
    chromadb: "chroma",
    milvus: "milvus",
    lancedb: "lancedb",
    "sqlite fts": "sqlite-fts",
    fts5: "sqlite-fts",
    "full text search": "sqlite-fts",
    lunr: "lucene",
    flexsearch: "lucene",
    minisearch: "lucene",
    algolia: "algolia",
    typesense: "typesense",
    meilisearch: "meilisearch",
    elasticsearch: "lucene",
    opensearch: "lucene",
    lucene: "lucene",
    grep: "none",
    "no search": "none",
    none: "none",
  },

  ARCHITECTURE: {
    monolith: "monolith",
    "one app": "monolith",
    "single app": "monolith",
    "modular monolith": "modular-monolith",
    microservices: "microservices",
    "micro services": "microservices",
    services: "microservices",
    serverless: "serverless",
    functions: "serverless",
    lambda: "serverless",
    faas: "serverless",
    "event driven": "event-driven",
    events: "event-driven",
    pubsub: "event-driven",
    queue: "queue-based",
    "queue based": "queue-based",
    worker: "queue-based",
    bullmq: "queue-based",
    edge: "edge",
    "client only": "client-only",
    "browser only": "client-only",
    "no backend": "client-only",
    "static site": "client-only",
    spa: "spa",
    "single page app": "spa",
    ssr: "ssr",
    "server side rendering": "ssr",
    ssg: "ssg",
    "static generation": "ssg",
    islands: "islands",
    "partial hydration": "islands",
    hexagonal: "layered",
    "clean architecture": "layered",
    layered: "layered",
    mvc: "layered",
  },

  SCOPE: {
    "single user": "single-user",
    "one user": "single-user",
    solo: "single-user",
    personal: "single-user",
    "just me": "single-user",
    "only me": "single-user",
    "one person": "single-user",

    "multi user": "multi-user",
    multiuser: "multi-user",
    "multiple users": "multi-user",
    team: "multi-user",

    "multi tenant": "multi-tenant",
    multitenant: "multi-tenant",
    saas: "multi-tenant",
    b2b: "multi-tenant",

    mvp: "mvp",
    "minimum viable": "mvp",
    prototype: "prototype",
    poc: "prototype",
    "proof of concept": "prototype",
    spike: "prototype",
    demo: "prototype",
    hackathon: "prototype",

    "internal tool": "internal-tool",
    internal: "internal-tool",
    tooling: "internal-tool",

    oss: "oss",
    "open source": "oss",
    library: "oss",
    package: "oss",

    "browser only": "browser-only",
    browser: "browser-only",
    web: "browser-only",
    desktop: "desktop",
    mobile: "mobile",
    cli: "cli",
    "command line": "cli",
  },

  OTHER: {},
};

/**
 * Cross-variable aliases, applied when the variable is not yet known.
 *
 * During extraction the value is often recovered BEFORE the slot is, and
 * "sqlite" is a DATABASE decision no matter what the sentence looked like. These
 * are unambiguous enough to fold without a variable, and they are what lets
 * `resolveVariable` in src/ontology/index.ts work from a value alone.
 */
export const GLOBAL_ALIASES: AliasTable = {
  sqlite: "sqlite",
  postgres: "postgres",
  mongodb: "mongodb",
  redis: "redis",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  tailwind: "tailwind",
  shadcn: "shadcn",
  zustand: "zustand",
  vite: "vite",
  nextjs: "next",
  trpc: "trpc",
  graphql: "graphql",
  playwright: "playwright",
  vitest: "vitest",
};

/** Values that mean "deliberately absent" in any slot. Needed because `none` is
 *  a real DECISION ("no auth at all") and not a missing value ΓÇö collapsing it
 *  into undefined would delete the most interesting kind of choice. */
export const NONE_VALUES: ReadonlySet<string> = new Set([
  "none",
  "nothing",
  "no",
  "n/a",
  "na",
  "null",
  "empty",
  "absent",
  "skip",
]);

export function aliasTableFor(variable: DecisionVariable): AliasTable {
  return ALIASES[variable];
}

export function aliasCount(): number {
  let n = Object.keys(GLOBAL_ALIASES).length;
  for (const variable of Object.keys(ALIASES) as DecisionVariable[]) {
    n += Object.keys(ALIASES[variable]).length;
  }
  return n;
}

/** Reverse index: canonical value -> the variables that claim it. Used by
 *  `resolveVariable` to infer a slot from a value. */
export function canonicalToVariables(): ReadonlyMap<string, readonly DecisionVariable[]> {
  const out = new Map<string, DecisionVariable[]>();
  for (const variable of Object.keys(ALIASES) as DecisionVariable[]) {
    for (const canonical of Object.values(ALIASES[variable])) {
      const bucket = out.get(canonical);
      if (bucket) {
        if (!bucket.includes(variable)) bucket.push(variable);
      } else {
        out.set(canonical, [variable]);
      }
    }
  }
  return out;
}
