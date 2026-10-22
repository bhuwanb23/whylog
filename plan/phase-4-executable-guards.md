# Phase 4 — Executable Decision Guards

| | |
|---|---|
| **Layer** | L2 ↔ L4 — Reasoning and Synthesis |
| **Depends on** | Phase 0 (ontology) · Phase 1 (structured decisions with variable/value/alternatives/globs) · Phase 2 (evidence entry point) |
| **Blocks** | Phase 5 (verify commands) · Phase 2's `implementation_cost` term |
| **Estimate** | 5 h |
| **Research** | [docs/04](../docs/04-executable-decision-guards.md) — the whole document is this phase's specification |
| **Gate** | **G4 — It verifies**: a decision can be proven wrong by the code, deterministically, with no model involved |

**Objective in one sentence:** compile each decision into machine-checkable guards, run them, turn drift into a number, and feed the results back into the truth-maintenance cycle as evidence.

**Why this pillar matters.** The fitness-function literature has said for a decade that *"every important architectural decision should have a corresponding fitness function"* and that *"where ADRs document a decision, fitness functions enforce it."* In every workflow surveyed, **a human writes the check by hand** — or an LLM judges a diff against a handwritten rubric. Nobody generates the check from the decision, because nobody has the decision in a structured enough form to generate from. Phase 1 produced that form. **The compiler is therefore nearly free, and it closes a loop the literature only describes.**

---

## Sub-phases

### 4.1 — Guard taxonomy

**Goal.** Eight kinds, ordered from most deterministic to least.

| Kind | Asserts | Determinism | In browser |
|---|---|---|---|
| `dependency_present` | A package **is** in the dependency tree | Total | ✅ |
| `dependency_absent` | A package **is not** present (typically a rejected alternative) | Total | ✅ |
| `string_absent_in_files` | A pattern does **not** appear within a glob | Total | ✅ |
| `string_in_files` | A pattern **does** appear within a glob | Total | ✅ |
| `path_glob_exists` | Files matching a glob exist | Total | ✅ |
| `path_glob_absent` | No files match a glob | Total | ✅ |
| `command_exit_zero` | An arbitrary command succeeds | Environment-dependent | ❌ export only |
| `llm_judge` | A rubric verdict over a diff or file set | Non-deterministic | ⚠️ key required |

**Design rule: prefer the highest-determinism guard that expresses the decision.** `llm_judge` is the last resort. The **ratio of deterministic to judged guards is itself a health metric** for the log.

**Guard record fields:** `id` (`G-0007a`) · `decisionId` · `kind` · `spec` · `rationale` (**mandatory** — a guard without a stated rationale is indistinguishable from a lint rule) · `generatedBy` (`template`/`llm`/`user`) · `severity` (`blocking`/`warning`) · `lastRun` (timestamp, result, **evidence string**) · `suppressed` (with reason).

**Acceptance criteria.** All eight kinds specified; the first six evaluate with no model and no shell; every guard carries a rationale.

---

### 4.2 — Guard synthesis

**Goal.** Compile a decision into a guard set.

```
        DECISION (from Phase 1)
        variable: DATABASE · value: sqlite
        rejected: [postgres, supabase]
        applies_to: src/db/**, package.json
                    ³
                    ▼
        ┌──────────────────────────────────┐
        ³  TEMPLATE RULES per variable     ³  deterministic — covers ~80%
        ³  DATABASE  → driver present /    ³
        ³              rejected absent /   ³
        ³              connection-string   ³
        ³              absent              ³
        ³  FRAMEWORK → build config +      ³
        ³              dependency          ³
        ³  HOSTING   → config file +       ³
        ³              deploy manifest     ³
        ³  AUTH      → middleware / lib    ³
        ³              present or absent   ³
        ³  STORAGE   → artifact present    ³
        └───────────────┬──────────────────┘
                        ³
                  covered? ──no──► ┌────────────────────────┐
                        ³          ³  LLM SYNTHESIS         ³
                       yes         ³  decision + file list  ³
                        ³          ³  → proposed guard set  ³
                        ³          ³  generatedBy: llm      ³
                        ³          ³  REQUIRES REVIEW       ³
                        ³          └───────────┬────────────┘
                        ▼                      ▼
                 ┌────────────────────────────────┐
                 ³  HUMAN REVIEW — guards are     ³
                 ³  proposed, never silent        ³
                 └───────────────┬────────────────┘
                                 ▼
                     accepted guards attached to the decision
```

