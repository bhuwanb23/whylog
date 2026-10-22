# WhyLog — Master Plan
### Overview of all phases, their dependencies, and the invariants that hold them together

**Read this first.** Each phase has its own file with full sub-phase detail.
Research backing every decision here lives in [`../docs/`](../docs/).

---

## 1. What we are building

> **WhyLog is a truth maintenance system for the decisions you make while building with AI.**

Not a memory. Not a notes app. Not an ADR tool with a paste box.

A decision is not a fact — it is a belief held under assumptions about the world. *"SQLite, not Postgres"* is true **given** single-user, no deploy infrastructure, no concurrent writers. Nobody stores the *given*, and the *given* is exactly what changes. WhyLog stores it, keeps the resulting graph logically consistent as new information arrives, cascades invalidation to everything that rested on a broken premise, proposes a minimal revision for a human to approve, and compiles each decision into an executable check plus an agent-readable rule.

**Category name to use:** *decision truth maintenance* — glossed as *"a decision log that checks itself."*

Full argument: [`docs/00-research-summary.md`](../docs/00-research-summary.md) · Novelty audit: [`docs/07-novelty-audit-and-positioning.md`](../docs/07-novelty-audit-and-positioning.md)

---

## 2. The five-layer architecture

```
┌─ L5  PRESENTATION ─────────────────────────────────────────────────────────────┐
│   Timeline · Ask (evidence-contract answers) · Health (metrics)                │
│   Premise Lattice (graph) · Time Machine (bi-temporal replay) · Export         │
├─ L4  SYNTHESIS ────────────────────────────────────────────────────────────────┤
│   answer() with groundedness verdict · compile() → agent files + verify cmds   │
│   guard synthesis · revision proposals · time-travel materialisation           │
├─ L3  RETRIEVAL ────────────────────────────────────────────────────────────────┤
│   4-level index → RRF fusion → rerank → structural gate → evidence contract    │
├─ L2  REASONING   ← the differentiating layer ──────────────────────────────────┤
│   JTMS labeller · 3-gate contradiction detector · dependency-directed          │
│   backtracking · cascade · entrenchment adjudication · nogood recording        │
├─ L1  EXTRACTION ───────────────────────────────────────────────────────────────┤
│   transcript → decisions + PREMISES + alternatives + provenance + snippets     │
│   entity resolution onto existing nodes (merge, never append duplicates)       │
├─ L0  SUBSTRATE ────────────────────────────────────────────────────────────────┤
│   append-only bi-temporal event log · hash chain · domain ontology · persist   │
└────────────────────────────────────────────────────────────────────────────────┘

        THE AI SEAM (vertical, cuts L1–L4)
        every operation has an LLM implementation and a LOCAL implementation,
        selected at runtime, badged in the UI, and never mixed silently
```

**Layer rule:** information flows up only. L2 never reaches into L4. L0 knows nothing about decisions — only events. This is what makes the AI seam swappable and the local path a genuine peer rather than a stub.

---

## 3. Phase map

| Phase | Name | Layer | Core outcome | Est. | Doc |
|---|---|---|---|---|---|
| **0** | Foundation & Substrate | L0 | An append-only, bi-temporal, hash-chained event store with a materialised decision graph and a shared ontology | 3.5 h | [phase-0](phase-0-foundation.md) |
| **1** | Extraction Pipeline | L1 | A transcript becomes decisions, **premises**, rejected alternatives and provenance — reviewed by a human before it enters the log | 6 h | [phase-1](phase-1-extraction-pipeline.md) |
| **2** | Truth Maintenance Layer | L2 | The differentiator. Three-gate detection, dependency-directed backtracking, cascade, entrenchment adjudication, human-gated revision proposals | 8 h | [phase-2](phase-2-truth-maintenance.md) |
| **3** | Retrieval & Q&A | L3 | Four-level index, RRF fusion, reranking, and answers that carry a groundedness verdict or refuse | 5 h | [phase-3](phase-3-retrieval.md) |
| **4** | Executable Decision Guards | L2↔L4 | Decisions compile into machine-checkable guards; drift becomes a number; guard results feed back as evidence | 5 h | [phase-4](phase-4-executable-guards.md) |
| **5** | Agent-Native Export Compiler | L4 | One graph compiles to `CLAUDE.md` / `.cursorrules` / `AGENTS.md` / `DECISIONS.md` / CI script, with verify commands and integrity stamps | 4 h | [phase-5](phase-5-export-compiler.md) |
| **6** | Presentation & Visual Language | L5 | Timeline, Health, **Premise Lattice**, Time Machine, review UX, mode badging | 6.5 h | [phase-6](phase-6-presentation.md) |
| **7** | Evaluation, Hardening & Pitch | — | `DecisionMemEval`, measured numbers, ablation toggles, demo kit, docs | 5 h | [phase-7](phase-7-evaluation.md) |

