# ARCHITECTURE

Six layers, one vertical AI seam, four invariants, three gates.

---

## 1. The layers

```
┌─ L5  PRESENTATION ─────────────────────────────────────────────────────────────┐
│   Foundation · Review · Reasoning · Ask · Guards · Export                       │
│   Graph (premise lattice) · Timeline · Health · Time Machine · Settings         │
├─ L4  SYNTHESIS ────────────────────────────────────────────────────────────────┤
│   answer() with groundedness verdict · compile() → agent files + verify cmds    │
│   guard synthesis · revision proposals · time-travel materialisation            │
├─ L3  RETRIEVAL ────────────────────────────────────────────────────────────────┤
│   5-level index → RRF fusion → rerank → structural gate → evidence contract     │
├─ L2  REASONING   ← the differentiating layer ──────────────────────────────────┤
│   JTMS labeller · 3-gate contradiction detector · dependency-directed           │
│   backtracking · cascade · entrenchment adjudication · nogood recording         │
├─ L1  EXTRACTION ───────────────────────────────────────────────────────────────┤
│   transcript → decisions + PREMISES + alternatives + provenance + snippets      │
│   entity resolution onto existing nodes (merge, never append duplicates)        │
├─ L0  SUBSTRATE ────────────────────────────────────────────────────────────────┤
│   append-only bi-temporal event log · hash chain · domain ontology · persist    │
└────────────────────────────────────────────────────────────────────────────────┘

        THE AI SEAM (vertical, cuts L1–L4)
        every operation has an LLM implementation and a LOCAL implementation,
        selected by capability, never by preference
```

**Dependency direction is strictly downward.** L2 does not import from L3. Where a higher layer needs a
lower one's judgement it takes it as a parameter — `ReviseInput.retrieve` is a function, not an import —
which is why the reasoning layer can be exercised without a retrieval index existing.

---

## 2. The AI seam

`src/ai/types.ts` declares `WhyLogEngine`. Every AI-shaped operation is a method on it, and there are
exactly two implementations:

| | `local/` | `llm/` |
| --- | --- | --- |
| Extraction | cue recognition over a 120-entry cue table | JSON-schema'd completion |
| Classification | delegates to the **one** rule engine in `retrieval/contradiction.ts` | same engine, plus a vote |
| Embeddings | always local, on both paths | always local |
| Voting | unsupported, and the pipeline ignores the option | three-run |
| Guard synthesis | templates: 5 variables specifically, all 15 generically | JSON, validated against the same schema |

Two rules keep the seam honest:

**Capability, not preference.** A caller asks `engine.capabilities().voting` and adapts. Nothing checks
`engine.kind === "llm"` — that test would put model identity into business logic and the local path would
rot into a stub within a phase.

**Embeddings never leave the machine.** On the LLM path, decision text is still embedded locally. Sending
a project's decision history to a provider to compute a cosine similarity buys nothing and costs a trust
conversation the product cannot win.

The consequence is the claim the benchmark exists to support: **gates (a) and (c), backtracking, cascade,
entrenchment and adjudication are all deterministic and engine-independent.** The whole of G2 runs keyless.
The LLM improves gate (b)'s recall and proposal phrasing and is not load-bearing for correctness.

---

## 3. The four invariants

| | Invariant | Where it is enforced |
| --- | --- | --- |
| **I1** | Nothing is deleted; everything is an event | `substrate/event-log.ts` — a closed 36-type vocabulary, append-only, hash-chained |
| **I2** | Premises are shared nodes | `substrate/identity.ts` — predicate-first resolution, `TAU_HIGH` 0.92 / `TAU_LOW` 0.78 |
| **I3** | Retrieval proposes, a classifier disposes | `retrieval/candidates.ts` feeds gate (b); the verdict comes from the rule engine, never from a similarity score |
| **I4** | The system proposes, the human disposes | guards are `proposed`, never auto-installed; contradictions raise proposals, never edits |

I1 is why a reset is a wipe rather than an undo: reversing a live demo would mean rewriting the log, and a
system that rewrites its own hash chain has just contradicted its first claim.

