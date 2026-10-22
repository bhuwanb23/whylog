# 03 — Retrieval & Contradiction Algorithms
### How WhyLog finds things, and why finding is not the same as judging

**Purpose:** specify the retrieval stack precisely enough to build it and defend it. Implements [plan/phase-3](../plan/phase-3-retrieval.md).

---

## 1. The problem shape

Decision-log retrieval is **not** general RAG. Its characteristics change the right design:

| Property | Consequence |
|---|---|
| Documents are **tiny** (one sentence + a rationale clause) | Chunking is meaningless. Bi-encoder embeddings of very short texts are noisy and lose discriminative power |
| Queries are **short and interrogative** ("why did we drop auth?") | Question↔statement style mismatch — the exact gap HyDE/HyPE exist to close |
| Vocabulary is **highly specific** (postgres, better-sqlite3, clerk, fly.io) | Exact token match is *more* reliable than semantic match for the terms that matter most. Sparse retrieval is not optional |
| Corpus is **small** (10²–10│ documents) | Brute force is optimal. ANN indexes add error and infrastructure for no gain |
| The **answer must be attributable** | Retrieval quality is a trust property, not a relevance property |
| **Negation and modality carry the meaning** | "don't use Postgres" ≠ "use Postgres". Vector space cannot represent this |

The last row is the one that breaks naive designs, and §4 is devoted to it.

---

## 2. The four-level index

Every level is computed **once, at extraction time**, and stored on the node. Nothing here costs anything at query time except the fusion.

```
                            ┌──────────────────────────────────────┐
                            │           DECISION  WLD-0007         │
                            │  "Use SQLite, not Postgres"          │
                            └──────────────────────────────────────┘
                                            │
      ┌──────────────────┬──────────────────┼──────────────────┬─────────────────┐
      ▼                  ▼                  ▼                  ▼                 ▼
┌───────────┐    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  ┌──────────────┐
│    L1     │    │      L2      │   │      L3      │   │      L4      │  │      L5      │
│ STATEMENT │    │  INVERTED    │   │    SPARSE    │   │  STRUCTURAL  │  │  PREMISE     │
│ embedding │    │  QUESTIONS   │   │   keywords   │   │  var → val   │  │  premise ids │
│  512-d    │    │ 3–5 per dec. │   │  BM25-style  │   │  + premises  │  │  → dependents│
│  cosine   │    │  embedded    │   │  over all    │   │  exact match │  │  inverted    │
│           │    │              │   │  text fields │   │  O(1)        │  │  index O(1)  │
└───────────┘    └──────────────┘   └──────────────┘   └──────────────┘  └──────────────┘
   semantic         style-matched       lexical            deterministic     graph
   recall           recall              recall             gate              traversal
```

### L1 — Statement embedding
The baseline. Embed `statement + rationale`, L2-normalised, 512 dimensions. Necessary, never sufficient.

### L2 — Inverted questions  ← the highest-value cheap win
For each decision, generate **3–5 questions that this decision answers**, embed them, store them alongside.

```
WLD-0007 "Use SQLite, not Postgres"
  → "why aren't we using postgres?"
  → "what database did we choose and why?"
  → "why is there no hosted database?"
  → "should we migrate to a client-server database?"
```