**Two rules that keep this honest.**

1. **Guards are proposed, never auto-installed.** A synthesised guard that fails on day one is worse than no guard, because it teaches the user to ignore the panel. Every generated guard enters a review state until accepted.
2. **A decision with no synthesizable guard is marked `unverifiable`, not silently skipped.** The literature's own test — *"Can I describe what a violation looks like?"* — becomes a visible property of the log. Unverifiable decisions are exactly the ones most likely to drift, so hiding them is the worst option.

**Template output must include a `rationale` for every guard**, phrased as *"why this check verifies that decision"* — e.g. *"WLD-0007 rejected Postgres; no pg driver should appear."*

**Acceptance criteria.** The fixture's five decisions each yield 1–3 proposed guards; at least 80% come from templates rather than the LLM; every guard has a rationale.

---

### 4.3 — The in-browser guard interpreter

**Goal.** Run the six deterministic kinds against a **virtual project**, with no shell and no network.

**Input.** The user pastes a `package.json` and/or a file listing (`tree`, `git ls-files`, `find . -type f`). WhyLog builds an in-memory virtual project:

```
   pasted package.json ──► { dependencies, devDependencies }
   pasted file listing ──► [ "src/db/schema.ts", "package.json", … ]
   pasted file contents ─► { path → text }        (optional, for string guards)
```

**Evaluation.** Each guard kind maps to a pure function over that structure. String guards use word-boundary matching by default — `"pg"` must not match `pgp`, `pgsql-tools`, or a comment.

**Why this is the right default and not a compromise.** It is real evaluation of real logic against real data. It needs no shell, no filesystem access and no network; it works inside a sandboxed preview; and it makes the compliance score demonstrable in ten seconds. The only thing missing is automatic file discovery — a v2 concern (repo connection), not a correctness concern.

**Acceptance criteria.** A pasted `package.json` containing `pg` fails `dependency_absent: pg` with an evidence string quoting the exact line.

---

### 4.4 — Compliance & health metrics

**Goal.** Turn drift into numbers.

```
                      ä | IN decisions whose guards all pass |
   compliance  =  ─────────────────────────────────────────────
                  ä | IN decisions with ≥1 accepted guard      |
```

| Metric | Definition | Why it matters |
|---|---|---|
| **Decision Compliance** | above | The headline. *"Your codebase has quietly stopped believing 3 of your 12 decisions."* |
| **Verifiable Coverage** | IN decisions with ≥1 accepted guard ÷ all IN decisions | Low coverage = most of the log is unfalsifiable prose |
| **Log Soundness** | IN decisions ÷ all non-superseded decisions | The truth-maintenance counterpart: how much of what you believe is still supported |
| **Drift Age** | Days since a failing guard was first observed | A failure ignored for 30 days is a decision you no longer hold |
| **Deterministic Ratio** | Deterministic guards ÷ all guards | How much of your verification is trustworthy without a model |

**Baseline pattern — borrowed from fitness-function practice.** A legacy codebase will fail many guards on first run. **Do not make that a wall of red.** Freeze the initial state as a baseline, fail only on *new* violations, and let the user shrink the baseline deliberately. The literature's phrasing: *"Never write fitness functions for the codebase you want — write them for the one you have… The function is a lock, not a goal."*

**Ratchet.** Once a decision's guards pass, mark them enforced. Quality never decreases.

