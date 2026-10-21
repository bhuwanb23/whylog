# 05 — Rationale Mining Literature
### Forty years of software-engineering research on why decisions get lost, and what the real extraction numbers are

**Purpose:** ground WhyLog's extraction layer in what is known about recovering design rationale, and set **honest expectations for precision** — which directly shapes the review-gate design in [plan/phase-1](../plan/phase-1-extraction-pipeline.md).

---

## 1. The problem has a name: knowledge vaporization

Software architecture research identified this decades ago. Architecture descriptions *"only depict **what** the architecture of a system looks like, and not **why** the architecture looks the way it does — which is the symptom of a phenomenon called **knowledge vaporization** in software systems."*

Weinreich et al. showed it is a problem **at the individual level**, not just the team level — which matters for WhyLog, whose user is a solo builder. You do not need staff turnover to lose rationale. You need three weeks and an agent that resets every session.

The 2008 *Rationale-Based Software Engineering* literature review states the cost side plainly:

> *"Due to the imbalance between the cost and value for developers to document design rationales (i.e., the design alternatives and the underlying arguments for making or rejecting decisions), these rationales are often obsolete or even missing."*

**That imbalance is the entire reason WhyLog's entry point is a paste, not a form.** Any tool that requires the developer to author structured rationale at decision time loses to the cost/benefit calculus that has already defeated ADRs, wikis, and design docs. Capture must be a byproduct of work that was happening anyway — and the transcript is work that was happening anyway.

### 1.1 Parnas: backtracking is intrinsic, not a failure

Parnas, *A Rational Design Process: How and Why to Fake It*:

> *"Even if we knew the requirements, there are many other facts that we need to know in order to design the software. Many of the details only become known as we proceed with the implementation. **Some of the things that we learn invalidate our design and we must backtrack.** Because we try to minimize lost work, the resulting design may be one that would not result from a rational design process."*

This is the theoretical warrant for the whole truth-maintenance concept. Invalidation-then-backtracking is not an error condition to be prevented; it is the normal operation of design. A tool that treats a reversed decision as a mistake is modelling the wrong process. A tool that treats reversal as an event to be **recorded, propagated, and explained** is modelling the real one.

### 1.2 Lehman: assumption invalidation drives evolution

Lehman's **Principle of Software Uncertainty** (first stated 1989), on E-type software — software embedded in and operating on the real world:

> *"The validity of the execution results of an E-type program cannot be absolutely predicted… every E-type program reflects an unbounded number of assumptions about the application it addresses, the domains in which it operates and so on. **Invalidation of assumptions is one of the drivers of the need for continual software evolution** and a major source of uncertainty."*

Read that against the WhyLog premise model. Lehman is saying, forty years early, that the correct unit of tracking is the **assumption**, that assumptions are **unbounded in number**, and that their **invalidation** is what forces change. Which is precisely the object no decision-log tool stores.

---

## 2. Assumptions: the lost artifact

### 2.1 RAAM — the paper to cite on stage

Roeller, Wallnau & Lattanze (SEI), *Recovering Assumptions About Architectural Design Decisions*. From the abstract, verbatim:

> *"Some design decisions, though, are more or less arbitrarily made on the fly because of personal experience, domain knowledge, budget constraints, available expertise, and the like. These decisions, as well as the reasons for these decisions, are often not explicit upfront. They are implicit, and usually remain undocumented. **We call them assumptions. There is no accepted way to document assumptions, and the relation between the software architecture and these assumptions easily gets lost, becomes hidden in the girders of the architecture. They are rediscovered at a later stage, when the software evolves and assumptions become invalid or new assumptions contradict earlier ones.** In this paper, we develop a method to recover such assumptions from an existing software product."*

Every clause of that maps onto a WhyLog component:

| RAAM | WhyLog |
|---|---|
| "no accepted way to document assumptions" | Premise nodes as first-class entities |
| "relation between architecture and assumptions gets lost" | Justification edges: decision → IN-list / OUT-list |
| "assumptions become invalid" | Gate (c), premise invalidation, cascade |
| "new assumptions contradict earlier ones" | Gate (a)/(b), contradiction and reversal |
| "rediscovered at a later stage" | The Ask view and the revision proposal — rediscovered *at the moment they matter* |
| "recover assumptions from an existing product" | Recovery from an existing **transcript**, which is the richer source |

**The known limitation to be honest about:** the paper's own criticism is that *"researchers need to acquire a deep understanding of the software system."* RAAM's method is expert-driven recovery. WhyLog's is extraction from dialogue — cheaper, lower precision, and the reason the review gate is mandatory rather than optional.

### 2.2 Assumptions in modern practice

The same problem shows up in current work on deep-learning frameworks:

> *"Stakeholders constantly make assumptions in the development of deep learning frameworks. These assumptions are related to various types of software artifacts (e.g., requirements, design decisions, and technical debt) and **can turn out to be invalid, leading to system failures**. Existing approaches and tools for assumption management usually depend on **manual identification** of assumptions. However, assumptions are scattered in various sources (code comments, commits, pull requests, issues), and manually identifying them has high costs."*

And NASA, on the safety-critical version of the same problem:

> *"Unless the original designer is involved, often those carrying out the design modifications have no way to access important design assumptions and other usage constraints that are not contained in the code or visible from the finished product. As a result these are often ignored or misrepresented as the system is modified."*

Substitute "the original designer" → "you, three weeks ago" and "design modifications" → "your agent's next session", and that is the WhyLog README.

---

## 3. Structured rationale models

### 3.1 IBIS and gIBIS
Issue-Based Information System (Kunz & Rittel 1970): a design conversation is a graph of **Issues**, **Positions** (candidate answers), and **Arguments** (for/against). gIBIS added hypertext. This is the ancestor of every "decision + alternatives + rationale" schema, and the reason WhyLog's node shape is not arbitrary — it is a forty-year-old, validated decomposition.

### 3.2 Condec categories
The Condec tooling line manually labelled textual artifacts (Jira issue text, commits, code comments) into rationale categories: **decision, issue, alternative, pro-argument, con-argument**. That five-way split is a better extraction target than "decision + reasoning", and it is worth adopting the pro/con distinction explicitly — a rejected alternative *with its con-argument* is far more useful later than a rejected alternative alone.

### 3.3 The ARGUS fine-grained taxonomy (2026)
Nine rationale components, of which seven appear in practice. The four that matter here: **Goal**, **Need**, **Alternatives**, **Selected Alternative**.

### 3.4 Y-statements — the compact decision sentence
The ADR community's "Y-statement" (Ol Zimmermann) compresses a decision into one rigid sentence:

> *"In the context of **⟨use case⟩**, facing **⟨concern⟩**, we decided for **⟨option⟩** to achieve **⟨quality⟩**, accepting **⟨downside⟩**."*

**This is a gift for WhyLog**, because it is a *template with named slots*, and named slots are extractable. Every Y-statement component maps to a WhyLog field:

| Y-statement slot | WhyLog field |
|---|---|
| "In the context of…" | **premise** (the `given`) |
| "facing ⟨concern⟩" | premise of type `requirement` |
| "we decided for ⟨option⟩" | `variable` + `value` |
| "to achieve ⟨quality⟩" | `rationale` |
| "accepting ⟨downside⟩" | an explicit **accepted trade-off** field — which nobody stores, and which is exactly what a future you needs when the downside arrives |

Recommending the Y-statement as the *output* form for the decision statement has a second benefit: it makes the extracted decision legible and self-justifying in the export, without prose bloat.

### 3.5 Causal vs structural graphs
The rationale-capture literature distinguishes a **causal graph** (why this followed from that) from a **structural graph** (what this is made of), and recommends capturing both *"in order to facilitate its (possibly automated) recovery and use in question-answering later in the life cycle."* WhyLog's premise/justification graph is causal; its `applies_to` globs and file anchors are structural. Having both is what makes the evidence contract in [03](03-retrieval-and-contradiction.md) §5 possible — a citation can point at a reason *and* at an artifact.

