# The test suite — 172 tests, 13 files, all green

**Date:** 2026-10-24 · follows `notes/TYPECHECK-PASS.md` and `notes/FUNCTIONAL-PASS.md`

`npm run test` · **172 passed, 0 failed** · `tsc -b` reports **0 errors over `src/`, `tests/` and
`scripts/`** · `check_structure.py` exit 0 · `demo:verify` exit 0.

This reverses the earlier standing instruction not to write tests. It was written after the
functional pass, and that ordering is why the suite is useful: every test knows what it is guarding.

---

## 1. What runs

| tier | command | files | tests |
|---|---|---|---|
| unit — substrate | `npm run test:unit` | 3 | 55 |
| unit — extraction | | 2 | 21 |
| unit — reasoning | | 1 | 12 |
| unit — retrieval | | 1 | 22 |
| unit — guards | | 1 | 12 |
| integration | `npm run test:integration` | 3 | 30 |
| e2e | `npm run test:e2e` | 1 | 20 |
| **all** | **`npm run test`** | **13** | **172** |

`vitest run` takes ~10 s. `--passWithNoTests` is gone from both `test` and `test:coverage`.
CI runs the three tiers as separate steps so a red build names the tier that broke: a unit failure is
a logic regression, an integration failure is a handoff between stages, an e2e failure means the demo
itself will not run.

`tsconfig.app.json` includes `tests/`, so **the suite is statically checked too**. That mattered:
vitest strips types and ran happily with eight type errors in the test files, including a
`templateGuards` call missing a required field and an indexed-access cast that needed
`NonNullable<…>`. A test suite the compiler does not read is a suite that rots silently.

---

## 2. Design rules the helpers enforce

**Nothing is built by hand.** `tests/helpers/events.ts` seals every draft through the real
`appendBatch`, and `seal()` **throws** on rejection rather than returning a partial chain. A test that
hand-assembles a sealed event — minting its own id, timestamp and `prevHash` — tests its own
fabrication, and a test that silently builds on a rejected event reports a pass for a graph that does
not exist.

**Every graph comes from the real pipeline.** `helpers/graph.ts` builds by sealing then `fold`ing. No
test constructs a `GraphState` literal, because a hand-built state can satisfy an invariant the fold
would never produce.

**Fixtures represent a REVIEWED graph.** `sqliteGraph()` emits `PremiseConfirmed` for the two quoted
premises. Without them every premise is `UNKNOWN`, every justification invalid and every decision
OUT — correct behaviour (I4: the system proposes, the human disposes), but it tests a graph nobody
has accepted yet and proves nothing about gate (c). The derived premise is deliberately left
unconfirmed: confirming an exclusion would put an OUT-list node IN and invalidate the justification
at birth.

**Clocks never rewind.** The falsification helper does not call `resetClock()`. The log enforces
monotonic learned time, so an event stamped before the ones it invalidates is rejected — correctly.
Rewinding the clock to make a test pass would test a log that cannot exist.

---

## 3. The regression tests, and the bugs they name

Each of these guards something found in the previous two passes. Every one is commented with the bug
it exists for, because a regression test that does not say what regressed gets "fixed" by whoever
next finds it inconvenient.

