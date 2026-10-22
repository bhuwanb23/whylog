# Phase 4 notes — executable decision guards

**Status: code-complete.** `python3 scripts/check_structure.py` → **186 source files,
54,336 lines, exit 0**. `src/guards/` is 29 files, 6,341 lines; the Guards view is 1,120 lines.

**Never executed.** No install, no build, no test run — per the standing instruction. Everything
below is a claim about what the code says, not about what it did. Four pre-existing compile
errors were found and fixed by scanning (see §3); there may be more that a scanner cannot see.

---

## 0. Definition of done, line by line

| Criterion | Status | Where |
|---|---|---|
| Eight guard kinds specified; six evaluate deterministically in-browser | ✅ | `types/guards.ts` (contract, pre-declared) · `guards/taxonomy.ts` · `guards/eval/{dependency,path,string,command,llm-judge}.ts` |
| Template synthesis covering ≥80% of fixture decisions; LLM for the remainder, marked as requiring review | ✅ mechanism / ⚠️ **not measured** | `guards/templates/*` — five variables specifically, all fifteen generically. `templateShare()` computes the ratio and the view prints it, but no fixture run has produced the number. |
| Every guard carries a rationale and a severity | ✅ | `templates/index.ts` `dedupe()` **drops** a proposed guard whose rationale is empty rather than passing it on. `synth/llm.ts` `validate()` substitutes a rationale that says the model gave none. |
| Virtual project from pasted `package.json` / listing / contents | ✅ | `guards/project.ts` — JSON manifest, bare dependency map, loose `"name": "version"` lines, `tree` / `git ls-files` / `find` listings, five file-content header shapes |
| Word-boundary string matching; glob scoping | ✅ | `lib/glob.ts` `compilePattern` (already defaulted word-boundary ON in Phase 0) · every string guard carries a glob and is scoped by it |
| All five health metrics, with the baseline pattern and ratchet | ✅ | `guards/metrics/{compliance,coverage,soundness,drift,ratio}.ts` · `guards/baseline.ts` |
| **Guard results enter `REVISE()` as evidence and feed `implementation_cost`** | ✅ | `guards/feedback.ts` → `store/guards.ts` run → `useReasoning.assertAndRevise()`. `store/reasoning.ts` now passes `guards: guardStatusMap(state)` into `ReviseInput`. |
| CI runner + workflow with the rich failure message | ✅ | `guards/ci-export.ts` — standalone Node (stdlib only), Actions workflow, the seven-line failure message |
| Guard review UI with accept / edit / suppress / delete and label inheritance | ✅ | `guards/review.ts` · `views/GuardsView.tsx` |
| **Gate G4**: pasting a `package.json` containing `pg` drops compliance and fires a structural contradiction with no model involved | ⚠️ **runnable, not run** | One button in the Guards view. See §5. |

---

## 1. The thing that makes this phase more than a linter

§4.5 is the ★, and it is one function call.

`store/guards.ts` runs the guards, appends the verification events, then hands each new failure
to `useReasoning.getState().assertAndRevise(assertion)` — **the same entry point a transcript
uses**. `reasoning/assert.ts` was written in Phase 2 with four assertion kinds and one rule: the
`switch` on `source` lives there and nowhere else, so nothing downstream can tell a guard failure
from a human remark.

That is why `implementation_cost` needed no special case. `entrenchmentOf` already accepted an
optional `guards?: GuardStatus`; Phase 4 supplies it. A decision with no accepted guard is
**absent from the map**, so the cost falls back to 0.5 and is reported as UNKNOWN — absent is not
zero, and scoring an unverified decision as cheap to retract would make it the easiest one to
overturn.

Two consequences worth stating plainly:

- **`implementation_cost` is now a measurement.** This is the term no belief-revision system has,
  because none is attached to a codebase.
- **Gate (a) plus a failing guard is a fully deterministic contradiction detector.** The ontology
  says two values are mutually exclusive; a dependency lookup says both are in the tree. No
  embedding, no threshold, no model. That is the strongest available answer to "is this an LLM
  wrapper?" — and the whole loop from synthesis to proposal runs keyless.

---

## 2. Where the ≥80% template claim actually comes from

Not from writing more per-variable templates. From `templates/generic.ts`, which applies three
variable-agnostic strategies to **every** decision:

