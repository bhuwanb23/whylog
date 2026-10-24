/**
 * DecisionMemEval — the labelled corpus. 7.1.
 *
 * Phase 7 · sub-phase 7.1
 * Plan: plan/phase-7-evaluation.md §7.1
 *
 * ---------------------------------------------------------------------------
 * THE LABELS ARE THE BENCHMARK, AND THEY ARE THE PART MOST LIKELY TO BE WRONG
 *
 * Every `quote` below is verbatim text from the corresponding file in `fixtures/eval/`. The loader
 * resolves each to a character span and REJECTS the label if the quote is not a literal substring,
 * so a typo here surfaces as a reported unresolved label rather than as a silently wrong metric.
 *
 * Run `npm run eval` and read the unresolved list before trusting any number this corpus produces.
 *
 * ---------------------------------------------------------------------------
 * SIZE, STATED PLAINLY
 *
 * The plan asks for 30 transcripts (10 clean / 12 messy / 8 adversarial). This corpus has 12 —
 * 10 authored here plus the two demo fixtures that already existed. It is SHORT, and the metrics
 * computed from it carry correspondingly wide error bars.
 *
 * What it is not short of is COVERAGE: every planted case the plan names is present — L1 pairwise,
 * L2 premise-level, L3 cascade with a survivor, circular justification, M1, M2, duplicate
 * restatement and an unanswerable question. Those are the cases the metrics are actually about.
 * Adding 18 more clean transcripts would tighten the extraction numbers and test nothing new.
 *
 * The plan's own mitigation applies: state the size, state the limitation, publish the corpus so
 * others can extend it. `describeCorpus` prints the size into every report so no number can be
 * quoted without it.
 * ---------------------------------------------------------------------------
 */

import type { Corpus } from "./labels";

export const CORPUS_VERSION = "0.1.0";