**Acceptance criteria.** All five metrics compute from the materialised graph; the baseline freezes on first run; only new violations are surfaced as failures.

---

### 4.5 — Guards as evidence ★

**Goal.** Feed guard results back into Phase 2. This is what makes guards part of the reasoning core rather than a linting sidebar.

```
   GUARD RUN
      ³
      ├── PASS ──► corroboration +1 for the decision
      ³            implementation_cost ↑  ──► entrenchment E(d)
      ³
      └── FAIL ──► emit GuardFailed event
                        ³
                        ▼
                 REVISE() STEP 1  ◄── same entry point as a transcript
                        ³
                        ▼
          does this falsify a premise the decision rests on?
                   ³                ³
                  yes               no
                   ³                ³
                   ▼                ▼
            GATE (c) fires     GATE (a) fires
            premise            structural drift:
            invalidation       the code disagrees with
            → cascade          the decision directly
                               → reversal proposal
```

**Three consequences, each worth a headline:**

1. **`implementation_cost` becomes a measurement, not a guess.** A decision with three passing guards is expensive to retract, and the system can now say so *with evidence*. This is the term no belief-revision system has, because none is attached to a codebase.
2. **Drift is detected with no semantic model at all.** Gate (a) plus a failing guard is a fully deterministic contradiction detector — the strongest possible answer to "is this an LLM wrapper?"
3. **The compliance score is a truth-maintenance input**, not just a dashboard number.

**Acceptance criteria.** A failing guard produces a revision proposal through the same code path as a transcript, with the guard's evidence string quoted as the falsifying evidence.

---

### 4.6 — CI export

**Goal.** Emit a standalone script and workflow so guards run where the code lives.

Outputs: a Node or shell runner over the guard set · a GitHub Actions workflow triggered on push and PR · non-zero exit on `blocking` failures · advisory output for `warning` failures.

**The failure message is the product.** Not *"guard G-0007b failed"* but:

```
   ✗ WLD-0007 — Use SQLite, not Postgres
     Guard G-0007b (dependency_absent: pg) FAILED
     Evidence: "pg": "^8.11.3" found in package.json dependencies
     Decided: 2026-10-03 · Rests on: P-0002 single-user (IN), P-0005 no-deploy-infra (IN)
     Rejected alternative Postgres — reason: "deploy complexity"

     → Is this a deliberate reversal?   whylog reverse WLD-0007 --to postgres
     → Or is this drift?                remove the dependency.
```

That message does the job of an ADR, a code-review comment and an onboarding document, at the exact moment it is useful.

**Acceptance criteria.** The exported runner executes the same guard set with the same results as the in-browser interpreter.

---

### 4.7 — Guard review UI

**Goal.** Let the user accept, edit, suppress or delete proposed guards.

States: `proposed` → `accepted` → (`suppressed` | `deleted`). Suppression requires a reason and writes an event. Guards inherit their decision's label: **`SUPERSEDED` or `OUT` decisions have their guards auto-disabled**, and re-enabling requires the decision to return to `IN`.

**Cap:** three guards per decision by default, ranked by determinism. Passing guards collapse into a single count so the panel doesn't become noise.

**Acceptance criteria.** No guard runs until accepted; suppressed guards show their reason; guards on non-IN decisions are visibly disabled.

---

## Diagrams

### D4.1 — The verification loop