**Total: ~43 hours** of focused work for the complete concept.
**Minimum demonstrable product: Phases 0 → 1 → 2 → 6.1–6.3 ≈ 22 hours.** See §5.

---

## 4. Dependency graph

```
                        ┌──────────────┐
                        │   PHASE 0    │  Foundation & Substrate
                        │  event log   │  (everything depends on this)
                        │  ontology    │
                        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   PHASE 1    │  Extraction Pipeline
                        │ decisions +  │
                        │  PREMISES    │
                        └──────┬───────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │   PHASE 2    │ │   PHASE 3    │ │   PHASE 4    │
      │    TRUTH     │ │  RETRIEVAL   │ │   GUARDS     │
      │  MAINTENANCE │ │    & Q&A     │ │              │
      └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
             │                │                │
             │   ┌────────────┴───┐            │
             │   │  gate (b) of   │            │
             └──►│  Phase 2 uses  │◄───────────┘
                 │  Phase 3 stack │  implementation_cost
                 └────────┬───────┘  feeds entrenchment
                          │
                          ▼
                   ┌──────────────┐
                   │   PHASE 5    │  Export Compiler
                   │ needs graph  │  (reads L2 state + L4 guards)
                   │ + guards     │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   PHASE 6    │  Presentation
                   │ (can start   │  (6.1–6.3 after Phase 1)
                   │  early,      │
                   │  finishes    │
                   │  last)       │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   PHASE 7    │  Evaluation & Pitch
                   └──────────────┘
```

### 4.1 Cross-phase contracts worth noting

- **Phase 2 gate (b) consumes the Phase 3 retrieval stack.** Build Phase 3's index before Phase 2's semantic gate, or build gate (a) and (c) first and add (b) later. **Recommended: gates (a) and (c) first** — they are deterministic, they carry the demo, and they let Phase 2 land before Phase 3 exists.
- **Phase 4 feeds Phase 2.** `implementation_cost` is a term in the entrenchment function. Until guards exist it defaults to a neutral 0.5 and is *displayed as "unknown"*, never as "medium".
- **Phase 5 reads both Phase 2 and Phase 4.** An export compiled from an unsound log or with failing guards must warn before emitting.
- **Phase 6 is not a tail.** 6.1–6.3 (timeline, decision card, paste-and-review UX) should be built alongside Phases 1–2, because you cannot evaluate extraction quality without looking at it.

---

## 5. Sequencing and milestone gates

### 5.1 Recommended order

```
 CRITICAL PATH ───────────────────────────────────────────────────────────►

  P0 ──► P1 ──► P2 ──────────────► P5 ──► P6 ──► P7
           │      ▲                  ▲
           │      │                  │
           └─► P3 ┘ (feeds gate b)   │
           └─► P4 ───────────────────┘ (feeds implementation_cost + verify cmds)

 PARALLEL TRACK ──────────────────────────────────────────────────────────►

  P6.1 ──► P6.2 ──► P6.3        (UI grows alongside the pipeline)
```

### 5.2 Milestone gates

