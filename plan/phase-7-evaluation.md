# Phase 7 — Evaluation, Hardening & Pitch

| | |
|---|---|
| **Layer** | Cross-cutting |
| **Depends on** | Everything |
| **Blocks** | Gate G6 |
| **Estimate** | 5 h |
| **Research** | [docs/05 §4](../docs/05-rationale-mining-literature.md) (published baselines to compare against) · [docs/07](../docs/07-novelty-audit-and-positioning.md) (what to say) |
| **Gate** | **G6 — It is defensible**: every claim is backed by a number or a diagram, not an adjective |

**Objective in one sentence:** replace every adjective in the pitch with a measurement, and make sure the demo cannot fail on stage.

**Why this phase is not optional.** The published baselines are strong and specific — RecovAr at 75% recall / 77% precision, ARGUS at 15.4% precision on alternatives, Kantara at F1 0.70–0.75. A judge who knows the field will ask how WhyLog compares. *"It works well"* loses to a number, and a number loses to a number **with an ablation showing which component earned it**.

Also: no tool in this category publishes a benchmark for decision-rationale extraction. Building one is a disproportionate credibility artifact for its cost.

---

## Sub-phases

### 7.1 — DecisionMemEval: the fixture corpus

**Goal.** A small, hand-labelled, reproducible evaluation set with **planted** failures at three levels of difficulty.

**Corpus composition — 30 transcripts:**

| Tier | Count | Content |
|---|---|---|
| Clean | 10 | Well-formed two-person dialogues with explicit decision cues, stated premises, and named alternatives |
| Messy | 12 | Real-world noise: tool output, code blocks, interrupted turns, decisions negotiated across 4+ turns, no speaker markers on some |
| Adversarial | 8 | Hypotheticals ("what if we used Redis?"), agent proposals the human never accepted, sarcasm, reversed decisions, near-duplicate restatements across transcripts |

**Hand-labelled per transcript:** decisions (variable, value, polarity, modality, origin) · premises (type, predicate, value, IN-list or OUT-list membership) · rejected alternatives with `whyRejected` · expected episode boundaries · ground-truth snippets and character spans.

**Planted contradictions — three levels, and this is the part nobody else has:**

| Level | What is planted | Tests |
|---|---|---|
| **L1 — pairwise** | Two transcripts assert `DATABASE=sqlite` and `DATABASE=postgres` | Gate (a) structural |
| **L2 — premise-level** | A decision rests on `scale.max_users=1`; a later transcript asserts a second user, **without ever mentioning the database** | Gate (c) non-monotonic — the novel case |
| **L3 — cascade** | Three decisions share a premise; falsify it and verify that two flip and the third **survives on independent support** | Cascade correctness and the stop condition |

**Also planted:** one circular justification (tests `UNFOUNDED`), one M1 case (similar decisions, contradictory rationales), one M2 case (contradictory decisions, similar rationales), one duplicate restatement across two transcripts (tests entity resolution), one unanswerable question (tests `INSUFFICIENT EVIDENCE`).

**Acceptance criteria.** 30 transcripts, fully labelled, version-controlled, with a documented label schema and a second-pass review of 20% of labels for self-consistency.

---

### 7.2 — Metrics

**Goal.** Ten numbers, each with a defined computation and a published comparator where one exists.

| # | Metric | Computation | Comparator |
|---|---|---|---|
| 1 | **Decision extraction P / R / F1** | Against hand labels, per component | RecovAr 75/77; Kantara F1 0.70–0.75 |
| 2 | **Premise extraction P / R / F1** | Against hand labels, per premise type | **None published — this is new territory** |
| 3 | **Alternative extraction precision** | Against hand labels | ARGUS 15.4% |
| 4 | **Contradiction recall** (L1) | Planted pairwise contradictions detected ÷ planted | Kantara reported counts, not recall |
| 5 | **Premise-invalidation recall** (L2) | Planted premise falsifications detected ÷ planted | **None published** |
| 6 | **Cascade correctness** (L3) | Correct flips ÷ expected flips, **and** survivors correctly preserved ÷ expected survivors | **None published** |
| 7 | **False-positive rate** | Spurious contradictions per 100 decisions | ARGUS FP:FN = 13:1 |
| 8 | **Answer groundedness** | Claims with resolving citations ÷ total claims | RepoRationale's contract, unquantified |
| 9 | **Retrieval precision@5 / MRR** | On a labelled question set | agentmemory R@5 95.2% (different task) |
| 10 | **Guard precision** | Correct failures ÷ total failures on seeded violations | Fitness-function literature is qualitative |

