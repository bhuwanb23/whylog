# WhyLog — Build Plan
**A decision memory for people building with AI.**
Locked decisions: Vite + React + Tailwind · all five differentiators in v1 · dual-path AI (LLM when keyed, local deterministic fallback always).

---

## 1. Thesis, in one line

> Your coding agent forgets every decision ten prompts back. WhyLog reads the transcript you already have, extracts the decisions buried in it, warns you when you're about to reverse one, and exports the history in the exact file format your next agent session reads.

Everything below serves that sentence. If a feature doesn't, it's cut.

**Positioning against the obvious objection** (a judge *will* ask this):
> "Why not just read git history?"
> Because git records **what** changed, never **why**, and never **what you rejected**. The rejected alternatives are the most valuable part — they're the thing that stops you re-litigating a settled argument at 2am. WhyLog stores the road not taken.

---

## 2. Scope

### In v1 — the five differentiators
| # | Feature | Why it's in | Demo weight |
|---|---|---|---|
| 1 | **Transcript auto-extraction** | The core unlock. Manual logging dies; paste-in doesn't require discipline. | High |
| 2 | **Contradiction / reversal detection** | Proves real retrieval, not storage. The peak demo moment. | **Highest** |
| 3 | **Semantic search Q&A with citations** | "why did we drop auth?" answered from your own history. | High |
| 4 | **Agent-native export** | `CLAUDE.md`, `.cursorrules`, `AGENTS.md` — closes the loop. | High |
| 5 | **Decision graph** | Override/dependency edges, visually distinctive. | Design points |

Plus: three views (Timeline, Ask, Export) + Graph, manual "quick log" entry (10 seconds, for people mid-flow), JSON import/export.

