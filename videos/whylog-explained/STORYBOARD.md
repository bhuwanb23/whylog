---
format: 1920x1080
duration: 60s
message: "Your agent's decisions rest on assumptions nobody stores — WhyLog stores them and tells you when they stop being true."
arc: story-explainer
audience: developers building with AI agents
mode: autonomous
music: none
silent: true
---

## Video direction

**Palette (frame.md only, never invented):** ground `{colors.cream}` #e6e9ee light paper · voice
`{colors.ink}` #0b0d10 · cards on `{colors.tile}`/`{tile-strong}` half-steps · the single voltage
`{colors.coral}` #4ade80 brand green (ONE coral moment per frame: the ✱ kicker, the approve
button, the surviving branch, the wordmark mark — never two) · `{colors.navy}`/#07090b–#1a1f26
code/terminal surfaces only. The story's epistemic states, used sparingly and always paired with
a label, never bare: fail/unsound red `#f87171`, unknown amber `#fbbf24`, retracted slate
`#94a3b8`. Type by role: EB Garamond display (sentence case, negative tracking) / Inter body /
JetBrains Mono kickers (uppercase 0.16em, ✱ prefix) + ids like WLD-0007.

**Motion defaults + shot model:** every frame is a directed shot — entrance → development →
settle — filling its full duration; default spring intents: hero `entry`/`heavy`, labels/chips
`snappy`, background `gentle`; entries ≤ ~800ms, staggers ≤ ~500ms total. **Idle budget:** one
slow correlated camera move on the frame root for the whole shot + at most 1–2 live elements
(hero breathing ±2–5%, active node glow pulse); nothing else moves during the hold.

**Negative list:** no slideshow (enter-then-freeze; all effects firing at t=0), no screensaver
(many elements floating at once), no bounce.out/elastic.out, no repeat/yoyo/infinite loops, no
randomness, no exit motion (the harness transition is the exit), no gradients/glows on content
beyond one ≤0.45 ambient bloom, no heavy drop shadows, no fourth hue outside the listed tokens.

**Stillness allocation (only these two):** Frame 4 — stillness-before-climax ~0.6s before the
cascade; Frame 10 — breathable landing hold. Every other frame develops mid-shot.

**Continuity:** Frames 2–5 share ONE stage — the decision/lattice diagram, same geometry, growing
across the problem half — seam `crossfade` (then `push-slide LEFT` into the cascade). Frames 6–8
share the system stage. Content lives in the top ~83% (caption keep-out band clear).

---

## Frame 1 — The given

- scene: Oversized serif line "Your agent forgets the given." punches onto the deep ground while the lattice mark (two premise circles, one decision square) draws itself beside it
- voiceover:
- duration: 5s
- poster: 3.5
- transition_in: cut
- status: outline
- src: compositions/frames/01-the-given.html
- type: hook
- persuasion: Counterintuitive claim
- beat: intrigue + recognition
- effects: waterfall-entry, svg-path-draw, spring-pop-entrance
- focal: the hero line "Your agent forgets the given."
- roles: hero serif line = foreground subject · lattice mark (circles + square) = supporting right-column emblem · ✱ kicker + mono index strip "whylog · main" = chrome · dim paper field = background

Entrance: the ✱ kicker snaps in `snappy`, then the serif line lands word-by-word (`waterfall-entry`,
heavy). Development: the lattice mark assembles beside it — two circle strokes `svg-path-draw` in
order, support lines draw, then the decision square `spring-pop-entrance` (the last beat, landing
on the word "given"). Settle: mark holds with the one ambient bloom behind it; only the slow
root drift continues.

## Frame 2 — A decision rests on premises

- scene: The decision "SQLite, not Postgres" renders as a rounded square, and three premise circles (single-user, local-only, zero-budget) draw beneath it with support lines — the bipartite lattice stage
- voiceover:
- duration: 6s
- poster: 4.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/02-decision-rests.html
- type: product_intro
- persuasion: Concretization (abstract → tangible object)
- beat: orientation
- effects: spring-pop-entrance, svg-path-draw, ambient-glow-bloom
- focal: the decision card "SQLite, not Postgres"
- roles: decision card + WLD-0007 id = foreground subject · three premise circles with labels (single-user · local-only · zero-budget) = supporting row beneath · support lines = connective · dim lattice ghost = background

Entrance: on the shared stage, the decision square springs in heavy with its mono id `WLD-0007`
under it. Development: three premise circles drop into a row below (staggered `snappy`) and their
support lines `svg-path-draw` up to the square — the build IS the teaching: a decision is a
structure that rests on premises. Settle: the completed bipartite figure holds ~2s (read time),
one soft bloom behind the decision square; camera drift only.

## Frame 3 — The world moves

- scene: On the same lattice stage, a mono timeline stamps "six weeks later" — four users, deployed — and the premise circles single-user and local-only flip from green rings to struck-through red
- voiceover:
- duration: 6s
- poster: 4.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-world-moves.html
- type: pain_point
- persuasion: Before/after
- beat: tension + concern
- effects: counting-dynamic-scale, spring-pop-entrance, depth-of-field-blur
- focal: the "4 users" figure counting up over the struck premises
- roles: count-up stat (0 → 4 users) + "deployed" chip = foreground subject · the same lattice stage = supporting continuity · "six weeks later" mono stamp = chrome · struck-through premise circles (red, labeled "falsified") = the action

