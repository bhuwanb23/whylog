# DecisionMemEval — evaluation report

Generated 2026-10-26T15:09:24.627Z. Do not edit by hand: `npm run eval:report` regenerates it.

Corpus 0.1.0 · engine local/cue-extractor-v1 · 12 transcripts

## Summary

Thirteen metrics over 12 transcripts. Every one carries its sample
size, its comparator where one is published, and a statement of what it does not establish.

- **Decision extraction P / R / F1**: 0.226 (n=19)
- **Premise extraction P / R / F1**: 0.193 (n=16)
- **Alternative extraction precision**: 0.000 (n=8)
- **Contradiction recall (L1 pairwise)**: 0.500 (n=4)
- **Premise-invalidation recall (L2 non-monotonic)**: 0.000 (n=1)
- **Cascade correctness (L3 propagation)**: 0.000 (n=2)
- **Survivor preservation**: 0.000 (n=2)
- **False-positive rate per 100 decisions**: 11.8 per 100 (lower is better) (n=34)
- **Answer groundedness**: 0.375 (n=8)
- **Retrieval precision@5**: 0.050 (n=8)
- **Retrieval MRR**: 0.083 (n=6)
- **Guard precision on seeded violations**: 0.000 (n=0)
- **Modality precision (correctly declined)**: 0.500 (n=6)

## The thirteen metrics

```
Metric                                            Value      n  Comparator
----------------------------------------------------------------------------------------------------
Decision extraction P / R / F1                    0.226     19  RecovAr (docs/05 §4.1)
Premise extraction P / R / F1                     0.193     16  NONE PUBLISHED
Alternative extraction precision                  0.000      8  ARGUS (arXiv:2604.10345)
Contradiction recall (L1 pairwise)                0.500      4  Kantara (arXiv:2506.11005)
Premise-invalidation recall (L2 non-monotonic)    0.000      1  NONE PUBLISHED
Cascade correctness (L3 propagation)              0.000      2  NONE PUBLISHED
Survivor preservation                             0.000      2  NONE PUBLISHED
False-positive rate per 100 decisions          11.8/100     34  ARGUS (arXiv:2604.10345)
Answer groundedness                               0.375      8  RepoRationale
Retrieval precision@5                             0.050      8  agentmemory
Retrieval MRR                                     0.083      6  NONE PUBLISHED
Guard precision on seeded violations              0.000      0  fitness-function literature
Modality precision (correctly declined)           0.500      6  NONE PUBLISHED

Lower is better for: false-positive rate. Higher is better for everything else.
6 of 13 metrics have NO published comparator — that is the new-territory claim, stated as a count.
```

### Each metric, with what it does not establish

#### Decision extraction P / R / F1

**0.226** · n=19 · P 0.176 / R 0.316 / F1 0.226 (TP 6, FP 28, FN 13)

6 of 19 labelled decisions became graph nodes; 28 node(s) had no label behind them.

Comparator: RecovAr (docs/05 §4.1) — 75% recall / 77% precision on commit-message rationale; Kantara reports F1 0.70–0.75 on contradictions

> Matched by spans must overlap by at least one character within the same transcript; aligned greedily by descending overlap, each side used once. Labels marked expectNode:false are excluded here and scored by modality precision, because counting a correctly declined hypothetical as a miss would punish the right behaviour. n=19 across 12 transcripts hand-labelled by the author of the system, which is the largest methodological weakness in this benchmark: the labels were written by the person being scored. The comparator is a different genre (commit messages, not agent dialogue) and is cited as the nearest published number, not as a like-for-like baseline.

#### Premise extraction P / R / F1

**0.193** · n=16 · P 0.112 / R 0.688 / F1 0.193 (TP 11, FP 87, FN 5)

11 of 16 labelled premises became shared nodes; 11 matched on span but were given the wrong predicate; 0 node(s) carried no extraction span at all.

Comparator: **none published.** The absence is the finding — see the honest note.

> NO PUBLISHED COMPARATOR EXISTS for this metric — see none published. The absence is reported rather than filled with a borrowed number from a different task. Matched by spans must overlap by at least one character within the same transcript; aligned greedily by descending overlap, each side used once, additionally requiring premise TYPE to agree, because the substrate forbids merging across types and a metric that scored across them would measure something the system may not do. n=16 premises, hand-labelled by the system's author. Premise extraction is the weakest link in the architecture (risk R1) and this is the metric that would show it.

