# Phase 2 — Truth Maintenance Layer ★

| | |
|---|---|
| **Layer** | L2 — Reasoning |
| **Depends on** | Phase 0 (formalism, event log) · Phase 1 (decisions, premises, justifications) · Phase 3 *for gate (b) only* · Phase 4 *for implementation_cost only* |
| **Blocks** | Phases 5, 6, 7 |
| **Estimate** | 8 h |
| **Research** | [docs/02](../docs/02-truth-maintenance-theory.md) — the whole document is this phase's specification · [docs/03 §4](../docs/03-retrieval-and-contradiction.md) (three-gate detector) |
| **Gate** | **G2 — It reasons.** The single most important gate in the plan |

**Objective in one sentence:** maintain the logical validity of the decision graph — detect when a decision has stopped being supported, backtrack to the assumptions responsible, cascade invalidation to everything that rested on them, and propose a minimal revision for a human to approve.

**This phase is the product.** If G2 fails, nothing downstream is worth polishing. If G2 succeeds, WhyLog is in a quadrant no other tool occupies ([docs/01 §5](../docs/01-prior-art-landscape.md)).

**Build order within this phase.** Gates **(a)** and **(c)** first — they are deterministic, they carry the demo, and they let this phase land before Phase 3 exists. Gate **(b)** is added once the retrieval stack is available.

---

## The REVISE cycle

```
                        new information
       ┌──────────────────────┼──────────────────────┐
       ³                      ³                      ³
  transcript chunk      user decision           guard result / repo scan
       ³                      ³                      ³
       └──────────────────────┼──────────────────────┘
                              ▼
                     ┌─────────────────┐
                     ³  2.1  ASSERT    ³  write events, set premise labels
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³  2.2  LABEL     ³  JTMS validity over the network
                     └────────┬────────┘
                              ▼
              ┌───────────────┴───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐    ┌──────────┐
        ³ 2.3 GATE ³   ³ 2.4 GATE ³    ³ 2.5 GATE ³
        ³  (a)     ³   ³  (b)     ³    ³  (c)     ³
        ³STRUCTURAL³   ³ SEMANTIC ³    ³ PREMISE  ³
        ³ same var ³   ³ retrieve ³    ³ IN-list  ³
        ³ diff val ³   ³ +classify³    ³ falsified³
        ³  O(1)    ³   ³ needs P3 ³    ³ or OUT-  ³
        ³          ³   ³          ³    ³ list met ³
        └────┬─────┘   └────┬─────┘    └────┬─────┘
             └──────────────┼───────────────┘
                            ▼  any gate fired?
                     ┌─────────────────┐
                     ³ 2.6  BACKTRACK  ³  dependency-directed → culprit set + nogood
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³ 2.7  CASCADE    ³  forward propagate, stop at independent support
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³ 2.8 ADJUDICATE  ³  entrenchment order, EE3 cap, screen newcomer
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³ 2.9  PROPOSE    ³  human gate — never auto-apply
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³ 2.10 COMMIT     ³  events, relabel, re-run guards, bust export cache
                     └────────┬────────┘
                              ▼
                     ┌─────────────────┐
                     ³ 2.11 AUDIT      ³  every flip carries a reason
                     └─────────────────┘
```

---

## Sub-phases

### 2.1 — Assertion entry point

**Goal.** One function, four input kinds, identical downstream behaviour.

Every source of new information — a reviewed extraction batch, a manual user decision, a guard result, a repo scan — enters the same cycle. This is what makes guard failures (Phase 4) and transcripts equivalent in the eyes of the reasoner, and it is the reason `implementation_cost` can feed entrenchment without a special case.

**Behaviour.** Append the corresponding events (`PremiseAsserted`, `DecisionProposed`, `GuardFailed`…), set labels on new premises, attach justifications. Then invoke the labeller.

**Acceptance criteria.** All four input kinds produce a revision cycle with no branching in the reasoning code.

---

### 2.2 — The JTMS labeller

**Goal.** Compute `IN / OUT / UNKNOWN / UNFOUNDED` for every node from its justifications.

