# Phase 7 notes — DecisionMemEval, ablation, hardening, demo kit, docs

**Result: 274 source files, 72,870 lines, `check_structure.py` exit 0.**

Phase 7 added 37 files under `src/eval/` (5,900 → 6,900 lines of harness), 10 corpus fixtures, six root
documents, and six pitch artefacts. All seven sub-phases are present — the plan's cut line was not exercised.

---

## 0. The one thing to read first

**Nothing in Phase 7 has been executed.** `npm run eval`, `npm run eval:ablation`, `npm run eval:report` and
`npm run demo:verify` are written and have never run, because the governing constraint on this build was no
installs and no long-running commands.

That is why:

- `EVALUATION.md` contains **zero numbers**. It describes the method.
- `pitch/03-metrics-card.md` is **all placeholders**, with the command that fills them at the top.
- Gate **G6 is not met**. It is met the first time `npm run eval:report` runs.

Inventing plausible metrics was available and would have been the single most damaging thing this phase could
do. A benchmark whose published figures were never produced is worse than no benchmark: it lends the shape of
rigour to a claim with no content, which is precisely what `docs/07` accuses every surveyed system of.

```
npm install && npm run eval:report && npm run eval:ablation -- --out ablation-report.md && npm run demo:verify
```

---

## 1. Definition of done, line by line

| Plan requirement | Status | Where |
|---|---|---|
| **7.1** 30 transcripts (10 clean / 12 messy / 8 adversarial) | ⚠️ **12** (5/4/3) | `fixtures/eval/*.txt` + 2 demo fixtures. Shortfall recorded in `LIMITATIONS.md` §1 |
| **7.1** Planted L1 pairwise | ✅ | `L1-sqlite` — the **control**, not the headline |
| **7.1** Planted L2 premise-level | ✅ | `L2-premise-falsified` — `expectUnsound: ["demo1/d1"]`, **no intervention** |
| **7.1** Planted L3 cascade with a survivor | ✅ | `L3-shared-premise` — three decisions on deliberately different support |
| **7.1** Circular justification | ✅ | `circular-justification` plant; mechanical check in `hardening.ts` |
| **7.1** M1 and M2 | ✅ | Both plants; `ContradictionRecord.diagnostic` counted separately |
| **7.1** Duplicate restatement | ✅ | `duplicate-restatement` — expects **zero** conflicts, which is inverted vs every other plant |
| **7.1** Unanswerable question | ✅ | `q8`; scored as a **hit when the system refuses** |
| **7.2** Ten metrics | ✅ **Thirteen** | `metrics/*` — the ten plus survivor preservation, modality precision, MRR |
| **7.2** Per engine, always separate | ✅ | `byEngine` on every `MetricResult`; the study runs once per engine and tables never mix |
| **7.2** Survivor preservation | ✅ | `metrics/cascade.ts`, second `MetricResult`. Vacuous 1.0 at n=0 says so in the gloss |
| **7.2** Modality precision | ✅ | `metrics/modality.ts`, per tier |
| **7.2** Published comparators cited | ✅ | `COMPARATORS` in `metrics/types.ts`, as data so nothing is retyped |
| **7.3** Ablation harness | ✅ | 11 toggles + 3 parameter sweeps = 15 configurations |
| **7.3** Reproducible delta table | ✅ | `ablation/table.ts` — carries corpus version, engine, timestamp |
| **7.3** ≥1 hypothesis falsified, reported honestly | ⚠️ **mechanism built, result unknown** | Thresholds declared in advance; the audit prints FALSIFIED or states plainly that nothing was |
| **7.4** Hardening pass over every documented failure mode | ✅ | **24 modes** registered — mechanical or argued, no third category |
| **7.4** Four demo-killers | ✅ | `checkDemoKillers()` — vacuous passes count as failures |
| **7.5** Demo script | ✅ | `demo/script.ts`, **8 beats as data** |
| **7.5** Fixtures | ✅ | Two demo fixtures drive the seed |
| **7.5** Seed state | ✅ | **Built, not checked in** — `demo/kit.ts` |
| **7.5** One-click reset | ✅ | Wipe of 7 keys, idempotent |
| **7.5** Fallback recording | ⚠️ | Each killer carries a **spoken mitigation**; no video was recorded |
| **7.5** Keyless verification | ✅ | `demo/verify.ts` — `verified` / `manual` / `failed`, never "skipped" |
| **7.5** Three consecutive dry runs | ✅ | `demo/dryrun.ts` — no reset between runs, compared on **labels** |
| **7.6** Architecture one-pager | ✅ | `pitch/01` |
| **7.6** Concept diagrams | ✅ | `pitch/02` — lattice, REVISE cycle, cascade worked, bi-temporal |
| **7.6** Novelty table | ✅ | `pitch/04` — ✅ rows only, one line of evidence each, closest competitor named first |
| **7.6** Metrics card | ⚠️ **placeholders** | `pitch/03` — deliberately empty, with the command that fills it |
| **7.6** Rehearsed Q&A | ✅ | `pitch/05` — 12 questions, each ending on a number or a mechanism |
| **7.6** Three sentences never to say | ✅ | `pitch/04` §"never to say" |
| **7.6** Roadmap slide | ✅ | `pitch/06` — plus 5 cheaper items **derived from the hardening registry** |
| **7.7** README | ✅ | Rewritten status, reading order, run commands |
| **7.7** ARCHITECTURE | ✅ | Six layers, AI seam, four invariants, three gates, data flow |
| **7.7** THEORY | ✅ | TMS, entrenchment, cascade, **seven deviations** from the literature |
| **7.7** ONTOLOGY | ✅ | Counts **verified from source**, plus how to extend each table |
| **7.7** EVALUATION | ✅ | Method only — **contains no numbers** |
| **7.7** LIMITATIONS ≥5 real constraints | ✅ **10** | Each with its consequence and what would close it |
| **G6** every claim backed by a number or a diagram | ⚠️ **diagrams yes, numbers no** | Met for design claims; met for quality claims only after the first run |