- **`generic-rejected`** — every rejected alternative must be absent. This is the strongest rule
  in the synthesiser and needs no knowledge of the variable at all: whatever you decided, the
  thing you turned down should not have appeared in the tree since. It is the only generic
  strategy that is *not* flagged `requiresReview`, because it never guesses.
- **`generic-value`** — the chosen value as a dependency or path, if it looks like one. Flagged
  for review, because "use a hexagonal architecture" has no package name and proposing one would
  be proposing noise.
- **`generic-glob`** — the decision's own `applies_to` globs should match something.

So coverage is not five slots deep. The five specific templates contribute the checks a human
would write; the generic ones contribute what holds for any variable. Between them almost every
decision produces something deterministic.

**De-duplication is what makes the cap meaningful.** Two proposals for the same check are one
check, and the higher-confidence one wins. Without it a DATABASE decision would spend all three
cap slots on `dependency_absent: pg` proposed twice — once by the specific template from the
rejected list, once by the generic strategy from the same list — and the connection-string and
artifact checks would never surface.

---

## 3. Four pre-existing compile errors, found by scanning

The structural checker verifies that imports **resolve** and that named exports **exist**. It
cannot see that an identifier is used without being declared — which is a hard compile error. A
string-aware scan over all 186 files found four:

| File | Bug | Since |
|---|---|---|
| `store/reasoning.ts` | `NewEvent<EventType>` used with **neither** name imported | **Phase 2** |
| `ai/llm/index.ts` | `performanceSafeNow()` called in 6 places; declared only in `ai/local/index.ts`, where it is private | **Phase 1** |
| `ai/llm/index.ts` | `ProposedGuard` and `validate` used with no import | Phase 4 — a patch whose target string did not match, so it silently no-op'd |
| `guards/index.ts` | `describeTaxonomy()` **called** while only re-exported | Phase 4 |

The last one is a trap worth remembering: **a re-export does not bind the name in the exporting
module.** Same class as `export * as ns` not flattening names.

`performanceSafeNow` is now `monotonicNow` in `lib/format.ts`, shared by the three modules that
measure durations. Three private copies of a clock fallback would eventually disagree, and a
duration measured against two different clocks is a negative number.

### The checker itself had a bug, and it was worse than silence

`_strip_comments` was `re.sub(r"/\*.*?\*/", "", src)`. Not string-aware.

`templates/hosting.ts` contains the glob `"**/*serverless.yml"`. The stripper read the `/*` inside
that string as a block-comment opening and ate everything to the next `*/` — deleting the
`export function hostingGuards` declaration that followed. The checker then reported a missing
export that was plainly there.

**That is worse than reporting nothing**, because it sends you looking for a bug in the source
instead of in the checker. `templates/database.ts` hit the same way via `"postgres://"`.

Now a character scanner that tracks string state and strips line comments too. Globs like `**/*`
are everywhere in this codebase, so this would have recurred constantly through Phases 4–5.

---

## 4. Skips are never passes

The rule that keeps the whole virtual-project approach honest. Paste a `package.json` and nothing
else:

```
  dependency guards   EVALUATE — the manifest is exactly the data they need
  path guards         SKIP    — no listing, so "no files match" is unknowable
  string guards       SKIP    — no contents
```

If `path_glob_absent` PASSED against an empty listing it would report success for a codebase it
never saw, and compliance would be a measurement of how little the user pasted. So:

- every skip carries a reason naming the missing data and how to supply it
- `GuardRunReport.nothingCheckable` is true when every guard skipped, so a run that checked
  nothing cannot render as a clean run
- compliance counts a decision whose guards all skipped as **not compliant**, but reports it
  separately as `unchecked` rather than folding it into the failures

The same asymmetry runs through the metrics: coverage's denominator is all IN decisions, so an
unverifiable decision lowers coverage even though it never appears in compliance.

---

## 5. How to run gate G4

1. `npm install && npm run dev`
2. **Import & review** → paste `fixtures/demo-transcript.txt` → approve on the local engine,
   keyless. Confirm ≥5 decisions (that is G1).
3. **Guards** → click **Run gate G4**. It:
   - pastes a `package.json` containing `"pg": "^8.11.3"` and `"next": "^15.1.0"`
   - compiles guards from the log's decisions, **templates only** — no model is consulted
   - accepts them in bulk (the gate tests the loop, not the review)
   - runs them

