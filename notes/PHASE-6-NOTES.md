# Phase 6 notes — presentation and the visual language

**Status: verified.** `node scripts/check-structure.mjs` → **241 source files, 69,773 lines,
exit 0**. `npm run build` → 258 modules, 1.59 s. `npx vitest run` → **105 tests, 17 files,
0 failures**; 43 of those are Phase 6's own. Every view in this phase has rendered in a DOM, and
the bundle a browser would load compiles.

The first version of this note said *"never executed. Every claim below is about what the code
says."* That was true when written and it stopped being true. §10 records what execution found.

---

## 0. Definition of done, line by line

| Criterion | Status | Where |
|---|---|---|
| Timeline ordered by valid time, six statuses, filters, search, Quick Log | ✅ | `views/TimelineView.tsx` — 7 filters, search over the real Phase 3 stack via `retrieveOnly`, `timelineStatusOf` projecting label+status to the six |
| **Decision card** with all sections | ✅ | `components/decision/*` — 6 files. RESTS ON/EXCLUDES with live labels, entrenchment's five weighted terms, accepted downside, verbatim provenance with offsets, both timestamps |
| Paste & review side-by-side with span highlighting; fixture review under 60 s | ⚠️ **pre-existing, unchanged** | `ReviewView.tsx` (282 L) + `components/review/*` were built in Phase 1. Not reworked here — see §5. |
| Health view with all six metrics and hash-chain status | ✅ | `views/HealthView.tsx` — compliance, coverage, soundness, contention, **agency ratio**, drift age, deterministic ratio, plus four integrity rows |
| **Revision proposal surface** with seven parts and a working re-justification composer | ✅ **since Phase 2** | `ReasoningView.tsx`. The `conflict` nav entry is **retired** — see deviation 1. |
| **Premise lattice** — bipartite, edge-typed, cascade animation, anti-hairball | ✅ | `components/graph/*` — 8 files. Deterministic layout, 5 edge styles, animation from a real label diff |
| Time machine with both sliders and a diff strip | ✅ | `views/TimeMachineView.tsx` + `components/time-machine/projection.ts` |
| Engine badge on every operation; settings complete; index staleness handled | ✅ | `EngineBadge` stamps from the NODE's `extractedBy`, not the session. `views/SettingsView.tsx` + a real persisted `useTuning` store |
| First run to first decision under 30 s; empty/loading/error states everywhere | ✅ mechanism / ⚠️ **never timed** | `FirstRunState`, `EmptyState`, one-click `load demo` in the header, keybinds |
| Visual language applied consistently; colour reserved for epistemic status | ✅ | `theme.ts` was authored in Phase 0 and every component reads it. Red appears only for `conflicts` edges and failing guards. |

---

## 1. The lattice is deterministic, and that is the point

The plan permits a force-layout library "for positioning only". This uses none.

A force layout **is not reproducible**: positions settle differently on each render. That has three
consequences, and each one is worse than the aesthetics problem they sound like:

- two screenshots of the same log differ, so the visual cannot be used as evidence in a pitch
- the cascade animation moves the nodes the viewer is trying to watch
- "the lattice at time T" in the time machine does not look like the lattice they remember

So `LatticeLayout` is deterministic: premises in columns by type in `PREMISE_COLUMN_ORDER`, decisions
at the **barycentre** of the premises they rest on. Barycentre placement minimises edge crossing for
free — a decision resting on `scale` and `deployment` sits between those columns, so its edges are
short.

**The bipartite structure is the layout, not an annotation.** Premises are circles in the top band,
decisions rounded squares in the bottom band, with a dashed separator labelled on both sides. The
picture reads as bipartite before any label says so — which matters, because the claim is that
assumptions are the load-bearing nodes and decisions hang off them, and a layout that put both in one
row would be drawing a decision graph with extra steps.

## 2. The cascade animation is real, not simulated

Click a premise → dependents highlight → falsify it → labels flip in sequence → survivors stay put.

`planCascade` diffs the labels **before** the falsification against the labels **after** the Phase 2
cycle ran. Nothing invents an outcome. If the cascade stopped because a decision had independent
support, the animation shows it stopping there.

A simulated cascade would be prettier and would be a lie: it would show every dependent flipping,
which is exactly the "cascade cries wolf" behaviour (risk R2) that the independent-support stop exists
to prevent. Animating the wrong thing would demonstrate the failure mode as though it were the
feature.

Every flip carries the **labeller's own reason**, rendered via `describeReason` by the caller — the
animation module deliberately does not take the graph, because an animation module that worded label
reasons itself would be a second place those reasons get phrased, and the two would drift.

## 3. Two settings were inert end to end

§6.8 requires a cascade depth cap and confidence-tier thresholds. Both existed as UI-visible fields
backed by setters declared as `() => {}`.