| test | the bug |
|---|---|
| `event-validation` — *"rejects an event whose reason was REMOVED"* | Five of six `commit.ts` drafts had no `reason` key. Rule 2 rejects an absent reason for **every** event type, so the whole commit path failed while type-checking happily |
| `gate-c` — *"justifications are edges, not nodes"* | `labels.get(justification.id)` was always `undefined`: the graph is bipartite over decisions and premises (I2). Every filter that depended on it skipped everything — audit found nothing, nogoods blocked nothing |
| `gate-c` — both `validityOf` clause tests | An IN-list failure and an OUT-list arrival invalidate identically and read completely differently. The verdict names the clause, so both are asserted separately |
| `bi-temporal` — comparator tests | `byValidDesc` was constrained on a top-level `valid` that no node has; nodes carry `temporal.valid`. The canonical timeline order did not typecheck against a `Decision` at all |
| `evidence-contract` — budget clamp | `MAX_SEARCHES` was a module constant with no per-run override, so the ablation's `maxSearches` sweep declared a knob the code could not accept. Clamped to `[1, MAX_SEARCHES]`: a caller may spend less than the contract, never more, and zero would refuse every question before searching |
| `evidence-contract` — `stopReason` precedence | Thin-and-not-exhausted is `EMPTY`; thin-and-cut-off is `BOUNDED`. Different failures, different fixes |
| `guards/synthesis` — *"capabilities is a METHOD"* | `engine.capabilities.guardSynthesis` read a property off a function: always `undefined`, so LLM judging and LLM synthesis were unconditionally refused **on every engine including a real one** |
| `guards/synthesis` — *"returns the drafts it documents"* | `synthesiseAll` returned `drafts: []` hardcoded. Guard count was 0 everywhere; beat 7 had nothing to show; `guards:ci` exported an empty runner |
| `guards/synthesis` — id shape | The store passed a raw index where a letter belonged, minting `G-00070` instead of `G-0007a` and disagreeing with `nextFreeSuffix` |
| `extraction/decisions` — rationale markers | `because`, `since`, `so that`, `in order to`, `as long as` sat in `DECISION_CUES` above the weight floor. Every decision fired twice → one true decision scored as one FN **and** one FP |
| `extraction/decisions` — strongest mention | Keeping the first mention recorded the agent's proposal instead of the human's acceptance: wrong span, wrong modality, understated `source_authority`, which feeds entrenchment, which decides what gets retracted |
| `extraction/decisions` — value before variable | The variable was guessed before the value was known, so the episode's topic outvoted the value: `"sqlite"` landed in SCOPE, `"vite"` in ARCHITECTURE. A mis-slotted decision costs an FN and an FP at once |
| `extraction/decisions` — bare values | `pickValue`'s fast path accepted `strength === "bare"` values its own fallback rejected: `"it's the thing"` became `AUTH → "thing"` |
| `full-pipeline` — `rawRange` | `Chunk.rawRange` is documented as RAW and used to highlight in the review pane, but turns carry NORMALISED offsets. The chunker copied them through, so highlighting pointed at the wrong slice whenever noise was collapsed — silently, and only on messy transcripts |
| `full-pipeline` — `turnOffsets` | Computed and never returned, so a field the interface declared did not exist at runtime |
| `round-trip` — identical head hash | Export → import must reproduce the same chain; `canonicalJson` sorting keys is what makes that reproducible rather than insertion-order-dependent. Also asserts a tampered file is **refused, not repaired** |
| `keyless` — `fetch` is never called | "Works with no API key" has to be a behaviour, not a claim. A spy rather than a throwing stub, so if some path does reach for the network the assertion names it |
| `e2e` — `report.demoable === true` | A regression in any automatic demo check turns CI red instead of waiting to be discovered on stage |

---

## 4. The headline test

`tests/integration/gate-c-cascade.test.ts` is the one `plan/OVERVIEW.md` G2 asks for, and it passes:

```
before:  single_user IN · sqlite IN · pooling IN · migration IN
falsify  scale.single_user            (no decision mentioned, no contradiction raised)
after:   sqlite   → not IN            (gate (c): its IN-list premise died)
         pooling  → not IN            (cascade: shares the premise)
         migration → STILL IN         (survivor: shares nothing)
```

`revise()` is asserted to return **drafts**, not a graph — with explicit
`expect(revised.state).toBeUndefined()`, because the harness once read a `.state` that does not exist
and so scored every gate against the pre-revision graph, making the cascade look like a no-op that
always passed. Idempotence is asserted as well: a second pass over a log that already recorded the
first pass's findings emits no `LabelChanged`.

---

## 5. One deliberately red-by-design test

`extraction/decisions.test.ts` pins a **known gap** with `it.fails`:

> a weak cue still adopts a value from elsewhere in the episode — `DATABASE → "hackathon"` with the
> snippet `"fine."`. The value has no mapping to any variable, so `resolveVariable` falls back to the
> episode's topic and slots it as DATABASE.

Marking the five rationale cues stopped *them* from minting decisions; this is a different weak cue in
the same sentence. The principled fix is to refuse a value that is not a known value for the variable
the *context* chose — when the value itself carries no variable evidence, the topic alone should not
be enough to mint a node. That is a recall/precision trade worth making deliberately rather than
inside a test-writing pass.

`it.fails` passes while the bug exists and starts **failing** the moment it is fixed, which is the
reminder to delete it. A skipped test would have hidden the gap; a red one would have normalised red.

---

## 6. What is not covered, and why

- **Components and views.** `vitest.config.ts` excludes `src/components/**` and `src/views/**` from
  coverage by configuration. The logic they render is tested where it lives — the store, the
  projections, the reasoning layer. Component tests would need `@testing-library/react`, which is not
  installed, and would mostly assert JSX structure.
- **Guard precision on seeded violations.** Still `n = 0`: it needs a fixture *repository* whose state
  breaks a decision, labelled with which guard should catch it. A transcript corpus contains no
  repository state. This is roadmap work and is recorded in `LIMITATIONS.md`.
- **The LLM path.** Every test runs on the local engine. The provider adapter is exercised only by
  type-checking; a live-model test needs a key and belongs in the manual pass, not CI.
- **`EVALUATION.md` and `pitch/03-metrics-card.md` still hold their `▢▢▢` placeholders.** A test
  suite proves mechanisms; it does not produce the corpus numbers, and the current baseline
  (decision F1 0.226, false-positive rate 102.9/100) is a diagnostic rather than a claim.
