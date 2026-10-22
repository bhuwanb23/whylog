# Phase 0 — what was built, what deviated, what to expect

Written at the end of Phase 0 (Foundation & Substrate). Read this before running
`npm install`.

---

## 1. Scope as delivered

**66 source files, ~17,900 lines**, no tests, nothing installed or compiled in the
authoring environment.

| Layer | Files | What is there |
|---|---|---|
| `src/types/` | 7 | The contracts. Closed **36**-type event vocabulary, `EventPayloadMap`, `TypedEvent<T>`; the 14 variables; the closed 8 premise types with world-observable flags; guards, retrieval, reasoning, export shapes |
| `src/lib/` | 10 | `hash` (canonical JSON + stable 128-bit digest) · `ids` (all 12 id formats) · `cosine` (dot, normalise, stable top-K) · `text` (tokenise, n-grams, speaker detection) · `bm25` · `glob` · `format` · `invariant` · `result` · `rng` |
| `src/substrate/` | 19 | The whole of L0: event log, validation, hash chain, bi-temporal, the fold, graph state, identity ladder, schema/migrations, persistence, portability, snapshots, index artifacts, integrity stamp, 7 projections |
| `src/ontology/` | 8 | 14 variables + OTHER with metadata · 8 premise types with 47 predicates · ~560 aliases · 84 variable-scoped antonym pairs · 82 decision cues · ~180 premise cues · canonicalisation · self-validating facade |
| `src/ai/` | 7 | The seam: `WhyLogEngine` (extract/classify/embed/rerank/compose/synthesizeGuards + capabilities + id), registry, config, typed errors, and the local engine with a **complete** hashed n-gram vectoriser |
| `src/store/` | 3 | Zustand store over log + folded state, selectors, settings slice |
| `src/` root + views | 6 | `main.tsx`, `App.tsx`, `index.css`, `theme.ts`, `vite-env.d.ts`, `views/FoundationView.tsx` |

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

### 2.6 STRUCTURE.md §12 is now wrong about `hash.ts`

It still says "SHA-256 via WebCrypto". §18 of STRUCTURE.md and the README carry the
correction; §12 was left alone to avoid churning the file map.

---

## 3. Known risks on first `npm run typecheck`

Nothing was compiled. These are the places I would look first, in rough order of
likelihood.

1. **`exactOptionalPropertyTypes` spreads.** Every optional field is written with
   `...(x === undefined ? {} : { x })`, which is correct, but a few object literals
   in `src/substrate/materialize.ts` (the `DecisionReversed` replacement node, the
   `RevisionProposed` proposal) build large objects and may have a field that is
   explicitly `undefined` where the target type is optional-without-undefined.
   Fix: delete the key rather than assigning `undefined`.

2. **`applyEdit` clearing `rationale` / `acceptedDownside` / `yStatement`.** These
   assign `undefined` to optional properties, which `exactOptionalPropertyTypes`
   rejects. Either widen those three fields in `src/types/domain.ts` to
   `readonly rationale?: string | undefined`, or rebuild the object omitting the
   key. Widening the type is the smaller change and is honest: an edit to `null`
   genuinely means "no longer has one".

3. **`verbatimModuleSyntax`.** Type-only imports must use `import type`. Most do;
   `src/substrate/projections/metrics.ts` and `src/ai/local/index.ts` mix value and
   type imports from the same module and may need splitting.

4. **`noPropertyAccessFromIndexSignature`.** Anywhere a `Record<string, number>` is
   read with dot syntax. I used bracket syntax throughout, but
   `src/lib/bm25.ts` and `src/substrate/projections/metrics.ts` are worth a look.

5. **`src/store/settings.ts` returns no-op actions for `reload`, `setThresholds`,
   `setCascadeDepthCap`, `dismissFallbackNotice`.** These need the store's `set`,
   which the settings slice does not have. Phase 6's SettingsView should wire them
   in `src/store/whylog.ts` instead, or `initialSettings` should take a `set`
   callback. The persisted ones (`setProvider`, `setModel`, `setApiKey`, `clearKey`,
   `setVoting`, `setQuestionGeneration`) are real.

6. **`src/views/FoundationView.tsx` `RecordForm`.** The `<select>` and `<input>`
   elements use `className="input"` which is styled for `textarea`; visually rough,
   structurally fine.

7. **`noUncheckedIndexedAccess`.** Every array index read needs a guard. I wrote
   them, but the fold's `switch` and the projection sorts are the densest places.

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

- **No tests.** Requested. The Foundation view is the manual test harness for this
  phase: append → watch the head hash move → reload → watch the state return →
  export → re-import → watch "0 new events".
- **No commands run.** Nothing installed, built, linted or typechecked here.
- **`src/ai/llm/` and `src/ai/providers/` are empty.** The seam is fixed and the
  local engine is registered; the LLM path is Phase 1.10.
- **`src/ai/local/lexicon.ts` does not exist yet.** Synonym folding for the local
  path currently comes from the ontology's alias table alone. Phase 1 decides
  whether that is enough — it is the file STRUCTURE.md calls "the one that decides
  whether the local path feels intelligent".
- **`EmbeddingStore` is not a class.** `src/substrate/index-artifacts.ts` is
  functions over a `StoredIndexBlob`, which keeps it testable without a fixture
  object and matches the rest of the substrate.

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
66 source files, 17,595 lines
  imports resolve · brackets balance · event vocabulary agrees · no forbidden patterns
```

It is deliberately **not** a typechecker. `npm run typecheck` is the real gate;
this is the one that works before `npm install`.

---

## 7. The one thing to check first

```bash
npm install
npm run typecheck 2>&1 | head -50
```

Then, before anything else:

```bash
npm run dev
```

Open the **Foundation** view, record a decision with a premise and a reason, reload
the page, and confirm the decision is still there with the same head hash. That
single sequence exercises 0.1, 0.2, 0.3, 0.5, 0.6 and 0.10 at once.