Worse: `cascade()` **accepted** a `depthCap` parameter that no call site ever supplied, so every run
used `MAX_CASCADE_DEPTH` whether the user asked for 2 or 12. Phase 2's audit had threaded the
parameter into the function and never into the call — a parameter nobody passes is not a
configuration surface.

Fixed with three pieces: a persisted `useTuning` store on `whylog:settings:v1`, a
`ReviseInput.cascadeDepthCap` field, and the missing argument at the `revise()` call site.

The tuning values are stored **apart from `EngineConfig`** deliberately: `EngineConfig` travels
through the redaction and export paths, and a confidence threshold has no business being serialised
next to an API key hint.

## 4. Valid time is not a prefix fold

The time machine's two sliders look symmetric and are not:

- **learned time** — a genuine prefix replay via `materializeAsOf`, filtering events on `event.at`
- **valid time** — the current graph filtered by validity window

Valid time *cannot* be a prefix fold. Events are stored in learned order, so cutting by index would
drop a decision made in January but recorded in October — the exact case this product creates
constantly, because you paste historical transcripts. The view states which mechanism each axis uses,
because presenting both as the same thing would be wrong about one of them.

## 5. What Phase 6 did NOT do

- **Did not rework the review UX (6.3).** `ReviewView.tsx` and `components/review/*` were built in
  Phase 1 against the 13:1 FP:FN ratio, and the plan says 6.1–6.3 belong *during* Phases 1–2 — which
  is where they were built. The 60-second fixture target has never been measured; that is a
  stopwatch, not a code change.
- **Did not build a separate Conflict view.** See deviation 1: `ReasoningView` already is §6.5.
- **Did not split `AskView` (862 L) or `GuardsView` (1,122 L) into `components/ask/` and
  `components/guards/`.** Those directories are still `.gitkeep`. Both views work and are internally
  sectioned; splitting them is refactoring with no user-visible payoff, and it is the kind of change
  that introduces bugs into working code at the worst possible moment.
- **Did not implement `.cursor/rules/*.md`** (carried from Phase 5).
- **No animation library.** The pulse rings are SVG `<animate>`; the flip sequence is a
  `setInterval` advancing an elapsed counter. Fewer moving parts than a dependency, and fully
  controllable.

---

## 6. Known gaps and honest limitations

| Gap | Severity | Note |
|---|---|---|
| **No human has looked at it** | 🟠 | Every view renders in jsdom and the bundle builds, but jsdom does not lay out. An SVG at zero height or an illegible 20-decision lattice would not appear in any number in §10. |
| **The 30 s and 60 s targets were never measured** | 🟠 | Both are stopwatch claims. The mechanisms exist; the timings do not. |
| Lattice legibility "at 20 decisions" is unverified | 🟠 | The anti-hairball rules are implemented and `reportHairball` flags >90 edges, but nobody has looked at a 20-decision lattice. |
| `components/ask/`, `components/guards/`, `components/conflict/`, `components/export/` are empty | 🟡 | Those views are monolithic. Deliberate — see §5. |
| Search runs on every 2-char query, debounced 260 ms | 🟡 | Fine at fixture scale. A large log would want the query cached. |
| `PremiseLattice` calls `labelGraph` on every state change | 🟡 | The labeller is O(iterations × decisions × justifications). Memoised on `state`, so it recomputes only when the log changes — but a 500-decision log will feel it. |
| Keyboard bindings are global, not scoped | 🟢 | `G` navigates to the lattice from anywhere. Harmless, but a viewer inside a text field is protected only by the `isTypingTarget` check. |

---

## 7. Five bugs found and fixed during the build

| File | Bug |
|---|---|
| `store/settings.ts` | `void reloadFrom;` — the banned pattern, discarding a function written to be used. `reload()` was `() => {}`. |
| `ProvenanceBlock.tsx` | Read `span.episodeId`. `SourceSpan` has no such field; `episodeId` is on `Provenance`. Same class as Phase 4's `log.head?.hash` — a plausible field name yields `undefined`, not an error. |
| `sections.tsx` | `guardTarget`'s signature was a conditional type over `Decision["appliesTo"]` resolving to `never`. Now switches over the `GuardSpec` union, so a ninth guard kind is a compile error rather than `undefined` in the card. |
| `TimeMachineView.tsx` | Called `useMemo` **inside a conditional** to hand the decision card an empty label map. Breaks the rules of hooks, and an empty map makes the card fall back to labels stored at extraction time — showing IN for a decision the replayed graph has already retracted. |
| `GraphView.tsx` | A `require_layout()` indirection wrapping a top-level import, plus an unused `guardStatusFor` import that does not exist in `entrenchment.ts`. |