**Report both engines separately, always.** A single blended number hides the thing that most needs showing: that the local, keyless path is a genuine peer rather than a stub.

**Two numbers to report that are unusual and worth it:**
- **Survivor preservation** (metric 6, second half). Over-retraction is the failure mode that kills this product, and nobody measures it because nobody cascades.
- **Modality precision** — of the statements the system *declined* to turn into decisions, how many were correctly declined. This is the guard against hypotheticals becoming nodes.

**Acceptance criteria.** All ten metrics compute from the corpus with one command; results are reproducible and versioned alongside the corpus.

---

### 7.3 — The ablation harness

**Goal.** Show which component earns its keep. This is the single most persuasive artifact for a technical judge.

**Toggles, each independently switchable:**

| Toggle | Off-state | Hypothesis |
|---|---|---|
| L2 inverted questions | Dense retrieval on statements only | Precision@5 drops measurably |
| Sparse level (L3) | Dense-only retrieval | Exact technology-name queries fail |
| RRF fusion | Single best retriever | Blended beats either alone |
| Reranking | Fusion order only | Precision@5 drops (literature: ~+27pp) |
| Three-run majority voting | Single extraction run | Precision rises with voting, at 3× cost |
| Gate (a) structural | Semantic gates only | Recall drops on exact-value reversals |
| Gate (c) premise | Pairwise gates only | **L2 planted cases drop to ~0** — the headline result |
| OUT-list (non-monotonic) justifications | IN-lists only | Premise-invalidation recall collapses |
| Cascade stop condition | Unconditional propagation | Survivor preservation collapses; over-retraction spikes |
| EE3 entrenchment cap | Uncapped weighted sum | Weak-premise decisions wrongly resist retraction |
| Entity resolution | Append-only | Duplicate nodes; self-contradictions fire |

**Presentation.** One table: metric × toggle, delta from the full system. **The gate-(c) row is the one to put on a slide** — it is the empirical proof that the novel component is load-bearing, and no competitor can produce it because none has the component.

**Acceptance criteria.** Every toggle runs without breaking the pipeline; the ablation table reproduces from one command; at least one hypothesis is falsified and reported honestly (a table where every toggle "helps" looks fabricated).

---

### 7.4 — Hardening pass

**Goal.** Walk every documented failure mode and confirm the mitigation exists in the build.

Sources: [docs/02 §7](../docs/02-truth-maintenance-theory.md) (8 reasoning failure modes) · [docs/03 §8](../docs/03-retrieval-and-contradiction.md) (9 retrieval failure modes) · [docs/04 §8](../docs/04-executable-decision-guards.md) (7 guard failure modes) · each phase's risk table.

**Priority order — the four that can kill the demo:**

| # | Failure | Test |
|---|---|---|
| 1 | Cascade over-retraction (cries wolf) | L3 planted case; survivor preservation must be 100% on the corpus |
| 2 | False premise resolution → spectacular wrong cascade | Adversarial tier: "single user" vs "single sign-on user flow" must **not** merge |
| 3 | Hypotheticals become decisions → false contradictions | Adversarial tier: zero hypotheticals produce nodes |
| 4 | Guard false positive on day one | Baseline pattern freezes initial failures; only new violations surface |

**Also verify:** hash-chain verification on load · engine-switch index staleness · double-import produces zero nodes · export blocks on conflict · `INSUFFICIENT EVIDENCE` fires rather than inventing · no key ever appears in an event or an export.

**Acceptance criteria.** Every documented failure mode has a corresponding test; the four priority cases pass; results recorded.

---

### 7.5 — Demo kit

**Goal.** A two-minute demo that cannot fail.

**Artifacts to produce:**

| Artifact | Content |
|---|---|
| **Demo script** | Timed to the second, with the peak moment marked and a rehearsed two-second pause |
| **Fixture set** | The clean demo transcript ([`fixtures/demo-transcript.txt`](../fixtures/demo-transcript.txt)) plus a second transcript that falsifies its premise, and a `package.json` containing `pg` |
| **Seed state** | A pre-loaded log dated three weeks back, so the reversal has something to reverse. **Never demo from an empty log** |
| **Fallback recording** | A screen capture of the full demo, in case the live environment fails |
| **Keyless verification** | The entire demo runs with no API key and no network. Checked immediately before presenting |
| **One-click reset** | A button that restores the seed state between rehearsals |

