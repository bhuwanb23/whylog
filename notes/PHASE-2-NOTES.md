# Phase 2 notes — Truth Maintenance ★

Written alongside the code. Plan: [`plan/phase-2-truth-maintenance.md`](../plan/phase-2-truth-maintenance.md).
Theory: [`docs/02-truth-maintenance-theory.md`](../docs/02-truth-maintenance-theory.md).

**133 source files, ~39.8k lines. `python3 scripts/check_structure.py` exits 0.**

---

## 0. Audit against the plan text — what was actually wrong

The phase was declared complete, then checked line by line against
`plan/phase-2-truth-maintenance.md`. **It was not complete.** Nine gaps, one of which
would have made the headline demo silently do nothing.

The structural checker cannot see any of these: it validates imports, named exports,
cycles, brackets and the event vocabulary. Every gap below is a property-access or
semantics error inside a file that passes it cleanly.

### 🔴 The one that breaks G2

**`assert.ts` minted a new premise id for every assertion.** `PremiseAsserted` resolves
by `payload.premiseId` *only* — the fold does no predicate matching — and it hardcodes
`supports: true` on the evidence it appends. So falsifying `single-user` would have:

1. created a **duplicate** premise node, violating invariant I2 (premises are shared);
2. left the real `single-user` premise IN, so **gate (c) never fired**;
3. recorded the refutation as *supporting* evidence.

The whole G2 demonstration would have produced a clean run with no findings.

**Fixed** by adding the RESOLVE step §2.1 actually specifies:

- resolution goes through **`state.premiseByFingerprint`** — the fold's own identity
  index — so the reasoner and the fold cannot disagree about what the same premise is;
- resolved + refuting → **`PremiseInvalidated`**, which is what sets `label: OUT` and
  closes the window, which is what the labeller reads;
- resolved + supporting → `PremiseAsserted` on the **existing** id (appends evidence,
  takes max confidence);
- unresolved → **reported, never guessed**, per §2.11;
- the OUT-list half of gate (c) additionally needs **`PremiseConfirmed`** to make the
  excluded condition IN — "an excluded condition arrived" only invalidates a
  justification once the condition is actually believed. That event was never emitted.

### 🟠 Three files referenced fields that do not exist

`Justification.consequent` is a `DecisionId` and its lists are `PremiseId`s, so **a
premise is never a consequent — the justification graph is bipartite.** Three modules
were written as though premises could be conclusions:

| File | Referenced | Reality |
|---|---|---|
| `backtracking.ts` | `premise.justifications` | No such field. Every premise is an assumption. |
| `cascade.ts` | `premise.informant.decisionId` | No such field. The link is `state.premiseToDecisions`. |
| `audit.ts` | `premise.justifications` | No such field. Phase 1's "derived" premises are marked in **text** (`"— excluded by"`). |

This also means Doyle's "antecedents of antecedents" reaches bedrock in **one hop** here.
Depth comes from `Decision.edges.dependsOn`, not from justification arcs. Backtracking
was rewritten accordingly, and its culprit set is now minimal **by construction**: the
IN-list premises that are no longer IN, plus the OUT-list premises that are now IN.
The previous version blamed derived premises too, which inflated the set and made the
nogood non-minimal — the opposite of §2.6's ATMS borrowing.

New `reasoning/graph-index.ts` builds both indexes in one pass, because the naive
traversals were `O(D² × J)` — invisible at demo scale, tens of millions of comparisons
at the 500 nodes §2.2 names as a target.

### 🟠 The adjudicator and the detector disagreed

`adjudication.findContradictors` used **antonym pairs only**. Gate (a) fires on two
conditions: a declared antonym pair, *or* simply two different live values for one
variable. So a newcomer could be **accepted** while gate (a) simultaneously reported a
structural contradiction against an incumbent — nothing retracted, conflict warned about
but never resolved.

Worse, the file's own header comment claimed the two could not disagree. **It now
delegates to `wouldContradict`**, inheriting gate (a)'s two conditions plus its
supersession and validity-window exclusions.