---

## 2. The decisions that shaped the phase

**One merged graph, not one per transcript.** All twelve transcripts append into a single log and questions
are asked against it. A private graph per transcript lets retrieval win by construction — the distractors
that make retrieval hard would be absent. Measuring the easy configuration and reporting it as the product
would not survive a judge's second question.

**Labels are quotes, and the loader rejects what it cannot find.** Every label carries verbatim text; the
loader resolves it to character offsets and excludes anything that is not a literal substring. **50 of 50
resolve.** Two did not at first, and the second was the interesting one: `demo1` states the single-user
premise but never states the concurrent-writers exclusion **in words** — Phase 1 derives it from
`exclusions.ts`. Labelling it would have meant quoting text nobody said, which is exactly what the quote
requirement exists to prevent. It was relabelled with the reason recorded on the label.

**The matcher is a module, not a helper.** Precision and recall are only as honest as the rule deciding
whether an extracted node *is* the labelled one. So the rule lives in one place, at one threshold — *spans
overlap by ≥1 character within the same transcript, greedy by descending overlap, each side used once* — and
is quoted verbatim in every extraction metric's honest note. A variable or premise-type disagreement is
counted **separately** rather than absorbed into a miss, because finding the right sentence and understanding
it as the wrong kind of decision is the most diagnosable failure the extractor has.

**Thresholds declared before any run.** `EXPECTED_DAMAGE` and `NOISE_FLOOR = 0.05` are committed in
`toggles.ts`. A prose prediction cannot be falsified by a program; a threshold can. The audit prints
**confirmed / FALSIFIED / below-floor / untestable**, and "below floor" is deliberately *not* "falsified" —
on twelve transcripts they are different claims. If nothing is falsified the audit says so, and the honest
reading is that the predictions were too timid to be at risk.

**Two switches predict no damage at all.** `voting` is structurally unmeasurable keyless (the local engine
reports it unsupported and the pipeline ignores the option) — predicting a movement there would be predicting
a bug. `semanticContradiction` is declared at the noise floor so that "it did not matter" is a *confirmed*
prediction on the local path.

**L2 is measured the hard way.** Unlike L3, the L2 plant carries **no harness intervention**: the refutation
must be extracted from `demo2`'s text and connected to `demo1`'s premise by the reasoning layer. Two failure
points instead of zero, so the number will be worse — and it is the claim being made. An L2 recall computed
after the harness hands over the falsified premise measures the cascade, which metric 6 already measures.

**Guard precision reports n = 0.** Not a proxy, not a 1.0-because-nothing-failed. A transcript corpus has no
repository state, so there is no denominator. Four structural properties that *are* testable are reported
beside it and labelled as such — including three that must be zero and are invariant checks rather than
measurements.