**Demo beats — the peak is gate (c), not contradiction.**

| t | Beat |
|---|---|
| 0:00 | Cold open with the challenge's own words: *"you make a call ten prompts ago, the agent forgets, you can't explain your own code later."* Then: "That's pain number one, and five funded products already treat it. Here's pain number two, which nobody treats." |
| 0:15 | Show the seeded log. WLD-0007 "SQLite, not Postgres", sound, decided Oct 3. **Open the decision card** — point at `RESTS ON: P-0002 single-user` and `EXCLUDES: P-0011 concurrent writers`. "This is the part nobody stores." |
| 0:35 | Paste a *new* transcript. It never mentions SQLite or databases. It says: *"the sync worker writes while the UI writes."* |
| 0:45 | **⚡ THE MOMENT.** Extract → review → approve. Pause two seconds. WLD-0007 flips to UNSOUND. WLD-0011 cascades. **WLD-0019 survives.** The proposal names the failed premise, quotes the evidence, shows the nogood, and gives the entrenchment breakdown. |
| 1:05 | "Nothing contradicted me. I never said the word database. The world moved, and the log noticed." |
| 1:15 | Click **Keep & re-justify** → add premise "writes are serialised through a queue" → both decisions return to IN. "That's the outcome a real builder wants, and it isn't expressible in any tool I found." |
| 1:30 | Paste the `package.json` containing `pg` → guard fails → compliance drops → a structural contradiction fires. "**No model involved.** That's a hash lookup." |
| 1:40 | Ask "why did we drop auth?" → GROUNDED with citations that expand to snippets and premise labels. Ask "why did we pick Kafka?" → **INSUFFICIENT EVIDENCE**. "It refuses. That's the point." |
| 1:50 | Export `CLAUDE.md` → show MUST/MUST NOT, `applies_to`, the **verify command**, the rejected-alternatives block, and the integrity stamp. |
| 2:00 | Flip to the **premise lattice**, click P-0002, watch the cascade animate. Close: *"Memory tools stop you repeating yourself. This stops you building on a decision that stopped being true — which is the more expensive mistake, and the one your agent will never catch on its own."* |

**Acceptance criteria.** The demo runs keyless, end to end, three times consecutively without intervention; the fallback recording exists; reset works.

---

### 7.6 — Pitch materials

| Artifact | Content |
|---|---|
| **Architecture one-pager** | The five-layer diagram from [OVERVIEW §2](OVERVIEW.md) plus the AI seam. One page, printable, handable to a judge |
| **Concept diagrams** | The premise lattice, the REVISE cycle, the cascade worked example, the bi-temporal timeline |
| **Novelty table** | [docs/07 §1](../docs/07-novelty-audit-and-positioning.md), trimmed to the ✅ rows with one line of evidence each |
| **Metrics card** | The ten numbers from 7.2 plus the ablation highlight row |
| **Judge Q&A** | [docs/07 §5](../docs/07-novelty-audit-and-positioning.md) — rehearsed, not read |
| **The three sentences never to say** | [docs/07 §2.1](../docs/07-novelty-audit-and-positioning.md) |
| **Roadmap slide** | MCP server · live capture by *consuming* agentmemory rather than competing · ATMS multi-context reasoning · repo connection · DecisionMemEval published |

**Acceptance criteria.** Every claim in the pitch traces to a document in `docs/` or a number from 7.2.

---

### 7.7 — Documentation set

| Document | Audience |
|---|---|
| **README** | What it is, the one-line thesis, the demo GIF, quick start, keyless by default |
| **ARCHITECTURE** | The five layers, the invariants, the AI seam, the data flow |
| **THEORY** | A readable version of [docs/02](../docs/02-truth-maintenance-theory.md) for a technical reader — TMS, entrenchment, the deviations and why |
| **ONTOLOGY** | The 14 variables, 8 premise types, alias and antonym tables, and how to extend them |
| **EVALUATION** | Corpus construction, metric definitions, results, ablation table, honest limitations |
| **LIMITATIONS** | Stated plainly: premise extraction precision is unproven at scale; guards need pasted project input; the local engine's gate (b) is weaker; single-user only |

