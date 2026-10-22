# Phase 3 — Retrieval & Q&A

| | |
|---|---|
| **Layer** | L3 — Retrieval |
| **Depends on** | Phase 0 (ontology, index artifacts) · Phase 1 (nodes with text and structure) |
| **Blocks** | Phase 2 gate (b) · Phase 6 Ask view |
| **Estimate** | 5 h |
| **Research** | [docs/03](../docs/03-retrieval-and-contradiction.md) — this phase implements it directly |
| **Gate** | **G3 — It answers**: a "why" question returns a cited answer, and an unanswerable one refuses |

**Objective in one sentence:** build a four-level index, fuse it with RRF, rerank it, and answer questions under an evidence contract that prefers silence to invention.

**Framing note.** Retrieval is **table stakes** — agentmemory already ships BM25 + vector + graph fusion at a self-reported R@5 of 95.2% ([docs/01 §1.2](../docs/01-prior-art-landscape.md)). Do not pitch this phase. Build it well because Phase 2's gate (b) depends on it and because the **evidence contract** at the end of it is genuinely differentiated.

---

## Sub-phases

### 3.1 — Level 1 & 2: dense index and inverted questions

**Goal.** Two dense representations per decision, both computed at extraction time.

**L1 — statement embedding.** Embed `statement + rationale`. 512 dimensions, L2-normalised. The baseline; necessary, never sufficient, because documents here are one sentence long and short-text embeddings are noisy.

**L2 — inverted questions.** For each decision, generate **3–5 questions that this decision answers**, and embed them.

```
   WLD-0007  "Use SQLite, not Postgres"
       ├─ "why aren't we using postgres?"
       ├─ "what database did we choose and why?"
       ├─ "why is there no hosted database?"
       └─ "should we migrate to a client-server database?"
```

