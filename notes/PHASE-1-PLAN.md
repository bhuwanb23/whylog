# Phase 1 — Extraction pipeline: build plan

Working document for Phase 1. Read `plan/phase-1-extraction-pipeline.md` for the
requirements; this file records **how they map onto files**, the deviations from
`STRUCTURE.md`, and the build order.

---

## 1. The architectural decision that shapes every file

`STRUCTURE.md` §5 and §6 both list normalisation, segmentation and cue matching —
once under `src/ai/local/`, once under `src/extraction/`. Written as listed, that
is two implementations of the same three stages.

**Resolution: split by what the stage does, not by which engine calls it.**

| Layer | Owns | Files |
|---|---|---|
| `src/extraction/` | **Mechanical stages, shared by both engines.** Deterministic text work: normalise, attribute speakers, recover timestamps, collapse noise, chunk, segment episodes, capture provenance, validate snippets, resolve entities, score confidence, run the review gate, commit | 22 |
| `src/ai/local/` | **Recognition, local engine only.** The cue-and-lexicon reading of an episode into typed candidates | 9 |
| `src/ai/llm/` | **Recognition, LLM engine only.** Prompt, strict-JSON parse, three-run voting | 4 |

`LocalEngine.extract` is then a thin composition: `extraction/normalizer` →
`extraction/segmentation` → `ai/local/*` → `extraction/confidence` →
`extraction/provenance`. The LLM engine composes the same mechanical stages around
its own recognition.

**Files dropped from STRUCTURE.md §5**, all because the shared layer owns them:

| Was | Now |
|---|---|
| `ai/local/normalize.ts` | `extraction/normalizer.ts` (+ `speakers.ts`, `timestamps.ts`, `noise.ts`) |
| `ai/local/segment.ts` | `extraction/segmentation.ts` |
| `ai/local/cues.ts` | `extraction/cue-scan.ts` — **cue matching is shared**: the LLM path uses it to propose episode boundaries and to sanity-check a returned value |
| `ai/local/decisions.ts` | `extraction/decisions.ts` |
| `ai/local/premises.ts` | `extraction/premises.ts` |

Kept local-only, because they are genuinely the cue-driven reading of text:
`negation.ts`, `modality.ts`, `alternatives.ts`, `lexicon.ts`, `confidence.ts`.

Also kept for Phase 2, not Phase 1: `ai/local/classify.ts`, `ai/local/compose.ts`.

**Files added** that STRUCTURE.md did not list:

| File | Why |
|---|---|
| `extraction/types.ts` | The internal contracts (`NormalizedTranscript`, `EpisodeWindow`, `ExtractionRun`, `ResolvedCandidate`). Without one place to put them every stage invents its own shape and the offset map stops being honoured |
| `extraction/offset-map.ts` | 1.1's non-negotiable. Its own file because every other stage depends on it and it must be impossible to bypass |
| `extraction/y-statement.ts` | 1.3 component 6. Slot-filling is ~90 lines on its own |
| `extraction/index.ts` | Barrel — the only thing above L1 imports |

---

## 2. Build order

Ordered so that each step is runnable against the fixture before the next begins,
and so the load-bearing sub-phase (1.4) is measured as early as possible.

| # | Step | Files | Gate it satisfies |
|---|---|---|---|
| A | Contracts + offset map | `extraction/types.ts`, `extraction/offset-map.ts` | ✅ Done — `extraction/{types,offset-map,lines}.ts` |
| B | Normalisation | `speakers.ts`, `timestamps.ts`, `noise.ts`, `chunking.ts`, `normalizer.ts` | ✅ Done — `extraction/{speakers,speakers-fallback,timestamps,noise}.ts` |
| C | Segmentation | `segmentation.ts` | ✅ Done — `extraction/{normalizer,chunking}.ts` |
| D | Local recognition | `ai/local/{lexicon,negation,modality,cue-drive}.ts` | ✅ Done — `ai/local/{modality,negation,value-phrase}.ts` |
| E | Decision recovery | `extraction/{decisions,y-statement}.ts` | ✅ Done — `extraction/{decisions,y-statement,rationale,episode-position}.ts` |
| F | **Premise recovery ★** | `extraction/{premises,premise-linker}.ts` | ✅ Done — `extraction/{premises,premise-linker}.ts` + `ontology/data/exclusions.ts` (the OUT-list vocabulary) |
| G | Alternatives | `extraction/alternatives.ts`, `ai/local/alternatives.ts` | ✅ Done — `extraction/alternatives.ts`, `ai/local/alternatives.ts` |
| H | Provenance | `extraction/{provenance,snippet-validation}.ts` | ✅ Done — `extraction/{provenance,snippet-validation}.ts` |
| I | Resolution + confidence | `extraction/{resolution,confidence}.ts`, `ai/local/confidence.ts` | ✅ Done — `extraction/{resolution,confidence,voting}.ts`, `ai/local/confidence.ts` |
| J | Engine wiring | `ai/local/index.ts` (`extract` becomes real), `extraction/{pipeline,index}.ts` | ✅ Done — `ai/local/{extract,index}.ts`, `extraction/{pipeline,index}.ts` |
| K | Review model | `extraction/review/{index,diff,actions}.ts` | ✅ Done — `extraction/review/{index,diff,actions}.ts` |
| L | Commit | `extraction/commit.ts`, `store/extraction.ts` | ✅ Done — `extraction/{commit,commit-report}.ts`, `store/extraction.ts` |
| M | Review UI | `components/common/*`, `components/review/*`, `views/ImportView.tsx` | ✅ Done — `views/ReviewView.tsx` (wired into `App.tsx` as the default view) |
| N | LLM path | `ai/prompts/extraction.ts`, `ai/llm/{index,parse,voting}.ts`, `ai/providers/*` | ✅ Done — `ai/prompts/extraction.ts`, `ai/providers/openai-compatible.ts`, `ai/llm/index.ts` |
| O | Second fixture | `fixtures/demo-transcript-2.txt` | ✅ Done — `fixtures/demo-transcript-2.txt` (14 decision cues, 13 premise cues) |

