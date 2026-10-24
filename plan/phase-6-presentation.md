# Phase 6 — Presentation & Visual Language

| | |
|---|---|
| **Layer** | L5 — Presentation |
| **Depends on** | Phase 0–5 for data; **6.1–6.3 should be built alongside Phase 1**, not after |
| **Blocks** | Gate G6 (with Phase 7) |
| **Estimate** | 6.5 h |
| **Research** | [docs/02 §4.2](../docs/02-truth-maintenance-theory.md) (node lifecycle) · [docs/03 §5](../docs/03-retrieval-and-contradiction.md) (evidence contract rendering) |
| **Gate** | The concept is *legible* — a judge understands the mechanism from the screen, not the narration |

**Objective in one sentence:** make the reasoning visible. Every view in this phase exists to render a mechanism that would otherwise be invisible — labels, cascades, premises, entrenchment, bi-temporality.

**Design principle for the whole phase:** the differentiating visual is **not** another chat UI and **not** another decision timeline. It is the **premise lattice** (6.6) — a bipartite graph where assumptions are the load-bearing nodes and decisions hang off them. Nobody in the category has that picture, because nobody stores that structure.

**Sequencing note.** 6.1–6.3 are built *during* Phases 1–2. You cannot evaluate extraction quality or tune a cascade without looking at it. The remaining sub-phases come after the pipeline works.

---

## Sub-phases

### 6.1 — Timeline view

**Goal.** The materialised decision set, in valid-time order, with soundness visible at a glance.

**Elements.**
- Chronological list ordered by **valid time** (`decidedAt`), never by learned time — otherwise a pasted historical transcript appears at the top.
- Status badge per row: `SOUND` · `UNSOUND` · `UNVERIFIED` · `UNFOUNDED` · `CONTESTED` · `SUPERSEDED`.
- Filters: variable, tag, status, origin (`human` / `agent-proposed` / `agent-inferred`), engine, date range, transcript.
- Search-as-you-type over the Phase 3 stack.
- Inline **Quick Log** — a ten-second manual entry for someone mid-flow, which skips extraction but still goes through resolution and revision.

**Empty state.** Not a blank page: a paste target and one sentence explaining what happens next. First-run is the most common drop-off point in every tool in this category.

**Acceptance criteria.** Ordering is by valid time; all six statuses render distinctly; every filter works; Quick Log entries enter the same `REVISE()` cycle as extracted ones.

---

### 6.2 — The decision card ★

**Goal.** One card that shows the entire formalism for a single decision. This is the most information-dense screen in the product and the one a judge will read closely.

```
   ┌────────────────────────────────────────────────────────────────┐
   │ WLD-0007                                        ● SOUND  (IN)  │
   │ Use SQLite, not Postgres                                       │
   │                                                                │
   │ In the context of a single-user local tool with no deployment  │
   │ infrastructure, facing a storage choice, we decided for SQLite │
   │ to avoid deploy overhead, accepting single-writer limits.      │
   │                                                    [Y-statement]│
   ├────────────────────────────────────────────────────────────────┤
   │ RESTS ON                                                       │
   │   ✓ P-0002  scale.max_users = 1          "one person, one      │
   │   ✓ P-0005  deployment = none             machine, one log"    │
   │ EXCLUDES                                                       │
   │   ✗ P-0011  concurrent writers           OUT — must not hold   │
   ├────────────────────────────────────────────────────────────────┤
   │ REJECTED                                                       │
   │   Postgres  — "deploy complexity"                              │
   │   Supabase  — "hosted dependency"                              │
   │ ACCEPTED DOWNSIDE                                              │
   │   single-writer limit; migration needed if multi-user          │
   ├────────────────────────────────────────────────────────────────┤
   │ GUARDS   2/2 passing                                           │
   │   ✓ G-0007a dependency_present  better-sqlite3                 │
   │   ✓ G-0007b dependency_absent   pg                             │
   ├────────────────────────────────────────────────────────────────┤
   │ ENTRENCHMENT  0.78  HIGH                          [breakdown]  │
   │   authority 1.00 · implementation 1.00 · corroboration 0.31    │
   │   confidence 0.90 · recency 0.62 · EE3 cap not binding         │
   ├────────────────────────────────────────────────────────────────┤
   │ PROVENANCE                                                     │
   │   "yeah ok. going with SQLite, not Postgres. single-user and   │
   │    no deploy hassle is the whole argument."                    │
   │   transcript t₁ · chars 1204–1288 · human_stated               │
   │   engine: local · confidence 0.90                              │
   │   decided 2026-10-03 · learned 2026-10-21                      │
   ├────────────────────────────────────────────────────────────────┤
   │ RELATES TO   WLD-0011 depends-on · WLD-0019 shares-premise     │
   │              WLD-0021 supersedes-none                          │
   ├────────────────────────────────────────────────────────────────┤
   │ [ Reverse ] [ Re-justify ] [ Contest premise ] [ Audit trail ] │
   └────────────────────────────────────────────────────────────────┘
```

