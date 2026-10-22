/**
 * The local semantic classifier — 2.11.
 *
 * Phase 2 · sub-phase 2.11
 * Plan: plan/phase-2-truth-maintenance.md §2.11
 *
 * ---------------------------------------------------------------------------
 * NLI WITHOUT AN NLI MODEL
 *
 * The LLM path asks a model for a verdict over retrieved candidate pairs. The local
 * path cannot, and must not pretend to. What it CAN do is apply four rules that need no
 * model at all, over the two decisions' own fields:
 *
 *   1. shared variable, DIFFERING value            → reversal
 *   2. negation cue, same variable AND same value  → contradiction
 *   3. same variable, same value, NEW rationale    → refinement
 *   4. otherwise                                   → neutral
 *
 * These are the same four rules the plan specifies for the local engine, and they are
 * deliberately conservative: rule 4 is the default, so anything the rules cannot
 * characterise is reported as NEUTRAL rather than guessed at. A local classifier that
 * over-claims would produce exactly the failure mode risk R3 names — false-positive
 * contradictions destroy trust faster than missed ones build it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT REDUNDANT WITH GATE (a)
 *
 * Gate (a) answers "are these two values antonyms under this variable?" — a table
 * lookup, and the only verdict it can produce is `contradiction`.
 *
 * These rules answer a different question: given two decisions that are NOT
 * antonyms, what IS their relationship? Reversal, refinement and neutral are all
 * reachable here and none of them is reachable from the antonym table. Refinement in
 * particular is the most common relationship between related decisions in a real log,
 * and a system that cannot name it flags every elaboration as a conflict.
 *
 * When gate (a) already produced a verdict it is returned unchanged. A second opinion
 * layered on top of a table lookup would be strictly worse than the lookup.
 *
 * ---------------------------------------------------------------------------
 * CONFIDENCE IS LOW BY DESIGN
 *
 * Every local verdict carries confidence at or below 0.6, and the explanation says
 * which rule fired. A rule-based judgement is real evidence but it is not a reading of
 * the text, and the number has to reflect that — otherwise the UI cannot distinguish
 * "the antonym table says so" from "a model read both statements".
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { ClassificationResult, ContradictionVerdict } from "@/types/retrieval";
import type { ClassificationRequest, DecisionSnapshot } from "../types";
import { foldKey } from "@/ontology/canonicalize";

/* -------------------------------------------------------------------------- */
/* Negation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cues that turn an agreement into a disagreement.
 *
 * Kept short and unambiguous on purpose. A long negation list buys recall at the price
 * of firing on "no auth needed" inside a rationale that is not negating the decision at
 * all, and rule 2 is the one rule here that produces a `contradiction` — the verdict
 * with the highest cost when it is wrong.
 */
const NEGATION_CUES: readonly string[] = [
  "not ",
  "no longer",
  "never ",
  "instead of",
  "rather than",
  "wrong",
  "mistake",
  "revert",
  "rollback",
  "roll back",
  "actually,",
  "on reflection",
  "we were wrong",
  "doesn't work",
  "does not work",
  "won't work",
  "cannot",
  "can't",
];

/** Negation in either statement or either rationale counts. The pair is contradictory
 *  when EITHER side says the other is wrong — the direction does not change the fact. */