**N is last on purpose.** The keyless path is the product; the LLM path is the
higher-recall option. Building M before N means G1 — the phase gate — is reachable
without an API key, which is the claim the whole project rests on.

---

## 3. Contract changes made before writing any Phase 1 code

All additive, all optional, so `SCHEMA_VERSION` stays at **1** and `MIGRATIONS`
stays empty: an event written before these fields existed still validates.

| Change | Why |
|---|---|
| `DecisionProposedPayload.yStatement?` | The Y-statement's slots come from the **episode**, and episode text is not on the node. Re-deriving it later would need the raw transcript |
| `DecisionProposedPayload.appliesTo?` | The fold set `appliesTo: []` unconditionally, so extracted globs were discarded |
| `DecisionProposedPayload.episode?` | Real `turnRange`/`charRange` from 1.2. Without it the fold synthesises an episode from the decision's own snippet and the review UI cannot show the negotiation that produced it |
| `materialize.ts` uses all three | Episode auto-creation prefers the real bounds; the node gets `yStatement` and `appliesTo` |
| `store/whylog.ts` `recordBatch` preserves `at`/`occurredAt` | **This was a real defect.** The draft mapping dropped both clocks, so a Phase 1 batch commit would stamp every imported decision with the moment of import instead of the transcript time — silently destroying the 0.3 bi-temporal split for the entire pipeline |
| `ai/types.ts` cleaned | Removed the `_SeamTypesReferenced` dummy union, the duplicated `ProposedGuard` import and three unused type imports (`verbatimModuleSyntax` + `noUnusedLocals` would fail on them) |
| `types/domain.ts` cleaned | Same for `_DomainTypesReferenced` |

---

## 4. Design rules for this phase

Written down because each one is a place the naive implementation goes wrong.

1. **The offset map is the only way to make a span.** No stage computes a character
   index by arithmetic on a transformed string. `offset-map.ts` is the single
   source of truth and every `SourceSpan` goes through `spanFrom()`.

2. **Nothing enters the log unreviewed.** `commit.ts` is the only module that
   builds `DecisionProposed`/`PremiseAsserted` events, and it only accepts items
   carrying a human action from `review/actions.ts`.

3. **Only `asserted` modality creates an IN-labelled node.** Enforced twice: once
   in `ai/local/modality.ts`, once in the fold. The fold is the authority; the
   extractor is the filter.

4. **Premises and alternatives are always one confidence tier below the decision
   they attach to.** Reflects the published precision gap (0.75 vs 0.15).

5. **Unattributable speaker ⇒ lowest authority.** `unknown` maps to
   `agent_inferred` (0.4), never to `human_stated` (1.0). Guessing high inflates
   entrenchment, and entrenchment decides what gets retracted.

6. **An alternative with no `whyRejected` is stored but never pre-empts.**
   Pre-empting without a reason is nagging.

7. **Discarded candidates are returned, not dropped.** They become
   `ExtractionDiscarded` events, which is the denominator of the precision metric.
   Dropping them silently makes the metric unmeasurable.

8. **Cross-type premise comparison is impossible by construction.** `premisePool()`
   pre-filters by type; `resolution.ts` never sees an unfiltered list.

---

## 5. Status

| Step | State |
|---|---|
| Contracts (§3) | ✅ Done |
| A–O | ✅ All fifteen steps written |
| `check_structure.py` | ✅ 108 source files, 31,334 lines, exit 0 |
| Local run against `demo-transcript.txt` | ⬜ **Not run — the user runs `npm install && npm run dev` locally** |
| Gate G1 | ⬜ Pending that run |