**A published limitations section is a credibility asset, not a weakness.** Every system surveyed in `docs/` overstates; the one that names its ceiling is the one a technical judge believes.

**Acceptance criteria.** All six documents exist; LIMITATIONS names at least five real constraints.

---

## Diagrams

### D7.1 — The evaluation loop

```
   ┌──────────────────┐      label       ┌──────────────────┐
   │  30 FIXTURE      │ ───────────────► │  GROUND TRUTH    │
   │  TRANSCRIPTS     │                  │  decisions,      │
   │  clean / messy / │                  │  premises,       │
   │  adversarial     │                  │  alternatives,   │
   └────────┬─────────┘                  │  spans, planted  │
            │                            │  contradictions  │
            ▼                            └────────┬─────────┘
   ┌──────────────────┐                           │
   │  WhyLog pipeline │                           │
   │  both engines    │                           │
   └────────┬─────────┘                           │
            │                                     │
            ▼                                     ▼
   ┌──────────────────┐                  ┌──────────────────┐
   │  10 METRICS      │ ◄──── compare ───│                  │
   └────────┬─────────┘                  └──────────────────┘
            │
            ├──► per-engine, always separate
            │
            ▼
   ┌──────────────────┐      toggle      ┌──────────────────┐
   │  ABLATION HARNESS│ ───────────────► │  delta table     │
   │  11 switches     │                  │  which component │
   └──────────────────┘                  │  earned what     │
                                         └──────────────────┘
```

### D7.2 — The three planted contradiction levels

```
   L1  PAIRWISE                    transcript A: "going with SQLite"
       (structural)                transcript B: "let's switch to Postgres"
                                   ──► gate (a) fires. Everyone can do this.

   L2  PREMISE-LEVEL               transcript A: "SQLite — one person, one machine"
       (non-monotonic)             transcript C: "the sync worker writes while
                                                the UI writes"
                                   ──► never mentions the database.
                                       gate (c) fires via the OUT-list.
                                       NOBODY ELSE DETECTS THIS.

   L3  CASCADE                     P-0002 single-user supports WLD-0007,
       (propagation + stop)         WLD-0011 (via 0007) and WLD-0019 (directly,
                                    plus independent support from P-0005)
                                   ──► falsify P-0002:
                                       WLD-0007 UNSOUND ✓
                                       WLD-0011 UNSOUND ✓ (cascade)
                                       WLD-0019 SURVIVES ✓ (independent support)
                                       Over-retraction here = failed test.
```

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Corpus too small to be credible | 🟠 | 30 transcripts is honest for a hackathon. State the size, state the limitation, publish the corpus so others can extend it |
| Hand-labels are biased (you labelled what your extractor finds) | 🟠 | Label from the transcript, **not** from the extractor output. Second-pass review of 20% of labels |
| Metrics come out worse than published baselines | 🟡 | Expected — the task is harder (dialogue vs commits) and premise extraction has no published baseline at all. Report it plainly with the reason. **A worse number with an honest explanation beats a vague claim** |
| Ablation shows a component doesn't help | 🟡 | Report it and cut the component. That is what the harness is for |
| Demo fails live | 🔴 | Seed state, keyless verification, one-click reset, three consecutive dry runs, fallback recording |
| Time runs out before this phase | 🟠 | 7.1 + 7.2 + 7.5 are the minimum. Cut 7.3 and 7.7 first; never cut 7.5 |

---

## Definition of done

- [ ] 30-transcript corpus, hand-labelled, with L1/L2/L3 planted contradictions and the five special cases
- [ ] All ten metrics computing from one command, reported **per engine**
- [ ] Survivor preservation and modality precision measured explicitly
- [ ] Ablation harness with 11 toggles and a reproducible delta table
- [ ] Hardening pass over every documented failure mode; the four demo-killers tested
- [ ] Demo kit: script, fixtures, seed state, one-click reset, fallback recording, keyless verification
- [ ] Demo runs three times consecutively without intervention
- [ ] Pitch materials: architecture one-pager, concept diagrams, novelty table, metrics card, rehearsed Q&A
- [ ] Six documentation artifacts including a published LIMITATIONS section
- [ ] **Gate G6 passes**: every claim in the pitch traces to a document or a number
