# 02 — Truth Maintenance Theory
### The formal core of WhyLog, and exactly where we deviate from it

**Purpose:** give the central mechanism a rigorous foundation. Everything in [plan/phase-2](../plan/phase-2-truth-maintenance.md) implements what is specified here.

---

## 1. Why a 1979 AI technique is the right frame

A **Truth Maintenance System** exists to solve one problem: *a reasoning system holds conclusions, and it must know, at all times, which of those conclusions still follow from what it currently believes.*

Doyle's framing is unusually close to the WhyLog problem:

> "A reasoning program should not just hold conclusions, it should remember **why** it holds them. Each belief carries justifications — records of the other beliefs that support it. Because support is tracked explicitly, the system can tell which beliefs currently rest on valid foundations and **which have lost their support**."

Substitute *decision* for *belief* and *premise* for *supporting fact* and this is a description of what a solo builder needs and does not have. The agent holds conclusions. You held them three weeks ago. Neither of you knows which have lost their support.

Two properties of TMS are what make it more than a database with foreign keys:

1. **Nothing is deleted.** A belief that loses support is relabelled OUT, not removed. Doyle: *"rather than deleting a sentence from the knowledge base entirely when it loses all justifications, we merely mark the sentence as being out."* The history of what you thought, and why you stopped thinking it, is the product.
2. **Revision is targeted, not blunt.** On contradiction the system performs **dependency-directed backtracking**: *"instead of blindly undoing the most recent choice, it traces the chain of justifications back to the specific assumptions responsible for the conflict and revises exactly those."*

---

## 2. The dependency network

A TMS maintains two kinds of vertex:

- **Nodes** — represent potential beliefs. Each has a *statement* `St(N)`.
- **Justifications** — represent reasons for belief. Arcs run node → justification → node.

Each node carries a **label**: `IN` (currently believed) or `OUT` (currently not believed).

> ⚠️ **`IN` does not mean TRUE.** It means *supported*. This distinction is the whole point, and it is the distinction no memory tool makes. A decision can be IN and wrong, or OUT and still worth reading.

A node is **IN** iff it has at least one **valid** justification. Its set of justifications is its *justification-set*.

### 2.1 Support-list (SL) justifications

Doyle's basic form. An SL-justification is a pair of lists:

```
J = ⟨ IN-list , OUT-list ⟩
```

**Validity condition:** `J` is a valid reason to believe node `N` **iff every node in the IN-list is believed AND no node in the OUT-list is believed.**

Worked example, WhyLog-shaped:

```
P-0002  "the app has a single user"                        IN
P-0005  "there is no deployment infrastructure"            IN
P-0011  "the system needs concurrent writers"              OUT   ← must NOT be believed

J-0007  ⟨ IN: [P-0002, P-0005] , OUT: [P-0011] ⟩  ⇒  WLD-0007 "Use SQLite, not Postgres"
```

`WLD-0007` is IN because both P-0002 and P-0005 are IN and P-0011 is OUT.

Now a transcript arrives containing *"we need concurrent writes from the sync worker."* P-0011 flips to IN. **J-0007 becomes invalid through its OUT-list.** WLD-0007 has no other justification → WLD-0007 goes OUT.

**This is the mechanism the entire product rests on.** Note what just happened:
- The user never contradicted themselves. They never mentioned SQLite.
- No new decision was made.
- The *world* changed, and the truth-maintenance machinery noticed.

Doyle calls a justification with a non-empty OUT-list a **non-monotonic justification** — one that bases an argument "not only on current belief in other nodes" but on the *absence* of belief. Non-monotonicity is precisely what "we assumed X, and X stopped holding" means formally. Most systems that claim contradiction detection are monotonic: they can only notice `A` vs `¬A` stated side by side. They cannot notice that a precondition evaporated.

### 2.2 Well-founded support and circularity

Doyle's second contribution: a node can be IN on a **circular** argument — `G` justified by `H`, `H` justified by `G`. Naive evaluation leaves both IN, which he calls *"imprudent… nodes believed on tenuous circular bases lead to ill-considered actions."* The fix is **well-founded supporting justification**: the argument must bottom out in premises, not loop.

