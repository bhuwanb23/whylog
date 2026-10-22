/**
 * Provenance ΓÇö 1.6.
 *
 * Phase 1 ┬╖ sub-phase 1.6
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.6
 *
 * ---------------------------------------------------------------------------
 * WHAT PROVENANCE IS FOR
 *
 * Four fields, four different consumers:
 *
 *   `snippet`      the review UI's left pane, and the export's evidence quote
 *   `charSpan`     highlighting ΓÇö it must resolve to the RAW input, not the
 *                  normalised one
 *   `origin`       the `source_authority` term of entrenchment, AND the agency
 *                  ledger (Phase 6.4)
 *   `extractedBy`  the badge, and the index-staleness check
 *
 * `origin` is the one with teeth. Entrenchment decides WHICH NODE GETS RETRACTED
 * when two conflict, so an origin that overstates who decided changes what the
 * system throws away. That is why every fallback in this module falls toward LOWER
 * authority.
 *
 * ---------------------------------------------------------------------------
 * WHY SPEAKER ATTRIBUTION IS NON-NEGOTIABLE
 *
 * Because `origin` is computed FROM it. A transcript whose turns cannot be
 * attributed produces `agent_inferred` (0.4) for everything, which is the correct
 * conservative answer ΓÇö but it also means entrenchment cannot distinguish the
 * decisions the human made from the ones the agent suggested. That loss is silent
 * unless it is reported, so `describeProvenance()` says so out loud.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import { ORIGIN_AUTHORITY, type DecisionOrigin, type Modality } from "@/types/domain";
import type { EpisodeWindow } from "./types";
import { accepts, reverses } from "./speakers";
import { locateInEpisode } from "./episode-position";

export interface OriginClassification {
  readonly origin: DecisionOrigin;
  readonly authority: number;
  /** Which rule fired, in words. Shown in the review UI next to the badge: an
   *  origin the user disagrees with must be arguable. */
  readonly via: OriginRule;
  readonly explanation: string;
  /** The human turn that accepted, when there was one. */
  readonly acceptedInTurn: number | null;
  /** The human turn that reversed, when there was one. */
  readonly reversedInTurn: number | null;
}

export type OriginRule =
  | "human-stated"
  | "human-override"
  | "agent-proposal-accepted"
  | "agent-only"
  | "unattributed";

/** How many turns after the cue a human acceptance may appear and still count.
 *  Two rather than one: an agent proposal is often followed by a clarifying
 *  question before the "yeah ok". */
const ACCEPTANCE_WINDOW_TURNS = 2;

/* -------------------------------------------------------------------------- */
/* Origin                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Who decided this.
 *
 * @param episode   the episode the decision came from
 * @param position  the cue's position in `episode.text`
 * @param modality  from `ai/local/modality.ts`
 */
export function classifyOrigin(
  episode: EpisodeWindow,
  position: number,
  modality: Modality,
): OriginClassification {
  const located = locateInEpisode(episode, position);

  // A cue that falls between turns has no speaker, so it has no origin. Lowest
  // authority rather than a guess.
  if (located === null) {
    return {
      origin: "agent_inferred",
      authority: ORIGIN_AUTHORITY.agent_inferred,
      via: "unattributed",
      explanation:
        "The cue could not be attributed to a speaker turn, so this is recorded at the lowest authority rather than guessed at a higher one.",
      acceptedInTurn: null,
      reversedInTurn: null,
    };
  }

  const cueTurn = located.turn;
  const reversedIn = findReversal(episode, located.turnPosition);
  const acceptedIn = cueTurn.speaker === "agent" ? findAcceptance(episode, located.turnPosition) : null;

  /* ---- a human reversing an agent proposal outranks everything ---- */
  if (reversedIn !== null) {
    return {
      origin: "human_override",
      authority: ORIGIN_AUTHORITY.human_override,
      via: "human-override",
      explanation: `A human turn reverses what was proposed here, so the decision is theirs even though the words came from the agent.`,
      acceptedInTurn: acceptedIn,
      reversedInTurn: reversedIn,
    };
  }

  /* ---- cue in a human turn ---- */
  if (cueTurn.speaker === "human") {
    // A QUESTION from a human is not a statement, even though the speaker is
    // right. Modality catches most of these and discards them; a `proposed`
    // modality in a human turn is the human floating an idea, which is still
    // theirs but is not a commitment.
    if (modality === "hypothetical") {
      return {
        origin: "agent_inferred",
        authority: ORIGIN_AUTHORITY.agent_inferred,
        via: "unattributed",
        explanation:
          "A human asked this as a question rather than stating it, so it is recorded at the lowest authority and cannot become a decision without an explicit approval.",
        acceptedInTurn: null,
        reversedInTurn: null,
      };
    }

    return {
      origin: "human_stated",
      authority: ORIGIN_AUTHORITY.human_stated,
      via: "human-stated",
      explanation: "The decision cue is in a human turn.",
      acceptedInTurn: null,
      reversedInTurn: null,
    };
  }

  /* ---- cue in an agent turn ---- */
  if (cueTurn.speaker === "agent") {
    if (acceptedIn !== null) {
      return {
        origin: "agent_proposed_human_accepted",
        authority: ORIGIN_AUTHORITY.agent_proposed_human_accepted,
        via: "agent-proposal-accepted",
        explanation: `The agent proposed it and a human turn accepts within ${ACCEPTANCE_WINDOW_TURNS} turns.`,
        acceptedInTurn: acceptedIn,
        reversedInTurn: null,
      };
    }

    return {
      origin: "agent_inferred",
      authority: ORIGIN_AUTHORITY.agent_inferred,
      via: "agent-only",
      explanation:
        "The decision appears only in an agent turn with no human acceptance. Recorded, but at 0.4 authority and never IN without an explicit approval.",
      acceptedInTurn: null,
      reversedInTurn: null,
    };
  }

  /* ---- unattributed speaker ---- */
  return {
    origin: "agent_inferred",
    authority: ORIGIN_AUTHORITY.agent_inferred,
    via: "unattributed",
    explanation:
      "The turn has no detectable speaker marker. Attribution falls back to the LOWEST authority rather than to human, because guessing high inflates entrenchment.",
    acceptedInTurn: null,
    reversedInTurn: null,
  };
}