---

## 4. Recovery systems and their measured performance

This table is the single most useful thing in this document, because it sets **honest expectations**. Read it before promising extraction quality to anyone.

| System | Source artifacts | Method | Reported performance |
|---|---|---|---|
| **RecovAr** | Issue tracker + VCS history | Formal definition of architectural design decisions; tracing through project history; evaluated on Hadoop and Struts (8+ years, 1M+ LOC each) | **Recall 75%, Precision 77%** |
| **UnArch** | Source code + issue repositories | Recovers static architecture, cross-links issues, extracts decisions **and their consequences**; focuses on consequences because rationale is usually missing | Initial recall of extracted architectural changes was **~20%** before refinement — most changes had no locatable rationale |
| **ADDRA** | Project documents | After-the-fact documentation of architectural design decisions; multi-step heuristics | Qualitative |
| **Rationale Miner** | Python mailing-list archives | Heuristics-based IR + NLP; term types: Proposal Identifier, Rationale, Entity, State, Rationale Identifier, Decision Terms, **Negation Terms** | Ideal full-pattern sentences were **"the most rare"**; Decision Terms present in 18% of sentences, **Negation Terms in 12%** |
| **DRMiner** | Jira issue logs (Cassandra, Flink, Solr) | Decomposes rationale mining into multiple text-classification tasks; LLM prompt tuning + heuristic features | **F1 improvements of +24% (rationale), +22% (solution), +20% (argument)** over best baseline |
| **ARGUS** (2026) | Commits + issues + PRs + code reviews + Javadoc + inline comments, 63 commits / 5 Java projects / 2,602 labelled sentences across 291 artifacts | Two-stage LLM pipeline: artifact retriever → rationale extractor (reasoning-based few-shot, **three-run majority voting**) → rationale generator | Goal α=0.88, Need α=0.72, **Alternatives α=0.64** (run-to-run consistency). **Precision on Alternatives: 15.4%.** 155 false positives vs 12 false negatives |
| **Kantara instantiation** (Dhaouadi et al. 2025) | Linux kernel commit messages | Pre-trained models + LLMs; NLI at heuristic thresholds; Rationale & Decision Graph | **F1 ≈ 0.70–0.75** across six OSS projects; 2,234 hand-labelled sentences as ground truth |

### 4.1 What these numbers force you to conclude

1. **~0.7–0.8 F1 is the state of the art for decision extraction.** Anyone claiming better on unstructured dialogue is either measuring something easier or overfitting their own labels. Set the internal target accordingly and say so.

2. **Alternatives are catastrophically hard.** ARGUS: precision **15.4%**, run-consistency α=0.64. Their own explanation: *"Alternatives occur almost exclusively in issues, pull requests, and code reviews"* — i.e. in **discussion**, not in the record. Two consequences for WhyLog:
   - The transcript is genuinely a **better source** than commits for alternatives, because a transcript *is* discussion. This is a real argument for paste-in capture over repo mining, and it is empirically supported.
   - Alternatives must be **review-gated harder** than decisions. Show them, mark them low-confidence, and let the user confirm. Never auto-populate the rejected-alternative index at high confidence — that index powers pre-emption, and a false pre-emption ("you rejected Supabase") is worse than no pre-emption.

3. **False positives dominate false negatives by 13:1** (ARGUS: 155 FP vs 12 FN). Extraction over-generates. Therefore the review UI must be optimised for **fast rejection**, not careful acceptance: collapsed low-confidence items, one-click discard, bulk approve of the high-confidence tier.

4. **Negation terms appear in only 12% of rationale sentences** (Rationale Miner). Polarity is rarely explicit. This is the empirical backing for [03](03-retrieval-and-contradiction.md) §4.4's modality-and-negation-scope machinery: you cannot rely on the text saying "not", so you must infer polarity from verb patterns and from the variable/value ontology.