**Passes if:** compliance **drops**, and the **Reasoning** tab shows a proposal whose evidence
quotes the manifest line verbatim.

No model is involved at any step: the guard is a dependency lookup, the contradiction is an
ontology antonym check, and the proposal comes from the deterministic reasoning cycle.

The bulk-accept lives in the view, not the store, on purpose — in normal use each guard is read
first, and a bulk button in the review list would undermine the one rule that keeps a synthesised
guard from failing on day one.

---

## 6. Known gaps and honest limitations

| Gap | Severity | Note |
|---|---|---|
| **Nothing has been executed** | 🔴 | Four compile errors survived Phases 1–2 undetected. Assume more exist. First `npm run dev` will surface them. |
| **G4 has not been run** | 🔴 | The button exists and the manifest is calibrated, but no observed pass. |
| The ≥80% template share is computed, never measured | 🟠 | `templateShare()` and the view print it. The number does not exist yet. |
| `falsifiesPremiseId` attribution is vocabulary overlap | 🟠 | Weak by nature, and deliberately only acted on when exactly one premise matches. Ambiguity is reported, never guessed — a wrong attribution produces a confident, spectacular, entirely wrong cascade. |
| A truncated file listing makes `path_glob_exists` fail and `path_glob_absent` pass | 🟠 | The second is the dangerous one: a false all-clear enters the compliance score. Mitigated by `warning` severity and by reporting every unparseable line, not eliminated. |
| The exported runner transcribes the glob and pattern logic | 🟡 | `ci-export.ts` emits a copy of `lib/glob.ts`'s semantics. They can drift. The guard SET cannot (it is serialised as data), but the predicates can. |
| `llm_judge` reaches the model through `engine.compose` | 🟡 | There is no dedicated judge method on the engine interface, so the rubric travels as a `question` with empty `material`. It works; it is not the cleanest seam. |
| `command_exit_zero` guards are exported but never counted as passing in-browser | 🟢 | Correct behaviour — they always skip here — but it means a log of only command guards shows 0% compliance until CI reports back. |

---

## 7. What Phase 4 did NOT do

- **No shell execution.** `eval/command.ts` never runs a command; it returns a skip naming where
  the guard *can* run. Faking an exit code would be worse than admitting there is no shell.
- **No filesystem or repo connection.** The pasted virtual project is the designed default, not a
  fallback. Automatic discovery is a v2 concern.
- **No auto-installation of guards.** Every guard is `proposed` until a human accepts it, and
  `eval/index.ts` refuses to evaluate a proposed one.
- **No `llm_judge` in compliance.** Structural, not a label: `compliance.ts` filters on
  `isDeterministic(kind)` and there is no path from a judged verdict to the quotient.
- **No new event types.** Editing is delete + re-synthesise, because the 36-type vocabulary is
  closed and adding `GuardEdited` would let a spec change without a record of what it replaced.

---

## 8. Next

**Phase 5 — export.** The `verify` command and the agent-native formats (`CLAUDE.md`,
`.cursorrules`, `AGENTS.md`) compile from the same materialised graph as the guard set, in one
pass, so the two cannot drift. `ci-export.ts` already carries the head hash for exactly that
reason.

Before starting it, run **G2, G3 and G4** locally. G2 and G3 have never been executed either, and
Phase 4 changed `store/reasoning.ts` twice — once to wire gate (b) in Phase 3, once to pass
`guardStatusMap` into `ReviseInput`. A cycle that was code-complete in Phase 2 is not necessarily
still code-complete now.

---

## 10. Verification pass (independent, executed)

Phase 4 was code-complete and **nothing had been executed**. This section records what was run, what broke, and what was fixed. Every number below was measured.

### 10.1 Gates

| Gate | On arrival | After this pass |
|---|---|---|
| `npm run typecheck` | **116 errors** | 0 |
| `npm run check` | 157 errors | 0 errors, 75 warnings |
| `npm test` | 41 (no G4) | **51 passing** (7 files) |
| `npm run build` | failed | builds |
| `npm run check:structure` | **exit 9009** (python3 not found) | exit 0 |
| `npm run verify` | exit 1 | **exit 0** |

The 75 warnings are the intentional `noExcessiveCognitiveComplexity` ones (Phase 4 adds 18 of them), plus one deliberate `useExhaustiveDependencies` and one unused suppression. No errors.

### 10.2 The revert, fifth time