#### Alternative extraction precision

**0.000** · n=8 · P 0.000 / R 0.000 / F1 0.000 (TP 0, FP 34, FN 8)

0.000 precision against ARGUS's 0.154; FP:FN 34:8 (4.3 FP per FN) against ARGUS's 13:1. 15 alternative(s) carry a stated rejection reason and 0% of those are correct — the subset the system would act on.

Comparator: ARGUS (arXiv:2604.10345) — 15.4% precision on alternatives, alpha 0.64, FP:FN ratio 13:1

> Precision is the headline because ARGUS's finding is a PRECISION finding; F1 would blend a bad precision with a good recall into a number that looks acceptable. Matched by spans must overlap by at least one character within the same transcript; aligned greedily by descending overlap, each side used once, requiring the variable to agree. n=8 labelled alternatives, of which 8 state a rejection reason. The corpus is small enough that a single spurious alternative moves precision by several points, so the count is reported beside the ratio and neither should be quoted without it.

#### Contradiction recall (L1 pairwise)

**0.500** · n=4 · P 1.000 / R 0.500 / F1 0.667 (TP 2, FP 0, FN 2)

2 of 4 planted L1 cases produced the expected verdict. By gate: 0 structural, 0 semantic, 12 premise. Kantara diagnostics: 0 M1, 0 M2.

Comparator: Kantara (arXiv:2506.11005) — Reported 396 contradictory pairs found over the Linux kernel at F1 0.70–0.75, but published COUNTS rather than recall over a planted set

> n=4 plants, which is a count of CASES, not of contradiction pairs — Kantara's 396 is a count of pairs found in the Linux kernel with no planted denominator, so the two numbers are not rates over the same kind of thing and must not be divided into each other. Recall here is over planted cases the corpus says must fire, plus one case (duplicate-restatement) that says must NOT fire; an untestable plant — one whose transcript failed to import — counts as a miss, because an unmeasured case is not a passed case. L1 is the CONTROL: every surveyed system does some version of it, and a failure here invalidates the rest of the table.

#### Premise-invalidation recall (L2 non-monotonic)

**0.000** · n=1

0 of 1 decision(s) that should have gone unsound when their premise was falsified actually did. 9 justification(s) carry a non-empty OUT-list, which is what makes the graph non-monotonic at all. 12 premise-gate record(s) were raised.

Comparator: **none published.** The absence is the finding — see the honest note.

> NO PUBLISHED COMPARATOR EXISTS — no surveyed system detects that a decision's premise became false without the decision being mentioned, so there is no component to compare against and the absence is reported rather than filled with a borrowed number. n=1, which is ONE planted case (demo1's SQLite decision falsified by demo2). A single case supports the claim that the mechanism fires; it does not support any claim about a RATE, and no rate should be quoted from this metric. Measured with NO harness intervention: the refutation must be extracted from demo2's text and connected to demo1's premise by the reasoning layer, so a miss here may be an extraction failure rather than a reasoning one — check premise-extraction before blaming gate (c). If outListPopulated is 0 the graph is monotonic and this metric is structurally incapable of scoring, which is a different finding from a detection failure and is printed beside the number for that reason.

#### Cascade correctness (L3 propagation)

**0.000** · n=2

0 of 2 plant(s) were FULLY correct — every expected flip happened and no survivor was retracted. 0 over-retraction(s) across 2 expected survivor(s).

Comparator: **none published.** The absence is the finding — see the honest note.

> Scored as a strict conjunction per plant: a cascade that flips the right nodes AND retracts a survivor scores 0, not partial credit, because over-retraction is the failure that destroys trust and partial credit would hide it. n=2 plants — small enough that this metric is a PASS/FAIL over named cases rather than a statistical rate, and it should be quoted as such. A plant whose intervention could not be applied, or whose survivor was never extracted, is scored as FAILED rather than skipped: skipping would make the number improve as extraction worsens. No published comparator exists, because no surveyed system propagates a retraction at all.

#### Survivor preservation

**0.000** · n=2

0 of 2 decision(s) that shared no falsified premise kept their label. 0 were retracted anyway.

Comparator: **none published.** The absence is the finding — see the honest note.