Entrance: the mono timestamp `spring-pop-entrance`s onto the existing stage (no re-layout — same
geometry as Frame 2). Development: the stat counts 0 → **4 users** (`counting-dynamic-scale`,
tabular) while a "deployed" chip lands; then the two world-observable premise circles flip red
with a strike line and the label "falsified" snaps in `snappy`. Settle: `depth-of-field-blur`
dims the rest of the stage so the two broken premises own the frame; hold ~1.5s.

## Frame 4 — No one tells you

- scene: The struck-through decision sits alone with a single red UNSOUND badge; large serif aside "No contradiction was ever stated." with a quiet empty margin
- voiceover:
- duration: 5s
- poster: 3.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/04-no-one-tells-you.html
- type: pain_point
- persuasion: Common-belief vs reality
- beat: unease
- effects: titlecard-reveal
- blueprint: titlecard-reveal
- focal: the serif line "No contradiction was ever stated."
- roles: serif aside = foreground subject · the lone struck decision card with red UNSOUND pill = supporting left anchor · empty paper margin = deliberate negative space

Reproduce the blueprint's one-restrained-move + still hold: **Base** titlecard-reveal · **Keep**
exactly one restrained reveal move then a still hold · **Depart** — the card carries the UNSOUND
decision as a left anchor instead of a proof card. Entrance: the serif line reveals in one
slide-up crossfade. Development: minimal by design (a breathing hold is the payload) — the red
pill pulses once. **stillness-before-climax ~0.6s** (allocated; only the root drift continues),
building tension before Frame 5. Settle: hold for read.

## Frame 5 — The cascade

- scene: On the same lattice stage the failure propagates: red dependency arrows fire from the falsified premise through WLD-0007 to two downstream decisions that flip UNSOUND, while one branch stops green at a surviving premise
- voiceover:
- duration: 7s
- poster: 5
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/05-the-cascade.html
- type: feature_showcase
- persuasion: Demonstration (show the mechanism running) + causal chain
- beat: realization
- effects: svg-path-draw, spring-pop-entrance, coordinate-target-zoom, ambient-glow-bloom
- focal: the red cascade path firing from the falsified premise
- roles: falsified premise node (red, struck) = source · red dependency arrows = the action · downstream cards WLD-0011 → WLD-0019 flipping to UNSOUND = supporting consequences · surviving branch WLD-0031 (green, "independent support") = the counterpoint · "CASCADE STOP" mono chip = chrome

Entrance: camera `coordinate-target-zoom` pushes from Frame 4's aside onto the lattice stage
(heavy). Development: the failure propagates as a sequence — arrow 1 `svg-path-draw`s from the
falsified premise to WLD-0007, its UNSOUND pill `spring-pop-entrance`s `snappy`; arrow 2 draws
on to WLD-0019 (same pair, one beat later); then the counterpoint: the surviving branch arrow
draws in green and stops at the "CASCADE STOP · independent support" chip — the stop must be
seen, not implied. Settle: full failure map holds ~2.5s (read time), one bloom behind the
falsified source; camera drift only.

## Frame 6 — WhyLog stores the given

- scene: The lattice re-enters as a designed system: IN-list and OUT-list labels attach to the premise nodes, one shared "single-user" node shown feeding three decisions
- voiceover:
- duration: 6s
- poster: 4.5
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/06-stores-the-given.html
- type: product_intro
- persuasion: Structural contrast (per-decision strings vs shared nodes)
- beat: clarity + orientation
- effects: waterfall-entry, svg-path-draw, spring-pop-entrance
- focal: the shared "single-user" premise node feeding three decisions
- roles: shared premise node (green ring) = foreground subject · three decision squares fanned below = supporting · IN-list / OUT-list mono label chips attaching to the node = the teaching device · ✱ kicker "WHYLOG STORES THE GIVEN" = chrome

Entrance: kicker snaps in, the shared "single-user" node springs to center (heavy). Development:
three support lines `svg-path-draw` outward to three decision squares (staggered `snappy`) —
one node, three dependents, invariant made visible; then the IN-list chip and OUT-list chip
`waterfall-entry` beside the node (green IN / slate OUT with the excluded condition). Settle:
the completed system figure holds ~2s; one live element — the shared node's glow pulse.

## Frame 7 — REVISE()

- scene: A nine-step cycle diagram assembles around a glowing REVISE() hub — EXTRACT, DETECT (gates a·b·c), BACKTRACK, CASCADE, PROPOSE — with each ring segment lighting in order
- voiceover:
- duration: 7s
- poster: 5
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/07-revise-cycle.html
- type: feature_showcase
- persuasion: Signposting + frame-then-fill
- beat: comprehension
- effects: svg-path-draw, spring-pop-entrance, coordinate-target-zoom, ambient-glow-bloom
- focal: the REVISE() hub at the ring's center
- roles: REVISE() hub = foreground subject · nine ring segments + step nodes = the mechanism · mono step labels (EXTRACT · DETECT · BACKTRACK · CASCADE · ADJUDICATE · PROPOSE · COMMIT) = supporting chrome · gates chips (a structural · b semantic · c premise ★) = the teaching detail

