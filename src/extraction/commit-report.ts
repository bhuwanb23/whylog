/**
 * Commit reporting — the words a commit is described in.
 *
 * Phase 1 · sub-phase 1.9
 * Plan: plan/phase-1-extraction-pipeline.md §1.9
 *
 * Split out of `commit.ts` because the write path is the part that must be
 * obviously correct, and three paragraphs of string building make it less so. The
 * sentences here are load-bearing in a different way: a refusal the user cannot
 * understand is a refusal they will work around, and "nothing enters the log
 * unreviewed" only holds while the reason for a refusal is readable.
 */

import type { CommitCounts, CommitFailure } from "./commit";
import type { ReviewAction } from "./types";

/** What the commit wrote, ending with the number that matters most: how many
 *  justifications carry an OUT-list, because that is how many decisions from this
 *  transcript gate (c) can fire on. */
export function describeCounts(counts: CommitCounts): string {
  const parts = [
    `${counts.decisions} decision${counts.decisions === 1 ? "" : "s"}`,
    `${counts.premises} premise${counts.premises === 1 ? "" : "s"}`,
    `${counts.justifications} justification${counts.justifications === 1 ? "" : "s"}`,
  ];
  if (counts.alternatives > 0) {
    parts.push(
      `${counts.alternatives} rejected alternative${counts.alternatives === 1 ? "" : "s"}`,
    );
  }
  if (counts.discards > 0)
    parts.push(`${counts.discards} discard${counts.discards === 1 ? "" : "s"}`);

  const tail =
    counts.nonMonotonic > 0
      ? `${counts.nonMonotonic} of those justifications carry an OUT-list, so gate (c) can fire on them`
      : "no OUT-lists, so nothing from this transcript can be invalidated by the world — only contradicted by you";

  return `${counts.events} events: ${parts.join(", ")}. ${tail}.`;
}

/**
 * Why a commit was refused.
 *
 * The `unreviewed` case is the important one and gets three sentences, because it
 * is the rule the whole review exists to enforce and a one-line error reads like a
 * bug rather than a policy.
 */
export function describeFailure(failure: CommitFailure): string {
  switch (failure.kind) {
    case "unreviewed":
      return [
        `${failure.keys.length} item${failure.keys.length === 1 ? "" : "s"} have no review action, and nothing enters the log unreviewed.`,
        "Decide each one, or discard the unreviewed ones explicitly.",
        `${failure.keys.slice(0, 6).join(", ")}${failure.keys.length > 6 ? ", …" : ""}`,
      ].join(" ");
    case "empty":
      return "There is nothing in this run to commit.";
    case "no-accepted":
      return "Every item was discarded. The discards will be recorded, but no nodes are created.";
  }
}

/** The action tally, for the confirm dialog's header. */
export function describeActions(actions: readonly (ReviewAction | null)[]): string {
  const tally = new Map<ReviewAction, number>();
  for (const action of actions) {
    if (action === null) continue;
    tally.set(action, (tally.get(action) ?? 0) + 1);
  }
  if (tally.size === 0) return "no actions";
  return [...tally.entries()].map(([action, count]) => `${count} ${action}`).join(" · ");
}

/** The sentence shown while a commit is in flight. Committing appends a batch and
 *  re-folds, which at a few hundred events is imperceptible but not instant, and a
 *  spinner with no words reads as a hang. */
export function describeInProgress(counts: {
  decisions: number;
  premises: number;
  events: number;
}): string {
  return `Appending ${counts.events} events for ${counts.decisions} decisions and ${counts.premises} premises…`;
}
