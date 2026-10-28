# The typecheck pass — and the first time WhyLog was ever executed

**Date:** 2026-10-24
**Before:** 274 files, 72,870 lines, never compiled, never run.
**After:** 274 files, 73,191 lines, **`tsc -b` reports 0 errors**, and `npm run eval` + `npm run demo:verify` both execute end to end.

---

## 1. Why this pass was possible at all

The standing instruction was not to install anything. That instruction was given on the assumption
that installs were slow and that the sandbox had no room. Checking first showed otherwise:

| tool | state |
|---|---|
| node | v20.20.2 present |
| npm | 10.8.2 present |
| disk | 21 GB free |

The user was asked and chose **"install TypeScript only"**. `src/` turned out to import only
`react`, `react-dom`, `zustand`, `node:fs` and `node:path` from outside the repo, so the install was
`typescript react react-dom zustand @types/react @types/react-dom @types/node` — 178 MB, 24 seconds.
`tsx` arrived as a transitive dependency, which is what made *running* the eval possible too.

`node_modules/` is excluded from workspace snapshots, so none of this persists into the repo.

---

## 2. What `check_structure.py` could not see

The structural checker verifies that imports **resolve** and named exports **exist**. It is
regex-based, so it is blind to three whole classes of defect. Every one of them was present:

| class | count | example |
|---|---|---|
| **Syntax errors** — the file does not parse | 3 files, 7 errors | `ci-export.ts:468` used unescaped backticks *inside* the 250–537 `RUNNER_BODY` template literal, terminating it early |
| **Wrong contract** — a real name, the wrong shape | ~120 | `ReviseResult` has no `.state`; `CommitInput.actor`'s shape matched no variant of `Actor` |
| **Dead-by-typing** — code that compiles to a no-op | ~12 | `input.engine.capabilities.classification` — `capabilities` is a **method**, so this read a property off a function and got `undefined` |