### Explicitly out (say these in "what's next")
- Auth, multi-user, teams, cloud sync.
- **Live auto-capture** from Claude Code / Cursor / Copilot via hooks or IDE extension — this is the real v2 and the single best thing to name on stage, because it shows you know where the product goes.
- Real vector DB / RAG pipeline. (Defend in §9 — the math says you don't need it.)
- Decision staleness decay, PR-comment bot, "nag me before I ship".

---

## 3. Architecture

```
┌──────────────────────────── Browser (Vite + React SPA) ───────────────────────────┐
³                                                                                   ³
³  VIEWS          Timeline · Ask · Export · Graph                                   ³
³                     ³                                                             ³
³  STATE          Zustand store ──persist──> localStorage (whylog:decisions:v1)      ³
³                     ³                       + JSON file import/export             ³
³  PIPELINE           ³                                                             ³
³    paste transcript ──> extractDecisions() ──> REVIEW DIFF ──> embed() ──> store    ³
³                                              ³                                    ³
³                                              └──> checkConflict(top-3 similar)     ³
³                                                    └──> reversal banner            ³
³    ask question ──> embed(q) ──> cosine top-k ──> answer(q, retrieved) ──> citations³
³                                                                                   ³
³  AI LAYER       ai/index.ts  →  route(key ? llm : local)                          ³
³                   ├─ providers/  (OpenAI · Anthropic · OpenRouter)                 ³
³                   └─ local/      (extract · embed · conflict · answer)  ← offline   ³
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Why client-only:** zero backend, zero deploy, works in a sandboxed preview with no network. The only outbound call is the optional LLM one.

**The one architectural rule that matters most:** every AI-powered step goes through the *same four-function interface* in §6. Swapping local↔LLM touches nothing else. That's the thing to point at when a judge asks "is this real or a toy?"

---

## 4. Data model

```ts
type Category =
  | 'database' | 'auth' | 'hosting' | 'framework' | 'language'
  | 'storage' | 'api' | 'testing' | 'ui' | 'architecture'
  | 'payments' | 'tooling' | 'scope' | 'other';

type DecisionStatus = 'active' | 'superseded' | 'reversed';

interface Decision {
  id: string;                 // 'd_' + nanoid(10)
  decision: string;           // "Use SQLite, not Postgres"
  reasoning: string;          // "single-user app, no deploy hassle"
  alternatives: string[];     // ["Postgres", "Supabase"]  ← the road not taken
  category: Category;
  slot?: string;              // 'DATABASE' — the decision variable (drives conflict logic)
  value?: string;             // 'sqlite'  — the chosen value (drives conflict logic)
  tags: string[];             // ['sqlite','db','mvp']
  timestamp: string;          // ISO 8601
  status: DecisionStatus;
  embedding: number[];        // 512-d, L2-normalised, float32-rounded
  source: {
    transcriptId?: string;    // which paste it came from
    snippet: string;          // verbatim transcript line(s) — makes citations real
    charStart?: number; charEnd?: number;
    extractedBy: 'llm' | 'local';   // honesty badge
    confidence: number;       // 0..1
  };
  edges: {
    supersedes?: string[];    // ids this decision replaces
    conflictsWith?: string[]; // ids flagged as contradicting
    dependsOn?: string[];     // ids this one rests on (graph)
  };
  reviewed: boolean;          // user confirmed it in the review diff
}

interface Transcript { id: string; pastedAt: string; chars: number; label?: string; }
```

**Two fields do the heavy lifting and are easy to forget:**
- `source.snippet` — without it, "citations" are fake. With it, the Ask view can highlight the exact transcript line the answer came from. This is a judging detail that reads as craft.
- `slot` + `value` — the structured core. Embeddings find *candidates*; slot/value makes reversal detection deterministic and explainable ("DATABASE: postgres → sqlite"). Don't rely on vectors alone for the headline feature.

**Scale maths (memorise this):** 100 decisions × 512 dims × 4 bytes = **200 KB**. A full scan is 51,200 multiply-adds — under a millisecond. That's why there's no vector DB, and it's a *decision*, not an omission.

---

## 5. File layout

```
whylog/
├─ index.html
├─ package.json          # vite react tailwind zustand nanoid d3-force
├─ vite.config.ts
├─ src/
³  ├─ main.tsx  App.tsx  index.css
³  ├─ types.ts
³  ├─ store/
³  ³   ├─ useDecisions.ts        # zustand + persist
³  ³   └─ seed.ts                # demo transcript + pre-baked Oct-3 decisions
³  ├─ ai/
³  ³   ├─ index.ts               # the router: key ? llm : local
³  ³   ├─ prompts.ts             # EXTRACT / CONFLICT / ANSWER prompt text
³  ³   ├─ providers/{openai,anthropic,openrouter}.ts
³  ³   └─ local/{extract,embed,conflict,answer,lexicon}.ts
³  ├─ search/cosine.ts           # topK(queryVec, decisions, k)
³  ├─ export/formats/{claude,cursorrules,agents,decisions}.ts
³  ├─ views/{Timeline,Ask,Export,Graph}.tsx
³  └─ components/{PasteModal,ExtractReview,DecisionCard,ConflictBanner,
³                 QuickLog,SearchBar,SettingsBar,ModeBadge}.tsx
└─ README.md
```

---

## 6. The AI layer — both paths

```ts
// src/ai/index.ts — the only seam in the whole app
export interface WhyLogAI {
  extractDecisions(transcript: string, opts?: {hint?: string}): Promise<Extraction>;
  checkConflict(candidate: Decision, similar: Decision[]): Promise<ConflictVerdict>;
  answer(question: string, retrieved: Decision[]): Promise<Answer>;
}
// embed() is separate: local by default, provider embeddings if keyed.
```

### 6a. LLM path (when a key is present)
Three calls. Each returns **strict JSON**, temperature ~0.2, with a `response_format: json_schema` where the provider supports it.

- **`extractDecisions`** — one call, whole transcript (chunk at ~12k chars if longer, merge by dedupe on `slot+value+snippet`). Prompt asks for: `decision, reasoning, alternatives[], category, slot, value, tags[], snippet (verbatim quote), confidence`. **Snippet must be copied verbatim** — say so explicitly, or models paraphrase and your citations rot.
- **`checkConflict`** — input: the new decision + top-3 retrieved. Output: `{ verdict: 'conflict'|'reversal'|'refinement'|'none', explanation, relatedId }`. Keep the candidate set tiny; this call is cheap and fast.
- **`answer`** — input: question + top-k retrieved *with ids and snippets*. Output: `{ answer, citedIds[] }`. Render citations as clickable chips that scroll to the decision card.

### 6b. Local path (no key — must be genuinely good, not a stub)

**Extraction.** Split transcript on speaker turns (`User:` / `Assistant:` / `> ` / role markers). Score each sentence against cue patterns:
`decided to|let's use|we'll go with|switch(ing)? to|instead of|rather than|dropp(ed|ing)|no longer|skip(ping)?|avoid|sticking with|going with|ruled out|for now|revert`.
Then pull structure from the matched sentence:
- `reasoning` ← trailing clause after `because|since|so that|to avoid|due to|as`.
- `alternatives` ← object of `instead of|rather than|over|not|or we could`.
- `slot`/`value` ← match against `lexicon.ts`: a map of `DATABASE → [sqlite, postgres, mysql, supabase, mongodb, dynamodb]`, `AUTH → [auth, oauth, clerk, supabase auth, magic link, no auth, jwt, session]`, `HOSTING → [vercel, netlify, fly, railway, ec2, self-host]`, etc.
- `confidence` ← cue strength + slot matched + reasoning present (0.35 / 0.65 / 0.9 tiers).

**Embedding.** Hashing vectorizer, fully deterministic, no download: normalise → strip stopwords → tokens + character 3-grams → `hash(token) % 512` with sign hash → TF weight → **inject lexicon synonyms into the same bucket** (`postgres ≡ pg ≡ postgresql`, `sqlite ≡ lite db`) → L2-normalise. This gives real cosine geometry over your domain vocabulary.

**Conflict detection (the critical design point).**
> ⚠️ **Embeddings alone cannot detect contradictions.** "Use Postgres" and "Don't use Postgres" are ~0.9 cosine similar. Vectors find *related* decisions; they do not find *opposing* ones.

So the local verdict is structural, not vector-based:
1. Retrieve top-3 by cosine → candidate set.
2. If a candidate shares `slot` and has a **different `value`** → `reversal` ("DATABASE: postgres → sqlite").
3. If same `slot`, same `value`, but the new sentence carries a negation cue (`avoid|no longer|dropping|instead of`) → `conflict`.
4. Same slot, same value, no negation → `refinement` (adds reasoning).
5. Nothing → `none`.

This is *more* explainable than the LLM path and is exactly what you want when a judge asks "how does that actually work?".

**Answer.** Retrieve top-k, then compose: headline from the best match's `decision`, body from its `reasoning`, "Alternatives you rejected:" list, and timestamped citation chips. Label it clearly: *"Composed from your log — no LLM key connected."*

### 6c. The honesty rule
A `ModeBadge` in the header shows **LLM (model name)** or **LOCAL** for every operation, and `source.extractedBy` is stored per decision. Never let the demo imply a capability it doesn't have — and never let the offline path look broken. Judges reward this more than they reward a fragile magic trick.

---

## 7. Build order (each phase ships something demoable)

| Phase | Build | Proves | Est. |
|---|---|---|---|
| **0** | Vite+React+Tailwind scaffold, types, zustand store + persist, shell nav, seed data | App boots, decisions render | 25m |
| **1** | **Paste → local extract → review diff → store.** Timeline view with cards, filters by tag/category, search-as-you-type | Differentiator #1 | 70m |
| **2** | Local embedder + cosine top-k + **Ask view** with citation chips | #3 | 50m |
| **3** | **Conflict detection + reversal banner + QuickLog inline** | #2 — the money moment | 55m |
| **4** | **Export view**: `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `DECISIONS.md`; copy + download; preview pane | #4 | 40m |
| **5** | **Graph view**: d3-force, nodes coloured by status, red edges = conflict, grey = supersedes, click → focus card | #5 | 60m |
| **6** | LLM providers + settings modal (key in `localStorage`, never committed) + prompts; wire behind the same interface | "Proper" architecture | 60m |
| **7** | Polish: empty states, loading skeletons, keyboard `⌘K`, toasts, README, demo-script rehearsal | Judging craft | 45m |

**~7h of focused work.** If the clock is shorter: do 0→4 and drop Graph (phase 5) — it's the most visually impressive and the least load-bearing. Never drop phase 3.

---

## 8. The demo (2 minutes, timed)

**Cast:** a fixture transcript you write *yourself* containing a Postgres decision dated ~3 weeks ago. Don't improvise this — the whole demo hinges on it landing.

| t | Beat | What's on screen |
|---|---|---|
| 0:00 | **Cold open, no preamble.** Read the challenge's own words back: *"you make a call ten prompts ago, the agent forgets, you can't explain your own code later."* Then: "I hit this last Tuesday. So I built the thing that remembers." | Empty WhyLog, title only |
| 0:15 | Paste the raw 3,000-char Claude Code transcript. Ugly, real, unformatted. | Paste modal |
| 0:25 | Click **Extract**. 5 decisions appear as a reviewable diff — reasoning, rejected alternatives, verbatim snippets, confidence. Approve. | Review diff → Timeline |
| 0:45 | **"Every new decision gets checked against the ones you already made."** Quick-log: *"Actually let's switch to Postgres, we need concurrent writes."* | QuickLog |
| 0:50 | **⚡ THE MOMENT.** Banner fires: *"You decided against Postgres on Oct 3 — reasoning: deploy complexity. This reverses that. Update the old decision?"* Pause. Let it sit for two seconds. | Conflict banner |
| 1:10 | Ask: **"why did we drop auth?"** → instant answer with citations back to the exact transcript line. | Ask view |
| 1:30 | Export → `CLAUDE.md`. Show the generated file: decisions, reasoning, rejected alternatives, "do not re-litigate" section. "That's the next agent session's memory." | Export view |
| 1:45 | Flip to **Graph**. Point at the red edge. "That's the reversal you almost shipped." | Graph |
| 1:55 | Close: *"Agents got better at writing code. Nobody gave them a memory for why. WhyLog is that memory — and the capture cost is a paste."* | — |

**Rehearse the 0:50 beat until it's automatic.** Everything before it is setup; everything after is confirmation.

---

## 9. Judge Q&A — prepared answers

**Why no vector DB / real RAG?**
50–200 decisions. A full brute-force cosine scan over 512-d vectors is sub-millisecond in JS, and the whole index is ~200 KB. A vector DB here adds infra, latency, and a failure mode for zero recall gain. The architecture keeps `topK()` behind one function — swap in pgvector when the log passes ~10k decisions.

**Won't embeddings miss contradictions?**
Yes — deliberately handled. Vectors retrieve *candidates*; a classifier (LLM verdict, or slot/value structural comparison offline) decides *conflict vs refinement vs none*. Negation is invisible to cosine similarity, so retrieval and judgement are separate stages.

**What about noisy real transcripts?**
Extraction is never silent. Everything lands in a review diff with confidence scores and verbatim snippets; the user approves. Low-confidence guesses are shown collapsed, not hidden.

**Where does it live?**
Client-side only. `localStorage` plus JSON import/export. Your code reasoning never touches a server unless you choose to connect your own key.

**Doesn't the agent's memory feature do this?**
Agent memory is per-session and per-tool, it's opaque, and it disappears when you switch editors. WhyLog's output is a plain file in your repo — it survives tool churn and works with *whatever* agent you use next week.

**What's the moat / what's next?**
Live capture via Claude Code hooks and a Cursor extension (zero-paste), a shared team decision log, staleness decay ("this decision is 4 months old and the codebase moved"), and posting decision diffs as PR comments.

**Is the offline extractor just regex theatre?**
The local path is a genuine fallback: cue-pattern extraction + slot/value lexicon + hashed n-gram embeddings. It's weaker than the LLM path on reasoning nuance, which is why every decision carries `extractedBy` and the UI badges the mode. Both paths implement the same interface.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Extraction demo produces garbage on a fresh transcript | Use the **written fixture**. Plus a review-diff step so bad output is visibly correctable — that's a feature, not an apology. |
| No network in the preview sandbox | Local path is the default and is complete. Document the key setup in README for local runs. |
| `@xenova/transformers` real embeddings (~80MB) | Skip. Hashed n-grams + domain lexicon + slot/value logic is enough, and loads instantly. |
| Graph eats the afternoon | Phase 5, after export works. Pre-write the d3-force config; render plain SVG, no library for the view itself. |
| Sandbox is 2 CPU / 2 GB | Vite dev server, not Next. Keep deps to ~6 packages. |
| Conflict banner fires on unrelated decisions (false positives) | Threshold the cosine gate (≥0.42) *and* require a shared `slot`. Precision beats recall here — a wrong flag kills the demo. |

---

## 11. Immediate next actions

1. Write `fixtures/demo-transcript.txt` — the 3k-char Claude Code dump with the Oct-3 Postgres decision and a dropped-auth decision embedded in it. **Do this first; the demo depends on it.**
2. Write `src/ai/local/lexicon.ts` — slots and their value vocabularies. This single file determines whether local extraction and conflict detection feel intelligent.
3. Scaffold phase 0 and get a seeded Timeline rendering.
4. Build phases 1→4, then decide on Graph with the clock in hand.

---

*Say the word and I'll start on any phase — the fixture transcript and the lexicon are the two highest-leverage 20-minute tasks in here.*