| Gate | After | The single question it answers | Evidence |
|---|---|---|---|
| **G1 — Walking skeleton** | P0 + P1 + P6.1–6.3 | Can a messy transcript become reviewed, structured, persisted decisions? | Paste the fixture → 5–6 decisions with premises appear in the timeline, all with verbatim snippets |
| **G2 — It reasons** | P2 | Does the log detect that a decision has stopped being true, *without being told*? | Falsify `single-user` → WLD-0007 goes UNSOUND → WLD-0011 cascades → WLD-0019 survives → a revision proposal appears with the entrenchment breakdown |
| **G3 — It answers** | P3 | Can it answer a "why" question with citations, and refuse when it can't? | "why did we drop auth?" → GROUNDED with citations. "why did we pick Kafka?" → INSUFFICIENT EVIDENCE with nearest-related |
| **G4 — It verifies** | P4 | Can a decision be proven wrong by the code, deterministically? | Paste a `package.json` containing `pg` → guard fails → compliance drops → gate (a) fires with no model involved |
| **G5 — It closes the loop** | P5 | Does the export carry the reasoning *and* the check? | Generated `CLAUDE.md` shows WLD-0007 with MUST/MUST NOT, `applies_to`, rejected alternatives, and a runnable verify command |
| **G6 — It is defensible** | P6 + P7 | Can every claim be backed with a number or a diagram? | DecisionMemEval results, ablation table, architecture one-pager, rehearsed demo |

**Rule: do not start a phase whose gate predecessor has failed.** G2 is the one that matters most — if the cascade does not fire correctly and conservatively, nothing downstream is worth polishing.

### 5.3 Three cut lines, in order

| Budget | Build | You get | You lose |
|---|---|---|---|
| **~22 h** | P0, P1, P2, P6.1–6.3 | The full differentiating concept, demonstrable end to end | Guards, export, graph view, Q&A |
| **~31 h** | + P3, P4 | Ask view with evidence contract + compliance score | Export compiler, lattice, time machine, benchmark |
| **~43 h** | everything | The complete concept, measured and pitch-ready | Nothing |

If forced below 22 hours, cut in this order: **Phase 7 → Phase 6.6/6.7 → Phase 5.5/5.6 → Phase 4.5 → Phase 3.5**. Never cut Phase 2 sub-phases 2.3 (premises), 2.6 (backtracking), 2.7 (cascade) or 2.9 (human gate) — those four *are* the product.

---

## 6. Scope

### In
Append-only bi-temporal event log · hash chain · domain ontology · transcript extraction of decisions **and premises** · rejected alternatives · provenance with verbatim snippets · entity resolution · human review gate · JTMS labelling · three-gate contradiction detection · dependency-directed backtracking · cascade with zombie prevention · entrenchment with implementation cost · minimal revision proposals · four-level retrieval index · RRF · reranking · evidence contract · guard synthesis · in-browser guard interpreter · CI script export · compliance metrics · agent-native export compiler · integrity stamps · timeline / health / premise-lattice / time-machine views · local and LLM engines behind one seam · DecisionMemEval.

### Out — and what to say instead
| Cut | Why | Say on stage |
|---|---|---|
| Auth, multi-user, teams, cloud sync | Not the concept; adds nothing to the argument | "Single-user by construction — which is itself a premise the tool tracks." |
| **Live capture via agent hooks** | agentmemory owns this with 12 hooks and 22k stars; competing on plumbing loses | "Deliberately not built. We'd rather consume their transcripts via MCP than build a thirteenth capture daemon." |
| Vector database / ANN index | Corpus is 10²–10│ documents; brute force is sub-millisecond | Stated as an architecture decision with numbers, not an omission |
| Graph database | Same reasoning; the graph is shallow and small | Same |
| ATMS multi-context reasoning | JTMS is the right backbone for a single current belief set | "v2 — it answers 'what would the log look like if we *did* go multi-user?'" |
| IDE extension / repo connection | Needs a filesystem; the paste-and-virtual-project path is honest and works anywhere | "Repo connection is how guards get their file list automatically. Today you paste it." |
| Real-time collaboration | Out of scope for the concept | — |

---

## 7. The four invariants

These are non-negotiable across every phase. Any sub-phase that violates one is wrong, not clever.

### I1 — Nothing is deleted, everything is an event
Nodes are relabelled, never removed. Every transition writes an immutable event with a reason and an actor. This is what makes the audit trail, bi-temporal replay, hash chain and revision history possible. Doyle's original insight: *"rather than deleting a sentence from the knowledge base entirely when it loses all justifications, we merely mark the sentence as being out."*

### I2 — Premises are shared nodes, not per-decision strings
"single-user" is **one** node that three decisions point at. Invalidate it once, all three flip, and the traversal is exact. This is the structural difference between a truth-maintenance system and a notes app with tags — and it is the thing most likely to be quietly abandoned under time pressure. Guard it.