### 🟡 Five more

| Gap | Fix |
|---|---|
| **Nogood reuse was never wired.** `blocksConjunction` was exported and called by nothing — §2.6's "warn: you are re-asserting a combination you found impossible on Oct 3" did not exist. | Checked in `assert.ts` *before* the batch commits, and in `revise.ts` before the proposal is built, so the warning is part of the diagnosis rather than a footnote. |
| **"Override anyway" did not exist**, and dismissal was wired to `HumanOverride` — the same event, described as though it meant "ignore this". `materialize.ts` has implemented the override path since Phase 0 (raises origin to 0.9, `contested`→`active`, resolves the proposal); nothing ever called it. | Added `applyOverride` (assert the newcomer, then override it into force). Renamed dismissal to **`applyVouch`** and documented what it really does: a human vouching for the incumbent raises *its* authority to 0.9. |
| **Rejustification did not re-run the labeller.** §2.9 requires "Keep & re-justify" to *restore the decision to IN*, and only the labeller can do that — the label follows from the graph, never from the event. | Every human action now calls `relabelAfterAction()`. |
| **The Contested queue showed two totals, not two breakdowns.** §2.8 requires "the full entrenchment breakdown of both sides", because override is only informed if the user can see the newcomer lost on corroboration and implementation cost rather than on authority. | `newcomerBreakdownOf` produces a real `EntrenchmentBreakdown`; both are rendered term by term. |
| **The cascade ignored `settings.cascadeDepthCap`** and hardcoded 6; §2.7 says default **4**. | Cap threaded as a parameter; the Phase 0 setting corrected to 4. Backtracking keeps 6 — it must reach bedrock, which can sit deeper than a cascade usefully propagates. |

---

## 1. What was built

| Sub-phase | File | Lines | The load-bearing idea |
|---|---|---|---|
| 2.1 assertion | `reasoning/assert.ts` | 630 | One function, four input kinds, **no branching downstream** |
| 2.1 cycle | `reasoning/revise.ts` | 591 | The nine steps, in the only order that works |
| 2.2 labeller | `reasoning/labeller.ts` | 401 | JTMS validity + well-foundedness, to a fixpoint |
| 2.3 gate (a) | `reasoning/gates/structural.ts` | 227 | Antonym table, `O(1)`, no model, no threshold |
| 2.4 gate (b) | `reasoning/gates/semantic.ts` | 247 | Retrieval + classify; reports **unavailable**, never guesses |
| 2.5 gate (c) ★ | `reasoning/gates/premise.ts` | 307 | IN-list falsified **or OUT-list satisfied** |
| 2.3–2.5 | `reasoning/gates/index.ts` | 257 | All three run; results unioned, never short-circuited |
| 2.6 backtrack | `reasoning/backtracking.ts` | 268 | **Minimal** culprit set, not reachability |
| 2.6 nogoods | `reasoning/nogoods.ts` | 270 | The explanation, not bookkeeping |
| 2.7 cascade | `reasoning/cascade.ts` | 309 | Stop at independent support; depth cap 6 |
| 2.8 entrench | `reasoning/entrenchment.ts` | 341 | Five terms incl. `implementation_cost`; EE3 cap |
| 2.8 adjudicate | `reasoning/adjudication.ts` | 329 | Hansson screening; the newcomer may be **refused** |
| 2.9 proposals | `reasoning/proposals.ts` | 385 | Seven parts, every time |
| 2.10 audit | `reasoning/audit.ts` | 522 | The chain, on **learned** time, weak link named |
| 2.11 local classify | `ai/local/classify.ts` | 253 | Four NLI-style rules, no model |
| — barrel | `reasoning/index.ts` | 198 | Generated from a grep, not from memory |
| — store | `store/reasoning.ts` | 681 | The only place in Phase 2 that can write |
| — view | `views/ReasoningView.tsx` | 1004 | The G2 demonstration |