Two of the three syntax errors were in files written during the *validation* pass
(`scripts/export_guards.ts`'s dependency `verify-command.ts`, and `ci-export.ts`) — i.e. the code
added to close the last gaps had gaps of its own.

---

## 3. The build-breakers (would have failed on any machine)

1. **`tsconfig.json` had no `paths`.** It is a Vite solution file (`"files": []` + references), and
   `tsx` reads *that* file, not `tsconfig.app.json`. Every `tsx`-based npm script — `eval`,
   `eval:report`, `eval:ablation`, `demo:verify`, `guards:ci` — died with
   `ERR_MODULE_NOT_FOUND: Cannot find package '@/extraction'`. Fixed by adding `baseUrl`/`paths` to
   the root config, which `tsc -b` ignores but `tsx` needs.
2. **Three files did not parse.** Nothing downstream of them could build.
3. **`tsconfig.app.json` set `types: ["vite/client"]`**, which excludes `@types/node`. That is
   *correct* for the browser bundle, but `src/eval/` is a Node-side harness that uses `node:fs` and
   `process.argv`. Rather than weaken the browser project, `src/eval/**` was moved to
   `tsconfig.node.json` (verified first: nothing in the app imports it).

---

## 4. Real behavioural bugs found — not type noise

These are the reason the pass was worth doing. Each one is a thing the system would have done
*silently wrong* at runtime.

| # | file | bug | consequence if unfixed |
|---|---|---|---|
| 1 | `guards/eval/llm-judge.ts:81`, `guards/synth/llm.ts:75` | `engine.capabilities.X` instead of `engine.capabilities().X` | LLM judging and LLM guard synthesis were **always** refused, on every engine including a real LLM |
| 2 | `extraction/commit.ts` ×5 | `reason` omitted from 5 of 6 event drafts | Validation **rule 2** rejects every event without a non-empty reason → the entire commit path fails, nothing can ever be recorded |
| 3 | `extraction/commit.ts:109` | `CommitInput.actor` typed `{kind:"human"\|"engine", id}` — no such `Actor` variant exists | The parameter could never be passed by any caller |
| 4 | `reasoning/audit.ts:389`, `reasoning/backtracking.ts:182` | `labels.get(justification.id)` — a justification is **not a node**; the graph is bipartite over decisions and premises (I2) | The lookup was always `undefined`, so the filter `continue`d on **every** justification: audit found nothing, and nogoods were recorded empty and blocked nothing. Now uses `validityOf()` — Doyle's actual condition |
| 5 | `substrate/bi-temporal.ts:146,152` | `byValidDesc` constrained on a top-level `valid`; nodes carry `temporal.valid` | The comparator could never accept a `Decision` or `Premise` — the canonical timeline order did not typecheck at all |
| 6 | `store/guards.ts:278` | `mintGuardId(id, index)` passing a **number** where a letter suffix belongs | Minted `G-00070` instead of `G-0007a`, disagreeing with `nextFreeSuffix` and `formatGuardId` — a collision waiting to happen |
| 7 | `eval/harness.ts` ×3 | `revised.state` / `revised.proposals` — `ReviseResult` returns **drafts**, not a graph | The harness never appended or re-folded, so it scored every gate against the **pre-revision** graph: the cascade looked like a no-op that always passed |
| 8 | `eval/harness.ts:179` | `...(toggles.voting ? {} : {voting: undefined})` — the pipeline treats *absent* as off | The voting ablation toggle was inert in **both** positions |
| 9 | `eval/demo/verify.ts` ×3 | `decision.variable === "database"` — `DecisionVariable` members are UPPERCASE | `checkSeedHasSqlite` could never match; the demo's own seed check always failed |
| 10 | `extraction/chunking.ts:130` | `turn.rawStart` — turns carry **normalised** bounds | `Chunk.rawRange` (documented as raw, used to highlight in the review pane) held normalised offsets — wrong highlight on every messy transcript, silently |
| 11 | `substrate/projections/decisions.ts:88`, `views/GraphView.tsx:167` | `premiseId as DecisionId` on maps keyed by `PremiseId` | The cascade's first hop and the graph's premise panel looked up the wrong key space |
| 12 | `views/HealthView.tsx:191,349` | `verification.ok` (field is `valid`); `case "agent_proposed"` (member is `agent_proposed_human_accepted`) | Health always reported one thing; an origin branch could never fire |
| 13 | `store/reasoning.ts:452` | `get()` called from a **module-level** function | `relabelAfterAction()` threw on every call — six actions depended on it |
| 14 | `extraction/queue-build.ts`, `resolution.ts` ×6 | `action` omitted from every `ResolvedCandidate` | `action` is the I4 gate — the only route from a candidate to an event |
| 15 | `retrieval/evidence-contract.ts` | `MAX_SEARCHES` was a module constant with no per-run override | The ablation's `maxSearches` sweep declared a knob the code could not accept. `SearchTrace` now takes a budget, clamped to `[1, MAX_SEARCHES]` |

**Error trajectory:** 273 → 170 → 144 → 128 → 124 → 111 → 107 → 100 → 73 → 62 → 54 → 44 → 37 → 28 → 12 → **0**.

---

## 5. First execution — the real numbers

`npm run eval` now runs. It writes `docs/generated/EVAL-REPORT.md` (32 KB) and exits **1 by design**:
`run.ts:99` sets a non-zero exit when the hardening pass is not ready, and it is not.

| metric | value | n |
|---|---|---|
| Decision extraction P/R/F1 | **0.083** | 19 |
| Premise extraction P/R/F1 | **0.193** | 16 |
| Alternative extraction precision | **0.026** | 8 |
| Contradiction recall (L1) | **0.250** | 4 |
| Premise-invalidation recall (L2) | **0.000** | 1 |
| Cascade correctness (L3) | **0.000** | 2 |
| Survivor preservation | **0.000** | 2 |
| False-positive rate per 100 decisions | **84.9** (lower is better) | 53 |
| Answer groundedness | **0.000** verdict accuracy, mean groundedness 0.743 | 8 |
| Retrieval precision@5 | **0.000** (achievable ceiling 22.5%) | 8 |
| Retrieval MRR | **0.000** | 6 |
| Guard precision | **NOT MEASURED** (synthesis rate 0%) | 0 |
| Modality precision | **0.667** | 6 |

Hardening: **NOT READY**, 2 of 4 demo-killers passing.
`npm run demo:verify` independently **stops** at the same place:
`[FAILED] guards-proposed-not-failing — No guards synthesised. Beat 7 has nothing to show.`

### Reading these honestly

These are a **diagnostic baseline, not a result to pitch.** They must not go into
`EVALUATION.md` or `pitch/03-metrics-card.md` as achievements — the placeholders there stay until
the numbers are worth printing. What they *are* is the first ground truth about a system that had
never been executed, and they localise the work precisely:

- **`0 justifications carry a non-empty OUT-list`** is the single most important line in the report.
  Without an OUT-list the graph is *monotonic*, so gate (c) is structurally incapable of firing and
  L2, cascade and survivor-preservation are all guaranteed zeros. The exclusion machinery itself is
  correctly wired (`premise-linker.deriveExclusion` → `local/extract.ts:168` → the
  `— excluded by` marker → `commit.resolvePremiseRefs`), so the break is upstream: either
  `primaryExclusion(predicate)` matches no rule for this corpus's predicates, or premise extraction
  is too weak (F1 0.193) to produce the premises that would trigger one.
- **53 decisions extracted against 25 labelled, at precision 0.083**, plus 45 structural
  contradictions, says the extractor over-produces and the matcher almost never aligns a label with a
  node. The most likely cause is a **span coordinate mismatch** — labels resolve against `raw`,
  extraction snippets may be in normalised coordinates — which is the same class of bug as #10 above.
  Worth checking first, because it would depress *every* extraction and retrieval metric at once.
- **Retrieval 0.000 against a 22.5% ceiling** is consistent with the same coordinate problem, or with
  the index being built over nodes whose spans do not match the questions.
- **Guard synthesis 0%** is what stops the demo. It is the central novelty claim, so it is the one
  that cannot stay at zero.

### Suggested order

1. Span coordinates — one fix could move extraction, retrieval and groundedness together.
2. Guard synthesis — unblocks beat 7 and the demo.
3. Exclusion rules coverage — unblocks the entire non-monotonic story (L2, cascade, survivors).
4. Contradiction over-firing (45 over 53 decisions) — gates (a)/(b) thresholds.

---

## 6. Deliberately *not* changed

- **`EVALUATION.md` and `pitch/03-metrics-card.md` keep their `▢▢▢` placeholders.** Gate G6 requires
  numbers that are *worth claiming*. A baseline of 0.083 F1 is a diagnostic, not a pitch. Filling the
  card with these would be worse than leaving it blank.
- **The five monolithic views stay monolithic**, per the standing decision.
- **`tests/` stays empty**, per the standing instruction.
- **`fixtures/expected/` stays empty** — the corpus quotes are stronger ground truth than golden files.
