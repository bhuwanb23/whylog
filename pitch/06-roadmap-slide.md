# Roadmap

One slide. Ordered by what it unlocks, not by effort.

---

```
   NOW ──────────────────────────────────────────────────────────► LATER

   1. RUN THE SUITE          2. REPOSITORY           3. MCP SERVER
      one command,              CONNECTION               agents read and
      turns design              ends the virtual-        write the log
      into evidence             project limitation       directly
                                                        
   4. LIVE CAPTURE           5. PUBLISH              6. ATMS MULTI-CONTEXT
      by CONSUMING              DecisionMemEval          reasoning
      agentmemory               as a benchmark
```

---

## 1. Run the suite

```
npm install && npm run eval:report && npm run eval:ablation -- --out ablation-report.md && npm run demo:verify
```

Nothing in this repository has been executed. Gate G6 — *every claim backed by a number or a diagram* — is
met the first time that command runs and the placeholders in `pitch/03-metrics-card.md` are replaced from
`docs/generated/EVAL-REPORT.md`.

Everything else on this slide is worth less than this line, because until it runs there are no results to
improve.

## 2. Repository connection

Guards currently evaluate against a **virtual project** built from pasted input — a `package.json`, a file
listing, optional contents. A guard can therefore only verify what the user has told it, which makes the
verification layer pull-based and manual.

Connecting to a real repository is the single highest-value addition **and** the one that ends the
"runs anywhere with no setup" property. It also unlocks the only unmeasured metric: guard precision has
**n = 0** today purely because no repository state exists to violate.

## 3. MCP server

The graph already has a canonical serialisation (`substrate/portability.ts`) and a stable id scheme. Exposing
it as MCP tools is plumbing rather than research, and it is what makes the log available to agents that were
not present when the decision was made.

## 4. Live capture by consuming agentmemory

`agentmemory` has ~22k stars, four memory tiers, 43–54 MCP tools and R@5 95.2% retrieval. Competing with it
on recall is a losing plan.

**Consuming** it is not. Its turns are the raw material extraction needs; its retrieval is better than ours at
finding them. WhyLog's contribution starts where its conflict handling stops — recency and dedup — and picks
up at premises, non-monotonic retraction and cascade.

This is the roadmap item most likely to be misread as a retreat. It is the opposite: it is the item that
converts a competitor into a data source.

## 5. Publish DecisionMemEval

Three of thirteen metrics have **no published comparator** — premise extraction, L2 invalidation, cascade
correctness — because no public corpus exercises them and no surveyed system has the components.

Publishing the corpus is worth more than publishing the tool. A benchmark others can run is the only way the
"new territory" claim stops being ours and becomes the field's, and the loader's quote-resolution discipline
makes the labels checkable by anyone in seconds.

Blocked by item 1, and by limitation §1: twelve transcripts is not a benchmark anyone will adopt. Thirty was
the plan.

## 6. ATMS multi-context reasoning

The graph is justification-based with recorded nogoods. A full ATMS maintains every consistent context
simultaneously, which would let the system answer *"under what assumptions does this decision hold?"* rather
than only *"does it hold now?"*.

Deliberately last. An ATMS is the right structure for a diagnostic reasoner and the wrong one for a decision
log a human reads — so this is a research direction, not a feature, and it should not be promised.

---

## Also on the list, and cheaper than all of the above

| Item | Unblocks | Cost |
| --- | --- | --- |
| 18 more transcripts | limitation §1; makes every rate quotable | a week, no code |
| A second, independent labeller | limitation §2; the largest methodological weakness | a day of someone else's time |
| A fixture repository (3–4 small projects, each violating a decision) | limitation §3; guard precision from n=0 | a day |
| Five-level cascade plant | the "label oscillation" argued check becomes mechanical | hours |
| An edit-then-query plant | the "embedding drift" argued check becomes mechanical | hours |

Every one of these comes from an `argued` entry in `src/eval/hardening.ts` — a documented failure mode that
could not be checked mechanically, with the reason recorded at the time. **This roadmap is derived from the
registry rather than invented**, which is why it is short and specific.
