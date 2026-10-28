# End-to-end validation — 2026-10-28

Run on `main` after fixing the ReviewView infinite-render crash.

## Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run check` (Biome) | PASS (warnings only: complexity / console.log in CI runner) |
| Structure | `npm run check:structure` | PASS |
| Unit + integration + e2e | `npm test` | **275 / 275 PASS** (29 files) |
| Full verify | `npm run verify` | PASS |
| Production build | `npm run build` | PASS |
| Demo kit | `npm run demo:verify` | PASS — DEMOABLE · 7 verified · 2 manual · 0 failed · 3 dry runs deterministic |
| CI guards runner | `node scripts/whylog-guards.cjs` | EXIT 0 (9 warning-level failures advisory; 0 blocking) |
| Eval harness | `npm run eval` | Runs; writes `docs/generated/EVAL-REPORT.md`; **exit 1** because hardening is NOT READY (corpus limits — expected, not a build break) |

## Runtime (browser)

| Check | Dev (`npm run dev`) | Prod preview (`npm run build && npm run preview`) |
|---|---|---|
| Cold load | PASS — 0 console errors | PASS — 0 console errors |
| **load demo** | PASS — review queue (62 items, DATABASE→sqlite, …) | PASS — same |
| Nav: Lattice | PASS — empty-state copy when nothing committed | PASS |
| Mode badge | local engine · chain ok | local engine · chain ok |

### Bug found and fixed

**Symptom:** React error #185 — *Maximum update depth exceeded* on cold load (prod + dev).

**Cause:** [`src/views/ReviewView.tsx`](../src/views/ReviewView.tsx) selected `s.visible()` / `s.summary()` / `s.preview()`, which return **new** arrays/objects every `getSnapshot`, so React 18 looped.

**Fix:** Select stable `queue` / `run` / `options` and derive with `useMemo`. Also memoized keybinds in [`src/App.tsx`](../src/App.tsx).

## Product gates covered by tests

| Gate | Evidence |
|---|---|
| G1 import/review | extraction + review tests; live load-demo |
| G2 reasoning | `tests/integration/gate-g2.test.ts`, `phase2-dod.test.ts` |
| Gate (c) cascade | `tests/integration/gate-c-cascade.test.ts` · demo beat 5 VERIFIED |
| G3 ask / evidence | `tests/integration/gate-g3.test.ts` (Ask UI still MANUAL in demo) |
| G4 guards | `tests/integration/gate-g4.test.ts` |
| G5 export | `tests/integration/gate-g5.test.ts` (Export UI MANUAL in demo) |
| Keyless | `tests/integration/keyless.test.ts` |
| Round-trip / consistency | `round-trip.test.ts`, `consistency-gate.test.ts` |

## Known gaps (honest)

1. **Eval hardening NOT READY** — 2/4 demo-killers fail on the **12-transcript corpus** (L2 plant untested via extraction; hypotheticals becoming nodes). Demo fixture path and unit cascade tests **do** verify gate (c). See `LIMITATIONS.md` and `docs/generated/EVAL-REPORT.md`.
2. **Demo MANUAL beats** — Export compile + Ask groundedness still require a human click in the UI.
3. **DOM nesting warning** — `<div>` inside `<p>` via `SectionLabel` in DecisionCard (tests warn; non-blocking).
4. **Security audit docs** — brought from `origin/fix/verified-baseline` into `docs/security-audit/` for follow-up; **do not merge** the rest of that branch (broken CI path, false-pass command eval, settings rewrite).

## Security audit next steps

Read:

- [`docs/security-audit/FINAL-REPORT.md`](../docs/security-audit/FINAL-REPORT.md) — B+, 0 critical/high, 3 medium
- [`docs/security-audit/FINDINGS-DETAIL.md`](../docs/security-audit/FINDINGS-DETAIL.md)
- [`docs/security-audit/NEEDS-VALIDATION.md`](../docs/security-audit/NEEDS-VALIDATION.md)

Address medium findings on a **clean branch** from current `main`, not by merging `fix/verified-baseline`.
