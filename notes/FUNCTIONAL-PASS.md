# The functional pass — WhyLog runs, and the thesis mechanism works

**Date:** 2026-10-24 · follows `notes/TYPECHECK-PASS.md`
**Result:** 274 files, 73,402 lines · `tsc -b` **0 errors** · `check_structure.py` **exit 0** ·
`npm run demo:verify` **exit 0** · `npm run eval` runs and writes `docs/generated/EVAL-REPORT.md`.

The typecheck pass made the project compile. This pass made it *work*. Every finding below was
located by executing the eval and reading the numbers, not by inspection — which is the only reason
they were found at all, because four of them are code that is type-correct, runs without error, and
silently produces nothing.

---

## 1. Plan-completeness audit

| check | result |
|---|---|
| Sub-phases declared across `plan/phase-0`…`phase-7` | **71**, all present |
| File paths referenced by the plans that do not exist | **0** |
| `check_structure.py` (274-file inventory, imports, exports, cycles, event vocabulary) | **exit 0** |
| Views routed in `App.tsx` | 11 of 11 |
| npm scripts whose target file is missing | 0 |

The plan is built. What was not built correctly is below.

---

## 2. The five functional bugs, in the order they were found

Each one was type-correct and ran without throwing. Each one silently produced nothing.

### 2.1 `synthesiseAll` returned `drafts: []` — hardcoded

Its own doc comment says *"The `GuardSynthesised` events to append. Every guard is PROPOSED."* It
returned an empty list, because `SynthesiseAllInput` carried no `actor` and no `at`, and an event
without them is not an event. The store pushed `all.drafts` into its batch and nothing arrived.

**Effect:** guard count was **0** everywhere. Guard precision reported NOT MEASURED, synthesis rate
read 0%, `guards:ci` exported an empty runner, and demo beat 7 had nothing to show — `demo:verify`
stopped with `[FAILED] guards-proposed-not-failing`.

**Fix:** `SynthesiseAllInput` gained optional `actor`/`at`; with both present the function builds a
`GuardSynthesised` draft per proposed guard, using the same `usedSuffixCount` → `letterFor` →
`guardIdFor` chain `synthesiseDecision` already used. Absent, it stays report-only, which is what a
read-only dashboard wants. The store's bulk branch now passes them.

**Result:** guards **0 → 93**, synthesis rate **0% → 100% (34 of 34 decisions)**, determinism share
**100% (93 deterministic, 0 llm_judge)**. All three I4 invariant checks stayed at zero: no guard
auto-accepted, no stale `disabledByDecisionLabel`, no skip counted as a pass.

### 2.2 The harness never emitted `JustificationAttached`

The harness has its own draft builders and reimplemented a subset of `commit.ts` — omitting
justifications entirely. So `state.justifications.size === 0`: the graph held decisions and premises
with **nothing connecting them**.

**Effect:** no OUT-list existed anywhere, so the graph was **monotonic**. Gate (c) was structurally
incapable of firing, which zeroed premise-invalidation recall, cascade correctness and survivor
preservation — *the three metrics with no published comparator*, and the entire reason this is not
another decision log. A monotonic graph cannot be fixed by tuning; it has no mechanism to fix.

**Fix:** the harness now emits `JustificationAttached` after the decisions (a justification's
consequent is a decision id and its lists are premise ids, so both must be minted first). The IN/OUT
split copies the rule from `commit.resolvePremiseRefs` — an OUT-list entry is one **inferred** from a
supporting premise rather than quoted, which `premise-linker.ts` records in its text via the
`— excluded by` marker. Copied rather than imported because that function resolves queue items by
human action, and the harness never acts as a human. A decision with no premise at all gets **no**
justification: an empty one would be vacuously valid and report a decision that rests on nothing as
sound forever.

**Result:** non-empty OUT-lists **0 → 9** · L2 invalidation recall **0.000 → 1.000** · cascade
correctness **0.000 → 0.500** · contradiction records **11 → 41** · demo-killer "False premise
resolution" **FAIL → PASS** (`demo1/d1 went unsound as expected`).

That last one is the demo's peak beat: *"Nothing contradicted me. I never said the word database. The
world moved, and the log noticed."* It now happens.

### 2.3 Five rationale markers were minting decisions

`because`, `since`, `so that`, `in order to` and `as long as` were in `DECISION_CUES` at weights
0.40–0.50, above `MIN_CUE_WEIGHT = 0.35`. They mark the *why* beside a decision, not the decision.
`rationale.ts` and `premise-cues.ts` already own them for the jobs they are for.

**Effect:** every real decision fired twice — once on its own cue, once on the rationale clause —
producing a second candidate with a different span and often a different variable. The matcher could
not align it, so **one true decision scored as one false negative plus one false positive**. That is
most of why 25 labelled decisions became 53 extracted ones.

**Fix:** a new optional `rationaleOnly?: boolean` on `DecisionCue`, set on those five, checked at the
top of `recoverOne`. They stay in the table because they are good **episode boundary** markers and
`segmentEpisodes` reads it — `recoverOne` just returns `null`, not a discard, because this was never
a decision cue to begin with. Optional so the other 115 cues carry no redundant flag.

### 2.4 The first mention of a decision won, not the strongest