**The three sections no competitor has:** `RESTS ON / EXCLUDES` with live premise labels, `ENTRENCHMENT` with a visible breakdown, and `ACCEPTED DOWNSIDE`. Together they are the whole concept on one card.

**Acceptance criteria.** All sections render from the materialised graph; the snippet is clickable and highlights in the source transcript; the audit trail expands to the events that produced the current state.

---

### 6.3 — Paste & review UX

**Goal.** Make extraction reviewable fast, because extraction over-generates.

**Layout.** Side-by-side: raw transcript on the left with the source span highlighted; extracted structure on the right. Hovering a field highlights its snippet. This is the single most trust-building screen in the product.

**Optimised for rejection, not acceptance.** Published extraction has a **13:1 false-positive-to-false-negative ratio** (ARGUS: 155 FP vs 12 FN, [docs/05 §4.1](../docs/05-rationale-mining-literature.md)). Therefore:
- High-confidence tier expanded, with **bulk approve**.
- Medium tier normal.
- Low tier **collapsed**, one-click discard.
- Alternatives in their own stricter section, off by default for the pre-emption index.
- Premises shown attached to the decision they support, with inline edit and type override.

**Target: the full fixture review in under 60 seconds.**

**Acceptance criteria.** Bulk approve works; discard is one click; every field is editable in place; edits preserve the original extraction as an event.

---

### 6.4 — Health view

**Goal.** Six numbers that summarise whether the log is trustworthy.

| Metric | Source | Reads as |
|---|---|---|
| **Decision Compliance** | Phase 4.4 | "Your codebase has quietly stopped believing 3 of your 12 decisions" |
| **Verifiable Coverage** | Phase 4.4 | How much of the log is falsifiable at all |
| **Log Soundness** | Phase 2 labels | How much of what you believe is still supported |
| **Premise Contention** | Count of contested / OUT premises | How much of the ground has shifted |
| **Agency Ratio** | Phase 1.6 origin classification | How often you override your agent vs adopt its proposals |
| **Drift Age** | Oldest unresolved failing guard | How long you've been ignoring a disagreement |

**The agency ratio** is the one nobody else can compute, because nobody else classifies decision origin. It's a small, sticky, genuinely interesting number: *"you've overridden your agent 4 times in 19 decisions."*

**Also surfaced:** the hash-chain verification status (Phase 0.5) and export-stamp mismatches.

**Acceptance criteria.** All six metrics compute live; each has a one-line plain-language gloss; the hash chain status is visible.

---

### 6.5 — The revision proposal surface ★

**Goal.** Render Phase 2.9's seven-part proposal so a non-expert understands it in ten seconds.

```
   ┌──────────────────────────────────────────────────────────────┐
   │ ⚠ UNSOUND   WLD-0007 — Use SQLite, not Postgres              │
   ├──────────────────────────────────────────────────────────────┤
   │ WHAT FAILED    Premise P-0011 "no concurrent writers"        │
   │                                                              │
   │ THE EVIDENCE   "the sync worker writes while the UI writes"  │
   │                transcript t₂ · 2 minutes ago      [expand]   │
   │                                                              │
   │ THE NOGOOD     "single-user" and "needs concurrent writers"  │
   │                cannot both hold                              │
   │                                                              │
   │ THE CASCADE    WLD-0011 Skip connection pooling   → UNSOUND  │
   │                WLD-0019 No migration tooling      → SURVIVES │
   │                                                              │
   │ ENTRENCHMENT   0.78 HIGH                        [breakdown]  │
   │                you stated it · it's implemented · 18 days old│
   │                                                              │
   │ WHY NOT AUTO   the newcomer (0.85, single source) does not   │
   │                outrank an entrenched, implemented decision   │
   ├──────────────────────────────────────────────────────────────┤
   │ [ Reverse → Postgres ] [ Keep & re-justify ] [ Contest ]     │
   └──────────────────────────────────────────────────────────────┘
```