`types/reasoning.ts` already fixed the shapes for `BacktrackResult`, `CascadeResult`,
`CascadeStep`, `NogoodRecord`, `AdjudicationOutcome`, `RevisionProposal`,
`EntrenchmentBreakdown`, the weights and the bands. **They were used verbatim rather than
re-derived** — the contracts were written in Phase 0 for exactly this reason.

---

## 2. The eight decisions that shape the phase

### 2.1 All three gates run. There is no short-circuit.

The plan's diagram asks "any gate fired?" *after* the three, not between them. Stopping at
the first hit would let a structural contradiction hide a premise invalidation on the same
decision — and the two have **different remedies**. One says "you disagree with yourself",
the other says "the world moved". A user told only the first will fix the wrong thing.

Results are unioned and de-duplicated by `(gate, decision, otherDecision, premise)`.

### 2.2 Cheapest and most certain first — for a reason that is not speed

(a) structural → (c) premise → (b) semantic. Two reasons:

1. Gate (a)'s verdict is passed **into** gate (b) as `structuralVerdict`, so a model that
   disagrees with an antonym-table lookup must say so explicitly rather than silently
   overruling it.
2. A deterministic gate that runs after a model call inherits the model's latency in the
   user's *perception* of it. "Instant" is part of what makes gate (a) believable.

### 2.3 Backtracking returns premises, not decisions

A decision is a conclusion. You do not fix a broken conclusion by removing it; you fix it by
removing the assumption that no longer holds and letting the label propagate.

The distinction is visible in the fixture. Reachability says "all four premises plus
everything below". Backtracking says **"ONE premise — `single-user`. The other three still
hold."** Minimal retraction is what makes the proposal actionable. "Everything you believed
is now suspect" is not a proposal.

### 2.4 The cascade seeds from the CULPRITS, not from the finding

Propagating from the decision would retract its dependents on the strength of a conflict that
backtracking may have localised to a single premise. Steps 5 and 6 are coupled for a reason.

The stop condition is **the design, not an optimisation**. `stoppedAtIndependentSupport: true`
is rendered as a deliberate non-event: "WLD-0004 also rests on `single-user`, but it has a
second independent justification that still holds. Propagation stops here." Showing *why*
something was not retracted is as important as showing what was — without it the user cannot
tell "we checked and it is fine" from "we did not look".

### 2.5 Adjudication runs BEFORE backtracking and cascade

A **refused** newcomer produces no backtracking and no cascade at all, because nothing is
being retracted. Screening first is what keeps a passing remark from triggering a retraction
run. This reorders the plan's diagram (which puts ADJUDICATE after CASCADE) deliberately: the
diagram shows the data flow for an *accepted* newcomer, and the refusal path must not pay for
work it is about to discard.

The newcomer scores **zero corroboration and zero implementation cost**. The asymmetry is the
whole mechanism: an incumbent has had time to accumulate both; a newcomer has had time to
accumulate nothing. New information wins on freshness and loses on everything else.

### 2.6 Premise entrenchment drops `implementation_cost` and RENORMALISES

A premise has no guards. Leaving the term at 0.5 would cap premise scores at 0.80, so the EE3
cap would **always** bind — making it a formality instead of a constraint that bites only when
a premise is genuinely weaker than its decision.

### 2.7 The audit uses LEARNED time, and says so on screen

This is the one place in the system that orders by when it *found out*. A transcript written in
March and imported in October produced a belief in October. Ordering an audit by valid time
would claim the system reasoned about something before it knew about it — not a small
inaccuracy, but the one lie an audit must not tell. `AuditTrail.clock: "learned"` is a field,
not a comment.

### 2.8 Rejustification is four events, not one

`DecisionRejustified` names a `newPremiseId` and a `newJustificationId`. Neither exists yet and
neither can be invented — ids come from the folded counters, so an id made up in a view would
either collide with a real node or point at nothing (and pointing at nothing makes the decision
**unfounded**, not rejustified). So:

```
TranscriptImported → PremiseAsserted → JustificationAttached → DecisionRejustified
```

The first event exists because `PremiseAsserted` requires a verbatim snippet from *some*
transcript, and fabricating a span inside the user's real transcript would claim they said
something in a conversation they did not. A one-line transcript labelled
`"human input — rejustification"` is the honest container. One `recordBatch`: all four land or
none do.

