# Phase 2 notes — Truth Maintenance ★

Written alongside the code. Plan: [`plan/phase-2-truth-maintenance.md`](../plan/phase-2-truth-maintenance.md).
Theory: [`docs/02-truth-maintenance-theory.md`](../docs/02-truth-maintenance-theory.md).

**132 source files, ~38.8k lines. `python3 scripts/check_structure.py` exits 0.**

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

| Gap | Why | What closes it |
|---|---|---|
| Gate (b) never runs in the app | `skipSemantic: true` is hardcoded in the store: there is no retriever, so there are no candidate pairs. `detectSemantic` reports itself **unavailable** with a reason rather than guessing. | Phase 3 supplies `retrieve`; the store stops forcing the flag. The gate itself is written and takes the retriever as a parameter. |
| `implementation_cost` is always UNKNOWN | No guards exist. Displayed as `"unknown — no guard"`, **never** as "medium", and `implementationCostUnknown: true` is on every breakdown. | Phase 4 passes a `guards: Map<DecisionId, GuardStatus>` into `revise`. The parameter already exists. |
| `NogoodRecord` carries no provenance | The type has no field for it, so whether a nogood came from a deterministic gate or gate (b) is **not recoverable from the log**. `NogoodDraft.engineDerived` exists for the proposal, which is built in the same run. Noted in `nogoods.ts` rather than papered over with a heuristic on the explanation string. | Add a field to the event payload if provenance must survive a reload. |
| `Decision` carries no creating-event id | The audit derives `learnedFrom` from the earliest justification informant's `eventId`, which `materialize` rewrites to the creating event. Correct in practice, indirect by construction. | A `createdBy` field on `DecisionProposedPayload` would make it direct. |
| `contest` has no dedicated event | `PremiseContested` contests a *premise*; the vocabulary has no `ProposalDismissed`. Dismissal is recorded as `HumanOverride` with a `"Dismissed: "` reason prefix — it is the event that carries "a human overruled the system's judgement about a proposal". | Acceptable. Phase 7 counts dismissals per gate from these. |
| The `rejustify` button reuses the failed premise id | It calls `applyRejustification`, which mints a genuinely new premise from the text the user types. The `linkRejustification` variant is for a Phase 6 form that walks the user through creating both nodes. | Phase 6. |

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
- [ ] **Gate G2 demonstration** — code-complete; **never executed**. The path is: import
      `fixtures/demo-transcript.txt` → review → Reasoning → falsify a `scale` premise → expect
      UNSOUND + cascade + survivor + proposal with breakdown. Only running it can confirm the
      fixture's decision ids line up with the plan's `WLD-0007 / 0011 / 0019` narrative.
