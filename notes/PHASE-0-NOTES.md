# Phase 0 — what was built, what deviated, what to expect

Written at the end of Phase 0 (Foundation & Substrate). Read this before running
`npm install`.

> **Update — verification pass.** Phase 0 was first written without ever being
> compiled, linted or run. A verification pass then found and fixed a set of
> defects that made the phase *not* work end to end. The list is in **§7**. Read
> that before touching the substrate: several of the fixes change the event
> schema.

---

## 1. Scope as delivered

**66 source files, ~19,300 lines**, 2 test files.

| Layer | Files | What is there |
|---|---|---|
| `src/types/` | 8 | The contracts. Closed **36**-type event vocabulary, `EventPayloadMap`, `TypedEvent<T>`; the 14 variables; the closed 8 premise types with world-observable flags; guards, retrieval, reasoning, export shapes |
| `src/lib/` | 10 | `hash` (canonical JSON + stable 128-bit digest) · `ids` (all 12 id formats) · `cosine` (dot, normalise, stable top-K) · `text` (tokenise, n-grams, speaker detection) · `bm25` · `glob` · `format` · `invariant` · `result` · `rng` |
| `src/substrate/` | 22 | The whole of L0: event log, validation, hash chain, bi-temporal, the fold, graph state, identity ladder, schema/migrations, persistence, portability, snapshots, index artifacts, integrity stamp, 7 projections |
| `src/ontology/` | 9 | 14 variables + OTHER with metadata · 8 premise types with 47 predicates · ~560 aliases · 84 variable-scoped antonym pairs · 82 decision cues · ~180 premise cues · canonicalisation · self-validating facade |
| `src/ai/` | 8 | The seam: `WhyLogEngine` (extract/classify/embed/rerank/compose/synthesizeGuards + capabilities + id), registry, config, typed errors, and the local engine with a **complete** hashed n-gram vectoriser |
| `src/store/` | 4 | Zustand store over log + folded state, selectors, settings slice |
| `src/` root + views | 5 | `main.tsx`, `App.tsx`, `index.css`, `theme.ts`, `vite-env.d.ts`, `views/FoundationView.tsx` |
| `tests/` | 2 | `unit/substrate/round-trip.test.ts` (8 tests) · `unit/substrate/boot-reload.test.ts` (3 tests) |

Acceptance criteria 0.1–0.10 are all implemented. `views/FoundationView.tsx` renders
them as working controls rather than as prose, so each one can be exercised by hand.

---

## 2. Deviations from the plan, and why

Recorded here because each one changes something a later phase will assume.

### 2.1 The vocabulary is 36 types, not 35

`GuardRan` and `GuardFailed` are separate event types. The plan's count treated a
failure as a run with a bad result; but a failure carries `firstFailedAt` and
`falsifiesPremiseId`, and `falsifiesPremiseId` is what routes the failure to gate
(c) rather than gate (a). Making those optional fields on `GuardRan` would mean
every consumer of run history has to narrow a union anyway. `GuardFailed extends
GuardRanPayload` keeps the shared shape and lets the fold handle the two cases
differently.

### 2.2 `src/lib/hash.ts` is synchronous and non-cryptographic

The plan said SHA-256 via WebCrypto. `crypto.subtle.digest` is **async**, and an
async hash makes `fold()` async, which makes every projection async, which makes
every selector async, which makes the store async. That is not a local cost — it
poisons all five layers above the substrate.

So the chain uses cyrb128, a synchronous 128-bit digest, and `canonicalJson` sorts
object keys so that export → import reproduces an identical head hash regardless of
key insertion order.

The chain is a **tamper-evidence** mechanism, not a security one: the threat model
is "did an event get silently edited, reordered or dropped", and a 128-bit digest
answers that. If it ever needs to be a security property, swap `hash128` and
nothing else changes — every caller goes through `hashEvent`/`linkHash`.

### 2.3 `ValidityWindow` uses `valid` / `learned` / `invalidFrom`

Not `validFrom` / `validTo` / `learnedAt`. `invalidFrom` is paired with
`invalidatedBy` (the event id) and `reason`, so a closed window says what closed it
and why. `firstLearnedAt` from the plan is **derivable** from the log — it is the
`learned` of the first event touching the node — and storing it on the node would
create a field the fold has to keep from being overwritten. `src/substrate/bi-temporal.ts`
is written against the real shape.