I2 is why the graph is **bipartite**. `Justification.consequent` is a `DecisionId`, so edges run
decision ↔ premise and never decision ↔ decision. A premise falsified once invalidates every decision
resting on it, which is the mechanism the whole product rests on — and it only works if the premise is one
node rather than one copy per decision.

I3 is the invariant that keeps retrieval honest. A cosine similarity of 0.87 is not a contradiction, and a
system that treats it as one produces the false positives that get tools uninstalled.

---

## 4. The three gates

```
        a new belief arrives
                │
    ┌───────────┴───────────┐
    │  GATE (a) STRUCTURAL  │  same variable, different canonical value,
    │                       │  overlapping validity window
    └───────────┬───────────┘  → contradiction / reversal / refinement
                │
    ┌───────────┴───────────┐
    │  GATE (b) SEMANTIC    │  retrieved near-duplicates that are lexically
    │                       │  dissimilar enough for (a) to miss
    └───────────┬───────────┘  → the only gate that can use an LLM
                │
    ┌───────────┴───────────┐
    │  GATE (c) PREMISE     │  nothing contradicts you; an assumption the
    │                       │  decision rests on stopped holding
    └───────────┴───────────┘  → non-monotonic retraction
```

Gates (a) and (b) fire when **you** contradict yourself. Gate (c) fires when **reality** does. That
distinction is the product.

Gate (c) is the formal signature of non-monotonic reasoning: a Doyle SL justification is valid iff every
IN-list node is IN **and no OUT-list node is IN**. A non-empty OUT-list is what makes retraction possible
at all. A graph with only IN-lists is monotonic — adding information can never retract a conclusion, so it
can never notice that the world moved.

The ablation switch `premiseInvalidation` removes gate (c) and is predicted to be the largest single delta
in the study. If it is not, the architecture's central claim is wrong and the audit says so.

---

## 5. Data flow

```
paste transcript
      │
      ▼
 L1  normalise → segment into EPISODES → extract candidates → validate every snippet
      │            (extraction is per episode, not per sentence — the deliberate
      │             deviation from arXiv:2506.11005)
      ▼
     identity ladder → merge onto existing nodes, or mint
      │
      ▼
 L0  append events → hash chain → fold into GraphState
      │
      ▼
 L2  revise():  gate (a) → gate (b) → gate (c) → Hansson adjudication → cascade → label()
      │                                              (entrenchment ordering)   (fixpoint)
      ▼
     RevisionProposal[]  ──→  the human accepts, overrides or dismisses   [I4]
      │
      ▼
 L3  buildIndex → 5 levels → RRF (k=60) → rerank
      │
      ▼
 L4  answer() under the evidence contract · compile() → CLAUDE.md / AGENTS.md /
      .cursorrules / DECISIONS.md + verify commands compiled from Phase 4 guards
      │
      ▼
 L5  the eleven views
```

Every mutation is **append → fold → persist**. There is no code path that edits a node in place.

### Bi-temporality

Two independent times, because conflating them loses the only interesting question:

- **valid time** (`occurredAt`) — when the decision was true in the world
- **learned time** (`at`) — when the system was told, monotonically increasing, hash-chained

Valid time is **not** a prefix fold: events are stored in learned order, so "what was true in October" is a
filter (`isValidAt`) over the whole log. Learned time **is** a prefix fold (`materializeAsOf`), because
"what did we know in October" is exactly the first N events. Getting these the wrong way round produces a
Time Machine that shows decisions before they were made.

---

## 6. The one-pager version

> A decision is a belief held under assumptions. *"SQLite, not Postgres"* is true **given** single-user,
> no deploy infrastructure, no concurrent writers.
>
> Every competitor stores the decision. None stores the *given*.
>
> So contradiction detection fires when you contradict yourself — and premise invalidation fires when
> reality does. The second one is the product, and it is why the graph is bipartite, why the log is
> append-only, and why the layout is deterministic rather than force-directed.
