# Phase 1 — Extraction Pipeline

| | |
|---|---|
| **Layer** | L1 — Extraction |
| **Depends on** | Phase 0 (event log, ontology, resolution ladder, engine seam) |
| **Blocks** | Phases 2, 3, 4, 5 |
| **Estimate** | 6 h |
| **Research** | [docs/05](../docs/05-rationale-mining-literature.md) (all of it — the precision numbers shape every sub-phase) · [docs/03 §4.4](../docs/03-retrieval-and-contradiction.md) (negation & modality) |
| **Gate** | **G1 — Walking skeleton**: a messy transcript becomes reviewed, structured, persisted decisions **with premises** |

**Objective in one sentence:** turn an unstructured human–AI transcript into decisions, **premises**, rejected alternatives and full provenance — reviewed by a human before any of it enters the log.

**Why this phase carries the most risk.** The entire concept rests on premise extraction. Decisions are extractable at published rates (~0.75 F1); *assumptions* are what RAAM needed an expert walkthrough to recover. If premises cannot be recovered from dialogue at usable precision, the truth-maintenance layer has nothing to maintain and the product collapses to a decision log — i.e. to `ai-memory`. **Sub-phase 1.4 should be prototyped and measured before any other phase is built.**

---

## The pipeline

```
  RAW TRANSCRIPT
        ³
        ▼
  ┌───────────────┐
  ³ 1.1 NORMALISE ³  speaker turns, timestamps, tool noise, code blocks, de-duplication
  └───────┬───────┘
          ▼
  ┌───────────────┐
  ³ 1.2 SEGMENT   ³  candidate spans — NOT one-sentence (see §1.2)
  └───────┬───────┘
          ▼
  ┌───────────────────────────────────────────────────────────────┐
  ³ 1.3 DECISION RECOVERY                                         ³
  ³     cue detection → variable/value → polarity → modality      ³
  ³     → rationale → Y-statement formation                       ³
  └───────┬───────────────────────────────────────────────────────┘
          ³                    ┌──────────────────────────────────┐
          ├───────────────────►³ 1.4 PREMISE RECOVERY  ★ THE CORE ³
          ³                    ³     closed set of 8 types         ³
          ³                    ³     typed predicates              ³
          ³                    └───────┬──────────────────────────┘
          ³                    ┌───────┴──────────────────────────┐
          ├───────────────────►³ 1.5 ALTERNATIVE RECOVERY         ³
          ³                    ³     hardest component (15.4%)     ³
          ³                    └───────┬──────────────────────────┘
          ³                    ┌───────┴──────────────────────────┐
          └───────────────────►³ 1.6 PROVENANCE                   ³
                               ³     snippet, span, origin, engine ³
                               └───────┬──────────────────────────┘
                                       ▼
                          ┌────────────────────────┐
                          ³ 1.7 ENTITY RESOLUTION  ³  merge onto existing nodes
                          └────────────┬───────────┘
                                       ▼
                          ┌────────────────────────┐
                          ³ 1.8 CONFIDENCE         ³  cue strength + slot + rationale
                          ³                        ³  + 3-run majority vote (LLM path)
                          └────────────┬───────────┘
                                       ▼
                          ┌────────────────────────┐
                          ³ 1.9 REVIEW GATE  ★     ³  human approves before commit
                          └────────────┬───────────┘
                                       ▼
                          ┌────────────────────────┐
                          ³ 1.10 COMMIT            ³  events appended, graph updated
                          └────────────────────────┘
```

---

## Sub-phases

### 1.1 — Transcript normalisation

**Goal.** Reduce every supported transcript shape to one canonical form without discarding the text needed for provenance.

**Supported inputs.** Claude Code terminal copy-paste · Cursor chat export · Copilot chat · Codex CLI · generic `User:`/`Assistant:` text · JSONL (import, not live capture) · plain prose pasted by hand.