Phase 4 arrived as a pre-verification snapshot of Phases 0/1/2 again. Every Phase 2 and Phase 3 fix was gone: `selfHash`, `byTemporalValidDesc`, `decisionOutcomes`, `decisionKeyOf`, `originOf`, `isOnTopic`, `disclosure`, `resolveQueryOptions`.

**This time the revert and the Phase 4 work were in the SAME commit** (`6817b4c`), so a three-way merge could not separate them: the merge base has to be a commit whose content the revert *restored*, and the reverted content was never committed — it came from the tooling's stale copy.

The separation is by **blob identity**: a reverted file's content is byte-identical to the content it had at some earlier commit, so the earlier commit is the merge base for that file. 203 files reconciled — 159 restored from their revert source, 22 new files taken as they are, 12 genuinely mixed (Phase 4 work *on top of* a revert) merged with `9e623f4` as the base. Zero conflicts.

**Five phases, five reverts, one cause: the tool that writes phase N reads a snapshot taken before phase N-1 was verified. It must read the committed tree.**

### 10.3 Defects in Phase 4's own code

1. **`src/guards/index.ts` — `AttributedGuard` re-exported from the wrong module.** It is the templates module's type (a guard paired with the source that produced it), not one of the shared contracts in `./types`. Re-exported from `./templates` instead.
2. **`src/guards/index.ts` — `MetricsResult` exported twice.** It is declared in this module, and the `export type { ... MetricsResult }` line conflicted with the declaration.
3. **`src/guards/synth/llm.ts` and `src/guards/eval/llm-judge.ts` — `engine.capabilities` used as a property.** It is a method: `capabilities(): EngineCapabilities`. The code read `engine.capabilities.guardSynthesis`, which is `undefined` at runtime — so the "this engine cannot synthesise guards" branch never fired and the LLM path was attempted regardless.
4. **`src/store/guards.ts` — `overCapDecisions(state: GuardState)` ignored its parameter** and read the global store instead, while the view called it with no argument. A view that memoises on one state must not be answered from another. Now takes the `GraphState` and uses it.
5. **`src/store/guards.ts` — `whylog.log.head?.hash`.** `EventLog` has `headHash: string`, not `head`. The CI export was recording `"unknown"` as the head hash.
6. **`src/store/guards.ts` — `mintGuardId(decisionId, index)` with a number** where the suffix is a string.
7. **`src/store/guards.ts` and `src/guards/project.ts` — index-signature access.** `noPropertyAccessFromIndexSignature` is on; `record.dependencies` must be `record["dependencies"]`.
8. **`src/store/guards.ts` — `templatesOnly: options.templatesOnly`** with `boolean | undefined` passed to an optional property under `exactOptionalPropertyTypes`. Now a conditional spread.
9. **`src/substrate/materialize.ts` — `firstFailedAt: undefined`** to clear an optional field. Under `exactOptionalPropertyTypes` the key has to be REMOVED, not set to undefined: `{ firstFailedAt: _cleared, ...rest }`.
10. **`src/ai/llm/index.ts` — the LLM accumulator pushed into `LlmExtraction`'s readonly arrays.** The accumulator is now built from mutable arrays and assembled once.
11. **`src/store/reasoning.ts` — `get().run()`** in a module-level function, where `get` is not in scope. `useReasoning.getState().run()`.
12. **`src/substrate/materialize.ts` — the `linkHash` import, `Premise.justifications`, and `provenance` were lost** with the revert and had to be restored.

### 10.4 Two real bugs in the loop, both found by running G4

**A. The stored proposal's evidence was the boilerplate.**

`RevisionProposed` did not carry the evidence at all. The fold reconstructed it from `event.reason` — and the reason is the *"Not applied automatically. This conclusion came from extracted prose…"* note. So every proposal in the log quoted the boilerplate and claimed it came from a transcript, while the evidence the reasoning cycle had actually computed was discarded.

The event now carries `evidence: { quote, source, confidence }`, and the fold stores it. The quotes are real spans again ("switch to\n—\nNoted: SQLite").

**B. The guard's verbatim evidence never reached the proposal.**

`GuardRunResult.evidence` is documented as *"Non-optional on `fail`: this string is quoted into the revision proposal, because evidence without a quote is not evidence."* It was not. The proposal quoted the decision's transcript snippet — the thing that turned out to be wrong, rather than the proof that it was.