### I3 — Retrieval proposes, a classifier disposes
Cosine similarity never produces a verdict. "Use Postgres" and "don't use Postgres" are ~0.9 similar. Similarity yields *candidates*; a structural, NLI or premise-level classifier yields the *judgement*. Any code path where a similarity threshold decides a contradiction is a bug.

### I4 — The system proposes, the human disposes
Nothing is auto-applied. Not a retraction, not a reversal, not a guard, not an export. Every automated judgement arrives as a proposal with an explanation and an explicit set of actions. Veritas auto-retracts because its inputs are programmatic assertions with declared reliability; WhyLog's inputs are extracted prose, and extracted prose must not be allowed to silently rewrite a considered decision.

---

## 8. The AI seam

One interface, four operations, two implementations each.

| Operation | LLM implementation | Local implementation |
|---|---|---|
| `extract` | One call per transcript chunk, strict JSON, three-run majority voting | Cue patterns + slot/value lexicon + premise cue phrases + negation/modality scope |
| `classify` (contradiction) | Pairwise verdict over top-3 candidates | Structural gate + antonym lexicon + negation cues |
| `retrieve` | Provider embeddings for L1/L2; model as listwise reranker | Hashed n-gram embedding + BM25 + interpretable weighted local rerank |
| `compose` (answer / export prose / guard rationale) | Generation over retrieved, cited decisions | Template composition from structured fields |

**Rules for the seam:**
1. Every result carries `engine: 'llm' | 'local'` and this is stored on the node, not just displayed.
2. The UI badges the engine on every operation. Never let a demo imply a capability it doesn't have.
3. The local path is the **default**, not the fallback. It must be complete enough to demo the entire concept with no key and no network.
4. Switching engines must not invalidate the log. Embeddings are tagged with the engine and model that produced them, and re-indexing is an explicit user action.

Detail: [`docs/03-retrieval-and-contradiction.md`](../docs/03-retrieval-and-contradiction.md) §6.

---

## 9. Feature → phase matrix