**Design requirements.**
- Plain-language labels, not formal vocabulary. "What failed", not "invalidated justification".
- The cascade shown as a small tree, with survivors visually distinct from casualties.
- The entrenchment breakdown expandable to all five components.
- **"Keep & re-justify" opens a premise composer** — free text, typed against the 8 premise types, re-runs the labeller on submit. This is the most common real action and must be as easy as the other two.
- A dismissed proposal goes to a **Contested queue**, not to nowhere.

**Acceptance criteria.** All seven parts render; the tree distinguishes survivors; re-justification restores the decision to IN with a new inspectable justification; dismissal is recoverable.

---

### 6.6 — The premise lattice ★ the signature visual

**Goal.** Show the structure that no other tool has: assumptions as load-bearing nodes, decisions hanging off them.

**Not a decision graph.** A decision graph (what `ai-memory` ships) shows decisions linked to decisions. The lattice is **bipartite**:

```
   PREMISES (top row, by type)          DECISIONS (below, as leaves)
   ────────────────────────────         ──────────────────────────

   scale ────────┬── P-0002 single-user ═══╗
                 │                         ╠══► WLD-0007 SQLite
   deployment ───┴── P-0005 no-deploy  ════╝         ║
                                                     ║ depends-on
   requirement ───── P-0011 concurrent ═══════► WLD-0011 skip pooling
                     writers  (OUT)  ⚠              ║
                                                    ║
   budget ─────────── P-0004 budget=none ══════► WLD-0019 no migration
                                                    tooling  (SURVIVES —
                                                    independent support)
```

**Edge vocabulary.** `supports` (premise → decision, IN-list) · `excludes` (premise → decision, OUT-list, drawn dashed) · `depends-on` (decision → decision) · `supersedes` (decision → decision) · `conflicts` (red) · `shares-premise` (implicit, via the bipartite structure).

**The cascade animation is the money shot.** Click a premise → every decision resting on it highlights → falsify it → labels flip in sequence, edges turn red, survivors stay green. **Ten seconds of animation communicates the entire concept more effectively than any paragraph.**

**Anti-hairball rules.**
- Layout premises in columns by type; decisions as leaves beneath.
- Render **one cascade at a time**; never the whole graph unfiltered.
- Fade `SUPERSEDED` and `neutral` edges by default; a toggle reveals them.
- Collapse premises with a single dependent decision into the decision's card.

**Implementation note:** a force-layout library for positioning only; render as plain SVG so edges, labels and animation stay fully controllable.

**Acceptance criteria.** The bipartite structure is legible at 20 decisions; falsifying a premise animates the cascade; survivors are visually distinct; no unfiltered whole-graph render.

---

### 6.7 — Time machine

**Goal.** Bi-temporal replay — the payoff for Phase 0.3, and nearly free once events are append-only.

**Mechanism.** Fold the event log over the prefix where `occurredAt ≤ T`. Because the fold is pure and total (Phase 0.2), this is a slider, not a feature.

**Two sliders, because two timelines.** Valid time (*"what was true then"*) and learned time (*"what did the system know then"*). They diverge constantly in WhyLog's real workflow — you paste a three-week-old transcript, so the system learns today about a decision made on the 3rd.

**Rendered as:** the timeline filtered to T · the lattice at T · a diff strip below showing what changed between T and now (decisions added, premises invalidated, labels flipped, reversals).

**Acceptance criteria.** Sliding to Oct 12 shows the log as it stood then; the diff strip correctly lists every change since; both timelines work independently.

---

### 6.8 — Mode badge & settings

**Goal.** Never let the UI imply a capability it doesn't have.

**Badge on every operation:** `LLM · model-name` or `LOCAL`. Stored on the node (`extractedBy`), not just displayed — so a decision extracted months ago by a different engine still reports its origin honestly.

