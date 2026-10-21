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

**Setup complete. No implementation yet.**

| Area | State |
|---|---|
| Research library | ✅ Written — 9 documents in [`docs/`](docs/) |
| Master plan + phase plans | ✅ Written — [`plan/`](plan/) |
| Toolchain & config | ✅ Written — see [STRUCTURE.md §1](STRUCTURE.md) |
| Directory structure | ✅ 66 directories, mapped file-by-file in [STRUCTURE.md](STRUCTURE.md) |
| Type contracts | 🟡 3 files pre-drafted in [`reference/`](reference/) — move to `src/types/` when Phase 0 starts |
| Demo fixture | ✅ [`fixtures/demo-transcript.txt`](fixtures/demo-transcript.txt) (a second fixture is needed for the premise-invalidation demo) |
| Source implementation | ⬜ Not started |

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