---

## 3. The fifth rule that was considered and rejected

`ai/local/classify.ts` implements the four NLI-style rules the plan specifies. A fifth was
written, tested on paper, and removed:

> ~~negation cue across **different** variables → contradiction (0.35)~~

"No auth needed" beside "use SQLite" shares nothing but a negation cue. Calling that a
contradiction is exactly risk **R3** — false-positive contradictions destroy trust faster than
missed ones build it. The rejection is recorded in a comment at the rule-4 branch so nobody
re-adds it.

---

## 4. Idempotence

Running REVISE twice over an unchanged log produces **no new events** the second time:

- labels have already changed, so `labelling.changed` is empty;
- detections are filtered against `state.contradictions`, not against the in-memory run;
- `isDuplicate` blocks a nogood whose conjunction already exists;
- proposals already exist for these findings.

Without this the log fills with repeated identical warnings and a queue the user has already
read looks permanently unread. **That is how a reasoning system gets switched off.**

Nogood blocking is by **subset**: if {A, B} cannot both hold, {A, B, C} cannot either. The
reverse does not follow, and treating it as though it did would let a two-premise nogood be
evaded by adding a third premise.

---

## 5. Where the placeholders are, and why

`"EV-000000-000000"` appears in three places: `revise.ts`, `store/reasoning.ts`,
`reasoning/assert.ts`. In each case a payload must reference the event that creates it, and
`event-log.append` mints ids from its own monotonic counter — so any id written beforehand
would be wrong. The materialiser rewrites these on fold. This is the same mechanism
`extraction/commit.ts` already uses for justification informants.

---

## 6. Known gaps, stated plainly

*§0 above records the gaps that were found and fixed. These are the ones that remain.*

| Gap | Why | What closes it |
|---|---|---|
| Gate (b) never runs in the app | `skipSemantic: true` is hardcoded in the store: there is no retriever, so there are no candidate pairs. `detectSemantic` reports itself **unavailable** with a reason rather than guessing. | Phase 3 supplies `retrieve`; the store stops forcing the flag. The gate itself is written and takes the retriever as a parameter. |
| `implementation_cost` is always UNKNOWN | No guards exist. Displayed as `"unknown — no guard"`, **never** as "medium", and `implementationCostUnknown: true` is on every breakdown. | Phase 4 passes a `guards: Map<DecisionId, GuardStatus>` into `revise`. The parameter already exists. |
| `NogoodRecord` carries no provenance | The type has no field for it, so whether a nogood came from a deterministic gate or gate (b) is **not recoverable from the log**. `NogoodDraft.engineDerived` exists for the proposal, which is built in the same run. Noted in `nogoods.ts` rather than papered over with a heuristic on the explanation string. | Add a field to the event payload if provenance must survive a reload. |
| `Decision` carries no creating-event id | The audit derives `learnedFrom` from the earliest justification informant's `eventId`, which `materialize` rewrites to the creating event. Correct in practice, indirect by construction. | A `createdBy` field on `DecisionProposedPayload` would make it direct. |
| `contest` has no dedicated event | `PremiseContested` contests a *premise*; the vocabulary has no `ProposalDismissed`. Dismissal is recorded as `HumanOverride` with a `"Dismissed: "` reason prefix — it is the event that carries "a human overruled the system's judgement about a proposal". | Acceptable. Phase 7 counts dismissals per gate from these. |
| The `rejustify` button reuses the failed premise id | It calls `applyRejustification`, which mints a genuinely new premise from the text the user types. The `linkRejustification` variant is for a Phase 6 form that walks the user through creating both nodes. | Phase 6. |
| Proposal prose is always templated | §2.11's table asks for *generated* prose on the LLM path and *templated* on the local one. Only the template exists, so both paths render identically. §2.11 also says the LLM "is not load-bearing for correctness" — this is the one row where that is literally true, and the reason it was left. | Call `engine.compose` in `proposals.ts` with the seven structured fields as input, falling back to `renderProposal`. |
| `source_authority` has no `low_confidence` 0.2 rung | §2.8's table lists five rungs; `DecisionOrigin` is a closed four-member type from Phase 0, and `ORIGIN_AUTHORITY` matches it. Adding a fifth origin would change the event vocabulary. | Leave it. A low-confidence extraction already scores low on the `confidence` term, which is where that information actually lives. |

