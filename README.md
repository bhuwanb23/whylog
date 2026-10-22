# WhyLog

> **A truth maintenance system for the decisions you make while building with AI.**

Your coding agent forgets every decision ten prompts back — so people built it a memory. But memory isn't the hard part.

The hard part is that **a decision is not a fact.** It is a belief held under assumptions about the world:

> *"SQLite, not Postgres"* is not true simpliciter. It is true **given** single-user, no deploy infrastructure, no concurrent writers.

Nobody stores the *given*. And the *given* is exactly what changes. You add a second user, nothing contradicts you, no new decision is made — and the SQLite decision silently stops being true while every tool in the market keeps confidently serving it back to your agent.

WhyLog stores the premises. When one breaks, it tells you which decisions just became unsound — **including the two downstream ones you forgot existed** — and proposes the minimal revision for you to approve. Then it compiles each decision into an executable check and an agent-readable rule with a verify command.

**Memory tools stop you repeating yourself. WhyLog stops you building on a decision that stopped being true three weeks ago.**

---

## Current status

**Phases 0, 1 and 2 are written. Gates G1 (the walking skeleton) and G2 (it reasons) are
code-complete but have never been executed.**

Phase 2 is the critical gate and the one nothing else in this space has: a truth-maintenance
layer that treats a decision as a belief held under assumptions, and asks whether the
assumptions still hold.

| Area | State |
|---|---|
| Research library | ✅ Written — 9 documents in [`docs/`](docs/) |
| Master plan + phase plans | ✅ Written — [`plan/`](plan/) |
| Toolchain & config | ✅ Written — see [STRUCTURE.md §1](STRUCTURE.md) |
| Directory structure | ✅ 67 directories, mapped file-by-file in [STRUCTURE.md](STRUCTURE.md) |
| Type contracts | ✅ 8 files in [`src/types/`](src/types/) — the closed 36-type event vocabulary and every domain shape |
| Demo fixtures | ✅ [`fixtures/demo-transcript.txt`](fixtures/demo-transcript.txt) (October: the SQLite decision and its premises) · [`fixtures/demo-transcript-2.txt`](fixtures/demo-transcript-2.txt) (November: the same premises, falsified by the world) |
| **Phase 0 — substrate** | ✅ Log · fold · bi-temporal · identity · hash chain · persistence · portability · ontology · engine seam · store · boot |
| **Phase 1 — extraction** | ✅ Normalise · segment · cue scan · decisions · **premises and the OUT-list** · alternatives · provenance · snippet validation · identity resolution · confidence tiers · review queue · commit · both engines |
| **Phase 2 — truth maintenance ★** | ✅ **133 source files, ~39.8k lines.** Assertion entry point (four input kinds, one function) · JTMS labeller with fixpoint and `UNFOUNDED` · **gate (a) structural** · **gate (b) semantic** · **gate (c) premise invalidation ★** · dependency-directed backtracking · nogoods · cascade with the independent-support stop · entrenchment with the EE3 cap · Hansson non-prioritized screening · seven-part proposals · audit trail on learned time · the nine-step REVISE cycle · the Reasoning view |
| **Phase 3 — retrieval & the evidence contract ★** | ✅ **155 source files, ~45.8k lines.** Five index levels (L1 statements · **L2 HyPE inverted questions, built at extraction time with zero extra LLM calls** · L3 BM25 over the ontology alias table · L4 structural · L5 premises) · **RRF fusion at k = 60, deterministic and score-agnostic** · two-stage reranking with **all three engines present** (LLM listwise · local five-weight · the downloaded cross-encoder documented as unavailable rather than faked) · **the five-verdict contradiction classifier with invariant I3 enforced — similarity selects candidates and is then discarded** · **the evidence contract: ≤3 bounded searches, citations valid only if they resolve in-run, "insufficient evidence" as a first-class answer** · groundedness computed as \|claims with ≥1 resolving citation\| / \|total claims\| · **citation expansion showing premises with live labels, excluded conditions, rejected alternatives, guards and provenance** · **rejected-alternative pre-emption** · gate (b) wired to a real retriever · the Ask view, keyless |
| **Phase 4 — executable decision guards ★** | ✅ **186 source files, ~54.3k lines.** Eight guard kinds ordered by determinism · **templates that COMPILE a decision into checks** — five variables specifically, all fifteen generically · guards **proposed, never auto-installed** · `unverifiable` as a visible state, never a silent skip · **the in-browser interpreter over a pasted virtual project** (no shell, no network, no filesystem) with word-boundary matching and glob scoping · **skips are never passes** · all five health metrics with the **baseline pattern and the ratchet** · **★ guards as evidence — a failure enters `REVISE()` through the same entry point a transcript uses, and `implementation_cost` becomes a measurement rather than a guess** · CI runner + workflow with the rich failure message · the Guards view, keyless |
<<<<<<< 800657a
=======
| **Phase 5 — agent-native export compiler ★** | ✅ **210 source files, ~59.6k lines.** One graph → **canonical intermediate form** → five artifacts in a **single pass** · emitters are pure functions of the CIF and never read the graph · the six agent-optimized properties on every record, two of which (**verifiable**, **non-conflicting**) no ADR tool delivers automatically · **verify commands COMPILED from the Phase 4 guards** · **the "Rejected — do not re-propose" block with each reason's premise status** · priority-ranked two-tier emission against a ~200-line budget · **the pre-export consistency gate that BLOCKS a self-contradictory log** · integrity stamping described as auditability and never as security · round-trip re-import · the Export view, with **gate G5 checked mechanically** |
| **Phase 6 — presentation & visual language** | ✅ **240 source files, ~65.6k lines.** The **premise lattice ★** — bipartite, premises as load-bearing circles in columns by type with decisions hanging below as rounded squares, deterministic layout (no force simulation), five edge styles, and a **cascade animation driven by a real label diff** rather than a simulation · the **decision card ★** with all sections including RESTS ON / EXCLUDES with live labels, entrenchment's five weighted terms, accepted downside and verbatim provenance · timeline ordered by **valid time** with six distinct statuses, seven filters and search over the real Phase 3 retrieval stack · **Quick Log through the same `REVISE()` door as extraction** · health view with all six metrics including the **agency ratio nobody else can compute** · the **time machine on both axes** with a diff strip · settings that actually persist and are actually consumed · keyboard, empty states and a one-click demo path |
>>>>>>> 1e61ad6
| Phases 3–7 | ⬜ Not started |
| Tests | ⬜ Deliberately deferred — see [`notes/PHASE-0-NOTES.md`](notes/PHASE-0-NOTES.md) and [`notes/PHASE-1-NOTES.md`](notes/PHASE-1-NOTES.md) |

