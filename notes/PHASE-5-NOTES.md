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
