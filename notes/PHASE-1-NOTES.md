# Phase 1 notes — the extraction pipeline

Status: **all fifteen build steps (A–O) written.** Nothing has been executed —
per the working agreement, the build, typecheck and fixture run happen on the
user's machine.

```
npm install
npm run check:structure     # 109 source files, 31,424 lines, exit 0
npm run dev                 # open the Import & review view
```

---

## 1. What was built

| Step | Files | Sub-phase |
| --- | --- | --- |
| A | `extraction/{types,offset-map,lines}.ts` | 1.1, 1.2 |
| B | `extraction/{speakers,speakers-fallback,timestamps,noise}.ts` | 1.1 |
| C | `extraction/{normalizer,chunking}.ts` | 1.1 |
| D | `ai/local/{modality,negation,value-phrase}.ts` | 1.3 |
| E | `extraction/{decisions,y-statement,rationale,episode-position}.ts` | 1.3 |
| F ★ | `extraction/{premises,premise-linker}.ts`, `ontology/data/exclusions.ts` | **1.4** |
| G | `extraction/alternatives.ts`, `ai/local/alternatives.ts` | 1.5 |
| H | `extraction/{provenance,snippet-validation}.ts` | 1.6 |
| I | `extraction/{resolution,confidence,voting}.ts`, `ai/local/confidence.ts` | 1.7, 1.8 |
| J | `ai/local/{extract,index}.ts`, `extraction/{pipeline,index}.ts` | 1.10 |
| K | `extraction/review/{types,index,actions,diff}.ts` | 1.9 |
| L | `extraction/{commit,commit-report}.ts`, `store/extraction.ts` | 1.10 |
| M | `views/ReviewView.tsx` (default view in `App.tsx`) | **G1** |
| N | `ai/prompts/extraction.ts`, `ai/providers/openai-compatible.ts`, `ai/llm/index.ts` | 1.8, 1.10 |
| O | `fixtures/demo-transcript-2.txt` | 1.4, 1.7 |

---

## 2. The four decisions worth re-reading before you test

### 2.1 The OUT-list needed a vocabulary nobody planned for

`premise-linker.ts` turns a supporting premise into an excluded condition:
`scale.single_user` ⇒ OUT `scale.concurrent_writers`. That is Doyle's
non-monotonic justification, and it is the only mechanism that lets gate (c) fire —
invalidation by the *world* rather than by contradiction.

The mechanical way to derive it is to negate the premise. That produces
`scale.single_user = false`, which is correct logic and unreadable English, and the
OUT-list is displayed to the user. So `ontology/data/exclusions.ts` pairs each
predicate with the condition that would break it **in words** — 21 rules over 43
declared predicates — and `validateOntology()` now calls `validateExclusions()` so
a rule naming a predicate that does not exist fails at boot rather than minting an
unresolvable node on every import.

**This is a data file added to Phase 0's ontology.** It is the single largest
addition that the plan did not ask for, and it is load-bearing for Phase 2.

### 2.2 Every premise is reviewed, by design

`premise-cues.ts` sets `TOPICAL_AUTO_ACCEPT_THRESHOLD = 1.0`, which no topical cue
can reach, and `EXPLICIT_AUTO_ACCEPT_THRESHOLD = 0.9`, which no explicit cue
reaches either. That is the table saying out loud that premise extraction does not
yet earn auto-acceptance. `premises.ts` does not override it.

If Phase 7's measurement says otherwise, the threshold moves and the extractor does
not. `predicateFromCueRate()` is the number to watch: a low rate means the extractor
is inventing `requirement.<free text>` predicates, which resolve at rung 4 or worse.

### 2.3 The review queue is sorted for rejection

ARGUS measured 155 false positives against 12 false negatives — 13:1. So low-tier
items render collapsed, alternatives are collapsed at *every* tier (published
precision 15.4%), derived OUT-list premises are collapsed and badged, and `Shift+D`
discards everything collapsed.

Cost asymmetry justifies it: a wrong approval is a false node that later drives a
cascade; a wrong discard is an inference the user can re-extract in one click.

### 2.4 Bulk approve does not promote to IN

`DecisionApproved` carries `viaBulkApprove`, and the fold sets label IN only when it
is false. So "approve all expanded" records ten decisions at `status: "proposed"`,
label UNKNOWN. Ten decisions promoted to IN by one click is how a machine inference
ends up driving a cascade.

---

## 3. Contract changes made during Phase 1

| Change | Why |
| --- | --- |
| `ResolutionOutcome.conflictsWith` | Same variable, different value is a *conflict*, not a merge. The ladder never merges across values, so without this field the conflict stays invisible until Phase 2 re-derives it — and Phase 1 is where the human is already looking |
| `ResolvedCandidate.action` | The field `commit.ts` refuses to work without. Invariant I4 is enforced by making this the only route from a candidate to an event |
| `materialize.ts` rewrites `Justification.informant.eventId` | A batch producer cannot know the ids `appendBatch` will mint. Deriving it in the fold makes the provenance correct rather than merely present |
| `DecisionProposed.episode` deliberately NOT supplied by commit | A candidate carries no turn indices. Inventing a range from snippet character offsets would put turn numbers where character numbers belong |
| `decision-cues.ts` 85 → 120 cues | See §4 |

