# WhyLog — Project Structure

**The complete file map.** Every file the build will contain, what it is for, and which plan sub-phase it implements.

This document is the scaffolding contract. Nothing here is implemented yet — `src/` contains directory structure only, marked with `.gitkeep`.

- **Setup files** (configs, manifests, CI) are written and final. See §1.
- **Source files** are enumerated below with their purpose and phase. See §3–§14.
- **Three type files** already drafted are parked in [`reference/`](reference/) — they are the contracts every module codes against, so read them before starting Phase 0.

**Read alongside:** [`plan/OVERVIEW.md`](plan/OVERVIEW.md) for the architecture and phase order.

---

## 1. Setup files — written ✓

| File | Purpose |
|---|---|
| `package.json` | Manifest. Node ≥20.11, 3 runtime deps, scripts for dev/build/test/eval/guards |
| `tsconfig.json` | Solution-style root; references app + node configs |
| `tsconfig.app.json` | **TypeScript strict**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`. Path alias `@/*` → `src/*` |
| `tsconfig.node.json` | Config-file and script compilation |
| `vite.config.ts` | React + Tailwind v4 plugins, `@` alias, `host: 0.0.0.0`, `d3-force` split into a lazy chunk |
| `vitest.config.ts` | jsdom, globals, v8 coverage excluding components/views |
| `biome.json` | Lint + format in one tool. 2-space, 100 cols, double quotes, `noExplicitAny: error`, `noUnusedImports: error` |
| `.editorconfig` | LF, UTF-8, final newline, trailing-whitespace trim (off for Markdown) |
| `.nvmrc` | `20` |
| `.env.example` | All-optional provider config. Documents that the local engine is the **default, not a fallback** |
| `.gitignore` | Includes `.env*` (except example), `.whylog/`, `whylog-export/` |
| `.gitattributes` | LF normalisation; svg as text |
| `index.html` | No external fonts, no CDN, no analytics — works with zero network |
| `public/favicon.svg` | The bipartite lattice reduced to a mark |
| `.vscode/settings.json` | Biome as default formatter, format-on-save, organise-imports on save |
| `.vscode/extensions.json` | Recommends Biome; un-recommends Prettier and ESLint |
| `.github/workflows/ci.yml` | Two jobs: `verify` (typecheck → lint → test → keyless path) and `guards` (exported guard set, blocking) |
| `LICENSE` | MIT |

**Scripts available:**

| Script | What it does |
|---|---|
| `dev` | Vite dev server on `0.0.0.0:5173` |
| `build` | `tsc -b` then `vite build` |
| `preview` | Serve the production build |
| `typecheck` | Project-references typecheck |
| `lint` / `format` / `check` / `check:fix` | Biome |
| `test` / `test:watch` / `test:coverage` | Vitest |
| `eval` / `eval:ablation` / `eval:report` | Phase 7 harness |
| `guards:ci` | Emit and run the exported guard set (Phase 4.6) |
| `verify` | typecheck + check + test — the pre-push gate |

---

## 2. Top-level layout

```
whylog/
├── .github/workflows/     CI
├── .vscode/               editor defaults
├── docs/                  research library (9 documents, written)
├── fixtures/              demo + evaluation inputs
├── plan/                  master plan + 8 phase files (written)
├── public/                static assets
├── reference/             pre-drafted type contracts
├── scripts/               build-time utilities
├── src/                   the application (structure only)
└── tests/                 unit, integration, e2e
```

---

## 3. `src/substrate/` — Phase 0 · L0

The append-only, bi-temporal, hash-chained foundation. Everything else writes events here and reads projections from here.

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | Public API of the layer | — |
| `event-log.ts` | Append with validation; head hash; iteration; **no mutation path exists** | 0.1 |
| `event-validation.ts` | The six append rules; closed vocabulary enforcement | 0.1 |
| `materialize.ts` | The **pure, total fold**: events → `DecisionKnowledgeBase` | 0.2 |
| `projections/decisions.ts` | `DecisionId → Decision` projection | 0.2 |
| `projections/premises.ts` | `PremiseId → Premise` projection (**shared nodes**, invariant I2) | 0.2 |
| `projections/justifications.ts` | `JustificationId → Justification` projection | 0.2 |
| `projections/labels.ts` | Label projection; the only writer of `LabelChanged` state | 0.2 |
| `projections/edges.ts` | Dependency-network edges | 0.2 |
| `projections/indexes.ts` | `variableIndex`, `valueIndex`, `premiseIndex` | 0.2 |
| `projections/metrics.ts` | Compliance, soundness, coverage derived state | 0.2 |
| `bi-temporal.ts` | `asOf(axis, t)` materialisation; valid vs learned time helpers | 0.3 |
| `identity.ts` | The **six-rung resolution ladder**; fingerprinting | 0.4 |
| `hash-chain.ts` | `h(n) = hash(h(n-1) ‖ event(n))`; chain verification | 0.5 |
| `persistence.ts` | `localStorage` read/write; key handling | 0.6 |
| `portability.ts` | JSON export/import of **events, never state** | 0.6 |
| `schema.ts` | Schema version constant; migration steps as events | 0.6 |
| `snapshot.ts` | Projection cache keyed by `lastEventId` | 0.2 |
| `index-artifacts.ts` | Vectors stored **outside** the log, tagged `{engine, model}`; staleness flag | 0.8 |

---

## 4. `src/ontology/` — Phase 0.7

The shared vocabulary. **Highest-leverage artifact in the plan relative to its size** — every extractor, gate and guard template reads from it.

| File | Purpose |
|---|---|
| `index.ts` | Lookups: `resolveValue`, `resolveVariable`, `antonymsOf`, `premiseTypeOf`, `isWorldObservable` |
| `canonicalize.ts` | Alias folding; value normalisation |
| `data/variables.ts` | The 14 decision variables + `OTHER` |
| `data/premise-types.ts` | The **closed set of 8**, each with a predicate namespace and the world-observable flag |
| `data/aliases.ts` | `pg|postgresql|postgre → postgres`, `k8s → kubernetes`, … |
| `data/antonyms.ts` | Mutually-exclusive value pairs **scoped to a variable** — powers gate (a) with no model |
| `data/decision-cues.ts` | Cue patterns: `decided to`, `going with`, `switch to`, `instead of`, … |
| `data/premise-cues.ts` | Cue phrases per premise type: `scale`, `budget`, `deployment`, … |

---

## 5. `src/ai/` — the engine seam · Phases 0.9, 1.10

One interface, two implementations, selected at runtime, badged in the UI, never mixed silently.

| File | Purpose |
|---|---|
| `index.ts` | `getEngine()` — resolves configured engine with automatic local fallback |
| `types.ts` | `WhyLogEngine`: `extract`, `classify`, `embed`, `rerank`, `compose`, `capabilities`, `id` |
| `config.ts` | Provider selection; key resolution from settings (**never** from events or exports) |
| `local/index.ts` | `LocalEngine` — the **default**, complete, offline, deterministic |
| `llm/index.ts` | `LLMEngine` — provider-agnostic orchestration, strict JSON, voting |
| `prompts/extraction.ts` | Decision + premise + alternative extraction prompt; verbatim-snippet rule |
| `prompts/classification.ts` | Five-verdict contradiction classification prompt |
| `prompts/composition.ts` | Answer, export-narrative and guard-rationale prompts |
| `prompts/guard-synthesis.ts` | Decision → guard set prompt (Phase 4.2) |
| `providers/openai.ts` · `anthropic.ts` · `openrouter.ts` | Thin provider adapters |
| `local/normalize.ts` | Transcript normalisation: speaker turns, tool noise, code blocks, **offset map** |
| `local/segment.ts` | Episode segmentation on topic shift (not sentence split) |
| `local/cues.ts` | Cue-pattern matching against the ontology |
| `local/decisions.ts` | Local decision recovery: variable, value, polarity, modality, rationale |
| `local/premises.ts` | Local premise recovery against the closed set of 8 |
| `local/alternatives.ts` | Local rejected-alternative recovery |
| `local/negation.ts` | Cue inventory + **scope window** + verb-pattern polarity |
| `local/modality.ts` | `asserted` / `proposed` / `hypothetical` / `reported` |
| `local/embed.ts` | **Hashed n-gram vectoriser**: tokens + char 3-grams, sign hash, 512-d, L2-normalised |
| `local/lexicon.ts` | Synonym folding — the file that decides whether the local path feels intelligent |
| `local/classify.ts` | Local contradiction classifier (structural + antonym + negation) |
| `local/compose.ts` | Template composition from structured fields |
| `local/confidence.ts` | Local additive confidence scoring |

---

## 6. `src/extraction/` — Phase 1 · L1

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | Orchestrator: normalise → segment → recover → resolve → score → review → commit | — |
| `pipeline.ts` | Stage runner; per-stage engine stamping | — |
| `normalizer.ts` | Input shapes → canonical form; offset map preservation | 1.1 |
| `speakers.ts` | Speaker attribution (`human` / `agent`) — provenance depends on it | 1.1, 1.6 |
| `timestamps.ts` | Timestamp recovery; uncertain-flag when absent | 1.1 |
| `noise.ts` | Tool-call, diff and stack-trace collapsing (retained verbatim for snippets) | 1.1 |
| `chunking.ts` | ~12k-char chunking on turn boundaries with one-turn overlap | 1.1 |
| `segmentation.ts` | **Episode** segmentation — the deliberate deviation from single-sentence rationale | 1.2 |
| `decisions.ts` | Decision recovery: cue → variable/value → polarity → modality → rationale → Y-statement | 1.3 |
| `premises.ts` | **Premise recovery ★** — typed, predicated, linked to IN-list **and OUT-list** | 1.4 |
| `premise-linker.ts` | Attaching premises to decisions as support vs excluded condition | 1.4 |
| `alternatives.ts` | Rejected-alternative recovery with `whyRejected` | 1.5 |
| `provenance.ts` | Snippet, char span, origin classification, engine stamp | 1.6 |
| `snippet-validation.ts` | **Literal-substring check** on LLM snippets; downgrade on failure | 1.6 |
| `resolution.ts` | Entity resolution **before** assertion — merge, never append duplicates | 1.7 |
| `confidence.ts` | Additive scoring; tier thresholds | 1.8 |
| `voting.ts` | Three-run majority voting (LLM path), toggleable | 1.8 |
| `review/index.ts` | Review-queue model; tier-based expansion state | 1.9 |
| `review/diff.ts` | The transcript↔structure diff model | 1.9 |
| `review/actions.ts` | Approve · edit · discard · merge-into · mark-contested | 1.9 |
| `commit.ts` | Commit ordering: premises → decision → alternatives → justification → approval | 1.10 |

---

## 7. `src/reasoning/` — Phase 2 · L2 ★ the differentiating layer

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | Layer API | — |
| `revise.ts` | **`REVISE()`** — the nine-step cycle; single entry point for transcripts, user decisions, guard results and repo scans | 2.1 |
| `labeller.ts` | JTMS validity; fixpoint iteration; **well-foundedness / cycle detection** | 2.2 |
| `gates/structural.ts` | **Gate (a)** — same variable, different canonical value; antonym pairs. `O(1)`, no model | 2.3 |
| `gates/semantic.ts` | **Gate (b)** — retrieve then classify; five verdicts; M1/M2 diagnostics | 2.4 |
| `gates/premise.ts` | **Gate (c) ★** — IN-list falsified or OUT-list satisfied. The non-monotonic gate nobody else has | 2.5 |
| `gates/index.ts` | Gate orchestration; any-fired short-circuit | 2.3–2.5 |
| `backtracking.ts` | Dependency-directed backtracking to assumption nodes; depth bound | 2.6 |
| `nogoods.ts` | Nogood recording, display text, and re-assertion blocking | 2.6 |
| `cascade.ts` | Forward propagation; **stop at independent support**; depth cap | 2.7 |
| `entrenchment.ts` | Five-term score + **EE3 cap** (`E(d) ≤ min premise E`) | 2.8 |
| `adjudication.ts` | Weakest-first ordering; **non-prioritized screening**; contested queue | 2.8 |
| `proposals.ts` | The **seven-part revision proposal**; three actions incl. *keep & re-justify* | 2.9 |
| `audit.ts` | Reason-carrying trail; per-flip explainability | 2.10 |

---

## 8. `src/retrieval/` — Phase 3 · L3 ✅ built

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | Query pipeline: levels → fusion → promote → rerank → contract | — |
| `index-levels/l1-dense.ts` | Statement embeddings | 3.1 |
| `index-levels/l2-questions.ts` | **Inverted questions (HyPE)** — generated during extraction, zero extra calls | 3.1 |
| `index-levels/l3-sparse.ts` | BM25 over all text fields; ontology-aliased terms | 3.2 |
| `index-levels/l4-structural.ts` | `variableIndex`, `valueIndex` | 3.3 |
| `index-levels/l5-premises.ts` | Premise → dependents inverted index (makes cascade `O(1)`) | 3.3 |
| `build-index.ts` | Index construction; staleness on engine change | 3.1–3.3 |
| `rrf.ts` | Reciprocal Rank Fusion, `k = 60`, score-agnostic | 3.4 |
| `rerank/index.ts` | Second-stage dispatch by engine capability | 3.5 |
| `rerank/cross-encoder.ts` | LLM / downloaded-model reranking | 3.5 |
| `rerank/local-weights.ts` | Five inspectable components: structural .35 · lexical .30 · dense .20 · premise .10 · recency .05 | 3.5 |
| `negation.ts` | Negation scope resolution shared with the classifier | 3.6 |
| `contradiction.ts` | Five-verdict classifier; **invariant I3 — similarity never decides** | 3.6 |
| `preemption.ts` | **Rejected-alternative pre-emption** — warn before the decision, not after | 3.6 |
| `evidence-contract.ts` | `GROUNDED` / `PARTIAL` / `INSUFFICIENT EVIDENCE`; bounded searches; run trace | 3.7 |
| `groundedness.ts` | Claim decomposition and citation-resolution scoring | 3.8 |
| `citations.ts` | Citation expansion: premises with labels, alternatives, guards, provenance | 3.9 |
| `answer.ts` | Answer synthesis from retrieved, cited decisions | 3.9 |
| `candidates.ts` | **Candidate pairs for gate (b)** — dense neighbours + shared premises + same variable, read from existing L1 vectors (zero embedding calls) | 3.6 |

---

## 9. `src/guards/` — Phase 4 · L2↔L4 ✅ built

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | Synthesise → review → run → score → feed back as evidence | — |
| `types.ts` | `GuardKind` (8), `GuardSpec`, `GuardSeverity`, `GuardResult` | 4.1 |
| `project.ts` | The **virtual project** built from pasted `package.json` / file listing / contents | 4.3 |
| `taxonomy.ts` | Kind metadata: determinism, browser-runnable, default severity | 4.1 |
| `templates/index.ts` | Template dispatch by decision variable; de-duplication and cap ranking | 4.2 |
| `templates/storage.ts` | STORAGE templates — artifact present, competing backend absent, forbidden endpoints | 4.2 |
| `templates/database.ts` · `framework.ts` · `hosting.ts` · `auth.ts` · `generic.ts` | Per-variable guard templates (~80% coverage) | 4.2 |
| `synth/index.ts` | Synthesis pipeline; **proposed, never auto-installed** | 4.2 |
| `synth/llm.ts` | LLM synthesis for decisions templates miss; flagged `requiresReview` | 4.2 |
| `eval/index.ts` | Interpreter dispatch; lifecycle and label gates | 4.3 |
| `eval/types.ts` | The evaluator's return shape, and the four shared SKIP reasons | 4.3 |
| `eval/dependency.ts` | `dependency_present` / `dependency_absent` | 4.3 |
| `eval/string.ts` | `string_in_files` / `string_absent_in_files` — **word-boundary matching** | 4.3 |
| `eval/path.ts` | `path_glob_exists` / `path_glob_absent` | 4.3 |
| `eval/command.ts` | `command_exit_zero` — export only, never run in browser | 4.3 |
| `eval/llm-judge.ts` | Rubric verdict; scored **separately** from deterministic compliance | 4.3 |
| `metrics/compliance.ts` | **Decision Compliance** | 4.4 |
| `metrics/coverage.ts` | Verifiable coverage; explicit `unverifiable` state | 4.4 |
| `metrics/soundness.ts` | Log soundness (IN ÷ non-superseded) | 4.4 |
| `metrics/drift.ts` | Drift age — days since first unresolved failure | 4.4 |
| `metrics/ratio.ts` | Deterministic ratio | 4.4 |
| `baseline.ts` | **Baseline + ratchet**: freeze initial failures, fail only on new ones | 4.4 |
| `feedback.ts` | **Guards as evidence ★** — pass → corroboration + `implementation_cost`; fail → `REVISE()` | 4.5 |
| `ci-export.ts` | Standalone runner + workflow emission; the rich failure message | 4.6 |
| `review.ts` | Accept · edit · suppress (with reason) · delete; label inheritance | 4.7 |

---

## 10. `src/export/` — Phase 5 · L4

| File | Purpose | Sub-phase |
|---|---|---|
| `index.ts` | One graph → CIF → rank → budget → emit → stamp, in a single pass | 5.1 |
| `compiler.ts` | The compilation pipeline | 5.1 |
| `cif.ts` | **Canonical intermediate form** — target-agnostic; emitters are pure functions of it | 5.1 |
| `priority.ts` | Inclusion ranking: soundness .35 · entrenchment .25 · scope .20 · severity .15 · recency .05 | 5.4 |
| `budget.ts` | Two-tier emission; ~200-line target; live line/token indicator | 5.4 |
| `consistency-gate.ts` | **Pre-export check** — block on conflict, exclude `OUT`, annotate contested premises and failing guards | 5.6 |
| `record.ts` | The agent-optimized record: ID · MUST/MUST NOT · `applies_to` · Because (premise IDs) · Rejected · Verify · Status | 5.3 |
| `emitters/claude.ts` · `agents.ts` · `cursorrules.ts` · `decisions-md.ts` · `index.ts` | Five targets from one CIF | 5.2 |
| `rejected-block.ts` | **"Rejected — do not re-propose"** with premise status | 5.3 |
| `verify-command.ts` | Guard → one-line runnable command | 5.3 |
| `stamp/index.ts` | Integrity stamp assembly | 5.5 |
| `stamp/hash.ts` | Head-hash computation for exports | 5.5 |
| `stamp/verify.ts` | Mismatch detection on re-import or file check | 5.5 |
| `ci/index.ts` · `runner.ts` · `workflow.ts` | Emitted CI guard runner and GitHub workflow | 4.6 / 5.2 |
| `round-trip.ts` | Export → import: stamp verify, resolve, merge as refinement | 5.7 |

---

## 11. `src/store/` — state

| File | Purpose |
|---|---|
| `index.ts` | The Zustand store over the event log + materialised graph |
| `selectors.ts` | Timeline order (by **valid** time), filters, search, health metrics, proposals |
| `settings.ts` | Engine choice, provider keys (**localStorage only**), thresholds, caps |

---

## 12. `src/lib/` — shared utilities

| File | Purpose |
|---|---|
| `hash.ts` | SHA-256 via WebCrypto — the hash chain and fingerprints |
| `ids.ts` | Sequential, addressable ids: `WLD-0007`, `P-0002`, `G-0007a`, `J-0007` |
| `cosine.ts` | Cosine similarity over `Float32Array` |
| `bm25.ts` | Sparse scoring |
| `text.ts` | Normalisation, tokenisation, stopword list |
| `glob.ts` | Glob matching for guards and `applies_to` |
| `format.ts` | Markdown escaping, date formatting, number formatting |
| `invariant.ts` | `unreachable()` / assertion helpers |
| `result.ts` | `Result<T, E>` for fallible operations |
| `rng.ts` | Deterministic RNG so tests reproduce |

---

## 13. `src/` UI — Phase 6 · L5

### Root

| File | Purpose |
|---|---|
| `main.tsx` | React entry |
| `App.tsx` | Shell: navigation across the six views, mode badge, settings |
| `index.css` | Tailwind v4 entry (`@import "tailwindcss"`) + theme tokens |
| `theme.ts` | The visual-language constants — **colour encodes epistemic status, never severity** |

### `src/components/common/`

`ModeBadge` · `StatusBadge` · `ConfidenceBar` · `SnippetHighlight` · `Collapsible` · `Modal` · `Drawer` · `Tooltip` · `EmptyState` · `Spinner` · `Toast` · `Keybind`

### `src/components/timeline/` — 6.1

`TimelineView` · `TimelineRow` · `TimelineFilters` · `QuickLog`

### `src/components/review/` — 6.3

`PasteModal` · `ReviewDiff` · `TranscriptPane` · `ExtractedPane` · `DecisionReviewCard` · `PremiseReviewRow` · `AlternativeReviewRow` · `BulkApproveBar` · `ReviewSummary`

### `src/components/conflict/` — 6.5 ★

`RevisionProposal` (the seven-part surface) · `WhatFailed` · `EvidenceQuote` · `NogoodStatement` · `CascadeTree` · `EntrenchmentBreakdown` · `ProposalActions` · `RejustifyComposer` · `ContestedQueue`

### `src/components/ask/` — 6.10

`AskView` · `SearchBar` · `AnswerPanel` · `VerdictBadge` · `GroundednessBar` · `CitationChip` · `CitationExpansion` · `RunTrace` · `NearestRelated` · `PreemptionNotice`

### `src/components/guards/`

`GuardPanel` · `GuardCard` · `ProposedGuardCard` · `ComplianceGauge` · `MetricGrid` · `VirtualProjectInput` · `BaselineNotice`

### `src/components/export/`

`ExportView` · `TargetPicker` · `ArtifactPreview` · `BudgetIndicator` · `IntegrityStamp` · `ConsistencyGateWarning` · `RejectedBlockPreview`

### `src/components/graph/` — 6.6 ★ the signature visual

`PremiseLattice` (bipartite: premises as load-bearing nodes, decisions as leaves) · `LatticeLayout` (columns by premise type) · `PremiseNode` · `DecisionNode` · `LatticeEdge` (`supports` solid / `excludes` dashed / `conflicts` red / `supersedes` grey) · `CascadeAnimation` · `LatticeHighlight` · `AntiHairballFilter` · `DecisionGraph` (supersession chains)

### `src/components/health/` — 6.4

`HealthView` · `MetricCard` · `AgencyRatio` · `HashChainStatus`

### `src/components/decision/` — 6.2 ★

`DecisionCard` · `YStatement` · `PremiseList` (`RESTS ON` / `EXCLUDES` with live labels) · `AlternativeList` · `AcceptedDownside` · `EntrenchmentBreakdown` · `ProvenanceBlock` · `GuardSummary` · `RelationList` · `AuditTrail`

### `src/components/time-machine/` — 6.7

`TimeSlider` (two sliders: valid time and learned time) · `DiffStrip`

### `src/views/`

`TimelineView` · `AskView` · `HealthView` · `ExportView` · `GraphView` · `TimeMachineView` · `SettingsView`

---

## 14. `src/eval/` — Phase 7

| File | Purpose |
|---|---|
| `index.ts` · `run.ts` · `report.ts` | Harness entry, CLI, markdown/JSON/CSV reporting |
| `metrics/types.ts` | `MetricResult` contract |
| `metrics/extraction.ts` | Decision P/R/F1 (comparator: RecovAr 75/77) |
| `metrics/premise.ts` | **Premise P/R/F1 — no published comparator** |
| `metrics/alternative.ts` | Alternative precision (comparator: ARGUS 15.4%) |
| `metrics/contradiction.ts` | L1 pairwise recall |
| `metrics/invalidation.ts` | **L2 premise-invalidation recall** |
| `metrics/cascade.ts` | **L3 cascade correctness + survivor preservation** |
| `metrics/false-positive.ts` | Spurious contradictions per 100 decisions |
| `metrics/groundedness.ts` | Answer groundedness |
| `metrics/retrieval.ts` | precision@5 / MRR |
| `metrics/guards.ts` | Guard precision on seeded violations |
| `metrics/modality.ts` | Correctly-declined hypotheticals |
| `ablation/toggles.ts` | The 11 switches |
| `ablation/run.ts` · `ablation/table.ts` | Delta table generation |
| `corpus/index.ts` · `labels.ts` · `loader.ts` | Corpus loading and ground-truth schema |

---

## 15. `tests/`

| Path | Covers | Gate |
|---|---|---|
| `setup.ts` | jsdom + localStorage shim | — |
| `helpers/events.ts` · `fixtures.ts` · `graph.ts` | Event builders, corpus loader, graph builders | — |
| `unit/substrate/*` | Event validation, fold purity, bi-temporal ordering, resolution ladder, hash chain, portability round-trip | G1 |
| `unit/extraction/*` | Normalisation, episode segmentation, decisions, **premises**, OUT-list recovery, alternatives, provenance, snippet validation, confidence, voting | G1 |
| `unit/reasoning/*` | Labeller, **non-monotonic OUT-list**, well-foundedness, gates a/b/c, backtracking, nogoods, **cascade stop condition**, entrenchment + EE3 cap, screening, proposals | **G2** |
| `unit/retrieval/*` | All five levels, RRF determinism, reranking, classifier verdicts, pre-emption, evidence contract, groundedness, citations | G3 |
| `unit/guards/*` | Templates, all six deterministic evaluators, metrics, baseline/ratchet, **feedback into `REVISE()`**, CI export | G4 |
| `integration/full-pipeline.test.ts` | Fixture → extract → review → reason → revise | G2 |
| `integration/gate-c-cascade.test.ts` | **The headline test**: falsify `single-user` → WLD-0007 UNSOUND → WLD-0011 cascades → WLD-0019 survives | **G2** |
| `integration/keyless.test.ts` | The entire G2 path with **no key and no network** | G2 |
| `integration/round-trip.test.ts` | Export → import reproduces identical state and head hash | G5 |
| `e2e/demo-script.test.ts` | The demo beats, in order, as an executable script | G6 |

---

## 16. `fixtures/`

| File | Purpose |
|---|---|
| `demo-transcript.txt` | **Existing.** The Oct-3 transcript with the SQLite/auth/Vite/JSON-embeddings/testing decisions |
| `demo-transcript-2.txt` | **To write (Phase 7.5).** Falsifies the `single-user` premise **without ever mentioning databases** — *"the sync worker writes while the UI writes"* |
| `messy-01…05.txt` | Adversarial tier: tool noise, no speaker markers, interrupted turns |
| `adversarial-01…03.txt` | Hypotheticals, unaccepted agent proposals, reversed decisions, near-duplicate restatements |
| `package-clean.json` | Guards pass |
| `package-with-pg.json` | `dependency_absent: pg` fails → compliance drops → gate (a) fires with no model |
| `file-listing.txt` | Virtual-project file list |
| `expected/extraction.json` | Ground truth for the demo transcript |
| `expected/cascade.json` | Expected flips **and expected survivors** |
| `expected/answers.json` | Expected verdicts, including one `INSUFFICIENT EVIDENCE` |

---

## 17. `scripts/`

| File | Purpose |
|---|---|
| `export_guards.ts` | Emits and runs the guard set — backs `npm run guards:ci` |
| `seed-demo.ts` | Loads the demo fixture into a fresh log (one-click demo reset) |
| `build_ontology_report.ts` | Reports `OTHER`-variable rate and unresolved-value rate |

---

## 18. `reference/` — pre-drafted contracts (now moved)

The three pre-drafted type files were moved into `src/types/` when Phase 0 started, and four more
were written alongside them. `reference/MOVED.md` records the move.

| Was | Now | Contents |
|---|---|---|
| `reference/types-common.ts` | `src/types/common.ts` | Branded ids, `EngineId`, `Actor`, `BiTemporal`, `ValidityWindow`, `SourceSpan`, `Confidence` |
| `reference/types-events.ts` | `src/types/events.ts` | The **closed event vocabulary** (36 types), payloads, `EventPayloadMap`, `TypedEvent<T>`, validation rules |
| `reference/types-domain.ts` | `src/types/domain.ts` | `DecisionLabel`, `DecisionStatus`, the 14 variables, the **closed set of 8 premise types**, `Premise`, `RejectedAlternative`, `Decision`, `Justification`, `Nogood`, `Episode`, `DecisionKnowledgeBase` |
| — | `src/types/guards.ts` | 8 guard kinds, per-kind specs, `Guard`, `VirtualProject`, metrics, baseline ratchet |
| — | `src/types/retrieval.ts` | Index levels L1–L5, `IndexArtifacts`, ranked/fused hits, the 5 verdicts, the evidence contract |
| — | `src/types/reasoning.ts` | Entrenchment weights, cascade and backtrack results, nogoods, the seven-part `RevisionProposal` |
| — | `src/types/export.ts` | Export targets, budget and priority weights, `IntegrityStamp`, `CompiledArtifact` |
| — | `src/types/index.ts` | Barrel |

Two deviations from the original map, both deliberate and both recorded in
[`notes/PHASE-0-NOTES.md`](notes/PHASE-0-NOTES.md): the event vocabulary is **36** types rather than
35 (`GuardRan` and `GuardFailed` are separate so a failure carries its own evidence fields), and
`src/lib/hash.ts` uses a **synchronous non-cryptographic hash** rather than WebCrypto SHA-256, so
that `fold()` can stay pure and synchronous.

---

### 18.1 Phase 1 deviations

| Planned file | Delivered as | Why |
| --- | --- | --- |
| `ai/local/normalize.ts` | `extraction/normalizer.ts` | Normalisation is mechanical and **shared by both engines**. Putting it under `ai/local/` would have forced the LLM path to import the local engine's internals or duplicate it |
| `ai/local/segment.ts` | `extraction/segmentation.ts` | Same reason |
| `ai/local/cues.ts` | `extraction/cue-scan.ts` | Same reason |
| `ai/local/decisions.ts` | `extraction/decisions.ts` | Same reason |
| `ai/local/premises.ts` | `extraction/premises.ts` | Same reason |
| `ai/local/lexicon.ts` | `ai/local/value-phrase.ts` | Synonym folding already lives in `ontology/canonicalize.ts` with ~560 aliases. What is local-only is *finding which words in a sentence are the value*, so the file is named for that |
| *(not planned)* | `extraction/{lines,episode-position,commit-report}.ts` | `lines.ts` breaks the `speakers.ts` ⇄ `speakers-fallback.ts` import cycle; `episode-position.ts` is the one place that reasons about all three coordinate systems; `commit-report.ts` keeps string-building out of the write path |
| *(not planned)* | `ontology/data/exclusions.ts` | The **OUT-list vocabulary**. `premise-linker.ts` derives an excluded condition from each supporting predicate, which is what makes gate (c) — invalidation by the world rather than by contradiction — possible at all |
| *(not planned)* | `ai/prompts/extraction.ts`, `ai/providers/openai-compatible.ts` | §5 listed `ai/prompts/` and `ai/providers/` as directories without naming their Phase 1 files |
| `views/ImportView.tsx` | `views/ReviewView.tsx` | Import and review are one screen: the queue is empty until something is imported, and a separate import view would be a form with nowhere to go |

`decision-cues.ts` grew from 85 to 120 cues during Phase 1. The additions are
dialogue patterns the original table was missing — human acceptance of a proposal
the agent just made ("deal.", "fine,"), future-tense commitment ("we'll do", "we're
dropping"), the conditional recommendation ("I'd use", `speculative: true` so it
cannot be read as an assertion), and the conclusion of a Socratic exchange ("then
no ", "is pure cost"). The fixture audit that found the gap is in
`notes/PHASE-1-PLAN.md`.

### 18.2 Phase 2 deviations

§7 lists the reasoning layer file-for-file and every one of them exists as named. Four
deviations, all deliberate:

| §7 / §5 said | Built instead | Why |
|---|---|---|
| `gates/index.ts` — "any-fired **short-circuit**" | **No short-circuit.** All three gates run; results are unioned and de-duplicated by `(gate, decision, otherDecision, premise)`. | A structural contradiction would hide a premise invalidation on the same decision, and the two have **different remedies**: "you disagree with yourself" vs "the world moved". A user told only the first fixes the wrong thing. The plan's own diagram asks "any gate fired?" *after* the three, not between them. |
| `revise.ts` — "single entry point for transcripts, user decisions, guard results and repo scans" | **Split in two.** `assert.ts` is the four-kind entry point (the `switch` on `source` lives there and nowhere else); `revise.ts` is the nine-step cycle and never sees the source. | §2.1's acceptance criterion is that all four kinds produce a cycle "with no branching in the reasoning code". One file doing both would put the branch inside the reasoner. Splitting it makes the criterion structural rather than a promise. Also: ASSERT must be committed and folded **before** the labeller runs, so the two are separate batches by necessity — see `notes/PHASE-2-NOTES.md` §2.8. |
| §5 dropped `ai/local/classify.ts` (recorded in §18.1) | **Added back**, at `src/ai/local/classify.ts`. | §2.11 specifies NLI-style rules for the local engine's gate (b), and `ai/local/index.ts` carried an explicit `Phase 2 adds the classifier here` stub. Four rules, no model. A fifth rule — negation across *different* variables — was written and **removed**: it fires on "no auth needed" beside "use SQLite", which is risk R3. The rejection is recorded in the file. |
| §11 / §13 did not list them | **`store/reasoning.ts`** (681 L) and **`views/ReasoningView.tsx`** (1004 L). | The store is the only place in Phase 2 that can write to the log, which is invariant I4 mechanically enforced rather than by convention. The view is the G2 demonstration surface; without it the phase is not demoable. `App.tsx` now routes `reasoning` second, after `review`. |

**One file added that §7 does not list:** `reasoning/graph-index.ts` (124 L). The graph is
**bipartite** — `Justification.consequent` is a `DecisionId` and its lists are `PremiseId`s,
so a premise is never a consequent and every premise is an assumption. Three modules were
first written as though premises could be conclusions and referenced fields that do not exist
(`premise.justifications`, `premise.informant`). This file records the real shape, builds the
two indexes a traversal needs in one pass instead of `O(D² × J)` scans, and holds the
`isDerivedPremiseText` marker that recognises Phase 1's OUT-list exclusions by TEXT, which is
the only way they are marked. See `notes/PHASE-2-NOTES.md` §0.

**Ordering deviation inside the cycle:** ADJUDICATE runs **before** BACKTRACK and CASCADE, not
after as §2.1's diagram draws it. A *refused* newcomer produces no backtracking and no cascade,
because nothing is retracted — screening first is what stops a passing remark from triggering a
retraction run. The diagram shows the data flow for an *accepted* newcomer.

**Resolution goes through the fold's own index.** `assert.ts:resolvePremise` reads
`state.premiseByFingerprint` rather than scanning `state.premises`, so the reasoner and the
fold cannot disagree about premise identity. That disagreement is §2.5's "confident,
spectacular, entirely wrong cascade", and it would otherwise arrive through the front door.

**Contracts reused, not re-derived:** `types/reasoning.ts` already fixed `BacktrackResult`,
`CascadeResult`, `CascadeStep`, `NogoodRecord`, `AdjudicationOutcome`, `RevisionProposal`,
`EntrenchmentBreakdown`, `ENTRENCHMENT_WEIGHTS`, `RECENCY_HALF_LIFE_DAYS`,
`UNKNOWN_IMPLEMENTATION_COST` and `entrenchmentBand`. Phase 2 imported all of them verbatim.

---

## 19. Counts

| Area | Directories | Files |
|---|---|---|
| Setup (written) | 4 | 19 |
| `src/substrate` | 2 | 20 |
| `src/ontology` | 2 | 10 |
| `src/ai` | 4 | 26 |
| `src/extraction` | 2 | 21 |
| `src/reasoning` | 2 | 14 |
| `src/retrieval` | 3 | 19 |
| `src/guards` | 5 | 24 |
| `src/export` | 4 | 18 |
| `src/store` + `src/lib` | 2 | 13 |
| UI (components + views) | 12 | 71 |
| `src/eval` | 4 | 21 |
| `tests` | 8 | 26 |
| `fixtures` | 1 | 14 |
| `scripts` | 1 | 3 |
| **Total** | **59** | **~320** |

---

## 20. Build order against this map

Follow [`plan/OVERVIEW.md §5`](plan/OVERVIEW.md). Concretely:

1. Move `reference/*.ts` → `src/types/`.
2. `src/lib/` — ten small pure utilities, no dependencies on anything.
3. `src/ontology/data/` — the vocabulary. **Do this before any extractor.**
4. `src/substrate/` — event log, fold, bi-temporal, identity, hash chain.
5. `src/ai/local/` — the default engine.
6. `src/extraction/` — then `src/reasoning/` gates (a) and (c).
7. Stop and run **gate G2** before building anything else.

### 18.3 Phase 3 deviations

Recorded here rather than silently reconciled, because a plan and an implementation that
disagree without a note is how the next person reintroduces the bug.

| # | Plan says | Built | Why |
|---|---|---|---|
| 🔴 1 | §3.6 lists five classifier rules "in order": reversal, negation, refinement, **antonym pair**, neutral | Antonym pair moved to **first** | As written, rule 4 is **unreachable**: an antonym pair IS a differing value on a shared variable, so rule 1 always fires first. §3.6's own acceptance criterion requires all five verdicts to be individually testable, and an unreachable rule is not testable. The reordered semantics are also the correct ones — two declared-mutually-exclusive choices both live is a genuine conflict, while a non-antonym value change is a deliberate reversal that should not land in the conflict queue. |
| 🟠 2 | §2.11 (Phase 2) and §3.6 (Phase 3) each specify the classifier rules | **One rule engine**, in `retrieval/contradiction.ts`; `ai/local/classify.ts` collapsed from 253 → 90 lines and now delegates | Two implementations of one judgement is exactly the failure the Phase 2 audit found in the adjudicator (gap 3): a detector and an adjudicator whose rules disagreed, so a newcomer could be ACCEPTED while gate (a) reported a contradiction. The import points up a layer (`ai` → `retrieval`) deliberately; the dependency is on pure functions with no state or I/O, and there is no cycle. |
| 🟠 3 | §3.6 places the hypothetical guard in the classifier | Guard lives in `contradiction.isClassifiable`, applied by the **pipeline** | `DecisionSnapshot` carries no lifecycle status — that is the only field saying whether a decision is settled. An engine told "don't classify this" must invent a verdict to return; never being asked does not. |
| 🟡 4 | §8 lists 18 files in `src/retrieval/` | **19** — `candidates.ts` added | Gate (b) needed a candidate generator and `gates/semantic.ts` takes one as an injected function. It belongs in the retrieval layer (retrieval proposes, the gate disposes) and reads the L1 vectors already in the index, so gate (b) runs keyless with zero embedding calls. |
| 🟡 5 | Phase 0 left `templateCompose` inline in `ai/local/index.ts` with a note that Phase 3 would replace it | Extracted to **`ai/local/compose.ts`**, all five `CompositionKind`s | The Phase 0 comment named the file. Templates emit every sentence with its decision id inline, which is what lets `answer.ts` attribute claims to citations by the **same rule** it applies to an LLM's prose — so groundedness is measured identically on both paths instead of the local path being granted 1.0 for having a composer that cannot lie. |
| 🟡 6 | §3.7 specifies ≤3 bounded searches but not what they search for | Three searches with **distinct purposes**: the question as asked → expansion by shared premise → re-query in the premises' vocabulary | A budget of three identical searches is just a retry loop. Search 2 exists because decisions sharing a `given` often answer a question whose wording does not match; search 3 because the question's vocabulary may not be the log's. |
| 🟡 7 | §3.10 requires pre-emption on alternatives with a `whyRejected` AND human confirmation | Both conditions enforced (`preemption.ts`), plus `countPreemptions` reporting the gap | The second condition was nearly missed. At Phase 1's measured 15.4% alternative precision, an unconfirmed inferred rejection is more likely wrong than right, and a false pre-emption costs more trust than every correct one earns back. |
| 🟡 8 | §3.5's weights are fixed constants | `RERANK_WEIGHTS` is `Object.freeze`d but the reranker also accepts `forceLocal` | Phase 7's ablation has to measure what the reranker actually contributes, and an ablation that requires editing source is an ablation that does not get run. |

**Fixed during the build (not plan deviations, but bugs found and corrected):**

- `rerank/index.ts` `orderWithPromotion` had a dead condition — `.filter((id) => !promoted.includes(id) || true)` is always true, so the "promoted candidate the reranker never returned" group was never actually appended. Rewritten as three explicit groups with a `seen` set.
- `store/reasoning.ts` used `CandidatePair` as a return type without importing it. **The structural checker cannot see this** — it verifies that imports resolve and named exports exist, not that every identifier used is declared. A heuristic scan over all 24 Phase 3 files (comments and strings stripped) found it and nothing else.
- `store/ask.ts` initially called `recordBatch(drafts, actor, now)` with three positional arguments; the real signature is `recordBatch(drafts, { reason, actor, occurredAt })`, and `IndexRebuilt` is one of the 19 state-changing events that requires a non-empty `reason`.
- `understandQuery` initially iterated `VARIABLES` expecting `VariableMeta[]`; it is `readonly DecisionVariable[]`. Switched to `variableKeywords()` + `variableMeta()` + `VARIABLE_ORDER` from `ontology/data/variables`.
- `expandBySharedPremise` takes and returns `DecisionId[]`, not premise matches.

### 18.4 Phase 4 deviations

| # | Plan says | Built | Why |
|---|---|---|---|
| 🟠 1 | §9 listed 27 files in `src/guards/` | **29** — `templates/storage.ts` and `eval/types.ts` added | The plan's own synthesis diagram names STORAGE as a fifth variable with its own rule ("STORAGE → artifact present"); folding it into `generic.ts` would bury a real rule inside the catch-all. `eval/types.ts` holds the evaluator's return shape and the four shared SKIP reasons, which six evaluator files import — defining it in `eval/index.ts` would make every evaluator import from the module that imports them. |
| 🟠 2 | §4.2 says templates cover ~80% | Templates cover **five variables specifically and all fifteen generically** | The ≥80% claim does not come from writing more per-variable templates. It comes from `generic.ts`'s three variable-agnostic strategies, especially `generic-rejected`: whatever the variable, a rejected alternative should not have appeared in the tree since. That one rule needs no knowledge of the variable at all, and it is the reason coverage is not five slots deep. |
| 🟡 3 | §4.7 says the user can "edit" a guard | Editing is **delete + re-synthesise**, two events | The closed 36-type vocabulary has no `GuardEdited`, and adding one would let a spec change without a record of the spec it replaced. A guard quietly weakened after it started failing would be indistinguishable from one that was fixed. The replacement is marked `generatedBy: "user"` and is PROPOSED again — an edit does not inherit acceptance, because that would activate a check nobody reviewed. |
| 🟡 4 | §4.4's baseline pattern | Baselined failures still emit `GuardFailed`, but produce **no revision proposal** | Recording and asserting are different acts. The event belongs in the log either way; firing a proposal for a violation that predates the guard would fill the queue with things the user already knows about, on the first run — the wall of red the baseline exists to prevent, arriving by another route. |
| 🟡 5 | §4.5's `falsifiesPremiseId` | Attributed only when **exactly one** premise matches | Vocabulary overlap is a weak instrument and is treated as one. Zero matches → gate (a) as structural drift. Several → reported as ambiguous and handled by gate (a), because guessing produces precisely the "confident, spectacular, entirely wrong cascade" §2.5 warns about. |
| 🟡 6 | §4.1 lists guard record fields | `disabledByDecisionLabel` is maintained by the **fold**, on `LabelChanged` | `materialize.ts` set the field at `GuardSynthesised` and never touched it again, so it went stale the first time a decision's label changed. The interpreter also checks the live label, so a stale field could not make a disabled guard RUN — but it could make an exported CI guard wrong, which is why both exist. |
| 🟡 7 | §4.6 CI export | `command_exit_zero` IS exported; `llm_judge` is not | CI has a shell, which the browser does not, so a command guard is exactly at home there. A judged guard cannot fail a build reproducibly, so exporting it would put a non-deterministic verdict in the exit code. |

**Pre-existing bugs found by a string-aware scan for undeclared identifiers, and fixed:**

The structural checker verifies that imports RESOLVE and that named exports EXIST. It cannot see
that an identifier is used without being declared — which is a hard compile error. Scanning all
186 source files with comments and strings stripped found four, three of them pre-dating Phase 4:

- `store/reasoning.ts` used `NewEvent<EventType>` with **neither** name imported. Present since Phase 2.
- `ai/llm/index.ts` called `performanceSafeNow()` in six places; it was declared only in
  `ai/local/index.ts`, where it is private. Present since Phase 1. Now `monotonicNow` in
  `lib/format.ts`, shared by all three modules that measure durations.
- `ai/llm/index.ts` used `ProposedGuard` and `validate` with no import (introduced during this
  phase by a patch whose target string did not match, so it silently no-op'd).
- `guards/index.ts` called `describeTaxonomy()` while only re-exporting it. **A re-export does
  not bind the name in the exporting module** — the same trap as `export * as ns` not flattening.

**Checker hardened.** `_strip_comments` was a regex `/\*.*?\*/` substitution, which is not
string-aware. `templates/hosting.ts` contains the glob `"**/*serverless.yml"` and
`templates/database.ts` contains `"postgres://"`; the stripper treated the `/*` inside the glob
as a block comment opening and ate everything to the next `*/`, deleting the `export function`
declaration that followed. The checker then reported a missing export that was plainly there —
worse than reporting nothing, because it sends you looking for a bug in the source instead of in
the checker. It is now a character scanner that tracks string state, and strips line comments too.
Globs like `**/*` are common in this codebase, so this would have recurred constantly.

<<<<<<< 800657a
=======
### 18.5 Phase 5 deviations

| # | Plan says | Built | Why |
|---|---|---|---|
| 🟠 1 | §10 listed 21 files in `src/export/` | **22** — `emitters/shared.ts` added | Three agent targets all want the same record; only the FILE differs. Rendering the record three times would mean a record that reads differently in `CLAUDE.md` than in `AGENTS.md` — two agents following the same log would disagree about the same decision. This pushes the intermediate form's guarantee one level down: not only does no emitter read the graph, no emitter renders a record either. |
| 🟠 2 | §5.1 describes one CIF | **Two**, from one graph in one pass | DECISIONS.md must carry superseded and OUT decisions (§5.3: "nothing is emitted for SUPERSEDED decisions except in DECISIONS.md"), and must not obey a token budget — a human document is not read into a context window. One CIF cannot be both filtered and unfiltered. Both are built from the same snapshot in the same call, so the single-pass guarantee holds; what changed is that emitters are pure functions of *a* CIF, not of *the* CIF. |
| 🟠 3 | §5.2 lists `.cursorrules` / `.cursor/rules/*.md` | `.cursorrules` only | The per-rule-file layout is a directory of files with front-matter globs, not a single artifact — a different output shape and a different download flow. Recorded in the emitter's header as a v2 target rather than half-implemented, because a partial version would emit files Cursor does not read. |
| 🟡 4 | §5.5's stamp carries a content digest | The digest covers the artifact **body, excluding the stamp** | A digest cannot cover the stamp that contains it — that is circular. `renderStamp` digests the body; `verifyStamp` strips the stamp before digesting on the way back in, so the two agree. Digesting a placeholder instead would produce a stamp that fails verification the moment anyone checks it, which is worse than no digest. |
| 🟡 5 | §5.7 says DECISIONS.md and the JSON export are both re-importable | Both, with **different fidelity, stated** | The JSON path is exact — it is the event log itself, and `substrate/portability.ts` already replays it with chain verification. DECISIONS.md is lossy by nature: it never carried snippets, spans, confidence or learned times, so they cannot come back. `round-trip.ts` says so in the merge plan rather than implying a faithful round trip. Claiming exactness for Markdown would be the same category of error as faking a cross-encoder result. |
| 🟡 6 | §5.3's verify command | Two shapes, chosen by guard kind | All-dependency guards get a self-contained `node -e` one-liner that runs anywhere with Node and installs nothing. Anything needing glob or word-boundary matching delegates to the exported runner, because reimplementing `lib/glob.ts` semantics inside a string literal would be a second copy that could drift — the exact risk §5.1's single-pass rule exists to remove. |
| 🟡 7 | — | `guards/ci-export.ts` runner gained `--decision <id>` | The exported verify commands invoke that flag. Without support the runner would ignore it and evaluate every guard, so a check on one decision would pass or fail on the strength of the others — and exiting 0 for a decision it never filtered to is the dangerous direction. Added to Phase 4's runner rather than a second runner, because two runners would drift. |

**Bugs found and fixed during the build:**

- `store/guards.ts` (Phase 4) stamped the CI export with `whylog.log.head?.hash`. `EventLog` has no
  `head` object — the field is `headHash`. The optional chain made it silently `undefined`, so
  **every CI export was stamped `"unknown"`**: a runner whose provenance is unknown cannot be tied
  back to the log that produced it, which is the entire reason it carries a head hash.
- `emitters/shared.ts` called `renderStatus` without importing it — the same checker blind spot as
  the four Phase 4 cases. Found by the string-aware undeclared-identifier scan.
- `round-trip.ts` first used a **module-level mutable array** to collect rejected-alternative rows.
  Parsing two files in one session would attribute the first file's rejections to the second file's
  decisions, invisibly, because each parse would look individually plausible. Now local to the call.
- `round-trip.ts` took the source head hash from `verification.found`, which is **inverted**: a
  successful verification reports no `found` hash, because nothing was wrong. `MergePlan` now
  carries `sourceHeadHash` from the parsed stamp.
- `compiler.ts` had `formatExportId(state.counters.exports ?? 0 + 1)` — operator precedence makes
  that `?? 1`, so every export in a session would have taken id `X-0001`.
- `ci/index.ts` first fabricated a stamp full of zeros for the CI artifacts. It now receives the
  same `IntegrityStamp` the documents carry: a second opinion about the log's counts would disagree
  with the first the moment either was computed after a mutation.

### 18.6 Phase 6 deviations

| # | Plan says | Built | Why |
|---|---|---|---|
| 🟠 1 | §6.5 is a `Conflict` view; the nav had a `conflict` entry | **Retired.** `ReasoningView` (Phase 2, 1,199 lines) already renders the seven-part proposal surface | Phase 2 built §6.5 as its gate-G2 surface: what failed, the evidence quote, the nogood, the cascade with survivors distinguished, the entrenchment breakdown, "why not auto-applied", and the re-justification composer. A second Conflict view would be a second implementation of one screen, and the two would drift apart about what a proposal says. Documented in `App.tsx` at the point where the entry used to be. |
| 🟠 2 | §6.8 lists `cascade depth cap` and `confidence-tier thresholds` as settings | They were **inert end to end**, and are now real | `SettingsState` declared `setThresholds` and `setCascadeDepthCap` as `() => {}`. Worse, `cascade()` accepted a `depthCap` parameter that **no call site ever supplied**, so every run used `MAX_CASCADE_DEPTH` regardless. Added a persisted `useTuning` store (`whylog:settings:v1`), a `ReviseInput.cascadeDepthCap` field, and the missing argument at the `revise()` call site. A settings panel that renders a control which cannot change anything is worse than no control. |
| 🟡 3 | §6.6's lattice with a force-layout library "for positioning only" | **No layout library.** Deterministic columns by premise type, decisions at the barycentre of their premises | A force layout is not reproducible: positions settle differently each render, so two screenshots of one log differ, a cascade animation moves the nodes being watched, and "the lattice at time T" would not look like the lattice the user remembers. Determinism is what makes the visual usable as evidence rather than decoration. |
| 🟡 4 | §6.7's time machine with two sliders | Both, but they are computed **differently**, and the view says so | Learned time is a genuine prefix fold via `materializeAsOf`. Valid time **cannot** be a prefix fold — events are stored in learned order, so cutting by index would drop a decision made in January but recorded in October. Valid time filters the current graph by validity window instead, which is the definition of "true at T". Presenting both as the same mechanism would be wrong about one of them. |
| 🟡 5 | §6.9's keyboard: `⌘K` · `N` · `P` · `Esc` | Those four **plus `G`** for the lattice | The lattice is the signature visual and the one thing a judge should be shown; a keystroke to reach it is worth more than a keystroke for anything else. Bindings never fire inside an editable element — a single-letter binding that does makes the product unusable, and the bug is invisible until someone types the word "no" into a search box. |
| 🟡 6 | §6.2 lists 10 components in `components/decision/` | **6** — the five small sections share `sections.tsx` | Y-statement, alternatives, accepted downside, guard summary and relations are each under 30 lines of markup reading one field off the decision. Ten files would make the card's structure harder to see, not easier, and the plan's density risk is about the rendered card rather than the file count. The four sections that carry an argument — RESTS ON/EXCLUDES, PROVENANCE, ENTRENCHMENT, AUDIT — each have their own file. |
| 🟡 7 | §6.6 lists `AntiHairballFilter` as a component | It is a **module**, not a component | The rules are applied in `LatticeLayout`, before positioning. Filtering at render time would leave the layout reserving space for hidden nodes, producing gaps that read as missing data. The module owns the rules and reports what was withheld; it renders nothing. |
| 🟢 8 | — | `emitters/shared.ts` pattern repeated: `components/graph/LatticeHighlight.ts` added | Not in §12's component list, but highlighting is the interaction half of the anti-hairball rules and needs its own module so the layout and the interaction cannot disagree about what "connected to this node" means. |

**Checker hardened again.** `resolve()` did not understand Vite's `?raw` query suffix, so
`import demoTranscript from "../fixtures/demo-transcript.txt?raw"` was reported as an unresolved
import — a path that resolves perfectly at build time. It now strips the query before resolving.
The declaration in `vite-env.d.ts` is deliberately narrow (`*.txt?raw` only): a blanket wildcard
would let any file be silently inlined into the bundle, and the one thing that must never be
inlined is a config file containing a key.

**Pre-existing bugs found and fixed:**

- `store/settings.ts` had `void reloadFrom;` — the banned pattern, discarding a function that was
  written to be used. `reload()` was therefore `() => {}`.
- `ProvenanceBlock.tsx` first read `span.episodeId`. `SourceSpan` has no such field — `episodeId`
  lives on `Provenance`. The same class of error as Phase 4's `log.head?.hash`: an optional chain or
  a plausible field name turns a wrong reference into `undefined` rather than an error.
- `sections.tsx` had a `guardTarget` signature written as a conditional type over
  `Decision["appliesTo"]` that resolved to `never`. It now switches over the `GuardSpec` union, so a
  ninth guard kind is a compile error rather than `undefined` rendered into the card.
- `TimeMachineView.tsx` first called `useMemo` **inside a conditional** to supply an empty label map
  to the decision card. That breaks the rules of hooks and would desync on the render where the panel
  first appears — and an empty label map makes the card fall back to labels stored at extraction time,
  showing IN for a decision the replayed graph has already retracted.
- `GraphView.tsx` had a `require_layout()` indirection wrapping a top-level import. Removed.

>>>>>>> 1e61ad6