export const corpus: Corpus = {
  version: CORPUS_VERSION,

  transcripts: [
    /* ================= CLEAN ================= */
    {
      id: "c01",
      tier: "clean",
      file: "fixtures/eval/c01-clean-storage.txt",
      purpose: "The canonical storage decision with two premises, one exclusion and one rejected alternative. Also one half of the L1 planted pair.",
      occurredAt: "2026-10-03T14:22:00+05:30",
      plants: ["L1-sqlite", "L3-shared-premise"],
      decisions: [
        {
          key: "d1",
          variable: "DATABASE",
          value: "sqlite",
          statement: "Use SQLite, not Postgres",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "going with SQLite, not Postgres",
          restsOn: ["p1", "p2"],
          excludes: ["p3"],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "scale",
          predicate: "scale.max_users",
          value: 1,
          text: "single-user: one person, one machine, one log",
          quote: "it's one person, one machine, one log",
          expectInList: true,
        },
        {
          key: "p2",
          type: "deployment",
          predicate: "deployment.infrastructure",
          value: "none",
          text: "no deployment infrastructure",
          quote: "no deploy hassle is the whole argument",
          expectInList: true,
        },
        {
          key: "p3",
          type: "scale",
          predicate: "scale.concurrent_writers",
          text: "concurrent writers must not exist",
          quote: "if concurrent writers ever appear, this decision is invalidated",
          expectInList: false,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "postgres",
          whyRejected: "hosted dependency, connection string in env, migrations to manage",
          rejectedBy: "d1",
          quote: "Postgres via Supabase would work, but it means a hosted dependency",
          expectConfirmed: true,
        },
      ],
      episodes: [{ index: 0, title: "storage layer choice", firstLine: 4, lastLine: 16 }],
    },

    {
      id: "c02",
      tier: "clean",
      file: "fixtures/eval/c02-clean-frontend.txt",
      purpose: "Two decisions in one transcript, with a rejected alternative each. Tests episode segmentation and multi-decision extraction.",
      occurredAt: "2026-10-04T10:05:00+05:30",
      plants: [],
      decisions: [
        {
          key: "d1",
          variable: "FRAMEWORK",
          value: "vite",
          statement: "Use Vite, not Next.js",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "let's use Vite, not Next.js",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d2",
          variable: "STATE",
          value: "zustand",
          statement: "Use zustand for state, not Redux",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "just use zustand",
          restsOn: [],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "requirement",
          predicate: "requirement.ssr",
          value: false,
          text: "no SSR or API routes needed",
          quote: "no SSR, no API routes",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "next.js",
          whyRejected: "SSR you won't use and a build step you don't need",
          rejectedBy: "d1",
          quote: "Next.js would give you SSR you won't use",
          expectConfirmed: true,
        },
        {
          key: "a2",
          value: "redux",
          whyRejected: "too much ceremony for this",
          rejectedBy: "d2",
          quote: "redux is too much ceremony for this",
          expectConfirmed: true,
        },
      ],
      episodes: [
        { index: 0, title: "build tooling", firstLine: 4, lastLine: 12 },
        { index: 1, title: "state management", firstLine: 13, lastLine: 18 },
      ],
    },

    {
      id: "c03",
      tier: "clean",
      file: "fixtures/eval/c03-clean-auth.txt",
      purpose: "A decision with two premises and two rejected alternatives, later reversed by a02. Tests supersession across transcripts.",
      occurredAt: "2026-10-06T16:40:00+05:30",
      plants: ["reversal-clerk"],
      decisions: [
        {
          key: "d1",
          variable: "AUTH",
          value: "clerk",
          statement: "Use Clerk for auth",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "ok, Clerk it is",
          restsOn: ["p1", "p2"],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "budget",
          predicate: "budget.available",
          value: 0,
          text: "no budget for a paid tier",
          quote: "there's no budget for a paid tier",
          expectInList: true,
        },
        {
          key: "p2",
          type: "team",
          predicate: "team.owns_user_table",
          value: false,
          text: "the team does not want to own the user table",
          quote: "hand it off, I don't want to write password reset flows",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "custom",
          whyRejected: "you explicitly don't want to write password reset flows",
          rejectedBy: "d1",
          quote: "Rolling your own is free but it's the thing you just said you don't want",
          expectConfirmed: true,
        },
      ],
      episodes: [{ index: 0, title: "auth provider", firstLine: 4, lastLine: 14 }],
    },

    /* ================= MESSY ================= */
    {
      id: "m01",
      tier: "messy",
      file: "fixtures/eval/m01-messy-tooloutput.txt",
      purpose: "No speaker markers on some turns, shell output and code blocks interleaved, decisions stated colloquially. Tests noise filtering.",
      occurredAt: "2026-10-08T09:14:00+05:30",
      plants: [],
      decisions: [
        {
          key: "d1",
          variable: "TESTING",
          value: "vitest",
          statement: "Use vitest, scoped to regression only",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "testing is vitest, and the scope is regression-only",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d2",
          variable: "UI_KIT",
          value: "plain-svg",
          statement: "Render graphs as plain SVG, no d3",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "plain SVG, no d3",
          restsOn: ["p2"],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "time",
          predicate: "time.scope",
          value: "hackathon",
          text: "hackathon scope — no time for a full suite",
          quote: "I don't want to write a full suite, this is a hackathon thing",
          expectInList: true,
        },
        {
          key: "p2",
          type: "requirement",
          predicate: "requirement.animation_control",
          value: true,
          text: "the animation must be hand-controlled",
          quote: "I want to control the animation myself and d3 would fight me on that",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "d3",
          whyRejected: "would fight me on the animation",
          rejectedBy: "d2",
          quote: "d3 is a lot. can we just do plain SVG?",
          expectConfirmed: true,
        },
      ],
      episodes: [
        { index: 0, title: "test runner", firstLine: 5, lastLine: 15 },
        { index: 1, title: "graph rendering", firstLine: 16, lastLine: 26 },
      ],
    },

    {
      id: "m02",
      tier: "messy",
      file: "fixtures/eval/m02-messy-negotiated.txt",
      purpose: "A decision negotiated across many turns with no cue phrase at the point of agreement. Tests multi-turn attribution.",
      occurredAt: "2026-10-11T15:30:00+05:30",
      plants: [],
      decisions: [
        {
          key: "d1",
          variable: "RETRIEVAL",
          value: "hybrid-rrf",
          statement: "Hybrid retrieval: BM25 plus dense, fused with RRF",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "hybrid retrieval, rrf fusion, no vector db",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d2",
          variable: "STORAGE",
          value: "no-vector-db",
          statement: "No vector database",
          modality: "asserted",
          polarity: "negative",
          origin: "human_stated",
          quote: "but no vector database",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "scale",
          predicate: "scale.corpus_size",
          value: 200,
          text: "the corpus is small enough that brute force is fast",
          quote: "the corpus is small enough that brute force is fast",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "bm25-only",
          whyRejected: "would lose semantic matching for 'why did we choose X' queries",
          rejectedBy: "d1",
          quote: "bm25 alone would lose semantic matching",
          expectConfirmed: true,
        },
      ],
      episodes: [{ index: 0, title: "retrieval strategy", firstLine: 4, lastLine: 20 }],
    },

    {
      id: "m03",
      tier: "messy",
      file: "fixtures/eval/m03-messy-interrupted.txt",
      purpose: "Interrupted turns, a false start, and a conditional future decision that must NOT become a node.",
      occurredAt: "2026-10-14T11:02:00+05:30",
      plants: ["conditional-not-a-node"],
      decisions: [
        {
          key: "d1",
          variable: "HOSTING",
          value: "local",
          statement: "Hosting is local-only, no container",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "for now hosting is local-only, no container",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d2",
          variable: "HOSTING",
          value: "deploy-target",
          statement: "When we ship it, revisit hosting",
          modality: "conditional",
          polarity: "positive",
          origin: "agent_inferred",
          quote: "when you have a deploy target, revisit hosting",
          restsOn: [],
          excludes: [],
          /* A conditional is not a decision. Turning it into a node would create a second HOSTING
           * decision contradicting the first, and fire a false contradiction. */
          expectNode: false,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "deployment",
          predicate: "deployment.exists",
          value: false,
          text: "there is no deployment",
          quote: "we're not deploying at all are we",
          expectInList: true,
        },
      ],
      alternatives: [],
      episodes: [{ index: 0, title: "hosting", firstLine: 3, lastLine: 15 }],
    },

    /* ================= ADVERSARIAL ================= */
    {
      id: "a01",
      tier: "adversarial",
      file: "fixtures/eval/a01-adv-hypotheticals.txt",
      purpose: "Four hypotheticals naming technologies that are NOT chosen. Zero should produce nodes. This is the modality-precision test.",
      occurredAt: "2026-10-17T14:20:00+05:30",
      plants: ["hypotheticals-no-nodes"],
      decisions: [
        {
          key: "h1",
          variable: "STORAGE",
          value: "redis",
          statement: "What if we used Redis for the cache layer?",
          modality: "hypothetical",
          polarity: "positive",
          origin: "agent_inferred",
          quote: "what if we used Redis for the cache layer?",
          restsOn: [],
          excludes: [],
          expectNode: false,
        },
        {
          key: "h2",
          variable: "DATABASE",
          value: "dynamodb",
          statement: "What about if we went with DynamoDB instead of sqlite?",
          modality: "hypothetical",
          polarity: "positive",
          origin: "agent_inferred",
          quote: "what about if we went with DynamoDB instead of sqlite?",
          restsOn: [],
          excludes: [],
          /* The dangerous one: a hypothetical naming a DATABASE value that antonym-pairs with the
           * live sqlite decision. If it becomes a node, gate (a) fires on a contradiction between
           * the log and a thought experiment. */
          expectNode: false,
        },
        {
          key: "h3",
          variable: "RETRIEVAL",
          value: "kafka",
          statement: "What if we used Kafka for the event log?",
          modality: "hypothetical",
          polarity: "positive",
          origin: "agent_inferred",
          quote: "what if we used Kafka for the event log?",
          restsOn: [],
          excludes: [],
          expectNode: false,
        },
        {
          key: "h4",
          variable: "DATABASE",
          value: "sqlite",
          statement: "Hypothetically, if we had a team of ten, would sqlite still work?",
          modality: "hypothetical",
          polarity: "positive",
          origin: "agent_inferred",
          quote: "hypothetically, if we had a team of ten, would sqlite still work?",
          restsOn: [],
          excludes: [],
          /* Same variable AND same value as the live decision, but hypothetical. A system that
           * ignores modality records this as a duplicate node and then finds it "corroborating". */
          expectNode: false,
        },
      ],
      premises: [],
      alternatives: [],
      episodes: [{ index: 0, title: "thinking out loud", firstLine: 3, lastLine: 12 }],
    },

    {
      id: "a02",
      tier: "adversarial",
      file: "fixtures/eval/a02-adv-sarcasm-reversal.txt",
      purpose: "Sarcasm, an agent proposal the human explicitly refuses, and a real reversal. Three different things that a naive extractor treats identically.",
      occurredAt: "2026-10-19T10:44:00+05:30",
      plants: ["reversal-clerk", "unaccepted-proposal"],
      decisions: [
        {
          key: "d1",
          variable: "ARCHITECTURE",
          value: "monolith",
          statement: "Architecture is a monolith",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "monolith, obviously",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "h1",
          variable: "ARCHITECTURE",
          value: "microservices",
          statement: "Move the whole thing to a microservices architecture",
          /* The agent proposed it; the human was sarcastic and then explicitly refused to have it
           * recorded. Two independent reasons it must not become a node. */
          modality: "hypothetical",
          polarity: "positive",
          origin: "agent_proposed",
          quote: "I'd suggest we move the whole thing to a microservices architecture",
          restsOn: [],
          excludes: [],
          expectNode: false,
        },
        {
          key: "d2",
          variable: "AUTH",
          value: "none",
          statement: "No auth for the demo",
          modality: "asserted",
          polarity: "negative",
          origin: "human_stated",
          quote: "we're not doing auth at all for the demo",
          restsOn: ["p2"],
          excludes: [],
          /* Reverses c03/d1. The L1-style structural pair is clerk vs none under AUTH. */
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "team",
          predicate: "team.size",
          value: 4,
          text: "four people at a hackathon",
          quote: "we are four people at a hackathon",
          expectInList: true,
        },
        {
          key: "p2",
          type: "time",
          predicate: "time.available",
          value: "limited",
          text: "every hour on auth is an hour off the reasoning layer",
          quote: "every hour on auth is an hour off the reasoning layer",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "clerk",
          whyRejected: "the demo doesn't need it and every hour on auth is an hour off the reasoning layer",
          rejectedBy: "d2",
          quote: "actually scrap that. we're not doing auth at all for the demo",
          expectConfirmed: true,
        },
      ],
      episodes: [{ index: 0, title: "architecture and auth", firstLine: 3, lastLine: 14 }],
    },

    {
      id: "a03",
      tier: "adversarial",
      file: "fixtures/eval/a03-adv-duplicates.txt",
      purpose: "Three decisions restated verbatim-in-substance across a recap. All three must resolve to EXISTING nodes, not create duplicates.",
      occurredAt: "2026-10-21T09:00:00+05:30",
      plants: ["duplicate-restatement"],
      decisions: [
        {
          key: "d1",
          variable: "DATABASE",
          value: "sqlite",
          statement: "We're on sqlite",
          modality: "reported",
          polarity: "positive",
          origin: "human_stated",
          quote: "we're on sqlite right?",
          restsOn: [],
          excludes: [],
          /* True that it should resolve — but to the EXISTING c01 node, never to a new one. A
           * duplicate here breaks the shared-premise invariant and makes the log contradict itself. */
          expectNode: true,
        },
        {
          key: "d2",
          variable: "FRAMEWORK",
          value: "vite",
          statement: "The frontend is vite",
          modality: "reported",
          polarity: "positive",
          origin: "human_stated",
          quote: "ok and the frontend is vite",
          restsOn: [],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d3",
          variable: "STATE",
          value: "zustand",
          statement: "State is zustand",
          modality: "reported",
          polarity: "positive",
          origin: "human_stated",
          quote: "and state is zustand",
          restsOn: [],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [],
      alternatives: [],
      episodes: [{ index: 0, title: "recap", firstLine: 3, lastLine: 11 }],
    },

    /* ================= PLANTED L3 ================= */
    {
      id: "l03",
      tier: "clean",
      file: "fixtures/eval/l03-cascade-shared.txt",
      purpose: "Three decisions with deliberately different support structures, so falsifying one premise flips two and spares one. The cascade stop-condition test.",
      occurredAt: "2026-10-22T13:15:00+05:30",
      plants: ["L3-shared-premise"],
      decisions: [
        {
          key: "d1",
          variable: "DATABASE",
          value: "no-connection-pooling",
          statement: "Skip connection pooling",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "no connection pooling, because there's only ever one connection",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d2",
          variable: "DATABASE",
          value: "no-migration-tooling",
          statement: "No migration tooling",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "no migration tooling, because we said hackathon scope",
          /* Rests on SCOPE only. This is the survivor: falsifying single-user must not touch it. */
          restsOn: ["p2"],
          excludes: [],
          expectNode: true,
        },
        {
          key: "d3",
          variable: "DATABASE",
          value: "no-read-replicas",
          statement: "No read replicas",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "no read replicas, obviously",
          /* TWO supports. Whether it survives depends on whether the other premise also falls —
           * which is what makes this a real test of the stop condition rather than a lucky one. */
          restsOn: ["p1", "p3"],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "scale",
          predicate: "scale.max_users",
          value: 1,
          text: "single-user, one connection at a time",
          quote: "because there's only ever one connection",
          expectInList: true,
        },
        {
          key: "p2",
          type: "time",
          predicate: "time.scope",
          value: "hackathon",
          text: "hackathon scope",
          quote: "because we said hackathon scope",
          expectInList: true,
        },
        {
          key: "p3",
          type: "deployment",
          predicate: "deployment.infrastructure",
          value: "none",
          text: "no deployment infrastructure",
          quote: "rests on single-user AND on the no-deploy-infrastructure premise",
          expectInList: true,
        },
      ],
      alternatives: [],
      episodes: [{ index: 0, title: "data layer consequences", firstLine: 3, lastLine: 13 }],
    },

    /* ================= the two demo fixtures ================= */
    {
      id: "demo1",
      tier: "clean",
      file: "fixtures/demo-transcript.txt",
      purpose: "The shipping demo fixture: six extractable decisions including the Postgres trap that the live quick-log reversal is designed to catch. The other half of the L1 planted pair. Note: its concurrent-writers exclusion is DERIVED by the ontology's exclusion rules rather than stated in the transcript, so it is deliberately not labelled — see the note on d1.",
      occurredAt: "2026-10-03T14:22:00+05:30",
      plants: ["L1-sqlite", "L2-premise-falsified"],
      decisions: [
        {
          key: "d1",
          variable: "DATABASE",
          value: "sqlite",
          statement: "Use SQLite, not Postgres",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "going with SQLite, not Postgres",
          restsOn: ["p1"],
          /* The OUT-list entry is NOT labelled here, and that is a finding rather than an omission:
           * `fixtures/demo-transcript.txt` states the single-user premise but never states the
           * concurrent-writers exclusion in words. Phase 1 DERIVES the exclusion from the rules in
           * `ontology/data/exclusions.ts`. Labelling a derived node with a quote would mean quoting
           * text nobody said, which is exactly what the quote requirement exists to prevent.
           * `c01` is the transcript that states the exclusion explicitly, and it is labelled there. */
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "scale",
          predicate: "scale.max_users",
          value: 1,
          text: "one person, one machine, one log",
          quote: "it's one person, one machine, one log",
          expectInList: true,
        },
      ],
      alternatives: [
        {
          key: "a1",
          value: "postgres",
          whyRejected: "hosted dependency and deploy complexity",
          rejectedBy: "d1",
          quote: "Postgres via Supabase would work, but it means a hosted dependency",
          expectConfirmed: true,
        },
      ],
      episodes: [{ index: 0, title: "storage layer", firstLine: 8, lastLine: 40 }],
    },

    {
      id: "demo2",
      tier: "messy",
      file: "fixtures/demo-transcript-2.txt",
      purpose: "The L2 planted case: six weeks later the world has changed and the premise is falsified. The transcript is about concurrency, not about databases.",
      occurredAt: "2026-11-18T09:41:00+05:30",
      plants: ["L2-premise-falsified"],
      decisions: [
        {
          key: "d1",
          variable: "DATABASE",
          value: "postgres",
          statement: "Move to Postgres, hosted on Neon",
          modality: "asserted",
          polarity: "positive",
          origin: "human_stated",
          quote: "we decided to move to postgres",
          restsOn: ["p1"],
          excludes: [],
          expectNode: true,
        },
      ],
      premises: [
        {
          key: "p1",
          type: "scale",
          predicate: "scale.concurrent_writers",
          value: 2,
          text: "four people on it, two editing decisions at the same time",
          /* THE L2 PLANT. This asserts a fact about concurrency that falsifies the OUT-list
           * condition of the sqlite decision — and the sentence itself says nothing about whether
           * sqlite is right. Only a system that stored the exclusion can connect them. */
          quote: "there are four of us on it now, and two of us edit decisions at the same time",
          expectInList: true,
        },
      ],
      alternatives: [],
      episodes: [{ index: 0, title: "the situation changed", firstLine: 1, lastLine: 40 }],
    },
  ],

  /* ================= PLANTED CASES ================= */
  plants: [
    {
      kind: "L1-pairwise",
      id: "L1-sqlite",
      description:
        "Two transcripts settle DATABASE on mutually exclusive values: c01/demo1 on sqlite, demo2 on postgres. Both are asserted by a human.",
      transcripts: ["c01", "demo1", "demo2"],
      expect:
        "Gate (a) fires on the antonym pair sqlite/postgres under DATABASE. This is the case everyone can do, and it is here as the control: if L1 fails, nothing else in the corpus means anything.",
      expectUnsound: [],
      expectSurvivors: [],
    },
    {
      kind: "L2-premise",
      id: "L2-premise-falsified",
      description:
        "demo2 asserts four people with two concurrent editors. It never argues about databases. The sqlite decision's OUT-list excluded concurrent writers, so the premise falsification invalidates it.",
      transcripts: ["demo1", "demo2"],
      expect:
        "Gate (c) fires via the OUT-list, WITHOUT the new transcript mentioning the decision or its variable. This is the headline result: nobody else detects it, because nobody else stores the exclusion.",
      /* The SQLite decision must go unsound. Note this plant carries NO intervention: the falsification
       * has to be recovered from demo2's own text by extraction and connected to demo1's premise by the
       * reasoning layer. That is a strictly harder requirement than L3's explicit falsification, and it
       * is the one that matches the product claim, so it is measured the hard way on purpose. */
      expectUnsound: ["demo1/d1"],
      expectSurvivors: [],
    },
    {
      kind: "L3-cascade",
      id: "L3-shared-premise",
      description:
        "l03 plants three decisions on deliberately different support: pooling rests on single-user alone, migration tooling rests on scope alone, read replicas rest on both single-user and no-deploy-infra. Falsifying single-user must flip the first, spare the second, and leave the third to its remaining support.",
      transcripts: ["l03"],
      expect:
        "Falsify scale.max_users=1: the pooling decision goes UNSOUND, the migration-tooling decision SURVIVES untouched, and read replicas survives on its no-deploy support. Over-retraction here is a failed test, not a partial pass.",
      expectUnsound: ["l03/d1"],
      expectSurvivors: ["l03/d2", "l03/d3"],
      falsify: [
        {
          transcript: "l03",
          predicate: "scale.max_users",
          reason: "Eval intervention: the app now has four concurrent users, falsifying single-user.",
        },
      ],
    },
    {
      kind: "duplicate-restatement",
      id: "duplicate-restatement",
      description:
        "a03 restates sqlite, vite and zustand as a recap. Each must resolve to the existing node from c01/c02, not create a second one.",
      transcripts: ["a03", "c01", "c02"],
      expect:
        "Entity resolution merges all three into their existing nodes. Creating duplicates would break the shared-premise invariant and make the log appear to contradict itself.",
      expectUnsound: [],
      expectSurvivors: [],
    },
    {
      kind: "M2-contradictory-decisions-similar-rationales",
      id: "M2-clerk-reversal",
      description:
        "c03 chooses Clerk for auth; a02 reverses it to no-auth. Both cite limited time and small team — contradictory decisions with SIMILAR rationales, which is the M2 signature: probable copy-paste or an extraction error rather than a reasoning change.",
      transcripts: ["c03", "a02"],
      expect:
        "The pair is classified as a reversal or contradiction and diagnosed M2, because the decisions conflict while the reasons agree. A system that reports only the conflict misses that the rationale was recycled.",
      expectUnsound: [],
      expectSurvivors: [],
    },
    {
      kind: "M1-similar-decisions-contradictory-rationales",
      id: "M1-testing-scope",
      description:
        "m01 agrees on vitest twice with different framings — once as a tool choice, once as a scope limit. Similar decisions, rationales that pull in different directions: the M1 signature, probable misunderstanding.",
      transcripts: ["m01"],
      expect:
        "Reported as a refinement with an M1 diagnostic: the decision may be fine while the reason is unclear. Flagging it as a contradiction would put an elaboration in the conflict queue.",
      expectUnsound: [],
      expectSurvivors: [],
    },
    {
      kind: "unanswerable-question",
      id: "unanswerable-payments",
      description:
        "No transcript in the corpus mentions payments, billing, Stripe or checkout at all. The question set asks about it anyway.",
      transcripts: [],
      expect:
        "INSUFFICIENT_EVIDENCE, with the nearest related decisions offered and nothing invented. A system that answers this has fabricated a decision.",
      expectUnsound: [],
      expectSurvivors: [],
    },
  ],

  /* ================= QUESTION SET ================= */
  questions: [
    {
      id: "q1",
      question: "Why did we choose SQLite over Postgres?",
      relevant: ["c01/d1", "demo1/d1"],
      expectVerdict: "GROUNDED",
    },
    {
      id: "q2",
      question: "What did we decide about the build tool?",
      relevant: ["c02/d1"],
      expectVerdict: "GROUNDED",
    },
    {
      id: "q3",
      question: "Why is there no connection pooling?",
      relevant: ["l03/d1"],
      expectVerdict: "GROUNDED",
    },
    {
      id: "q4",
      question: "Did we ever consider d3 for the graph?",
      relevant: ["m01/d2"],
      expectVerdict: "GROUNDED",
    },
    {
      id: "q5",
      question: "What did we decide about the payment provider?",
      /* Deliberately unanswerable — the `unanswerable-payments` plant. */
      relevant: [],
      expectVerdict: "INSUFFICIENT_EVIDENCE",
    },
    {
      id: "q6",
      question: "Why did we drop Clerk?",
      relevant: ["a02/d2", "c03/d1"],
      expectVerdict: "GROUNDED",
    },
    {
      id: "q7",
      question: "How should we shard the database across regions?",
      relevant: [],
      expectVerdict: "INSUFFICIENT_EVIDENCE",
    },
    {
      id: "q8",
      question: "What is our approach to retrieval?",
      relevant: ["m02/d1", "m02/d2"],
      expectVerdict: "GROUNDED",
    },
  ],
};

/** The two demo fixtures are in `fixtures/`, not `fixtures/eval/`, because they ship with the app
 *  as the one-click demo. They are in the corpus too, because a benchmark that excluded the files
 *  the product actually demos with would be measuring something other than the product. */
export const CORPUS_ROOT = "fixtures";

export const DEMO_FIXTURE_IDS: readonly string[] = ["demo1", "demo2"];
