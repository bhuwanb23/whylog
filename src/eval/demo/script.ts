/**
 * The demo script — 7.5.
 *
 * Phase 7 · sub-phase 7.5
 *
 * ---------------------------------------------------------------------------
 * THE SCRIPT IS DATA, AND THE VERIFIER RUNS IT
 *
 * A demo script in a markdown file rots: the clicks stop matching the UI and nobody notices until the
 * rehearsal. Here the script is a typed list of beats, each with the view it happens in, the action
 * taken, what the audience should see, and the predicate that says whether it happened.
 *
 * `verify.ts` walks the same list. So the script that gets rehearsed, the script that gets checked and
 * the script that gets presented are one artefact, and a beat whose predicate fails is a beat that
 * cannot be delivered — found before the room rather than in it.
 *
 * ---------------------------------------------------------------------------
 * FIVE MINUTES, AND THE PEAK IS GATE (c)
 *
 * The plan is explicit that the demo peak is premise invalidation, not contradiction detection. Beat 5
 * is where it lands and every earlier beat exists to make it legible: by the time the presenter says
 * "nothing contradicted me", the audience has already seen the decision, seen its premises, and seen a
 * transcript that never mentions databases.
 *
 * Contradiction detection is beat 3 and is deliberately underplayed. It is the thing every competitor
 * can do, and spending the demo's momentum on it would be spending it on the least defensible claim.
 * ---------------------------------------------------------------------------
 */

import type { DemoKiller } from "../hardening";

export type ViewId =
  | "foundation" | "review" | "reasoning" | "ask" | "guards" | "export"
  | "graph" | "timeline" | "health" | "time-machine" | "settings";

export interface Beat {
  readonly n: number;
  readonly seconds: number;
  readonly view: ViewId;
  /** What the presenter does. One action per beat: a beat with two actions is two beats, and a script
   *  that cannot be walked one step at a time cannot be recovered from mid-presentation. */
  readonly action: string;
  /** What the audience should see, in words a non-technical judge can follow. */
  readonly expect: string;
  /** The line to say. Written out rather than paraphrased, because the wording of the peak beat has
   *  been chosen and improvising it loses the point. */
  readonly say: string;
  /** Machine-checkable. `verify.ts` evaluates it against the seeded graph. */
  readonly check: CheckId;
  /** Which demo-killer this beat would expose if it went wrong. Beats that expose none are marked
   *  "none" and are the ones safe to cut if the demo is running long. */
  readonly killer: DemoKiller["id"] | "none";
}

export type CheckId =
  | "seed-has-sqlite-decision"
  | "seed-has-premises"
  | "reversal-detected"
  | "l2-unsound"
  | "no-hypothetical-nodes"
  | "guards-proposed-not-failing"
  | "export-contains-decision"
  | "answer-is-grounded"
  | "graph-renders"
  | "none";

export const DEMO_SECONDS = 300;