`recoverDecisions` kept whichever cue fired first per (variable, value) key. A decision is negotiated
across turns: an agent floats it early (*"I'd use SQLite"*), the human settles it later (*"going with
SQLite, not Postgres"*). The proposal won.

**Effect:** the node recorded the **proposal's** span, modality and origin authority — so a decision a
human accepted was stamped as an agent proposal. That understates `source_authority`, which feeds
entrenchment, which decides what gets retracted. It also pointed provenance at the wrong sentence, so
the review pane highlighted a suggestion rather than the acceptance, and the label (which quotes the
acceptance) never overlapped it.

**Fix:** keep the strongest mention by cue weight, ties to the earlier one. Weight is exactly "how
reliably does this phrase mark a real decision" — `going with` (0.90) outranks a bare `use` (0.60),
which is the ordering the table was written to express.

### 2.5 Two gates disagreed about the same word

`pickValue`'s fast path accepted a value on `score >= MIN_VALUE_SCORE` **even when
`strength === "bare"`** — while the fallback ten lines below explicitly rejects bare values as *"a
failed extraction, not a low-confidence one."*

**Effect:** `"it's the thing"` became `AUTH → "thing"`; `"it's a local"` became
`ARCHITECTURE → "local"`. Ordinary words minted as decision values.

**Fix:** the fast path now honours the same rejection.

### 2.6 Two smaller ones

- **The variable was guessed before the value was known.** `variableAtCue` accepts a `valueHint` and
  `resolveVariable` scores the value first — but `decisions.ts` called it with no hint, then used the
  result to canonicalise the value. Circular, so the episode's *topic* outvoted the value itself:
  `"sqlite"` landed in **SCOPE**, `"vite"` in **ARCHITECTURE**. A mis-slotted decision is not cosmetic
  — the matcher requires the variable to agree and the identity ladder refuses to merge across slots,
  so it costs a false negative and a false positive at once. Now: provisional guess → pick the value
  → re-resolve the variable with the value as evidence.
- **`DecisionVariable` compared against lowercase strings.** `demo/verify.ts` checked
  `decision.variable === "database"`; the members are UPPERCASE. `checkSeedHasSqlite` could never
  match, so the demo's own seed check always failed.

---

## 3. Metric movement

| metric | first run | now |
|---|---|---|
| Decision extraction P/R/F1 | 0.083 | **0.226** |
| Premise extraction P/R/F1 | 0.193 | 0.193 |
| Alternative extraction precision | 0.026 | 0.000 |
| Contradiction recall (L1) | 0.250 | **0.500** |
| **Premise-invalidation recall (L2)** | 0.000 | **1.000** |
| **Cascade correctness (L3)** | 0.000 | **0.500** |
| Survivor preservation | 0.000 | 0.000 |
| False-positive rate / 100 decisions *(lower is better)* | 84.9 | **102.9** ⚠ |
| Answer groundedness | 0.000 | 0.000 |
| Retrieval precision@5 | 0.000 | **0.050** |
| Retrieval MRR | 0.000 | **0.083** |
| Guard precision | NOT MEASURED, 0% synthesis | NOT MEASURED, **100% synthesis** |
| Modality precision | 0.667 | 0.500 |

Demo-killers **2/4 → 3/4**. `demo:verify` **exit 1 → exit 0** (7 VERIFIED, 2 MANUAL, three
consecutive dry runs identical on labels and ids).

---

## 4. What is still wrong, and why the FP rate got *worse*

**False-positive rate rose 84.9 → 102.9 per 100 decisions** (41 contradiction records over 34
decisions). This is not a regression — it is the first time the reasoner had any input. Before §2.2
there were no justifications, so gates (a) and (c) had nothing to evaluate and the reasoner was
silently inert. Now it runs, and it **over-fires**.

That is risk **R3** from `plan/OVERVIEW.md` ("false-positive contradictions destroy trust") and
**R2** ("cascade cries wolf"), arriving exactly as predicted. It is a *tuning* problem, which is what
the ablation harness was built for — and the thresholds were declared before any run, so the delta
table can now say something real.

Remaining, in the order I would take them:

1. **Contradiction over-firing (41 over 34 decisions).** Gates (a)/(b)/(c) thresholds. Highest value:
   it is the metric a user feels, and it is the one that gets a tool switched off.
2. **Survivor preservation 0.000 with 0 over-retractions.** Both zero means the two expected
   survivors were never *resolvable* — the cascade scored FAILED rather than over-firing. Check
   whether `l03`'s survivors are extracted at all before touching the cascade.
3. **Answer groundedness 0.000** while mean groundedness is 0.743 — the *verdicts* are wrong, not the
   citations. Likely the verdict thresholds against a retrieval set that is too thin.
4. **Retrieval precision@5 0.050 / MRR 0.083.** Now downstream of extraction recall: `resolver.decision(key)`
   returns null for any label that never matched a node, so `relevantIds` is empty and precision is
   structurally 0 for that question. Fixing recall moves this without touching retrieval.
5. **Alternative precision 0.000** over n=8 — the sample is small enough that this is one alignment.

---

## 5. Deliberately not changed

- **`EVALUATION.md` and `pitch/03-metrics-card.md` keep their `▢▢▢` placeholders.** L2 at 1.000 over
  **n=1** is a demonstration that the mechanism fires, not a rate. Gate G6 asks for numbers worth
  claiming; a single planted case is not one, and the honest notes in the report already say so.
- **No test files** (standing instruction) · **the five monolithic views stay monolithic** ·
  **`fixtures/expected/` stays empty** (verbatim quotes are stronger ground truth than golden files).
