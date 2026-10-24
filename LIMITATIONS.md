# LIMITATIONS

Stated plainly, with the consequence of each and what would close it.

> A published limitations section is a credibility asset, not a weakness. Every system surveyed in
> `docs/01`–`docs/06` overstates its results; the one that names its ceiling is the one a technical judge
> believes. This document exists to be handed over unsolicited.
>
> The roadmap entries below are **derived**, not invented: each comes from an `argued` entry in the
> hardening registry (`src/eval/hardening.ts`) — a documented failure mode that could not be checked
> mechanically, with the reason recorded at the time.

---

## 1. The corpus is 12 transcripts, not 30

**The constraint.** `plan/phase-7-evaluation.md` §7.1 specifies 30 transcripts (10 clean / 12 messy / 8
adversarial). The corpus has 12. Coverage of every planted case is complete; sample size is not.

**The consequence.** Every rate in the suite has a denominator small enough that a single label moves it by
several points. On `n = 12` transcripts, "0.83 F1" and "0.75 F1" are not distinguishable — they are one
node apart. No number from this benchmark should be quoted to two decimal places without its `n` beside it,
and the report prints `n` on every row for that reason.

**What it does not undermine.** Claims about *mechanisms firing on named cases*. Gate (c) either fires on
`demo1/d1` or it does not, and that is a fact about the code rather than an estimate about a population.
The suite is designed so its strongest claims are of this kind, precisely because the sample cannot carry
the other kind.

**What would close it.** Eighteen more transcripts, labelled by someone who is not the author. The loader,
matcher and metrics are corpus-size agnostic — adding transcripts changes no code.

---

## 2. The ground truth was written by the author of the system

**The constraint.** Every quote, every `expectNode`, every `expectUnsound` was decided by the person being
scored.

**The consequence.** This is the largest methodological weakness in the work and no amount of additional
code fixes it. Where the labeller was generous to the system, recall is inflated; where they were strict,
it is deflated, and there is no way to know which from inside. An independent labeller would disagree on
some fraction of the corpus, and that disagreement is a **lower bound on the true error** of every metric
reported.

**Partial mitigation, not a fix.** Labels are verbatim quotes that must resolve to literal substrings, so
a label cannot refer to text that isn't there — the loader rejects it. That makes the labels *verifiable*
by a third party in a way hand-typed offsets are not, but verifiable and unbiased are different properties.

**What would close it.** Two independent labellers, a published inter-annotator agreement figure, and
metrics recomputed against the agreed labels. This is a day of someone else's time, not a feature.

---

## 3. Guard precision is not measured at all

**The constraint.** A guard needs something to fail against: a `package.json`, a file tree, a repository
state that violates the decision. A transcript corpus contains none of these.

**The consequence.** The `guard-precision` metric reports **n = 0**. There is no denominator, so there is
no precision. The most novel component of the system — generating the check from the decision, which no
surveyed tool does — is the least measured one.

**What is reported instead**, labelled as such and never as precision:

| Property | Why it needs no violations |
| --- | --- |
| Synthesis rate | The central novelty claim is that a guard is *generated*; generation needs no repository |
| Determinism share | `llm_judge` is excluded from compliance in Phase 4, so this is the fraction that can gate CI |
| Skips counted as passes | Must be 0 — a green pipeline from a check that never ran is the worst failure |
| Guards auto-accepted | Must be 0 — invariant I4; the harness never acts as a human |
| Stale `disabledByDecisionLabel` | Must be 0 — a regression check on a bug Phase 6 actually found |

**What would close it.** A fixture repository beside the corpus: three or four small projects, each
violating a specific decision, each labelled with which guard should catch it. Roughly a day of work, and
it would convert an n = 0 into the most defensible number in the suite.

---

## 4. Only the local, keyless engine has been measured

**The constraint.** Every number in this benchmark is produced by `createLocalEngine()`. The LLM path has
not been scored.

**The consequence.** Two things are unknown rather than known-and-good:

- **Gate (b) recall.** Semantic contradiction detection is the one gate that benefits from an LLM. On the
  local path it only recalls conflicts that are lexically dissimilar enough for the rule engine to miss.
  Its true value is unmeasured.
- **Three-run voting.** The local engine reports voting as unsupported and the pipeline ignores the option,
  so the `voting` ablation switch is **structurally unmeasurable keyless**. It is declared with no expected
  damage, because predicting a movement there would be predicting a bug.

**Why keyless anyway.** A number that requires an API key to reproduce is not a number a judge can check,
and §7.5 lists keyless verification as a demo requirement for the same reason. This is a deliberate trade:
measurable-and-auditable was chosen over higher-and-unverifiable.

**The claim this supports.** Gates (a) and (c), backtracking, entrenchment and adjudication are all
deterministic and engine-independent — the whole of G2 runs keyless. The LLM improves gate (b)'s recall and
proposal phrasing and is **not load-bearing for correctness**. That claim is stronger than "works with
GPT-4", and it is the one the measurement actually supports.