**Why this is the highest-value cheap win in the phase.** This is **HyPE** — Hypothetical Prompt Embeddings ([Vake et al. 2025](https://www.researchgate.net/publication/389032824_Bridging_the_Question-Answer_Gap_in_Retrieval-Augmented_Generation_Hypothetical_Prompt_Embeddings)) — which *"precomputes multiple hypothetical questions for each corpus chunk at indexing time… so that query matching effectively becomes a question-question retrieval problem."*

WhyLog's queries are **already questions**. "why did we drop auth?" is not a document-shaped query needing HyDE's dialect translation; it wants another question. Question↔question matching removes the asymmetry completely.

**Cost: zero additional LLM calls.** Add `questionsThisAnswers: string[]` to the extraction schema and the index builds itself during a call you are already making. On the local path, generate questions from templates over the ontology: `why did we choose {value}?`, `why not {alternative}?`, `what did we decide about {variable}?`.

**HyDE proper** (query-time hypothetical document generation, [Gao et al. 2023, ACL](https://aclanthology.org/2023.acl-long.99/)) is an **optional toggle** for statement-shaped queries like "the database thing". Note the caveat: on a 2026 text-and-table benchmark **HyDE underperformed vanilla dense retrieval**, while hybrid RRF with cross-encoder reranking dominated everything. Take the index-time version; treat the query-time version as experimental.

**Acceptance criteria.**
- L2 questions exist for every decision and are regenerated when a decision is edited.
- A question-shaped query retrieves via L2 with a measurable rank improvement over L1 alone (verified in Phase 7's ablation harness).

---

### 3.2 — Level 3: sparse lexical index

**Goal.** Guarantee that exact technology names are never missed.

BM25-style index over `statement + rationale + alternatives + variable + value + tags`.

**Non-negotiable.** Technology names are precisely the tokens where dense embeddings are weakest and lexical matching is strongest. A query containing `better-sqlite3` must retrieve the decision containing `better-sqlite3` at rank 1, and no embedding quality guarantees that. The sparse level also **carries the entire system when no key is present**.

**Stemming and normalisation** use the ontology's alias table, so `pg` and `postgres` index to the same term.

**Acceptance criteria.** Exact-name queries retrieve at rank 1 with the sparse level alone, keyless.

---

### 3.3 — Level 4: structural index

**Goal.** Exact, `O(1)` access by variable, value and premise.

Three indexes maintained incrementally:

| Index | Shape | Serves |
|---|---|---|
| `variableIndex` | `variable → [decisionIds]` | Phase 2 gate (a) |
| `valueIndex` | `variable:value → [decisionIds]` | Pre-emption of rejected alternatives |
| `premiseIndex` | `premiseId → [decisionIds]` | Phase 2 gate (c) and cascade |

**These are not fused into the ranking.** They are exact gates consulted separately: a structural hit is **promoted to the top of the candidate list regardless of RRF score**. Exact evidence outranks statistical evidence, and this is the level that makes the system feel intelligent rather than approximate.

**Acceptance criteria.** All three indexes stay consistent through merge, supersede and retraction events.

---

### 3.4 — Reciprocal Rank Fusion

**Goal.** Merge incomparable ranked lists without normalising incomparable scores.

```
   RRF(d) = ä over retrievers r  of   1 / (k + rank_r(d))          k = 60
```

`k = 60` is the standard value from the original RRF work, used unchanged by Graphiti and most hybrid stacks.

**Why RRF specifically:** it is **score-agnostic** — it needs ranks, not scores. That means a cosine similarity and a BM25 score fuse without either being normalised, which is exactly the problem when two retrievers have incomparable scales.

Fused lists: L1 + L2 (dense, combined) and L3 (sparse). L4 and L5 promote separately.

**Acceptance criteria.** Fusion is deterministic; identical inputs produce identical rankings; the k value is a named constant, not a magic number.

---

### 3.5 — Two-stage retrieval & reranking

**Goal.** Precision where it matters.

```
   query
     ├──► dense  (L1 + L2) ──┐
     ├──► sparse (L3)      ──┼──► RRF ──► top-20 candidates
     ├──► structural (L4)  ──┘             ▲
     └──► premise (L5) ─── promote ────────┘
                                           ³
                                           ▼
                            ┌──────────────────────────────┐
                            ³  RERANK — query × candidate  ³
                            ³  scored JOINTLY, not apart   ³
                            └──────────────┬───────────────┘
                                           ▼
                                      top-5 ──► synthesis
```

**Why a second stage.** A bi-encoder embeds query and document *independently* and compares vectors. A cross-encoder reads them *jointly*, so it can attend to negation, scope and qualification — the things bi-encoders structurally cannot represent. Reported as the single largest retrieval quality boost in a standard RAG pipeline, on the order of **+27 percentage points precision@1**.

**Three implementations, descending cost:**

| Engine | Method |
|---|---|
| LLM | Provider model as a listwise reranker: "order these five by how directly they answer the question" |
| Local + download | `cross-encoder/ms-marco-MiniLM-L-6-v2` (~6M params) or a small NLI model |
| **Local, zero download** (sandbox default) | Interpretable weighted scoring, below |

**Local reranking weights — inspectable in the UI:**

| Component | Weight | Signal |
|---|---|---|
| Structural match (variable or value hit) | 0.35 | Exact, decisive |
| Lexical overlap (BM25) | 0.30 | Technology names |
| Dense cosine (L1 + L2 fused) | 0.20 | Topical relatedness |
| Premise overlap (shared premise ids) | 0.10 | Graph proximity |
| Recency | 0.05 | Tie-break only |

When a judge asks "how does your ranking work?", the answer is five numbers and a sentence each. That is a far stronger position than "the model decides".

**Hard rule:** the reranker scores against the **original query**, never against a HyDE hypothetical. Mixing them is the most common way this pipeline is silently broken.

**Acceptance criteria.** Reranking measurably improves precision@5 over fusion alone on the fixture corpus (Phase 7 ablation).

---

### 3.6 — The contradiction classifier

**Goal.** Provide Phase 2 gate (b) with verdicts, not similarities.

Retrieval produces candidates. This component judges them. Five verdicts: `contradiction`, `reversal`, `refinement`, `premise-invalidation`, `neutral` — definitions and consequences in [phase-2 §2.4](phase-2-truth-maintenance.md).

**Local-path classifier, in order:**
1. Shared variable + differing canonical value → **reversal**
2. Negation cue within scope + same variable and value → **contradiction**
3. Same variable and value + new rationale present → **refinement**
4. Antonym-pair members asserted on the same variable → **contradiction**
5. Otherwise → **neutral**

**Negation and scope machinery** ([docs/03 §4.4](../docs/03-retrieval-and-contradiction.md)): cue inventory, ó6-token scope window, verb-pattern polarity, antonym lexicon, and a **modality field** where only `asserted` creates nodes.

**Invariant I3 lives here:** similarity never produces a verdict.

**Acceptance criteria.** The classifier's five verdicts are individually testable; refinement is not reported as conflict; hypotheticals produce no verdict at all.

---

### 3.7 — The evidence contract ★

**Goal.** Make grounding a contract rather than a hope.

Adopted wholesale from [RepoRationale](https://github.com/sophiatheofanidou/RepoRationale): *at most three searches; every citation must resolve to evidence retrieved during the current run; insufficient evidence is an explicit outcome.* Their framing is the right standard for a tool whose entire value is trustworthiness:

> *"These controls do not make hallucinations impossible or prove that every cited interpretation is correct. They make retrieval, grounding, citation, and answer failures **distinguishable and testable**."*

**Three verdicts on every answer:**

| Verdict | Condition | Rendering |
|---|---|---|
| **GROUNDED** | Every claim maps to ≥1 retrieved decision; all citations resolve | Answer + citation chips |
| **PARTIAL** | Some claims grounded, some inferred | Grounded portion normal; inferred portion visually marked with the reason it isn't grounded |
| **INSUFFICIENT EVIDENCE** | Nothing above threshold, or nothing on-topic | **Refuse.** State what is missing; offer the nearest related decisions |

**Bounded retrieval:** at most three retrieval passes per question, each recorded in a run trace. The trace is inspectable — which searches ran, what they returned, why the evidence was judged sufficient or not.

**Citation resolution rule:** a citation is valid **only if it points to a decision retrieved in this run**. Citations to nodes the retrieval never surfaced are rejected, not rendered.

**Acceptance criteria.**
- "why did we drop auth?" → GROUNDED with resolvable citations.
- "why did we pick Kafka?" → INSUFFICIENT EVIDENCE with nearest-related offered, and **no invented answer**.
- The run trace is viewable for both.

---

### 3.8 — Groundedness scoring

**Goal.** Turn the contract into a number.

```
   groundedness(answer) = |claims with ≥1 resolving citation| / |total claims|
```

Computed by decomposing the answer into atomic claims and checking each against the retrieved set.

**Three uses:**
1. Drives the §3.7 verdict (thresholds: ≥0.95 GROUNDED · 0.5–0.95 PARTIAL · <0.5 INSUFFICIENT).
2. Becomes the headline metric of `DecisionMemEval` (Phase 7).
3. Renders as a per-answer confidence bar — honest, inspectable, cheap.

**Acceptance criteria.** Groundedness is computed, displayed, and reproduced identically for an identical answer.

---

### 3.9 — Citation expansion

**Goal.** Make a citation an argument, not a link.

Every citation expands to:

```
   WLD-0007 · Use SQLite, not Postgres
   ────────────────────────────────────────────────────────────
   Decided      2026-10-03  (learned 2026-10-21)
   Status       IN · SOUND
   Rests on     P-0002 single-user (IN) · P-0005 no-deploy-infra (IN)
   Excludes     P-0011 concurrent writers (OUT)
   Rejected     Postgres — "deploy complexity"
                Supabase — "hosted dependency"
   Guards       2 / 2 passing
   Source       "yeah ok. going with SQLite, not Postgres…"
                transcript t₁ · chars 1204–1288 · human_stated · engine: local
```

**The premises-with-labels line is the differentiator.** Showing *"rests on P-0002 (IN) and P-0005 (IN)"* is qualitatively different from showing a source link, and no competitor displays it because no competitor stores it.

**Acceptance criteria.** Every citation expands to all fields above; clicking the source snippet highlights it in the original transcript.

---

### 3.10 — The Ask view

**Goal.** The interaction surface.

```
   ┌──────────────────────────────────────────────────────────────┐
   ³  Ask your log…                                     ⌘K        ³
   ├──────────────────────────────────────────────────────────────┤
   ³  why did we drop auth?                                       ³
   ³                                                              ³
   ³  ┌─ GROUNDED ── groundedness 1.00 ── 3 claims / 3 cited ───┐ ³
   ³  ³ You dropped auth entirely on 3 Oct. The reasoning: it's ³ ³
   ³  ³ a local single-user tool, so auth would protect nothing ³ ³
   ³  ³ — the data never leaves the machine. [WLD-0002]        ³ ³
   ³  ³                                                        ³ ³
   ³  ³ You also noted a revisit condition: if a hosted version ³ ³
   ³  ³ ever ships. [WLD-0002 · premise P-0006 deployment=none]³ ³
   ³  └────────────────────────────────────────────────────────┘ ³
   ³                                                              ³
   ³  Retrieved 5 of 47 · 2 searches · engine: local              ³
   ³  [ view run trace ]                                          ³
   └──────────────────────────────────────────────────────────────┘
```

Elements: query bar · verdict badge · groundedness bar · answer with inline citation chips · retrieved/total count · search count · engine badge · run-trace expander · citation expansion panel · "nearest related" list on insufficient evidence.

**Pre-emption surface.** When the query matches a **rejected alternative** rather than an accepted decision, the answer leads with the rejection:

> *"You're asking about Supabase. You **rejected** it on 3 Oct — reason: hosted dependency, no budget. That rejection rests on P-0004 (budget = none), which is still IN. Has that changed?"*

This is the highest-value sentence the retrieval layer can produce, and it is only possible because alternatives are indexed first-class (Phase 1.5).

**Acceptance criteria.** All elements render; the pre-emption path fires on a rejected-alternative query; the view is fully usable keyless.

---

## Diagrams

### D3.1 — End-to-end retrieval

```
   "why did we drop auth?"
            ³
   ┌────────┴─────────────────────────────────────────────────┐
   ³                                                          ³
   ▼            ▼             ▼              ▼                ▼
  L1 dense    L2 questions   L3 sparse     L4 structural    L5 premise
   ³            ³             ³              ³                ³
   └─────┬──────┘             ³              ³                ³
         ▼                    ▼              ³                ³
      RRF (k=60) ◄────────────┘              ³                ³
         ³                                   ³                ³
         ▼                                   ▼                ▼
     top-20  ◄──────── promote exact hits ───┴────────────────┘
         ³
         ▼
     RERANK (cross-encoder, or 5-component local weights)
         ³
         ▼
      top-5
         ³
         ▼
   ┌──────────────────────────────┐
   ³  SYNTHESISE + EVIDENCE CHECK ³
   ³  decompose into claims       ³
   ³  resolve each citation       ³
   ³  score groundedness          ³
   └──────────────┬───────────────┘
                  ▼
      GROUNDED ³ PARTIAL ³ INSUFFICIENT EVIDENCE
```

### D3.2 — Question↔question matching

```
   NAIVE                                  WhyLog (HyPE)
   ─────                                  ─────────────
   query: "why did we drop auth?"         query: "why did we drop auth?"
                 ³                                      ³
                 ▼                                      ▼
   match against STATEMENTS               match against INVERTED QUESTIONS
   "Drop auth entirely — local            "why is there no login?"
    single-user tool"                     "did we decide about auth?"
                 ³                        "why aren't we using Clerk?"
                 ▼                                      ³
        style mismatch:                                 ▼
        interrogative vs                       question ↔ question
        declarative                            same dialect, same shape
                                                              ³
                                                              ▼
                                                     materially better rank
```

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Short-text embedding noise | 🟠 | L2 inverted questions give the dense level something longer and better-shaped to embed |
| Technology-name misses | 🟠 | Sparse L3 is mandatory and RRF-fused; never dense-only |
| Reranker scored against HyDE text | 🟡 | Hard rule: always the original query |
| Confident answer with no evidence | 🔴 | Evidence contract; INSUFFICIENT EVIDENCE is a first-class verdict; groundedness is computed, not assumed |
| Local reranking too weak to demo | 🟡 | Structural and lexical components carry 0.65 of the weight and are exact; measure against the fixture corpus before judging |
| Index bloat in `localStorage` | 🟡 | Vectors live outside the event log (Phase 0.8), 8-bit rounded if needed |
| Over-retrieval drowning a small answer | 🟢 | k = 5 after rerank; at 10²–10³ documents, top-5 is usually the whole relevant set |

---

## Definition of done

- [ ] L1 + L2 dense indexes built at extraction time, with zero extra LLM calls
- [ ] L3 sparse index using the ontology alias table
- [ ] L4 structural and L5 premise indexes, incrementally maintained
- [ ] RRF fusion at k = 60, deterministic
- [ ] Two-stage retrieval with reranking; all three engine implementations present
- [ ] Contradiction classifier producing five verdicts; invariant I3 enforced
- [ ] **Evidence contract: three verdicts, bounded searches, run trace, citation-resolution rule**
- [ ] Groundedness computed and displayed
- [ ] Citation expansion showing premises with labels, alternatives, guards and provenance
- [ ] Ask view complete, keyless, including the **rejected-alternative pre-emption** path
- [ ] **Gate G3 passes** on both an answerable and an unanswerable question
