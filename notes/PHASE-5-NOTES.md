# Phase 5 notes — agent-native export compiler

**Status: code-complete.** `python3 scripts/check_structure.py` → **210 source files,
59,626 lines, exit 0**. `src/export/` is 22 files, 4,107 lines; the Export view is 757 lines.

**Never executed.** No install, no build, no test run — per the standing instruction. Six real bugs
were found during this build (five of them mine, one pre-existing from Phase 4); see §4. Assume
more exist that a scanner cannot see.

---

## 0. Definition of done, line by line

| Criterion | Status | Where |
|---|---|---|
| Canonical intermediate form; five emitters as pure functions of it | ✅ | `cif.ts` builds it; every emitter takes `(ExportCif, stampBlock)` and never touches the graph. `ci-guards` is the exception and is documented as one — it needs guard records, not a document. |
| All six agent-optimized properties on every emitted record | ✅ mechanism / ⚠️ **not observed** | `record.ts` builds all six; `checkSixProperties()` audits one record and the view renders the ticks. No fixture run has produced the table. |
| **Verify commands generated from Phase 4 guards** | ✅ | `verify-command.ts` compiles from `state.guards` in the same pass. Two shapes — see deviation 6. |
| **Rejected-alternatives block with premise status, including contested annotation** | ✅ | `rejected-block.ts`. Contested entries sort FIRST, because a rejection under review is the one an agent is most likely to be right about revisiting. |
| Priority-ranked, two-tier, budget-aware emission with a live indicator | ✅ | `priority.ts` (the plan's exact weights) · `budget.ts` · rendered in the view |
| Integrity stamp on every artifact; mismatch detection on re-import | ✅ | `stamp/{hash,index,verify}.ts`. Four distinct failure reasons, each with its own remedy. |
| **Pre-export consistency gate that blocks on conflict and annotates on failing guards** | ✅ | `consistency-gate.ts`. Delegates detection to gate (a)'s `wouldContradict`. |
| Round-trip export → import reproducing identical decisions and IDs | ✅ **for JSON** / ⚠️ **lossy for Markdown, and says so** | JSON: `substrate/portability.ts` (Phase 0), exact. Markdown: `round-trip.ts`, id-then-content resolution, merge as refinement. |
| **Gate G5 passes** | ⚠️ **checked mechanically, never run** | `checkGateG5()` in `ExportView.tsx` — nine string predicates over the compiled `CLAUDE.md`, each printing its evidence. |

---

## 1. What is actually novel here, stated plainly

Multi-format export is **not** the claim. `ai-memory rules --target agents-md` ships it and
`AGENTS.md` is in 60,000+ projects. Emitting Markdown is table stakes, and the view says so in its
own header rather than waiting to be accused.

Three things in this phase are not table stakes:

**1. Verify commands compiled from the decision.** Every agent-optimized ADR spec asks for one. In
every tool surveyed, a human writes it — and then it drifts from the decision it was supposed to
check, because nothing connects the two. Here it is compiled from the same Phase 4 guards, in the
same pass over the same graph, so there is no second source to drift from.

**2. A gate that refuses to export a self-contradictory log.** Nobody does this. It is the only
place in the whole product where truth maintenance **prevents** an outcome rather than reporting one
for a human to read. Everywhere else it produces a finding; here it stops a file reaching an agent's
context window. That is the moment the two pillars visibly interlock, and it is worth saying on
stage.

**3. The rejected-alternatives block with premise status.** The highest-value block in the file and
the one no competitor emits, because none of them index rejected alternatives first-class. And it is
not a blacklist — each entry says whether the reason still holds, so a rejection whose premise has
been falsified reads as an invitation to revisit rather than a rule to obey.

---

## 2. Two CIFs, and why that is still one pass

§5.3 requires that nothing superseded reaches the agent files, and §5.2 requires DECISIONS.md to
carry full ADR narrative including history. One CIF cannot be both filtered and unfiltered.

So `compiler.ts` builds two, from the **same graph snapshot in the same call**:

- **agent CIF** — OUT and superseded excluded, ~200-line budget, tier 1 inline / tier 2 index
- **human CIF** — nothing excluded, budget sized to the log so everything lands inline

The single-pass guarantee is about reading the graph once, and it holds. What changed is the
phrasing of the emitter rule: emitters are pure functions of **a** CIF, not of **the** CIF. None of
them reads the graph, which is the property that keeps five formats from drifting.

DECISIONS.md additionally needs fields the agent record does not carry — the Y-statement, the
accepted downside, what a decision supersedes and what shares its premises. Those arrive as a
`narratives` map the compiler builds once, so the emitter stays pure. Letting it read the graph
would have been convenient and would have created a second compiler.

---

## 3. The stamp is applied last, and the digest covers the body only

A digest cannot cover the stamp that contains it — that is circular. So each artifact is assembled
in a fixed order:

```
  1. render the body with an empty stamp slot
  2. digest the body
  3. render the stamp block, embedding that digest
  4. append it
```

`stamp/verify.ts` strips the stamp before digesting on the way back in, so the two agree. Digesting
a placeholder instead — which is what the first draft did — would produce a stamp that fails
verification the moment anyone checks it.

**Four failure reasons, not one.** Conflating them makes the remedy unclear:

| Reason | Means | Fix |
|---|---|---|
| `head-mismatch` | the log has moved on | re-export |
| `missing-stamp` | not a WhyLog file, or the stamp was removed | trust nothing in it; re-export |
| `schema-incompatible` | written by a build whose stamp shape this cannot parse | refusing is correct — guessing reads a zero as a count |
| digest mismatch (reported as `head-mismatch` with digests) | the log has NOT moved but the file changed | **someone edited it in place** — worth finding out who |

The last is the one a head hash alone cannot detect, and it is the interesting one: an agent that
rewrites a rule without superseding it has done exactly what the anti-re-litigation line exists to
prevent.

**Described as auditability everywhere, never as security.** The hash is unsalted and the algorithm
is in the source, so an agent that rewrites the file can rewrite the stamp too. That sentence is in
the stamp footer itself, in the view, and in the notes — because a lie about security is worse than
no security: it stops the user checking.

---

## 4. Six bugs found during the build

| File | Bug | Origin |
|---|---|---|
| `store/guards.ts` | CI export stamped with `whylog.log.head?.hash`. `EventLog` has no `head` object — the field is `headHash`. The optional chain made it silently `undefined`, so **every CI export was stamped `"unknown"`** | **Phase 4** |
| `emitters/shared.ts` | `renderStatus` called but never imported | Phase 5 |
| `round-trip.ts` | **Module-level mutable array** collecting rejected-alternative rows. Parsing two files in one session would attribute the first file's rejections to the second's decisions — invisibly, since each parse looks individually plausible | Phase 5 |
| `round-trip.ts` | Source head hash taken from `verification.found`, which is **inverted**: a successful verification reports no `found`, because nothing was wrong | Phase 5 |
| `compiler.ts` | `formatExportId(state.counters.exports ?? 0 + 1)` — precedence makes that `?? 1`, so every export in a session would take id `X-0001` | Phase 5 |
| `ci/index.ts` | Fabricated a stamp full of zeros for CI artifacts instead of using the real one | Phase 5 |

The first is the most instructive. It shipped in Phase 4, passed the structural checker, and would
have passed a test that only asserted "a runner was emitted". The failure is silent by construction:
`?.` turns a wrong field name into `undefined` rather than an error.

The second is the same checker blind spot as the four Phase 4 cases — it validates that imports
**resolve**, not that every identifier used is **declared**. The string-aware scan catches it. That
scan has now found real compile errors in four consecutive phases, which is the argument for running
it rather than trusting `tsc` to be run later by someone else.

---

## 5. How to run gate G5

1. `npm install && npm run dev`
2. **Import & review** → paste `fixtures/demo-transcript.txt` → approve, keyless (G1)
3. **Guards** → synthesise, accept a few, run them against a pasted `package.json` (G4)
4. **Export** → **Compile all targets** → **Check gate G5**

The check runs nine predicates over the compiled `CLAUDE.md` and prints ✓ or ✗ with the evidence for
each: a record exists · MUST/MUST NOT · `applies_to` · `Because:` with premise IDs · rejected
alternatives · a runnable `Verify:` · `Status:` · the stamp · the anti-re-litigation line.

**Step 3 matters.** Two of the nine predicates depend on Phase 4 having run: the verify command
exists only if a guard was synthesised *and accepted*, and the status line's guard counts are empty
otherwise. Running G5 on a log with no accepted guards will show `Verify: none — UNVERIFIABLE`,
which is correct behaviour and a failed gate at the same time — the gate is about the loop closing,
not about the compiler rendering.

---

## 6. Known gaps and honest limitations

| Gap | Severity | Note |
|---|---|---|
| **Nothing has been executed** | 🔴 | Six bugs survived to review in one phase. First `npm run dev` will surface type errors the scan cannot see. |
| **G5 has never been observed passing** | 🔴 | The check is mechanical and the predicates are right, but no artifact has been compiled. |
| `.cursor/rules/*.md` is not emitted | 🟠 | Only the single-file `.cursorrules`. The split layout is a directory with front-matter globs — a different output shape and download flow. Recorded as v2 in the emitter header rather than half-built. |
| The Markdown round trip is lossy | 🟠 | By nature, and stated in the merge plan. Snippets, spans, confidence and learned times were never in the Markdown. Use the JSON export when fidelity matters. |
| `parseDecisionsMd` only parses OUR format | 🟡 | Keyed on `## WLD-…` headings. A hand-written ADR file will not parse, and should not: guessing at a structure nobody specified is how a merge invents decisions. |
| The CI runner transcribes `lib/glob.ts` semantics | 🟡 | Inherited from Phase 4. The guard SET cannot drift (serialised as data) but the predicates can. |
| Priority weights are unvalidated | 🟢 | The plan's numbers, printed in the view. Nobody has measured whether 0.35 on soundness picks the decisions a reader would have picked. |

---

## 7. What Phase 5 did NOT do

- **No silent dropping.** A blocked export names both sides of every conflict. An excluded decision
  is listed with its reason. An unparseable line in an import is reported, not skipped.
- **No auto-committed imports.** Records resolved as `new` are proposed, never committed — invariant
  I4. An import that silently created decisions could rewrite the log from a Markdown file.
- **No emitter reads the graph.** Not even DECISIONS.md, which needs the most extra data and gets it
  as a pre-built narrative map.
- **No second CI exporter.** `export/ci/*` wraps Phase 4's `guards/ci-export.ts` and adds only the
  export-pass header. Two exporters would be two things to keep in sync with the runner they invoke.
- **No claim of tamper-proofing.** Anywhere.

---

## 8. Next

**Phase 6 — presentation**, then **Phase 7 — evaluation**. Four views are still placeholders
(timeline, conflict, health, and the graph), and the remaining gates G1–G5 have all been built but
none executed.

**Before any of it: run the gates.** G2, G3, G4 and G5 are all code-complete and none has been
observed. Five phases of never-executed code is 59,626 lines that have only ever been checked by a
structural linter and two heuristic scans. The first `npm run dev` is the highest-value thing
available right now, and it is more likely to find problems than any further phase is to add value.

---

## 10. Verification pass (independent, executed)

Phase 5 was code-complete and **nothing had been executed**. This section records what was run, what broke, and what was fixed. Every number below was measured.

### 10.1 Gates

| Gate | On arrival | After this pass |
|---|---|---|
| `npm run typecheck` | **116 errors** | 0 |
| `npm run check` | 157 errors | 0 errors, 84 warnings |
| `npm test` | 41 | **58 passing** (9 files) |
| `npm run build` | failed | builds |
| `npm run check:structure` | **exit 9009** (python3 not found) | exit 0 |
| `npm run verify` | exit 1 | **exit 0** |

The 84 warnings are the intentional `noExcessiveCognitiveComplexity` ones (Phase 5 adds 18 of them), plus one deliberate `useExhaustiveDependencies` and one unused suppression. No errors.

### 10.2 The tree did not compile

Three syntax errors, in three different shapes, and each one is a mistake worth naming:

1. **`src/retrieval/index-levels/l5-premises.ts:144` — a string literal with unescaped quotes.** `Serves "what assumes X?"` inside a double-quoted string ends the literal. Now a template literal.
2. **`src/guards/ci-export.ts:468` — a bare backtick inside a template literal.** The `RUNNER_BODY` template opens at line 250 and should close at 537, but the comment inside it contains `` `--decision WLD-0007` `` — and the first backtick TERMINATES the template. The apostrophe in *decision's* then opens an unterminated string. The backticks are escaped now.
   This is the same class of bug as the `**/*serverless.yml` glob the comment stripper used to fall over on: **a backtick or a `/*` inside generated text, where the generator does not expect one.**
3. **`src/export/verify-command.ts:147` — a trailing comma inside a parenthesised expression.** `return ( expr, )` is not an argument list; the comma is a syntax error.

### 10.3 The revert, sixth time, and how it is now separated

The tree arrived as a pre-verification snapshot of Phases 0/1/2 again, with every verified fix deleted. This time the revert and the Phase 4 work were in the SAME commit, so a three-way merge could not separate them.

**The separation is by blob identity.** A reverted file's content is byte-identical to the content it had at some earlier commit, so that earlier commit is the merge base for that file:

```
base   = the content the revert restored   (an earlier commit's blob)
ours   = the content with the fix          (the verified snapshot)
theirs = the content as it is now          (the reverted snapshot)
```

Where the fix and the newer work touch different lines, a three-way merge keeps both. **202 files reconciled, 0 conflicts.** The tool is `scripts/reconcile_revert.py` — in the repo, so the next time it is not tribal knowledge.

```
python scripts/reconcile_revert.py --good <ref> [--dry-run]
```

### 10.4 The structural checker had never run

`package.json` called `python3 scripts/check_structure.py`. There is no `python3` on this machine, so the script exited 9009 and **the checker had never run at all** — on any phase. The `node scripts/check-structure.mjs` wrapper is wired in.

With it running, it immediately found a bug in itself: `_strip_comments` was a regex, and `hosting.ts` contains the glob `**/*serverless.yml`, so the stripper read `/*` as a block comment and ate through to the next `*/`. That was fixed with a character scanner — and then the scanner found a second bug of its own:

**A template literal containing a nested template literal.** The scanner's template branch was flat: it looked for the next unescaped backtick at depth zero, so a template inside an interpolation ended the OUTER template early, and everything after it was read as code. `src/export/verify-command.ts` has exactly that shape (`node -e ${doubleQuote(\`...${x}...\`)}`), and the checker reported a brace imbalance that was not there.

The scanner now recurses: a template is scanned by a function that finds its real end, and an interpolation is scanned as code. **Positive control:** a file with a deliberate imbalance is still reported.

### 10.5 Three real bugs in Phase 5's own code

**1. The G5 "a runnable verify command" predicate always passed.** The regex was `/^Verify:\s*(?!none)/m`. `\s*` can match ZERO characters, so the negative lookahead sees `" none — UNVERIFIABLE"` — which does not start with `none` — and the predicate succeeds. The gate reported a runnable verify command for a decision that had none, and G5 passed on a log where nothing was verified. Fixed to `/^Verify:(?!\s*none)/m`.

**2. The integrity stamp could never verify.** `stripStamp` removed only the marker and the payload, leaving the `---` rule that precedes the block and the human-readable footer that follows it. The digest is computed over the body alone, so the verifier reconstructed a DIFFERENT string and the digest never matched. **Every artifact was born unverifiable** — which is the one thing the stamp exists to prevent. The stripper now removes the whole block, and the emitter trims the body once and builds both the digest and the artifact from that same string.

**3. A digest mismatch reported "head-mismatch".** Two failures with unrelated remedies — "the log moved, re-export" and "the file was edited in place, find out who did it" — shared a reason, so the reader was sent looking for a log that had not changed. There is now a `digest-mismatch` reason with its own explanation.

**4. `overCapDecisions(state)` ignored its parameter** and read the global store, while the view called it with no argument. A view that memoises on one state must not be answered from another.

**5. `engine.capabilities` used as a property** in `guards/synth/llm.ts` and `guards/eval/llm-judge.ts`. It is a method, so the read was `undefined` at runtime and the "this engine cannot synthesise guards" branch never fired.

### 10.6 G5 is now executable

`checkGateG5` was a private function inside `src/views/ExportView.tsx`, so the nine predicates that make the gate a gate could only be reached by clicking a button in a browser. They now live in **`src/export/gate-g5.ts`** — a pure function over the compiled artifact — and the view imports them. `tests/integration/gate-g5.test.ts` runs all nine against a real compiled CLAUDE.md.

The chain matters, and it is a chain: a verify command exists only for an ACCEPTED guard, so the gate needs Phase 4 to have run first. On a log with no accepted guards the artifact honestly says `Verify: none — UNVERIFIABLE` and the gate fails — which is the correct outcome, and the test asserts it.

### 10.7 The keyless path, end to end

`tests/integration/keyless.test.ts` — the file CI names in its "Keyless end-to-end path" step, which **did not exist**. It now runs the whole product with no key, no network and no model: import → review → record → label → guards → export → gate → stamp verification. The stamp verification is the last step and it is the one that proves the artifact is tied to the log.

### 10.8 The gate that was missing

The tree was rewritten from a stale snapshot six times. **The tests caught it every time** — 20 of 21 failed, and `linkHash is not defined` was the first thing the suite said. Nothing ran them:

- CI had never executed: the branch was **14 commits ahead of `origin/main`**.
- The structural checker could not start.
- No git hooks were installed.

So the check now runs in three places:

1. **`.githooks/pre-commit`** — `core.hooksPath` points at a committed directory, so the hook travels with the repo. It runs typecheck and the tests, and a commit that would carry a broken tree is not made. `--no-verify` still exists, and CI will say the same thing in public.
2. **CI**, which now has a green tree to run against for the first time.
3. **`scripts/reconcile_revert.py`**, so the next revert is a mechanical recovery rather than an archaeology.

### 10.9 Known gaps that remain

| Gap | Severity | Note |
|---|---|---|
| `falsifiesPremiseId` attribution is vocabulary overlap | — | Weak by nature, and deliberately only acted on when exactly one premise matches. Ambiguity is reported, never guessed. |
| A truncated file listing makes `path_glob_exists` fail and `path_glob_absent` pass | — | The second is the dangerous one: a false all-clear enters the compliance score. Mitigated by `warning` severity and by reporting every unparseable line. |
| The `docs/` and `plan/` prose still carries residual mojibake | — | Cosmetic. `scripts/fix_encoding.py` undoes it. The code is clean. |
| `src/` is longer than the 45,818-line figure | — | The reconciliation restored files from the pre-compaction baseline, so the compaction pass over them is undone. Verified cosmetic (trailing commas). |
