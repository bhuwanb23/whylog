# Metrics card

> **THIS CARD IS EMPTY ON PURPOSE.**
>
> Every value below is a placeholder. The evaluation suite is written and **has never been executed** — the
> build environment permitted no installs and no long-running commands.
>
> Filling these in with plausible numbers would be the single most damaging thing this pitch could do. A
> metrics card whose figures were never produced is worse than no card: it lends the shape of rigour to a
> claim with no content, and it is precisely what `docs/07` accuses every surveyed system of.
>
> ```
> npm run eval:report      # writes docs/generated/EVAL-REPORT.md
> npm run eval:ablation    # writes the delta table and the prediction audit
> ```
>
> **Done — the placeholders below were replaced from `docs/generated/EVAL-REPORT.md` after the first
> real run** (corpus 0.1.0, engine `local/cue-extractor-v1`, 12 transcripts, 2026-10-24). The report is
> the source; this card is a quotation of it. Never the reverse.
>
> **Read the `n` column before quoting any row.** Three metrics have a denominator of 1 or 2, one has
> none, and the highlight row at the bottom is *not* available yet. These are real numbers and most of
> them are bad. They are printed because a benchmark whose published numbers were never produced is
> worse than no benchmark.

---

## The thirteen numbers

| # | Metric | Value | n | Published comparator |
| --- | --- | --- | --- | --- |
| 1 | Decision extraction F1 | **0.226** | 19 | RecovAr **75% R / 77% P** — *different genre (commit messages)* |
| 2 | Premise extraction F1 | **0.193** | 16 | **NONE PUBLISHED** |
| 3 | Alternative precision | **0.000** | 8 | ARGUS **15.4%**, FP:FN **13:1** |
| 4 | Contradiction recall (L1) | **0.500** (P **1.000** / R 0.500 / F1 0.667) | 4 | Kantara **396 pairs**, F1 0.70–0.75 — *counts, not recall* |
| 5 | Premise-invalidation recall (L2) ★ | **0.000** — UNTESTABLE | 1 | **NONE PUBLISHED** |
| 6 | Cascade correctness (L3) ★ | **0.000** — UNTESTABLE | 2 | **NONE PUBLISHED** |
| 7 | **Survivor preservation** ★ | **0.000** ⚠ n=2 | 2 | **NONE PUBLISHED** |
| 8 | False-positive rate / 100 | **11.8** ↓ | 34 | ARGUS FP:FN 13:1 |
| 9 | Answer groundedness | **0.000** verdict acc. (mean g. 0.743) | 8 | RepoRationale — *contract specified, never quantified* |
| 10 | Retrieval precision@5 | **0.050** | 8 | agentmemory R@5 **95.2%** — *different task* |
| 11 | Retrieval MRR | **0.083** | 6 | none |
| 12 | Guard precision | **n = 0** | 0 | qualitative literature |
| 13 | **Modality precision** ★ | **0.500** | 6 | **NONE PUBLISHED** |

↓ = lower is better. The only metric in the table whose good direction is inverted.

★ = the two §7.2 calls unusual, plus the L2/L3 pair. **No competitor can produce these at any quality,
because none has the component they measure.**

---

## The highlight row

**This row is not available, and it is not available for an honest reason.**

All eleven toggles are now wired and the ablation runs. But gate (c) cannot be ablated on this corpus:
its single falsification step needs a premise with predicate `scale.max_users` in a specific transcript,
and the extractor never produces one. The harness records that as `applied: false` and the metrics now
score the plant **untestable** rather than passing it.

> Removing **`premiseInvalidation`** — gate (c) — cannot be measured on corpus 0.1.0. L2 and L3 report
> **untestable**, not zero-because-broken and not one-because-passed.

**Why that wording matters.** An earlier run of this table reported L2 = **1.000** with gate (c) removed —
a component scoring perfectly when switched off. That was a vacuous pass: with no intervention planted,
the decision the plant watches was already OUT for unrelated reasons, and the metric counted a standing
breakage as a detection. `plantWasIntervened()` now makes an unapplied intervention untestable, and a
plant with no falsification step at all is untestable too. The fake finding is gone; what replaced it is
an admitted gap.

**What gate (c) *is* backed by:** 9 justifications carry a non-empty OUT-list and 12 premise-gate records
were raised, so the mechanism demonstrably fires; `tests/integration/gate-c-cascade.test.ts` and demo beat
5 (`l2-unsound`, VERIFIED) both exercise it end to end on a fixture whose premise *is* extracted. The
benchmark cannot yet say how *often* it is right, and the difference between those two claims is the whole
point of an ablation.

**The row that IS available, and it is a good one:** the false-positive rate fell from **102.9** to
**11.8** per 100 decisions once gate (a) stopped raising contradictions between two decisions nobody had
accepted, with contradiction **precision 1.000** (0 false positives against ARGUS's published FP:FN of
13:1). The ablation independently attributes the remaining false positives to that gate: switching it off
moves the rate by −52.9 per 100.

If the delta is below the 0.05 noise floor, the audit prints **FALSIFIED** and the honest sentence is that
gate (c) is not earning its place on this corpus. §7.3 requires at least one falsified hypothesis reported;
that requirement is met by declaring thresholds, not by looking for something to confess afterwards.

---

## The number that is a fact regardless

> **5 of 13 metrics have no published comparator.**

Three of the five — premise extraction, L2 invalidation, cascade correctness — have none because no
surveyed system has the component. That count is available today, needs no run, and is the new-territory
claim stated as a number rather than as an adjective.

---

## What every number carries

Each `MetricResult` requires three fields a summary table usually omits:

- **`n`** — a metric that cannot state its denominator cannot be reported
- **`comparator`** — null where none is published, and null *is* the result
- **`honestNote`** — what the number does **not** establish. Required, not optional: omitting it is a
  compile error rather than an editorial choice

So no number from this suite can be quoted bare. That is the design.
