# Ablation study

Corpus 0.1.0 · engine local/cue-extractor-v1 · ran 2026-10-26T03:35:10.750Z

Every number below is (ablated − baseline), sign-flipped for false-positive rate so that a positive
delta always means the full system is better. Thresholds were declared in `toggles.ts` before any
configuration was run.

```
Ablation study: 15 configuration(s), 15 produced scores.
Engine: local/cue-extractor-v1  ·  corpus 0.1.0  ·  ran 2026-10-26T03:35:10.750Z
Total wall time: 2.3s

ABLATION DELTA TABLE
corpus 0.1.0 · engine local/cue-extractor-v1 · ran 2026-10-26T03:35:10.750Z
Every number is (ablated − baseline), sign-flipped for false-positive rate so that POSITIVE ALWAYS MEANS THE FULL SYSTEM IS BETTER.

Switch                          decisions   premises    alterns   modality         L1         L2         L3   survivor     FP/100   grounded        P@5        MRR
------------------------------------------------------------------------------------------------------------------------------------------------------------------
no-structuralContradiction         +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-semanticContradiction           +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-premiseInvalidation             +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000    -52.941     +0.000     +0.000     +0.000
no-cascade                         +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-entrenchment                    +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-negationCues                    -0.045     -0.002     +0.023     -0.167     +0.000     +0.000     +0.000     +0.000     -3.129     +0.000     +0.000     +0.083
no-modalityFilter                  -0.004     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.336     +0.000     +0.000     +0.000
no-noiseCollapse                   +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-voting                          +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-denseRetrieval                  +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
no-reranking                       +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
depth-1                            +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
depth-3                            +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000
searches-1                         +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000     +0.000

· = metric not produced by that configuration. A column of · is a configuration that never exercised the component,
    which is a different finding from a column of +0.000.

PREDICTION AUDIT
Thresholds were declared in src/eval/ablation/toggles.ts BEFORE any configuration was run.

  confirmed     0
  FALSIFIED     0
  below floor   8   (moved less than 0.05 — too small to interpret on 12 transcripts)
  untestable    5   (no denominator in either run)
  NOT WIRED     0   (the switch is declared in toggles.ts but eval/harness.ts never reads it — the row measured nothing)

NOTHING WAS FALSIFIED. §7.3 requires at least one falsified hypothesis reported honestly, and this run
does not have one. The honest reading is that the declared thresholds were too timid to be at risk, not
that every architectural claim survived contact with measurement. A prediction that cannot fail is a
description, and a study made only of those has not tested the architecture.

UNTESTABLE — recorded rather than quietly dropped, because an untested component is not a working one:
  no-premiseInvalidation         invalidation-recall-l2
  no-premiseInvalidation         cascade-correctness-l3
  no-cascade                     cascade-correctness-l3
  depth-1                        cascade-correctness-l3
  searches-1                     answer-groundedness

```

## Baseline metrics

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
Answer groundedness                               0.000      8  RepoRationale
Retrieval precision@5                             0.050      8  agentmemory
Retrieval MRR                                     0.083      6  NONE PUBLISHED
Guard precision on seeded violations              0.000      0  fitness-function literature
Modality precision (correctly declined)           0.500      6  NONE PUBLISHED

Lower is better for: false-positive rate. Higher is better for everything else.
6 of 13 metrics have NO published comparator — that is the new-territory claim, stated as a count.
```
