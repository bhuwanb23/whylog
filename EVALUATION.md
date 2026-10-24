# EVALUATION — DecisionMemEval

How the system is measured, what the measurements mean, and what they do not establish.

> **No number appears in this document.**
>
> That is deliberate. The suite has been written and has never been executed in this environment: the
> governing constraint on this build was no installs and no long-running commands, so `npm run eval` has
> not been run. Every figure below is a placeholder that the generator fills in.
>
> Inventing plausible-looking metrics would be the single most damaging thing this document could do. A
> benchmark whose published numbers were never produced is worse than no benchmark, because it lends the
> shape of rigour to a claim that has no content — and it is exactly the failure `docs/07` accuses every
> surveyed system of.
>
> **Run `npm run eval:report`.** It writes `docs/generated/EVAL-REPORT.md`. This document describes the
> method; that file carries the results. They are kept apart so the method can be read and criticised
> before anyone trusts a number, and so regenerating results never requires editing prose.

---

## 1. The corpus

Twelve transcripts in `fixtures/eval/` plus the two shipping demo fixtures.

| Tier | Count | What it contains |
| --- | --- | --- |
| clean | 5 | Decisions stated plainly, one variable per exchange, premises explicit |
| messy | 4 | Tool output interleaved with dialogue, negotiated decisions, interruptions mid-sentence |
| adversarial | 3 | Hypotheticals, sarcasm followed by a genuine reversal, triplicated restatements |

**The plan asked for 30 transcripts and this has 12.** That is a shortfall, not a design choice, and it is
recorded in `LIMITATIONS.md` §1 with its consequence: every rate in the suite has a denominator small
enough that one label moves it by several points. The coverage that matters is complete — every planted
case in §7.1 is present — but coverage and sample size are different properties and only the first was
achieved.

### Labels are quotes

Every label carries the verbatim text it refers to. The loader resolves each quote to character offsets
and **rejects any quote that is not a literal substring of its transcript**. A label that fails to resolve
is reported and excluded, never silently dropped and never matched at offset zero.

This is strictly stronger than hand-typed offsets, and it is the same discipline Phase 1 imposes on LLM
snippets: a citation that does not resolve is not a citation.

Current state: **50 of 50 quotes resolve.** Two did not on first pass — one quoted "it rests on" where the
transcript says "That rests on", and one quoted an exclusion that the demo fixture never states in words
(because Phase 1 *derives* it from `ontology/data/exclusions.ts`). The second was relabelled rather than
forced, and the reason is recorded on the label itself.

### Planted cases

| Plant | Kind | What it tests |
| --- | --- | --- |
| `L1-sqlite` | L1 pairwise | Two transcripts settle DATABASE on mutually exclusive values. **The control** — every competitor can do this, so a failure here invalidates the rest |
| `L2-premise-falsified` | L2 non-monotonic | A later transcript falsifies an assumption without ever naming the decision or its variable |
| `L3-shared-premise` | L3 cascade | Three decisions on deliberately different support; one falsification must flip one, spare one, and leave one to its remaining support |
| `duplicate-restatement` | dedup | Three restatements must merge into existing nodes, not create new ones — and must **not** raise a conflict |
| `M1` / `M2` | Kantara diagnostics | Similar decisions with contradictory rationales; contradictory decisions with similar rationales |
| `unanswerable-question` | evidence contract | A question the corpus cannot answer must produce a refusal, not a fabrication |

The L3 plant is the one that distinguishes correct cascading from aggressive cascading:

```
d1  connection pooling     rests on  single-user          → MUST flip
d2  migration tooling      rests on  scope                → MUST survive
d3  read replicas          rests on  single-user AND
                                    no-deploy-infra      → survives on remaining support
```

Three different correct behaviours from one intervention. A cascade that flips `d2` is following edges
instead of justifications; one that flips `d3` is treating support as all-or-nothing.

---

## 2. The thirteen metrics

Ten from §7.2's list, plus survivor preservation and modality precision which §7.2 flags as the two
unusual ones, plus retrieval MRR because precision@5 alone cannot distinguish "ranked fifth" from "never
retrieved".

| # | Metric | Comparator | Direction |
| --- | --- | --- | --- |
| 1 | Decision extraction P/R/F1 | RecovAr 75% R / 77% P | higher |
| 2 | Premise extraction P/R/F1 | **none published** | higher |
| 3 | Alternative precision | ARGUS 15.4%, FP:FN 13:1 | higher |
| 4 | Contradiction recall (L1) | Kantara, counts not recall | higher |
| 5 | Premise-invalidation recall (L2) | **none published** | higher |
| 6 | Cascade correctness (L3) | **none published** | higher |
| 7 | Survivor preservation | **none published** | higher |
| 8 | False-positive rate per 100 decisions | ARGUS FP:FN 13:1 | **lower** |
| 9 | Answer groundedness | RepoRationale, contract unquantified | higher |
| 10 | Retrieval precision@5 | agentmemory R@5 95.2% *(different task)* | higher |
| 11 | Retrieval MRR | none | higher |
| 12 | Guard precision on seeded violations | qualitative literature | higher |
| 13 | Modality precision | **none published** | higher |