> One of the two metrics §7.2 calls unusual, and the one that predicts whether the product survives a real project. 1.0 is VACUOUS when n=0 and the gloss says so rather than printing a perfect score for an untested property — a benchmark that reports 100% because it measured nothing is worse than one that reports 40%. n=2 survivors, all from the single l03 plant, so this is a check that a specific mechanism does not over-fire, not an estimate of an over-retraction RATE. Nobody publishes a comparator because nobody cascades.

#### False-positive rate per 100 decisions

**11.8 per 100 decisions** · n=34

11.8 unexpected interruption(s) per 100 decisions (0 contradiction(s) and 4 unexplained retraction(s) over 34 decisions). 0 refinement verdict(s) were correctly NOT surfaced as conflicts.

Comparator: ARGUS (arXiv:2604.10345) — FP:FN 13:1 — 155 false positives against 12 false negatives on alternatives

> LOWER IS BETTER — the only metric in the table whose good direction is inverted. The denominator is decisions in the graph, not queries, because that is the quantity a user experiences: they are interrupted by the tool rather than polling it. 'Unexpected' means no plant labelled it, so a detection that is CORRECT but unlabelled counts against the system — this metric is biased pessimistic by construction, and on a corpus of 34 decisions a single unlabelled true positive moves the rate by several points. ARGUS's 13:1 is a ratio over alternatives in a different corpus and is cited as the nearest published statement of the same failure, not as a like-for-like rate. Refinement verdicts are excluded on purpose: surfacing them is what docs/03 says gets a tool switched off, so counting them would measure restraint rather than error.

#### Answer groundedness

**0.375** · n=8

3 of 8 answer(s) carried the verdict the corpus expected. Mean groundedness 0.375 (52 grounded claim(s) of 52). 0 answer(s) exceeded the 3-search budget. Refusals: 1 of 2 correct.

Comparator: RepoRationale — Specifies the evidence contract (bounded searches, citations resolve in-run, insufficient-evidence first-class) but publishes no quantity

> The headline is VERDICT ACCURACY, not mean groundedness, because groundedness measures whether an answer's claims cite things that exist — and a confidently wrong answer can score 1.0 on it. RepoRationale specifies the contract but publishes no quantity, so there is nothing to beat and the three clauses are CHECKED instead: search budget, citation resolution, refusal. n=8 questions, of which 2 is deliberately unanswerable and scores as a HIT when the system refuses — the only place in this suite where producing no output earns the point. An answer with zero claims is scored 0, not 1: 0/0 would reward silence. 5 empty answer(s) were produced, which should be read against the refusal count before concluding anything about restraint.

#### Retrieval precision@5

**0.050** · n=8 · P 0.050 / R 0.000 / F1 0.000 (TP 2, FP 38, FN 0)

2 relevant result(s) across 40 top-5 slots = 5.0%. The achievable ceiling on these questions is 22.5%, because 8 question(s) have fewer than 5 relevant decisions in the whole corpus.

Comparator: agentmemory — R@5 95.2% with BM25 + vector + graph and RRF — a DIFFERENT task (memory recall over conversation turns, not decisions over a corpus)

> precision@5 over 8 questions, one of which is deliberately UNANSWERABLE and contributes a guaranteed zero rather than being dropped — dropping it would inflate the score by deleting the hardest case. The achievable ceiling is printed beside the value because most questions have one or two relevant decisions in a twelve-transcript corpus, so a perfect system scores well under 1.0 and the raw number must not be read as an error rate. agentmemory's R@5 95.2% is a DIFFERENT TASK (retrieving conversation turns the query near-copies, not decisions the query paraphrases) and is cited as the nearest published figure, not as a baseline.

#### Retrieval MRR

**0.083** · n=6

MRR 0.083 over 6 answerable question(s). 5 returned no relevant decision in the top 5 at all.

Comparator: **none published.** The absence is the finding — see the honest note.

> MRR is reported because precision@5 cannot distinguish 'ranked fifth' from 'never retrieved', and those are different failures with different fixes. n=6 — the unanswerable question is EXCLUDED from MRR (where it can only contribute a structural zero) but INCLUDED in precision@5, which is an inconsistency in convention made deliberately and stated here rather than hidden: MRR answers 'when there is an answer, how high is it', and the unanswerable question has no answer to rank. A query with no relevant result contributes 0 under the standard convention; failed queries are never removed from the denominator.

#### Guard precision on seeded violations

**0.000** · n=0