---

## 7. Definition of done — where each line landed

- [x] Single assertion entry point, four input kinds — `assert.ts`; the `switch` on `source` is
      in that file and nowhere else. Downstream sees a `GraphState` and nothing else.
- [x] JTMS labeller reaching a fixpoint, with `UNFOUNDED` detection — `labeller.ts` (Phase 2, written earlier this segment).
- [x] **Non-monotonic OUT-list invalidation** — `gates/premise.ts`, clause `"out-list"`.
- [x] Gate (a) deterministic, keyless, `O(1)` — `gates/structural.ts`.
- [x] Gate (b) five-verdict taxonomy, M1/M2, refinement not flagged as conflict — `gates/semantic.ts` + `ai/local/classify.ts`.
- [x] **Gate (c) fires end to end keyless** — `gates/premise.ts`; the view's *Something stopped being true* card.
- [x] Backtracking reaching premises, nogoods recorded, displayed, reused — `backtracking.ts`, `nogoods.ts`.
- [x] Cascade with the independent-support stop, depth cap, per-step explainability — `cascade.ts`.
- [x] Entrenchment, five terms, EE3 cap, visible breakdown — `entrenchment.ts`, rendered in part 5.
- [x] Non-prioritized screening with a Contested queue and an override path — `adjudication.ts`, `store/reasoning.ts:applyContest`, `HumanOverride`.
- [x] Seven-part proposals, three actions, including **Keep & re-justify** — `proposals.ts`, `store/reasoning.ts:applyRejustification`.
- [x] Audit trail: every label traceable to an event and a reason — `audit.ts`, `chronologicalOrder`.
- [x] **Gate G2 demonstration** — **EXECUTED**. 	ests/integration/gate-g2.test.ts (4 tests) and
      	ests/integration/phase2-dod.test.ts (16 tests), keyless, deterministic. The path runs end
      to end: import ixtures/demo-transcript.txt → review → Reasoning → falsify
      scale.single_user → the premise goes OUT, the 8 decisions that rest on it go OUT, the
      other 11 SURVIVE, and a revision proposal appears with the entrenchment breakdown. The
      decision ids do **not** match the plan's WLD-0007 / 0011 / 0019 narrative — see §9.
      `fixtures/demo-transcript.txt` → review → Reasoning → falsify a `scale` premise → expect
      UNSOUND + cascade + survivor + proposal with breakdown. Only running it can confirm the
      fixture's decision ids line up with the plan's `WLD-0007 / 0011 / 0019` narrative.

---

## 9. The verification pass - what was broken, what was fixed, what G2 does

Phase 2 was written against a **pre-verification snapshot of Phases 0 and 1** for the
third time. The substrate had been reverted again: materialize.ts called linkHash
without importing it, hash-chain.ts had no selfHash, i-temporal.ts had no
yTemporalValidDesc, and i/config.ts reported "openai" for a locally-running log.

Restored from the verified Phase 1 baseline, with the genuinely mixed files hand-merged so
the Phase 2 additions survived.

### 9.1 The gates

| Gate | Before | After |
|---|---|---|
| 
pm run typecheck | **108 errors** | 0 |
| 
pm run check | 21 errors | 0 errors, 53 warnings |
| 
pm test | 21 | **41 passing** (5 files) |
| 
pm run build | fails | builds |
| 
pm run verify | - | **exit 0** |

### 9.2 Three behavioural fixes that had been reverted

These are the ones that matter, because each of them silently disables a mechanism the
plan depends on.