**Operations.**
| Operation | Detail |
|---|---|
| Speaker turn detection | Role markers, `>` prefixes, name-colon patterns, indentation shifts. Every span must be attributable to `human` or `agent` — provenance (1.6) depends on it |
| Timestamp recovery | Use embedded timestamps where present; otherwise mark the transcript with a single `occurredAt` supplied by the user, or default to import time **flagged as uncertain** |
| Tool-call noise | Tool invocations, file diffs, stack traces and long outputs are **collapsed to placeholders** for extraction but **retained verbatim** for snippet resolution |
| Code blocks | Fenced blocks are extracted separately — they are evidence for guards (Phase 4), not decision text |
| Character-span preservation | Every transformation records an offset map back to the original characters. **Non-negotiable**: without it, citations cannot resolve to verbatim snippets and the evidence contract collapses |
| Length chunking | Chunk at ~12k characters on speaker-turn boundaries, never mid-sentence. Overlap one turn to avoid splitting a negotiated decision |

**Acceptance criteria.**
- Any extracted snippet can be resolved to an exact character range in the raw input.
- A transcript with no detectable speaker markers still segments sensibly.
- Chunk boundaries never fall inside a turn.

---

### 1.2 — Segmentation

**Goal.** Produce candidate spans for decision analysis.