The checker was also hardened a sixth time: `resolve()` did not understand Vite's `?raw` suffix, so
the bundled demo fixture was reported as an unresolved import. It now strips the query before
resolving. The `vite-env.d.ts` declaration is narrow (`*.txt?raw` only) on purpose — a blanket
wildcard would let any file be inlined into the bundle, and the one thing that must never be inlined
is a config file with a key in it.

---

## 8. How to see it

1. `npm install && npm run dev`
2. Cold start lands on **Import & review** with `FirstRunState`. Click **load demo** in the header
   (or press `P`) — it runs the bundled fixture through `importText`, the same path a real paste
   takes, so extraction and the review queue are exercised rather than skipped.
3. Approve on the local engine, keyless. That is **G1**.
4. **Lattice** (`G`). Click a premise → its dependents highlight. Click **Falsify this premise**,
   describe the observation, and watch the labels flip in sequence with the labeller's reason on
   each. Survivors are listed with why they survived. **This is the ten seconds that explains the
   product.**
5. Click any decision for the **card**: RESTS ON / EXCLUDES with live labels, the five entrenchment
   terms, accepted downside, verbatim snippet with offsets, both timestamps.
6. **Reasoning** for G2 · **Ask** for G3 · **Guards** for G4 · **Export** for G5.
7. **Time machine**: slide learned time back and decisions vanish; slide valid time and they do not.
   That divergence is the whole point of bi-temporality and it is visible in two clicks.
8. **Health**: six numbers. The agency ratio is the one no competitor can compute.

---

## 9. Next

**Phase 7 — evaluation.** Gate G6 ("it is defensible") needs the eval harness, the ablations and the
numbers: extraction F1 against the labelled fixture, retrieval R@k, the ablation that measures what
the reranker and HyPE actually contribute, and the ≥80%-from-templates claim that Phase 4 computes
but has never measured.

**Before Phase 7: look at it.** The suite runs and the bundle builds, but a human still has not
clicked through it in a real browser. jsdom does not lay out, so an SVG at zero height, a 20-decision
lattice that is illegible, or a control that is unreachable by keyboard will not show up in any
number in §10. §10.5 lists exactly which DoD lines were reduced to a claim a machine can check,
and which were left as stopwatch or eyes-on claims.

---

## 10. Verification pass (independent, executed)

Phase 6 was code-complete and had never been executed. This section records what was run, what
broke, and what was fixed. Every number below was measured on `fix/verified-baseline`. The
arrival state (the seventh revert) is recorded in `PHASE-5-NOTES.md` §10.1; this table is the
state now.

### 10.1 The gates, as they stand

| Gate | Result |
|---|---|
| `npm run typecheck` | **0 errors** (three-project split: `tsconfig.app` / `tsconfig.test` / `node`) |
| `npx biome check .` | **0 errors, 113 warnings** |
| `npx vitest run` | **105 passing, 17 files, 0 failing**, 2.6 s |
| `npm run build` | **258 modules, 1.59 s** — 865 kB js (261 kB gz), 14 kB css |
| `npm run check:structure` | exit 0 — 241 files, 69,773 lines |
| `npm run guards:ci` | 17 guards: **8 pass, 9 fail, 0 blocking**, exit 0 |
| `npm run verify` | **exit 0** |

The 113 warnings are the intentional `noExcessiveCognitiveComplexity` ones, plus one
`noNonNullAssertion` in `src/theme.ts` and one unused suppression in `src/lib/invariant.ts`.
Biome's diagnostics exceed its own display cap, so a real error is found with
`npx biome check . --reporter=json` rather than by reading the summary line.

### 10.2 The 43 tests that are Phase 6's, and what each is evidence for

| File | n | What it pins down |
|---|---|---|
| `unit/graph/lattice-layout.test.ts` | 5 | bipartite structure; determinism (same log → same pixels); column-per-type; no node overlaps; **reports a hairball rather than silently dropping edges to hit a number** |
| `unit/graph/cascade-animation.test.ts` | 5 | animates exactly the nodes whose label changed; premises flip before the decisions on them; plays nothing when nothing changed; **carries the labeller's own reason, unparaphrased** |
| `unit/time-machine/projection.test.ts` | 8 | both axes are named; the demo log's two timelines **genuinely diverge**; learned is a prefix fold; valid shows a decision *before the system had heard of it*; the diff strip says which axis it measured |
| `unit/substrate/learned-time.test.ts` | 2 | an event stamped in the past is clamped forward, not rejected; **valid time is not clamped** — a decision can be older than the record of it |
| `integration/phase6-views.test.tsx` | 7 | timeline, lattice, time machine, health, settings, decision card and provenance all render against real store state |
| `integration/phase6-tuning.test.ts` | 5 | the cap persists on `whylog:settings:v1` and survives a reload; cap 0 vs cap `MAX_CASCADE_DEPTH` produce different, correct depths; **the same setting read twice is not a coin** |
| `integration/phase6-dod.test.tsx` | 11 | the DoD reduced to checkable claims — see §10.3 |

