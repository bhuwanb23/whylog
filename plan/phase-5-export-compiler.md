# Phase 5 — Agent-Native Export Compiler

| | |
|---|---|
| **Layer** | L4 — Synthesis |
| **Depends on** | Phase 2 (labels, soundness, supersession) · Phase 4 (guards, verify commands, compliance) |
| **Blocks** | Gate G5 |
| **Estimate** | 4 h |
| **Research** | [docs/01 §4.5](../docs/01-prior-art-landscape.md) (the agent-optimized ADR specification) · [docs/04 §5.3](../docs/04-executable-decision-guards.md) |
| **Gate** | **G5 — It closes the loop**: the export carries the reasoning *and* the check |

**Objective in one sentence:** compile the materialised decision graph into every format an agent actually reads, in the agent-optimized form — scoped, imperative, addressable, verifiable, non-conflicting, token-budgeted — and stamp it so tampering is detectable.

**Framing note.** Multi-format export is **not novel** — `ai-memory rules --target agents-md` ships it, and `AGENTS.md` is used in more than 60,000 projects. What is novel is the **format's content**: nobody emits verify commands generated from the decision, nobody refuses to export a log that contradicts itself, and nobody stamps the artifact so you can tell whether an agent rewrote it.

---

## Sub-phases

### 5.1 — The compiler

**Goal.** One graph in, many artifacts out, in a single pass.

```
   MATERIALISED GRAPH  (Phase 0.2)
   decisions · labels · premises · alternatives · guards · compliance
        │
        ▼
   ┌─────────────────────────┐
   │  CANONICAL INTERMEDIATE │  one normalised representation,
   │  FORM (CIF)             │  engine- and target-agnostic
   └────────────┬────────────┘
                │
     ┌──────────┼──────────┬──────────┬──────────┐
     ▼          ▼          ▼          ▼          ▼
  CLAUDE.md  AGENTS.md  .cursorrules DECISIONS.md  CI runner
                                    (human ADR)   + workflow
     │          │          │          │          │
     └──────────┴──────────┴──────────┴──────────┘
                │
                ▼
        INTEGRITY STAMP  (head hash · counts · compliance · timestamp)
```

