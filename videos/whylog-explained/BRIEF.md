---
workflow: faceless-explainer
flow: automation
storyboard: no
message: "Your AI agent's decisions rest on assumptions nobody stores — WhyLog stores them, notices when they stop being true, and tells you exactly which decisions just became unsound."
destination: embed
aspect: 16:9
language: en
audience: developers building with AI agents
length: 60s
angle: concept
---

# WhyLog explainer — 60s faceless concept video

## Intent

A 60-second problem → solution explainer for **WhyLog**, the project in this repository
("a truth maintenance system for the decisions you make while building with AI").

Narrative spine (the user's ask: "what it solves and how it solves"):

1. **Hook** — your agent forgets the *given*: "SQLite, not Postgres" was true *given*
   single-user, no deploy, no concurrent writers.
2. **The problem** — the world moved (four users, deployed); nobody contradicts you,
   no new decision was made, and the decision silently stops being true.
3. **The break** — downstream decisions you forgot collapse with it (cascade).
4. **How it solves** — WhyLog stores the premises (IN-list / OUT-list), the three-gate
   REVISE() cycle labels the graph, backtracks to the minimal assumptions, cascades to
   independent support, and proposes a seven-part revision — the human disposes.
5. **The rest of the loop** — guards compile decisions into checks; export compiles the
   graph into agent-readable rules; 100% keyless, local, deterministic.
6. **Close** — WhyLog lockup, tagline, "a decision log that checks itself".

## Design

- Preset: **code-editorial** (frame.md), remixed onto WhyLog brand tokens:
  canvas `#0b0d10`, ink `#e6e9ee`, accent `#4ade80`, voltage `#f87171`.
- All visuals invented (typography, lattice diagrams, data). The project's own brand
  palette governs color; epistemic status colors keep their meaning
  (green IN / slate OUT / amber UNKNOWN / violet UNFOUNDED / red = action available).
- **Silent run** — no HeyGen credentials on this machine, so no TTS narration and no
  BGM retrieval. Text-driven motion; `SCRIPT.md` is not created (no narration).

## Assets

No captured material. The repository's own brand assets exist under `public/assets/`
(logos, diagrams) but the faceless workflow invents every visual in-frame; the SVG
motifs (premise circles + decision squares) are re-drawn natively by frame workers.

## Run shape (locked by user signals)

Automation flow, storyboard board skipped, one-shot build reviewed at the end.
The user asked to "complete it end to end" — approval for render is granted by this
brief; final review happens on the delivered MP4.
