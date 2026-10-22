# 04 — Executable Decision Guards
### Turning "we decided X" into a check that fails when the code stops believing X

**Purpose:** specify the second novel pillar. Implements [plan/phase-4](../plan/phase-4-executable-guards.md).

---

## 1. The gap in the literature

**Architectural fitness functions** (Ford, Parsons, Kua & Sadalage, *Building Evolutionary Architectures*) are automated checks that verify a system still satisfies an architectural property. They are the executable counterpart to a decision record, and the literature is emphatic that the two belong together:

> *"Every important architectural decision should have a corresponding fitness function. Without one, decisions degrade silently as the system evolves."*

Richards & Ford go further and recommend adding a **Compliance section to each ADR**, specifying whether the decision can be verified by an automated fitness function and, if so, how.

Operational guidance says the same thing:

> *"Every ADR that isn't explicitly deprecated or superseded should map to at least one fitness function. That is the operationalizing step. The ADR is not the enforcement mechanism; it is the source material for one."*

And the sharpest formulation:

> *"Where ADRs **document** a decision, fitness functions **enforce** it."*

### So what is actually missing?

**The mapping is always handwritten.** Every workflow in the literature has a human authoring the check:

- ArchUnit / ArchUnit.NET / ts-arch / dependency-cruiser / import-linter — a human writes the rule in a fluent API.
- `adr-staleness-check` — a human maintains an **implementation map** linking each ADR to the files that implement it; the tool then checks the map for drift (M3: superseded ADR still anchored; M4: accepted ADR with zero implementation evidence).
- The ADR-fitness CI job in the Codex CLI workflow — a human writes a prompt, and an **LLM judges** the diff against the ADRs.
- **Agentic fitness functions** (InfoQ, Aug 2026) — explicitly names *"stale ADR assumptions"* as a governance target, and solves it with *"a calibrated AI agent, whose criteria are expressed as an analytic rubric, and whose output is a structured verdict with evidence, confidence, and rationale."* Their own caveat: *"It is not an oracle. It is not a replacement for deterministic checks."* A human still authors the rubric, per ADR.

**Nobody generates the check from the decision.** And the reason is that nobody has the decision in a structured enough form to generate from — prose ADRs don't carry `variable`, `value`, `rejected alternatives`, and `applies_to` as typed fields.

WhyLog does. Extraction already produced them. **The guard compiler is therefore nearly free**, and it is the step that closes a loop the literature has been describing for a decade.

---

## 2. What a guard is

> A **guard** is a machine-checkable assertion synthesised from a decision, which fails when the observable state of the project stops matching what the decision claims.

Three properties distinguish a guard from a test:

| | Unit test | Fitness function | **Guard** |
|---|---|---|---|
| Asserts | Behaviour | Architectural property | **That a decision is still true in the code** |
| Authored by | Developer | Developer | **Synthesised from the decision record** |
| Failure message | "expected 4, got 5" | "layer violation at X" | **"WLD-0007 chose SQLite; `pg` appeared in dependencies. Is the decision reversed, or is this drift?"** |
| Feeds back into | Test suite | CI gate | **The truth-maintenance layer** — a failed guard is *evidence*, and evidence can invalidate a premise |

That last row is the architectural point. A guard is not a linter bolted onto the side. It is a **sensor** whose readings enter the same `REVISE()` cycle as a transcript does.

---

## 3. Guard taxonomy

Eight kinds, ordered from most deterministic to least. The first six need no model and no shell.

| Kind | Asserts | Inputs | Determinism | Runs in browser |
|---|---|---|---|---|
| `dependency_present` | A package **is** in the dependency tree | package name, manifest | Total | ✅ |
| `dependency_absent` | A package **is not** present (typically a rejected alternative) | package name, manifest | Total | ✅ |
| `path_glob_exists` | Files matching a glob **do** exist | glob | Total | ✅ |
| `path_glob_absent` | No files match a glob | glob | Total | ✅ |
| `string_in_files` | A pattern **appears** within a glob | pattern, glob | Total | ✅ |
| `string_absent_in_files` | A pattern **does not appear** within a glob | pattern, glob | Total | ✅ |
| `command_exit_zero` | An arbitrary command succeeds | shell command | Environment-dependent | ❌ export only |
| `llm_judge` | A rubric verdict over a diff or file set | rubric, scope | Non-deterministic | ⚠️ key required |

**Design rule: prefer the highest-determinism guard that expresses the decision.** `llm_judge` is the last resort, not the default — and the ratio of deterministic guards to judged guards is itself a useful health metric for the log.

### 3.1 Guard record