**Validity rule (Doyle).** A decision is **IN** iff at least one of its justifications is valid — every node in the IN-list is IN, and **no node in the OUT-list is IN**.

**Label semantics.**

| Label | Condition | Display |
|---|---|---|
| `IN` | ≥1 valid, well-founded justification | **Sound** |
| `OUT` | every justification invalid | **Unsound** — naming the specific premise that failed |
| `UNKNOWN` | premises neither confirmed nor refuted | **Unverified** |
| `UNFOUNDED` | justification chain is circular, or never reaches a premise node | **Unfounded** — a data-quality warning, not a truth claim |

**Well-foundedness check.** Doyle's requirement exists because a node can be IN on a circular argument (`G` justified by `H`, `H` justified by `G`), which he calls *"imprudent… nodes believed on tenuous circular bases lead to ill-considered actions."* An LLM extractor **will** produce circular justifications. Detect cycles on write; label `UNFOUNDED`; never silently mark IN.

**Fixpoint.** Iterate label propagation until no label changes. The graph is shallow (depth rarely exceeds 4); two or three iterations typically suffice.

**Acceptance criteria.**
- Falsifying an IN-list premise flips the decision to OUT.
- **Satisfying an OUT-list premise flips the decision to OUT** — the non-monotonic case, and the one that must be explicitly tested.
- A circular justification produces `UNFOUNDED`, not `IN`.
- Labelling reaches a fixpoint and terminates on a graph with 500 nodes in well under a frame.

---

### 2.3 — Gate (a): structural contradiction

**Goal.** Deterministic, zero-latency, model-free contradiction detection.

**Rule.** Two IN-labelled decisions with the **same variable** and **different canonical values** are a structural contradiction. Additionally, two IN-labelled decisions asserting **opposite members of an antonym pair** (Phase 0.7 table C) on the same variable.

**Lookup.** `variableIndex: variable → [decisionIds]`, then compare canonical values. `O(1)` amortised.

**Why this gate is the credibility anchor.** It needs no model, no network, no threshold, and no judgement. When someone asks "is this just an LLM wrapper?", this is the answer: the most important contradiction in the demo fires from a hash lookup.

**Precision discipline.** Structural hits are high-precision but low-recall — they only fire when both decisions resolved to the same ontology variable. Never widen it by fuzzy matching; that is gate (b)'s job.

**Acceptance criteria.** Logging `DATABASE = postgres` while `DATABASE = sqlite` is IN fires immediately, keyless, with an explanation naming both decisions.

---

### 2.4 — Gate (b): semantic contradiction

**Goal.** Catch conflicts that share no literal token and no variable — *"no server"* versus *"deploy to Fly.io"*.

**Two stages, never one.**

```
   candidate ──► RETRIEVE (Phase 3 stack) ──► top-k similar decisions
                                                     ³
                                                     ▼
                                        ┌────────────────────────┐
                                        ³       CLASSIFY         ³
                                        ³  LLM path: pairwise    ³
                                        ³    verdict over top-3  ³
                                        ³  Local path: NLI-style ³
                                        ³    rules over polarity,³
                                        ³    scope, antonyms     ³
                                        └───────────┬────────────┘
                                                    ▼
                    contradiction ³ reversal ³ refinement ³ neutral
```

**Invariant I3, enforced here:** *similarity never produces a verdict.* "Use Postgres" and "don't use Postgres" are ~0.9 cosine similar. A similarity threshold deciding a contradiction is a bug, not a tuning problem.

**Verdict taxonomy — five outcomes, not two.**

| Verdict | Meaning | Consequence |
|---|---|---|
| **contradiction** | Cannot both hold | Full revision cycle |
| **reversal** | Newer deliberately replaces older on the same variable | Supersede; both retained; `supersedes` edge |
| **refinement** | Same variable, same value, added or corrected rationale | Merge; corroboration +1; no label change |
| **premise-invalidation** | No decision conflict; a shared premise became false | Gate (c) path |
| **neutral** | Topically related, logically compatible | `related` edge for the graph view; nothing else |

**Refinement is the verdict that decides whether the tool survives contact with a real user.** It is by far the most common relationship between two related decisions, and a system that flags it as a conflict gets switched off within a day.

