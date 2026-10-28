# THEORY

Truth maintenance, entrenchment and the deviations — for a technical reader.

The full survey is `docs/02-truth-maintenance-theory.md`. This is the readable version: what the system
actually implements, and where and why it departs from the literature.

---

## 1. The starting point

A decision is not a fact. It is a **belief held under a set of assumptions**.

```
   DECISION     Use SQLite, not Postgres
      │
      ├── rests on ──►  PREMISE  scale.max_users = 1
      ├── rests on ──►  PREMISE  deployment.infrastructure = none
      └── excludes ──►  PREMISE  scale.concurrent_writers > 1     ← the OUT-list
```

The moment it is written that way, three things follow:

1. The decision can become **false without anyone changing their mind** — the world moves, the assumption
   stops holding, and the belief is no longer supported.
2. Detecting that requires storing the assumptions, not just the decision.
3. Reasoning about it is **non-monotonic**: adding information can retract a conclusion.

Every tool surveyed in `docs/01` and `docs/06` stores the decision. None stores the *given*. That is not an
oversight in any one of them; it is the thing none of them is built to do.

---

## 2. JTMS, and why not ATMS

Doyle's 1979 Truth Maintenance System and de Kleer's 1986 Assumption-based TMS solve related problems.
WhyLog implements a **justification-based** system with explicit nogoods borrowed from the assumption-based
one.

A justification is valid iff:

```
    every node in its IN-list is IN      AND      no node in its OUT-list is IN
```

The OUT-list is the whole point. A system with only IN-lists is monotonic — it can accumulate support but
can never retract, so it can never notice that an assumption stopped holding. **A non-empty OUT-list is the
formal signature of non-monotonic reasoning**, and it is gate (c).

Why not full ATMS? Because an ATMS maintains every consistent context simultaneously, and the product needs
one labelled graph a human can read. ATMS is the right structure for a diagnostic reasoner; JTMS plus
recorded nogoods is the right structure for a decision log. Nogoods are kept — a conjunction of assumptions
that cannot all hold — because they prevent the same dead end being re-derived after a cascade.

The graph is **bipartite** as a consequence. `Justification.consequent` is a `DecisionId`, so edges run
decision ↔ premise only. There is no `premise.justifications` field and no premise-to-premise edge. This is
not a missing feature; it is what makes a single falsified premise invalidate every decision resting on it,
which requires the premise to be one shared node rather than a copy per decision (invariant I2).

---

## 3. Entrenchment

When a newcomer contradicts an incumbent, which one goes? Hansson's answer is: contract the **least
entrenched** belief, and require the newcomer to outrank *every* contradictor — otherwise the pair goes to
a Contested queue for a human.

```
E(d) = 0.30 · source_authority
     + 0.20 · implementation_cost
     + 0.20 · corroboration
     + 0.15 · confidence
     + 0.15 · recency

   bands:   HIGH ≥ 0.70      MEDIUM ≥ 0.45      LOW below
   recency half-life: 30 days, on VALID time
```

Two deviations matter.

**The EE3 cap.** Entrenchment is capped at the minimum over the decision's own premises. A decision cannot
be more entrenched than its weakest assumption — otherwise a long-lived decision resting on a single
unverified premise becomes unretractable, which is precisely the failure entrenchment exists to prevent.
`EntrenchmentBreakdown` reports `ee3CapApplied` so the cap is visible rather than silently lowering a score.

**`implementation_cost` is a measurement, not a guess.** Phase 4 made it one: `guardStatusMap` is fed into
`ReviseInput.guards`, so cost is derived from whether the decision's guards pass. Before that it was a
constant, and a constant in a weighted sum is a bias with extra steps. `implementationCostUnknown` is
reported when no guards exist, because a weight applied to a missing measurement is not a measurement.

A human override raises `source_authority` to 0.9 — enough to win any adjudication, not enough to be
infinite. An override that could never be outranked would make the system unable to correct a mistake the
human made, and invariant I4 is about who decides, not about who is infallible.

---

## 4. The three gates

| Gate | Fires when | Deterministic? | Verdicts |
| --- | --- | --- | --- |
| **(a) structural** | You contradict yourself: same variable, different canonical value, overlapping validity window | Yes, entirely | contradiction · reversal · refinement |
| **(b) semantic** | You contradict yourself in words that don't match | Rule engine yes; LLM adds recall | same |
| **(c) premise** | **Reality** contradicts you: an assumption stopped holding | Yes, entirely | invalidation → cascade |