**Settings:** engine selection · provider and key (in `localStorage` only, never in events, never in exports) · three-run majority voting toggle · cascade depth cap · confidence-tier thresholds · guard severity defaults · re-index action (required after an engine change, because cosine similarity across embedding spaces is meaningless).

**Acceptance criteria.** Every rendered result shows its engine; switching engines flags the index stale and disables semantic retrieval until rebuilt; no key ever appears in an export or an event.

---

### 6.9 — Empty states, keyboard, first-run

**Goal.** Craft that reads as rigour.

- **First run:** a paste target, one sentence of explanation, and a "load the demo transcript" button that seeds the fixture. The demo path must be one click from a cold start.
- **Empty states everywhere:** no decisions, no premises, no guards, no search results, insufficient evidence. Each states what's missing and what to do.
- **Keyboard:** `⌘K` to ask · `N` to quick-log · `P` to paste · `Esc` to dismiss · arrow navigation in the timeline.
- **Loading and error states:** extraction progress, index rebuild progress, engine failure with an automatic fallback notice.

**Acceptance criteria.** Cold start to first decision in under 30 seconds; every async operation has a visible state; every failure states its cause and the fallback taken.

---

## Visual language

| Concept | Colour / form | Rationale |
|---|---|---|
| `SOUND` (IN) | Solid green | The default healthy state |
| `UNSOUND` (OUT) | Solid amber — **not red** | Unsound is a *warning*, not an error. Red is reserved for contradiction |
| `UNVERIFIED` (UNKNOWN) | Hollow grey | Absence of evidence, drawn as absence of fill |
| `UNFOUNDED` | Hollow grey with a dashed border | A data-quality problem, visually distinct from unknown |
| `CONTESTED` | Amber outline, pulsing once | Needs human attention, not alarming |
| `SUPERSEDED` | Muted, struck through, retained | History, never hidden |
| Contradiction edge | Red | The only use of red in the system |
| Premise node | Circle, sized by dependent-decision count | Load-bearing nodes look load-bearing |
| Decision node | Rounded square | Distinct shape from premises — the bipartite structure reads without labels |
| `supports` edge | Solid | |
| `excludes` edge (OUT-list) | **Dashed** | Non-monotonic support must look different from monotonic support |
| Engine badge | Monospace chip, `LLM` filled / `LOCAL` outlined | Provenance always visible |

**One rule for the whole system:** colour encodes **epistemic status**, never severity or category. Everything else is shape and position.

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Premise lattice becomes a hairball | 🟠 | Bipartite columns by type; one cascade at a time; fade superseded/neutral; collapse single-dependent premises |
| Decision card too dense to read | 🟠 | Progressive disclosure — Y-statement and status always visible, everything else collapsed by default |
| Review UX too slow → extraction gets bulk-approved blindly | 🟠 | 60-second fixture target; tier-based default expansion; edit-in-place |
| Proposal surface too technical | 🟠 | Plain-language labels; test on someone who hasn't read the research docs |
| Time machine confuses two timelines | 🟡 | Label them explicitly ("when it happened" / "when we learned"); never show one without naming it |
| Animation as decoration rather than explanation | 🟡 | The cascade animation must show *why* each node flipped — hover any node mid-animation for its reason |
| Dark mode / contrast in the demo environment | 🟢 | Status colours chosen for both; never encode meaning in colour alone — every status also has a text label |

---

## Definition of done

- [ ] Timeline ordered by valid time with all six statuses, filters, search and Quick Log
- [ ] **Decision card** rendering all sections, including rests-on/excludes with live premise labels, entrenchment breakdown and accepted downside
- [ ] Paste & review side-by-side with span highlighting; fixture review under 60 seconds
- [ ] Health view with all six metrics and the hash-chain status
- [ ] **Revision proposal surface** with all seven parts and a working re-justification composer
- [ ] **Premise lattice** — bipartite, edge-typed, with the cascade animation and anti-hairball rules
- [ ] Time machine with both sliders and a diff strip
- [ ] Engine badge on every operation; settings complete; index staleness handled
- [ ] First run to first decision in under 30 seconds; empty, loading and error states everywhere
- [ ] The visual language applied consistently; colour reserved for epistemic status