**Why the intermediate form matters.** [actual.ai](https://actual.ai/blog/agent-optimized-adrs) states the principle: *"Stay agent-agnostic: write the decision once, **compile** it into whatever each tool reads… changing a decision in one place updates every agent's context with it."* The ADR set is the **system of record**; `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` are **delivery formats**. Implementing that literally — one CIF, N emitters — is what prevents the five formats from drifting apart.

**Single-pass rule.** Guards, verify commands and the stamp are all derived from the same materialised graph in the same pass, so an export can never carry a verify command that disagrees with its guard set.

**Acceptance criteria.** All five artifacts compile from one graph in one pass; changing a decision updates every artifact consistently.

---

### 5.2 — Target formats

| Target | Reader | Conventions |
|---|---|---|
| **`CLAUDE.md`** | Claude Code, read at the start of every session | Anthropic's guidance: keep under ~200 lines, because *"longer files consume more context and reduce adherence"* |
| **`AGENTS.md`** | Cross-agent standard — "a README for agents", 60,000+ projects | Broadest compatibility; the default recommendation |
| **`.cursorrules` / `.cursor/rules/*.md`** | Cursor | Per-rule files with `applies_to` globs where supported |
| **`DECISIONS.md`** | Humans | Full ADR form: context, decision, consequences, alternatives, related |
| **CI runner + workflow** | GitHub Actions | Phase 4.6 output, emitted alongside |

**Emit-all-at-once** is the default, with per-target toggles. A builder switching editors should not have to re-export.

**Acceptance criteria.** Each target renders correctly for its reader; the human-facing `DECISIONS.md` carries narrative the agent files omit.

---

### 5.3 — The agent-optimized record

**Goal.** Emit each decision in the form [actual.ai](https://actual.ai/blog/agent-optimized-adrs) specifies for machine readers, not human ones.

Their six requirements, and how each is satisfied:

| Requirement | WhyLog source |
|---|---|
| **Scoped to file globs** (`applies_to`) | Phase 1 extraction + guard globs. *"An agent editing a stylesheet has no use for the ADR that governs your database schema, so loading it only burns context."* |
| **Imperative, not prose** — MUST / MUST NOT | Compiled from `variable`, `value` and rejected alternatives. *"Normative keywords an agent can follow beat a paragraph it has to summarize first."* |
| **Verifiable** — a check, grep, lint rule or command | **Phase 4 guards → verify command.** This is the requirement nobody else can satisfy automatically |
| **Token-aware** — under ~200 lines | Priority-ranked emission with link-out (5.4) |
| **Non-conflicting** | **Phase 2 guarantees it**, enforced by a pre-export check (5.6). *"If two rules contradict each other, the model may pick one arbitrarily."* |
| **Addressable** — stable IDs | `WLD-0007`, never renumbered, never reused |

**Emitted record:**

```markdown
### WLD-0007 — MUST use SQLite (better-sqlite3). MUST NOT introduce Postgres.
Applies to: src/db/**, package.json
Because: single user (P-0002), no deploy infrastructure (P-0005)
Rejected: Postgres — "deploy complexity" · Supabase — "hosted dependency"
Verify: node -e "const p=require('./package.json').dependencies||{};
        process.exit(p['better-sqlite3'] && !p['pg'] ? 0 : 1)"
Status: IN · sound · guards 2/2 passing · last verified 2026-10-21
Do not re-litigate without superseding this record.
```

**Two lines worth calling out.** The `Because:` line carries **premise IDs**, not prose — so an agent that reads the file can see *what would have to change* for the rule to stop applying. And the closing line is the anti-re-litigation instruction that makes the whole exercise pay off.

**Also emit a "Rejected alternatives — do not re-propose" section.** This is the highest-value block in the file and the one no competitor emits, because none of them index alternatives first-class:

```markdown
## Rejected — do not re-propose without superseding the record
- **Postgres** (WLD-0007) — deploy complexity; premise P-0005 no-deploy-infra still IN
- **Supabase** (WLD-0007) — hosted dependency; premise P-0004 budget=none still IN
- **Next.js** (WLD-0003) — no SSR or API routes needed; premise P-0008 scope=hackathon CONTESTED
```

Note the third entry: a contested premise is **surfaced in the export**, so the agent knows that particular rejection is under review.

**Acceptance criteria.** Every emitted record has all six properties; rejected alternatives appear with their premise status; nothing is emitted for `SUPERSEDED` decisions except in `DECISIONS.md`.

---

### 5.4 — Token budgeting

**Goal.** Stay inside the reader's attention budget.

Anthropic's guidance is ~200 lines per context file. Emitting every decision in full blows that immediately on a mature log.

**Priority function for inclusion:**

```
   priority(d) =  0.35 · soundness         IN > UNKNOWN > OUT (OUT excluded by default)
                + 0.25 · entrenchment      strongly held decisions first
                + 0.20 · scope breadth     decisions applying to many files first
                + 0.15 · guard severity    blocking guards before warning
                + 0.05 · recency
```

**Two-tier emission.**
- **Tier 1 (inline):** top-N decisions by priority, full record form, N chosen so the file stays under budget.
- **Tier 2 (link-out):** the remainder as a one-line index — `WLD-0014 · MUST use zustand · src/state/** · see DECISIONS.md` — so the agent knows the decision exists and where to read it.

**Excluded by default:** `SUPERSEDED` and `OUT` decisions. Include them only under an explicit toggle, because a file containing a reversed rule alongside its replacement is exactly the *"model may pick one arbitrarily"* failure.

**Budget is displayed live** in the export view: line count, estimated tokens, and what fell into tier 2.

**Acceptance criteria.** A 40-decision log exports under 200 lines with the highest-priority decisions inline; the budget indicator is accurate; superseded decisions are excluded by default.

---

### 5.5 — Integrity stamping

**Goal.** Make every artifact verifiable against the log that produced it.

Each export carries a footer:

```markdown
---
Generated by WhyLog · 2026-10-21T14:32:07+05:30
Log head: a3f91c7e2b…    Decisions: 14 (IN 11 · OUT 1 · superseded 2)
Premises: 23 (IN 19 · OUT 3 · contested 1)
Compliance: 83% · Verifiable coverage: 67% · Guards: 24 passing / 4 failing
Schema: whylog/v1 · Engine at generation: local
```

**Why, given this is not a security product.** You are handing this file to an agent that can rewrite files. The requirement is **auditability**, not cryptography: being able to say "this artifact corresponds to log head `a3f91c…`" and later detect that it no longer does.

**Verification points.**
- On re-import of an exported artifact: compare its stamped head against the local head.
- On a manual "check my files" action: read the repo's `CLAUDE.md`, extract its stamp, compare. Mismatch → `ExportIntegrityMismatch` event and a visible warning.

**Acceptance criteria.** Every artifact carries a stamp; a modified artifact is detected and reported rather than silently trusted.

---

### 5.6 — Pre-export consistency check

**Goal.** Refuse to emit a self-contradictory file.

Before compilation, run a full consistency pass over the decisions being exported:

```
   ┌─────────────────────────────────────────────┐
   │  any two exported decisions in conflict?    │──yes──► BLOCK
   │  any exported decision labelled OUT?        │──yes──► WARN + exclude
   │  any contested premise in an emitted        │──yes──► ANNOTATE
   │    "Because:" line?                         │         ("premise contested")
   │  any failing guard on an emitted decision?  │──yes──► ANNOTATE
   │                                             │         ("verify currently fails")
   └─────────────────────────────────────────────┘
                        │
                        ▼
                    COMPILE
```

**Rationale, in actual.ai's words:** *"A human reconciles contradictions on the fly. An agent needs them reconciled in advance."* This check is the **only** place in the whole product where the truth-maintenance layer directly prevents a bad outcome in the agent's context window — and it is worth saying so on stage, because it makes the two pillars visibly interlock.

A blocked export shows the conflicting pair, the nogood, and a link to the revision proposal. **Never silently drop one side.**

**Acceptance criteria.** An export containing two conflicting decisions is blocked with an explanation; failing guards and contested premises are annotated inline rather than hidden.

---

### 5.7 — Round-trip re-import

**Goal.** Let an exported file be a portable log.

`DECISIONS.md` and the JSON event export are both re-importable. On import:
1. Verify the integrity stamp.
2. Run entity resolution against existing nodes (Phase 0.4 ladder).
3. Merge as `refinement` where the content matches; propose as new where it doesn't.
4. Record `LogImported` with the source stamp.

**Why it matters.** It makes the log portable between machines and between teammates without a server, and it means the export is not a dead end — it's a serialization format.

**Acceptance criteria.** Export → import on a clean log reproduces the same decisions with the same IDs; import onto an existing log merges rather than duplicates.

---

## Diagrams

### D5.1 — The compilation chain

```
   graph ──► CIF ──► priority rank ──► budget split ──► emitters ──► stamp
              │                          │                │
              │                          │                ├── CLAUDE.md
              │                          │                ├── AGENTS.md
              │                          │                ├── .cursorrules
              │                          │                ├── DECISIONS.md
              │                          │                └── ci/guards.mjs + workflow
              │                          │
              │                          └─ tier 1 inline / tier 2 index
              │
              └─ consistency gate (5.6) — BLOCKS before any of the above
```

### D5.2 — What the agent receives

```
   ┌──────────────────────── CLAUDE.md ────────────────────────┐
   │                                                           │
   │  ## Active decisions (11)                                 │
   │                                                           │
   │  ### WLD-0007 — MUST use SQLite. MUST NOT introduce       │
   │                   Postgres.                               │
   │  Applies to: src/db/**, package.json                      │
   │  Because: single user (P-0002), no deploy infra (P-0005)  │
   │  Rejected: Postgres — deploy complexity                   │
   │  Verify: node -e "…"                                      │
   │  Status: IN · sound · guards 2/2 passing                  │
   │                                                           │
   │  … 10 more …                                              │
   │                                                           │
   │  ## Rejected — do not re-propose                          │
   │  - Postgres (WLD-0007) — deploy complexity                │
   │  - Supabase (WLD-0007) — hosted dependency                │
   │  - Next.js  (WLD-0003) — premise CONTESTED                │
   │                                                           │
   │  ## Index (23 further decisions)                          │
   │  WLD-0014 · MUST use zustand · src/state/**               │
   │  …                                                        │
   │                                                           │
   │  --- stamp ---                                            │
   └───────────────────────────────────────────────────────────┘
             │
             ▼
   the agent reads a rule, sees WHY it holds,
   can RUN the check, and knows what was already rejected
```

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Export exceeds the token budget and adherence drops | 🟠 | Priority ranking + two-tier emission + live budget indicator |
| Conflicting rules emitted → the model picks arbitrarily | 🔴 | Pre-export consistency gate blocks; never silently drops one side |
| Verify command disagrees with the guard | 🟡 | Single-pass compilation from one graph |
| Superseded rules leak into agent files | 🟠 | Excluded by default; `DECISIONS.md` only |
| Five formats drift apart | 🟡 | One canonical intermediate form; emitters are pure functions of it |
| Stamp treated as security | 🟡 | Described as auditability, never as tamper-proofing |
| "This is just Markdown generation" | 🟠 | True, and not the point — the novelty is verify commands, the consistency gate and the rejected-alternative block. Lead with those |

---

## Definition of done

- [ ] Canonical intermediate form; five emitters as pure functions of it
- [ ] All six agent-optimized properties present on every emitted record
- [ ] **Verify commands generated from Phase 4 guards**
- [ ] **Rejected-alternatives block with premise status, including contested annotation**
- [ ] Priority-ranked, two-tier, budget-aware emission with a live indicator
- [ ] Integrity stamp on every artifact; mismatch detection on re-import
- [ ] **Pre-export consistency gate that blocks on conflict and annotates on failing guards**
- [ ] Round-trip export → import reproducing identical decisions and IDs
- [ ] **Gate G5 passes**: the generated `CLAUDE.md` shows WLD-0007 with MUST/MUST NOT, `applies_to`, rejected alternatives, a runnable verify command, status, and a stamp
