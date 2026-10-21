# Phase 0 — Foundation & Substrate

| | |
|---|---|
| **Layer** | L0 — Substrate |
| **Depends on** | Nothing |
| **Blocks** | Every other phase |
| **Estimate** | 3.5 h |
| **Research** | [docs/02 §4](../docs/02-truth-maintenance-theory.md) (formalism) · [docs/06 §2](../docs/06-agent-memory-landscape.md) (bi-temporality) |
| **Gate** | **G1 prerequisite** — the log can replay itself from events and verify its own integrity |

**Objective in one sentence:** build an append-only, bi-temporal, hash-chained event store with a materialised decision graph, a shared domain ontology, and the AI engine seam — so that every later phase writes events and reads state rather than mutating records.

**Why this phase is not skippable:** Invariant **I1** (*nothing is deleted, everything is an event*) and Invariant **I2** (*premises are shared nodes*) are both decided here. Retrofitting either one after Phases 1–4 are built means rewriting all of them. Event sourcing also buys the audit trail, the time machine, and the hash chain for free — three features that would each otherwise be a separate build.

---

## Sub-phases

### 0.1 — Event schema & event types

**Goal.** Define the immutable vocabulary of the log. Everything the system ever does is expressed as one of these events.

**Event types, grouped by actor:**

| Group | Events |
|---|---|
| **Ingest** | `TranscriptImported` |
| **Extraction** | `DecisionProposed` · `PremiseAsserted` · `AlternativeRejected` · `ExtractionDiscarded` |
| **Review** | `DecisionApproved` · `DecisionEdited` · `DecisionRejected` · `PremiseConfirmed` · `PremiseCorrected` |
| **Reasoning** | `JustificationAttached` · `LabelChanged` · `ContradictionDetected` · `PremiseInvalidated` · `NogoodRecorded` · `CascadePropagated` |
| **Revision** | `RevisionProposed` · `DecisionReversed` · `DecisionRejustified` · `PremiseContested` · `DecisionSuperseded` · `HumanOverride` |
| **Verification** | `GuardSynthesised` · `GuardAccepted` · `GuardRan` · `GuardFailed` · `GuardSuppressed` |
| **Export** | `ExportCompiled` · `ExportStamped` · `ExportIntegrityMismatch` |
| **System** | `EngineSwitched` · `LogImported` · `SchemaMigrated` |

**Every event carries:**

| Field | Meaning |
|---|---|
| `id` | Monotonic, sortable |
| `type` | From the table above |
| `at` | **Learned time** — when WhyLog recorded it (`t₂` axis) |
| `occurredAt` | **Valid time** — when it became true in the world (`t₁` axis). Usually equals `at`; differs on historical transcript import |
| `actor` | `human` · `engine:llm` · `engine:local` · `guard` · `system` |
| `payload` | Type-specific data |
| `reason` | Human-readable string. **Mandatory for every state-changing event** — an audit log of events without reasons is just a log |
| `prevHash` | Chain link (see 0.6) |

**Acceptance criteria.**
- The event type list is closed and versioned; adding a type is a schema migration.
- No event type permits mutation of a prior event's payload.
- Every state-changing event has a non-empty `reason`.

---

### 0.2 — Materialisation & projections

**Goal.** Derive all readable state from the event stream. Nothing is stored twice.

```
   APPEND-ONLY EVENT LOG                          MATERIALISED PROJECTIONS
   ─────────────────────                          ────────────────────────
   e₁  TranscriptImported          ┌───────────►  decisions    : id → Decision
   e₂  DecisionProposed            │              premises     : id → Premise
   e₃  PremiseAsserted             │              justifications: id → J
   e₄  DecisionApproved            │              labels       : id → IN|OUT|UNKNOWN|UNFOUNDED
   e₅  JustificationAttached  ─────┤              edges        : dependency network
   e₆  PremiseInvalidated          │              premiseIndex : premiseId → [decisionIds]
   e₇  LabelChanged                │              variableIndex: variable → [decisionIds]
   e₈  CascadePropagated           │              guardIndex   : decisionId → [guardIds]
   e₉  DecisionReversed            └───────────►  metrics      : compliance, soundness, coverage
       …
   (never rewritten)                (recomputable, cacheable, disposable)
```