Entrance: the hub springs in at center with its glow bloom; ring outline `svg-path-draw`s around
it. Development: step nodes light in cycle order — 4 waves of `spring-pop-entrance` (`snappy`,
total stagger ≤ 500ms per wave): 1 EXTRACT/2 RESOLVE/3 ASSERT → 4 DETECT (the three gate chips
fly out beneath it) → 5 BACKTRACK/6 CASCADE → 7 ADJUDICATE/8 PROPOSE/9 COMMIT; camera
`coordinate-target-zoom` pulls back slightly as the ring completes. Settle: full cycle holds
~2s; hub glow is the one live element.

## Frame 8 — You dispose

- scene: A seven-part proposal card slides in — WHAT FAILED / WHY / MINIMAL REVISION / COST — stamped "never auto-applied"; a cursor hovers, the approve button takes the single green voltage moment
- voiceover:
- duration: 5s
- poster: 3.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/08-you-dispose.html
- type: benefit_highlight
- persuasion: Contrast (system proposes vs human disposes)
- beat: confidence
- effects: spring-pop-entrance, waterfall-entry, cursor-click-ripple
- focal: the approve button — the frame's single green voltage
- roles: proposal card (seven-part: WHAT FAILED · WHY · MINIMAL REVISION · COST · STATUS) = foreground subject · mono stamp "never auto-applied" = supporting · animated cursor = the actor · footer line "every action gets a reason →" = chrome

Entrance: the proposal card slides in heavy; its rows `waterfall-entry` top-to-bottom (snappy).
Development: the mono stamp "never auto-applied" lands; the cursor glides to the approve button
and `cursor-click-ripple` fires — button compresses, ripple expands, the button is the one coral
moment (dark ink text on green). Settle: "approved — reason recorded" confirms with a snappy
pop; hold ~1.2s with camera drift.

## Frame 9 — Compiled, verified, keyless

- scene: Three hairline cards in a row type themselves in: GUARDS (executable check), EXPORT (CLAUDE.md · .cursorrules with verify commands), KEYLESS (local engine badge) — rule of three
- voiceover:
- duration: 6s
- poster: 4.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/09-compiled-keyless.html
- type: feature_showcase
- persuasion: Rule of three
- beat: mastery
- effects: grid-card-assemble, spring-pop-entrance, context-sensitive-cursor
- blueprint: grid-card-assemble
- focal: the row of three hairline cards
- roles: GUARDS / EXPORT / KEYLESS cards = foreground subjects · their mono sample lines ($ whylog verify · CLAUDE.md chip · local engine badge) = supporting detail · ✱ kicker = chrome

Reproduce the blueprint's staggered cascade into a row: **Base** grid-card-assemble · **Keep**
N items self-assemble in a staggered cascade and hold · **Depart** — three wide hairline cards
in one row instead of a tile grid; each card's mono sample line types itself after it lands
(`context-sensitive-cursor` accent). Entrance/development: card 1 GUARDS springs in + its
`whylog verify` line types; card 2 EXPORT + `CLAUDE.md · .cursorrules` chips; card 3 KEYLESS +
green "local engine · no API key" badge — snappy, ~400ms total per wave. Settle: the row holds
~2s; camera drift only.

## Frame 10 — A decision log that checks itself

- scene: The lattice mark from frame 1 returns and locks up with the WhyLog wordmark and the tagline; the three premise chips settle under it — callback to the opening image
- voiceover:
- duration: 6s
- poster: 4.5
- transition_in: crossfade
- status: outline
- src: compositions/frames/10-a-decision-log.html
- type: branding
- persuasion: Distillation + callback
- beat: satisfaction + resolve
- effects: logo-assemble-lockup, spring-pop-entrance, waterfall-entry
- blueprint: logo-assemble-lockup
- focal: the WhyLog lockup (mark + wordmark)
- roles: mark + wordmark "WhyLog" = foreground subject · tagline "a decision log that checks itself" = the payoff line · three mono chips (stores the given · cascade with survivors · proposes, never applies) = supporting · quiet paper ground = background

Reproduce the blueprint's build-to-lockup: **Base** logo-assemble-lockup · **Keep** the mark
comes to exist on screen and resolves into a centered lockup · **Depart** — the mark builds
from the frame-1 lattice parts (circles draw, square pops — the callback) instead of orbiting
satellites. Entrance: mark reassembles from its three parts (heavy). Development: wordmark
`waterfall-entry`s letter-cluster-by-cluster; tagline reveals in one restrained slide-up.
Settle: **breathable landing hold** (allocated stillness) — lockup holds ~1.8s, the ✱ spike is
the single coral moment; only root drift continues.