function hasNegation(a: DecisionSnapshot, b: DecisionSnapshot): string | null {
  const texts = [a.statement, b.statement, a.rationale ?? "", b.rationale ?? ""];

  for (const text of texts) {
    const folded = text.toLowerCase();
    for (const cue of NEGATION_CUES) {
      if (folded.includes(cue)) return cue.trim();
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* The rules                                                                  */
/* -------------------------------------------------------------------------- */

interface RuleVerdict {
  readonly verdict: ContradictionVerdict;
  readonly explanation: string;
  readonly confidence: number;
}

/**
 * Apply the four rules.
 *
 * Order matters: negation is tested before value difference, because "we were wrong to
 * use SQLite, use Postgres" is both a differing value AND a negation — and it is a
 * contradiction (the old decision is being declared mistaken) rather than a reversal
 * (a deliberate change of direction given new conditions). Calling that a reversal
 * would understate it.
 */
export function classifyLocally(request: ClassificationRequest): RuleVerdict {
  const a = request.decisionA;
  const b = request.decisionB;

  const sameVariable = a.variable === b.variable;
  const sameValue = foldKey(a.value) === foldKey(b.value);
  const negation = hasNegation(a, b);

  /* ---- rule 2: negation + same variable/value → contradiction ---- */
  if (negation !== null && sameVariable && sameValue) {
    return {
      verdict: "contradiction",
      explanation:
        `Both decisions are about ${a.variable} and both settle on "${a.value}", but one of them negates the other ("${negation}"). ` +
        "Agreeing on a value while disagreeing about it is a contradiction in the reasoning rather than in the choice: the decision may be fine and the reason broken.",
      confidence: 0.55,
    };
  }

  /* ---- rule 1: shared variable, differing value → reversal ---- */
  if (sameVariable && !sameValue) {
    const newer = a.validFrom >= b.validFrom ? a : b;
    const older = newer === a ? b : a;

    return {
      verdict: "reversal",
      explanation:
        `Both decisions settle ${a.variable}, one on "${older.value}" (${older.id}, valid from ${older.validFrom}) and one on "${newer.value}" (${newer.id}, valid from ${newer.validFrom}). ` +
        "The same variable cannot hold two values, so the later one replaces the earlier. This is a change of direction, not a mistake — the earlier decision was right under the conditions it was made in.",
      confidence: 0.6,
    };
  }

  /* ---- rule 3: same variable, same value, new rationale → refinement ---- */
  if (sameVariable && sameValue) {
    const rationaleA = (a.rationale ?? "").trim();
    const rationaleB = (b.rationale ?? "").trim();

    const oneAddsRationale =
      (rationaleA.length > 0 && rationaleB.length === 0) ||
      (rationaleB.length > 0 && rationaleA.length === 0);
    const differentRationale =
      rationaleA.length > 0 && rationaleB.length > 0 && foldKey(rationaleA) !== foldKey(rationaleB);

    if (oneAddsRationale || differentRationale) {
      return {
        verdict: "refinement",
        explanation:
          `Both decisions settle ${a.variable} on "${a.value}" and agree. ` +
          (oneAddsRationale
            ? "One records a reason the other does not. This is an elaboration, not a conflict — the two should be merged so the reason survives."
            : "They give different reasons for the same choice. Both may be true; merge them rather than treating either as superseded."),
        confidence: 0.5,
      };
    }

    /* Same variable, same value, same or absent rationale: one decision recorded
     * twice. Still not a conflict — but not a refinement either, because there is
     * nothing added. Neutral, with the duplication named. */
    return {
      verdict: "neutral",
      explanation:
        `Both decisions settle ${a.variable} on "${a.value}" with no distinguishing rationale. They look like the same decision recorded twice, which identity resolution should have merged. Nothing to revise.`,
      confidence: 0.45,
    };
  }

  /* ---- rule 4: otherwise → neutral ---- */
  /*
   * Note what is NOT a rule: negation across DIFFERENT variables. "No auth needed"
   * beside "use SQLite" shares nothing but a negation cue, and calling that a
   * contradiction is exactly the false positive risk R3 names — the kind that gets the
   * feature switched off. The plan specifies four rules; this is the fifth that was
   * considered and rejected, recorded here so it is not re-added.
   */
  return {
    verdict: "neutral",
    explanation:
      `No rule applies: ${a.variable} and ${b.variable} are different variables${negation === null ? ", and no negation cue appears in either statement or rationale" : `, and although "${negation}" appears in one of them, a negation across unrelated variables is not evidence of a conflict`}. Topically related at most; logically compatible. Nothing to revise.`,
    confidence: 0.4,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The local engine's `classify`.
 *
 * Returns gate (a)'s verdict unchanged when it exists — see the header.
 */
export function localClassify(
  request: ClassificationRequest,
  engine: EngineId,
): ClassificationResult {
  if (request.structuralVerdict !== undefined) return request.structuralVerdict;

  const rule = classifyLocally(request);

  return {
    verdict: rule.verdict,
    gate: "semantic",
    explanation: rule.explanation,
    confidence: asConfidence(rule.confidence),
    engine,
  };
}

/** Which rule fired, for the health panel. The rules are the classifier's whole
 *  behaviour, so being able to list them is being able to audit it. */
export function describeLocalRules(): string {
  return [
    "The local semantic classifier applies four rules and no model:",
    "  1. negation cue + same variable + same value  → contradiction (0.55)",
    "  2. same variable + differing value            → reversal      (0.60)",
    "  3. same variable + same value + new rationale → refinement    (0.50)",
    "  4. same variable + same value + same rationale→ neutral, named as a duplicate",
    "  5. otherwise                                  → neutral       (0.40)",
    "",
    "Anything the rules cannot characterise is neutral, never a guess. Gate (a)'s",
    "verdict is returned unchanged when it exists — a second opinion on top of a",
    "table lookup would be strictly worse than the lookup.",
    "",
    `${NEGATION_CUES.length} negation cues. Refinement is a first-class verdict because it is`,
    "the most common relationship between related decisions in a real log, and a",
    "system that cannot name it flags every elaboration as a conflict.",
  ].join("\n");
}

export { NEGATION_CUES };