**Sub-decisions.**
- **Fold function** must be pure and total: same event list → same state, always. This is what makes the time machine (Phase 6.7) a one-line change — fold over a prefix of the log.
- **Projections are caches.** They may be rebuilt from scratch at any time. Provide an explicit "rebuild" action for debugging.
- **Snapshotting:** persist the materialised state alongside the log and a `lastEventId`. On load, replay only events after the snapshot. At this scale a full replay is also fine (<10 ms for 10⁴ events) — snapshotting is an optimisation, not a requirement.

**Acceptance criteria.**
- Deleting all projections and rebuilding from the log reproduces identical state.
- No code path writes to a projection without writing an event first.

---

### 0.3 — Bi-temporal model

**Goal.** Two independent time axes on every node, per Graphiti's model ([docs/06 §2](../docs/06-agent-memory-landscape.md)).

```
        VALID TIME  (t₁) — when it was true in the world
        ──────────────────────────────────────────────────►
        Oct 3                    Oct 12              Oct 21
        │                        │                   │
        ●────────────────────────●                   │
     P-0002 "single user"     P-0002 invalidated     │
     validFrom                validTo                │
                                                     │
        LEARNED TIME (t₂) — when WhyLog found out    │
        ──────────────────────────────────────────────────►
        Oct 3                    Oct 21              Oct 21
        │                        │                   │
        ●                        │                   ●
     decided in a live        transcript pasted    WhyLog learns
     session                  three weeks later    about P-0002
```

**Why it matters concretely.** The core WhyLog workflow is *pasting an old transcript*. If there is one timestamp, the system believes you decided SQLite today, and the entire graph orders itself wrongly — reversals look like originals, recency-based entrenchment inverts, and the timeline lies.

**Fields.**
- Nodes: `validFrom`, `validTo?`, `learnedAt`, `firstLearnedAt` (never updated).
- Events: `occurredAt` (valid) vs `at` (learned).

**Rules.**
- **Ordering and display use valid time.** Chronology of decisions is chronology in the world.
- **Entrenchment recency uses valid time.** A decision made three weeks ago is three weeks old, regardless of when it was imported.
- **The audit trail uses learned time.** "When did the system know?" is a different question from "when did it happen?" and both must be answerable.
- Nodes are **closed out, never deleted**: setting `validTo` writes an event and preserves the row.

**Acceptance criteria.**
- Importing a transcript dated three weeks ago produces a timeline ordered three weeks back, not today.
- "What did we believe on Oct 12?" is answerable by folding events with `occurredAt ≤ Oct 12`.

---

### 0.4 — Identity & entity resolution policy

**Goal.** Decide, once, how nodes are identified and merged. Getting this wrong fills the log with near-duplicates and silently breaks every downstream computation.

**Policy.**
- **Decisions:** stable addressable ID in the form `WLD-0007` — sequential, never renumbered, never reused. Plus a content fingerprint `sha256(variable ‖ canonicalValue)` used only for dedup detection, not as the identity.
- **Premises:** ID `P-0002`. Identity is `type ‖ predicate` where possible (`scale.max_users`), falling back to text similarity.
- **Guards:** `G-0007a` — decision ID plus a letter suffix.
- **Justifications:** `J-0007`.

**Resolution ladder — applied in this order, stopping at the first match:**

```
   1. exact predicate match          scale.max_users == scale.max_users      → MERGE
   2. variable + canonical value     DATABASE:sqlite == DATABASE:sqlite      → MERGE
   3. alias table hit                "pg" → postgres → DATABASE:postgres     → MERGE
   4. embedding similarity ≥ τ_hi    cosine 0.91                             → MERGE (flag for review)
   5. embedding similarity ≥ τ_lo    cosine 0.74                             → CANDIDATE (ask the human)
   6. otherwise                                                             → CREATE NEW
```

`τ_hi` and `τ_lo` are tuned in Phase 1.8 against the fixture corpus. **Merging across premise types is forbidden** regardless of text similarity — `scale.max_users` and `auth.model` are never the same node even if the sentences look alike.

**Acceptance criteria.**
- Importing the same transcript twice produces zero new nodes.
- Importing a transcript that restates an existing decision with different wording merges onto it and increments corroboration.

---

### 0.5 — Integrity hash chain

**Goal.** Make the log tamper-evident, and make exports verifiable.