Paste a transcript into the **Import & review** view — the default screen — and the local engine,
with no API key, returns decisions with their Y-statements, the premises each one rests on, the
conditions each one *excludes*, and the alternatives that were turned down. Nothing enters the log
until a human decides each item; `commit.ts` refuses an item with no review action.

Then open **Reasoning** and click a premise about the world — `single-user`, say — and state what
you observed instead. The cycle labels the graph, fires all three gates, backtracks to the *minimal*
set of assumptions responsible, cascades (stopping wherever a decision has independent support),
weighs what it would cost to change, and produces a seven-part proposal. It applies nothing: the
system proposes, you dispose, and every action requires a reason that goes into the log.

Gates (a) and (c), backtracking, the cascade, entrenchment and adjudication are all **deterministic
and engine-independent** — the whole of G2 runs keyless. The LLM improves gate (b)'s recall and the
proposal's phrasing. It is not load-bearing for correctness.

Fixture 2 exists to demo the thing nobody else does: six weeks later the app has four users and is
deployed, so `scale.single_user` and `deployment.local_only` are false. Nobody contradicts the
original SQLite decision — it was correct when it was made. The world moved, and the OUT-list is what
lets the system notice.

Nothing has been installed, built, typechecked or run in the authoring environment. Run
`npm install && npm run verify` locally and expect a first pass of type errors —
[`notes/PHASE-1-NOTES.md` §6](notes/PHASE-1-NOTES.md) lists the seven known gaps.

<<<<<<< 800657a
`npm run check:structure` passes: **186 source files, 54,336 lines**, imports resolve, every named
=======
`npm run check:structure` passes: **240 source files, 65,575 lines**, imports resolve, every named
>>>>>>> 1e61ad6
import and re-export exists, zero import cycles across 503 internal edges, brackets balance, and the
event vocabulary agrees with the fold.

---

## Running it locally

Nothing is installed in the authoring environment by design — install and run on your own machine.

```bash
node --version          # must be >= 20.11  (see .nvmrc)
npm install
npm run dev             # http://localhost:5173, bound to 0.0.0.0
```

Other entry points:

```bash
npm run check:structure # python3 only — no node_modules needed. Import paths, bracket
                        # balance, event-vocabulary drift, forbidden patterns.
npm run verify          # typecheck + lint/format check + tests  (pre-push gate)
npm run typecheck
npm run check           # Biome lint + format
npm run test
npm run build && npm run preview
```

`npm run eval`, `npm run eval:ablation` and `npm run guards:ci` are wired to Phase 7 and Phase 4.6 respectively and will fail until those modules exist.

**No API key is required for anything.** The local engine is the default, not a fallback — extraction, premise invalidation, cascade, entrenchment, guards and export all run offline and deterministically. `.env.example` documents the optional provider config; keys live in `localStorage` at runtime and never reach the event log or an export.

---

## Where to read

| If you want… | Go to |
|---|---|
| The whole argument in one file | [`docs/00-research-summary.md`](docs/00-research-summary.md) |
| To know whether this is actually novel | [`docs/01-prior-art-landscape.md`](docs/01-prior-art-landscape.md) · [`docs/07-novelty-audit-and-positioning.md`](docs/07-novelty-audit-and-positioning.md) |
| The formal core (TMS, entrenchment, the `REVISE` algorithm) | [`docs/02-truth-maintenance-theory.md`](docs/02-truth-maintenance-theory.md) |
| Retrieval and contradiction algorithms | [`docs/03-retrieval-and-contradiction.md`](docs/03-retrieval-and-contradiction.md) |
| Executable guards and the fitness-function gap | [`docs/04-executable-decision-guards.md`](docs/04-executable-decision-guards.md) |
| The build order, gates, cut lines and invariants | [`plan/OVERVIEW.md`](plan/OVERVIEW.md) |
| What goes in a specific file | [`STRUCTURE.md`](STRUCTURE.md) |
| The phase you're working on | [`plan/phase-0`](plan/phase-0-foundation.md) … [`plan/phase-7`](plan/phase-7-evaluation.md) |

---

## The four invariants

Non-negotiable across every phase. A module that violates one is wrong, not clever.

1. **Nothing is deleted, everything is an event.** Nodes are relabelled; every transition writes an immutable event with a reason.
2. **Premises are shared nodes, not per-decision strings.** "single-user" is *one* node that three decisions point at. This is what makes cascade exact — and it is the invariant most likely to be quietly abandoned under time pressure.
3. **Retrieval proposes, a classifier disposes.** Cosine similarity never produces a verdict. *"Use Postgres"* and *"don't use Postgres"* are ~0.9 similar.
4. **The system proposes, the human disposes.** No auto-applied retraction, reversal, guard or export. Extracted prose must not be allowed to silently rewrite a considered decision.

---

## Architecture in one picture

```
┌─ L5  PRESENTATION ───────────────────────────────────────────────────────────┐
│   Timeline · Ask · Health · Premise Lattice · Time Machine · Export          │
├─ L4  SYNTHESIS ──────────────────────────────────────────────────────────────┤
│   answers with evidence verdicts · export compiler · guard synthesis         │
├─ L3  RETRIEVAL ──────────────────────────────────────────────────────────────┤
│   4-level index → RRF → rerank → structural gate → evidence contract         │
├─ L2  REASONING   ← the differentiating layer ────────────────────────────────┤
│   JTMS labeller · 3-gate detector · backtracking · cascade · entrenchment    │
├─ L1  EXTRACTION ─────────────────────────────────────────────────────────────┤
│   transcript → decisions + PREMISES + alternatives + provenance              │
├─ L0  SUBSTRATE ──────────────────────────────────────────────────────────────┤
│   append-only bi-temporal event log · hash chain · ontology · persistence    │
└──────────────────────────────────────────────────────────────────────────────┘
        THE AI SEAM (vertical): every L1–L4 operation has an LLM and a
        LOCAL implementation, selected at runtime, badged, never mixed silently
```

Full detail: [`plan/OVERVIEW.md §2`](plan/OVERVIEW.md).

---

## Build order

1. Move `reference/*.ts` → `src/types/`.
2. `src/lib/` — ten small pure utilities.
3. `src/ontology/data/` — the vocabulary. **Before any extractor.**
4. `src/substrate/` — event log, fold, bi-temporal, identity, hash chain.
5. `src/ai/local/` — the default engine.
6. `src/extraction/` — then `src/reasoning/` gates (a) and (c).
7. **Stop and run gate G2** before building anything else.

Gates and cut lines: [`plan/OVERVIEW.md §5`](plan/OVERVIEW.md).

---

## License

MIT — see [LICENSE](LICENSE).