/** The first human turn after `from` that accepts. */
function findAcceptance(episode: EpisodeWindow, from: number): number | null {
  const limit = Math.min(episode.turns.length, from + 1 + ACCEPTANCE_WINDOW_TURNS);
  for (let i = from + 1; i < limit; i += 1) {
    const turn = episode.turns[i];
    if (turn === undefined) continue;
    if (turn.speaker !== "human") continue;
    if (accepts(turn.text)) return turn.index;
  }
  return null;
}

/** The first human turn after `from` that reverses. */
function findReversal(episode: EpisodeWindow, from: number): number | null {
  const limit = Math.min(episode.turns.length, from + 1 + ACCEPTANCE_WINDOW_TURNS);
  for (let i = from + 1; i < limit; i += 1) {
    const turn = episode.turns[i];
    if (turn === undefined) continue;
    if (turn.speaker !== "human") continue;
    if (reverses(turn.text)) return turn.index;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Engine stamping                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The engine that produced an item, as a badge label.
 *
 * Kept here rather than in the UI because the wording is a claim about the data:
 * "local" means deterministic and reproducible, "llm" means it will not reproduce.
 * A badge that says only "local" teaches nothing; one that says what follows from
 * it teaches the user to distrust the right things.
 */
export function describeEngine(engine: EngineId): string {
  if (engine.kind === "local") {
    return `local ┬╖ ${engine.model} ΓÇö deterministic, no key, reproducible byte for byte`;
  }
  return `llm ┬╖ ${engine.model} ΓÇö higher recall, not reproducible across runs`;
}

/** Is this item machine-made? Drives the agency ledger's numerator. */
export function isMachineOrigin(origin: DecisionOrigin): boolean {
  return origin === "agent_inferred" || origin === "agent_proposed_human_accepted";
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProvenanceSummary {
  readonly humanStated: number;
  readonly agentAccepted: number;
  readonly agentInferred: number;
  readonly humanOverride: number;
  readonly unattributed: number;
  readonly meanAuthority: number;
}

export function summariseOrigins(origins: readonly OriginClassification[]): ProvenanceSummary {
  const count = (rule: OriginRule): number => origins.filter((o) => o.via === rule).length;
  const mean =
    origins.length === 0
      ? 0
      : origins.reduce((sum, o) => sum + o.authority, 0) / origins.length;

  return {
    humanStated: count("human-stated"),
    agentAccepted: count("agent-proposal-accepted"),
    agentInferred: count("agent-only"),
    humanOverride: count("human-override"),
    unattributed: count("unattributed"),
    meanAuthority: Math.round(mean * 100) / 100,
  };
}

/**
 * The sentence that tells the user how much of this extraction they can trust.
 *
 * Written to be uncomfortable when it should be: a transcript where every decision
 * is agent-inferred and every turn unattributed should SAY SO, because that is a
 * transcript whose entrenchment scores are all floor values.
 */
export function describeProvenance(summary: ProvenanceSummary, total: number): string {
  if (total === 0) return "nothing extracted, so nothing to attribute";

  const parts: string[] = [];
  parts.push(
    `${summary.humanStated} human-stated ┬╖ ${summary.agentAccepted} agent-proposed-and-accepted ┬╖ ${summary.agentInferred} agent-inferred ┬╖ ${summary.humanOverride} human override`,
  );
  parts.push(`mean source authority ${summary.meanAuthority.toFixed(2)}`);

  if (summary.unattributed > 0) {
    parts.push(
      `${summary.unattributed} could not be attributed to a speaker and are recorded at 0.4 authority ΓÇö entrenchment will treat them as weakly held`,
    );
  }
  if (summary.humanStated === 0 && summary.agentInferred > 0) {
    parts.push(
      "no decision in this transcript is human-stated, so every entrenchment score from it is at or near the floor",
    );
  }

  return parts.join(". ");
}

export { ORIGIN_AUTHORITY };