```
   e₁ ──h₁──► e₂ ──h₂──► e₃ ──h₃──► e₄ ──h₄──► …
                where  hₙ = hash( hₙ₋₁ ‖ eₙ )
                and    h₀ = genesis constant
```

**Why, given this is not a security product.** You are handing this log's output to an agent that can rewrite files. The requirement is not cryptographic security — it is **auditability**: being able to say "this `CLAUDE.md` corresponds to log head `a3f91c…`, 14 decisions, 11 guards passing" and later detect that the file no longer matches.

**Verification points.**
- On load: walk the chain; report the first mismatch.
- On import of an external log or export: compare its stamped head hash against the local head.
- On export: stamp head hash, decision count, premise count, compliance score.

**Cost:** one hash per event, computed once at append. Trivial.

**Acceptance criteria.**
- Editing any historical event's payload causes verification to fail at that index with a readable message.
- Every exported artifact carries a stamp, and re-importing a mismatched artifact is flagged rather than silently merged.

---

### 0.6 — Persistence & portability

**Goal.** Store, load, move and version the log without a server.

| Concern | Decision |
|---|---|
| Primary store | Browser `localStorage`, keyed and versioned (`whylog:v1`) |
| Portable form | A single JSON document containing `{ schemaVersion, events[], headHash, exportedAt, stats }` |
| Import | Validate schema version → verify chain → resolve entities against existing nodes → append events |
| Export | Whole log, or a filtered slice (single project, date range) |
| Migration | Versioned migration steps applied to the event stream on load; migrations themselves are recorded as `SchemaMigrated` events |
| Size budget | Events are small; embeddings are the bulk. At 500 decisions × 512-d float32 ≈ 1 MB. Round embeddings to 8-bit or store them in a separate lazy-loaded blob if `localStorage` limits bite |

**Rule:** the portable JSON is **events, not state**. Exporting materialised state would lose the audit trail, the bi-temporal history and the ability to replay — which are the product.

**Acceptance criteria.**
- Export → clear storage → import reproduces identical materialised state and identical head hash.
- A log from an older schema version loads and migrates without data loss.

---

### 0.7 — Domain ontology

**Goal.** The shared vocabulary that makes extraction, contradiction detection and guard synthesis deterministic. **This is the highest-leverage artifact in the entire plan relative to its size.**

**Three tables:**

**A. Decision variables** — a closed set of typed slots.

| Variable | Example values |
|---|---|
| `DATABASE` | sqlite, postgres, mysql, mongodb, dynamodb, supabase |
| `AUTH` | none, session, jwt, oauth, clerk, supabase-auth, magic-link |
| `HOSTING` | none, vercel, netlify, fly, railway, ec2, self-hosted, static |
| `FRAMEWORK` | vite+react, next, svelte, astro, remix, vue |
| `LANGUAGE` | typescript, javascript, python, go, rust |
| `STORAGE` | localstorage, json-file, sqlite-file, s3, indexeddb |
| `API_STYLE` | rest, graphql, trpc, grpc, none |
| `STATE` | none, redux, zustand, context, jotai, server-state |
| `TESTING` | none, unit, golden-file, e2e, snapshot |
| `UI_KIT` | none, tailwind, shadcn, mui, chakra, css-modules |
| `PAYMENTS` | none, stripe, paddle, lemon-squeezy |
| `RETRIEVAL` | none, keyword, dense, hybrid, vector-db |
| `ARCHITECTURE` | monolith, modular-monolith, microservices, serverless |
| `SCOPE` | mvp, hackathon, production, experiment |

**B. Premise types** — a **closed set of 8**. Bounded recovery beats open-ended recovery; RAAM's own precision problem is unbounded assumption discovery ([docs/05 §2.1](../docs/05-rationale-mining-literature.md)).

| Type | Predicate namespace | Cue phrases |
|---|---|---|
| `scale` | `scale.*` | "single user", "just me", "one machine", "under 1k rows", "low traffic" |
| `team` | `team.*` | "solo", "two of us", "no backend engineer", "I'm the only dev" |
| `budget` | `budget.*` | "no budget", "free tier", "don't want to pay", "$0" |
| `time` | `time.*` | "this weekend", "hackathon", "before the demo", "no time" |
| `deployment` | `deployment.*` | "no server", "local only", "static host", "no infra", "no deploy" |
| `capability` | `capability.*` | "the library supports", "the agent can", "there's an SDK for" |
| `requirement` | `requirement.*` | "must be offline", "must be GDPR", "needs to work without network" |
| `external` | `external.*` | "their API limit is", "pricing changed", "version 18 dropped support" |

