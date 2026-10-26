# Novelty table

Trimmed from [`docs/07`](../docs/07-novelty-audit-and-positioning.md) §1 to the rows that are ✅, with one
line of evidence each.

The discipline: **a row only earns a ✅ if there is a file in this repository that implements it.** Aspirational
rows are the reason novelty tables get dismissed.

---

| Capability | Evidence |
| --- | --- |
| **Premises as first-class shared nodes** | `src/types/domain.ts` `Premise` with a namespaced `predicate`; `substrate/identity.ts` resolves predicate-first with `TAU_HIGH` 0.92 / `TAU_LOW` 0.78 so two transcripts stating `scale.max_users = 1` produce **one** node |
| **The OUT-list, and therefore non-monotonic reasoning** | `Justification.outList` in `domain.ts`; `ontology/data/exclusions.ts` — **20 rules** — derive it. A justification is valid iff every IN-list node is IN **and no OUT-list node is IN** |
| **Gate (c): reality invalidates a decision nobody mentioned** | `reasoning/gates/premise.ts`; the `L2-premise-falsified` plant in `src/eval/corpus/data.ts` — `demo2` never says the word database and the SQLite decision must still go unsound |
| **Cascade that STOPS at independent support** | `reasoning/cascade.ts` with a depth cap threaded from a persisted setting through `ReviseInput`; the `L3-shared-premise` plant puts three decisions on deliberately different support |
| **Entrenchment with the EE3 cap** | `reasoning/entrenchment.ts` — `E = .30 auth + .20 cost + .20 corrob + .15 conf + .15 recency`, capped at the **minimum over the decision's own premises**, with `ee3CapApplied` reported rather than silently applied |
| **`implementation_cost` as a measurement** | `guards/feedback.ts` `guardStatusMap` fed into `ReviseInput.guards`. Before Phase 4 it was a constant — and a constant in a weighted sum is a bias with extra steps |
| **Guards COMPILED from the decision** | `guards/synth/` + `guards/templates/` — 5 variables specifically, **all 15 generically**. The fitness-function literature is unanimous that checks are hand-authored; nobody generates the check from the decision |
| **Verify commands compiled from guards** | `export/verify-command.ts` emits a self-contained `node -e` for dependency-only guards, else `node scripts/whylog-guards.mjs --decision <id>` |
| **The evidence contract on answers** | `retrieval/evidence-contract.ts` — ≤3 searches with three *distinct* purposes, citations valid only if they resolve **in-run**, `INSUFFICIENT_EVIDENCE` first-class. Zero claims ≠ grounded: 0/0 is not 1 |
| **Retrieval proposes, a classifier disposes (I3)** | `retrieval/candidates.ts` builds gate (b)'s pairs with **zero embedding calls**; the verdict comes from the one rule engine in `retrieval/contradiction.ts`, never from a similarity score |
| **One rule engine, five verdicts** | `retrieval/contradiction.ts`; `ai/local/classify.ts` collapsed from 253 to 90 lines to delegate to it. Rule order was **reordered from `docs/03` §3.6, which had a bug** — antonym was unreachable |
| **HyPE questions built at extraction time** | `substrate/projections/indexes.ts` `QUESTION_TEMPLATES` — index-time hypothetical questions with **zero extra LLM calls**, which is why HyDE at query time is not needed |
| **L4/L5 promoted, never fused** | `retrieval/rerank/index.ts` — exact structural evidence outranks statistical evidence; fusing lets a weak lexical match dilute a certain one |
| **Bi-temporal, both axes usable** | `substrate/bi-temporal.ts` + `materializeAsOf`. Valid time is a **filter**, learned time a **prefix fold** — reversing them shows decisions before they were made |
| **Agency ratio** | `views/HealthView` computes it from `provenance.origin`. Who decided — the human or the agent — is not computable from a system that does not record origin |
| **Deterministic lattice, not force-directed** | `components/graph/LatticeLayout.ts` — columns by premise type, decisions at the barycentre. A cascade animation is only legible if nodes stay where they were |
| **Pre-export consistency gate that BLOCKS** | `export/consistency-gate.ts` delegates to gate (a)'s `wouldContradict` rather than re-implementing it |
| **A measured benchmark with declared thresholds** | `src/eval/ablation/toggles.ts` — 11 switches, thresholds committed **before** any run, audited mechanically into confirmed / FALSIFIED / below-floor / untestable |

---

## The three sentences never to say

From `docs/07` §2.1. Each is false, and each is the obvious thing to say.

> ❌ **"Nobody has built a decision log for AI coding."**
> `hyxnj666-creator/ai-memory` shipped essentially the entire original WhyLog pitch: paste Cursor/Claude
> transcripts → typed Markdown, `recall` with git lineage, `rules --target agents-md`, MCP tools, a D3 force
> graph, keyless, with `--redact`. Saying this to a judge who has seen it ends the conversation.
>
> ❌ **"We do semantic search over your decisions."**
> `agentmemory` has ~22k stars and does BM25 + vector + graph with RRF at R@5 95.2%. Semantic search is
> table stakes and claiming it as innovation invites the comparison we lose.
>
> ❌ **"We detect contradictions."**
> Kantara found 396 contradictory pairs in the Linux kernel. Pairwise detection is the *control* in our own
> corpus — the thing that must work so the rest means anything, not the achievement.

**What to say instead:** *"Contradiction detection fires when you contradict yourself. Premise invalidation
fires when reality does. The second one is the product, and no surveyed system has the component."*

---

## The closest competitor, named first

`Iam-Raghava/veritas` (PyPI `veritas-tms`) is the nearest shipping relative: JTMS justifications,
entrenchment-ordered contraction, cascade retraction, append-only audit, Hansson screening, with
`E = .40 reliability + .25 corroboration + .20 confidence + .15 recency(30d)`.

The differences that remain: **no guard synthesis** (veritas does not compile a decision into a check), **no
agent-native export**, **no evidence contract on answers**, and — the one that matters for the pitch — it is a
library, not a product a judge can paste a transcript into.

Naming it first is deliberate. A novelty table that omits the closest prior art is not a novelty table.
