# Concept diagrams

Four diagrams, each answering one question a judge asks.

---

## 1. The premise lattice — *what does the graph look like?*

Bipartite. Premises are load-bearing; decisions hang from them.

```
  scale          team        deployment      requirement      capability
  ─────          ────        ──────────      ───────────      ──────────
   ◯────┐         ◯            ◯──────┐         ◯               ◯
  single│        headcount   no-infra │      single-page     synchronous
  -user │          =4                 │                        API
    │   │            │                │         │               │
    │   └──────┬─────┼────────────────┴─────┐   │               │
    │          │     │                      │   │               │
    ▼          ▼     ▼                      ▼   ▼               ▼
 ┌────────┐ ┌────────────┐            ┌───────────┐      ┌────────────┐
 │ SQLite │ │ pooling    │            │ Vite      │      │ read       │
 │ not PG │ │            │            │ not Next  │      │ replicas   │
 │  IN    │ │   OUT ★    │            │   IN      │      │   IN ★     │
 └────────┘ └────────────┘            └───────────┘      └────────────┘
      ▲
      │ excluded by
   ◯ concurrent_writers > 1     ← the OUT-list, and the reason gate (c) can fire
```

**Deterministic layout, no force simulation.** Columns by premise type, decisions at the barycentre of
their premises. Same graph, same picture, every run — because a cascade animation whose before-and-after
positions both moved shows nothing.

★ = a survivor. `pooling` rests on single-user alone, so it goes OUT. `read replicas` also rests on
`no-infra`, so it stays IN.

---

## 2. The REVISE cycle — *what happens when something new arrives?*

```
                    ┌──────────────────────────────┐
                    │   a new belief arrives       │
                    │   transcript · quick-log ·   │
                    │   GUARD FAILURE · human      │
                    └──────────────┬───────────────┘
                                   ▼
                        ┌─────────────────────┐
                        │  ASSERT             │  four input kinds, one entry point
                        └──────────┬──────────┘
                                   ▼
                  ┌────────────────────────────────┐
                  │  GATE (a)  structural          │──► contradiction / reversal / refinement
                  └────────────────┬───────────────┘
                                   ▼
                  ┌────────────────────────────────┐
                  │  GATE (b)  semantic            │  retrieval proposes (I3),
                  └────────────────┬───────────────┘  the rule engine disposes
                                   ▼
                  ┌────────────────────────────────┐
                  │  GATE (c)  premise ★           │  nothing mentioned the decision;
                  └────────────────┬───────────────┘  an assumption stopped holding
                                   ▼
                  ┌────────────────────────────────┐
                  │  HANSON adjudication           │  newcomer must outrank EVERY
                  │  E = .30 auth + .20 cost       │  contradictor, else → Contested
                  │    + .20 corrob + .15 conf     │
                  │    + .15 recency               │  EE3 cap = min over its premises
                  └────────────────┬───────────────┘
                                   ▼
                  ┌────────────────────────────────┐
                  │  BACKTRACK to the minimal set  │  dependency-directed, not
                  │  of responsible assumptions    │  chronological
                  └────────────────┬───────────────┘
                                   ▼
                  ┌────────────────────────────────┐
                  │  CASCADE to a fixpoint         │  STOP wherever independent
                  └────────────────┬───────────────┘  support remains
                                   ▼
                  ┌────────────────────────────────┐
                  │  LABEL  (JTMS, to fixpoint)    │  IN · OUT · UNKNOWN · UNFOUNDED
                  └────────────────┬───────────────┘
                                   ▼
                  ┌────────────────────────────────┐
                  │  SEVEN-PART PROPOSAL           │──►  the human accepts,
                  │  + nogood if a dead end        │     overrides or dismisses  (I4)
                  └────────────────────────────────┘
```

Nothing is applied. Every action requires a reason, and the reason goes into the log.

---

## 3. The cascade, worked — *why isn't this just "delete everything downstream"?*

```
  BEFORE                                    AFTER  scale.max_users falsified

  ◯ single-user ──── IN                     ◯ single-user ──── OUT ★ falsified
  ◯ scope ────────── IN                     ◯ scope ────────── IN
  ◯ no-infra ─────── IN                     ◯ no-infra ─────── IN

  ▢ pooling ──────── IN                     ▢ pooling ──────── OUT
      └─ single-user                            └─ its only support is gone

  ▢ migration ────── IN                     ▢ migration ────── IN   ← SURVIVOR
      └─ scope                                  └─ shares nothing with the falsified premise

  ▢ read replicas ── IN                     ▢ read replicas ── IN   ← SURVIVOR
      ├─ single-user                            ├─ single-user (gone)
      └─ no-infra                               └─ no-infra (still holds) ★
```

The cascade stops at `read replicas` because a justification is valid iff **every** IN-list node is IN —
and one still is. That single rule is the difference between a truth-maintenance system and a delete query.

**Measured two ways, on purpose.** Cascade correctness (did the right things flip) and survivor
preservation (did the wrong things stay put) are separate metrics, because a cascade can score perfectly on
the first and be unusable. Correctness is a **strict conjunction**: flips *and* spares, or zero.

---

## 4. Bi-temporal — *which of the two times is this?*

```
        LEARNED TIME (when the system was told) ────────────────────────►
        append-only · monotonic · hash-chained · PREFIX FOLD

   Oct 3 ─────────────── Nov 18 ─────────────── Dec 1
     │                     │                      │
     │  "SQLite, single-   │  "four of us now,    │  "we reviewed the
     │   user, no deploy    │   two concurrent     │   October decision
     │   infra"             │   editors"           │   and it stands"
     │                     │                      │
     ▼                     ▼                      ▼
        VALID TIME (when it was true in the world) ──────────────────────►
        filtered, NOT folded · isValidAt · windows open and close

   ┌─────────────────────────────┐
   │ scale.max_users = 1         │  valid Oct 3 → Nov 18, then CLOSED
   └─────────────────────────────┘
                        ┌──────────────────────────►
                        │ scale.max_users = 4        valid Nov 18 → open
                        └──────────────────────────►
```

Two questions, two mechanisms:

- **"What was true in October?"** → filter the whole log by valid time
- **"What did we know in October?"** → prefix-fold the first N events by learned time

Getting these the wrong way round produces a Time Machine that shows decisions before they were made.
Valid time is **not** a prefix fold, because events are stored in learned order.