export const SCRIPT: readonly Beat[] = [
  {
    n: 1,
    seconds: 30,
    view: "foundation",
    action: "Load the seed and show the SQLite decision with its premises expanded.",
    expect: "A decision card reading 'Use SQLite, not Postgres' with two premises beneath it: single-user, and no deploy infrastructure.",
    say:
      "This is a decision an AI agent helped me make in October. Every tool that stores this stores the " +
      "decision. Notice what is underneath it — the assumptions it is true GIVEN. Nobody stores those.",
    check: "seed-has-premises",
    killer: "false-premise-resolution",
  },
  {
    n: 2,
    seconds: 30,
    view: "graph",
    action: "Open the graph view and highlight the SQLite decision and its premise column.",
    expect: "A bipartite lattice: premises in one column, decisions in another, edges from the SQLite decision to both of its premises.",
    say:
      "The graph is bipartite on purpose. Decisions on one side, assumptions on the other. The layout is " +
      "deterministic — same graph, same picture, every time — because a diagram that moves between runs " +
      "cannot be reasoned about.",
    check: "graph-renders",
    killer: "none",
  },
  {
    n: 3,
    seconds: 40,
    view: "reasoning",
    action: "Quick-log the reversal: 'actually let's switch to Postgres, we need concurrent writes'.",
    expect: "A contradiction is raised between the new Postgres decision and the October SQLite decision, and the older one moves to superseded.",
    say:
      "Now I contradict myself. This is the part every tool can do — you said SQLite, now you said " +
      "Postgres, here is a red badge. It is worth about thirty seconds of your attention, because it is " +
      "not why this exists.",
    check: "reversal-detected",
    killer: "none",
  },
  {
    n: 4,
    seconds: 45,
    view: "foundation",
    action: "Import the second fixture — the November transcript — and show that it never mentions databases.",
    expect: "The transcript is imported and its decisions appear. None of them is about a database. Scroll the text to prove it: the word appears nowhere.",
    say:
      "Here is a transcript from a month later. Read it. There is no database decision in it. There is no " +
      "argument about storage. The word Postgres does not appear. What it says is that there are now four " +
      "people on the project and two of them edit decisions at the same time.",
    check: "seed-has-sqlite-decision",
    killer: "false-premise-resolution",
  },
  {
    n: 5,
    seconds: 60,
    view: "reasoning",
    action: "Show the SQLite decision's label change to unsound, with the reason naming the falsified premise.",
    expect: "The October SQLite decision is marked OUT, and the reason names the concurrent-writers exclusion — a premise that was in the OUT-list of its justification.",
    say:
      "Nothing contradicted me. I never said the word database. The world moved, and the log noticed — " +
      "because the decision was stored with the assumption it rests on, and the assumption stopped " +
      "holding. This is the whole product. Contradiction detection fires when you contradict yourself. " +
      "This fires when reality does.",
    check: "l2-unsound",
    killer: "false-premise-resolution",
  },
  {
    n: 6,
    seconds: 35,
    view: "graph",
    action: "Replay the cascade and show that decisions sharing no premise with the falsified one keep their labels.",
    expect: "The cascade animation flips the SQLite decision and leaves unrelated decisions untouched. The survivors are visibly still IN.",
    say:
      "A cascade that retracts everything reachable is worse than no cascade. Watch what does NOT change: " +
      "these decisions rest on other assumptions, so they keep their labels. Over-retraction is the " +
      "failure mode that ends a tool like this, and it is the one we measure hardest.",
    check: "no-hypothetical-nodes",
    killer: "cascade-over-retraction",
  },
  {
    n: 7,
    seconds: 30,
    view: "guards",
    action: "Show the guards proposed for the Postgres decision, and the verify command compiled from them.",
    expect: "A list of PROPOSED guards — not installed — with a copyable verify command.",
    say:
      "Every decision gets a check generated from it. Proposed, never auto-installed — the system proposes " +
      "and you dispose. Nobody in the fitness-function literature generates the check from the decision; " +
      "it is always written by hand, which is why it is always stale.",
    check: "guards-proposed-not-failing",
    killer: "day-one-guard-failures",
  },
  {
    n: 8,
    seconds: 30,
    view: "export",
    action: "Export to CLAUDE.md and show the rejected-alternatives block and the consistency stamp.",
    expect: "A CLAUDE.md with imperative MUST/MUST NOT rules scoped to globs, a rejected block, and a stamp whose digest covers the body.",
    say:
      "And it exports to what your agent actually reads — CLAUDE.md, AGENTS.md, .cursorrules — with the " +
      "rejected alternatives in there too, so the agent does not re-propose Postgres in three weeks. " +
      "Stamped, so you can tell whether the file matches the graph.",
    check: "export-contains-decision",
    killer: "none",
  },
];

export function totalSeconds(script: readonly Beat[] = SCRIPT): number {
  return script.reduce((sum, beat) => sum + beat.seconds, 0);
}

/** Beats safe to cut if the demo is running long, in cut order. None of them exposes a demo-killer,
 *  which is the criterion: a beat that could reveal a killer is not cuttable on stage. */
export function cuttableBeats(script: readonly Beat[] = SCRIPT): readonly Beat[] {
  return script.filter((beat) => beat.killer === "none");
}

export function renderScript(script: readonly Beat[] = SCRIPT): string {
  const lines: string[] = [];

  lines.push("DEMO SCRIPT — " + script.length + " beats, " + totalSeconds(script) + "s (" +
    (totalSeconds(script) / 60).toFixed(1) + " min)");
  lines.push("Cuttable if running long: " + cuttableBeats(script).map((beat) => "beat " + beat.n).join(", "));
  lines.push("");

  for (const beat of script) {
    lines.push("BEAT " + beat.n + " · " + beat.seconds + "s · " + beat.view + " · check: " + beat.check +
      (beat.killer === "none" ? "" : " · exposes: " + beat.killer));
    lines.push("  DO:     " + beat.action);
    lines.push("  SEE:    " + beat.expect);
    lines.push("  SAY:    " + beat.say);
    lines.push("");
  }

  return lines.join("\n");
}