**WhyLog consequence:** the dependency graph must be checked for cycles, and a decision whose justification chain never reaches a premise node is flagged as **UNFOUNDED** rather than silently labelled IN. This is a real failure mode in extracted data — an LLM will happily say decision A rests on decision B rests on decision A. Detect it; don't pretend it can't happen.

### 2.3 JTMS vs ATMS — and why WhyLog needs a bit of both

| | **JTMS** (Doyle 1979) | **ATMS** (de Kleer 1986) |
|---|---|---|
| Records | Justifications: which facts directly infer a fact | The **founding assumptions** each inference depends on |
| Contexts | Single context — one consistent belief set at a time | **Multiple contexts** — several incompatible assumption sets at once |
| On contradiction | Dependency-directed backtracking to revise an assumption | Compute the **minimal culprit set**; record a **nogood** (an assumption combination that cannot hold) |
| Strength | Efficient: retracts only relevant conclusions | Can reason hypothetically about alternatives |
| Weakness | One line of reasoning at a time | Combinatorial blow-up in environment count |

**WhyLog's choice: JTMS as the backbone, with two ATMS mechanisms borrowed.**

- **JTMS backbone** — decisions are labelled IN/OUT against a single current belief set, which is what a builder actually has. Efficiency matters: *"retracts only relevant conclusions."*
- **Borrow: the nogood.** When backtracking finds the culprit set, record it explicitly: `{P-0002, P-0011}` cannot both hold. This stops the system re-proposing the same impossible combination later, and it is the artifact you show the user as the *explanation*.
- **Borrow: minimal culprit sets.** ATMS's contribution is computing the *smallest* set of assumptions responsible. That maps directly onto the product requirement "give up as little as possible."

ATMS's multi-context reasoning is deliberately **not** implemented — but it is the natural v2. "What would the log look like if we did go multi-user?" is an ATMS question, and it's the right answer to a judge who asks where this goes next.

---

## 3. Belief revision: how to choose what to give up

Detecting a contradiction is the easy half. Deciding **which belief dies** is the hard half, and it is where most "conflict detection" features stop.

### 3.1 AGM and its limitation

The AGM framework (Alchourr≤n, GΣrdenfors, Makinson 1985) defines revision over *belief sets* (logically closed sets) with postulates including **Success**: the new information is always accepted.

**That is wrong for WhyLog.** If Success holds, then any passing remark in a transcript — including a mistaken one, a hypothetical, or the agent's own speculation — overwrites a considered decision made over three days. A noisy input stream must not be able to corrupt a well-founded log.

### 3.2 Hansson's non-prioritized revision

Sven Ove Hansson's **belief base** revision operates on non-closed bases and drops Success: the newcomer may be **rejected**. This is the correct formal frame for a system ingesting chat transcripts. Veritas adopts it explicitly and states the rule:

> *"If the newcomer can't outrank **every** contradictor, it's **rejected** — the store refuses to corrupt itself with weak claims."*

**WhyLog consequence:** an extracted low-confidence decision cannot silently reverse a high-confidence, human-stated, already-implemented decision. It gets queued as a **contested** item for human adjudication. That is not a limitation; it is the feature that makes the log trustworthy.

### 3.3 Entrenchment ordering

An **entrenchment ordering** `≤` ranks beliefs by resistance to retraction. When you must give something up, give up the least entrenched. GΣrdenfors–Makinson conditions:

- **EE1 (closure):** if `A ≤ B` and `B ≤ A` then `A ≡ B` in resistance.
- **EE2 (dominance):** if `⊢ B → A` then `A ≤ B` — a consequence is never more entrenched than what implies it.
- **EE3:** if `⊢ A → B` then `B ≤ A` … and the practical reading used by Veritas: **a derived belief is capped at its weakest premise.**

EE3 is load-bearing for WhyLog. A decision resting on three premises can never be more entrenched than the shakiest of them. If "single-user" is a guess and "no budget" is a hard fact, the SQLite decision inherits the guess's fragility.

### 3.4 WhyLog's entrenchment function

```
E(d) = 0.30 · source_authority
     + 0.20 · implementation_cost     ← NOVEL TERM
     + 0.20 · corroboration
     + 0.15 · confidence
     + 0.15 · recency
```

