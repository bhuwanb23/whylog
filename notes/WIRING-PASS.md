# Wiring pass — the ablation switches, the review step, and gate (a)

This pass took the six items left after the lint pass and worked them in order. Two of them turned out to
share a single root cause that was hiding every metric downstream of the labels.

---

## 1. The eight unwired toggles — done, plus three bugs found on the way

All eleven toggles are now consumed by `eval/harness.ts`. Each was wired at the module that owns the
behaviour, not by branching in the harness:

| Toggle | Where it lands |
|---|---|
| `structuralContradiction` | `GateOptions.skipStructural` — `reasoning/gates/index.ts` |
| `premiseInvalidation` | `GateOptions.skipPremiseInvalidation`, **and** the harness stops planting the interventions |
| `cascade` | `ReviseInput.disableCascade` — `reasoning/revise.ts` |
| `entrenchment` | `AdjudicationInput.disableEntrenchment` — `reasoning/adjudication.ts` |
| `negationCues` | `DecisionContext.negationCues` — `extraction/decisions.ts` |
| `modalityFilter` | `DecisionContext.modalityFilter` — `extraction/decisions.ts` |
| `denseRetrieval` | `QueryOptions.levels` minus L1/L2 — `retrieval/index.ts` |
| `reranking` | `RetrieveInput.skipRerank` — `retrieval/index.ts` |

`premiseInvalidation` needed two changes, not one. Skipping the gate is not enough: the harness *plants*
the `PremiseInvalidated` events, so the premise would still go OUT through the fold and the labeller would
still retract its dependents. The world would still have told the log, just by a different door.

**Three further bugs surfaced while wiring:**

- `QueryOptions.levels` was declared and **read by nobody** — asking for a subset of index levels silently
  returned all five.
- The harness's *second* `revise` call (the post-intervention one) passed only `cascadeDepthCap`, so every
  reasoning switch was inert there even where it was wired elsewhere.
- `pipeline.ts` accepted `negationCues` / `modalityFilter` on `PipelineOptions` and dropped them when
  building the `ExtractionRequest`.

**The audit's verdict logic was inverted.** `delta` is (ablated − baseline), so a load-bearing component
produces a *negative* delta — but `confirmed` tested `delta >= threshold`, which is the case where
removing the component made things **better**. A component that improved the system by being deleted
would have been reported as confirmed, and one the architecture depends on as falsified. Neither ever
fired, because no delta reached either threshold, which is the only reason the bug survived its first run.
Fixed, and the two kinds of falsification are now reported separately: "damaged less than declared" and
"removing it helped", which is the interesting one.

`WIRED_TOGGLES` and the `not-wired` verdict are **retained** even though the set is now complete. They are
the check that catches the next toggle somebody declares without wiring — which is exactly how this file
came to be wrong.

---

## 2. The root cause underneath items 2, 4 and the retrieval numbers

Instrumenting the graph before touching anything produced this:

```
decisions 34 -> IN 0, OUT 27, UNKNOWN 7
premises  98 -> IN 0, OUT 21, UNKNOWN 77
```

**Not one IN node in the entire graph.** A premise is UNKNOWN until a human confirms it (I4), a
justification is valid only when every IN-list node is IN, so with every premise UNKNOWN no justification
is valid and the labeller marks every decision OUT. The harness never emitted `PremiseConfirmed`.

`tests/helpers/events.ts` already stated the rule the harness was breaking: *"Fixtures that test gate (c)
must start from a REVIEWED graph or they test a graph nobody has accepted yet."* The eval harness was
benchmarking a graph nobody had accepted.

That single fact was the whole of items 2 and 4 and most of the retrieval numbers:

- the "26 unexplained retractions" in the false-positive metric **were every decision in the corpus**
- survivor preservation 0.000 — nothing can survive when nothing was ever standing
- precision@5 0.050 and groundedness 0.000 — answering from a graph with no IN nodes

The harness now models the review step: it bulk-confirms each transcript's premises before the revision
pass. It confirms **everything the extractor produced**, which is the Review view's bulk-approve path.
Confirming only the corpus-labelled premises would leak ground truth into the run and make the extraction
metrics meaningless, so it is deliberately not done — and the cost is visible: an invented premise becomes
an IN node, and if it later contradicts something the false-positive metric counts the interruption.