---

## 5. Premise extraction is unproven at scale

**The constraint.** Risk R1 in `plan/OVERVIEW.md`, and the weakest link in the architecture. Premises are
what gate (c) operates on, so premise extraction quality is an upper bound on everything the product does
that nobody else does.

**The consequence.** The `premise-extraction` metric has **no published comparator** — no surveyed system
extracts premises from dialogue — so there is no external reference point for whether the achieved number
is good. It could be 0.4 and be state of the art, or 0.4 and be useless. Nothing in the literature settles
it.

**Compounding factor.** The hardening registry shows extraction failure propagating: if premise extraction
misses the premise a cascade should travel through, `cascade-correctness-l3` falls — and the fall is a
premise-extraction failure wearing a cascade metric's name. Every reasoning metric's honest note points at
the extraction metric to check first.

**What would close it.** A larger corpus (limitation 1) with premises labelled independently (limitation 2).
Neither is a code change.

---

## 6. Guards need pasted project input

**The constraint.** Guards evaluate against a **virtual project** built from pasted input — a
`package.json`, a file listing, optionally file contents. There is no repository connection.

**The consequence.** A guard can only verify what the user has told it about their project. Change a
dependency in the real repository and the guard does not notice until someone re-pastes. The verification
layer is therefore **pull-based and manual**, which limits it to catching drift at the moment a human
chooses to look rather than continuously.

**Why it is this way.** A repository connection means filesystem access, a language server or a git
integration, and with it a security surface and an install step. The keyless, browser-only constraint that
makes the demo verifiable is the same constraint that keeps guards virtual.

**What would close it.** The roadmap's repo-connection item. It is the single highest-value addition and
also the one that ends the "runs anywhere with no setup" property.

---

## 7. Single-user, single-machine

**The constraint.** State lives in `localStorage` under seven keys. There is no server, no sync and no
multi-user model.

**The consequence.** Two developers on one project have two decision logs, and neither can see the other's
premises. Since the entire value proposition is that a premise falsified in one conversation invalidates a
decision made in another, **the product does not currently work for the team case it is most useful in**.
The L2 plant — four people on a project, two editing concurrently — is a scenario the tool can describe but
not participate in.

**What would close it.** Export/import via `substrate/portability.ts` already exists and is the intended
interim path: share the log as a file. Real multi-user needs a merge model for concurrent event logs, and
an append-only hash-chained log has a well-defined one (merge by learned time, re-seal) that is not built.

---

## 8. Retrieval is measured on paraphrase, not on vocabulary

**The constraint.** `retrieval-precision` is precision@5 over 8 questions, and most have **one or two**
relevant decisions in the entire corpus.

**The consequence.** A perfect system scores well under 1.0 on precision@5, because four of the five slots
have nothing relevant to fill. The report prints the **achievable ceiling** beside the value for this
reason, and the raw number must not be read as an error rate.

MRR is reported alongside because precision@5 cannot distinguish "ranked fifth" from "never retrieved" —
different failures with different fixes. The two metrics use deliberately inconsistent conventions on the
unanswerable question (excluded from MRR, included in precision@5), which is stated in the honest note
rather than hidden: MRR answers "when there is an answer, how high is it", and the unanswerable question
has no answer to rank.

---

## 9. Markdown round-trip is lossy

**The constraint.** `export/round-trip.ts` re-imports an exported `DECISIONS.md`. Phase 5 established that
the round-trip is lossy and made it say so rather than pretending otherwise.

**The consequence.** Export → edit → re-import does not preserve the full graph. Premise links, entrenchment
breakdowns and guard provenance are not recoverable from Markdown. The export is a **one-way projection for
agents and humans to read**, not a serialisation format — `substrate/portability.ts` is that, and it is JSON.

---

## 10. Nothing has been executed

**The constraint.** The governing build constraint was no installs and no long-running commands in this
environment. `npm run eval`, `npm run eval:ablation`, `npm run eval:report` and `npm run demo:verify` have
all been written and **none has been run**.

**The consequence.** There are no results. `EVALUATION.md` describes the method and contains no numbers;
the metrics card in `pitch/` carries placeholders. Gate G6 ("every claim backed by a number or a diagram")
is **not yet met** — it is met the first time `npm run eval:report` runs and the placeholders are replaced.

**What is verified instead.** `scripts/check_structure.py` — 274 source files, imports resolve, named
exports exist, no cycles, brackets balance, event vocabulary agrees, no forbidden patterns. That is a
structural guarantee and it is not a correctness guarantee. It cannot see that an identifier is used
without being declared, which is how ten real compile errors survived Phases 2–6 before a string-aware scan
found them.

**What would close it.** One command, on a machine with dependencies installed:

```
npm install && npm run eval:report && npm run eval:ablation -- --out ablation-report.md && npm run demo:verify
```

Until that runs, every claim in this repository about *quality* is a claim about design, and should be
presented as one.