### 2.4 Derived fields are rebuilt per fold, not maintained incrementally

`sharesPremiseWith`, corroboration, the review queues, guard label-inheritance and
the metrics map are all recomputed in `finalise()` after the event loop. They are
functions of the whole graph, so maintaining them across 36 event types is exactly
where a replay and an incremental append would drift apart — and that drift is
invisible until a round-trip produces a different head hash.

Cost: one extra pass per fold. At 10⁴ events that is still well inside the 10 ms
budget.

### 2.5 `DecisionReversed` mints a new node

The payload carries `newValue` but no new id, so the fold closes the old node and
creates a replacement linked by `supersedes`/`supersededBy`. Nothing is deleted
(I1), and the export compiler needs the pair linked in order to drop the superseded
rule rather than ship both — shipping both is precisely the "the model may pick one
arbitrarily" failure.

### 2.6 STRUCTURE.md §12 was wrong about `hash.ts`

It said "SHA-256 via WebCrypto". §18 of STRUCTURE.md and the README carried the
correction; §12 was left alone to avoid churning the file map. **Fixed during the
verification pass** — §12 now says cyrb128 over canonical JSON and explains why.

### 2.7 Events carry a `selfHash`

The plan's §0.5 says an edited event must fail verification "at that index". It
did not, because the mechanism — a per-event content hash — was designed
(`ChainViolation.kind` already declared `"self-hash-mismatch"`) and never built.

`DomainEvent` now carries `selfHash`: the hash of its own content, excluding
`prevHash` and `selfHash`. `verifyChain` reports a mismatch **at the edited
event**, and a new append rule (rule 7) rejects a pre-sealed event whose content
no longer matches.

The chain's hash values are unchanged — `selfHash` **is** the value `linkHash`
was already hashing. What changes is that the chain can now name the event that
was edited, including the last one. Full detail in **§3.2**.

---

## 3. The verification pass — what was broken and what was fixed

Phase 0 was written without ever being compiled, linted or run. A verification
pass then ran the real gates. The result was **32 type errors, 117 lint/format
errors, a failing test script, and one defect that made the whole product
non-functional**. All are fixed. The items a later phase will feel are these.

### 3.1 The one that mattered: `fold()` threw on every event

`src/substrate/materialize.ts` imported `GENESIS_HASH` from `./hash-chain` but
called `linkHash` — which it never imported. TypeScript caught it (TS2304 × 3);
nothing else did, because nothing had ever been run.

The effect: `fold()`, `applyToState()` and `applyBatch()` all threw
`ReferenceError: linkHash is not defined` on the **first** event. The app could
not record anything, and the round-trip guarantee the plan's Phase 0 DoD names
could not hold. An empty log folded fine, which is exactly why a manual
click-through of the empty state would have looked healthy.

### 3.2 The event schema gained a `selfHash`

The plan's §0.5 acceptance criterion says: *"Editing any historical event's
payload causes verification to fail **at that index**"*.

The implementation did not do that. `prevHash` is excluded from the hash input,
so an event's own hash lives only in the *next* event's `prevHash` — editing
event 1 was reported at index 2, blaming the wrong event. Editing the **last**
event in the chain was not detected by `verifyChain` at all; it was only caught
by comparing the declared head hash, which is a different check with a
different message.

`ChainViolation.kind` already declared `"self-hash-mismatch"`. The machinery
was designed and never built.

It is now built. Every event carries `selfHash` — the hash of its own content,
excluding `prevHash` and `selfHash`. `verifyChain` recomputes it and reports a
mismatch **at the edited event**. A new append rule (rule 7) rejects a
pre-sealed event whose content no longer matches its hash.

**Consequences a later phase must know:**

- `DomainEvent` has a new required field. Anywhere an event is constructed
  *outside* `seal()` — `src/substrate/hash-chain.ts` `sealEvents` /
  `appendEvent` — must compute it. `sealOne()` is the helper.
