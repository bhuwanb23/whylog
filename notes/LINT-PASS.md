# Lint pass + first ablation run

Two things happened in this pass: Biome ran for the first time, and the ablation ran for the first time.
The second produced the more important finding.

---

## 1. Biome: 1550 errors → 0

`npm run check` had never been executed. It reported **1550 errors / 193 warnings**.

### Rules turned off, with reasons

Three rules were disabled rather than obeyed, because obeying them would have made the code worse:

| Rule | Hits | Why off |
|---|---|---|
| `style/useTemplate` | 948 | The codebase builds strings with `+` throughout. The rewrite is **not purely syntactic** — `a + b` with numeric operands does not become a string, so an automatic rewrite changes behaviour in places. |
| `complexity/useLiteralKeys` | 112 | Every bracket access it objects to exists **because** `noPropertyAccessFromIndexSignature` forbids the dot form. The two rules are mutually exclusive, and the compiler flag is the stricter choice. |
| `complexity/noForEach` | — | `forEach` is used where the return value is deliberately discarded; `for…of` would be identical but noisier. |

Two more were disabled after they caused real damage:

| Rule | Why off |
|---|---|
| `style/noNonNullAssertion` | `tsconfig` sets `noUncheckedIndexedAccess`, so `!` after a bounds check is the *correct* tool, not a smell. 97 warnings for a deliberate pattern is noise. |
| `complexity/useOptionalChain` | Its unsafe fix rewrites `x[i]!.p` into `x[i]?.p`, which `noUncheckedIndexedAccess` then rejects. The rule fights the compiler config. |

Four `a11y` rules were demoted to **warn**: `useSemanticElements`, `useKeyWithClickEvents`, `noAutofocus`,
`noNoninteractiveElementToInteractiveRole`. These are real UI-quality signals and are **not** fixed — the
graph nodes use `div role="button"` as a deliberate layout choice, and the demo relies on autofocus. They
are recorded here so demoting them is a decision on the record rather than a config nobody can explain.

### The trap worth remembering

`biome check --write` applies only **safe** fixes. `--write --unsafe` took the error count from 53 to 9 —
and simultaneously took `tsc` from **0 errors to 31**, because the unsafe `useOptionalChain` fix stripped
every `!` the strict config requires. Tests stayed green (172/172) while the types were broken, which is
the same blind spot the typecheck pass documented: **a passing test suite does not imply a compiling
project.** `src/` and `scripts/` were restored from a pre-run backup and the remaining 40 errors were fixed
by hand.

### What the hand fixes were

- **19 unused parameters** → prefixed `_`. Most are in the uniform metric signature
  (`score(corpus, run, engine, resolver)`), where every scorer takes the same arguments so they can be
  called in a loop. `_` documents that; deleting the parameter would have broken the uniformity.
- **8 dead locals deleted**, not prefixed. Two were worth noting: `ExportView`'s
  `useMemo(() => selectedArtifact(store), [store])` was computing an artefact nothing rendered, and
  `retrieval/index.ts`'s `ask()` built a `ResolvedQueryOptions` it never passed anywhere — `retrieve()`
  resolves its own.
- **3 × `any`** in `eval/metrics/resolve.ts` → a named `ExtractedLabel` interface. Every caller was
  already passing `{ transcript, key }`; the `any` was hiding a contract that existed.
- **1 real API bug**: `chunkTurns(turns, budget = DEFAULT, normalized)` put a **defaulted parameter
  before a required one**. Reordered to `(turns, normalized, budget)` and all three call sites updated —
  including the two in `tests/integration/full-pipeline.test.ts`, which is what caught the reorder
  breaking, and is the test suite earning its keep.
- 4 × `Math.pow(0.5, x)` → `0.5 ** x`, 4 template literals with no interpolation → plain strings,
  `let events;` → `let events: readonly AnyEvent[]`.

**Result:** `npm run verify` — typecheck + lint + structure + tests — **exits 0 for the first time.**