After the fix: `decisions IN 0 → 25`, `premises IN 0 → 70`.

---

## 3. Contradiction over-firing — 138.2 → 11.8 per 100

With a live graph the false-positive rate got *worse* first: **102.9 → 138.2**, and the composition
changed from "9 contradictions + 26 retractions" to "**43 contradictions** + 4 retractions". Gate (a) was
firing 43 times over 34 decisions.

The cause is that gate (a) excluded only `superseded` and `archived` — it fired freely on decisions with
status **`proposed`**, i.e. machine candidates nobody had accepted. 28 of the 34 nodes have no ground-truth
label behind them, so most pairs were proposal-against-proposal: the extractor's own noise, presented to
the user as a conflict about their project. That is precisely the failure `docs/03` §8 and `docs/02` §7
both name as the one that gets the panel closed and never reopened.

**The fix:** a contradiction now needs at least one accepted side.

```
false-positive rate      138.2 -> 11.8 per 100 decisions
contradiction precision    ...  -> 1.000   (0 FP, 2 TP, 2 FN)
```

`findContradictors` is deliberately **exempt**. Its newcomer is being put forward by a human at that
moment, so one side is accepted by construction and the check would always pass — applying it there would
suppress the Hansson screening entirely.

**This broke demo beat 3, and the demo was right to break.** A decision nobody accepted cannot be
*reversed*, so a seed of pure proposals has no reversal to show. Two fixes were tried in `demo/kit.ts` and
both were wrong: approving after `runConfig` returns does nothing, because the gates already ran; and
running a second revision pass fixed beat 3 and broke beat 5. The correct fix was to make approval part of
the harness's own review step, **before** the revision pass, behind an `approveDecisions` flag that the
benchmark leaves off and the seed sets. The benchmark measures the un-triaged extractor; the demo narrates
a user who triaged. Those are different graphs and now they are built differently on purpose.

One trap worth recording: the corpus is dated into **November** while the build date is October, so
stamping the approvals with `nowISO()` put them *before* the log's last event and the substrate rejected
the batch on monotonic learned time. The seed continues the log's own timeline, not the wall clock's.

---

## 4. Refusal never fires — diagnosed, and it is not a threshold problem

The two deliberately unanswerable questions were measured against the six answerable ones:

```
expect                  top    2nd   g      verdict
GROUNDED              0.652  0.608  0.852  PARTIAL
GROUNDED              0.348  0.312  0.882  PARTIAL
GROUNDED              0.350  0.350  0.913  PARTIAL
INSUFFICIENT_EVIDENCE 0.348  0.150  0.778  PARTIAL   <- should refuse
INSUFFICIENT_EVIDENCE 0.346  0.312  0.885  PARTIAL   <- should refuse
```

**The distributions overlap.** The unanswerable questions retrieve at 0.348 and 0.346; two answerable ones
retrieve at 0.348 and 0.350. No value of `TOPICALITY_FLOOR` separates them — raising it to 0.4 refuses the
answerable questions too and scores worse than doing nothing.

So a **structural** refusal was added instead, using the same signal gate (a) uses: the question resolved
to a variable, and nothing retrieved occupies that variable. That is absence, not weakness, and absence is
what the evidence contract exists to report. It only fires when the question resolved to a variable at all.

It does not fire on this corpus, and the measurement shows why: "what did we decide about the payment
provider" retrieves a **HOSTING** decision, and "how should we shard the database" retrieves **DATABASE**
decisions. With 28 spurious nodes scattered across all fifteen variables, every question finds a
topically-plausible match. **Refusal, contradiction over-firing and the retrieval numbers are all the same
problem: extraction precision.** The structural refusal is kept — it is correct, and it will fire once the
graph is clean — but it is not claimed as a fix.

---

## 5. A vacuous pass in the headline metric, found because the ablation ran