**M1 / M2 diagnostics** (borrowed from [arXiv:2506.11005](https://arxiv.org/abs/2506.11005)) — surface as distinct warnings because they mean different things:
- **M1** — similar decisions, contradictory rationales → probable misunderstanding. The decision may be fine; the *reason* is broken.
- **M2** — contradictory decisions, similar rationales → probable copy-paste or extraction error. A data-quality problem, not a reasoning problem.

**Acceptance criteria.**
- Cross-variable conflict ("no server" vs "deploy to Fly.io") is caught.
- A refinement is **not** reported as a conflict.
- M1 and M2 appear as distinguishable warning types.
- The gate is disabled gracefully, with a visible notice, when no engine supports classification.

---

### 2.5 — Gate (c): premise invalidation ★

**Goal.** Detect the case where **nothing contradicts you and the world simply moved.** This is the novel gate, and the one no competitor has.

**Two firing conditions.**

```
   new assertion A
        ³
        ├── A falsifies a premise p where  p ∈ IN-list(J) for some decision d
        ³        └──► J becomes invalid ──► d loses support
        ³
        └── A satisfies a premise q where  q ∈ OUT-list(J) for some decision d
                 └──► J becomes invalid through its OUT-list
                      (Doyle's NON-MONOTONIC justification)
```

**Worked example (the demo).**

```
   J-0007  ⟨ IN: [P-0002 single-user, P-0005 no-deploy-infra]
             OUT: [P-0011 needs-concurrent-writers] ⟩   ⇒  WLD-0007 "SQLite, not Postgres"

   new transcript: "the sync worker writes while the UI writes"
        ³
        ▼
   EXTRACT   → premise assertion: concurrency.max_writers > 1
   RESOLVE   → matches P-0011 by predicate (exact)
   ASSERT    → L(P-0011) := IN
        ³
        ▼
   GATE (c)  → P-0011 ∈ OUT-list(J-0007)  ──► J-0007 INVALID
        ³
        ▼
   The user never mentioned SQLite. Never contradicted themselves.
   WLD-0007 is unsound anyway.
```

**Why this gate is worth more than the other two combined.** Gates (a) and (b) require the user to *say* something inconsistent. Gate (c) requires only that reality drift — which is what actually happens, and is why [docs/05 §1.2](../docs/05-rationale-mining-literature.md) (Lehman: *"invalidation of assumptions is one of the drivers of the need for continual software evolution"*) is the theoretical warrant for the whole product.

**Sources of invalidating assertions.** Reviewed transcript extraction · manual user input · **guard results (Phase 4)** · repo scans. All four arrive through the same entry point (2.1).

**Precision discipline.** Gate (c) fires only on **resolved premise identity** — an exact predicate match, or a merge confirmed in review. Never on text similarity alone. A false premise resolution ("single user" merged with "single sign-on") produces a confident, spectacular, entirely wrong cascade.

**Acceptance criteria.**
- The worked example above fires end to end, keyless.
- Invalidating a premise shared by three decisions flags all three.
- A textually similar but differently-typed premise does **not** fire.

---

### 2.6 — Dependency-directed backtracking & nogoods

**Goal.** On contradiction, find the **specific assumptions** responsible — not the most recent change.

**Method (Doyle).** From the contradiction node, trace justification arcs **backwards**: antecedents of antecedents, accumulating the assumption nodes that directly support the contradiction. Assumptions are nodes whose justifications have no incoming arcs — i.e. premises, not derived decisions.

**Minimal culprit set (ATMS borrowing).** Prefer the smallest set of assumptions whose revision resolves the contradiction. Give up as little as possible.

**Nogood recording.** When the culprit set `C` is found, record `N = C` as a **nogood**: this conjunction of assumptions cannot all hold.

```
   contradiction node
          ▲
          ³ justification arcs, traversed backwards
          ³
     ┌────┴────┐
     ³ derived ³──► keep tracing
     └────┬────┘
          ▲
     ┌────┴────┐
     ³ PREMISE ³──► stop; add to culprit set C
     └─────────┘

   record NOGOOD:  ¬( P-0002 ∧ P-0011 )
   "single-user" and "needs concurrent writers" cannot both hold
```

**Why the nogood is a product feature, not bookkeeping.** In classical TMS a nogood is internal state. Here it is **the explanation**: *"these two assumptions cannot both hold"* is the single most useful sentence the system can produce, and it is what makes the revision proposal legible to a human. Display it prominently.

**Nogood reuse.** Before proposing a revision, check whether the proposal would re-assert a recorded nogood. If so, warn: *"You are re-asserting a combination you already found impossible on Oct 3."*

**Bounds.** Depth-bounded to 6; branching bounded by justification count. On exceeding either, report the partial culprit set and say it is partial.

**Acceptance criteria.**
- Backtracking from a contradiction reaches the responsible premise, not the most recent decision.
- The nogood is recorded, displayed, and blocks re-assertion.
- Depth bounds are respected and partial results are labelled partial.

---

### 2.7 — Cascade propagation

**Goal.** When a node loses support, propagate to everything that depended on it — **and stop where support survives.**

```
   P-0011 := IN   (falsifies OUT-list of J-0007)
        ³
        ▼
   J-0007 invalid ──► WLD-0007 "SQLite, not Postgres" := OUT
                            ³
              ┌─────────────┼─────────────────┐
              ▼             ▼                 ▼
      J-0011 depends   J-0019 depends    J-0023 depends
      on WLD-0007      on P-0002, P-0005 on WLD-0007 AND
              ³             ³             has independent
              ▼             ▼             support
      WLD-0011 := OUT   WLD-0019 SURVIVES      ³
      "skip connection  "no migration          ▼
       pooling"          tooling"         WLD-0023 := OUT
              ³
              ▼
        (recurse, depth-capped)
```

**The stop condition is the design.** A node with an **independent surviving justification** keeps its label. This is Veritas's *zombie-belief prevention* — "derived beliefs cannot outlive their premises" — applied in the other direction: beliefs with their own grounding **do** survive a sibling's collapse.

**Over-retraction is worse than under-retraction.** A tool that flags everything gets switched off. Concretely:
- Cascade follows **shared-premise edges only**, never topical similarity.
- Depth is capped (default 4); beyond it, report *"N more potentially affected"* rather than flipping them.
- Every cascade step writes a `CascadePropagated` event with the reason, so the chain is inspectable link by link.

**Fixpoint.** Repeat until no label changes.

**Acceptance criteria.**
- The fixture cascade flips WLD-0007 and WLD-0011, and **WLD-0019 survives**.
- Cascade never follows a `related` edge.
- Depth cap produces an explicit "N more affected" message.
- Every flip in the chain is individually explainable in the UI.

---

### 2.8 — Entrenchment & adjudication

**Goal.** When something must give, decide what — transparently.

**Scoring function** ([docs/02 §3.4](../docs/02-truth-maintenance-theory.md)):

```
   E(d) = 0.30 · source_authority      provenance-derived (Phase 1.6)
        + 0.20 · implementation_cost   ← NOVEL TERM, from Phase 4 guards
        + 0.20 · corroboration         log-scaled independent justifications
        + 0.15 · confidence            extraction confidence
        + 0.15 · recency               30-day half-life on VALID time
```

| Term | Source | Note |
|---|---|---|
| `source_authority` | Origin classification: `human_stated` 1.0 · `human_override` 0.9 · `agent_proposed_human_accepted` 0.8 · `agent_inferred` 0.4 · `low_confidence` 0.2 | Replaces Veritas's hand-supplied reliability float. Nobody types a reliability number into a chat transcript, so it must be inferred |
| `implementation_cost` | Fraction of the decision's accepted guards currently passing | **The novel term.** No belief-revision system has it because none is attached to a codebase. Defaults to 0.5 with **no guards**, and is displayed as *"unknown — no guard"*, never as *"medium"*. A missing measurement must not masquerade as a measurement |
| `corroboration` | `log2(1 + n_independent) / log2(1 + n_max)` | Independent = different transcript, different session, or a passing guard |
| `confidence` | Phase 1.8 | Direct |
| `recency` | `exp(−ln2 · age_days / 30)` on **valid time** | Weighted lowest, because it *raises* entrenchment — a fresh bad decision resists retraction |

**EE3 cap (dominance).** After the weighted sum: `E(d) ó min(E(p))` over the decision's premises. **A derived belief is never more entrenched than its weakest premise.** Without this, a well-corroborated decision resting on a wild guess looks unshakeable.

**Non-prioritized screening (Hansson).** If the newcomer cannot outrank **every** contradictor, **reject the newcomer** and mark it `CONTESTED`. Do not corrupt the log. A low-confidence extracted remark must not silently reverse a considered, human-stated, already-implemented decision.

**Rejection is never silent.** A rejected newcomer appears in a **Contested queue** with the full entrenchment breakdown of both sides and an explicit **"override anyway"** action, which writes a `HumanOverride` event and raises the newcomer's authority to 0.9.

**Ordering.** Retract weakest first. Contraction (withdraw support) and revision (assert a new value) are distinguished in the UI, because they are different actions with different consequences.

**Acceptance criteria.**
- The entrenchment breakdown is visible as five labelled components for every proposal.
- The EE3 cap measurably lowers the score of a decision resting on a weak premise.
- A weak newcomer is rejected and lands in the Contested queue, not applied.
- "Override anyway" works, records the override, and changes future adjudication.

---

### 2.9 — Revision proposal & the human gate ★

**Goal.** Present the minimal revision. **Never auto-apply.** (Invariant I4.)

**Proposal content — all seven parts, every time:**

```
   ⚠ UNSOUND  WLD-0007 — "Use SQLite, not Postgres"

   1. WHAT FAILED
      Premise P-0011 "no concurrent writers" was falsified.

   2. THE EVIDENCE
      "the sync worker writes while the UI writes"
      transcript t₂ · chars 1840–1893 · 2 minutes ago        [click to expand]

   3. THE NOGOOD
      "single-user" and "needs concurrent writers" cannot both hold.

   4. THE CASCADE
      WLD-0011 "Skip connection pooling"      → UNSOUND (depended on WLD-0007)
      WLD-0019 "No migration tooling"         → SURVIVES (independent support)

   5. ENTRENCHMENT  0.78 — HIGH
      source_authority     1.00  you stated it yourself
      implementation_cost  1.00  both guards pass (better-sqlite3 present, no pg)
      corroboration        0.31  one independent justification
      confidence           0.90  strong cue, resolved slot, rationale present
      recency              0.62  18 days old
      EE3 cap              not binding — weakest premise 0.81

   6. ACTIONS
      [ Reverse → Postgres ]  [ Keep & re-justify ]  [ Mark P-0011 contested ]

   7. WHY NOT AUTO-APPLIED
      The newcomer (confidence 0.85, single source) does not outrank
      an entrenched, implemented, human-stated decision.
```

**Three actions, and why all three are needed.**

| Action | Formal operation | When it's right |
|---|---|---|
| **Reverse** | Revision — new value asserted, old decision superseded | The premise really is gone |
| **Keep & re-justify** | Repair the justification without changing the decision — the user supplies a new premise | **The most common real outcome**, and absent from every prior system. E.g. add P-0024 "writes are serialised through a single queue" |
| **Mark contested** | Contraction — withdraw support, leave the decision OUT pending investigation | You don't know yet |

"Keep & re-justify" is the action a real builder wants most of the time, and it is not expressible in any system surveyed in [docs/01](../docs/01-prior-art-landscape.md). Build it properly: it must accept a free-text new premise, type it, and re-run the labeller.

**Acceptance criteria.**
- All seven parts render for every proposal.
- No label change occurs without a corresponding human action event.
- "Keep & re-justify" restores the decision to IN with a new, inspectable justification.
- The proposal is comprehensible to someone who has not read the research docs — test this on a person.

---

### 2.10 — Audit trail

**Goal.** Every flip carries a reason, and the whole chain is replayable.

Append-only events with mandatory `reason` strings (Phase 0.1). The audit view answers three questions:
- *Why is this decision unsound?* → the cascade chain, link by link.
- *Who changed this, and when?* → actor and both timestamps.
- *What did we believe on Oct 12?* → fold over the event prefix (Phase 6.7).

Veritas's principle, adopted verbatim as a design rule: **"Nothing disappears silently. The audit log records reasons, not just events."**

**Acceptance criteria.** Any label in the graph can be traced to the event that set it and the reason attached to that event.

---

### 2.11 — Engine seam for reasoning

**Goal.** Two implementations of `classify`, identical verdict taxonomy.

| | LLM engine | Local engine |
|---|---|---|
| Gate (a) | Identical — deterministic, not engine-dependent | Identical |
| Gate (b) | Pairwise verdict over top-3 retrieved candidates | NLI-style rules: shared variable + differing value → reversal; negation cue + same variable/value → contradiction; same variable/value + new rationale → refinement; else neutral |
| Gate (c) | LLM confirms premise falsification when the predicate match is ambiguous | Exact predicate match only; ambiguous cases are surfaced for human confirmation rather than guessed |
| Backtracking | Identical — graph traversal, not engine-dependent | Identical |
| Entrenchment | Identical — arithmetic | Identical |
| Proposal prose | Generated | Templated from structured fields |

**The important property:** gates (a) and (c), backtracking, cascade, entrenchment and adjudication are **all deterministic and engine-independent**. The LLM improves gate (b)'s recall and the proposal's phrasing. It is not load-bearing for correctness. That is the strongest possible answer to "is this an LLM wrapper?" and it should be stated in those words.

**Acceptance criteria.** The entire G2 gate demonstration runs keyless on the local engine.

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| **Cascade cries wolf** | 🔴 | Shared-premise edges only; stop at independent support; depth cap; over-retraction treated as worse than under-retraction |
| **False premise resolution** → spectacular wrong cascade | 🔴 | Predicate-first identity; forbid cross-type merges; ambiguous matches go to human confirmation, never to a guess |
| Refinement flagged as conflict → user disables the feature | 🟠 | Refinement is an explicit verdict; tune for it specifically; it is the most common relationship |
| Entrenchment weights feel arbitrary to a judge | 🟡 | Cite the lineage (Veritas's published scoring, Gärdenfors–Makinson conditions) and show all five components in the UI |
| Circular justifications from the extractor | 🟡 | Cycle detection on write; `UNFOUNDED` label; never silently IN |
| Gate (b) blocked on Phase 3 | 🟡 | Build (a) and (c) first — they carry the demo. Add (b) when the index exists |
| `implementation_cost` unavailable until Phase 4 | 🟡 | Default 0.5, displayed as "unknown — no guard". Never as "medium" |
| Proposal text too technical to read | 🟠 | Seven-part template with plain-language labels; test on someone who hasn't read the docs |

---

## Definition of done

- [ ] Single assertion entry point handling transcripts, user decisions, guard results and repo scans
- [ ] JTMS labeller reaching a fixpoint, with `UNFOUNDED` detection for circular justifications
- [ ] **Non-monotonic OUT-list invalidation tested explicitly**
- [ ] Gate (a) structural — deterministic, keyless, `O(1)`
- [ ] Gate (b) semantic — five-verdict taxonomy, M1/M2 diagnostics, refinement not flagged as conflict
- [ ] **Gate (c) premise invalidation — the fixture demo fires end to end keyless**
- [ ] Dependency-directed backtracking reaching premises, with nogoods recorded, displayed, and reused
- [ ] Cascade with the independent-support stop condition; depth cap; per-step explainability
- [ ] Entrenchment with all five terms, the EE3 cap, and a visible breakdown
- [ ] Non-prioritized screening: weak newcomers rejected into a Contested queue with an override path
- [ ] Revision proposals with all seven parts and all three actions, including **Keep & re-justify**
- [ ] Audit trail: every label traceable to an event and a reason
- [ ] **Gate G2 passes: falsify `single-user` → WLD-0007 UNSOUND → WLD-0011 cascades → WLD-0019 survives → proposal appears with entrenchment breakdown**