Now: a guard failure records its line on the premise it falsifies (`PremiseEvidence.quote`), and a drift finding — one with no premise to quote — takes the failing guard's own `lastRun.evidence`, preferring an **absence** check over a presence check. An absence check that fails is the contradiction (the decision excluded this and the project contains it); a presence check that fails is drift (the decision was not implemented yet). The contradiction is the evidence worth quoting.

Every proposal now reads `source: "guard"` and quotes the manifest line character for character.

### 10.5 The baseline was not reset on a paste — a silent all-clear

`loadProject` kept the existing baseline. The baseline records the failures that were known when it was frozen, and it is keyed by **guard id** — and guard ids are derived from the **decision id**, so the same log produces the same ids whatever project is pasted.

The consequence: **run G4 twice and the second run reports nothing.** Every failure is in the baseline, so `newViolation` is false, so no assertion is made, so no proposal appears, and compliance reads 0 for a different reason than the first time. A user who pasted a second project would see no new violations against it — exactly the "false all-clear" the notes call the dangerous one.

`loadProject` now clears the baseline. A baseline describes ONE project; pasting another means nothing is known about it yet, and the user freezes again on purpose.

### 10.6 G4, executed

`tests/integration/gate-g4.test.ts` — 6 tests, all passing.

| Measure | Value |
|---|---|
| Guards synthesised (templates only) | **53** |
| Guard kinds | `dependency_present`, `dependency_absent`, `path_glob_exists` |
| Outcomes | 23 fail · 15 skip · 15 pass |
| Compliance score | **0** (0 compliant, denominator 6) |
| Decisions failing | WLD-0014 … WLD-0019 |
| Revision proposals | **23** from the run (49 in the log) |
| Proposal evidence | all `source: "guard"`, quoting the manifest verbatim |

The verifier is fully deterministic. No embedding, no threshold, no model: the guard is a dependency lookup, the contradiction is an ontology antonym check, and the proposal comes from the deterministic reasoning cycle.

The evidence for the DATABASE decision reads, character for character:

```
"pg": "^8.11.3" found in package.json dependencies.
```

### 10.7 The three flagged items

1. **§3.6's rule order.** The antonym test is first, all five verdicts are reachable, and the deviation is documented in STRUCTURE.md §18.3 rather than silently reconciled. Confirmed.
2. **The classifier consolidation.** `ai/local/classify.ts` is a thin delegate to the canonical engine rather than a second implementation. Confirmed — and it is now protected: the reconciliation keeps the delegate, not the duplicate.
3. **The checker's blind spot.** Real, and it is worth stating precisely: the checker validates that import paths RESOLVE and that named exports EXIST. It cannot see an identifier that is used but never declared, because that is a type-level fact and the checker is not a type checker. `tsc` sees it immediately, which is why the gate runs `typecheck` first. The heuristic scan was the right call.
4. **The checker's comment stripper.** `_strip_comments` was a regex, and `hosting.ts` contains the glob `**/*serverless.yml` — the stripper read `/*` as a block comment, ate through to the next `*/`, and deleted the export declaration. It then reported a missing export that was plainly there, which sends you hunting the source instead of the checker. Now a character scanner.

### 10.8 `implementation_cost` is a measurement — confirmed

The entrenchment breakdown for a decision with an accepted guard reads `implementationCost: 0.6667`, `implementationCostUnknown: false`. A decision with no accepted guard is absent from the map and stays at 0.5 / UNKNOWN. Absent is not zero, and scoring an unverified decision as cheap to retract would make it the easiest one to overturn.

### 10.9 Known gaps that remain

| Gap | Severity | Note |
|---|---|---|
| `falsifiesPremiseId` attribution is vocabulary overlap | — | Weak by nature, and deliberately only acted on when exactly one premise matches. Ambiguity is reported, never guessed. |
| A truncated file listing makes `path_glob_exists` fail and `path_glob_absent` pass | — | The second is the dangerous one: a false all-clear enters the compliance score. Mitigated by `warning` severity and by reporting every unparseable line. |
| The `docs/` and `plan/` prose still carries residual mojibake | — | Cosmetic, and the repair tool is in the tree. The code is clean. |
| `src/` is 44,410 lines rather than 40,888 | — | The reconciliation restored 159 files from the pre-compaction baseline, so the compaction pass over them is undone. Verified cosmetic (trailing commas only). |