| Field | Meaning |
|---|---|
| `id` | Stable, addressable — `G-0007a` |
| `decisionId` | The decision it verifies |
| `kind` | One of the eight above |
| `spec` | Kind-specific parameters |
| `rationale` | Human-readable: **why** this check verifies that decision. Non-optional — a guard without a stated rationale is indistinguishable from a lint rule |
| `generatedBy` | `template` \| `llm` \| `user` — provenance, so a bad guard is traceable to its origin |
| `severity` | `blocking` \| `warning` — mirrors the fitness-function distinction between failing the build and flagging drift |
| `lastRun` | Timestamp, result (`pass`/`fail`/`skip`), and the **evidence string** that produced it |
| `suppressed` | Whether the user has explicitly accepted this failure (with a reason) |

---

## 4. Synthesis

```
        DECISION (from extraction)
        variable: DATABASE
        value:    sqlite
        rejected: [postgres, supabase]
        applies:  src/db/**, package.json
                    │
                    ▼
        ┌──────────────────────────────┐
        │   TEMPLATE RULES per variable │  ← deterministic, covers ~80%
        │   DATABASE → driver present/  │
        │              absent checks    │
        │   FRAMEWORK → build config +  │
        │              dependency       │
        │   HOSTING  → config file +    │
        │              deploy manifest  │
        │   AUTH     → middleware/lib   │
        └──────────────────────────────┘
                    │
              covered? ──no──► ┌───────────────────────┐
                    │          │  LLM SYNTHESIS        │
                   yes         │  decision + file list  │
                    │          │  → proposed guard set  │
                    │          │  (marked generatedBy:  │
                    │          │   llm, needs review)   │
                    │          └───────────────────────┘
                    ▼
        ┌──────────────────────────────┐
        │  HUMAN REVIEW — guards are    │
        │  proposed, never silent       │
        └──────────────────────────────┘
                    │
                    ▼
              guard set attached to the decision
```

**Two rules that keep this honest:**

1. **Guards are proposed, never auto-installed.** A synthesised guard that fails on day one is worse than no guard, because it teaches the user to ignore the panel. Every generated guard enters a review state until accepted.
2. **A decision with no synthesizable guard is marked `unverifiable`, not skipped silently.** The literature's own test — *"Can I describe what a violation looks like?"* — becomes a visible property of the log. **Verifiable coverage** (% of IN decisions with ≥1 accepted guard) is then a first-class health metric, and unverifiable decisions are exactly the ones most likely to drift.

### 4.1 Worked example

```
WLD-0007  "Use SQLite, not Postgres"
  variable: DATABASE · value: sqlite · rejected: [postgres, supabase]
  premises: P-0002 single-user (IN) · P-0005 no deploy infra (IN)
  applies_to: src/db/**, package.json

  ── synthesised guards ──────────────────────────────────────────────
  G-0007a  dependency_present       better-sqlite3          blocking
           rationale: "WLD-0007 chose SQLite; the driver must be present."
  G-0007b  dependency_absent        pg                      blocking
           rationale: "WLD-0007 rejected Postgres; no pg driver should appear."
  G-0007c  string_absent_in_files   "postgres://"  **/*     warning
           rationale: "No Postgres connection string while WLD-0007 is IN."
  G-0007d  path_glob_exists         src/db/schema.*         warning
           rationale: "The schema file the decision governs should exist."

  ── exported verify command (one line, agent-runnable) ──────────────
  node -e "const p=require('./package.json').dependencies||{};
           process.exit(p['better-sqlite3'] && !p['pg'] ? 0 : 1)"
```

---

## 5. Execution targets

Guards must run somewhere. Three targets, in increasing realism:

### 5.1 In-browser virtual project (the demo target)
The user pastes a `package.json` and/or a file listing (`tree`, `git ls-files`, or `find . -type f`). WhyLog builds an in-memory virtual project and evaluates all six deterministic kinds against it.

**This is the right default for a hackathon build and not a compromise:** it's real evaluation of real logic against real data, it needs no shell and no network, it works in a sandboxed preview, and it makes the compliance score demonstrable in ten seconds. The only thing missing is automatic file discovery — which is a v2 concern (repo connection), not a correctness concern.

### 5.2 Exported CI script
Emit a standalone Node or shell script plus a GitHub Actions workflow that runs the full guard set on push/PR, exits non-zero on `blocking` failures, and prints the decision id and rationale for each failure.

**The failure message is the product.** Not *"guard G-0007b failed"* but:

```
✗ WLD-0007 — Use SQLite, not Postgres
  Guard G-0007b (dependency_absent: pg) FAILED
  Evidence: "pg": "^8.11.3" found in package.json dependencies
  Decided: 2026-10-03 · Rests on: P-0002 single-user (IN), P-0005 no deploy infra (IN)
  Rejected alternative Postgres — reason: "deploy complexity"

  → Is this a deliberate reversal? Log it:  whylog reverse WLD-0007 --to postgres
  → Or is this drift? Remove the dependency.
```

