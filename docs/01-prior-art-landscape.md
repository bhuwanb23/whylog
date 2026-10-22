# 01 — Prior Art Landscape

**Purpose:** establish exactly what already exists, so the novelty claim in [07](07-novelty-audit-and-positioning.md) is defensible under cross-examination.

**Headline:** the original WhyLog feature list — paste a transcript, extract decisions, semantic search, export agent files, show a graph — is **not novel in 2026**. Multiple tools ship it. The novelty is one layer up, in reasoning about whether those decisions are still true.

---

## 1. Direct competitors — decision capture from AI coding transcripts

### 1.1 `ai-memory` — the closest functional overlap
[github.com/hyxnj666-creator/ai-memory](https://github.com/hyxnj666-creator/ai-memory)

| Capability | Status |
|---|---|
| Extract from Cursor & Claude Code conversation history | ✅ `npx ai-memory-cli extract` |
| Typed output (decisions, architecture, conventions, todos, issues) | ✅ separate Markdown directories per type |
| Keyless operation (built-in free model, 2 conversations/run) | ✅ |
| Export to `AGENTS.md`, Cursor Rules, Anthropic Skills | ✅ `rules --target agents-md` |
| Decision lineage lookup | ✅ `recall "OAuth"` → git lineage |
| MCP server (`remember`, `recall`, `search_memories`, `project-context`) | ✅ |
| Dashboard with D3 force-directed knowledge graph | ✅ |
| Secret/PII redaction before LLM call | ✅ v2.5+ |
| Per-author directories, team workflow | ✅ |
| **Consistency reasoning over decisions** | ❌ |
| **Premise / assumption extraction** | ❌ |
| **Contradiction detection** | ❌ |
| **Verification against the actual codebase** | ❌ |

**Assessment:** this is the original WhyLog pitch, already built, with better plumbing (MCP, redaction, per-author). Any pitch that leads on extraction + export loses to it. Note also what it *generates* for the agent: *"Key Decisions (follow without re-discussion)"* — it assumes the decisions are still correct. That assumption is the gap.

### 1.2 `agentmemory` — the category leader by traction
[github.com/rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) · [agent-memory.dev](https://www.agent-memory.dev/)

~22k stars. TypeScript, Apache-2.0, created Feb 2026.

- **Four memory tiers modelled on human memory:** working (raw observations), episodic (session summaries), semantic (extracted facts and patterns), procedural (workflows and decision patterns).
- **Ebbinghaus decay curve** — frequently used memories strengthen, stale ones evict.
- **Hybrid retrieval:** BM25 + vector + graph, fused with Reciprocal Rank Fusion. Self-reported R@5 = 95.2%.
- **12 lifecycle hooks** for Claude Code (sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, postToolUseFailure, stop, sessionEnd…), 7 for Cursor, 6 for Codex CLI. Plus 43–54 MCP tools and 103 REST endpoints.
- **JSONL import** of existing Claude Code transcripts — "day one is not empty."
- **Session replay** viewer with scrubbing and speed control.
- Token efficiency claim: ~1,900 tokens/session vs 22k+ for loading `CLAUDE.md`.
- Keyless mode degrades to BM25; `EMBEDDING_PROVIDER=local` for on-device semantics.
- Documented gotcha: the interesting features (auto-compress, context injection, graph extraction) are **off by default** behind env vars.

**Assessment:** this is *operational* memory — what the agent did, which tools it called, what failed. Its `type: "decision"` facts are a byproduct of observation, not the object of the system. There is no consistency reasoning; conflict is handled by recency and dedup. **Do not compete with it on capture.** It owns hooks. Compete on reasoning, which it does not do at all.

### 1.3 `total-agent-memory`
[totalmemory.dev](https://totalmemory.dev/)

Auto-captures decisions via `memory_save(type="decision")`, auto-learns from errors, recalls across repos. Their own demo is literally *"why did we pick pgvector again?" → "Chose pgvector over ChromaDB. WHY: single Postgres, per-tenant RLS."* — the exact WhyLog demo beat from the original pitch. Has a "fast mode · 0 LLM calls · 0 network".

**Assessment:** the Q&A-over-decisions demo is taken. The *answer* is a retrieved note. Nothing checks whether the note is still true.

### 1.4 `jayzeng/agentmemory` (name collision, different tool)
Markdown storage, daily logs, scratchpad, `qmd` semantic search, `context --query "what was the auth decision?"`. Lightweight, file-first.

---

## 2. General agent-memory infrastructure

Covered in depth in [06-agent-memory-landscape.md](06-agent-memory-landscape.md). Summary:

| System | Model | Relevance to WhyLog |
|---|---|---|
| **Mem0** | Extract facts → vector + optional graph + KV | ~48–63k stars, $24M Series A. LongMemEval 49.0%. ADD/UPDATE/DELETE — **update-on-write, no validity history** |
| **Zep / Graphiti** | **Bi-temporal knowledge graph**; facts carry `valid_at` / `invalid_at`; contradicted facts closed out, never deleted | LongMemEval 63.8% (gpt-4o-mini) / 71.2% (gpt-4o) vs full-context 55.4/60.2. **The nearest architectural relative.** But: invalidation triggers only on arrival of a contradicting fact — no premises, no dependency cascade |
| **Letta (MemGPT)** | OS-inspired tiers; agent edits its own memory; MemFS = git-backed memory files | 83.2% LongMemEval (self-reported). Agent-managed, not human-curated |
| **cognee** | Document → knowledge graph, re-weighted from feedback | Corrections stick; not decision-oriented |
| **Veritas (`veritas-tms`)** | **JTMS justifications + entrenchment-ordered contraction + cascade retraction + append-only audit** | ⚠️ **The closest thing that exists.** See §4.1 |

---

## 3. ADR and architecture-governance tooling

| Tool | Does | Doesn't |
|---|---|---|
| **adr-tools** (Nat Pryce) | `adr new`, `adr new -s N` supersede (updates both sides), `generate toc`, `generate graph` | No semantics, no extraction, no verification |
| **Log4brains** | Static browsable site from ADR Markdown | Same |
| **MADR 4.0** | Template with Alternatives Considered, Consequences | Same |
| **Backstage ADR plugin** | Search ADRs across repos/orgs | Same |
| **[adr-staleness-check](https://github.com/chenhz01/adr-staleness-check)** | **Drift detector.** M3 = superseded ADR still anchored in the implementation map (the core drift signal); M4 = accepted ADR with zero implementation evidence; G1 = cycle in supersedes graph; S1 = accepted ADR older than N days with all anchors missing. Pure stdlib, single file, offline | Requires a **hand-maintained implementation map**. No extraction, no semantics, no premises |
| **[Repowise](https://repowise.dev/guides/decisions-adr)** | Verify → Link → Track. `verified / fuzzy / unverified` from **literal evidence spans**; `supersedes / refines / conflicts_with` lineage; stale flag = governed-file last commit vs decision last update | Staleness is a **timestamp comparison**, not logical validity. No cascade. No premises |
| **spec-kit-plus `/sp.adr`** | Prints `⚠️ Conflicts Detected: ADR-0003 uses session-based auth, conflicts with new JWT approach`; resolution workflow (mark superseded / revise plan) | Conflict flag inside one CLI workflow. No graph, no premises, no verification, no cascade |
| **Archyl** | ADRs linked to C4 elements, status tracking, cross-project search | Same class |
| **Codex CLI `adr-writer` skill** | Generates MADR-format ADRs from "decision kernels"; optional *Agent Attribution* (model, prompt context, confidence); `AGENTS.md` as architectural constraint ("do not contradict accepted ADRs"); CI job that asks Codex to review a PR against accepted ADRs | The CI check is an **LLM judge**, not a deterministic guard. ADRs are authored, not recovered |
| **[Agentic fitness functions](https://www.infoq.com/articles/agentic-fitness-functions-evolutionary-architecture/)** (InfoQ, Aug 2026) | Names **"stale ADR assumptions"**, boundary fidelity and semantic contract drift as targets; evaluator is a calibrated AI agent with an analytic rubric; output is a structured verdict with evidence, confidence, rationale | Explicitly *not* an oracle, *not* deterministic. Judgment-heavy governance via LLM + rubric. Still requires a human to author the rubric per ADR |

**The pattern across all of them:** the decision record is authored by a human, drift is detected by timestamp or by asking an LLM, and nothing reasons about *why* the decision held in the first place.

---

## 4. Academic prior art

### 4.1 Veritas — truth maintenance for AI agents
[github.com/Iam-Raghava/veritas](https://github.com/Iam-Raghava/veritas) · [PyPI `veritas-tms`](https://pypi.org/project/veritas-tms/)

The nearest shipping implementation of the concept WhyLog needs. As of October 2026 it describes itself as *"the first standalone, general-purpose, fully audited belief-base revision engine with automated entrenchment-based contraction and dependency cascades for Python agent runtimes."*

What it does:
- Beliefs carry **pedigree**: source, source reliability, confidence, justifications (premise belief ids), temporal validity.
- **JTMS-style propagation** (Doyle 1979): retract a belief → dependents re-evaluated → orphaned beliefs cascade-retract *unless they stand on their own source*. Explicitly framed as **zombie-belief prevention**: "derived beliefs cannot outlive their premises."
- **Entrenchment** as a transparent weighted score:
  `0.40 × source_reliability + 0.25 × corroboration (log-scaled justification count) + 0.20 × confidence + 0.15 × recency (30-day half-life)`
- Respects **Gärdenfors–Makinson EE2 (dominance) and EE3**: a derived belief is capped at its weakest premise.
- **Non-prioritized revision (Hansson)**: the store *screens* newcomers — if the new belief is weaker than **any** contradictor it is **REJECTED** rather than overwriting. Rationale: classical AGM's Success postulate (always accept input) is wrong for noisy environments.
- **Append-only audit log** recording reasons, not just events.
- Pluggable contradiction detectors ("bring your own NLI model"); the *retraction decision* is deterministic once a contradiction is given.

**Where WhyLog differs (this is the important part):**

| | Veritas | WhyLog |
|---|---|---|
| Belief source | Asserted programmatically by agent code, with a hand-supplied `source_reliability` float | **Recovered from natural human–AI dialogue** — nobody supplies reliability, it must be inferred from provenance |
| Domain | Generic propositions ("Acme's CEO is Jane Smith") | Software decisions with a **typed variable/value ontology** and **rejected alternatives** |
| Premises | Justifications are other beliefs in the same store | Premises are **assumptions about the world** (scale, budget, team, deployment) that can be falsified by *evidence from outside the log* — a repo scan, a guard result, a passing remark in a transcript |
| Entrenchment | Source reliability + corroboration + confidence + recency | Adds **implementation cost** — is this decision already true in the code? No belief-revision system has this term, because none is attached to a codebase |
| Output | A consistent belief base for an agent runtime | A **compiled, agent-readable, machine-verifiable** artifact + a human-facing revision proposal |
| Human role | None — retraction is automatic | **Human-in-the-loop gate.** Nothing is auto-applied; the system proposes a minimal revision and explains it |

Veritas proves the mechanism is buildable and that the theory transfers to software. It does not occupy the space WhyLog occupies.

### 4.2 Kantara instantiation — rationale conflict detection in OSS
Dhaouadi, Oakes & Famelis (2025). *Automated Extraction and Analysis of Developer's Rationale in Open Source Software.* [arXiv:2506.11005](https://arxiv.org/abs/2506.11005)

**The closest academic work to WhyLog's contradiction feature.**

- Instantiates **Kantara**, an existing high-level rationale extraction and management architecture, using pre-trained models + LLMs.
- Builds a **Rationale and Decision Graph**: decision nodes linked to rationale nodes; edges between decision nodes labelled **Similar** or **Contradicts**.
- Includes **structure-based mechanisms to detect reasoning conflicts** that could cause design erosion over time.
- Results on the Linux kernel OOM-Killer module: **29 similar pairs, 396 contradictory decision pairs, 86 inconsistencies**. Generalises to five other active OSS projects with **F1 ÷ 0.70–0.75**.
- Two named inconsistency mechanisms:
  - **M1** — decisions that are *similar* even though their *rationales are contradictory* → probable miscommunication or misunderstanding.
  - **M2** — decisions that are *contradictory* even though their *rationales are similar* → probable copy-paste, or a graph-construction error.
- Uses **NLI scores at heuristic thresholds**; three free parameters (similarity/contradiction thresholds) plus a label mapping.
- Stated load-bearing assumptions: rationale appears **in a single sentence** containing both decision and rationale; ground truth = 2,234 manually labelled sentences by the same authors.

**What it does not do — and this is WhyLog's opening:**
1. **It detects; it never revises.** There is no dependency-directed backtracking, no minimal revision set, no entrenchment ordering, no proposal to the developer.
2. **No premises or assumptions.** Decisions are compared pairwise against each other's rationale, never against the conditions that made them valid.
3. **No executable verification.** Nothing is checked against the code.
4. **Source is commit messages**, not dialogue. Their own assumption — rationale confined to a single sentence — is exactly what breaks on a 3,000-character chat transcript where a decision is negotiated across eight turns.
5. **It is a research instrument** for studying erosion in existing projects, not a tool a developer uses mid-build.

### 4.3 RepoRationale — the evidence contract
[github.com/sophiatheofanidou/RepoRationale](https://github.com/sophiatheofanidou/RepoRationale)

Local, evidence-grounded agentic RAG over public repo history. *"Ask why the code changed. Get the evidence behind it."*

Three controls worth stealing wholesale:
- **Search before answering** — at most three searches, with searches and evidence-sufficiency assessments recorded in the run trace.
- **Validate citations** — each citation must resolve to evidence retrieved *during the current question's run*.
- **Make uncertainty visible** — insufficient evidence is an **explicit outcome**, not a fallback.

Their own framing: *"These controls do not make hallucinations impossible or prove that every cited interpretation is correct. They make retrieval, grounding, citation, and answer failures distinguishable and testable."* That is the right standard for a tool whose entire value proposition is trustworthiness.

### 4.4 Rationale-mining lineage
Full treatment in [05-rationale-mining-literature.md](05-rationale-mining-literature.md). Named systems: **RecovAr** (75% recall / 77% precision), **UnArch**, **ADDRA**, **Rationale Miner**, **DRMiner** (Jira issue logs, F1 +24%/+22%/+20% over best baseline), **ARGUS** (2026, fine-grained rationale components across six artifact types), **RAAM** (assumption recovery), **Condec** (Jira-grounded rationale categories: decision, issue, alternative, pro-argument, con-argument).

### 4.5 The agent-optimized ADR study — your pitch evidence
[actual.ai/blog/agent-optimized-adrs](https://actual.ai/blog/agent-optimized-adrs)

Empirical: 15 real feature requests across 10 open-source projects, run with and without ADRs.

> **Wrong turns fell ~90% (191 → 20). Nine of fifteen tasks had zero wrong turns. 37% fewer tokens. 22% less time.**

They then specify what an ADR must look like for a *machine* reader rather than a human one:
- **Scoped to file globs** (`applies_to`), not just filed by number — an agent editing a stylesheet doesn't need the database ADR.
- **Imperative, not prose** — `MUST` / `MUST NOT`, normative keywords beat a paragraph.
- **Verifiable** — *"Each decision ships with a check, a grep, a lint rule, a command, so the agent or CI can confirm compliance instead of just intending it."*
- **Token-aware** — Anthropic's guidance is <200 lines per context file, because *"longer files consume more context and reduce adherence."*
- **Non-conflicting** — *"if two rules contradict each other, the model may pick one arbitrarily."*
- **Addressable** — stable IDs like `R-IMG-001` so a review comment, commit message or the agent itself can cite the exact decision.
- **Compile once, emit per tool** — the ADR set is the system of record; `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` are *delivery formats*. `AGENTS.md` is now used in more than 60,000 projects.

**Assessment:** this document is a gift. It validates the category with a hard number, specifies the export format precisely, and — in the words *verifiable* and *non-conflicting* — names the two things no ADR tool actually delivers automatically. WhyLog delivers both: guards make decisions verifiable, truth maintenance makes them non-conflicting.

---

## 5. The positioning quadrant

```
                        REASONS ABOUT TRUTH
                                 ▲
                                 ³
        Veritas ●                ³              ●  ← WhyLog
   (agent beliefs;               ³   (developer decisions, recovered from
    programmatic assertion;      ³    dialogue; premised; cascading;
    no extraction;               ³    entrenchment grounded in the code;
    no code grounding;           ³    compiled into executable guards
    no human gate)               ³    and agent-readable rules)
                                 ³
   Kantara / 2506.11005 ●        ³
   (detects contradictions in    ³
    commits via NLI; never       ³
    revises; no premises;        ³
    no verification)             ³
                                 ³
─────────────────────────────────┼──────────────────────────────────────►
   adr-staleness-check ●         ³                 EXTRACTS FROM
   Repowise ●                    ³              NATURAL DIALOGUE
   (hand-maintained maps;        ³
    timestamp drift;             ³  ● ai-memory        ● agentmemory
    no semantics)                ³  ● total-agent-memory
                                 ³  ● Zep/Graphiti     ● Mem0 / Letta / cognee
                                 ³  (store · index · retrieve · inject)
                                 ³
                        STORES & RETRIEVES
```

**Nobody is in the top-right quadrant.** The x-axis is a product capability (can it ingest unstructured human–AI conversation?). The y-axis is a reasoning capability (does it maintain logical validity, or just record?). Every funded product in this space is bottom-right. Every academic and niche-tool effort on the y-axis is top-left.

---

## 6. What this means for the pitch

1. **Never lead with extraction, search, or export.** All three are commodity. Leading with them invites "how is this different from ai-memory / agentmemory?" — a question you lose.
2. **Lead with the failure mode nobody handles:** confidently remembering something that is no longer true.
3. **Cite the field.** Naming Doyle 1979, RAAM, arXiv:2506.11005 and Graphiti's bi-temporal model signals you found the gap by reading, not by guessing. It also pre-empts "hasn't someone done this?" — you can answer precisely which parts exist and which don't.
4. **Use actual.ai's 90% number, then subvert it.** ADRs work — and they're handwritten, they go stale silently, and when two conflict the model picks arbitrarily.
5. **Do not build hooks.** agentmemory has 12 of them and 22k stars. Paste-in is not a compromise, it's a positioning choice: WhyLog reasons over whatever transcript you already have, from any tool, forever.