Each premise type declares whether it is **world-observable** (can be falsified by a guard or repo scan: `scale`, `deployment`, `capability`, `external`) or **intent-based** (only a human can retract it: `team`, `budget`, `time`, `requirement`). This distinction drives Phase 2's cascade behaviour and Phase 4's guard synthesis.

**C. Alias & antonym tables.**
- **Aliases** fold surface forms to canonical values before hashing or matching: `pg|postgresql|postgre` → `postgres`; `k8s` → `kubernetes`; `authn|login` → `auth`.
- **Antonyms** declare mutual exclusion *within a variable*: `(sqlite, postgres)`, `(sql, nosql)`, `(ssr, csr)`, `(monolith, microservices)`, `(hosted, self-hosted)`, `(auth, none)`. Two IN-labelled decisions asserting opposite members of a pair on the same variable is a **structural contradiction requiring no model** — this is Phase 2's gate (a).

**Acceptance criteria.**
- Every value the extractor can produce resolves to a canonical value or is explicitly marked `unresolved`.
- The ontology is data, not code — editable without a rebuild, and shipped as a reviewable file.
- Antonym pairs are scoped to a variable; `none` under `AUTH` and `none` under `PAYMENTS` are unrelated.

---

### 0.8 — Persistence of embeddings & index artifacts

**Goal.** Keep derived vectors out of the event log.

Embeddings and inverted-question vectors are **derived data**: reproducible from node text plus an engine identifier. Storing them as events would bloat the log and make the hash chain meaningless.

**Policy.**
- Store vectors in a separate keyed blob, tagged `{ engine, model, version, computedAt }`.
- Events record only *that* an index was built (`IndexRebuilt`), not the vectors.
- Switching engine or model marks the index **stale** rather than silently mixing vector spaces. Re-indexing is an explicit user action with a progress indicator.

**Why this matters:** cosine similarity between vectors from different embedding spaces is meaningless. A log that quietly mixes them produces confidently wrong retrieval, which is the exact failure mode WhyLog exists to prevent.

**Acceptance criteria.**
- The event log contains no vector data.
- Changing engine flags the index stale and disables semantic retrieval until rebuilt, with a clear message.

---

### 0.9 — The AI engine seam

**Goal.** Define the interface both engines implement, once, before either exists.

```
                        ┌───────────────────────────┐
                        │       WhyLogEngine        │
                        ├───────────────────────────┤
                        │  extract(transcript)      │
                        │  classify(a, candidates)  │
                        │  embed(texts)             │
                        │  rerank(query, cands)     │
                        │  compose(task, context)   │
                        ├───────────────────────────┤
                        │  capabilities(): flags    │
                        │  id(): {engine, model}    │
                        └─────────────┬─────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
          ┌───────────────────┐               ┌───────────────────┐
          │   LocalEngine     │               │    LLMEngine      │
          │  default, offline │               │  key present      │
          │  deterministic    │               │  provider-agnostic│
          └───────────────────┘               └───────────────────┘
```

**Rules (Invariant, restated from [OVERVIEW §8](OVERVIEW.md)).**
1. Every result carries `engine` and this is **stored on the node**, not merely displayed.
2. `capabilities()` reports what the engine can do — the local engine reports `rerank: false`, `guardSynthesis: template-only`. Callers degrade explicitly rather than assuming.
3. The **local engine is the default**, and must be complete enough to demonstrate the entire concept with no key and no network.
4. Providers sit behind the LLM engine; adding one is a configuration change, not an architecture change.
5. Keys live in `localStorage` only, are never logged into events, and never appear in exports.

**Acceptance criteria.**
- The app runs end to end with no key configured.
- Swapping engines changes no call site outside the seam.

---

### 0.10 — Project scaffold & conventions

**Goal.** Repository shape, dependency budget, and the conventions later phases assume.

**Dependency budget — deliberately small.** Runtime: a state store, an ID generator, a hashing utility, a force-layout library (Phase 6.6 only). Build: bundler, framework, styling. **No database client, no vector library, no NLP package.** Every capability in the plan is implementable in plain TypeScript, and the dependency count is a design constraint, not an accident.

**Directory conventions.**

