# WhyLog — Research & Concept Design
### Prior art, the actual gap, and the algorithm that fills it

---

## 0. Executive summary

**Bad news first, because it changes the pitch:** the feature list in your original idea is no longer novel. As of 2026 there are shipping tools that paste-extract decisions from Cursor/Claude Code transcripts, type them, semantically search them, and export `AGENTS.md`/`.cursorrules` — most directly [`ai-memory`](https://github.com/hyxnj666-creator/ai-memory) and [`agentmemory`](https://github.com/rohitg00/agentmemory) (~22k stars, 12 lifecycle hooks, 54 MCP tools, BM25+vector+graph RRF fusion, Ebbinghaus decay). General agent memory is a crowded, funded category (Mem0 $24M Series A, Zep/Graphiti, Letta, cognee). ADR tooling has supersession graphs, staleness checks and drift detection.

**Good news, and it's better news:** the gap is real, it's precisely locatable, and it's *algorithmic* rather than feature-shaped.

> **Every existing tool remembers decisions. Not one of them maintains their truth.**
> They store, index, retrieve, and inject. None of them can tell you that a decision you made three weeks ago is **currently unsound** because the premise it rested on stopped being true — and none of them can tell you which *other* decisions collapse as a consequence.

That is a solved problem in a 45-year-old branch of AI that nobody has pointed at this domain. It's called a **Truth Maintenance System** (Doyle, 1979), and applying it to human+AI software decisions is WhyLog's actual reason to exist.

**The repositioning:**

| | Everyone else | WhyLog |
|---|---|---|
| Metaphor | Memory | **Immune system** |
| Question answered | "What did we decide?" | "**Is what we decided still true?**" |
| Core object | A stored fact | A **justified belief with premises** |
| Failure mode prevented | Forgetting | **Remembering something false** |
| Output | Context injected into a prompt | A **verified, self-enforcing** decision set |

"Forgetting" is the pain in the challenge description, and it's already being treated by five well-funded products. "**Confidently remembering something that is no longer true**" is the worse pain, it's untreated, and it's the one an agent acts on.

---

## 1. Prior art map

### 1.1 The uncomfortable ones

| System | What it does | What it does *not* do |
|---|---|---|
| **[ai-memory](https://github.com/hyxnj666-creator/ai-memory)** | `extract` from Cursor/Claude Code history → typed Markdown (decisions/architecture/conventions/todos/issues); `rules --target agents-md`; `recall "OAuth"` shows git lineage; MCP `remember`/`recall`; D3 knowledge graph; works keyless | No consistency reasoning. No premises. No contradiction detection at all. No verification against code. |
| **[agentmemory](https://github.com/rohitg00/agentmemory)** | 4-tier memory (working/episodic/semantic/procedural), Ebbinghaus decay, BM25+vector+graph with RRF, R@5 95.2%, 12 hooks, JSONL import, session replay | Memory of **what the agent did**, not of **why you decided**. Contradiction handling = recency/dedup, not logic. |
| **[Zep / Graphiti](https://arxiv.org/abs/2501.13956)** | **Bi-temporal** knowledge graph: every fact has `valid_at` / `invalid_at`; contradicted facts are closed out, never deleted; LongMemEval 63.8–71.2% vs Mem0's 49% | Fact invalidation on **arrival of a contradicting fact**. No dependency cascade, no premises, no code grounding. Generic agent memory, not decision rationale. |
| **[Veritas (veritas-tms)](https://github.com/Iam-Raghava/veritas)** | **The closest thing that exists.** JTMS-style justifications, entrenchment-ordered contraction (Gärdenfors–Makinson), cascade retraction, append-only audit, "derived beliefs cannot outlive their premises" | Operates on **machine-asserted propositions** with hand-supplied `source_reliability`. No extraction from dialogue, no domain ontology, no code grounding, no human-in-the-loop revision, not developer-facing. |
| **[Kantara instantiation — Dhaouadi, Oakes & Famelis 2025](https://arxiv.org/abs/2506.11005)** | **The closest academic work.** Builds a *Rationale and Decision Graph* (decision nodes → rationale nodes, edges labelled Similar / Contradicts) from Linux kernel commits using NLI + LLMs. Found 396 contradictory decision pairs and 86 inconsistencies in the OOM-Killer module; F1 0.70–0.75 across 6 projects. Two mechanisms: **M1** = similar decisions with contradictory rationales, **M2** = contradictory decisions with similar rationales | **Detects, never revises.** No dependency-directed backtracking, no minimal revision set, no premises/assumptions, no executable verification. Source = commit messages, not human–AI dialogue. It's an analysis instrument for studying erosion, not a tool a developer uses mid-build. |
| **[adr-staleness-check](https://github.com/chenhz01/adr-staleness-check)** | Drift detector: superseded ADR still anchored in the implementation map (M3), accepted ADR with zero implementation evidence (M4), cycles in the supersedes graph (G1) | Requires a **hand-maintained implementation map**. No extraction, no semantics, no premises. |
| **[Repowise](https://repowise.dev/guides/decisions-adr)** | `verified / fuzzy / unverified` from literal evidence spans; `supersedes / refines / conflicts_with` lineage; stale flag from governed-file last-commit vs decision last-update | Closest commercial product. Deterministic staleness = timestamp comparison, not logical validity. No cascade, no premises. |
| **[spec-kit-plus](https://deepwiki.com/panaversity/spec-kit-plus/6.2-architecture-decision-records-(adr))** | `/sp.adr` prints `⚠️ Conflicts Detected: ADR-0003 uses session-based auth, conflicts with new JWT approach` | Keyword/LLM conflict flag inside one CLI workflow. No graph, no premises, no verification. |

### 1.2 The literature that hands you the concept for free

- **Doyle 1979, *A Truth Maintenance System*.** Beliefs carry justifications; nodes labelled IN/OUT; when a contradiction appears the system performs **dependency-directed backtracking** — it traces the justification chain back to the specific assumptions responsible and revises *exactly those*, not the most recent thing. [PDF](https://scispace.com/pdf/a-truth-maintenance-system-pim519w5js.pdf)
- **de Kleer 1986, ATMS.** Each inference is associated directly with the assumptions it depends on; on contradiction, the assumption set becomes the candidate culprit set, recorded as a **nogood**.
- **AGM / Hansson entrenchment ordering.** When you must give something up, give up as little as possible, weakest first. A derived belief is capped at its weakest premise (EE3 / dominance).
- **RAAM — Roeller, Wallnau & Lattanze, *Recovering Assumptions About Architectural Design Decisions*.** Verbatim from the abstract: *"These decisions, as well as the reasons for these decisions, are often not explicit upfront. They are implicit... We call them assumptions. There is no accepted way to document assumptions, and the relation between the software architecture and these assumptions easily gets lost... They are rediscovered at a later stage, when the software evolves and assumptions become invalid or new assumptions contradict earlier ones."* **This is your problem statement, published, and it names the missing object: the assumption.**
- **Parnas, *A Rational Design Process: How and Why to Fake It*.** *"Some of the things that we learn invalidate our design and we must backtrack."*
- **Lehman's Principle of Software Uncertainty:** *"Invalidation of assumptions is one of the drivers of the need for continual software evolution."*
- **RecovAr** (75% recall / 77% precision recovering design decisions from issue+VCS history), **UnArch**, **ADDRA**, **DRMiner** (F1 +24% mining latent rationale from Jira), **ARGUS 2026** (fine-grained rationale components: Goal, Need, Alternatives, Selected Alternative — finds Alternatives appear *almost exclusively* in issues/PRs/reviews, precision on Alternatives only 15.4%).
- **Fitness functions** (Ford/Parsons/Kua/Sadalage, *Building Evolutionary Architectures*). Richards & Ford explicitly recommend a **Compliance section in each ADR** specifying how the decision will be verified. The literature's own admission: *"every ADR that isn't deprecated should map to at least one fitness function"* — and in practice **a human writes that function by hand**.
- **Agentic fitness functions** ([InfoQ, Aug 2026](https://www.infoq.com/articles/agentic-fitness-functions-evolutionary-architecture/)) already names *"stale ADR assumptions"* as a judgment-heavy governance target — but solves it with an **LLM judge and a rubric**, not a deterministic check.
- **[actual.ai: ADRs for Coding Agents](https://actual.ai/blog/agent-optimized-adrs)** — your pitch evidence. They ran 15 real feature requests across 10 OSS repos, with and without ADRs: **wrong turns fell ~90% (191 → 20), 9/15 tasks had zero wrong turns, 37% fewer tokens, 22% less time.** They also specify the agent-optimized format: `applies_to` file globs, imperative MUST/MUST NOT, stable addressable IDs (`R-IMG-001`), a **verify command**, <200 lines, and — critically — *"if two rules contradict each other, the model may pick one arbitrarily."*
- **[RepoRationale](https://github.com/sophiatheofanidou/RepoRationale)** — the **evidence contract**: at most 3 searches, every citation must resolve to evidence retrieved in *this* run, and "insufficient evidence" is an explicit, first-class outcome rather than a hallucination.

### 1.3 Where the gap actually is

Plot everyone on two axes:

```
                 REASONS ABOUT TRUTH
                          ▲
                          ³
        Veritas ●         ³        ● ← WhyLog goes here
     (agent beliefs,      ³     (developer decisions, extracted
      no extraction,      ³      from dialogue, premised, cascaded,
      no code)            ³      and VERIFIED against the code)
                          ³
   Kantara/2506.11005 ●   ³
   (detects contradictions³
    in commits, never     ³
    revises, no premises) ³
                          ³
 ─────────────────────────┼──────────────────────────────►
                          ³                    EXTRACTS FROM
    adr-staleness ●       ³              NATURAL DIALOGUE
    Repowise ●            ³
  (manual maps,           ³   ● ai-memory   ● agentmemory
   timestamp drift)       ³   ● Zep/Graphiti ● Mem0/Letta/cognee
                          ³   (store, index, retrieve, inject)
                          ³
                 STORES & RETRIEVES
```

Nobody is in the top-right quadrant. That's the whole thesis.

---

## 2. THE core concept: **Premise-Indexed Decision Truth Maintenance**

### 2.1 The insight, stated precisely

A decision is not a fact. It is a **belief held under a set of assumptions about the world**.

> *"SQLite, not Postgres"* is not true simpliciter. It is true **given** `single-user`, `no deploy infrastructure`, `no concurrent writers`, `dataset fits one file`.

Every tool in §1.1 stores the decision. **None of them store the `given`.** And the `given` is exactly what changes:

- You add a second user → `single-user` is false → the SQLite decision is **unsound**, silently.
- Nobody contradicted you. No new decision was made. No fact arrived. The *world* moved.

This is why contradiction detection — your original differentiator #2 — is a **special case of a much bigger and much better mechanism**. Pairwise contradiction only fires when *you* say something inconsistent. Premise invalidation fires when *reality* becomes inconsistent with you. That's the version worth building, and it's the version nobody has.

### 2.2 The formal object

A **Decision Knowledge Base** `K = ⟨D, P, J, L⟩`:

- `D` — decision nodes
- `P` — premise nodes (assumptions about the world, extracted, typed, and *shared* between decisions)
- `J` — justifications: `⟨consequent, IN-list, OUT-list, informant⟩` (Doyle's SL-justification form)
- `L` — labelling function `L: D ∪ P → {IN, OUT, UNKNOWN}`

**Soundness (JTMS validity):** a decision `d` is **IN** iff at least one of its justifications is valid — every node in the IN-list is IN, and no node in the OUT-list is IN. Otherwise `d` is **OUT** (unsound) and *is not deleted*; it is relabelled, with the reason retained.

**Entrenchment** (how resistant to retraction, adapted from Veritas/Gärdenfors–Makinson, with one term that is ours):

```
E(d) = 0.30 · source_authority      human-stated > human-approved-agent-proposal > agent-inferred
     + 0.20 · corroboration         log-scaled count of independent supporting justifications
     + 0.15 · confidence            extraction confidence
     + 0.15 · recency               30-day half-life
     + 0.20 · implementation_cost   ← NOVEL: is this decision already true in the code?
                                      (guard passes / dependency present / files match glob)
```

That last term is the one no belief-revision system has, because none of them are attached to a codebase. **A decision that is already built is expensive to retract, and the system should know that.** It's also a genuinely useful signal to a solo builder: "you're reversing something you already implemented 4 days ago."

### 2.3 The node schema

```ts
interface Premise {
  id: string;
  text: string;                       // "the app has a single user"
  type: PremiseType;                  // see below
  predicate?: string;                 // 'concurrency.max_users'
  value?: string | number | boolean;  // 1
  status: 'IN' | 'OUT' | 'UNKNOWN';
  evidence: Evidence[];               // what currently supports/refutes it
  firstAsserted: string;              // bi-temporal: when it became true
  learnedAt: string;                  // bi-temporal: when WhyLog learned it
  invalidatedAt?: string;
  invalidatedBy?: string;             // event id — full provenance
}

type PremiseType =
  | 'scale'        // single-user, <1k rows, low traffic
  | 'team'         // solo, two devs, no backend engineer
  | 'budget'       // free tier only, no paid infra
  | 'time'         // hackathon weekend, before Friday demo
  | 'deployment'   // no server, static host, local-only
  | 'capability'   // agent can do X, library Y supports Z
  | 'requirement' // must be offline, must be GDPR-clean
  | 'external';    // vendor pricing, API limits, framework version

interface Decision {
  id: string;                         // stable, addressable: 'WLD-0007'
  variable: string;                   // 'DATABASE' — the typed slot
  value: string;                      // 'sqlite'
  statement: string;                  // "Use SQLite, not Postgres"
  rationale: string;
  alternatives: RejectedAlternative[];// {value, whyRejected} ← the road not taken
  justification: {
    inList: string[];                 // premise ids this rests on
    outList: string[];                // premises that must NOT hold
    informant: string;                // 'extract:llm' | 'extract:local' | 'user:manual'
  };
  label: 'IN' | 'OUT' | 'UNKNOWN';    // JTMS soundness
  entrenchment: number;               // E(d)
  provenance: {
    origin: 'human' | 'agent-proposed-human-accepted' | 'agent-inferred' | 'human-override';
    snippet: string;                  // verbatim transcript line
    transcriptId: string;
    charSpan: [number, number];
    extractedBy: 'llm' | 'local';
    confidence: number;
  };
  decidedAt: string;  learnedAt: string;  supersededAt?: string;
  guard?: DecisionGuard;              // §4 — executable verification
  edges: { supersedes: string[]; conflictsWith: string[]; dependsOn: string[]; sharesPremise: string[] };
}
```

Two details that matter more than they look:

- **Premises are shared nodes, not per-decision strings.** "single-user" is *one* premise that three decisions point at. Invalidate it once → all three flip. That's what makes cascade possible and is the single structural difference between this and a notes app with tags.
- **`outList` is not decoration.** "Use SQLite" is justified by `IN: [single-user]` **and** `OUT: [needs-concurrent-writes]`. If a later transcript asserts concurrent writes, the justification becomes invalid through the OUT-list — that's Doyle's *non-monotonic justification*, and it's how you catch the reversal *without* the user ever stating a contradiction.

### 2.4 The algorithm — Dependency-Directed Revision

```
REVISE(newInfo)                          # newInfo = transcript chunk | user decision | guard result | repo scan
─────────────────────────────────────────────────────────────────────────────────────
 1. EXTRACT      parse newInfo into typed assertions:
                 decisions (variable, value, rationale, alternatives)
                 premises  (type, predicate, value, evidence)

 2. RESOLVE      entity-resolve each assertion onto existing nodes:
                 variable/value canonicalisation via ontology + embedding match
                 premise matching via predicate first, text similarity second
                 → merges duplicates instead of appending near-duplicates

 3. ASSERT       append immutable event to the log (§5 event sourcing)
                 L(p) := IN for each new premise, with evidence

 4. DETECT       contradiction candidates, three independent gates:
                 (a) STRUCTURAL   same `variable`, different `value`, both IN
                 (b) SEMANTIC     cosine ≥ τ over level-2 indexes → NLI/cross-encoder
                                  → verdict ∈ {contradiction, reversal, refinement, neutral}
                 (c) PREMISE      new assertion falsifies a premise in some d's
                                  IN-list, or satisfies a premise in some d's OUT-list

 5. BACKTRACK    if contradictions exist:
                 trace justification chains backwards from each contradiction node
                 to the ASSUMPTION nodes responsible (dependency-directed backtracking)
                 accumulate the culprit set C
                 record a NOGOOD: the conjunction of assumptions in C cannot all hold

 6. CASCADE      forward-propagate labels over the dependency network:
                 for each d whose every justification became invalid → L(d) := OUT
                 recurse into decisions justified by d
                 STOP at any node with an independent surviving justification
                      → prevents zombie invalidation, preserves grounded decisions

 7. ADJUDICATE   order the minimal revision set by entrenchment E(d):
                 retract weakest first; a derived decision is capped at its
                 weakest premise (EE3 dominance); give up as little as possible
                 if the newcomer cannot outrank EVERY contradictor → REJECT it
                 and tell the user why (non-prioritized revision, Hansson)

 8. PROPOSE      never auto-apply. Emit a human-readable revision proposal:
                    "⚠ UNSOUND: WLD-0007 'Use SQLite, not Postgres'
                     Premise 'single user' was invalidated 4 min ago by your
                     statement 'we need concurrent writes'.
                     Cascade: WLD-0011 'skip connection pooling' and
                              WLD-0019 'no migration tooling' also rest on it.
                     Entrenchment: 0.62 (implemented — better-sqlite3 is in package.json).
                     [Reverse] [Keep & re-justify] [Mark premise contested]"

 9. RE-LABEL     on user choice: write events, recompute L over the network,
                 re-run guards for affected decisions, re-emit exports
```

**Why this is not your original "contradiction detection":**

| Your original feature | This |
|---|---|
| Pairwise: new decision vs. top-3 similar | Whole-graph: premise-level, transitive |
| Fires only when the user contradicts themselves | Fires when the **world** contradicts the decision |
| Says "this conflicts" | Says "**this and these two downstream decisions are now unsound, here's the cheapest revision**" |
| Vector similarity (which can't see negation) | Three independent gates, one of which is structural and deterministic |
| One-shot | Maintained invariant — the log is *kept* consistent, continuously |

### 2.5 The honest novelty claim (say it exactly like this)

> "Detecting contradictory rationale in commit history is published research — Dhaouadi et al. 2025 built a Rationale and Decision Graph over the Linux kernel and found 396 contradictory decision pairs. Belief revision with entrenchment ordering is 45 years old — Doyle's TMS, AGM, and there's a 2026 library called Veritas doing it for agent beliefs.
>
> What nobody has done is **(a)** recover the *premises* from natural human–AI dialogue rather than commits, **(b)** run dependency-directed revision over them so invalidation *cascades* to downstream decisions, **(c)** ground the entrenchment ordering in whether the decision is already implemented in code, and **(d)** close the loop by emitting an executable check the agent or CI can run. Kantara detects and stops. We revise, cascade, verify, and export."

That paragraph is defensible under cross-examination, cites real work, and still leaves you owning something.

---

## 3. Retrieval & contradiction architecture — the "proper" version

Your original note said *"small enough to just stuff into context, no real RAG needed."* Retire that line. Here's what to say instead, and it's cheap to build.

### 3.1 Four-level decision index (built once, at extraction time)

Each decision is indexed at four levels, all computed offline:

| Level | Content | Why |
|---|---|---|
| **L1** | `statement` embedding | baseline |
| **L2** | **inverted questions** — 3–5 synthetic questions this decision answers ("why aren't we on Postgres?") | This is **HyPE** ([Vake et al. 2025](https://www.researchgate.net/publication/389032824)) / doc2query. The query "why did we drop auth?" **is already a question** — question→question matching beats question→statement matching, and it costs nothing at query time because you generate them during extraction you're already doing. |
| **L3** | sparse keyword index over `statement + rationale + alternatives + variable + value` | Exact tech names must never be missed. BM25/keyword catches "postgres" when the embedding drifts. |
| **L4** | structural index: `variable → value → premise ids` | Deterministic, exact, and the only level that can see negation. |

**Fusion:** Reciprocal Rank Fusion, `RRF(d) = ä_r 1/(k + rank_r(d))`, `k = 60`, over L1+L2 (dense) and L3 (sparse). Then rerank.

### 3.2 Two-stage retrieval

1. **Recall** — bi-encoder cosine over fused candidates, top-20.
2. **Rerank** — cross-encoder over `(query, candidate)` pairs, top-5. Reported as the single largest retrieval quality boost in a standard RAG pipeline (~+27pp precision@1). LLM path: use the model as a reranker. Local path: skip to structural + keyword scoring.

### 3.3 Contradiction is a *classifier*, not a similarity score

> **The load-bearing fact to say out loud on stage:** *"use Postgres"* and *"don't use Postgres"* are ~0.9 cosine similar. **Embeddings cannot detect contradiction.** Any tool that claims contradiction detection from vector similarity alone is detecting *topical relatedness* and hoping.

So: retrieval proposes, a classifier disposes.

- **LLM path:** top-3 candidates + new decision → verdict `{contradiction | reversal | refinement | neutral}` + explanation + `relatedId`.
- **Local path:** NLI-style triple scored by (i) shared `variable` with differing `value` → *reversal*; (ii) negation cue + same `variable`/`value` → *contradiction*; (iii) same `variable`/`value`, no negation, new rationale → *refinement*; else *neutral*.
- **Borrow M1/M2 from Kantara** as diagnostic categories — they're published, they're free, and naming them makes you look like you read the field:
  - **M1**: similar decisions with contradictory rationales → probable misunderstanding
  - **M2**: contradictory decisions with similar rationales → probable copy-paste or extraction error

### 3.4 The evidence contract (from RepoRationale — steal this wholesale)

Every answer from the Ask view carries one of three verdicts:

- **GROUNDED** — all claims trace to retrieved decisions; citations resolve to real snippets.
- **PARTIAL** — some claims grounded; the ungrounded part is explicitly marked.
- **INSUFFICIENT EVIDENCE** — *"Your log has no decision about auth. Nearest related: WLD-0004 (session handling, Oct 3)."*

Bounded retrieval (ó3 searches), and **every citation must resolve to evidence retrieved during this run**. A decision-memory tool that refuses to invent rationale is more trustworthy than one that always answers — and it's a 20-line feature that reads as rigour.

---

## 4. Second novel pillar: **Executable Decision Guards**

The fitness-function literature says every ADR *should* map to an automated check. In practice a human writes that check by hand, or an LLM judges a diff against a rubric. **Nobody generates the check from the decision automatically.**

WhyLog does: extraction already produced `variable`, `value`, `alternatives`, and `applies_to` — which is precisely the input needed to synthesise a guard.

```ts
interface DecisionGuard {
  id: string;
  decisionId: string;
  kind: 'dependency_present' | 'dependency_absent' | 'path_glob_exists'
      | 'path_glob_absent' | 'string_in_files' | 'string_absent_in_files'
      | 'command_exit_zero' | 'llm_judge';
  spec: Record<string, unknown>;      // {package: 'pg'} | {pattern: 'postgres', glob: 'src/**'}
  rationale: string;                  // human-readable: why this checks that decision
  generatedBy: 'llm' | 'template' | 'user';
  lastRun?: { at: string; result: 'pass'|'fail'|'skip'; evidence: string };
}
```

Worked example — the SQLite decision compiles to:

```json
{ "kind": "dependency_present", "spec": { "package": "better-sqlite3" },
  "rationale": "WLD-0007 chose SQLite; the driver must be in the dependency tree." }
{ "kind": "dependency_absent",  "spec": { "package": "pg" },
  "rationale": "WLD-0007 rejected Postgres; no pg driver should appear." }
{ "kind": "string_absent_in_files", "spec": { "pattern": "postgres://", "glob": "**/*.{ts,env,json}" },
  "rationale": "No Postgres connection string should exist while WLD-0007 is IN." }
```

**Three consequences, each of them a headline:**

1. **Drift becomes a number.** *Decision Compliance* = % of IN decisions whose guards pass. A single metric that says "your codebase has quietly stopped believing 3 of your 12 decisions."
2. **`implementation_cost` in the entrenchment formula becomes measurable**, not guessed (§2.2).
3. **The export gets teeth.** Instead of `CLAUDE.md` saying "we use SQLite", it emits actual.ai's agent-optimized form — stable ID, MUST/MUST NOT, `applies_to` glob, and a **verify command** the agent can run itself:

```markdown
### WLD-0007 — MUST use SQLite (better-sqlite3). MUST NOT introduce Postgres.
Applies to: src/db/**, package.json
Because: single user, no deploy infrastructure (premise P-0002, P-0005)
Rejected: Postgres (deploy complexity), Supabase (hosted dependency)
Verify: `node -e "const p=require('./package.json');process.exit(p.dependencies['better-sqlite3']&&!p.dependencies['pg']?0:1)"`
Status: IN · sound · last verified 2026-10-21
```

That is a **self-enforcing decision record**, and it is the thing that makes an agent actually obey it rather than "pick one arbitrarily" when rules conflict.

**Demo-able without a repo:** ship a tiny pure-JS guard interpreter that runs `dependency_*`, `path_glob_*` and `string_*` guards against an in-browser virtual file tree (or a pasted `package.json`). Real, deterministic, no shell, works in the sandbox. `command_exit_zero` guards are exported for CI but not executed in-browser.

---

## 5. Supporting concepts (each real, each cheap)

**5.1 Event-sourced, bi-temporal log.** Store an append-only event stream (`DecisionProposed`, `PremiseAsserted`, `PremiseInvalidated`, `DecisionReversed`, `GuardFailed`, `RevisionAccepted`); materialise the graph from it. Two timestamps everywhere: `decidedAt`/`firstAsserted` (when it became true in the world) and `learnedAt` (when WhyLog learned it) — Graphiti's bi-temporal model, which is worth a 22-point LongMemEval gap and is trivially cheap at your scale. Unlocks a **time slider**: *"what did we believe on Oct 3, and what has changed since?"* Nothing is ever deleted; nodes are closed out with `invalidatedAt` + `invalidatedBy`.

**5.2 Append-only integrity hash.** Chain each event to the previous (`h_i = sha256(h_{i-1} || event_i)`), and stamp every export with the head hash + decision count. Rationale: **you are handing this file to an agent that can rewrite files.** Being able to say "this `CLAUDE.md` corresponds to log head `a3f91c…`, 14 decisions, all guards passing" makes the export auditable and detects silent mutation. Small to build, distinctive to talk about.

**5.3 Provenance & the agency ledger.** `provenance.origin` distinguishes *human stated it* / *agent proposed, human accepted* / *agent inferred* / *human overrode the agent*. Aggregate it into an **override rate** — how often you reverse your agent's suggestions — and into `source_authority` for entrenchment. Also gives each decision a "git blame for reasoning": click a decision, see the transcript span it came from.

**5.4 The rejected-alternative index.** Alternatives are the highest-value, worst-captured component in the rationale literature (ARGUS found Alternatives appear almost exclusively in issues/PRs/reviews, and their extraction precision was only 15.4%). Index them **first-class**: when an agent or you propose something, match it against *rejected* alternatives, not just accepted decisions. *"You're proposing Supabase. You rejected it on Oct 3: 'hosted dependency, no budget for it.' Has that changed?"* That single sentence is a better demo than any contradiction banner, because it catches the mistake **before** the decision is made rather than after.

**5.5 A tiny benchmark — `DecisionMemEval`.** 30 fixture transcripts with hand-labelled decisions, premises, and planted contradictions (pairwise, premise-level, and cascade cases). Report contradiction-recall, extraction F1, and answer-groundedness. Costs an afternoon, and it converts "trust me, it works" into a number. **No tool in §1.1 publishes anything like it for decision rationale.** This is your "innovation" score, in artifact form.

---

## 6. Feature-by-feature novelty audit

| Feature | Verdict | Evidence |
|---|---|---|
| Paste transcript → extract decisions | ❌ **Not novel** | ai-memory does exactly this, keyless, with typed Markdown output |
| Export `CLAUDE.md` / `.cursorrules` / `AGENTS.md` | ❌ **Not novel** | ai-memory `rules --target agents-md`; actual.ai's whole thesis |
| Semantic search over the log | ❌ **Not novel** | agentmemory: BM25+vector+graph RRF, R@5 95.2% |
| Decision graph view | ❌ **Not novel** | ai-memory ships a D3 force graph; ADR tools render supersedes graphs |
| Pairwise contradiction detection | ⚠️ **Partially** | Published (Kantara 2025, NLI-based); shipped crudely (spec-kit-plus) |
| Bi-temporal validity windows | ⚠️ **Partially** | Graphiti does it for facts, not for decisions-with-premises |
| **Premise extraction + premise invalidation** | ✅ **Novel here** | RAAM says assumptions are the lost artifact; nobody recovers them from dialogue |
| **Dependency-directed cascade over decisions** | ✅ **Novel here** | Veritas does it for agent beliefs; Kantara detects but never revises |
| **Entrenchment grounded in implementation cost** | ✅ **Novel** | No belief-revision system is attached to a codebase |
| **Auto-synthesised executable guards from NL decisions** | ✅ **Novel** | Literature says a human should write them; adr-staleness needs a hand-made map |
| **Rejected-alternative pre-emption** | ✅ **Novel** | Alternatives are the worst-captured rationale component in the literature |
| **Evidence contract (insufficient-evidence as a verdict)** | ⚠️ **Borrowed, unapplied** | RepoRationale does it for repo history; no decision-log tool does |
| **DecisionMemEval benchmark** | ✅ **Novel** | Nothing comparable published for decision rationale extraction |

---

## 7. The five-layer architecture

```
┌─ L5 PRESENTATION ──────────────────────────────────────────────────────────────┐
³  Timeline · Ask (evidence-contract answers) · Graph (premise lattice) ·        ³
³  Export (compiled per-agent) · Health (compliance + agency + staleness)        ³
├─ L4 SYNTHESIS ─────────────────────────────────────────────────────────────────┤
³  answer() · compile() → CLAUDE.md/.cursorrules/AGENTS.md + verify commands     ³
³  guard synthesis · revision proposals · time-travel materialisation            ³
├─ L3 RETRIEVAL ─────────────────────────────────────────────────────────────────┤
³  4-level index → RRF fusion → cross-encoder/NLI rerank → structural gate       ³
├─ L2 REASONING  ← the differentiating layer ────────────────────────────────────┐³
³  JTMS labeller · contradiction detector (3 gates) · dependency-directed        ³³
³  backtracking · cascade · entrenchment-ordered adjudication · nogood recording ³³
├─ L1 EXTRACTION ────────────────────────────────────────────────────────────────┤
³  transcript → decisions + PREMISES + alternatives + provenance + snippets      ³
³  entity resolution onto existing nodes (merge, don't append)                   ³
├─ L0 SUBSTRATE ─────────────────────────────────────────────────────────────────┤
³  append-only bi-temporal event log · hash chain · localStorage + JSON import   ³
└────────────────────────────────────────────────────────────────────────────────┘
           AI seam: every L1–L4 operation has an LLM impl and a local impl
```

The one-line architecture pitch: **"An event-sourced, bi-temporal decision knowledge base with a JTMS-style truth-maintenance layer on top, and a compiler at the end that emits agent-readable, machine-verifiable context files."**

---

## 8. What to cut, and what to build first

Everything above is the *concept*. For an afternoon-to-weekend build, rank by (novelty × demo-impact) ÷ cost:

| Build | Why | Cost |
|---|---|---|
| **Premise extraction + shared premise nodes** | The differentiator. Without it you're ai-memory with better CSS. | Med |
| **Cascade + revision proposal UI** | The demo peak. "This and these two are now unsound." | Med |
| **Rejected-alternative pre-emption** | Highest wow-per-line in the whole product. | Low |
| **Executable guards + compliance score** | Makes "proper working" undeniable; deterministic, no LLM needed. | Med |
| **4-level index + RRF + evidence contract** | The architecture answer when judges probe retrieval. | Med |
| **Agent-optimized export with verify commands** | Table stakes now, but the verify command is the twist. | Low |
| Bi-temporal time slider | Beautiful, cheap once events are append-only. | Low |
| Decision graph (premise lattice, not just decisions) | Visually distinctive; shows *why* the cascade happened. | Med |
| DecisionMemEval | Only if you have a spare evening. Disproportionate credibility. | High |
| Hash chain | 20 lines. Mention it, don't demo it. | Trivial |

**Drop entirely:** auth, multi-user, live hooks (name it as v2 — agentmemory already owns the hook-based capture space, so don't compete there; compete on *reasoning*).

---

## 9. Positioning statement, final form

> **WhyLog is a truth maintenance system for the decisions you make while building with AI.**
>
> Existing tools give your agent a memory. WhyLog gives it a *conscience*: every decision is stored with the premises it depends on and the alternatives it rejected, the graph is kept logically consistent as new information arrives, invalidation cascades to everything that rested on a premise you just broke, and each decision compiles into an executable check plus an agent-readable rule with a verify command.
>
> Memory tools stop you repeating yourself. WhyLog stops you **building on a decision that stopped being true three weeks ago** — which is the more expensive mistake, and the one your agent will never catch on its own.

**The stat to open with:** with ADRs present, coding agents made **~90% fewer wrong turns** (191 → 20 across 15 tasks in 10 repos), used **37% fewer tokens**, and finished **22% faster** ([actual.ai](https://actual.ai/blog/agent-optimized-adrs)). Then the twist: *but those ADRs were written by hand, they go stale silently, and when two of them contradict each other the model picks one arbitrarily.* That's the hole. WhyLog fills it.

---

## 10. Open questions before we build

1. **Premise extraction is the hard part.** RAAM needed deep system understanding; ARGUS got only 15.4% precision on Alternatives. Do we accept lower precision and lean on the review diff, or restrict premise types to a closed set of 8 (recommended)?
2. **Guards need a target.** In-browser virtual file tree for the demo, or a pasted `package.json` + file listing? (Recommend: paste `package.json`, optionally a `tree` output.)
3. **Does the cascade get shown as a graph animation?** Highest design score available, and the premise lattice is genuinely a different picture from every other decision-graph UI.
4. **How much of §5 do we build vs. describe?** My recommendation: build 5.1, 5.3, 5.4; describe 5.2 and 5.5 in the pitch as the roadmap.