With gate (c) wired, the ablation reported that removing `premiseInvalidation` **improved** L2 from 0.000
to **1.000** and L3 to 0.500 — and the audit printed it as `FALSIFIED, AND IN THE INTERESTING DIRECTION`.

It was not a finding. With no intervention planted, the decision the plant watches was **already OUT** for
unrelated reasons, and the metric counted a standing breakage as a detection. Two gaps made it possible:

- `plantIsTestable` only asked whether the transcripts imported, never whether the intervention happened.
- `plantWasIntervened` initially returned `true` for a plant with **no** falsify step, so a plant expecting
  unsoundness with nothing falsified counted as testable.

Both now report **untestable**. The fake finding is gone and what replaced it is an admitted gap:
`confirmed 0 · falsified 0 · below floor 8 · untestable 5 · not wired 0`.

**Phase 7.3's "at least one falsified hypothesis" is therefore NOT met**, and the report says so. The two
falsifications it did briefly produce were an artefact, and keeping them would have been exactly the
failure `docs/07` accuses every surveyed system of.

---

## Not done, stated plainly

- **Guard precision, n = 0.** Needs a fixture *repository* with seeded violations. Nothing was attempted;
  a transcript corpus contains no repository state, so there is no denominator. Four structural properties
  that are testable are reported in its place and labelled as such.
- **The real-model pass.** Needs a provider key and network access. The LLM path is reachable and typed,
  and every number in the report is keyless. Unrun, not measured-and-good.
- **Extraction precision.** The one root cause behind items 2, 4 and the retrieval numbers. 28 of 34
  decision nodes have no label behind them and values like `Use oh` and `Use single-user` are being
  adopted. `pickValue` already gates on `bare`, `MIN_VALUE_SCORE` and `tech-shaped`; tightening it further
  is tuning without evidence on a corpus of twelve, and the known case is pinned by an `it.fails` test.
- **The corpus's single falsification step.** L2, L3 and survivor preservation stay untestable until a
  plant targets a premise the extractor actually produces — which has to be chosen from the ground truth
  without being chosen *because* the extractor finds it.

---

## 6. Two consequences that had to be reported rather than smoothed over

**The demo-killer count went from 3/4 to 2/4, and that is the correct number.** "False premise
resolution" now reports UNTESTED. It used to pass because `l2.testable` was true and `l2.flipped` was
non-empty — both vacuously, for the reason in §5. Making the metric honest made the killer honest with it.
The mechanism is still verified by demo beat 5 (`l2-unsound`, VERIFIED) and by
`tests/integration/gate-c-cascade.test.ts`; what the benchmark can no longer claim is a *rate*.

The killer's own evidence string was also wrong and is fixed: it said "the L2 plant's transcripts failed
to import", which was true when testability depended only on the import. `plantWasIntervened()` added a
second condition and on this corpus that is the one that fails. Naming the wrong cause would have sent
whoever reads the report to debug an import that works.

**Hypotheticals becoming nodes is still failing** — 3 of 6 labelled declines became nodes, 2 of 5 on the
adversarial tier, modality precision 0.500. The `modalityFilter` toggle is now wired, and ablating it
moves modality precision by **+0.000** and the false-positive rate by **+0.336** — i.e. removing the filter
is, on this corpus, marginally *better*. That is not evidence the filter is useless; with 6 labelled
declines it is evidence the corpus cannot tell. The staged mitigation in the report stands: filter the
graph to `origin=human, modality=asserted` before showing it, and say "retained but not promoted", which
is true — invariant I1 deletes nothing.

---

## State after this pass

```
tsc -b                 0 errors
biome check            0 errors / 115 warnings
check_structure.py     exit 0
vitest run             172 passed / 13 files
npm run verify         exit 0
npm run demo:verify    exit 0   (7 verified, 2 manual, DEMOABLE)
npm run eval           exit 1   (by design: hardening NOT READY)
npm run eval:report    exit 0
npm run demo:dryrun    exit 0   (3 runs identical)
demo-killers           2 of 4   (was 3 of 4 — the third was passing vacuously)
mechanical checks      1 of 14 failing
npm run eval:ablation  exit 0   (11 of 11 toggles wired)
```