---

## 4. The fixture audit that grew the cue table

`fixtures/demo-transcript.txt` contains six decisions. The original 85-cue table
matched **three** of them, so the ò5-decision acceptance criterion would have failed
on the fixture the plan specified.

The gap was not fixture-specific phrasing. It was four whole classes of dialogue the
table had no coverage for:

1. **Human acceptance of a proposal the agent just made** — `deal.` / `fine,` /
   `agreed.` / `noted:`. The most common way a decision is actually reached in a
   transcript. `valueAfter: false`, because the value is usually *before* the
   acceptance.
2. **Future-tense commitment** — `we'll do` / `we're dropping` / `we're going with`.
   Past-tense cues cannot cover a conversation happening before the code exists,
   which is to say they cannot cover most of one.
3. **The agent's conditional recommendation** — `I'd use` / `my recommendation is`,
   flagged `speculative: true` so `assertiveCues()` excludes them and the modality
   detector cannot read an assertion into a conditional.
4. **The conclusion of a Socratic exchange** — `then no ` / `is pure cost` /
   `is buying you nothing`. A large share of agent transcripts are the agent asking
   questions until the answer decides something.

Punctuation is part of the phrase: `deal.` and `deal with it` are different
sentences.

Both fixtures now match 14 decision cues and 13 premise cues each.

---

## 5. Defects found and fixed by the widened checker

`scripts/check_structure.py` gained three checks. Each one immediately found
something real:

- **`check_named_imports`** — a path can resolve while the *name* does not exist.
  Found `EngineConfig` imported from `@/ai/types` (it lives in `config.ts`, and this
  was a **Phase 0** defect sitting in `store/settings.ts`), `LOCAL_DIMENSIONS` from
  the wrong module, and `CompositionFact.text` / `CompositionRequest.instruction`,
  which are not fields.
- **`check_named_reexports`** — a barrel can re-export a name its target never
  declared. Found `describeActions` and `REVIEW_KEYS` exported from the wrong
  modules.
- **`check_cycles`** — ESM hoisting makes a cycle *work*, which is why cycles survive
  review. Found three; two were broken by extracting shared primitives
  (`extraction/lines.ts`, `extraction/review/types.ts`).

`export type { X }` is now recognised as an export — the checker missed it first
time and reported a false positive.

**503 internal import edges, zero cycles.**

---

## 6. Known gaps — what to expect when you run it

1. **Nothing has been executed.** No typecheck, no build, no fixture run. Type
   errors are likely and should be read as the normal cost of writing 31k lines
   blind.
2. **`ResolutionContext.decisionVectors` is never supplied.** `resolveExtraction` is
   called without vectors, so rungs 4 and 5 of the identity ladder fall back to
   lexical similarity. Wiring the index in is a Phase 2 job.
3. **`episodeIndex` is `-1` on every queue item.** `commit.ts` therefore mints
   episode ids from the counter rather than reusing real ones, and the fold
   synthesises episodes from decision snippets. Functional, but the review UI cannot
   yet show "the negotiation that produced this".
4. **`components/review/*` is empty.** The nine planned components were delivered as
   one `views/ReviewView.tsx` (~430 lines) to keep gate G1 reachable. Splitting it is
   cosmetic and should wait until the interaction is known to be right.
5. **`views/ImportView.tsx` does not exist** — import and review are one screen,
   because the queue is empty until something is imported. Recorded in
   `STRUCTURE.md` §18.1.
6. **The LLM path is untested against a live provider.** `openai-compatible.ts`
   implements OpenAI, OpenRouter and Anthropic behind one client, but no request has
   been made. Expect to fix response parsing first.
7. **`review/diff.ts` imports `isAccepted` from `extraction/types.ts`, not
   `commit.ts`** — deliberately, to avoid a cycle. If you move it, move it to
   `types.ts`.

---

## 7. What Phase 2 inherits

The three things Phase 2 needs and now has:

- **Non-monotonic justifications.** `Justification.outList` is populated from real
  extraction, not from hand-authored fixtures. Gate (c) has something to fire on.
- **Premises as shared nodes.** `premiseToDecisions` is the cascade index, and
  `premise-linker.ts` attaches the same premise to every decision in an episode that
  rests on it.
- **A precision denominator.** Every discarded candidate — including machine
  discards the human never saw — becomes an `ExtractionDiscarded` event, so Phase 7
  can compute precision per component and per tier from the log alone.

The thing Phase 2 must not assume: that premise extraction works. `predicateFromCueRate()`
and the `byType` histogram in `PremiseRecovery` are the two numbers to read first.
