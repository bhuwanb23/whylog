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
