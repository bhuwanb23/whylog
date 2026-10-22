# Phase 3 notes — retrieval and the evidence contract

**Status: code-complete.** `python3 scripts/check_structure.py` → **155 source files,
45,818 lines, exit 0**. `src/retrieval/` is 19 files, 4,646 lines.

**Never executed.** No install, no build, no test run — per the standing instruction. The
structural checker verifies imports resolve, named exports exist, no cycles, brackets balance,
event vocabulary agrees and no forbidden patterns. It cannot see property-access errors, type
errors or semantics. Every claim below about behaviour is a claim about what the code says,
not about what it did.

---

## 0. Definition of done, line by line

The plan's acceptance criteria for Phase 3, checked against what was built.

| Criterion | Status | Where |
|---|---|---|
| L1 + L2 dense indexes built at extraction time with **zero extra LLM calls** | ✅ | `build-index.ts` batches L1 and L2 into ONE `engine.embed` call and skips text whose `hashStable` has not changed. L2 questions come from `QUESTION_TEMPLATES` in `projections/indexes.ts` — generated, not asked of a model. |
| L3 sparse index using the ontology alias table | ✅ | `index-levels/l3-sparse.ts` over `buildSparseCorpus`; query expansion through `canonicalValueOf`, so a question phrased in an alias matches the canonical term. |
| L4 structural and L5 premise indexes, incrementally maintained | ✅ | `l4-structural.ts`, `l5-premises.ts`. Both read the fold's own `byVariable` / `premiseToDecisions` indexes, so they are maintained by the fold rather than by a second mechanism that could drift. |
| **RRF fusion at k = 60, deterministic** | ✅ | `rrf.ts`, `RRF_K = 60`. Ties break by id, never by shared rank — sharing a rank would double-count tied documents in the fusion. |
| Two-stage retrieval with reranking; **all three engine implementations present** | ✅ | `rerank/index.ts` dispatches; `rerank/cross-encoder.ts` has the LLM listwise path **and** the downloaded-model row, which is documented as unavailable rather than faked. |
| Contradiction classifier producing **five verdicts** | ✅ | `contradiction.ts`. All five reachable — see deviation 1 below. |
| **Invariant I3 enforced** — similarity never produces a verdict | ✅ | `classifyPair` takes two `DecisionSnapshot`s. There is no threshold constant in the file and no score parameter to pass one through. The reranker scores against the original query because `rerank()` takes the query string and nothing else, so a HyDE hypothetical is not expressible rather than merely discouraged. |
| **Evidence contract**: three verdicts, bounded searches (≤3), run trace, citation-resolution rule | ✅ | `evidence-contract.ts`. `MAX_SEARCHES = 3`, `SearchTrace`, `resolveCitations` (a citation resolves iff its id was retrieved in THIS run), four distinct stop reasons. |
| Groundedness computed and displayed | ✅ | `groundedness.ts` — `\|claims with ≥1 resolving citation\| / \|total claims\|`, thresholds ≥0.95 / 0.5–0.95 / <0.5. Rendered in `AskView` as both a percentage and an `n of m` fraction. |
| Citation expansion showing **premises with labels**, alternatives, guards, provenance | ✅ | `citations.ts` → `renderExpansion`. Labels are LIVE (labeller's map), with a fallback counter that reports when a label came from the stored value instead. |
| Ask view complete, keyless, including the **rejected-alternative pre-emption** path | ✅ | `views/AskView.tsx` (862 lines), routed in `App.tsx` with `phase: "3"`. Pre-emption from `preemption.ts`, rendered above the answer when the reason has expired. |
| **Gate G3 passes** on an answerable and an unanswerable question | ⚠️ **runnable, not run** | Both questions are buttons in the Ask view. Verified against the corpus: `demo-transcript.txt` contains the SQLite/Postgres decision; **neither fixture mentions payments, Stripe, billing or checkout at all** (grepped), so the second question is genuinely unanswerable. |

---

## 1. The one substantive deviation: §3.6's rule order

§3.6 lists five rules "in order". **Rule 4 is unreachable as written.**

```
  1. shared variable + differing canonical value        → reversal
  2. negation cue in scope + same variable and value    → contradiction
  3. same variable and value + new rationale            → refinement
  4. antonym-pair members asserted on the same variable → contradiction   ← never reached
  5. otherwise                                          → neutral
```

An antonym pair *is* a differing canonical value on a shared variable, so rule 1 fires first
every time. But §3.6's own acceptance criterion requires that all five verdicts be
**individually testable**, and an unreachable rule is not testable.

Built order:

```
  1. antonym pair on the same variable                  → contradiction   (0.95)
  2. negation in scope + same variable and value        → contradiction   (0.60)
  3. same variable + differing non-antonym value        → reversal        (0.70)
  4. same variable and value + new/changed rationale    → refinement      (0.55)
  5. otherwise                                          → neutral         (0.40)
```

The reordering is also semantically right, not just a way to make the criterion pass: two
declared-mutually-exclusive choices both live is a genuine conflict, while a non-antonym value
change (`sqlite` → `sqlite with WAL`) is a deliberate change of direction. Flagging every
refinement as a conflict is how the feature gets switched off.

Full table of eight deviations plus five build-time bugs: **STRUCTURE.md §18.3**.

---

## 2. One rule engine, not two

Phase 2's `ai/local/classify.ts` had its own 253-line implementation of the classifier rules.
§3.6 then specified the same rules for retrieval, with a fifth added. Two implementations of
one judgement is precisely the failure the Phase 2 audit found in the adjudicator — a detector
and an adjudicator whose rules disagreed, so a newcomer could be ACCEPTED while gate (a)
reported a contradiction.

`retrieval/contradiction.ts` is now the canonical engine. `ai/local/classify.ts` is 90 lines
and delegates. The import points up a layer (`ai` → `retrieval`) deliberately: the dependency
is on pure functions over two snapshots with no state and no I/O, there is no cycle, and the
alternative is two classifiers that can disagree.

The same consolidation removed a second template composer. Phase 0 left `templateCompose`
inline in `ai/local/index.ts` with a comment saying Phase 3 would replace it with
`src/ai/local/compose.ts`; that file now exists and the inline copy is gone (−50 lines).

---

## 3. Why both composers are held to the same citation rule

`answer.ts` does **not** branch on engine. Both paths go through `engine.compose()`, and in
both cases the returned `citedDecisionIds` is **not trusted**: each sentence of the prose is
attributed to the decision ids that actually appear in it.

- A sentence containing a cited id that resolved this run → grounded claim.
- A sentence containing no cited id → ungrounded claim, kept, marked, counted against the score.

The local templates end every sentence with its id, so they attribute cleanly and score high.
A model that generalises beyond its citations does not, and that is how **PARTIAL becomes
reachable** — which is the verdict that makes the contract mean something.

An earlier draft had a separate `composeLocally` that built one claim per fact and returned
groundedness 1.0 by construction. That was removed: it granted the local path a perfect score
for having a composer that cannot lie, instead of measuring it by the same rule as everything
else.

---

## 4. L4 and L5 are promoted, never fused

RRF fuses **ranks**. An exact structural match — the question names `DATABASE` and the log has
a decision settling `DATABASE` — is not a rank, it is a fact. Averaging a fact into a
statistical consensus lets four levels of weak topical agreement outvote one level of exact
evidence, which is backwards.

So L4/L5 matches are held at the front of the candidate order, `orderWithPromotion` keeps them
there, and the reranker cannot demote them. They still appear in the fusion so `matchedOn` and
`contributedBy` stay honest.

`orderWithPromotion` had a dead condition when first written — `.filter((id) => !promoted.includes(id) || true)`
is always true, so the "promoted candidate the reranker never returned" group was silently
never appended. Rewritten as three explicit groups (promoted → reranked → never-ranked) with a
`seen` set. That group is the one that must not be lost: it is a candidate truncated out of the
reranker's top-k that nevertheless matched exactly.

---

## 5. Gate (b) is wired

`store/reasoning.ts` carried `skipSemantic: options?.skipSemantic ?? true` through all of
Phase 2 because there was no retriever to ask. The default is now flipped: gate (b) runs, and
`skipSemantic` is what it was always meant to be — an opt-out for the keyless demo and for
Phase 7's ablation.

Candidate generation is `retrieval/candidates.ts`, the 19th file (deviation 4). Three sources,
unioned and de-duplicated:

- **dense neighbours** — cosine ≥ 0.35, top 5 per decision, read from the L1 vectors already in
  the index. **Zero embedding calls**, so gate (b) runs keyless.
- **shared premises** — pairs resting on the same assumption, wherever similarity puts them.
- **same variable** — pairs settling the same slot, whatever their wording.

A similarity-only list would miss the third kind whenever the wording differs, and "we chose
SQLite" vs "the database is sqlite" is a plausible pair that embeddings may not rank highly.
Ceiling 200 pairs. Only live decisions (`active`, `contested`) are candidates.

The reasoning store calls `ensureIndex()` before the run. A gate that silently found nothing
because no index existed would report "no contradictions" — a different claim from "gate (b)
was unavailable", and a false one.

---

## 6. How to run gate G3

1. `npm install && npm run dev`
2. **Import & review** → paste `fixtures/demo-transcript.txt` → approve on the local engine,
   keyless. Confirm ≥5 decisions and ≥3 premises (that is G1, already passing).
3. **Ask** → the two G3 buttons are rendered under the question box.

**Half 1 — answerable.** "Why did we choose SQLite over Postgres?"
Expect `GROUNDED`. Check: the verdict banner appears *above* the prose; each claim is marked
`grounded`; expanding a citation shows `rests on P-0002 "…" (IN)`, the excluded conditions,
the rejected alternative with its reason, guard counts, and provenance; the run trace lists
every search with its `why` and the stop reason.

**Half 2 — unanswerable.** "What did we decide about the payment provider?"
Expect `INSUFFICIENT_EVIDENCE`. Check: **no claims are made** (0/0 is not treated as 1); the
assessment says what is missing; the nearest related decisions are offered and labelled *NOT an
answer*; nothing is invented.

Both halves are required. A system that answers everything passes the first and fails the
second, and the second is the one that decides whether the evidence contract is real or
decorative.

**Note on fixture 2.** `demo-transcript-2.txt` reverses the SQLite decision. Importing both
means the SQLite decision is `superseded` and is filtered out by
`includeSuperseded: false`, so question 1 will cite the Postgres decision instead — still
GROUNDED, but a different answer. Run G3 on fixture 1 alone for the behaviour described above.

---

## 7. Known gaps and honest limitations

| Gap | Severity | Note |
|---|---|---|
| **Nothing has been executed** | 🔴 | Type errors and runtime errors are entirely possible. The structural checker does not typecheck. First `npm run dev` will surface them. |
| `understandQuery` matches values by substring over `commonValues` | 🟠 | A question naming a value the ontology does not list gets no L4 promotion. Deliberately conservative — a loose promotion cannot be demoted by the reranker, so a false one is worse than a missed one. |
| Premise matching requires ≥2 shared content tokens | 🟠 | Same reasoning. Single-token overlap ("app", "server") would pull in half the log. |
| M1/M2 diagnostics are computed with similarity 0 in `classifyPairs` | 🟡 | They need a rationale-similarity judgement; the batch path has no vectors. `diagnose()` is correct and exported — the pipeline should pass a real similarity where it has one. |
| Search 3 re-queries L3 only | 🟡 | It could re-fuse all levels. Bounded to L3 because the point of search 3 is vocabulary, not ranking. |
| No caching of query embeddings | 🟢 | One `embed` call per question. Sub-millisecond locally; irrelevant. |
| `retrieveOnly` in `store/ask.ts` is unused | 🟢 | Present for the "show me the ranking" panel and Phase 7's ablation. |

---

## 8. What Phase 3 did NOT do

- **No pitching.** The plan is explicit: retrieval is table stakes. agentmemory ships
  BM25 + vector + graph with RRF at R@5 95.2%. The differentiated part is the evidence
  contract, and it is the part that got the most comment budget.
- **No vector DB.** Brute-force cosine over `Float32Array`s is sub-millisecond at this scale.
- **No NLP package, no model download.** The negation cue inventory, the scope window and the
  BM25 corpus are all hand-rolled and were already written in Phase 0/1.
- **No HyDE at query time.** `useHyde` defaults to `false` and exists for Phase 7's ablation.
  HyPE's index-time questions are the mechanism that shipped.
- **No test files.** Per instruction.

---

## 9. Next

**Phase 4 — guards.** The `ExpandedCitation` already renders `guardsPassing / guardsTotal` and
reports guards that have never run separately from guards that failed, so Phase 4 has a surface
waiting for it. `synthesizeGuards` on the local engine is still the honest Phase 0 stub.

Before starting it, run G2 and G3 locally. G2 has never been executed either, and Phase 3
changed the reasoning store's gate (b) wiring — a run that was code-complete in Phase 2 is not
necessarily still code-complete now.