| Term | Range | Definition | Rationale |
|---|---|---|---|
| **source_authority** | 0–1 | `human_stated` 1.0 · `human_approved_agent_proposal` 0.8 · `human_override_of_agent` 0.9 · `agent_inferred` 0.4 · `extracted_low_confidence` 0.2 | Replaces Veritas's hand-supplied `source_reliability`. In WhyLog nobody supplies it — it is **inferred from provenance**, which is why Phase 1 must capture origin classification |
| **implementation_cost** | 0–1 | Fraction of the decision's executable guards that currently **pass**; 0 if no guards exist | **The novel term.** No belief-revision system has it, because none is attached to a codebase. Reversing a decision already built is genuinely more expensive. Depends on [Phase 4](../plan/phase-4-executable-guards.md); defaults to a neutral 0.5 until guards exist |
| **corroboration** | 0–1 | `log2(1 + n_independent_justifications) / log2(1 + n_max)` | Log-scaled, per Veritas. Independent = different transcript, different session, or a passing guard |
| **confidence** | 0–1 | Extraction confidence from Phase 1 (cue strength + slot matched + reasoning present) | Direct carry-over |
| **recency** | 0–1 | `exp(-ln2 · age_days / 30)` — 30-day half-life | Veritas's parameter. Note the tension: recency *raises* entrenchment, so a fresh bad decision resists retraction. Mitigate by weighting it lowest and letting source_authority dominate |

**Properties to preserve:**
- Every term is in [0,1], so `E(d) ∈ [0,1]` and weights sum to 1.0.
- The score is **transparent and inspectable** — the UI shows the five components as a breakdown. Veritas calls this out as a design principle and it's right: an opaque retraction decision destroys trust.
- **Capping rule (EE3):** `E(d) ≤ min(E(p) for p in premises(d))` computed over premise entrenchment, applied *after* the weighted sum. Without this, a well-corroborated decision resting on a wild guess looks unshakeable.

### 3.5 Contraction vs revision

- **Contraction** `K ≈ A` — give up belief in A without adding anything.
- **Revision** `K * A` — add A, restoring consistency.

WhyLog needs both, and the UI should distinguish them:
- **"Reverse this decision"** = revision (new value in).
- **"Mark premise contested"** = contraction (withdraw support, leave the decision OUT pending re-justification).
- **"Keep & re-justify"** = repair the justification without changing the decision — the user supplies a new premise. This is the most common real action and is absent from every prior system.

---

## 4. The WhyLog formalism

### 4.1 The decision knowledge base

```
K = ⟨ D , P , J , L , N ⟩

D — decision nodes        (the beliefs)
P — premise nodes         (assumptions about the world; SHARED between decisions)
J — justifications        ⟨ consequent , IN-list ⊆ P∪D , OUT-list ⊆ P∪D , informant ⟩
L — labelling function    L : D ∪ P → { IN , OUT , UNKNOWN , UNFOUNDED }
N — nogoods               sets of assumptions recorded as jointly impossible
```

**The single most important structural decision: premises are shared nodes, not per-decision strings.**

If "single-user" is a string inside each decision's `reasoning` field, then invalidating it requires fuzzy-matching every decision. If it is **one node that three decisions point at**, invalidating it is a single label flip followed by a graph traversal. Sharing is what makes cascade cheap, deterministic and explainable — and it is the structural difference between a truth-maintenance system and a notes app with tags.

### 4.2 Node lifecycle

```
                        ┌──────────────────────────────────────────┐
                        │                                          │
   PROPOSED ──approve──► ACTIVE ──────────────────────────────────┐│
       │                   │                                     ││
    reject                 │ justification invalidated           ││
       │                   ▼                                     ││
       └────────────► UNSOUND (OUT)                              ││
                           │                                     ││
              ┌────────────┼────────────┬────────────────┐       ││
              ▼            ▼            ▼                ▼       ││
        RE-JUSTIFIED   REVERSED     CONTESTED        ARCHIVED    ││
        (new premise)  (new value)  (human must      (out of     ││
              │            │         adjudicate)      scope)     ││
              └────────────┴────────────┬────────────────┘       ││
                                        ▼                        ▼│
                                     ACTIVE ◄─────────────────────┘│
                                                                   │
   SUPERSEDED ◄────────────────────────────────────────────────────┘
   (replaced by a later decision; retained, never deleted)
```