**decisionIdForRef returned 
ull unconditionally.** An alternative's decisionRef is
an index into the run's decisions, and the resolver stubbed the lookup out. Every
alternative resolved to "create": 21 spurious nodes on a re-import, and no link between a
rejected value and the decision that rejected it. Now the parent's resolution outcome
answers it.

**Derived exclusion premises were confirmed.** premise-linker derives an OUT-list
premise per supporting premise (scale.single_user ⇒ OUT scale.concurrent_writers).
Confirming it labels it IN, and an OUT-list premise that is IN invalidates its
justification - so every decision was unsound from birth and one falsification took the
whole graph with it. That is risk **R2, the cascade crying wolf**. A derived exclusion is
a *hypothesis* about what would break the decision, not an observation that it holds, so
it now stays UNKNOWN until somebody observes it.

**Within-run duplicate decisions were not suppressed.** The same decision recovered from
two episodes produced two candidates, and the ladder had nothing to merge them against.
Now the canonical (variable, value) key suppresses the duplicate, and the alternative's
index map is explicit rather than arithmetic.

### 9.3 One real bug in the Contested queue

**The "override anyway" button did nothing.** ReasoningView.tsx held the rejected
newcomer in pendingNewcomer and passed it to the Contested card - but
setPendingNewcomer was never called, so the card always received 
ull, and
pplyOverride returned early. The button was live and inert: exactly the "an override
that requires re-entry is an override nobody performs" case the code's own comment
describes. The parent now remembers the newcomer it submitted.

### 9.4 What G2 actually does, measured

| Measure | Value |
|---|---|
| Decisions in the graph | 19 |
| Premises | 32 (24 IN, 8 derived exclusions UNKNOWN) |
| Justifications | 19 |
| Premise falsified | scale.single_user (P-0006) |
| Premises → OUT | 1 (P-0006) |
| Decisions → OUT | **8** - exactly those citing P-0006 in their IN-list |
| Decisions that SURVIVE | **11** |
| Revision proposals | 8, each with an entrenchment breakdown |
| Events produced | 332, in referent order |
| Time | 0 ms |

**The cascade is exact.** One premise falsified, eight unsound, eleven untouched.

**The decision ids do not match the plan's narrative.** The plan names WLD-0007, WLD-0011
and WLD-0019; the fixture produces WLD-0001…WLD-0019 with a different mapping, because
the Phase 1 extractor's ordering is not the one the plan assumed. The plan's ids are
illustrative, not contractual - but a demo script that names them has to be rewritten.

**The remaining structural noise is Phase 1's.** Gate (a) reports decisions that disagree
about the same variable, which is the Phase 1 precision problem documented in

otes/PHASE-1-NOTES.md §8.4. The reasoning layer is behaving correctly on the data it
is given.

### 9.5 The Definition of Done, checked

	ests/integration/phase2-dod.test.ts (16 tests) asserts each mechanically-checkable
line of the plan's checklist. The lines it cannot assert are named here.

| Line | Status |
|---|---|
| Single assertion entry point, four input kinds | asserted |
| Labeller fixpoint + UNFOUNDED detection | asserted |
| Non-monotonic OUT-list invalidation | asserted, explicitly |
| Gate (a) deterministic, keyless | asserted (same input, same output) |
| Gate (b) five-verdict taxonomy | asserted (refuses to guess with no retriever) |
| Gate (c) fires end to end keyless | asserted |
| Backtracking + nogoods recorded, displayed, reused | asserted |
| Cascade: independent-support stop, depth cap, per-step reasons | asserted |
| Entrenchment: five terms, EE3 cap, visible breakdown | asserted (implementation cost UNKNOWN, never "medium") |
| Screening → Contested queue with an override path | asserted, including that the override writes a HumanOverride and raises the origin to 0.9 |
| Proposals: seven parts, three actions | asserted |
| **Gate G2** | **asserted and passing** |

**Still open, and unchanged by this pass:** gate (b) never runs in the app (no retriever
until Phase 3); implementation_cost is always UNKNOWN; NogoodRecord carries no
provenance field; and §2.11's last row - generated proposal prose on the LLM path - is
deferred with the reason already given.