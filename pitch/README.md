# Pitch materials — 7.6

| File | What it is |
| --- | --- |
| [`01-architecture-one-pager.md`](01-architecture-one-pager.md) | Printable. The six layers, the AI seam, three gates, four invariants, the worked cascade, the honest part |
| [`02-concept-diagrams.md`](02-concept-diagrams.md) | The premise lattice · the REVISE cycle · the cascade worked example · the bi-temporal timeline |
| [`03-metrics-card.md`](03-metrics-card.md) | The thirteen numbers — **all placeholders**, with the command that fills them |
| [`04-novelty-table.md`](04-novelty-table.md) | The ✅ rows with one line of evidence each, the three sentences never to say, the closest competitor named first |
| [`05-judge-qa.md`](05-judge-qa.md) | Twelve questions, rehearsed, each under twenty seconds and ending on a number or a mechanism |
| [`06-roadmap-slide.md`](06-roadmap-slide.md) | Six items ordered by what they unlock, plus five cheaper ones derived from the hardening registry |

---

## Acceptance criterion

> Every claim in the pitch traces to a document in `docs/` or a number from 7.2.

**Status: partially met, and the gap is stated rather than papered over.**

Every claim traces to a document — `ARCHITECTURE.md`, `THEORY.md`, `ONTOLOGY.md`, `docs/01`–`docs/07`,
`LIMITATIONS.md`. No claim currently traces to a *number from 7.2*, because 7.2 has never been executed.

The one number available without a run is a count, not a measurement: **5 of 13 metrics have no published
comparator**, three of them because no surveyed system has the component. That is the new-territory claim,
and it is on the metrics card as the only figure that is not a placeholder.

Everything else waits on `npm run eval:report`.

---

## The opening and the close

**Opening statistic** — from `actual.ai/blog/agent-optimized-adrs`: across 15 real feature requests and 10
open-source repositories, ADRs cut agent wrong turns by ~90% (191 → 20), with 9 of 15 requests hitting zero
wrong turns, 37% fewer tokens and 22% less time.

**Subvert it immediately** — Anthropic's own guidance: *"if two rules contradict each other, the model may
pick one arbitrarily."* A 90% reduction from a self-contradictory log is a 90% reduction that decays, and
nobody is maintaining the log's consistency. That is the gap.

**The metaphor** — an immune system, not a memory. Memory records what happened; an immune system notices
that something which used to be safe no longer is, and acts on the things that depended on it.

**The question the product answers** — not *"what did we decide?"* but **"is what we decided still true?"**

**The close, verbatim:**

> *Memory tools stop you repeating yourself. WhyLog stops you building on a decision that stopped being
> true — which is the more expensive mistake, and the one your agent will never catch on its own.*

**The demo peak is gate (c), not contradiction.** Beat 5 of eight, and the line is:

> *"Nothing contradicted me. I never said the word database. The world moved, and the log noticed."*
