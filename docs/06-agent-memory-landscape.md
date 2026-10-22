# 06 — Agent Memory Landscape
### Who we are not, and why "memory" is the wrong frame for WhyLog

**Purpose:** make sure WhyLog is never pitched as an agent-memory product. It competes with none of them and composes with all of them.

---

## 1. The 2026 field

| System | Core abstraction | Storage | LongMemEval (GPT-4o) | Traction | License |
|---|---|---|---|---|---|
| **Mem0** | Extracted facts; ADD/UPDATE/DELETE | Postgres + pgvector; Neo4j optional | **49.0%** | ~48–63k stars; $24M Series A (YC, Basis Set, Peak Valley); billions of memories/month | Apache-2.0 |
| **Zep / Graphiti** | **Bi-temporal knowledge graph**; facts carry validity windows | Neo4j / FalkorDB | **63.8%** (gpt-4o-mini) / **71.2%** (gpt-4o) vs full-context 55.4 / 60.2 | ~24–30k stars; Graphiti is the de-facto OSS temporal graph | Graphiti Apache-2.0 (Zep CE deprecated Apr 2025) |
| **Letta (ex-MemGPT)** | OS-inspired tiers: core (RAM) / recall (disk cache) / archival (disk); **agent edits its own memory**; MemFS = git-backed memory files | PostgreSQL + pgvector | 83.2% (self-reported, different config) | ~18–24k stars | Apache-2.0 |
| **cognee** | Document → knowledge graph, **re-weighted from feedback** so corrections stick | Can run on a single Postgres | — | ~30k stars | OSS |
| **LangMem** | LangGraph-native memory SDK | LangGraph store | 58.10 (as run by Mem0) | — | OSS |
| **Cloudflare Agents** | State substrate, platform-bound | Workers | — | — | MIT SDK |

Benchmark hygiene note: these numbers are largely **vendor-run on benchmarks they did not originate**. Zep's own paper reports 94.8% on Deep Memory Retrieval vs MemGPT's 93.4%. Mem0's comparison table reports Zep at 65.99. Treat all of it as directional, and never quote a competitor's number as settled fact on stage.

---

## 2. The one architectural idea worth stealing: bi-temporality

Graphiti's contribution is that **every fact carries two timelines**:

- `valid_at` / `invalid_at` — when the fact was true **in the world**
- `learned_at` — when the system **found out** about it

A contradicted fact is **never deleted, only closed out**: its validity window ends, the row stays. That single design choice is what lets the same store answer *"what is this customer's plan now?"* and *"what was it in March?"* — and it accounts for a **22-point LongMemEval gap** over Mem0, whose model is update-on-write.

The comparison table from the field says it bluntly: *"Mem0, Letta, and LangMem store timestamps but can't automatically mark a fact as stale. On temporal reasoning tasks Zep wins by twenty-two LongMemEval percentage points — no marketing catches up to that. **That's the difference between memory and bookkeeping.**"*

**WhyLog adopts bi-temporality wholesale**, and extends it: not just decisions but **premises** carry validity windows, because a premise going out of validity is the event that matters. `decidedAt` vs `learnedAt` diverge constantly in WhyLog's real workflow — you paste a three-week-old transcript, so the system learns today about a decision made on the 3rd. Any tool with a single timestamp gets that wrong and mis-orders the entire graph.

Cost at WhyLog's scale: two extra ISO strings per node and an event log that never rewrites. Essentially free.

---

## 3. Why WhyLog is not an agent-memory product

| | Agent memory (Mem0, Zep, Letta, agentmemory) | WhyLog |
|---|---|---|
| **Whose memory** | The **agent's** | The **developer's** |
| **What is stored** | Observations: prompts, tool calls, outputs, session summaries, extracted facts | Commitments: decisions, the premises they rest on, the alternatives they rejected |
| **Written by** | The system, automatically, continuously | The human, deliberately, occasionally — via review |
| **Consistency model** | Recency wins; dedup; decay; update-on-write | **Logical validity**; entrenchment-ordered revision; nothing overwritten |
| **Failure it prevents** | Re-explaining context | **Building on a decision that stopped being true** |
| **Output** | Tokens injected into a context window | An audited artifact + a revision proposal + a machine-checkable guard |
| **Ground truth** | There isn't one — memory is whatever was observed | **The codebase.** A guard can prove the log wrong |
| **Correctness criterion** | Recall@k, token efficiency | Soundness of the belief set, compliance of the code |

The decisive row is the last pair. Agent memory has no external referent — it cannot be *wrong* about the world, only incomplete. A decision log **can** be wrong, because the decision makes a claim about how the software is built, and that claim is checkable. That asymmetry is why truth maintenance is applicable here and not there, and it is the cleanest way to explain the category difference in one sentence:

> **Agent memory remembers what happened. WhyLog maintains what is true.**

---

## 4. Composition, not competition

WhyLog should be explicitly **compatible** with every system in §1, and the pitch should say so:

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Your coding agent (Claude Code · Cursor · Codex · Copilot) │
   └─────────────────────────────────────────────────────────────┘
             ▲                                     ▲
             │ operational context                 │ decision context
             │ (what happened)                     │ (what is true)
   ┌─────────┴──────────┐              ┌───────────┴───────────┐
   │  agentmemory / Mem0│              │       WhyLog          │
   │  Letta / Zep       │              │  premises · cascade   │
   │  hooks, decay,     │              │  guards · compiled    │
   │  recall, injection │              │  agent-readable rules │
   └────────────────────┘              └───────────────────────┘
```

Practical statements that follow:
- WhyLog **reads transcripts** that agentmemory already captures. It is a *reasoner over* an existing capture layer, not a rival to it.
- WhyLog's export is a **file**, which every one of these systems can ingest.
- WhyLog could itself be exposed as an **MCP server** (`whylog_query`, `whylog_check`, `whylog_propose`) — which makes it a memory *authority* rather than a memory *store*. That is the v2 integration story, and it is a much stronger position than building a twelfth hook-based capture daemon.

**Strategic corollary: do not build hooks.** agentmemory has twelve, 22k stars, and a native Claude Code plugin. Competing on capture is competing on plumbing against a full-time project. Competing on *reasoning over captured material* is competing in an empty quadrant.

---

## 5. What each system's weakness teaches us

| System | Weakness | Lesson for WhyLog |
|---|---|---|
| **Mem0** | Update-on-write destroys history; 49% LongMemEval | Never mutate a node. Append events, materialise state |
| **Zep / Graphiti** | Graph construction is thorough but expensive; Mem0's paper reports **>600,000 tokens of memory footprint per conversation** vs Mem0's 1,764; fresh facts can lag because the graph builds **asynchronously** | Keep the pipeline **synchronous and small**. A reviewer noted that with Zep, *"immediate post-ingestion retrieval often failed — correct answers only appeared hours later."* For a tool used mid-build, latency is correctness |
| **Letta** | The agent edits its own memory | For **decisions**, that is exactly backwards. The whole product thesis is that the agent should not silently rewrite your commitments — hence the human gate and the hash chain |
| **cognee** | Re-weights from feedback | Adopt the principle: user corrections in the review gate should raise the confidence of similar future extractions |
| **agentmemory** | The interesting features are off by default behind env vars; context injection requires `AGENTMEMORY_INJECT_CONTEXT=true` | **Default-on or it doesn't count.** Whatever the demo depends on must work with zero configuration |
| **All of them** | No external ground truth | Guards. This is the moat, and nobody in the category has it |