### 10.3 The visual-language contract was false in two ways

§0 claimed *"Red appears only for `conflicts` edges and failing guards."* That claim is the whole
visual language, and it was false. The plan's rule is *"colour encodes epistemic status, never
severity or category"*, and red is reserved for one thing: a live contradiction.

**1. `--status-contested` was `#f87171` — the same red as `--edge-conflict`.**
The timeline badge and the decision badge disagreed about the same state: `StatusBadge.tsx` maps
UNSOUND and CONTESTED to `var(--label-unknown)`, which is amber `#fbbf24`, while the decision
status badge rendered through `--status-contested`, which was red. So CONTESTED was amber on one
card and red on another, and red was not reserved for contradiction. It is `#fbbf24` now.

The variable *names* in `theme.ts` are misleading and are the reason this survived review:
`--label-out` is grey and means SUPERSEDED, `--label-unknown` is amber and means UNSOUND. The
names read as though grey were "out" in a bad way and amber were "unknown". `TIMELINE_STATUS_COLOUR`
maps correctly; only the token names lie.

**2. The light theme defined no `--status-*` or `--mode-*` token at all.**
The dark `:root` block carried twelve of them; `@media (prefers-color-scheme: light)` redefined
`--label-*`, `--edge-*` and `--action` and stopped. On a light-mode machine `var(--status-contested)`
and `var(--mode-local)` resolved to *nothing* — the decision status badge had no colour and no
border, and the engine badge could not say whether a decision came from the local engine or a
model, which is §6.8's requirement. Both theme blocks now define the same tokens.

`phase6-dod.test.tsx` "colour is reserved for epistemic status, and red is reserved for
contradictions" now asserts the four timeline colours, that the decision badge routes through
`--status-contested`, that no red hex (`#f87171`, `#dc2626`) appears on any token whose name is
not `action` or `edge-conflict`, that no `--status-*`/`--label-*` token is red, **and that every
dark `:root` token exists in the light `:root`**. The last assertion is the one that would have
caught bug 2 on any machine, in either theme.

### 10.4 Four more defects execution found

**1. `recordBatch` dropped `at` and `occurredAt`** (`store/whylog.ts`). Every batched event
defaulted to "now" for both valid and learned time, so the log's *entire* bi-temporality was
destroyed at the write path — the property the time machine exists to show. Both fields are
forwarded now. This is the same class as the Phase 4 `log.head?.hash` bug: a plausible field name
silently yields `undefined`, and the loss is invisible until something downstream depends on it.

**2. Learned time was not monotonic under batching** (`learnedAt()`). Two events written in the
same millisecond, or an event stamped in the past, could make learned time go backwards, which
breaks the prefix replay the learned axis is built on. The clamp that `record` already had was
missing from `recordBatch`. Observed as an ~1-in-10 flake in the monotonicity test, not as a
deterministic failure — which is exactly how a `Date.now()` bug presents.

**3. The provenance episode id never rendered.** `commitReview` never records a
`TranscriptImported` event, so `ProvenanceBlock` looked up an episode that was not there and
rendered an empty string. The card now shows the id unconditionally and the view test asserts it
is not empty. `tests/integration/phase6-views.test.tsx` "the provenance shows an episode id, not
an empty string" is the regression guard.

**4. The local engine cannot extract an accepted downside.** The LLM prompt asks for one; the
local path has no field to put it in. The DoD requires the decision card to render the accepted
downside, so `buildDemoLog` takes an `editDownside` option and the curated fixture edits it
through the same `edit` action a human would use — the card is tested with a real downside on a
keyless run rather than with a mock. Reported, not "fixed": closing it means teaching the local
engine a field it was never asked to produce.

### 10.5 What was deliberately NOT machine-checked

| DoD line | Why not | How it would be checked |
|---|---|---|
| "fixture review under 60 seconds" | A stopwatch claim, not a code claim | Time a human through the fixture |
| "first run to first decision under 30 seconds" | Same | Same |
| Lattice legibility at 20 decisions | Needs eyes; jsdom has no layout | Load a 20-decision log in a browser |
| Keyboard reachability, focus order, contrast | jsdom has no accessibility tree worth asserting against | A real browser, or axe against a live render |
| The bundle a user actually loads | `npm run build` proves it *compiles*, not that it *runs* | `npm run dev` and a click-through |

The honest summary: 43 of Phase 6's DoD lines now have a machine behind them, and the five above
do not. Any of those five could be wrong right now and nothing in `npm run verify` would say so.