**Critical deviation from the literature.** [arXiv:2506.11005](https://arxiv.org/abs/2506.11005) assumes *"rationale appears in a single sentence containing both a decision and its rationale."* That holds for Linux commit messages. **It does not hold for dialogue**, where a decision is negotiated across turns:

```
   agent:  "Postgres via Supabase would work, but it means a hosted dependency…"
   human:  "none really. it's one person, one machine, one log."     ← PREMISE
   agent:  "Then I'd use SQLite with better-sqlite3 instead…"        ← PROPOSAL
   human:  "yeah ok. going with SQLite, not Postgres. single-user    ← DECISION
            and no deploy hassle is the whole argument."             ← RATIONALE
```

Four turns, one decision, and the premise appears **before** the decision it supports.

**Policy.** Segment on **decision episodes**, not sentences: a window of consecutive turns bounded by topic shift, containing at least one decision cue. Extract at episode granularity, then attribute individual snippets within it.

**Acceptance criteria.**
- The fixture transcript's SQLite episode is recovered as one unit spanning all four turns above.
- Episode boundaries are recorded so the review UI can show context.

---

### 1.3 — Decision recovery

**Goal.** From an episode, produce a typed decision.

**Six components, in order:**

| # | Component | Method |
|---|---|---|
| 1 | **Cue detection** | Pattern inventory: `decided to`, `let's use`, `we'll go with`, `going with`, `switch(ing)? to`, `instead of`, `rather than`, `sticking with`, `dropp(ed\|ing)`, `no longer`, `skip(ping)?`, `avoid`, `ruled out`, `revert`, `for now`, `deal`, `ok we'll` |
| 2 | **Variable + value** | Match against the ontology's alias table (Phase 0.7). Unmatched values become `variable: OTHER` with a free-text slot |
| 3 | **Polarity** | Verb-pattern polarity: `switch to X` / `go with X` / `adopt X` = **+X**; `drop X` / `stop using X` / `revert X` = **−X**. Negation scope window ó6 tokens or to clause boundary |
| 4 | **Modality** | `asserted` · `proposed` · `hypothetical` · `reported`. **Only `asserted` creates an IN-labelled node.** "what if we used Redis?" and "you could consider Redis" must never become decisions — this single field prevents most extraction-driven false contradictions |
| 5 | **Rationale** | Trailing clause after `because`, `since`, `so that`, `to avoid`, `due to`, `as`, `the whole argument is` |
| 6 | **Statement formation** | Emit in **Y-statement** form: *"In the context of ⟨premises⟩, facing ⟨concern⟩, we decided for ⟨value⟩ to achieve ⟨quality⟩, accepting ⟨downside⟩."* Named slots are extractable, and the output is self-justifying in the export without prose bloat |

**Also capture:** an explicit `acceptedDownside` field. Nobody stores it, and it is precisely what a future you needs when the downside arrives.

**Acceptance criteria.**
- Fixture decisions 1–5 all recover with correct variable, value and polarity.
- Zero hypothetical or proposed statements become nodes.
- Every decision statement is a well-formed Y-statement or explicitly marked `partial`.

---

### 1.4 — Premise recovery ★ THE LOAD-BEARING SUB-PHASE

**Goal.** Recover the assumptions a decision rests on, as **typed, shared, predicate-bearing nodes**.

**Why this is the product.** Everything else in Phase 1 is commodity ([docs/01 §1.1](../docs/01-prior-art-landscape.md)). Premises are not. They are what makes gate (c) — premise invalidation — possible, and gate (c) is the case where *nothing contradicts you and the world just moved*.

**Method.**

```
   episode text
        ³
        ▼
   cue-phrase scan against the 8 premise types (Phase 0.7 table B)
        ³
        ▼
   typed candidate:  { type, predicate, value, text, evidenceSpan }
        ³
        ▼
   LINK to the decision(s) in the same episode:
        ³
        ├── positive support  → add to the decision's justification IN-list
        └── excluded condition → add to the OUT-list
                ("no concurrent writers" → OUT-list, non-monotonic)
        ³
        ▼
   RESOLVE against existing premise nodes (Phase 0.4 ladder)
        ³
        ▼
   SHARED NODE — one premise, many dependent decisions
```

**The OUT-list is the subtle part and must not be skipped.** "Use SQLite" is justified by `IN: [single-user, no-deploy-infra]` **and** `OUT: [needs-concurrent-writers]`. A justification with a non-empty OUT-list is Doyle's **non-monotonic justification** — and it is the only mechanism that detects invalidation when the user never states a contradiction. Extracting *excluded conditions* is as important as extracting *supporting conditions*.

Cue phrases for excluded conditions: `no`, `not`, `without`, `never`, `don't need`, `there's no`, `as long as we don't`, `assuming we won't`.

**Closed set discipline.** Exactly the 8 types from Phase 0.7. An unclassifiable assumption becomes `requirement` with a free-text predicate and is flagged low-confidence. **Do not add a ninth type casually** — RAAM's precision problem is unbounded assumption discovery, and the closed set is the mitigation.

**World-observable vs intent-based.** Each recovered premise inherits its type's flag (Phase 0.7 table B). This determines whether a guard can falsify it (Phase 4) or whether only a human can retract it (Phase 2).

**Acceptance criteria.**
- The fixture yields `P-0002 scale.max_users = 1` from *"it's one person, one machine, one log"*, linked to WLD-0007's IN-list.
- The fixture yields an **OUT-list premise** for concurrent writers on the same decision.
- Premises recovered from *different* episodes with the same predicate resolve to **one shared node** with corroboration 2.
- Premise precision and recall are **measured against the hand-labelled fixture corpus** (Phase 7.1) before any public claim is made about them.

---

### 1.5 — Rejected-alternative recovery

**Goal.** Recover what was turned down, and why.

**Why it deserves its own sub-phase.** ARGUS measured **15.4% precision on Alternatives** with run-consistency α = 0.64 — the worst of any rationale component ([docs/05 §4](../docs/05-rationale-mining-literature.md)). It is also the highest-value component, because alternatives are what powers **pre-emption**: catching a mistake *before* the decision rather than after.

Their finding also argues in WhyLog's favour: *"Alternatives occur almost exclusively in issues, pull requests, and code reviews"* — i.e. in **discussion**. A transcript *is* continuous discussion, so it is the richest available source. That is a testable hypothesis, and Phase 7 should test it.

**Cue patterns.** `instead of X`, `rather than X`, `over X`, `not X`, `ruled out X`, `we could have X but`, `X would work but`, `before we go down the X route`.

**Structure.** Each alternative carries `{ value, variable, whyRejected, snippet, confidence }`. An alternative with no `whyRejected` is stored but **excluded from the pre-emption index** — pre-empting without a reason is just nagging.

**Stricter review tier.** Alternatives default to collapsed in the review UI and require explicit confirmation before entering the pre-emption index. A false pre-emption (*"you rejected Supabase"* when you didn't) is worse than no pre-emption at all.

**Acceptance criteria.**
- Fixture decision 1 recovers `[postgres (deploy complexity), supabase (hosted dependency)]`.
- No alternative enters the pre-emption index without user confirmation.
- Alternative precision is measured separately from decision precision in Phase 7.

---

### 1.6 — Provenance capture

**Goal.** Every extracted item is traceable to a verbatim span, an origin, and an engine.

| Field | Values / purpose |
|---|---|
| `snippet` | **Verbatim** transcript text. The LLM path must be instructed explicitly to copy, not paraphrase — paraphrased snippets rot the evidence contract silently |
| `charSpan` | `[start, end]` into the raw input, via the offset map from 1.1 |
| `transcriptId` | Which import it came from |
| `episodeId` | Which negotiation window |
| `origin` | `human_stated` · `agent_proposed_human_accepted` · `agent_inferred` · `human_override` |
| `extractedBy` | `llm` \| `local` — stored on the node, badged in the UI |
| `confidence` | From 1.8 |

**Origin classification method.** Use the speaker attribution from 1.1 plus the modality from 1.3:
- decision cue in a **human** turn → `human_stated` (authority 1.0)
- proposal in an **agent** turn followed by an accepting human turn (`yeah ok`, `deal`, `agreed`, `let's do that`) → `agent_proposed_human_accepted` (0.8)
- decision appears only in an agent turn with no human acceptance → `agent_inferred` (0.4)
- human turn reversing an agent proposal → `human_override` (0.9)

This directly produces the `source_authority` term of the entrenchment function ([docs/02 §3.4](../docs/02-truth-maintenance-theory.md)) **and** the agency ledger in Phase 6.4. It is why speaker attribution in 1.1 is non-negotiable.

**Acceptance criteria.**
- Every extracted item resolves to a verbatim span that highlights correctly in the UI.
- Origin is assigned for 100% of items; `agent_inferred` items are visually distinct.

---

### 1.7 — Entity resolution

**Goal.** Merge onto existing nodes rather than appending near-duplicates. Apply the Phase 0.4 ladder **before** any event is written.

**Why it sits here.** Resolution needs extraction output but must precede assertion. Skipping it is the most common failure in naive implementations: paste three transcripts from the same project and you get three copies of every decision, after which contradiction detection fires on your own duplicates and the user disables the feature.

**Merge semantics.**
- Decision merge → corroboration +1, evidence list extended, `learnedAt` updated, `validFrom` **unchanged** (the earliest wins).
- Premise merge → corroboration +1, evidence extended. A premise asserted in two separate sessions is materially stronger than one asserted once, and Phase 2's entrenchment must see that.
- Conflict on merge (same variable, different value) → **do not merge**; emit as a contradiction candidate into Phase 2.

**Acceptance criteria.**
- Importing the same transcript twice creates zero nodes.
- A restated decision in different wording merges and increments corroboration.
- A genuinely conflicting restatement becomes a contradiction candidate, not a merge.

---

### 1.8 — Confidence scoring & majority voting

**Goal.** Assign an honest confidence to every extracted item, and reduce run-to-run variance on the LLM path.

**Local-path scoring — additive and inspectable:**

| Component | Points |
|---|---|
| Strong decision cue present | +0.30 |
| Variable resolved to the ontology | +0.25 |
| Value resolved to a canonical alias | +0.15 |
| Rationale clause present | +0.15 |
| Modality is `asserted` | +0.10 |
| Human-stated origin | +0.05 |

Tiers: **≥0.75 high** (expanded, bulk-approvable) · **0.45–0.75 medium** (normal) · **<0.45 low** (collapsed).

Premises and alternatives score on their own rubrics and are **always one tier lower than the decision they attach to** — reflecting the published precision gap.

**LLM path — three-run majority voting.** ARGUS used exactly this because single-run consistency was imperfect (α 0.64–0.88). Extract three times at low temperature; keep components present in ≥2 runs at full confidence; components present in only 1 run are marked low-confidence and collapsed. Costs 3× tokens and buys a measurable precision gain. Make it a toggle so the demo can run at 1× when latency matters.

**Acceptance criteria.**
- Confidence tiers drive the review UI's default expansion state.
- Voting is toggleable and its effect is measurable in Phase 7.
- No item enters the log without a confidence value.

---

### 1.9 — The human review gate ★

**Goal.** Nothing enters the log unreviewed. Extraction is a *proposal*; the human is the *authority*.

**Why mandatory rather than optional.** Published precision is ~0.75 for decisions and ~0.15 for alternatives, with a **13:1 false-positive-to-false-negative ratio** (ARGUS: 155 FP vs 12 FN). Extraction **over-generates**. The review UI must therefore be optimised for **fast rejection**, not careful acceptance:

- High-confidence tier expanded, with a **bulk approve** action.
- Medium tier normal.
- Low tier **collapsed by default**, one-click discard.
- Alternatives in their own stricter section, off by default for the pre-emption index.
- Premises shown **attached to the decision they support**, with an inline edit and a type override.

**Review actions.** Approve · Edit (any field) · Discard · Merge-into-existing (manual override of 1.7) · Mark-contested. Every action writes an event with a reason.

**Diff presentation.** Side-by-side: raw transcript on the left with the source span highlighted, extracted structure on the right. Hovering a field highlights its snippet. **This is the single most trust-building screen in the product** and should be treated as a primary view, not a modal afterthought.

**Acceptance criteria.**
- Zero events of type `DecisionApproved` are written without a corresponding human action.
- The full fixture review can be completed in under 60 seconds with bulk approve.
- Every field is editable in place, and edits write `DecisionEdited` events preserving the original extraction.

---

### 1.10 — Commit to the log & the engine seam

**Goal.** Write events; keep both engines behind one interface.

**Commit sequence.**
```
  approved items
       ³
       ├─► PremiseAsserted        (premises first — decisions depend on them)
       ├─► DecisionProposed
       ├─► AlternativeRejected
       ├─► JustificationAttached  (IN-list, OUT-list, informant)
       └─► DecisionApproved
       ³
       ▼
  materialisation recomputes labels → Phase 2's REVISE() is invoked
```

Order matters: premises must exist before the justification that references them.

**Engine seam (restating Phase 0.9 for this phase).** `extract(transcript)` has two implementations:

| | LLM engine | Local engine |
|---|---|---|
| Method | One call per chunk, strict JSON schema, temperature ~0.2, optional 3-run voting | Cue patterns + slot/value lexicon + premise cue phrases + negation/modality scope |
| Snippet fidelity | Must be instructed to copy verbatim; validate every snippet against the raw text and **reject any that doesn't match** | Guaranteed by construction (spans come from the offset map) |
| Failure mode | Paraphrased snippets, hallucinated alternatives, run variance | Missed decisions phrased unusually, weaker rationale |
| Cost | 1–3 calls per chunk | Zero |

**Snippet validation is a hard rule on the LLM path:** any returned snippet that is not a literal substring of the input is discarded and the item is downgraded to low confidence. This one check prevents the most common and most corrosive LLM extraction failure.

**Acceptance criteria.**
- Both engines produce the same event types and the same node shapes.
- The engine used is stored on every node and badged in the UI.
- The fixture transcript yields ≥5 decisions and ≥3 premises on the **local** engine, keyless.

---

## Diagrams

### D1.1 — Episode segmentation vs sentence segmentation

```
   SENTENCE-BASED (what the literature assumes — fails on dialogue)
   ────────────────────────────────────────────────────────────────
   [agent] "Postgres via Supabase would work, but…"        → no cue, discarded
   [human] "none really. it's one person, one machine…"    → no cue, discarded ✗ PREMISE LOST
   [agent] "Then I'd use SQLite with better-sqlite3…"      → weak cue, low confidence
   [human] "yeah ok. going with SQLite, not Postgres…"     → cue ✓ decision only, no premise

   EPISODE-BASED (what WhyLog does)
   ────────────────────────────────────────────────────────
   ┌─ EPISODE E-003 ── topic: DATABASE ────────────────────┐
   ³  all four turns analysed as one negotiation window    ³
   ³  → decision  WLD-0007  DATABASE = sqlite   (+postgres)³
   ³  → premise   P-0002    scale.max_users = 1     IN-list³
   ³  → premise   P-0005    deployment = none       IN-list³
   ³  → premise   P-0011    concurrent_writers      OUT-list³
   ³  → alternatives [postgres: deploy complexity,          ³
   ³                  supabase: hosted dependency]          ³
   └────────────────────────────────────────────────────────┘
```

### D1.2 — Review gate flow

```
   extraction output
        ³
        ├── confidence ≥ 0.75 ──► EXPANDED ──┐
        ├── 0.45 – 0.75      ──► NORMAL   ──┼──► human actions
        └── < 0.45           ──► COLLAPSED ─┘      ³
                                                    ├─ approve ──► commit events
   alternatives ──► separate stricter section ──────┤─ edit    ──► commit + DecisionEdited
   premises     ──► shown attached to their decision├─ discard ──► ExtractionDiscarded
                                                    ├─ merge   ──► manual resolution
                                                    └─ contest ──► PremiseContested
```

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| **Premise extraction too weak** — concept collapses to a decision log | 🔴 | Prototype 1.4 against the fixture corpus **first**, before building anything else. Measure precision. If it lands below ~0.5, narrow the cue-phrase set further or restrict premises to the 4 world-observable types and say so honestly |
| Alternatives precision (published 15.4%) makes pre-emption naggy | 🟠 | Stricter review tier; require `whyRejected`; never auto-enter the pre-emption index |
| Over-generation (13:1 FP:FN) makes review tedious | 🟠 | Confidence tiers, collapsed low tier, bulk approve, one-click discard. Target: fixture review in <60 s |
| LLM paraphrases snippets, breaking the evidence contract | 🟠 | Literal-substring validation on every snippet; downgrade on failure |
| Modality missed → hypotheticals become decisions → false contradictions | 🟠 | Explicit modality field; only `asserted` creates IN nodes; test cases for "what if", "could", "maybe" |
| Speaker attribution fails on unusual transcript formats | 🟡 | Fall back to `origin: agent_inferred` (lowest authority) rather than guessing `human_stated` |
| Episode segmentation splits a negotiated decision | 🟡 | One-turn overlap between chunks; episode merge in review |
| Ontology too narrow → everything lands in `OTHER` | 🟡 | Track `OTHER` rate on the fixture corpus; extend the ontology if it exceeds ~15% |

---

## Definition of done

- [ ] All six transcript input shapes normalise, with a verified offset map back to raw characters
- [ ] Episode-based segmentation recovers the fixture's SQLite negotiation as one unit
- [ ] Decisions recovered with variable, value, polarity, modality, rationale, accepted downside, Y-statement form
- [ ] **Premises recovered as typed shared nodes with predicates, linked to IN-lists and OUT-lists**
- [ ] Rejected alternatives recovered with `whyRejected`, gated behind a stricter review tier
- [ ] Provenance complete on every item: verbatim snippet, char span, origin, engine, confidence
- [ ] Entity resolution merges correctly; double-import creates zero nodes
- [ ] Confidence tiers computed; three-run majority voting implemented and toggleable on the LLM path
- [ ] Review gate blocks all commits; fixture review completes in under 60 seconds
- [ ] Both engines produce ≥5 decisions and ≥3 premises on the fixture, keyless
- [ ] Premise and alternative precision **measured** against the hand-labelled fixture corpus