| Feature | P0 | P1 | P2 | P3 | P4 | P5 | P6 | P7 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Event log, bi-temporal, hash chain | ● | | | | | | | |
| Domain ontology (variables, values, premise types) | ● | | | | | | | |
| Transcript normalisation & segmentation | | ● | | | | | | |
| Decision extraction | | ● | | | | | | |
| **Premise extraction (closed set of 8)** | | ● | | | | | | |
| Rejected-alternative extraction | | ● | | | | | | |
| Provenance: snippet, span, origin, confidence | | ● | | | | | | |
| Entity resolution (merge, don't append) | | ● | | | | | | |
| Human review gate | | ● | | | | | ● | |
| JTMS labelling (IN/OUT/UNKNOWN/UNFOUNDED) | | | ● | | | | | |
| Gate (a) structural contradiction | | | ● | | | | | |
| Gate (b) semantic contradiction | | | ● | ● | | | | |
| Gate (c) **premise invalidation** | | | ● | | | | | |
| Dependency-directed backtracking + nogoods | | | ● | | | | | |
| Cascade with zombie prevention | | | ● | | | | | |
| Entrenchment scoring | | | ● | | ○ | | ● | |
| Minimal revision proposal | | | ● | | | | ● | |
| Four-level index + RRF + rerank | | | | ● | | | | |
| Inverted questions (HyPE) | | ○ | | ● | | | | |
| Evidence contract / groundedness | | | | ● | | | ● | ● |
| Guard taxonomy + synthesis | | | | | ● | | | |
| In-browser guard interpreter | | | | | ● | | | |
| CI script + workflow export | | | | | ● | ○ | | |
| Compliance / coverage / soundness metrics | | | | | ● | | ● | |
| Agent-native export compiler | | | | | | ● | | |
| Verify commands in exports | | | | | ○ | ● | | |
| Integrity stamps on exports | ○ | | | | | ● | | |
| Pre-export non-contradiction check | | | ○ | | | ● | | |
| Timeline / decision card | | | | | | | ● | |
| Health view | | | | | ○ | | ● | |
| **Premise Lattice graph** | | | | | | | ● | |
| Time Machine (bi-temporal replay) | ○ | | | | | | ● | |
| Mode badge & settings | | | | | | | ● | |
| DecisionMemEval benchmark | | | | | | | | ● |
| Ablation harness | | | | | | | | ● |
| Demo fixture corpus & script | | | | | | | | ● |

● = built here  ○ = contributes to / consumes from

---

## 10. Risk register

| # | Risk | Phase | Severity | Mitigation |
|---|---|---|---|---|
| R1 | **Premise extraction is too weak** — the whole concept rests on it | 1 | 🔴 Critical | Closed set of 8 types (RAAM's own precision problem is open-ended recovery); predicate-first resolution; review gate; fixture corpus with hand-labelled premises; measure it in P7 before claiming it |
| R2 | **Cascade cries wolf** — one flip takes out half the log | 2 | 🔴 Critical | Cascade follows shared-premise edges only; stop at independent justification; depth cap; treat over-retraction as worse than under-retraction |
| R3 | False-positive contradictions destroy trust | 2 | 🔴 Critical | Gate (a) precision-first; require shared variable for reversal; non-prioritized screening means a weak newcomer can't reverse a strong decision |
| R4 | Extraction garbage on a fresh transcript during the demo | 1, 7 | 🟠 High | Written fixture corpus; review diff makes bad output visibly correctable (a feature, not an apology); rehearse |
| R5 | Guards false-positive on day one | 4 | 🟠 High | Review gate before activation; baseline pattern; word-boundary matching; `warning` severity for string guards |
| R6 | Scope blowout — nine phases in a weekend | all | 🟠 High | §5.3 cut lines are pre-agreed. Gate G2 is the priority; everything after it is bonus |
| R7 | No network / no key in the demo environment | all | 🟡 Medium | Local path is the default and is complete. Documented in every phase |
| R8 | "Isn't this just ai-memory?" | 7 | 🟠 High | Never lead with extraction, search or export. Lead with the failure mode nobody handles. Scripted answer in [`docs/07`](../docs/07-novelty-audit-and-positioning.md) §5 |
| R9 | Premise lattice becomes an unreadable hairball | 6 | 🟡 Medium | Layout by premise type in columns; decisions as leaves; highlight one cascade at a time; never render the whole graph unfiltered |
| R10 | Bi-temporal ordering bugs when importing old transcripts | 0, 1 | 🟡 Medium | `decidedAt` and `learnedAt` are separate fields from day one; ordering uses `decidedAt`; tests cover pasted-historical-transcript case |

---

## 11. Definition of done — global

The concept is complete when all of the following are demonstrable in one continuous session, keyless:

1. Paste a 3,000-character transcript → reviewed decisions **with premises and rejected alternatives** appear, each with a verbatim snippet.
2. Falsify a premise by pasting a second transcript → the dependent decision is labelled **UNSOUND**, the cascade is shown, an independently-grounded sibling **survives**.
3. A revision proposal appears naming the failed premise, the evidence, the cascade, and an **entrenchment breakdown** — and offers Reverse / Keep & re-justify / Mark contested.
4. "Why did we drop auth?" returns a **GROUNDED** answer with citations that expand to snippets. A question the log can't answer returns **INSUFFICIENT EVIDENCE**.
5. Proposing a previously **rejected alternative** triggers pre-emption: *"You rejected Supabase on Oct 3: hosted dependency. Has that changed?"*
6. Paste a `package.json` containing `pg` → a guard fails → **compliance drops** → a structural contradiction fires **with no model involved**.
7. Export `CLAUDE.md` → it carries stable IDs, MUST/MUST NOT, `applies_to` globs, rejected alternatives, **verify commands**, status, and an **integrity stamp**.
8. The **premise lattice** shows the cascade as a highlighted subtree.
9. The **time machine** shows what the log believed on Oct 3 versus today.
10. Every operation is badged with its engine, and every number in the pitch comes from `DecisionMemEval` rather than from adjectives.

---

## 12. Where to start

**Phase 0, sub-phase 0.5 — the domain ontology.** It is the smallest artifact in the plan and the one that determines whether Phases 1, 2 and 4 feel intelligent or feel like regex theatre. Every extractor, every gate, every guard template reads from it.

Then **Phase 1 sub-phase 1.4 — premise extraction.** That is the load-bearing novelty. If premises cannot be recovered at usable precision, the concept needs rethinking before anything else is built, which is exactly why it comes second rather than last.