5. **Majority voting across runs measurably helps.** ARGUS used three-run majority voting precisely because single-run consistency was imperfect (α 0.64–0.88). Cheap to adopt on the LLM path: extract three times at low temperature, keep components that appear in ≥2 runs, mark the rest low-confidence.

6. **Rationale is fragmented across artifacts.** ARGUS: commit messages and PRs mostly carry **Goal** (46.6% / 41.8% of Goal sentences), **Need** lives mainly in issues (45.4%), **Alternatives** almost only in issues/PRs/reviews. A single-source extractor will systematically miss components. WhyLog's mitigation is that the transcript tends to contain all three in one place — but this should be stated as a hypothesis the evaluation harness tests, not as a fact.

---

## 5. Why the transcript is the right source

Synthesising §4:

| Artifact | Goal | Need | Alternatives | Premises/assumptions | Cost to obtain |
|---|---|---|---|---|---|
| Commit messages | ✅ strong | ⚠️ weak | ❌ | ❌ | Free |
| Issues | ⚠️ | ✅ strong | ✅ strong | ⚠️ implied | Requires repo integration |
| Pull requests / reviews | ✅ | ✅ | ✅ | ⚠️ implied | Requires repo integration |
| ADRs (handwritten) | ✅ | ✅ | ✅ | ⚠️ only if the author writes a Context section | **High — nobody writes them** |
| **AI coding transcript** | ✅ | ✅ | ✅ **strongest** | ✅ **strongest** | **Free — it already exists** |

The transcript is the only artifact where **assumptions are stated out loud**, because the developer is actively negotiating constraints with something that keeps asking clarifying questions. Look at the fixture:

> *"none really. it's one person, one machine, one log."*

That sentence is a **premise of type `scale`**, stated explicitly, in a form no commit message would ever contain. The agent's clarifying question forced it into the record. **AI-assisted development accidentally produces the best-documented rationale in the history of software engineering — and then throws it away when the session ends.**

That observation is worth building the pitch around. It is not in any of the surveyed literature, it is empirically checkable against the ARGUS distribution table, and it explains *why now* — why this tool was not buildable in 2019 and is obvious in 2026.

---

## 6. Implications for WhyLog's design

| Finding | Design consequence | Where |
|---|---|---|
| ~0.75 F1 ceiling on extraction | **Review gate is mandatory**, not a nice-to-have. Nothing enters the log unreviewed at low confidence | Phase 1.9 |
| Alternatives precision 15.4% | Alternatives get a stricter review tier; the pre-emption index only accepts user-confirmed alternatives | Phase 1.5, Phase 3 |
| FP ≫ FN (13:1) | Review UI optimised for fast rejection: collapsed low-confidence, bulk-approve high-confidence, one-click discard | Phase 6.5 |
| Negation rarely explicit (12%) | Polarity from verb patterns + value ontology, not from cue words alone | Phase 1.3, [03](03-retrieval-and-contradiction.md) §4.4 |
| Run-to-run inconsistency | Three-run majority voting on the LLM path | Phase 1.8 |
| Rationale fragmented across artifacts | Accept that one transcript yields partial rationale; support **merging** components from later transcripts onto existing decisions (refinement verdict) | Phase 1.7, [03](03-retrieval-and-contradiction.md) §4.3 |
| Assumptions are the lost artifact | **Closed set of 8 premise types** — bounded recovery beats open-ended recovery, per RAAM's own precision problem | Phase 1.4 |
| Y-statement slot structure | Emit decision statements in Y-statement form; adopt an explicit `acceptedDownside` field | Phase 1.3, Phase 5 |
| Knowledge vaporization at the individual level | Positioning: this is not a team-documentation tool. It is a personal exoskeleton for a builder working with an amnesiac | [07](07-novelty-audit-and-positioning.md) |