- `selfHash` is computed over content only, so it **survives a re-link**.
  `reseal()` in `src/substrate/portability.ts` changes `prevHash` and leaves
  `selfHash` alone, which is what lets it keep working as tamper evidence.
- The chain's hash *values* are unchanged. `linkHash` was already
  `hash(prevHash : hashEvent(event))`, and `selfHash` **is** `hashEvent(event)`.
  Nothing that was already written changes value.
- `coerceEvent` now requires `selfHash`, so a file written by a build that
  predates this change is refused on import. Nothing has shipped; there is
  nothing to migrate.

### 3.3 The structural checker was broken on Windows

`scripts/check_structure.py` compared repo-relative paths built with
`str(Path.relative_to(...))` — backslashes on Windows — against an allowlist
written with forward slashes. Every comparison silently failed, so the checker
reported three false violations on every run, including the two files it
explicitly allows to name `apiKey` and the one file allowed to use
`Math.random`. `rel()` now uses `.as_posix()`.

The checker's own "it is not a typechecker" caveat is right and still applies.

### 3.4 Smaller ones, in the order they bit

| Defect | Effect |
|---|---|
| `src/store/settings.ts` imported `EngineConfig` from `@/ai/types` | It lives in `@/ai/config`. The whole settings slice failed to typecheck. |
| `initialSettings()` omitted the required `wantsLlm` field | Same. |
| `src/ai/config.ts` `fromStored()` read `stored.provider` even when `engineKind` was `"local"` | A locally-running log reported `provider: "openai"`. The type error that flagged it was the only thing standing between the app and a misleading badge. |
| `src/store/whylog.ts` read `outcome.validation.message` off a union | Not narrowed; would have thrown on the success branch of the type. |
| `compare(byValidDesc, byIdAsc)` in three files | `Decision` and `Premise` nest valid time under `temporal`, so the flat comparator never applied. Added `byTemporalValidDesc`. |
| `exactOptionalPropertyTypes` violations in `materialize.ts` (6), `edges.ts` (1), `FoundationView.tsx` (1) | Fixed by **omitting the key**, not by assigning `undefined` — "no rationale" is the absence of the field, not a field holding nothing. |
| `src/substrate/projections/decisions.ts` cast a `PremiseId` to a `DecisionId` | A branded-type confusion that silently typechecked. |
| `src/ai/config.ts` / `App.tsx` / `FoundationView.tsx` value imports of types | `verbatimModuleSyntax` violations. |
| `headlineNumbers(state, now)` and `queryTerms(state, query, …)` took parameters they never used | Removed. Neither had a caller; a parameter a function ignores is a lie about its dependencies. |
| `biome.json` enabled `useLiteralKeys` | Directly contradicts `noPropertyAccessFromIndexSignature` in `tsconfig.app.json`. The TypeScript setting is the stricter one and the codebase follows it, so the Biome rule is off. |
| `package.json` had no `check:structure` script | The notes claimed it was wired. It was not. It is now. |
| `package.json` had `scaffold:regen` pointing at `scripts/gen_scaffold.py` | The file does not exist, and `python3` is not a command on Windows. Removed. |

---

## 4. What is stubbed, and what "stubbed" means here

Only three function bodies return an empty result rather than doing work, and each
is a Phase 1+ deliverable wired to the seam that was fixed in Phase 0:

| Function | Returns | Filled in by |
|---|---|---|
| `LocalEngine.extract` | empty `ExtractionResult` | Phase 1 — `src/ai/local/{normalize,segment,cues,decisions,premises,alternatives,negation,modality,confidence}.ts` |
| `LocalEngine.classify` | the structural verdict if one was passed in, else `neutral` | Phase 2 — `src/ai/local/classify.ts` |
| `LocalEngine.synthesizeGuards` | empty, with an `unverifiableReason` | Phase 4 — `src/guards/templates/` |

`LocalEngine.embed` is **complete** — it is the 0.8 deliverable, and the index it
feeds is real. `compose` is a working template implementation, not a stub; Phase 3
replaces the templates with fuller ones.

An empty result rather than a throw is deliberate: it lets the app boot, render and
be clicked through with no key, which is acceptance criteria 0.9 and 0.10.

---

## 5. Deliberate omissions