**The demo seed is built, not checked in.** A committed JSON dump is a snapshot of whatever extraction
produced that day; the moment extraction changes, the presenter describes behaviour the code does not have.

**Dry runs are consecutive with no reset between them.** Runs two and three start from whatever run one left
in storage — the actual failure mode, because a demo that only works cold cannot be repeated for the second
judge at the table. Labels are compared, not just counts: a cascade that fires on run one and not run two
produces identical counts and different labels. Timings are shown but never compared, because treating a slow
run as non-determinism teaches the presenter to ignore the report.

**The script is data and the verifier walks it.** A script in markdown rots — the clicks stop matching the UI
and nobody notices until the rehearsal.

---

## 3. Bugs found while building

| Bug | Consequence if missed |
|---|---|
| Event types written **kebab-case** (`"decision-proposed"`) | The vocabulary is PascalCase. `check_structure.py` validates imports and exports, **not string literals** — this passed the checker and would have thrown at append. The documented blind spot, again |
| `PremiseAssertedPayload` given a `supports` field | The field does not exist; falsification must use `PremiseInvalidated`. Would have compiled and silently recorded refutations as support |
| `AlternativeRejected` emitted **before** decisions were minted | The payload requires `decisionId`; ordering is forced, not chosen |
| `monotonicNow()` used as a timestamp | It is a **duration** clock returning a number. Replaced by `EvalClock`, advancing 1 ms per call — which also makes learned time independent of machine speed |
| `materialize(events, engineId, at)` / `buildIndex(state, labels)` | Real signatures: `fold(events, { engine, now })` and `async buildIndex(options) → BuildReport.artifacts` |
| `L2-premise-falsified` had an **empty** `expectUnsound` | The headline plant expected nothing, so it could never fail |
| `detail.falseNegativeS()` | A runtime `TypeError` inside the FP:FN ratio — i.e. inside the comparison with ARGUS |
| `export type { COMPARATORS }` | A value re-exported as a type |
| Dry-run error path called a helper that **throws** | A failed run would throw again inside its own catch and produce no report at all |
| `STORAGE_KEYS` written from memory | Caught an invented `whylog:demo:v1` and a missed real `whylog:integrity`. A reset that misses a key leaves the next demo starting from the previous one's graph |
| Two corpus quotes did not resolve | See §2 — one was a typo, one was a **derived** exclusion that should never have been labelled |

The pattern across all of these is the one `notes/PHASE-2-NOTES.md` §0 identified: the structural checker
cannot see string literals, payload shapes or call signatures. **Five of the eleven were caught by reading the
actual type declarations rather than by the checker**, which is the argument for grepping before writing.

---

## 4. What Phase 7 changed outside `src/eval/`

| File | Change |
|---|---|
| `package.json` | `eval:ablation` repointed to `ablation/cli.ts`; added `demo:verify`, `demo:dryrun` |
| `README.md` | Status rewritten, Phase 7 row, reading-order table, run commands |
| `STRUCTURE.md` | §14 rewritten to the 37 files actually built; **§18.7 added** with 15 deviations and the bug table |
| `ARCHITECTURE.md` · `THEORY.md` · `ONTOLOGY.md` · `EVALUATION.md` · `LIMITATIONS.md` | New |
| `pitch/` (7 files) | New |

No production module was edited. Phase 7 is additive, which is the property a benchmark needs: if scoring
changed the system, the scores would be about the change.

---

## 5. Where the gaps are, in priority order

1. **Run it.** Everything else on this list is downstream of one command.
2. **18 more transcripts.** Limitation §1. No code changes — the loader, matcher and metrics are corpus-size
   agnostic. This is what converts "mechanism fires on a named case" into a quotable rate.
3. **A second, independent labeller.** Limitation §2, and the largest methodological weakness. A day of
   someone else's time; the disagreement is a lower bound on every metric's true error.
4. **A fixture repository.** Limitation §3. Three or four small projects each violating a decision, labelled
   with which guard should catch it. Converts guard precision from n = 0 into the most defensible number in
   the suite.
5. **Deeper plants.** A five-level cascade makes the "label oscillation" argued check mechanical; an
   edit-then-query plant does the same for "embedding drift"; a nogood plant for the third.
6. **The LLM path.** Unmeasured, not measured-and-good. Gate (b) recall and voting are both unknown.

Items 5 and 6 come from `argued` entries in `hardening.ts` — **the roadmap is derived from the registry
rather than invented**, which is why `pitch/06` is short and specific.