**Five of thirteen have no published comparator.** That count is the new-territory claim, stated as a
number rather than as an adjective. Three of the five — premise extraction, L2 invalidation, cascade
correctness — have no comparator because no surveyed system has the component at all.

Every `MetricResult` requires three things a summary table usually omits: `n`, a `comparator` (null where
none exists, which is itself the result) and an `honestNote` stating what the number does not establish.
The honest note is a required field, so leaving it out is a compile error rather than an editorial choice.

### Comparators are cited and then qualified

Two deserve specific handling, because printing them bare would mislead in opposite directions.

**agentmemory's R@5 95.2%** uses the same retrieval stack (BM25 + vector + graph, RRF fusion) and is far
higher than anything measured here will be. It is not comparable: agentmemory retrieves conversation
turns that the query usually near-copies, while this retrieves decisions where the query is a question
about rationale. *"Why did we avoid Postgres?"* and *"Use SQLite; single-user, no deploy infra"* overlap
on one word.

**Kantara's 396 contradictory pairs** is a count of what was found in the Linux kernel, with F1 measured
against a hand-checked sample. It is not recall over a planted denominator, because nothing was planted.
Dividing our recall into their count would be arithmetic on two different kinds of quantity.

### Per engine, always separate

`byEngine` is not decoration. A blended number hides the thing most worth showing — that the local
keyless path is a genuine peer rather than a stub. The ablation study is run once per engine and the two
tables are kept apart; no row ever mixes engines.

---

## 3. The matcher is the methodology

Precision and recall are only as honest as the rule deciding whether an extracted node *is* the labelled
one. So the rule is fixed, in one place, at one threshold:

> Spans must overlap by at least one character within the same transcript. Aligned greedily by descending
> overlap, each side used at most once.

Overlap rather than containment, because an extractor that finds the decision but quotes a wider clause
has still found it. One character rather than a ratio, because a ratio threshold is a second tuning knob
and this file is trying to have none. Greedy rather than optimal (Hungarian would maximise total overlap)
because greedy is deterministic and explainable in one sentence — and optimality bought at the cost of
explainability is a bad trade in a benchmark whose purpose is to be checkable.

A span overlap with a **disagreeing variable or premise type** is counted separately, not absorbed into a
miss. Finding the right sentence and understanding it as the wrong kind of decision is the most
diagnosable failure the extractor has, and folding it into a miss makes it invisible.

---

## 4. The ablation study

Twelve toggle configurations — one baseline with all eleven switches on, then one run per switch off —
plus three parameter sweeps. Fifteen runs total, all over the same corpus, all sequential.

Sequential rather than concurrent because the harness mints ids from a counter and stamps learned time
from a clock that advances per call; interleaving configurations would make deltas unattributable to the
toggles.

| Switch | Subsystem | Expected damage |
| --- | --- | --- |
| `structuralContradiction` | gate (a) | L1 recall ↓ ≥ 0.50 |
| `semanticContradiction` | gate (b) | L1 recall ↓ ≥ 0.05 *(floor)* |
| `premiseInvalidation` | gate (c) | L2 ↓ ≥ 0.50, L3 ↓ ≥ 0.30 |
| `cascade` | reasoning | L3 ↓ ≥ 0.30 |
| `entrenchment` | reasoning | FP rate ↑ ≥ 0.05 |
| `negationCues` | extraction | decision extraction ↓ ≥ 0.20 |
| `modalityFilter` | extraction | modality precision ↓ ≥ 0.30 |
| `noiseCollapse` | extraction | decision extraction ↓ ≥ 0.05 |
| `voting` | extraction | **none declared** — unmeasurable keyless |
| `denseRetrieval` | retrieval | MRR ↓ ≥ 0.05 |
| `reranking` | retrieval | MRR ↓ ≥ 0.05 |

Thresholds were declared in `src/eval/ablation/toggles.ts` **before any configuration was run**. 0.05 is
the noise floor: on twelve transcripts, a 0.02 movement is roughly one label either way, and calling it a
confirmed prediction would be reading meaning into the sample size.

### The prediction audit

Every delta is classified against its declared threshold:

- **confirmed** — moved at or above threshold; the component earns its place on this corpus
- **FALSIFIED** — claimed to move a metric and did not
- **below floor** — moved less than 0.05; *not* evidence the component is useless, only that the corpus
  is too small to tell. Those are different claims and the audit prints them differently
- **untestable** — the metric had no denominator in either run

§7.3 requires at least one falsified hypothesis reported honestly. That cannot be satisfied by looking
for something to confess afterwards; it is satisfied by declaring thresholds in advance and printing
whatever the comparison produces. **If nothing is falsified, the audit says so**, and the honest reading
is that the predictions were too timid to be at risk — a study made only of predictions that cannot fail
has not tested the architecture.

Two switches are predicted to be unmeasurable and are declared with no expected damage:

- `voting` — the local engine reports voting as unsupported and the pipeline ignores the option, so this
  switch cannot move anything keyless. Predicting a movement here would be predicting a bug.
- `semanticContradiction` — on the local path, gate (b) only recalls conflicts that are lexically
  dissimilar. It is declared at the noise floor so that "it did not matter" is a *confirmed* prediction
  rather than a falsified one.

---

## 5. Hardening

Twenty-four failure modes are documented across `docs/02` §7 (8), `docs/03` §8 (9) and `docs/04` §8 (7).
Every one is registered in `src/eval/hardening.ts` against either a **mechanical check** — a predicate
over a real run — or an explicit **argued** entry stating why it cannot be checked on a transcript corpus
and what would make it checkable.

There is no third category. A failure mode with no check and no argument is the dangerous one, because it
reads as covered in the docs and is covered nowhere in the code; the registry makes that category empty by
construction.

The `argued` entries are the source of the roadmap in `LIMITATIONS.md`, derived rather than invented.

### The four demo-killers

| Killer | Check | Fallback if it fires on stage |
| --- | --- | --- |
| Cascade over-retraction | survivor preservation = 1.0 **and** n > 0 | Cap cascade depth at 1 in Settings and say the cap out loud |
| False premise resolution | L2 plant flips `demo1/d1` | Drive the falsification by hand from the Reasoning view and describe it as the weaker claim |
| Hypotheticals as nodes | zero hypothetical-modality decisions labelled IN | Filter the graph to `origin=human, modality=asserted` and say they are retained but not promoted |
| Day-one guard failures | zero skips-as-passes, zero auto-accepts, zero stale flags | Paste a real `package.json`, or show the proposal list instead of the run list |

A vacuous pass is a failure: survivor preservation of 1.0 with n = 0 means no survivor was ever at risk,
which is evidence the corpus did not test the property, not evidence the cascade is disciplined.

---

## 6. The demo kit

`npm run demo:verify` runs three things in order and stops at the first failure: does the seed build, does
every beat have something to show, does it do the same thing three times consecutively.

**The seed is built, not checked in.** A committed JSON dump is a snapshot of whatever extraction produced
on the day it was saved; the moment extraction changes, the demo shows a graph the product no longer
builds and the presenter describes behaviour the code does not have. Building at load time costs two
seconds and cannot drift.

**Reset is a wipe, not an undo.** Invariant I1 says nothing is deleted, so an undo would have to rewrite
the log — and a demo that rewrites its own hash chain on stage has just contradicted its first claim.

**Dry runs are consecutive with no reset between them.** Runs two and three start from whatever run one
left in storage, which is the actual failure mode: a demo that only works from a cold start cannot be
repeated for the second judge who walks up to the table. Labels are compared, not just counts — a cascade
that fires on run one and not run two produces identical counts and different labels.

Timings are shown but never compared. Treating a slow run as non-determinism teaches the presenter to
ignore the report.

The eight-beat script is data in `src/eval/demo/script.ts`, and the verifier walks the same list. The
script that gets rehearsed, the script that gets checked and the script that gets presented are one
artefact.

---

## 7. What this benchmark cannot tell you

1. **The labels were written by the author of the system.** This is the largest methodological weakness
   in the work and it is not fixable by more code. An independent labeller would disagree on some
   fraction of the corpus, and that disagreement is a lower bound on the true error.
2. **Twelve transcripts is not a sample.** Every rate has a denominator small enough that one label moves
   it several points. The suite supports claims about *mechanisms firing on named cases*; it does not
   support claims about *rates in production*.
3. **Guard precision is not measured at all.** A transcript corpus contains no repository state, so no
   violation can be seeded and there is no denominator. The metric reports n = 0 and says so. Four
   structural properties that *are* testable are reported in its place and labelled as such.
4. **The local engine is the only one measured.** Every number is keyless by design. The LLM path's gate
   (b) recall and voting behaviour are unmeasured, not measured-and-good.
5. **Nothing has been executed.** See the note at the top of this document.

Each of these is expanded in `LIMITATIONS.md`.