- **The test suite is two files, not a full one.** The plan's Phase 0 DoD names
  exactly one required test — the round-trip — and that is what
  `tests/unit/substrate/round-trip.test.ts` is, plus the invariants around it.
  `tests/unit/substrate/boot-reload.test.ts` covers criterion 0.10. The rest of
  the suite in `STRUCTURE.md` §15 is the plan for later phases.
- **`src/ai/llm/` and `src/ai/providers/` are empty.** The seam is fixed and the
  local engine is registered; the LLM path is Phase 1.10.
- **`src/ai/local/lexicon.ts` does not exist yet.** Synonym folding for the local
  path currently comes from the ontology's alias table alone. Phase 1 decides
  whether that is enough — it is the file STRUCTURE.md calls "the one that decides
  whether the local path feels intelligent".
- **`EmbeddingStore` is not a class.** `src/substrate/index-artifacts.ts` is
  functions over a `StoredIndexBlob`, which keeps it testable without a fixture
  object and matches the rest of the substrate.
- **Four settings actions are still no-ops** (`reload`, `setThresholds`,
  `setCascadeDepthCap`, `dismissFallbackNotice`) — they need the store's `set`,
  which the settings slice does not hold. Phase 6's SettingsView should wire them
  in `src/store/whylog.ts`. The persisted ones (`setProvider`, `setModel`,
  `setApiKey`, `clearKey`, `setVoting`, `setQuestionGeneration`) are real.

---

## 6. The structural checker

`scripts/check_structure.py` runs with no dependencies — no `node_modules`, no
TypeScript, nothing installed. Wired as `npm run check:structure`.

It verifies four things that are cheap to break and expensive to find later:

1. every `@/…` and relative import resolves to a file that exists;
2. brackets balance once comments, strings, template literals (including `${}`
   nesting) and regex literals are stripped — an unbalanced file usually means a
   paste truncated it;
3. the type-level `EventType` union in `src/types/events.ts` and the runtime
   `EVENT_TYPES` list in `src/substrate/event-validation.ts` agree exactly. They
   are duplicated on purpose, and drift between them means an event can be
   constructed but never appended, or appended but never folded;
4. `apiKey` is named only in the three modules allowed to name it, and
   `Math.random` appears nowhere outside `src/lib/rng.ts`.

Current status:

```
66 source files, 19,305 lines
  imports resolve · brackets balance · event vocabulary agrees · no forbidden patterns
```

It is deliberately **not** a typechecker. `npm run typecheck` is the real gate;
this is the one that works before `npm install`.

---

## 7. The gates, and what they are now

```bash
npm install
npm run verify        # typecheck + biome check + vitest  — the pre-push gate
npm run check:structure
npm run build
npm run dev
```

All four are green as of the verification pass:

| Gate | Before | After |
|---|---|---|
| `npm run typecheck` | 32 errors | 0 errors |
| `npm run check` (Biome) | 117 errors, 15 warnings | 0 errors, 15 warnings |
| `npm test` | exits 1 — "No test files found" | 11 tests, all passing |
| `npm run build` | fails at `tsc -b` | builds in ~0.8 s |
| `npm run check:structure` | 3 false violations (Windows path bug) | clean, exit 0 |

The 15 remaining Biome warnings are all
`noExcessiveCognitiveComplexity` on functions that are inherently branchy — the
fold's 36-case dispatch, the identity ladder, the cascade walker — plus one
non-null assertion in `src/theme.ts`. They are warnings by configuration, not
errors, and the rule is set to `warn` deliberately: a 112-complexity dispatch
switch is a fact about a 36-event vocabulary, not a defect.

---

## 8. The one thing to check first

```bash
npm install
npm run verify
```

Then, before anything else:

```bash
npm run dev
```

Open the **Foundation** view, record a decision with a premise and a reason, reload
the page, and confirm the decision is still there with the same head hash. That
single sequence exercises 0.1, 0.2, 0.3, 0.5, 0.6 and 0.10 at once.

`tests/unit/substrate/round-trip.test.ts` and
`tests/unit/substrate/boot-reload.test.ts` assert the same properties
automatically, so the click-through is now a demonstration rather than the only
evidence.
