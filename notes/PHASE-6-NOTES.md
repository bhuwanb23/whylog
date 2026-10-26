# Phase 6 notes — presentation and the visual language

**Status: code-complete.** `python3 scripts/check_structure.py` → **240 source files,
65,575 lines, exit 0**. `src/components/` is 28 files, 4,329 lines; `src/views/` is 10 views,
6,813 lines.

**Never executed.** No install, no build, no render. Every claim below is about what the code says.
React-specific failures — hook ordering, key collisions, an SVG that renders at zero height — are
exactly what a structural linter and two identifier scans cannot see, and this phase is almost
entirely React.

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
| **Nothing has rendered** | 🔴 | This phase is almost entirely React. Hook ordering, key collisions, an SVG at zero height, a CSS variable that does not exist in light mode — none of it is visible to the checker. |
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

**Before Phase 7: run the app.** Six phases and 65,575 lines have never been executed. Fourteen real
bugs were found in the last three phases by scanning alone — eleven of them the kind that compiles
to `undefined` rather than failing loudly. G1 through G5 are all built and none has been observed.
The first `npm run dev` is worth more than any further phase.