```
src/
  substrate/     event log, materialisation, bi-temporal, hash chain, persistence
  ontology/      variables, premise types, aliases, antonyms  (data files)
  extraction/    Phase 1
  reasoning/     Phase 2
  retrieval/     Phase 3
  guards/        Phase 4
  export/        Phase 5
  ai/            engine seam + local/ + providers/
  views/         Phase 6
  eval/          Phase 7
```

**Acceptance criteria.**
- The app boots with an empty log, renders an empty state, and survives a reload.
- A round-trip test exists: append events → materialise → export → import → materialise → assert identical state and head hash.

---

## Diagrams

### D0.1 — Event sourcing pipeline

```
   input                    write path                     read path
   ─────                    ──────────                     ─────────
   transcript ─┐
   user action ┼─► EVENT ─► validate ─► chain hash ─► append ─┐
   guard run  ─┘                                             │
                                                             ▼
                                                     ┌──────────────┐
   UI ◄── projections ◄── fold(pure, total) ◄────────│  EVENT LOG   │
   views                                             │  append-only │
   metrics                                           │  immutable   │
                                                     └──────┬───────┘
                                                            │
                                              snapshot ─────┘ (cache, disposable)
```

### D0.2 — Node lifecycle

```
                        ┌──────────────────────────────────────────┐
                        │                                          │
   PROPOSED ──approve──► ACTIVE ──────────────────────────────────┐│
       │                   │                                     ││
    reject                 │ justification invalidated           ││
       │                   ▼                                     ││
       └────────────► UNSOUND (OUT)                              ││
                           │                                     ││
              ┌────────────┼────────────┬────────────────┐       ││
              ▼            ▼            ▼                ▼       ││
        RE-JUSTIFIED   REVERSED     CONTESTED        ARCHIVED    ││
        (new premise)  (new value)  (human must      (out of     ││
              │            │         adjudicate)      scope)     ││
              └────────────┴────────────┬────────────────┘       ││
                                        ▼                        ▼│
                                     ACTIVE ◄─────────────────────┘│
                                                                   │
   SUPERSEDED ◄────────────────────────────────────────────────────┘
   (retained forever — closed out with validTo, never deleted)
```

### D0.3 — Identity resolution ladder

```
   incoming assertion
          │
          ▼
   exact predicate? ──yes──► MERGE (+corroboration)
          │no
          ▼
   variable+value?  ──yes──► MERGE (+corroboration)
          │no
          ▼
   alias hit?       ──yes──► canonicalise ─► MERGE
          │no
          ▼
   cos ≥ τ_hi?      ──yes──► MERGE (flagged for review)
          │no
          ▼
   cos ≥ τ_lo?      ──yes──► CANDIDATE ──► ask the human
          │no
          ▼
      CREATE NEW NODE
```

---

## Risks

| Risk | Mitigation |
|---|---|
| Event schema churns once extraction exists | Define types from the *reasoning* requirements backwards, not the extraction requirements forwards. Phase 2's needs are the stable ones |
| Bi-temporal fields ignored under time pressure | Enforce in the type layer: node constructors require both timestamps. Make the wrong thing unrepresentable |
| `localStorage` size ceiling | Embeddings live outside the log (0.8); events are tiny; provide JSON export as the escape hatch |
| Ontology too narrow — real decisions don't fit the 14 variables | Include an `OTHER` variable with a free-text slot, and count its usage. If `OTHER` exceeds ~15% of the fixture corpus, the ontology needs extending before Phase 1 is trusted |
| Hash chain implemented but never verified | Verification runs on every load and every import, and surfaces in the Health view. An unverified chain is worse than none |

---

## Definition of done

- [ ] Append-only event log with the closed type vocabulary from 0.1
- [ ] Pure, total fold; projections rebuildable from scratch; round-trip test passing
- [ ] Bi-temporal fields on every node and event; ordering uses valid time; audit uses learned time
- [ ] Identity resolution ladder implemented and tested, including the double-import case
- [ ] Hash chain appended on write, verified on load, verified on import
- [ ] JSON export/import of **events** (not state) reproducing identical head hash
- [ ] Ontology data files: 14 variables, 8 premise types, alias table, antonym table
- [ ] Embeddings stored outside the log, tagged with engine and model, stale-flagged on engine change
- [ ] Engine seam defined; app runs end to end with no key
- [ ] App boots empty, renders an empty state, survives reload