**Invariant:** no node is ever destroyed. Every transition writes an immutable event with a reason. This is what makes the audit trail and the bi-temporal replay possible.

### 4.3 Label semantics

| Label | Meaning | Displayed as |
|---|---|---|
| `IN` | Has ≥1 valid well-founded justification | **Sound** |
| `OUT` | Every justification is invalid | **Unsound** — with the specific premise that failed |
| `UNKNOWN` | Insufficient evidence; premises neither confirmed nor refuted | **Unverified** |
| `UNFOUNDED` | Justification chain is circular or never reaches a premise | **Unfounded** — a data-quality warning, not a truth claim |

---

## 5. The revision algorithm

```
REVISE(newInformation)
  newInformation ∈ { transcript chunk, user decision, guard result, repo scan, premise assertion }

──────────────────────────────────────────────────────────────────────────────────
STEP 1 — EXTRACT
  Parse newInformation into typed assertions:
    ò decisions    (variable, value, rationale, alternatives[])
    ò premises     (type, predicate, value, evidence)
  Record provenance for each: snippet, char span, origin, confidence.

STEP 2 — RESOLVE  (entity resolution — merge, do not append)
  For each assertion, attempt to map it onto an EXISTING node:
    ò decisions:   canonicalise variable via ontology → match value by alias table,
                   then by embedding similarity above threshold
    ò premises:    match by predicate first (exact), by text similarity second
  Merge on match (add corroboration +1, extend evidence).
  Create a new node only on genuine miss.
  ⚠ Without this step the log fills with near-duplicates and every
    downstream computation degrades. This is the most-skipped step in
    naive implementations and the reason they feel broken.

STEP 3 — ASSERT
  Append immutable event(s) to the log.
  L(p) := IN for each new premise, carrying its evidence.
  Attach justification J = ⟨IN-list, OUT-list, informant⟩ for each new decision.

STEP 4 — DETECT  (three independent gates; any may fire)
  (a) STRUCTURAL  — same `variable`, different `value`, both IN.
                    Deterministic, zero-latency, no model. Highest precision.
  (b) SEMANTIC    — cosine ≥ τ over the fused index → cross-encoder / NLI classifier
                    → verdict ∈ { contradiction, reversal, refinement, neutral }.
                    Catches paraphrase and cross-variable conflicts (e.g. "no server"
                    vs "deploy to Fly.io") that share no literal token.
  (c) PREMISE     — the new assertion falsifies a premise in some d's IN-list,
                    OR satisfies a premise in some d's OUT-list.
                    This is the non-monotonic gate and the one nobody else has.

STEP 5 — BACKTRACK  (dependency-directed)
  For each contradiction node:
    trace justification arcs BACKWARDS to the assumption nodes responsible —
    antecedents of antecedents — accumulating culprit set C.
  Record a NOGOOD: the conjunction of assumptions in C cannot all hold.
  Prefer the MINIMAL culprit set (ATMS borrowing): give up as little as possible.

STEP 6 — CASCADE  (forward propagation)
  Repeat until fixpoint:
    for each node d whose every justification is now invalid → L(d) := OUT
    recurse into nodes justified BY d
    STOP at any node possessing an independent surviving justification
  The stop condition is zombie-belief prevention: a decision grounded in its own
  evidence survives the collapse of a sibling. Over-retraction is a worse failure
  than under-retraction, because it cries wolf.

STEP 7 — ADJUDICATE  (entrenchment-ordered)
  Compute E(d) for every node in the minimal revision set.
  Order weakest-first. Apply the EE3 cap (derived ≤ weakest premise).
  Non-prioritized screening: if the newcomer cannot outrank EVERY contradictor,
    REJECT the newcomer and mark it CONTESTED. Do not corrupt the log.

STEP 8 — PROPOSE  (human gate — never auto-apply)
  Emit a revision proposal naming:
    ò the decision now unsound, and the exact premise that failed
    ò the evidence that falsified the premise, with its snippet
    ò the full cascade — every downstream decision affected
    ò the entrenchment breakdown, including implementation cost
    ò three actions: [Reverse] [Keep & re-justify] [Mark premise contested]

STEP 9 — COMMIT
  On user choice: append events, recompute L over the network, re-run affected
  guards, recompute compliance score, invalidate cached exports.
```