That message does the job of an ADR, a code review comment, and an onboarding document, at the exact moment it is useful.

### 5.3 Agent-invoked verify
The exported `CLAUDE.md` / `AGENTS.md` / `.cursorrules` carries the verify command inline, per [actual.ai's agent-optimized format](https://actual.ai/blog/agent-optimized-adrs): *"Each decision ships with a check, a grep, a lint rule, a command, so the agent or CI can confirm compliance instead of just intending it."*

This closes a loop worth stating explicitly on stage: **the agent can check whether it is about to violate a decision before it violates it**, rather than being told a rule in prose and hoping it attends to it.

---

## 6. Guard results are evidence

This is where guards stop being a linting feature and become part of the reasoning core.

```
   GUARD RUN
      │
      ├── PASS ──► corroboration +1 for the decision
      │            implementation_cost ↑  (feeds entrenchment E(d))
      │
      └── FAIL ──► emit PremiseEvidence event
                        │
                        ▼
                   REVISE() STEP 1  ← same entry point as a transcript
                        │
                        ▼
              does this falsify a premise the decision rests on?
                   │                │
                  yes               no
                   │                │
                   ▼                ▼
            gate (c) fires     gate (a) fires
            premise-            structural drift:
            invalidation        the code disagrees with
            → cascade           the decision directly
                                → reversal proposal
```

**Consequences:**

1. **`implementation_cost` in the entrenchment formula becomes a measurement, not a guess** ([02](02-truth-maintenance-theory.md) §3.4). A decision with three passing guards is expensive to retract, and the system can now *say so with evidence*.
2. **Drift is detected without any semantic model at all.** Gate (a) plus a failing guard is a fully deterministic contradiction detector. This is the strongest possible answer to "is this just an LLM wrapper?"
3. **The compliance score is a truth-maintenance input**, not just a dashboard number.

---

## 7. Decision Compliance

```
                  Σ | IN decisions whose guards all pass |
   compliance  =  ─────────────────────────────────────────
                  Σ | IN decisions with ≥1 accepted guard  |
```

Reported alongside three companions:

| Metric | Definition | Why it matters |
|---|---|---|
| **Decision Compliance** | above | The headline. "Your codebase has quietly stopped believing 3 of your 12 decisions." |
| **Verifiable Coverage** | IN decisions with ≥1 accepted guard ≈ all IN decisions | Low coverage = most of your log is unfalsifiable prose |
| **Log Soundness** | IN decisions ≈ all non-superseded decisions | The truth-maintenance counterpart: how much of what you believe is still supported |
| **Drift Age** | days since a failing guard was first observed | A failure ignored for 30 days is a decision you no longer hold |

**The baseline pattern, borrowed from fitness-function practice:** a legacy codebase will fail many guards on first run. Do not make that a wall of red. Freeze the initial state as a **baseline**, fail only on *new* violations, and let the user shrink the baseline deliberately. The literature's phrasing: *"Never write fitness functions for the codebase you want — write them for the one you have… The function is a lock, not a goal."* And the **ratchet**: once a module is clean, add it to the enforced set; quality never decreases.

---

## 8. Failure modes

| Failure | Cause | Mitigation |
|---|---|---|
| Guard fails on day one | Synthesised from a decision the code never implemented | Review gate before activation; baseline pattern on first full run |
| False-positive drift | Guard too broad — `string_absent: "pg"` matches `pgp`, `pgsql-tools`, a comment | Word-boundary matching by default; glob scoping; severity `warning` for string guards, `blocking` only for dependency and path guards |
| Guard sprawl | Every decision generates four guards; the panel becomes noise | Cap at 3 per decision by default, ranked by determinism; collapse passing guards into a single count |
| Unverifiable decisions hidden | No guard could be synthesised, so nothing is shown | Explicit `unverifiable` state + Verifiable Coverage metric. Silence is never the answer |
| Guard contradicts a superseded decision | Decision was reversed, guard still active | Guards inherit the decision label: `SUPERSEDED` / `OUT` decisions have their guards auto-disabled, and re-enabling requires the decision to return to IN |
| LLM-judged guards treated as deterministic | `llm_judge` mixed into the compliance score | Score deterministic and judged guards **separately**. The compliance number is deterministic-only; judged verdicts appear as advisory |
| Verify command drifts from the guard | Export generated at a different time than the guard set | Both are compiled from the same materialised graph in one pass; export carries the head hash so staleness is detectable |