NOT MEASURED — n=0. This corpus is twelve transcripts with no repository state, so no violation could be seeded and no guard had anything to fail against. Measured instead: synthesis rate 100% (34 of 34 decisions got a proposed guard), determinism share 100% (93 deterministic, 0 llm_judge), 0 skip(s) counted as a pass, 0 guard(s) auto-accepted without a human, 0 guard(s) whose disabled flag disagrees with their decision's label.

Comparator: fitness-function literature — Qualitative throughout. No published precision figure, because no surveyed tool generates the check from the decision.

> NOT MEASURED, AND THIS IS A LIMITATION OF THE BENCHMARK RATHER THAN A RESULT ABOUT THE SYSTEM. Guard precision requires seeded violations — a repository state that breaks a decision, labelled with which guard should catch it — and a transcript corpus contains no repository state. Reporting a proxy as precision, or reporting 1.0 because no guard ever failed, would both be the same error in different clothes: a number in a format designed to look like a measurement. The four structural properties that ARE testable on this corpus are reported in the gloss and are worth having on their own — synthesis rate is the central novelty claim (no surveyed tool generates the check from the decision) and needs no violations at all. Three of the reported counts are INVARIANT CHECKS rather than measurements and must be zero: skips counted as passes, guards accepted without a human (invariant I4 — the harness never acts as a human, so any accepted guard is one the system accepted for itself), and guards whose disabled flag disagrees with their decision's label. A non-zero value in any of them is a defect in Phase 4 or in the fold, not a property of the corpus. Seeding real violations needs a fixture repository, which is roadmap work and is recorded in LIMITATIONS.

#### Modality precision (correctly declined)

**0.500** · n=6

3 of 6 non-decisions were correctly left out of the graph; 3 became nodes anyway.

Comparator: **none published.** The absence is the finding — see the honest note.

> This is a PRECISION over declines, not a recall over hypotheticals: the denominator is the statements the corpus marks as must-not-become-nodes, so a system that declines nothing scores 0 rather than undefined. n=6, concentrated in the adversarial tier, which is small enough that one violation moves the number by several points — the per-tier breakdown is printed beside it for that reason. No comparator exists because no surveyed extractor operates on a corpus where speculation outnumbers decisions; the absence is a property of the literature, not a gap in this measurement.

## The two metrics no competitor can produce

§7.2 calls these out specifically. Neither measures a capability the surveyed systems have at any
quality, because neither component exists in them: no surveyed system cascades a retraction, and no
surveyed extractor operates on a corpus where speculation outnumbers decisions.

- **Survivor preservation** — 0 of 2 decision(s) that shared no falsified premise kept their label. 0 were retracted anyway.
  One of the two metrics §7.2 calls unusual, and the one that predicts whether the product survives a real project. 1.0 is VACUOUS when n=0 and the gloss says so rather than printing a perfect score for an untested property — a benchmark that reports 100% because it measured nothing is worse than one that reports 40%. n=2 survivors, all from the single l03 plant, so this is a check that a specific mechanism does not over-fire, not an estimate of an over-retraction RATE. Nobody publishes a comparator because nobody cascades.
- **Modality precision (correctly declined)** — 3 of 6 non-decisions were correctly left out of the graph; 3 became nodes anyway.
  This is a PRECISION over declines, not a recall over hypotheticals: the denominator is the statements the corpus marks as must-not-become-nodes, so a system that declines nothing scores 0 rather than undefined. n=6, concentrated in the adversarial tier, which is small enough that one violation moves the number by several points — the per-tier breakdown is printed beside it for that reason. No comparator exists because no surveyed extractor operates on a corpus where speculation outnumbers decisions; the absence is a property of the literature, not a gap in this measurement.

## Per-case detail

### Extraction

| transcript | TP | FP | FN |
| --- | --- | --- | --- |
| c01 | 1 | 1 | 0 |
| c02 | 1 | 1 | 1 |
| c03 | 0 | 1 | 1 |
| m01 | 0 | 1 | 2 |
| m02 | 1 | 1 | 1 |
| m03 | 1 | 3 | 0 |
| a01 | 0 | 1 | 0 |
| a02 | 0 | 0 | 2 |
| a03 | 0 | 0 | 3 |
| l03 | 0 | 1 | 3 |
| demo1 | 1 | 10 | 0 |
| demo2 | 1 | 8 | 0 |

Found the sentence, understood it as the wrong kind of decision (1):

- `d2` labelled STORAGE, extracted as DATABASE