### 5.1 Worked example, end to end

```
t₀  Transcript (Oct 3) → extraction:
      P-0002 "single user"                     IN   (premise: scale)
      P-0005 "no deployment infrastructure"    IN   (premise: deployment)
      P-0011 "needs concurrent writers"        OUT  (premise: requirement — negated in transcript)
      WLD-0007 "Use SQLite, not Postgres"      IN   via J-0007 ⟨IN:[P-0002,P-0005] OUT:[P-0011]⟩
      WLD-0011 "Skip connection pooling"       IN   via J-0011 ⟨IN:[P-0002]⟩        ← depends on WLD-0007
      WLD-0019 "No migration tooling"          IN   via J-0019 ⟨IN:[P-0002,P-0005]⟩

t₁  Guards synthesised (Phase 4):
      G-0007a dependency_present  better-sqlite3   → PASS
      G-0007b dependency_absent   pg               → PASS
      implementation_cost(WLD-0007) = 1.0

t₂  New transcript (Oct 21) contains: "the sync worker writes while the UI writes"
      EXTRACT  → premise assertion: concurrency.max_writers > 1
      RESOLVE  → matches P-0011 (predicate match, exact)
      ASSERT   → L(P-0011) := IN
      DETECT   → gate (c) fires: P-0011 ∈ OUT-list(J-0007)
      BACKTRACK→ culprit set C = {P-0011}; nogood recorded: ¬(P-0002 ∧ P-0011)
      CASCADE  → J-0007 invalid → WLD-0007 := OUT
                 J-0011 invalid (P-0002 still IN, but WLD-0007 OUT and J-0011
                 depends on it) → WLD-0011 := OUT
                 J-0019: P-0002 IN, P-0005 IN → survives. WLD-0019 := IN  ← no zombie cascade
      ADJUDICATE → E(WLD-0007) = 0.30·1.0 + 0.20·1.0 + 0.20·0.31 + 0.15·0.9 + 0.15·0.62
                                 = 0.78  → HIGH. Capped by min premise entrenchment.
                 Newcomer P-0011 confidence 0.85, single-source.
                 → newcomer does NOT outrank; WLD-0007 is not auto-reversed.
      PROPOSE  → "⚠ UNSOUND: WLD-0007 'Use SQLite, not Postgres'
                  Premise 'no concurrent writers' (P-0011) was falsified 2 min ago by:
                    "the sync worker writes while the UI writes"  [transcript t₂, chars 1840–1893]
                  Cascade: WLD-0011 'Skip connection pooling' is also unsound.
                           WLD-0019 'No migration tooling' survives (independent support).
                  Entrenchment 0.78 — HIGH: you stated it yourself, and it is implemented
                    (better-sqlite3 present, no pg driver; both guards pass).
                  [Reverse → Postgres]  [Keep & re-justify]  [Mark P-0011 contested]"
      COMMIT   → user picks "Keep & re-justify", adds premise P-0024 "writes are serialised
                 through a single queue" → new justification J-0007' → WLD-0007 := IN,
                 WLD-0011 := IN. Event written. Export cache invalidated.
```

That last branch — **keep and re-justify** — is the outcome a real builder wants most of the time, and it is not expressible in any system surveyed in [01](01-prior-art-landscape.md).

---

## 6. Deviations from theory, and why