This is **HyPE** — *Hypothetical Prompt Embeddings* ([Vake et al. 2025](https://www.researchgate.net/publication/389032824_Bridging_the_Question-Answer_Gap_in_Retrieval-Augmented_Generation_Hypothetical_Prompt_Embeddings)), the index-time sibling of HyDE. Their framing:

> *"Rather than generating synthetic answers at inference, HyPE precomputes multiple hypothetical questions for each corpus chunk at indexing time. These question-like prompts are embedded and stored, so that query matching effectively becomes a **question-question retrieval problem**. By shifting hypothetical generation offline, HyPE avoids [per-query overhead]."*

Why this is unusually well-suited to WhyLog: **the user's query is already a question.** "why did we drop auth?" is not a document-shaped query needing HyDE's document-dialect translation — it's a question that wants another question. Question↔question matching removes the asymmetry entirely.

And the cost is **zero additional LLM calls**, because you are already making an extraction call per transcript. Add `questionsThisAnswers: string[]` to the extraction schema and the index builds itself.

**HyDE proper** (query-time hypothetical document generation, [Gao et al. 2023, ACL](https://aclanthology.org/2023.acl-long.99/)) is specified as an **optional enhancement** for statement-shaped queries ("the database thing"), not the default. Note the reported caveat: on a 2026 text-and-table benchmark, **HyDE underperformed vanilla dense retrieval**, while hybrid RRF with cross-encoder reranking dominated all methods. Take the index-time version; treat the query-time version as a toggle.

### L3 — Sparse / lexical index
Keyword index over `statement + rationale + alternatives + variable + value + tags`, BM25-style scoring.

**Non-negotiable.** Technology names are exactly the tokens where dense embeddings are weakest and lexical matching is strongest. A query containing "better-sqlite3" must retrieve the decision containing "better-sqlite3" with rank 1, and no amount of embedding quality guarantees that. Sparse retrieval also carries the whole system when no LLM key is present.

### L4 — Structural index
`variable → value → decision ids`, plus `variable → decisions` for gate (a) contradiction detection. Exact, `O(1)`, deterministic, and the only level that can see negation and modality. This is the level that makes the system feel *intelligent* rather than *approximate*.

### L5 — Premise inverted index
`premise id → dependent decision ids`. Maintained incrementally. This is the mechanism that makes **cascade** cheap: invalidating P-0011 immediately yields every decision resting on it, with no traversal and no similarity search.

---

## 3. Fusion and reranking

### 3.1 Reciprocal Rank Fusion

Combine the ranked lists from L1+L2 (dense) and L3 (sparse):

```
RRF(d) = Σ over retrievers r  of   1 / (k + rank_r(d))          with k = 60
```

`k = 60` is the standard value from the original RRF work and is used unchanged by Graphiti and most hybrid stacks. RRF is **score-agnostic** — it only needs ranks — which means it fuses a cosine score and a BM25 score without normalising either. That property is what makes it the right choice when the two retrievers have incomparable scales.

L4 and L5 are **not fused**. They are exact gates consulted separately: if the structural index has a hit, it is promoted to the top of the candidate list regardless of RRF score. Exact evidence outranks statistical evidence.

### 3.2 Two-stage retrieval

```
   query
     │
     ├──► dense (L1 + L2)  ──┐
     ├──► sparse (L3)      ──┼──► RRF fusion ──► top-20 candidates
     ├──► structural (L4)  ──┘         ▲
     └──► premise (L5)  ─── promote ───┘
                                       │
                                       ▼
                        CROSS-ENCODER / NLI RERANK
                        score (query, candidate) jointly
                                       │
                                       ▼
                                  top-5 ──► answer synthesis
```

**Why a second stage at all:** a bi-encoder embeds query and document *independently* and compares the vectors. A cross-encoder reads them *jointly* and can therefore attend to negation, scope, and qualification — the things bi-encoders structurally cannot represent. Reported as the single largest retrieval quality boost in a standard RAG pipeline, on the order of **+27 percentage points precision@1**.

Model options, in descending cost:
- **LLM path:** the provider model as a listwise reranker — "order these five decisions by how directly they answer the question."
- **Local path, with model download:** `cross-encoder/ms-marco-MiniLM-L-6-v2` (~6M params) or a small NLI model such as `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`.
- **Local path, zero download (the sandbox default):** structural + lexical scoring with an antonym-pair lexicon. Weaker, but deterministic and instant.

**Critical implementation note:** the reranker must score against the **original query**, never against a HyDE hypothetical. Mixing them is the most common way this pipeline is broken.

---

## 4. Contradiction is a classification problem, not a similarity problem

### 4.1 The load-bearing fact

> **"Use Postgres" and "don't use Postgres" are approximately 0.9 cosine similar.**

Embedding models are trained to place topically related text close together. Negation barely moves the vector, because negation is a *logical* operation and the embedding space is a *topical* one. Any system claiming contradiction detection from a similarity threshold is detecting **topical relatedness** and hoping the polarity works out.

This is not a corner case. It is the *normal* case for a decision log, where the entire value is in what was rejected — and rejected alternatives are, by construction, topically adjacent to the decision that rejected them.

### 4.2 The three-gate detector

Retrieval proposes; a classifier disposes.

```
                        new assertion A
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌────────────────┐    ┌────────────────┐
│  GATE (a)     │    │   GATE (b)     │    │   GATE (c)     │
│  STRUCTURAL   │    │   SEMANTIC     │    │   PREMISE      │
├───────────────┤    ├────────────────┤    ├────────────────┤
│ same variable │    │ retrieve top-k │    │ A falsifies a  │
│ different     │    │ via §3 stack,  │    │ premise in     │
│ value, both IN│    │ then CLASSIFY  │    │ some d's       │
│               │    │ each pair:     │    │ IN-list, OR    │
│ deterministic │    │ entailment /   │    │ satisfies one  │
│ O(1) lookup   │    │ contradiction /│    │ in some d's    │
│               │    │ neutral        │    │ OUT-list       │
│ precision ↑↑  │    │ recall ↑↑      │    │ non-monotonic  │
│ recall ↓      │    │                │    │ the novel gate │
└───────┬───────┘    └───────┬────────┘    └───────┬────────┘
        └─────────────────────┼─────────────────────┘
                              ▼
                     VERDICT + EXPLANATION
     { contradiction | reversal | refinement | neutral | premise-invalidation }
```

The gates have complementary failure profiles, which is the reason for having three:

| Gate | Catches | Misses |
|---|---|---|
| (a) Structural | "SQLite" → "Postgres" on `DATABASE` | Cross-variable conflicts: "no server" vs "deploy to Fly.io" share no literal token and no variable |
| (b) Semantic + classifier | Cross-variable and paraphrased conflicts | False positives on topically-similar-but-compatible decisions |
| (c) Premise | Invalidation with **no stated contradiction at all** — the world moved | Only works for premises the extractor managed to recover |

### 4.3 The verdict taxonomy

Five verdicts, not two. The distinction between them drives different UI and different revision behaviour:

| Verdict | Definition | Action |
|---|---|---|
| **contradiction** | Two decisions cannot both hold; same subject, opposing polarity | Full revision cycle → Step 5–8 of [02](02-truth-maintenance-theory.md) §5 |
| **reversal** | The newer decision deliberately replaces the older on the same variable | Supersede: old → `SUPERSEDED`, edge `supersedes`, both retained |
| **refinement** | Same variable, same value, additional or corrected rationale | Merge: corroboration +1, rationale extended, no label change |
| **premise-invalidation** | No conflict between decisions; a shared premise became false | Non-monotonic revision — the highest-value case, and the one nobody else detects |
| **neutral** | Topically related, logically compatible | Add a `related` edge for the graph view. Nothing else |

Getting **refinement** right matters disproportionately: it is by far the most common relationship between two related decisions, and a system that flags it as a conflict will be switched off within a day.

### 4.4 Negation and scope detection (local path)

Without a model, polarity must come from linguistics rather than geometry:

1. **Negation cue inventory** — `not, no, never, avoid, don't, doesn't, won't, instead of, rather than, drop, dropped, dropping, skip, skipping, rule out, ruled out, no longer, without, against`.
2. **Scope window** — a cue governs a bounded span after it (typically ≤6 tokens, or to the next clause boundary). "Don't use Postgres **for the primary store**" scopes the negation to a role, not to Postgres universally. Getting scope wrong produces confident nonsense.
3. **Verb-pattern polarity** — `switch(ing)? to X`, `move to X`, `go with X`, `adopt X` = **+X**; `drop X`, `remove X`, `stop using X`, `revert X` = **−X**; `considering X`, `maybe X`, `could use X` = **modal, not asserted** — must never create a decision node, only a candidate.
4. **Antonym lexicon** over decision values — pairs that are mutually exclusive within a variable: `(sqlite, postgres)`, `(sql, nosql)`, `(ssr, csr)`, `(monolith, microservices)`, `(hosted, self-hosted)`, `(auth, no-auth)`. Two decisions asserting opposite members of a pair on the same variable is a structural contradiction with no model required.
5. **Modality is a first-class field.** `asserted | proposed | hypothetical | reported`. Only `asserted` creates an IN-labelled node. This single field prevents most extraction-driven false contradictions, and it is the thing ARGUS-style pipelines lose when they treat every sentence as a claim.

### 4.5 M1 / M2 — borrowed diagnostics

From [arXiv:2506.11005](https://arxiv.org/abs/2506.11005). Two inconsistency shapes that are worth surfacing as distinct warnings because they mean different things:

- **M1 — similar decisions, contradictory rationales.** *"We use SQLite because we need concurrency"* alongside *"We use SQLite because we need zero concurrency overhead."* Indicates **miscommunication or a misunderstanding**, not a design conflict. The decision may be fine; the reason is broken.
- **M2 — contradictory decisions, similar rationales.** *"Use SQLite because it's simplest"* and *"Use Postgres because it's simplest."* Indicates **copy-paste, or an extraction error**. Usually a data-quality problem rather than a reasoning problem.

Reporting M1 and M2 separately, rather than lumping both into "conflict detected", is a small piece of craft that makes the tool feel like it understands the difference between a bad decision and a bad record.

---

## 5. The evidence contract

Borrowed wholesale from [RepoRationale](https://github.com/sophiatheofanidou/RepoRationale), whose controls are: *at most three searches; every citation must resolve to evidence retrieved during the current run; insufficient evidence is an explicit outcome.*

### 5.1 Answer verdicts

Every answer carries exactly one:

| Verdict | Condition | Rendering |
|---|---|---|
| **GROUNDED** | Every claim in the answer maps to ≥1 retrieved decision; all citations resolve | Answer + citation chips |
| **PARTIAL** | Some claims grounded, some inferred | Grounded portion normal; inferred portion visually marked, with the reason it isn't grounded |
| **INSUFFICIENT EVIDENCE** | Retrieval returned nothing above threshold, or nothing on-topic | **Refuse to answer.** State what is missing and offer the nearest related decisions |

The `INSUFFICIENT EVIDENCE` path is the one to demo. A decision-memory tool that says *"your log has no decision about auth; nearest related is WLD-0004 (session handling, Oct 3)"* is more trustworthy than one that always produces something — and it is a property no competitor has, because none of them treat grounding as a contract.

### 5.2 Groundedness scoring

```
groundedness(answer) = |claims with ≥1 resolving citation| / |total claims|
```

Computed by decomposing the answer into atomic claims and checking each against the retrieved set. Three uses:
1. Drives the verdict in §5.1.
2. Becomes the headline metric of the evaluation harness ([plan/phase-7](../plan/phase-7-evaluation.md)).
3. Displayed to the user as a per-answer confidence bar — honest, inspectable, and cheap.

### 5.3 Citation resolution

A citation is valid only if it points to a decision retrieved **in this run**, and every citation expands to:
- the decision id and statement
- the verbatim transcript **snippet** with character span
- the timestamp and the extraction provenance (`llm` / `local`)
- the premises it rests on and their current labels

That last item is what turns a citation into an argument. Showing *"WLD-0007 — sound, rests on P-0002 (IN) and P-0005 (IN)"* is qualitatively different from showing a source link.

---

## 6. The local (zero-key) retrieval stack

Everything above must work with **no model, no network, no download**. This is not a degraded fallback; it is the default path and it has to be good.

### 6.1 Hashed n-gram embedding

```
   text
    │
    ├─ normalise: lowercase, strip punctuation, collapse whitespace
    ├─ strip stopwords (small closed list)
    ├─ tokens            ─┐
    ├─ character 3-grams ─┼──► feature stream
    └─ lexicon synonyms  ─┘        │
                                   ▼
                     h(feature) mod 512  → bucket index
                     h₂(feature) mod 2   → sign  (+1 / −1)
                                   │
                                   ▼
                     accumulate TF weight × sign into bucket
                                   │
                                   ▼
                          L2-normalise → 512-d vector
```

**Properties:** deterministic (same text → same vector, forever, on every machine), no training data, no download, sub-millisecond. Collisions are expected and tolerable — hashing vectorizers trade a little precision for total independence from infrastructure, and at 10²–10│ documents the collision rate is not the bottleneck.

### 6.2 The domain lexicon — where the local path earns its keep

A hashed bag of n-grams knows nothing about databases. The lexicon injects the semantics the hash cannot learn:

- **Synonym folding** — map `postgres`, `postgresql`, `pg`, `postgre` to one canonical token *before* hashing, so they land in the same buckets. Same for `sqlite`/`lite db`, `k8s`/`kubernetes`, `auth`/`authentication`/`login`.
- **Variable → value vocabulary** — the ontology from [02](02-truth-maintenance-theory.md) §4, used by gate (a) and by negation-scope resolution.
- **Antonym pairs** — §4.4 item 4. The only way a zero-model system detects contradiction at all.
- **Premise cue phrases** per type — `"single user"`, `"just me"`, `"no budget"`, `"free tier"`, `"weekend"`, `"local only"`, `"no server"` → typed premise candidates.
- **Modality cues** — `"maybe"`, `"could"`, `"thinking about"`, `"what if"` → suppress node creation.

This one file determines whether the offline path feels intelligent or feels like regex theatre. It deserves more attention than any UI in the product.

### 6.3 Local reranking (no cross-encoder)

Score each candidate on a weighted sum of interpretable components:

| Component | Weight | Signal |
|---|---|---|
| Structural match (variable or value hit) | 0.35 | Exact, decisive |
| Lexical overlap (BM25 over L3) | 0.30 | Technology names |
| Dense cosine (L1 + L2 fused) | 0.20 | Topical relatedness |
| Premise overlap (shared premise ids) | 0.10 | Graph proximity |
| Recency | 0.05 | Tie-break only |

Weights are inspectable in the UI. When a judge asks "how does your ranking work?" the answer is five numbers and a sentence each — which is a far stronger position than "the model decides."

---

## 7. Efficiency

Measured at **|D| = 500 decisions, dim = 512**:

| Operation | Cost |
|---|---|
| Full dense scan | 256,000 multiply-adds → **< 1 ms** in JS |
| RRF fusion over 3 lists | `O(n log n)` on ≤ 60 items → negligible |
| Local rerank of top-20 | 20 × 5 component scores → negligible |
| Index build per decision | 4 levels; L2 requires the generation step (free if folded into extraction) |
| Total index size | 500 × 512 × 4 bytes ≈ **1 MB** as float32; ~250 KB rounded to 8-bit |

**Conclusion to state plainly:** a vector database would add a network hop, a dependency, and an approximation error, in exchange for speeding up an operation that already completes in under a millisecond. Brute force is not a compromise here; it is the correct engineering choice, and the interface boundary around it (`topK(query, k)`) is where a real ANN index would slot in if the corpus ever grew by three orders of magnitude.

---

## 8. Known failure modes

| Failure | Cause | Mitigation |
|---|---|---|
| Short-text embedding noise | Documents are one sentence; vectors are unstable | L2 inverted questions give the dense level something longer and better-shaped to embed |
| Technology-name misses | Dense models underweight rare exact tokens | L3 sparse is mandatory and RRF-fused, never dense-only |
| False contradiction on topically similar decisions | Similarity threshold used as a verdict | Three-gate design; similarity only ever produces *candidates* |
| Refinement flagged as conflict | No polarity analysis | §4.4 modality + negation scope; refinement is an explicit verdict |
| Hypotheticals become decisions | "what if we used Redis?" extracted as a choice | Modality field; only `asserted` creates IN nodes |
| Duplicate nodes after multiple imports | No entity resolution | Resolution step *before* assertion — predicate-first, embedding-second |
| Reranker scored against the HyDE text | Pipeline wiring error | Hard rule: rerank against the original query, always |
| Confident answer with no evidence | Generation outruns retrieval | Evidence contract; `INSUFFICIENT EVIDENCE` is a first-class verdict |
| Over-retrieval drowning a small answer | k too large for a 500-decision corpus | k = 5 after rerank; the corpus is small enough that top-5 is usually the whole relevant set |