---

## 2. The ablation ran, and every delta was exactly zero

`npm run eval:ablation` had never been executed. It produced a table of 15 configurations × 12 metrics in
which **every single cell was `+0.000`**.

That is not a small effect. Fifteen different configurations cannot produce bit-identical scores unless
the switches do nothing. Reading `eval/harness.ts` confirmed it:

```
AblationConfig declares 11 toggles. The harness reads 3:
  ✓ noiseCollapse          -> collapseNoise: false          (harness.ts:246)
  ✓ voting                 -> { voting: DEFAULT_VOTING }    (harness.ts:252)
  ✓ semanticContradiction  -> skipSemantic: true            (harness.ts:447)
  ✗ structuralContradiction   never read
  ✗ premiseInvalidation       never read   <-- gate (c), the component the product exists for
  ✗ cascade                   never read
  ✗ entrenchment              never read
  ✗ negationCues              never read
  ✗ modalityFilter            never read
  ✗ denseRetrieval            never read
  ✗ reranking                 never read

Both parameter sweeps ARE wired: cascadeDepthCap (444, 551) and maxSearches (643).
```

This is the **sixth silent no-op** in the project, and the same shape as the five the functional pass
found: type-correct, throwing nothing, producing a plausible-looking artefact that says nothing.

### What was changed

Not the wiring — that is eight modules of option plumbing and was not attempted in this pass. What was
changed is the **report's honesty**, because the generated text actively misdiagnosed the result:

- `toggles.ts` gained `WIRED_TOGGLES` and `unwiredToggles(ablation)`, with the eight unwired switches
  enumerated as implementation work.
- `table.ts` gained a **`not-wired`** verdict, evaluated *before* any delta is interpreted, so an
  unwired switch can never be reported as a small effect.
- The closing paragraph used to read "the declared thresholds were too timid to be at risk". It now
  reports that 9 of 15 rows measured nothing and that **the study tested 5 of 15 declared hypotheses**.

Verdicts after the change: `confirmed 0 · falsified 0 · below floor 3 · untestable 1 · NOT WIRED 9`.

**Consequence for the pitch.** The "highlight row" in `pitch/03-metrics-card.md` — the single line meant
for a slide — is *not available*. It depended on ablating `premiseInvalidation`, which is unwired. The
card now says so plainly instead of carrying a placeholder that implies the number is merely pending.

---

## 3. Stale documents corrected

Three statements were true when written and had become false:

| File | Was | Now |
|---|---|---|
| `LIMITATIONS.md` §10 | "Nothing has been executed" | Rewritten as constraint 10: the runs are real but the corpus is 12 transcripts against a specified 30, three metrics have n ≤ 2, one has n = 0, and only the keyless engine has been measured. G6 recorded as **partially met**. |
| `EVALUATION.md` header | "No number appears in this document" | Replaced with the actual figures and their denominators. The original *reason* for the paragraph — never invent metrics — is kept, because it still applies. |
| `EVALUATION.md` line 276 | "Nothing has been executed" | Replaced. |
| `pitch/03-metrics-card.md` | 15 × `▢▢▢` | All filled from `docs/generated/EVAL-REPORT.md`. Zero placeholders remain. |

---

## State after this pass

```
tsc -b                 0 errors   (src/ + tests/ + scripts/)
biome check            0 errors / 107 warnings
check_structure.py     274 files / exit 0
vitest run             172 passed / 13 files
npm run verify         exit 0     <-- first time
npm run demo:verify    exit 0
npm run eval           exit 1     (by design: hardening is NOT READY)
npm run eval:ablation  exit 0     <-- first time; ablation-report.md written
```

Still open, in the order it should be attempted: wire the 8 ablation toggles · contradiction over-firing
(102.9 per 100) · hypotheticals becoming nodes (the failing demo-killer) · refusal never fires (0 of 2) ·
survivor preservation 0.000 · guard precision n = 0 · a real-model pass on the LLM path.