| Deviation | Reason |
|---|---|
| **Human gate at Step 8** — never auto-apply | Classical TMS is fully automatic. Here the "beliefs" are someone's engineering commitments and the input is noisy natural language. Auto-retraction would destroy trust on the first false positive. Veritas automates it because its inputs are programmatic assertions with declared reliability; ours are extracted prose. |
| **`implementation_cost` in entrenchment** | No prior TMS is attached to a codebase. This term is available to us and unavailable to them. It also makes the abstract notion of entrenchment *felt*: "you're reversing something you already built." |
| **Premises sourced from outside the log** | Veritas's justifications are other beliefs in the store. WhyLog premises can be falsified by a repo scan, a guard result, or an offhand remark — evidence that never entered the belief base as a belief. This is what makes gate (c) possible and is the main reason RAAM's assumption-recovery problem matters here. |
| **JTMS backbone, not ATMS** | Single current context matches how a builder actually works. ATMS's multi-context reasoning is the natural v2 ("what if we *did* go multi-user?") and is worth naming as roadmap. |
| **`UNFOUNDED` as a fourth label** | Doyle's well-foundedness requirement assumes a reasoner that constructs justifications soundly. An LLM extractor does not. Circular and premise-less justifications *will* appear; labelling them is more honest than silently marking them IN. |
| **Nogoods are shown to the user, not only used internally** | In classical TMS a nogood is bookkeeping. Here it is the *explanation*: "these two assumptions cannot both hold" is the most useful sentence the system can produce. |

---

## 7. Known failure modes and their mitigations

| Failure mode | Why it happens | Mitigation |
|---|---|---|
| **Cascade over-retraction** (crying wolf) | Justification graph too densely connected; one premise flip takes out half the log | Stop-at-independent-justification (Step 6); require **shared premise** for cascade edges, not mere topical similarity; cap cascade depth and surface "N more affected" beyond it |
| **Premise explosion** | LLM extracts a new premise for every clause; nothing is shared, so nothing cascades | **Closed set of 8 premise types**; predicate-first entity resolution in Step 2; premise merge threshold tuned high |
| **Circular justifications** | LLM asserts A rests on B rests on A | Cycle detection on write → label `UNFOUNDED`, warn, never label IN |
| **False premise resolution** | "single user" (scale) merged with "single sign-on user flow" (requirement) | Predicate namespace is typed (`scale.max_users` vs `auth.model`); text similarity alone is never sufficient to merge across types |
| **Recency entrenchment trap** | A fresh, badly-extracted decision resists retraction because recency = 0.15 of its score | Weight recency lowest; let source_authority dominate; apply the EE3 premise cap |
| **Negation blindness in gate (b)** | Cosine similarity treats "use X" and "don't use X" as near-identical | Gate (b) is a **classifier over retrieved candidates**, never a similarity threshold. See [03](03-retrieval-and-contradiction.md) §3 |
| **Non-prioritized rejection feels like a bug** | User states a reversal and the system refuses to apply it | Rejection is never silent: the item appears in a **Contested** queue with the entrenchment breakdown and an explicit "override anyway" action, which writes a `human_override` event and raises source_authority to 0.9 |
| **Guard-less decisions get neutral cost** | Early log has no guards, so implementation_cost = 0.5 for everything and the term adds noise | Default to 0.5, but *display* it as "unknown — no guard" rather than "medium". Never let a missing measurement masquerade as a measurement |

---

## 8. Complexity

| Operation | Cost | Notes |
|---|---|---|
| Label recompute (full) | `O(|D| · k)` where k = avg justification size | Trivial at ≤10│ decisions |
| Cascade propagation | `O(|D| + |J|)` per fixpoint iteration, typically 2–3 iterations | Graph is shallow; depth rarely exceeds 4 |
| Gate (a) structural | `O(1)` with a `variable → value` index | Hash lookup |
| Gate (b) semantic | `O(|D| · dim)` for recall + `O(c)` for rerank, c = candidate count ≈ 20 | dim = 512 → ~5×10⁵ multiply-adds. Sub-millisecond in JS |
| Gate (c) premise | `O(inverted-index lookup on premise id)` | Premise → dependents index maintained incrementally |
| Backtracking | `O(depth · branching)` | Depth-bounded to 6; branching bounded by justification count |

**No vector database, no graph database.** At this scale both add latency, infrastructure and failure modes while returning nothing. The entire knowledge base fits in a single JSON document, and the whole revision cycle runs synchronously in the browser. That is a defensible architecture decision with numbers behind it, not a shortcut — and it should be stated as such.