Premises matched on span but given the wrong predicate (11):

- `p1` labelled `scale.concurrent_writers`, extracted as `scale.single_user`
- `p2` labelled `requirement.animation_control`, extracted as `requirement.must`
- `p1` labelled `time.scope`, extracted as `time.hackathon`
- `p2` labelled `time.available`, extracted as `time.hackathon`
- `p3` labelled `deployment.infrastructure`, extracted as `deployment.ci_present`
- `p1` labelled `scale.max_users`, extracted as `scale.concurrent_writers`
- `p1` labelled `scale.max_users`, extracted as `scale.single_user`
- `p1` labelled `budget.available`, extracted as `budget.free_tier_only`
- `p2` labelled `time.scope`, extracted as `time.hackathon`
- `p2` labelled `team.owns_user_table`, extracted as `team.expertise`
- `p2` labelled `deployment.infrastructure`, extracted as `deployment.model`

Premise TYPE errors (83) — spans overlap but the types disagree.
The substrate forbids merging across types, so these are near-misses the alignment refused:

- `p1` labelled scale, extracted as time
- `p1` labelled scale, extracted as budget
- `p1` labelled scale, extracted as requirement
- `p1` labelled scale, extracted as time
- `p1` labelled scale, extracted as deployment
- `p1` labelled scale, extracted as requirement
- `p1` labelled scale, extracted as requirement
- `p2` labelled deployment, extracted as requirement
- `p2` labelled deployment, extracted as time
- `p2` labelled deployment, extracted as time
- `p1` labelled requirement, extracted as scale
- `p1` labelled requirement, extracted as scale

**Statements that should not have become nodes, and did** (3):

- `d2` (conditional) → WLD-0001
- `h2` (hypothetical) → WLD-0006
- `h3` (hypothetical) → WLD-0008

Alternative FP:FN ratio — 34:8 (4.3 FP per FN) (ARGUS published 13:1).

### Planted cases

| plant | testable | expected flips | flipped | missed | survivors kept | over-retracted | correct |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L2-premise-falsified | NO | 1 | 0 | 1 | 0 | 0 | ✗ |
| L3-shared-premise | NO | 1 | 0 | 0 | 0 | 0 | ✗ |

**Plant keys with no runtime node** (3). These plants are scored as
FAILED rather than skipped — skipping would make cascade correctness improve as extraction worsens:

- L3-shared-premise -> l03/d1
- L3-shared-premise -> l03/d2
- L3-shared-premise -> l03/d3

Contradiction records by gate: 0 structural, 0 semantic, 12 premise. Kantara diagnostics: 0 M1, 0 M2.

Justifications carrying a non-empty OUT-list: 9 of 34 decisions. Zero means the graph is monotonic and L2 cannot score.

Unexpected interruptions (the false-positive numerator), first 4:

- retraction · WLD-0017 (SCOPE=single-user) -> OUT
- retraction · WLD-0026 (OTHER=now) -> OUT
- retraction · WLD-0027 (DATABASE=postgres) -> OUT
- retraction · WLD-0034 (OTHER=now) -> OUT

### Questions

| id | verdict | expected | groundedness | claims | searches | over budget |
| --- | --- | --- | --- | --- | --- | --- |
| q1 | GROUNDED | GROUNDED | 1.00 | 19/19 | 1 | no |
| q2 | INSUFFICIENT_EVIDENCE | GROUNDED | 0.00 | 0/0 | 1 | no |
| q3 | INSUFFICIENT_EVIDENCE | GROUNDED | 0.00 | 0/0 | 1 | no |
| q4 | INSUFFICIENT_EVIDENCE | GROUNDED | 0.00 | 0/0 | 2 | no |
| q5 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | 0.00 | 0/0 | 2 | no |
| q6 | GROUNDED | GROUNDED | 1.00 | 15/15 | 1 | no |
| q7 | GROUNDED | INSUFFICIENT_EVIDENCE | 1.00 | 18/18 | 1 | no |
| q8 | INSUFFICIENT_EVIDENCE | GROUNDED | 0.00 | 0/0 | 1 | no |

| id | relevant expected | found in top 5 | first relevant rank |
| --- | --- | --- | --- |
| q1 | 2 | 2 | 2 |
| q2 | 1 | 0 | — |
| q3 | 1 | 0 | — |
| q4 | 1 | 0 | — |
| q5 | 0 | 0 | — |
| q6 | 2 | 0 | — |
| q7 | 0 | 0 | — |
| q8 | 2 | 0 | — |

