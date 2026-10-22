# 07 — Novelty Audit & Positioning
### What is genuinely new, what must never be claimed, and exactly what to say

---

## 1. Feature-by-feature novelty audit

| Feature | Verdict | Evidence |
|---|---|---|
| Paste transcript → extract decisions | ❌ **Not novel** | `ai-memory` ships this keyless, with typed Markdown output and per-author directories |
| Typed decision objects with tags and timestamps | ❌ **Not novel** | `agentmemory` memory facts carry `type`, `category`, `confidence`, `tags`, `related_facts` |
| Export `CLAUDE.md` / `.cursorrules` / `AGENTS.md` | ❌ **Not novel** | `ai-memory rules --target agents-md`; actual.ai's entire thesis; `AGENTS.md` in 60,000+ projects |
| Semantic search over the decision log | ❌ **Not novel** | `agentmemory`: BM25 + vector + graph with RRF, self-reported R@5 95.2% |
| Natural-language Q&A with citations | ❌ **Not novel** | `totalmemory.dev`'s own demo is *"why did we pick pgvector again?"*; RepoRationale does grounded citation over repo history |
| Decision graph visualisation | ❌ **Not novel** | `ai-memory` ships a D3 force-directed graph; adr-tools has `generate graph`; ADR tooling renders supersedes graphs |
| MCP integration | ❌ **Not novel** | `agentmemory` has 43–54 MCP tools; `ai-memory` has `remember`/`recall`/`search_memories` |
| Auto-capture via agent hooks | ❌ **Do not attempt** | `agentmemory`: 12 Claude Code hooks, 7 Cursor, 6 Codex, native plugin, 22k stars |
| Pairwise contradiction detection | ⚠️ **Partially novel** | Published: Kantara instantiation, [arXiv:2506.11005](https://arxiv.org/abs/2506.11005), NLI-based, F1 0.70–0.75, 396 contradictory pairs in the Linux OOM-Killer. Shipped crudely: spec-kit-plus `/sp.adr`. **Novel only as a live, in-loop warning during a build** |
| Bi-temporal validity windows | ⚠️ **Partially novel** | Graphiti does it for facts. Applying it to decisions *and their premises* is new; the mechanism is not |
| Staleness / drift detection | ⚠️ **Partially novel** | `adr-staleness-check` (M3/M4/G1/S1), Repowise (last-commit vs last-update). Both need a hand-maintained map or use timestamps. Deriving drift from **synthesised guards** is new |
| **Premise extraction + shared premise nodes** | ✅ **Novel in this domain** | RAAM identifies assumptions as the lost artifact but recovers them by expert analysis of a running system. Nobody recovers them from human–AI dialogue |
| **Premise invalidation (non-monotonic gate)** | ✅ **Novel** | Requires an OUT-list. No decision-log tool has one; the concept comes from Doyle 1979 and is unapplied here |
| **Dependency-directed cascade over decisions** | ✅ **Novel here** | Veritas cascades over *agent beliefs*; Kantara detects but never revises; nothing cascades over developer decisions |
| **Entrenchment grounded in implementation cost** | ✅ **Novel** | No belief-revision system is attached to a codebase, so none has this term |
| **Minimal revision proposal with a human gate** | ✅ **Novel** | Veritas auto-retracts; Kantara reports; ADR tooling requires the human to notice. Nobody proposes a minimal revision and asks |
| **Auto-synthesised executable guards from natural-language decisions** | ✅ **Novel** | The fitness-function literature says a human should write them; `adr-staleness-check` needs a hand-made implementation map; agentic fitness functions use an LLM rubric |
| **Decision Compliance as a measured score** | ✅ **Novel** | ADR coverage and supersession rate are discussed qualitatively; guard-pass rate over an extracted decision set is not |
| **Rejected-alternative pre-emption** | ✅ **Novel** | Alternatives are the worst-captured rationale component in the literature (ARGUS precision 15.4%). Nobody indexes them as a *forward* warning system |
| **Evidence contract on answers** | ⚠️ **Borrowed, unapplied** | RepoRationale does it for repo history. No decision-log tool treats "insufficient evidence" as a first-class verdict |
| **DecisionMemEval benchmark** | ✅ **Novel** | No comparable published benchmark for decision-rationale extraction with planted premise-level and cascade contradictions |
| **Hash-chained log + stamped exports** | ✅ **Novel framing** | Not new cryptographically. New as an answer to "what stops the agent rewriting your decision file?" |

**Score: five of the original pitch's differentiators are commodity. Seven items in the ✅ column are not.**

---

## 2. The defensible novelty claim

Say this. It survives cross-examination because it concedes everything that exists.

> "Detecting contradictory rationale is published research — Dhaouadi et al. instantiated Kantara over the Linux kernel in 2025 and found 396 contradictory decision pairs using NLI. Belief revision with entrenchment ordering is forty-five years old — Doyle's Truth Maintenance System, AGM, Hansson — and there's a 2026 library called Veritas doing JTMS cascade retraction for AI agent beliefs. Extracting decisions from a Cursor transcript and exporting `AGENTS.md` is a shipped open-source tool.
>
> What nobody has done is the combination: **(a)** recover the *premises* a decision rests on from natural human–AI dialogue rather than from commits or an expert walkthrough; **(b)** run dependency-directed revision over them, so invalidating one premise **cascades** to every decision that rested on it and stops at anything independently grounded; **(c)** ground the entrenchment ordering in whether the decision is **already implemented**, which no belief-revision system can do because none is attached to a codebase; and **(d)** close the loop by compiling each decision into an **executable guard**, so drift is a measured number instead of a vibe.
>
> Kantara detects and stops. Veritas revises agent beliefs automatically and stops. ADR tooling stores and stops. **WhyLog revises, cascades, verifies, and exports.**"

### 2.1 The three sentences that must never be said

| Don't say | Why | Say instead |
|---|---|---|
| "Nobody has built a decision log for AI coding" | ai-memory and agentmemory exist and are popular | "Decision logs exist. None of them can tell you a decision has stopped being true." |
| "We do semantic search over your decisions" | agentmemory does BM25+vector+graph with RRF at 95.2% R@5 | "Retrieval is table stakes; we use a four-level index because the interesting part is what we do with the candidates." |
| "We detect contradictions" | Published in 2025, shipped in spec-kit-plus | "We detect **premise invalidation** — the case where nothing contradicts you, the world just moved." |

---

## 3. The reframe

### 3.1 Memory vs immune system

| | Every memory tool | WhyLog |
|---|---|---|
| Metaphor | **Memory** | **Immune system** |
| Question answered | "What did we decide?" | "**Is what we decided still true?**" |
| Core object | A stored fact | A justified belief with premises |
| Failure prevented | Forgetting | **Remembering something false** |
| Mechanism | Store · index · retrieve · inject | Assert · detect · backtrack · cascade · adjudicate · verify |
| Output | Tokens in a context window | An audited, compiled, self-checking artifact |
| Ground truth | None | **The codebase** |

The immune-system metaphor earns its keep because it is *mechanically* accurate, not just evocative: an immune system does not store a record of every pathogen, it maintains a model of self versus not-self and reacts when the boundary is crossed. A truth maintenance system does not store a record of every decision, it maintains a model of what is supported and reacts when support is withdrawn.

### 3.2 The "why now" argument

This is the strongest thing in the whole pitch and it is empirically supported by [05](05-rationale-mining-literature.md) §5:

> **AI-assisted development accidentally produces the best-documented design rationale in the history of software engineering — and then throws it away when the session ends.**
>
> The ARGUS study found that rationale is fragmented across artifacts: commits carry the Goal, issues carry the Need, and Alternatives appear *almost exclusively* in discussion — with extraction precision of 15.4%. But a transcript with a coding agent **is** continuous discussion. The agent keeps asking clarifying questions, and you keep answering them out loud:
>
> *"none really. it's one person, one machine, one log."*
>
> That sentence is a premise of type `scale`, stated explicitly, in a form no commit message would ever contain. Nobody wrote it down. It cost nothing to say. And in twenty minutes it will be gone.
>
> WhyLog exists because that material now exists in volume, for free, for solo builders who will never write an ADR — and because the tools that consume it treat it as *memory* when it is actually *evidence*.

This tool was not buildable in 2019. The raw material did not exist.

### 3.3 The pain hierarchy

The challenge description names the *first* pain. Name the second one, which is worse:

1. **"The agent forgot."** Annoying. Costs a re-explanation. Already treated by five funded products.
2. **"The agent confidently acted on a decision that stopped being true three weeks ago."** Expensive. Costs a rewrite, and you won't notice until the code is built. **Untreated.**

Pain 2 is strictly worse because it is *silent*. Pain 1 announces itself every session. Pain 3 announces itself in production.

---

## 4. Pitch assets

### 4.1 The one-liner
> **WhyLog is a truth maintenance system for the decisions you make while building with AI.**

### 4.2 The ten-second version
> Your coding agent forgets every decision ten prompts back — so people built it a memory. But memory isn't the hard part. The hard part is that a decision isn't a fact, it's a belief held under assumptions: *SQLite, because single-user and no deploy hassle.* Nobody stores the *because*. So when you add a second user, the decision silently stops being true and your agent keeps confidently serving it back. WhyLog stores the premises, and when one breaks it tells you which decisions just became unsound — including the two downstream ones you forgot existed.

### 4.3 The thirty-second version
Add, after the above:
> Mechanically it's a forty-five-year-old AI technique — Doyle's Truth Maintenance System — that nobody has pointed at this domain. Decisions carry justifications over shared premise nodes. New information gets asserted, contradictions are detected through three independent gates, and invalidation cascades through the dependency graph, stopping at anything with independent support. Then it picks the minimal revision, ordered by how entrenched each decision is — including whether you've already built it. Nothing is auto-applied; it proposes and you decide. And each decision compiles into an executable guard, so the export your agent reads carries a verify command instead of prose.

### 4.4 The opening statistic
From [actual.ai](https://actual.ai/blog/agent-optimized-adrs): 15 real feature requests across 10 open-source projects, with and without ADRs —

> **Wrong turns fell ~90% (191 → 20). Nine of fifteen tasks had zero wrong turns. 37% fewer tokens. 22% less time.**

Then subvert it:
> So decision records work. The problem is they're handwritten by people who will never write them, they go stale silently, and when two of them contradict each other — Anthropic's own words — *"the model may pick one arbitrarily."* That's the hole.

### 4.5 The closing line
> Memory tools stop you repeating yourself. WhyLog stops you building on a decision that stopped being true — which is the more expensive mistake, and the one your agent will never catch on its own.

---

## 5. Judge Q&A

**"How is this different from ai-memory / agentmemory?"**
They capture and retrieve. Neither reasons. agentmemory has four memory tiers, an Ebbinghaus decay curve and RRF-fused hybrid retrieval — genuinely good engineering, and all of it is about *what the agent did*. WhyLog is about *whether what you decided still holds*. Different question, different mechanism: we maintain a labelled dependency graph and run dependency-directed revision over it. We'd happily ingest their transcripts.

**"Hasn't someone done contradiction detection?"**
Yes, and I'll cite them: Dhaouadi et al., arXiv 2506.11005, built a Rationale and Decision Graph over the Linux kernel and found 396 contradictory pairs at F1 0.70–0.75. They detect and stop. We revise, cascade and verify. Also, contradiction is our *weakest* gate — the interesting one is premise invalidation, where nothing contradicts you and the world just moved.

**"Why not just use a vector database and real RAG?"**
Because the corpus is 10²–10│ documents. A brute-force cosine scan over 512-d vectors is under a millisecond and the whole index is about a megabyte. A vector DB would add a network hop, a dependency and an approximation error to speed up something already instantaneous. The `topK()` boundary is where an ANN index slots in if we grow three orders of magnitude.

**"Don't embeddings detect contradiction?"**
No, and this is worth being precise about. "Use Postgres" and "don't use Postgres" are roughly 0.9 cosine similar, because embedding models encode topic, not polarity. Similarity retrieves *candidates*; a classifier decides. We have three independent gates — structural, semantic-with-classifier, and premise-level — and the structural one is deterministic and needs no model at all.

**"Is this just an LLM wrapper?"**
The contradiction path that matters most is deterministic: same typed variable, different canonical value, both labelled IN. And guards are deterministic — a failed `dependency_absent: pg` check falsifies the decision with no model involved. The LLM improves extraction and phrasing. It is not load-bearing for correctness, and the whole thing runs keyless.

**"What if the extraction is wrong?"**
It will be, at published rates. RecovAr got 75% recall / 77% precision on decisions; ARGUS got 15.4% precision on alternatives with a 13:1 false-positive-to-false-negative ratio. So nothing enters the log unreviewed at low confidence, alternatives get a stricter tier than decisions, and the review UI is optimised for fast rejection rather than careful acceptance. On the LLM path we use three-run majority voting, which is what ARGUS did for exactly this reason.

**"Where does the data live?"**
Client-side. An append-only event log in localStorage plus JSON import/export. Nothing leaves the machine unless you connect your own key. Exports are stamped with the log's head hash, so you can tell whether an agent rewrote the file you gave it.

**"What stops the agent editing CLAUDE.md and lying about your decisions?"**
The hash chain. Every event is chained to its predecessor, every export carries the head hash and decision count, and re-importing a file whose stamp doesn't match the local head is flagged. It's not security — it's auditability, which is the actual requirement.

**"Why is entrenchment weighted that way?"**
It's adapted from Veritas's published scoring — source reliability, corroboration, confidence, recency — which itself respects the GΣrdenfors–Makinson conditions. We replaced hand-supplied source reliability with provenance-derived authority, because nobody is going to type a reliability float into a chat transcript. And we added a term no belief-revision system has, because none is attached to a codebase: implementation cost, measured by how many of the decision's guards currently pass. We also apply the EE3 cap — a derived decision is never more entrenched than its weakest premise.

**"Isn't the cascade going to cry wolf?"**
That's the main risk and it's designed against. Cascade only follows *shared premise* edges, never topical similarity. It stops at any node with an independent surviving justification, so grounded decisions don't get taken out. Depth is capped. And over-retraction is treated as worse than under-retraction, because a tool that flags everything gets switched off.

**"What's next?"**
An MCP server, so the agent can query and check the log mid-session rather than reading a static export. Live capture from hooks — deliberately not built, because agentmemory owns that and we'd rather consume it. ATMS-style multi-context reasoning, which answers "what would the log look like if we *did* go multi-user?" And DecisionMemEval, a public benchmark for decision-rationale extraction with planted premise-level contradictions, because there isn't one.

---

## 6. Category name

The pitch needs a category label that is not "memory". Candidates, in order of strength:

1. **Decision truth maintenance** — accurate, cites a real field, sounds technical in a good way, and is searchable against Doyle 1979 so a judge can verify it.
2. **Decision integrity** — shorter, vaguer, easier to say.
3. **Self-verifying decision log** — emphasises the guard pillar, which is the most visually demoable one.
4. **Rationale maintenance** — closest to the SE literature's own vocabulary (rationale-based software engineering), least accessible to a general audience.

**Recommendation: lead with #1, gloss with #3.** *"Decision truth maintenance — a decision log that checks itself."*
