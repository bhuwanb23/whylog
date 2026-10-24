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
> Then replace every `▢▢▢` below from the generated report. The report is the source; this card is a
> quotation of it. Never the reverse.

---

## The thirteen numbers

| # | Metric | Value | n | Published comparator |
| --- | --- | --- | --- | --- |
| 1 | Decision extraction F1 | `▢▢▢` | `▢▢` | RecovAr **75% R / 77% P** — *different genre (commit messages)* |
| 2 | Premise extraction F1 | `▢▢▢` | `▢▢` | **NONE PUBLISHED** |
| 3 | Alternative precision | `▢▢▢` | `▢▢` | ARGUS **15.4%**, FP:FN **13:1** |
| 4 | Contradiction recall (L1) | `▢▢▢` | `▢▢` | Kantara **396 pairs**, F1 0.70–0.75 — *counts, not recall* |
| 5 | Premise-invalidation recall (L2) ★ | `▢▢▢` | `▢▢` | **NONE PUBLISHED** |
| 6 | Cascade correctness (L3) ★ | `▢▢▢` | `▢▢` | **NONE PUBLISHED** |
| 7 | **Survivor preservation** ★ | `▢▢▢` | `▢▢` | **NONE PUBLISHED** |
| 8 | False-positive rate / 100 | `▢▢▢` ↓ | `▢▢` | ARGUS FP:FN 13:1 |
| 9 | Answer groundedness | `▢▢▢` | `▢▢` | RepoRationale — *contract specified, never quantified* |
| 10 | Retrieval precision@5 | `▢▢▢` | `▢▢` | agentmemory R@5 **95.2%** — *different task* |
| 11 | Retrieval MRR | `▢▢▢` | `▢▢` | none |
| 12 | Guard precision | **n = 0** | 0 | qualitative literature |
| 13 | **Modality precision** ★ | `▢▢▢` | `▢▢` | **NONE PUBLISHED** |

↓ = lower is better. The only metric in the table whose good direction is inverted.

★ = the two §7.2 calls unusual, plus the L2/L3 pair. **No competitor can produce these at any quality,
because none has the component they measure.**

---

## The highlight row

The single line to put on a slide, once it has a number:

> Removing **`premiseInvalidation`** — gate (c) — moves L2 invalidation recall by `▢▢▢` and L3 cascade
> correctness by `▢▢▢`, against thresholds of 0.50 and 0.30 declared **before the run**.

That is the architectural claim in one row: the component the product exists for is load-bearing, measured
by removing it, with the prediction committed in advance.

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