```
   ┌──────────────┐     synthesise     ┌──────────────┐
   ³   DECISION   ³ ─────────────────► ³    GUARDS    ³
   ³  WLD-0007    ³                    ³  G-0007a…d   ³
   └──────┬───────┘                    └──────┬───────┘
          ³                                   ³ run against
          ³                                   ▼
          ³                           ┌──────────────┐
          ³                           ³   PROJECT    ³  package.json,
          ³                           ³  (real or    ³  file listing,
          ³                           ³   virtual)   ³  file contents
          ³                           └──────┬───────┘
          ³                                  ³
          ³                     ┌────────────┴────────────┐
          ³                     ▼                         ▼
          ³                 PASS                      FAIL
          ³                     ³                         ³
          ³     corroboration +1³                         ³ GuardFailed event
          ³     implementation  ³                         ³
          ³     _cost ↑         ³                         ³
          ³                     ³                         ▼
          ³                     ³                 ┌───────────────┐
          ³                     └────────────────►³   REVISE()    ³
          ³                            evidence   ³  Phase 2      ³
          ³                                       └───────┬───────┘
          ³                                               ³
          ³            ┌──────────────────────────────────┤
          ³            ▼                                  ▼
          ³   entrenchment updated              revision proposal
          ³                                     "your code disagrees
          ³                                      with your decision"
          └────────────────────────────────────────────────┘
```

### D4.2 — Compliance dashboard

```
   DECISION COMPLIANCE          ██████████░░  83%      10 / 12
   VERIFIABLE COVERAGE          ████████░░░░  67%       8 / 12
   LOG SOUNDNESS                ███████████░  92%      11 / 12
   DETERMINISTIC RATIO          ████████████ 100%      24 / 24
   DRIFT AGE (worst)            4 days · WLD-0009

   FAILING
   ┌────────────────────────────────────────────────────────────┐
   ³ ✗ WLD-0009  Use Vite, not Next.js                          ³
   ³   G-0009b  dependency_absent: next                         ³
   ³   Evidence: "next": "^15.1.0" in devDependencies           ³
   ³   First failed 4 days ago · blocking                       ³
   ³   [ Reverse decision ]  [ Suppress ]  [ It's drift ]       ³
   └────────────────────────────────────────────────────────────┘

   UNVERIFIABLE  (4 decisions — no guard could be synthesised)
     WLD-0003 · WLD-0006 · WLD-0010 · WLD-0012        [ review ]
```

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Guards fail on day one → wall of red → feature ignored | 🟠 | Review gate before activation; **baseline pattern** freezing initial failures; ratchet thereafter |
| False-positive drift from over-broad patterns (`pg` matching `pgp`) | 🟠 | Word-boundary matching by default; glob scoping; `warning` severity for string guards, `blocking` only for dependency and path guards |
| Guard sprawl — 4 guards × 40 decisions = noise | 🟡 | Cap at 3 per decision, ranked by determinism; collapse passing guards into a count |
| Unverifiable decisions hidden from view | 🟠 | Explicit `unverifiable` state plus the Verifiable Coverage metric. Silence is never the answer |
| Guards keep running for superseded decisions | 🟡 | Guards inherit the decision label; auto-disabled on `OUT`/`SUPERSEDED` |
| `llm_judge` results laundered into the compliance number | 🟠 | Score deterministic and judged guards **separately**. Compliance is deterministic-only; judged verdicts are advisory |
| Verify command drifts from the guard set | 🟡 | Both compiled from the same materialised graph in one pass; exports carry the head hash |
| No filesystem in the demo environment | 🟡 | Virtual project from pasted input is the designed default, not a fallback |

---

## Definition of done

- [ ] Eight guard kinds specified; six evaluate deterministically in-browser
- [ ] Template-based synthesis covering ≥80% of fixture decisions; LLM synthesis for the remainder, marked as requiring review
- [ ] Every guard carries a rationale and a severity
- [ ] Virtual project built from pasted `package.json` / file listing / file contents
- [ ] Word-boundary string matching; glob scoping
- [ ] All five health metrics computing, with the baseline pattern and ratchet
- [ ] **Guard results enter `REVISE()` as evidence and feed `implementation_cost`**
- [ ] CI runner + workflow export with the rich failure message
- [ ] Guard review UI with accept / edit / suppress / delete and label inheritance
- [ ] **Gate G4 passes**: pasting a `package.json` containing `pg` drops compliance and fires a structural contradiction **with no model involved**
