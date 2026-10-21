# WhyLog — Research Library

Everything in this folder is **research and concept design**. No implementation detail, no code.
The build plan lives in [`../plan/`](../plan/).

---

## Reading order

| # | Document | What it establishes | Read if you want to know… |
|---|---|---|---|
| 00 | **[Research Summary](00-research-summary.md)** | The whole argument in one file: gap, core concept, novelty audit, positioning | …everything, and only have 15 minutes |
| 01 | **[Prior Art Landscape](01-prior-art-landscape.md)** | Every competing tool and paper, what it does, what it misses, and the positioning quadrant | …whether this is actually novel |
| 02 | **[Truth Maintenance Theory](02-truth-maintenance-theory.md)** | Doyle's TMS, JTMS/ATMS, AGM entrenchment, Hansson non-prioritized revision — the formal core | …where the algorithm comes from |
| 03 | **[Retrieval & Contradiction Algorithms](03-retrieval-and-contradiction.md)** | Four-level index, RRF, two-stage rerank, HyPE, why embeddings can't see negation, the evidence contract | …how search and contradiction actually work |
| 04 | **[Executable Decision Guards](04-executable-decision-guards.md)** | Fitness functions, the ADR→check gap, guard synthesis, compliance scoring | …how a decision becomes enforceable |
| 05 | **[Rationale Mining Literature](05-rationale-mining-literature.md)** | Design rationale recovery, assumption recovery (RAAM), knowledge vaporization, extraction precision data | …what academia says is hard, and what the real numbers are |
| 06 | **[Agent Memory Landscape](06-agent-memory-landscape.md)** | Mem0, Zep/Graphiti, Letta, cognee, agentmemory — and why "memory" is the wrong frame | …who we are NOT |
| 07 | **[Novelty Audit & Positioning](07-novelty-audit-and-positioning.md)** | Feature-by-feature verdict, the defensible claim, the pitch narrative, judge Q&A | …what to say on stage |

Also here: **[ARCHIVED-original-plan.md](ARCHIVED-original-plan.md)** — the first-pass build plan, written before the research. Superseded by `../plan/`, kept for contrast.

---

## The one-paragraph version

Tools that extract decisions from AI coding transcripts already exist and ship today. What none of them do is **maintain the truth of those decisions**. Every one models a decision as a fact to be stored and retrieved. A decision is not a fact — it is a belief held under a set of assumptions about the world (*"SQLite, not Postgres"* is true **given** single-user, no deploy infrastructure, no concurrent writers). Nobody stores the *given*, and the *given* is precisely what changes: the world moves, no contradiction is ever stated, and the decision silently stops being true while every tool in the market keeps confidently serving it back to your agent.

WhyLog applies a **Truth Maintenance System** — Doyle, 1979, a 45-year-old branch of AI that has never been pointed at this domain — to the decisions you make while building with AI. Decisions carry justifications over shared premise nodes; when a premise is invalidated, soundness is recomputed, invalidation **cascades** to every decision that rested on it, and the system proposes a **minimal revision** ordered by entrenchment. Then it closes the loop the literature only describes: each decision **compiles into an executable guard**, so drift becomes a number instead of a vibe, and the agent-readable export carries a verify command rather than prose.

> **Memory tools stop you repeating yourself. WhyLog stops you building on a decision that stopped being true three weeks ago.**

---

## Sources

Full links are inline throughout. The load-bearing ones:

- Doyle, J. (1979). *A Truth Maintenance System.* Artificial Intelligence 12.
- de Kleer, J. (1986). *An Assumption-Based Truth Maintenance System.*
- Roeller, Wallnau & Lattanze. *Recovering Assumptions About Architectural Design Decisions* (RAAM).
- Dhaouadi, Oakes & Famelis (2025). *Automated Extraction and Analysis of Developer's Rationale in Open Source Software.* [arXiv:2506.11005](https://arxiv.org/abs/2506.11005)
- Gao et al. (2023). *Precise Zero-Shot Dense Retrieval without Relevance Labels* (HyDE). [ACL](https://aclanthology.org/2023.acl-long.99/)
- Vake et al. (2025). *Bridging the Question-Answer Gap in RAG: Hypothetical Prompt Embeddings* (HyPE).
- Ford, Parsons, Kua & Sadalage. *Building Evolutionary Architectures* (fitness functions).
- [actual.ai — ADRs for Coding Agents](https://actual.ai/blog/agent-optimized-adrs) (the ~90% wrong-turn reduction study).
- [Veritas — Truth Maintenance for AI Agents](https://github.com/Iam-Raghava/veritas) (the nearest shipping implementation, in a different domain).
