# WhyLog — Build Plan

**Start with [`OVERVIEW.md`](OVERVIEW.md).** It holds the architecture, the phase dependency graph, the milestone gates, the cut lines and the four invariants that every phase obeys.

Each phase file below is self-contained: objective, sub-phases with acceptance criteria, diagrams, risks, and a definition of done.

---

## The phases

| # | Phase | Layer | Est. | The one thing it must achieve |
|---|---|---|---|---|
| 0 | **[Foundation & Substrate](phase-0-foundation.md)** | L0 | 3.5 h | Append-only bi-temporal event log, hash chain, **domain ontology**, engine seam |
| 1 | **[Extraction Pipeline](phase-1-extraction-pipeline.md)** | L1 | 6 h | Transcript → decisions, **premises**, rejected alternatives, provenance — human-reviewed |
| 2 | **[Truth Maintenance](phase-2-truth-maintenance.md)** ★ | L2 | 8 h | Detect unsoundness, backtrack, **cascade**, adjudicate by entrenchment, propose a minimal revision |
| 3 | **[Retrieval & Q&A](phase-3-retrieval.md)** | L3 | 5 h | Four-level index, RRF, rerank, and the **evidence contract** |
| 4 | **[Executable Decision Guards](phase-4-executable-guards.md)** | L2↔L4 | 5 h | Decisions compile into runnable checks; drift becomes a number; **guards feed back as evidence** |
| 5 | **[Export Compiler](phase-5-export-compiler.md)** | L4 | 4 h | One graph → five agent-readable formats with **verify commands**, integrity stamps and a consistency gate |
| 6 | **[Presentation](phase-6-presentation.md)** | L5 | 6.5 h | Decision card, revision proposal surface, **premise lattice**, time machine |
| 7 | **[Evaluation & Pitch](phase-7-evaluation.md)** | — | 5 h | `DecisionMemEval`, ten metrics, ablation harness, demo kit |

**Total ≈ 43 h.** Minimum demonstrable product: **Phases 0 → 1 → 2 → 6.1–6.3 ≈ 22 h.**

★ Phase 2 is the product. If its gate fails, nothing downstream is worth polishing.

---

## Dependency order

```
   P0 ──► P1 ──► P2 ──────────────► P5 ──► P6 ──► P7
           │      ▲                  ▲
           ├─► P3 ┘ (feeds gate b)   │
           └─► P4 ───────────────────┘ (feeds implementation_cost + verify cmds)

   parallel:  P6.1 ──► P6.2 ──► P6.3   (built alongside P1–P2, not after)
```

Full graph, cross-phase contracts and the three cut lines: [OVERVIEW §4–5](OVERVIEW.md).

---

## Milestone gates

| Gate | After | Question it answers |
|---|---|---|
| **G1** Walking skeleton | P0 + P1 + P6.1–6.3 | Can a messy transcript become reviewed, structured decisions with premises? |
| **G2** It reasons ★ | P2 | Does the log detect that a decision stopped being true, *without being told*? |
| **G3** It answers | P3 | Can it cite its answer, and refuse when it can't? |
| **G4** It verifies | P4 | Can a decision be proven wrong by the code, with no model involved? |
| **G5** It closes the loop | P5 | Does the export carry the reasoning *and* the check? |
| **G6** It is defensible | P6 + P7 | Is every claim backed by a number or a diagram? |

**Do not start a phase whose predecessor gate has failed.**

---

## The four invariants

Non-negotiable across every phase. A sub-phase that violates one is wrong, not clever.

1. **Nothing is deleted, everything is an event.** Nodes are relabelled; every transition writes an immutable event with a reason.
2. **Premises are shared nodes, not per-decision strings.** "single-user" is one node three decisions point at. This is what makes cascade exact — and it is the thing most likely to be quietly abandoned under time pressure.
3. **Retrieval proposes, a classifier disposes.** Cosine similarity never produces a verdict. "Use Postgres" and "don't use Postgres" are ~0.9 similar.
4. **The system proposes, the human disposes.** No auto-applied retraction, reversal, guard or export. Extracted prose must not be allowed to silently rewrite a considered decision.

Details: [OVERVIEW §7](OVERVIEW.md).

---

## Where the research lives

Every design choice in these files traces to [`../docs/`](../docs/):

| Plan phase | Backed by |
|---|---|
| P0 | [docs/02 §4](../docs/02-truth-maintenance-theory.md) formalism · [docs/06 §2](../docs/06-agent-memory-landscape.md) bi-temporality |
| P1 | [docs/05](../docs/05-rationale-mining-literature.md) — the published precision numbers shape every sub-phase |
| P2 | [docs/02](../docs/02-truth-maintenance-theory.md) in full · [docs/03 §4](../docs/03-retrieval-and-contradiction.md) three-gate detector |
| P3 | [docs/03](../docs/03-retrieval-and-contradiction.md) in full |
| P4 | [docs/04](../docs/04-executable-decision-guards.md) in full |
| P5 | [docs/01 §4.5](../docs/01-prior-art-landscape.md) agent-optimized ADR spec |
| P6 | [docs/02 §4.2](../docs/02-truth-maintenance-theory.md) lifecycle · [docs/03 §5](../docs/03-retrieval-and-contradiction.md) evidence contract |
| P7 | [docs/05 §4](../docs/05-rationale-mining-literature.md) baselines · [docs/07](../docs/07-novelty-audit-and-positioning.md) positioning |

---

## Start here

**Phase 0 is complete and verified** — the substrate, the ontology, the engine
seam and the store. `npm run verify` is green. See
[`../notes/PHASE-0-NOTES.md`](../notes/PHASE-0-NOTES.md) for what was built, what
deviated, and what the verification pass found.

**Next: Phase 1, sub-phase 1.4 — premise extraction.** That is the load-bearing
novelty. If premises cannot be recovered from dialogue at usable precision, the
concept needs rethinking before anything else is built — which is exactly why it
comes second rather than last.
