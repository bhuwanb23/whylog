# WhyLog — architecture one-pager

**A decision memory for people building with AI.** Printable, handable, no page two.

---

## The thesis

A decision is not a fact. It is a **belief held under assumptions**.

> *"SQLite, not Postgres"* is true **given** single-user, no deploy infrastructure, no concurrent writers.

Every tool in this space stores the decision. **None stores the *given*.** So when the world moves, they
keep serving a decision that stopped being true — and your agent keeps building on it.

---

## The six layers

```
L5  PRESENTATION   11 views · premise lattice · time machine · health
L4  SYNTHESIS      answers with groundedness verdicts · export compiler · guard synthesis
L3  RETRIEVAL      5 index levels → RRF (k=60) → rerank → evidence contract
L2  REASONING ★    JTMS labeller · 3 gates · backtracking · cascade · entrenchment
L1  EXTRACTION     transcript → decisions + PREMISES + alternatives + verbatim provenance
L0  SUBSTRATE      append-only bi-temporal event log · hash chain · ontology

      THE AI SEAM cuts L1–L4 vertically: every operation has an LLM and a LOCAL
      implementation, chosen by capability. The whole of L2 runs keyless.
```

Dependencies point strictly downward. `ReviseInput.retrieve` is a *parameter*, not an import — which is
why the reasoning layer can be exercised with no retrieval index in existence.

---

## The three gates

| | Fires when | Deterministic |
| --- | --- | --- |
| **(a) structural** | **You** contradict yourself — same variable, different value, overlapping window | Yes |
| **(b) semantic** | You contradict yourself in words that don't match | Rules yes; LLM adds recall |
| **(c) premise ★** | **Reality** contradicts you — an assumption stopped holding | Yes |

Gate (c) is the product. Formally: a Doyle justification is valid iff every IN-list node is IN **and no
OUT-list node is IN**. A non-empty OUT-list is the signature of non-monotonic reasoning — and it is what
lets a decision become false without anyone changing their mind.

---

## The four invariants

**I1** nothing deleted, everything is an event · **I2** premises are shared nodes (so the graph is
bipartite) · **I3** retrieval proposes, a classifier disposes · **I4** the system proposes, the human
disposes.

---

## The worked example

```
   scale.max_users = 1  ──FALSIFIED──►  OUT
                                          │
                 ┌────────────────────────┼────────────────────────┐
                 ▼                        ▼                        ▼
         connection pooling       migration tooling          read replicas
         rests on it ALONE        rests on scope only        rests on it AND
                 │                        │                  no-deploy-infra
                 ▼                        ▼                        ▼
               OUT                  unchanged (IN)             still IN
```

Three correct behaviours from one intervention. Flipping the middle one means following edges instead of
justifications; flipping the third means treating support as all-or-nothing.

**Over-retraction is the failure that ends a tool like this**, so survivor preservation is measured as its
own metric and cascade correctness is a strict conjunction — flips *and* spares, or zero.

---

## What nobody else does

| | ai-memory | agentmemory | Kantara | veritas | **WhyLog** |
| --- | :-: | :-: | :-: | :-: | :-: |
| Transcript → typed decisions | ✅ | ✅ | commits | ✅ | ✅ |
| Agent-native export | ✅ | ✅ | — | — | ✅ |
| **Premises as shared nodes** | — | — | — | ✅ | ✅ |
| **Gate (c): reality invalidates** | — | — | — | ✅ | ✅ |
| **Cascade with independent-support stop** | — | — | — | ~ | ✅ |
| **Guards COMPILED from the decision** | — | — | — | — | ✅ |
| **Evidence contract on answers** | — | — | — | — | ✅ |
| **Measured with an ablation** | — | — | ~ | — | ✅ |

Full table with evidence: [`docs/07-novelty-audit-and-positioning.md`](../docs/07-novelty-audit-and-positioning.md) §1.

---

## The honest part

**Nothing has been executed.** The suite is written — 12 transcripts, 50/50 labels resolving to verbatim
quotes, 13 metrics, 11 ablation toggles with thresholds declared in advance, all 24 documented failure
modes registered — and it has never been run, because the build environment permitted no installs.

`LIMITATIONS.md` names ten constraints. The three that matter most: the corpus is 12 transcripts rather than
the planned 30; the labels were written by the author of the system; guard precision has **n = 0** because a
transcript corpus contains no repository state to violate.

One command closes the first gap between design and evidence:

```
npm install && npm run eval:report && npm run demo:verify
```