### Guards

Precision is NOT MEASURED — a transcript corpus contains no repository state, so no violation could be
seeded. See `docs/LIMITATIONS.md`. What is measurable:

- synthesis rate: 34 of 34 decisions got a proposed guard
- determinism share: 93 deterministic, 0 `llm_judge`
- skips counted as passes (must be 0): 0
- guards auto-accepted without a human (must be 0, invariant I4): 0
- stale `disabledByDecisionLabel` flags (must be 0): 0

## Ablation study

NOT RUN. Pass `--ablation` or run `npm run eval:ablation` separately.
A baseline without ablations supports claims about what the system scores, not about which
component earned the score — and only the second kind of claim is an architectural one.

## Hardening pass

```
HARDENING PASS — 7.4

NOT READY: see the failures below. A partially hardened demo is not a demo that can be given.

THE FOUR DEMO-KILLERS (2/4 passing)

  PASS  Cascade over-retraction
          visible as: One premise is falsified and decisions that share nothing with it lose their label. The graph looks like it is deleting the user's history rather than maintaining it.
          evidence:   0 over-retraction(s) across 2 expected survivor(s); survivor preservation 0.000.

  FAIL  False premise resolution
          visible as: The presenter says 'nothing contradicted me, I never said the word database, the world moved and the log noticed' — and the log has not noticed. There is no recovery from this one, because it is the claim the whole demo is built around.
          evidence:   UNTESTED on this corpus, not failed: its falsification step was never applied — the premise it needs was not extracted. The mechanism IS verified elsewhere: demo beat 5 (`l2-unsound`) reports VERIFIED on the seeded fixture pair, and `tests/integration/gate-c-cascade.test.ts` exercises the full cascade. What the benchmark cannot do is rate it.. Non-empty OUT-lists in the graph: 9.
          on stage:   Fall back to the scripted fixture pair (`fixtures/demo-transcript.txt` then `fixtures/demo-transcript-2.txt`) imported through the UI rather than the corpus, and drive the falsification by hand from the Reasoning view. It is a weaker claim — a human pointing at the premise instead of the transcript implying it — and it must be described as such on stage.

  FAIL  Hypotheticals becoming nodes
          visible as: A speculative question appears in the decision graph as a decision. Reading the node aloud is enough to end the demo, and the audience will do it without being invited to.
          evidence:   3 non-decision(s) became nodes out of 6 labelled declines. Adversarial tier: 2 wrongly promoted of 5 expected declines.
          on stage:   Filter the graph view to origin=human and modality=asserted before showing it. The hypothetical nodes still exist in the log — nothing is deleted, invariant I1 — but they are not on screen, and saying 'they are retained but not promoted' is a true and defensible sentence.

  PASS  Day-one guard failures
          visible as: The guards panel is red before the user has written any code. A verification layer that fails on an empty project teaches the user to ignore it, and an ignored verification layer is worse than none because it has already consumed the user's trust.
          evidence:   93 guard(s) synthesised across 34 decisions (100%). Invariant violations: 0 skip(s) counted as pass, 0 auto-accepted, 0 stale disabled flag(s). All three must be zero.

DOCUMENTED FAILURE MODES (14 mechanical, 9 argued)

Every failure mode in docs/02 §7, docs/03 §8 and docs/04 §8 appears below. A mode with no
check and no argument is the dangerous category — it reads as covered and is covered nowhere.

  pass    [docs/02 §7] Over-retraction — a cascade takes more than it should
           0 over-retraction(s); 2 survivor(s) expected.
  pass    [docs/02 §7] Under-retraction — a cascade stops too early
           1 expected flip(s) missed.
  pass    [docs/02 §7] Circular justification — a decision supports its own premise
           no node reached a circular label.
  pass    [docs/02 §7] Unfounded belief — a node IN with no path to an asserted premise
           no node reached an unfounded label.
  pass    [docs/02 §7] Monotonic graph — no OUT-lists, so nothing can be retracted
           9 justification(s) carry a non-empty OUT-list.
  ARGUED  [docs/02 §7] Entrenchment miscalibration — the wrong belief is contracted first
           Entrenchment weights are declared in `reasoning/entrenchment.ts` and the ablation measures whether removing the ordering raises the false-positive rate. It does NOT measure whether the weights are right, because that needs a corpus with ground-truth entrenchment, which no public corpus has. Making it mechanical needs hand-labelled entrenchment rankings per decision.
  ARGUED  [docs/02 §7] Label oscillation — the fixpoint does not converge
           `reasoning/labeller.ts` caps iterations and reports `fixpointReached`. Checking it needs a graph deep enough to oscillate, and the corpus's deepest plant is three levels. Mechanical once the corpus has a five-level plant.
  ARGUED  [docs/02 §7] Nogood recorded against nodes that no longer exist
           Nogoods reference premise ids; a nogood whose premises were never extracted is dead weight rather than a failure, and the corpus plants no nogoods at all. Mechanical once a nogood plant exists.
  pass    [docs/03 §8] Refinement surfaced as a conflict
           0 refinement verdict(s), none expected to interrupt.
  pass    [docs/03 §8] Search budget exceeded — more than three searches
           0 answer(s) exceeded the 3-search budget.
  pass    [docs/03 §8] Empty answer scored as grounded (0/0 = 1)
           5 empty answer(s), all scored 0 rather than 1.
  FAIL    [docs/03 §8] Answering a question the corpus cannot answer
           1 of 2 unanswerable question(s) refused.
  pass    [docs/03 §8] Citation that does not resolve within the run
           every cited decision id exists in the graph.
  ARGUED  [docs/03 §8] Negation missed — 'not Postgres' read as a decision for Postgres
           The ablation covers this: removing negation cues should damage decision-extraction precision by at least 0.2. It is argued rather than mechanical HERE because the baseline run cannot distinguish a correctly negated extraction from a lucky one; only the ablated pair can, and that lives in the delta table.
  ARGUED  [docs/03 §8] Embedding drift — vectors stale after a decision is edited
           `retrieval/build-index.ts` hashes decision text and re-embeds on change. Checking it needs an edit event in the corpus followed by a retrieval query, and the corpus has no edits. Mechanical once an edit-then-query plant exists.
  ARGUED  [docs/03 §8] Pre-emption fires without a stated rejection reason
           Phase 3 requires `whyRejected` AND `confirmedByHuman` before an alternative enters the pre-emption index, and the harness never acts as a human, so the index should be empty throughout. That is argued from the code path rather than checked, because an empty index cannot be observed to misfire.
  pass    [docs/04 §8] A skip counted as a pass
           0 skip(s) counted as a pass; must be 0.
  pass    [docs/04 §8] A guard accepted without a human (invariant I4)
           0 guard(s) auto-accepted; must be 0.
  pass    [docs/04 §8] Stale `disabledByDecisionLabel` after a label change
           0 stale flag(s); must be 0. This is a regression check on a bug Phase 6 found and fixed.
  pass    [docs/04 §8] `llm_judge` counted toward compliance
           93 deterministic and 0 judged guard(s); Phase 4 excludes judged guards from compliance by filtering on `isDeterministic`.
  ARGUED  [docs/04 §8] A guard that passes on a project that violates its decision
           This is guard precision, and it is NOT MEASURED: a transcript corpus contains no repository state, so no violation can be seeded. Mechanical once a fixture repository ships beside the corpus — roadmap work recorded in `docs/LIMITATIONS.md`.
  ARGUED  [docs/04 §8] Guard scoped too broadly — fires on files the decision does not govern
           Scoping comes from `appliesTo` globs and the decision's variable. Checking over-broad scoping needs a file tree to scope against, which is the same missing fixture repository as the entry above.
  ARGUED  [docs/04 §8] `falsifiesPremiseId` attributed to the wrong premise
           Phase 4 attributes a falsification only when EXACTLY ONE premise matches, so ambiguity is resolved by refusing rather than guessing. Checking the guess would require planting a guard failure with a known premise target, which again needs the fixture repository.

1 of 14 mechanical checks failing.
9 modes are argued rather than checked; each states what would make it mechanical,
and that list is the source of the roadmap in docs/LIMITATIONS.md rather than an invented one.
```

## Metrics with no published comparator

6 of 13 metrics have no published comparator. This is the new-territory claim stated as a count rather than
as an adjective:

- Premise extraction P / R / F1
- Premise-invalidation recall (L2 non-monotonic)
- Cascade correctness (L3 propagation)
- Survivor preservation
- Retrieval MRR
- Modality precision (correctly declined)