Gates (a) and (b) are what every competitor can do in some form. Gate (c) is what none of them can do, and
it is why the demo's peak beat is not the contradiction.

**One rule engine.** The five-rule classifier lives in `retrieval/contradiction.ts` and `ai/local/classify.ts`
delegates to it. Two engines would drift, and a contradiction verdict that depends on which path produced it
is not a verdict.

The rule order was **reordered from `docs/03` §3.6**, which had a bug: rule 4 (antonym) was unreachable,
because an antonym pair *is* a differing value and rule 2 already consumed it. All five verdicts are now
testable. This is recorded because a spec that cannot be implemented as written is a spec that has not been
implemented, and the fix changes which verdicts fire.

**Refinement is the common case.** Two decisions on the same variable with the same value, one adding
rationale, is by far the most frequent relationship in a real log. Surfacing it as a conflict is what
`docs/03` says gets a tool switched off within a day — so refinement is recorded and left alone, and the
false-positive metric explicitly excludes it.

---

## 5. Cascading

Falsifying a premise re-labels every decision resting on it, transitively, to a fixpoint.

```
   scale.max_users = 1  ──FALSIFIED──►  OUT
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            connection pooling     migration tooling       read replicas
            rests on it ALONE      rests on scope only     rests on it AND
                    │                     │                no-deploy-infra
                    ▼                     ▼                     ▼
                  OUT               unchanged (IN)         still IN — one
                                                           support remains
```

Three correct behaviours from one intervention. A cascade that flips `migration tooling` is following edges
instead of justifications. One that flips `read replicas` is treating support as all-or-nothing.

**Over-retraction is the failure mode that ends the product.** A user who falsifies one assumption about
team size and watches eleven unrelated decisions vanish will never trust the graph again, and they will be
right not to. So:

- `cascade()` takes a depth cap, threaded from a persisted setting through `ReviseInput` to the call site
- survivor preservation is measured as its own metric, separate from cascade correctness
- cascade correctness is a **strict conjunction**: flips the right nodes *and* spares the survivors, or it
  scores zero. Partial credit would hide exactly the failure that matters
- the lattice layout is **deterministic** — columns by premise type, decisions at the barycentre, no force
  simulation — because a cascade animation is only legible if nodes stay where they were

A force-directed layout was considered and rejected for that reason. It is prettier and it is not
reproducible, and an animation whose before-and-after positions both moved shows nothing.

---

## 6. Where this departs from the literature

| Deviation | From | Why |
| --- | --- | --- |
| Extraction per **episode**, not per sentence | arXiv:2506.11005 (Kantara) | A decision is negotiated across turns. Per-sentence extraction finds the sentence and loses the qualification three turns later |
| **Bipartite** graph, no decision↔decision edges | general TMS | Required by shared premises (I2), and it is what makes one falsification reach every dependent |
| EE3 cap = min over the decision's premises | Hansson entrenchment | Without it a long-lived decision on one weak premise becomes unretractable |
| `implementation_cost` measured from guard status | `veritas-tms`'s fixed weights | A constant in a weighted sum is a bias |
| Reranker scores the **original query** only | HyDE (arXiv:2212.10496) | HyDE at query time is not expressible here, and arXiv:2604.01733 found it underperformed vanilla dense while hybrid RRF + cross-encoder dominated |
| L4/L5 index levels **promoted, never fused** | standard RRF | Exact structural evidence outranks statistical evidence; fusing them lets a weak lexical match dilute a certain one |
| Contradiction **detection is not the headline** | every surveyed system | It is the control. Gate (c) is the claim |

---

## 7. The eight failure modes, and which are checked

`docs/02` §7 documents eight. All eight are registered in `src/eval/hardening.ts` with either a mechanical
check or a written argument:

| Failure mode | Status |
| --- | --- |
| Over-retraction | mechanical |
| Under-retraction | mechanical |
| Circular justification | mechanical |
| Unfounded belief | mechanical |
| Monotonic graph (no OUT-lists) | mechanical |
| Entrenchment miscalibration | argued — needs hand-labelled rankings, which no public corpus has |
| Label oscillation | argued — needs a five-level plant; the deepest is three |
| Nogood against nonexistent nodes | argued — the corpus plants no nogoods |

`docs/03` §8 contributes nine more and `docs/04` §8 seven, for twenty-four total. None is silently
uncovered, and the argued ones are the source of the roadmap in `LIMITATIONS.md` rather than an invented one.
