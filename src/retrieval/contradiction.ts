/**
 * The contradiction classifier — 3.6.
 *
 * Phase 3 · sub-phase 3.6
 * Plan: plan/phase-3-retrieval.md §3.6
 * Verdict definitions: plan/phase-2-truth-maintenance.md §2.4
 *
 * ---------------------------------------------------------------------------
 * RETRIEVAL PROPOSES, THIS DISPOSES — INVARIANT I3
 *
 * "Use Postgres" and "don't use Postgres" are ~0.9 cosine similar. Embedding models encode
 * TOPIC, not POLARITY. Any code path where a similarity threshold decides a contradiction is
 * a bug, not a tuning problem.
 *
 * So the similarity score is used to SELECT candidates and is then THROWN AWAY. Nothing in
 * this file reads it. The verdict comes from variable, value, polarity and rationale — all
 * discrete, all inspectable, none of them a float that drifts when the model changes.
 *
 * That is why `classifyPair` takes two `DecisionSnapshot`s and not a score, and why there is
 * no threshold constant anywhere in this file to tune.
 *
 * ---------------------------------------------------------------------------
 * THE RULE ORDER, AND WHY IT DIFFERS FROM §3.6 AS WRITTEN
 *
 * §3.6 lists five rules and says "in order":
 *
 *   1. shared variable + differing canonical value        → reversal
 *   2. negation cue in scope + same variable and value    → contradiction
 *   3. same variable and value + new rationale            → refinement
 *   4. antonym-pair members asserted on the same variable → contradiction
 *   5. otherwise                                          → neutral
 *
 * **Rule 4 is unreachable in that order.** An antonym pair IS a differing canonical value on
 * a shared variable, so rule 1 always fires first and rule 4 can never be reached. But §3.6's
 * own acceptance criterion requires that "the classifier's five verdicts are individually
 * testable" — and an unreachable rule is not testable.
 *
 * So the antonym test moves to the front, which is also what the semantics want:
 *
 *   1. ANTONYM PAIR on the same variable                  → contradiction
 *      Two declared-mutually-exclusive choices, both live. This is gate (a)'s territory and
 *      it is a genuine conflict, not a change of mind.
 *   2. negation cue in scope + same variable and value    → contradiction
 *      The values AGREE but one statement negates the other — the reasoning conflicts even
 *      though the choice does not.
 *   3. shared variable + differing (non-antonym) value    → reversal
 *      A change of direction: "sqlite" then "sqlite with WAL". Deliberate, superseded, both
 *      retained. Calling this a contradiction would put every refinement in the conflict
 *      queue, which is how the feature gets switched off.
 *   4. same variable and value + new or changed rationale → refinement
 *   5. otherwise                                          → neutral
 *
 * All five are now reachable and individually testable. The deviation is recorded here and in
 * STRUCTURE.md §18.3 rather than silently "fixed", because a plan and an implementation that
 * disagree without a note is how the next person reintroduces the bug.
 *
 * ---------------------------------------------------------------------------
 * HYPOTHETICALS PRODUCE NO VERDICT AT ALL
 *
 * §3.6's acceptance criterion. A `proposed` or `hypothetical` decision never became a belief,
 * so it cannot contradict one. Classifying it would report a conflict between something the
 * user decided and something they were thinking aloud about.
 * ---------------------------------------------------------------------------
 */

import type { ClassificationRequest, DecisionSnapshot } from "@/ai/types";
import { areAntonyms, canonicalValueOf } from "@/ontology";
import { foldKey } from "@/ontology/canonicalize";
import type { DecisionId, EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionStatus } from "@/types/domain";
import type { ClassificationResult, ContradictionVerdict } from "@/types/retrieval";
import { type NegationScopeVerdict, negationBetween } from "./negation";

/** Which rule fired. Carried on every verdict because the explanation has to name the rule
 *  that decided it — a verdict without its rule is an assertion, not a diagnosis. */
export type ClassifierRule =
  | "antonym-pair"
  | "negation-scope"
  | "differing-value"
  | "new-rationale"
  | "no-rule";

export interface PairVerdict {
  readonly verdict: ContradictionVerdict;
  readonly rule: ClassifierRule;
  readonly explanation: string;
  readonly confidence: number;
  readonly negation: NegationScopeVerdict | null;
}

/* -------------------------------------------------------------------------- */
/* The classifier                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Classify one pair. Pure, deterministic, engine-independent.
 *
 * This is the canonical rule engine. `ai/local/classify.ts` delegates here for the local
 * path, and the LLM path uses it as the `structuralVerdict` it must explicitly disagree with
 * rather than silently override.
 */
export function classifyPair(a: DecisionSnapshot, b: DecisionSnapshot): PairVerdict {
  const sameVariable = a.variable === b.variable;
  const canonicalA = canonicalValueOf(a.variable, a.value);
  const canonicalB = canonicalValueOf(b.variable, b.value);
  const sameValue = foldKey(canonicalA) === foldKey(canonicalB);

  /* ---- rule 1: antonym pair ---- */
  if (sameVariable && !sameValue) {
    const antonym = areAntonyms(a.variable, canonicalA, canonicalB);
    if (antonym.antonym) {
      return {
        verdict: "contradiction",
        rule: "antonym-pair",
        explanation: `Both settle ${a.variable}, one on "${canonicalA}" and one on "${canonicalB}", and the ontology declares those mutually exclusive. ${antonym.why ?? ""}`,
        confidence: 0.95,
        negation: null,
      };
    }
  }

  /* ---- rule 2: negation in scope, values agree ---- */
  if (sameVariable && sameValue) {
    const negation = negationBetween(
      a.statement + (a.rationale === undefined ? "" : ` ${a.rationale}`),
      b.statement + (b.rationale === undefined ? "" : ` ${b.rationale}`),
      canonicalA,
    );

    if (negation.negated) {
      return {
        verdict: "contradiction",
        rule: "negation-scope",
        explanation: `Both settle ${a.variable} on "${canonicalA}", but one of them negates it within scope ("${negation.cue}"). ${negation.reason} The choice agrees and the reasoning does not, which is a contradiction in the justification rather than in the decision.`,
        confidence: 0.6,
        negation,
      };
    }

    /* ---- rule 4: same variable, same value, new or changed rationale ---- */
    const rationaleA = (a.rationale ?? "").trim();
    const rationaleB = (b.rationale ?? "").trim();
    const oneAdds = rationaleA.length > 0 !== rationaleB.length > 0;
    const differs =
      rationaleA.length > 0 && rationaleB.length > 0 && foldKey(rationaleA) !== foldKey(rationaleB);

    if (oneAdds || differs) {
      return {
        verdict: "refinement",
        rule: "new-rationale",
        explanation: `Both settle ${a.variable} on "${canonicalA}" and agree. ${
          oneAdds
            ? "One records a reason the other does not, so this is an elaboration — merge them so the reason survives."
            : "They give different reasons for the same choice. Both may be true; merge rather than supersede."
        }`,
        confidence: 0.55,
        negation: null,
      };
    }

    return {
      verdict: "neutral",
      rule: "no-rule",
      explanation: `Both settle ${a.variable} on "${canonicalA}" with no distinguishing rationale. Nothing to revise — this looks like one decision recorded twice.`,
      confidence: 0.45,
      negation: null,
    };
  }

  /* ---- rule 3: shared variable, differing non-antonym value ---- */
  if (sameVariable && !sameValue) {
    const newer = a.validFrom >= b.validFrom ? a : b;
    const older = newer === a ? b : a;

    return {
      verdict: "reversal",
      rule: "differing-value",
      explanation: `Both settle ${a.variable}, one on "${older.value}" (${older.id}, valid from ${older.validFrom}) and one on "${newer.value}" (${newer.id}, valid from ${newer.validFrom}). The values are not a declared antonym pair, so this reads as a change of direction rather than a contradiction: the earlier decision was right under the conditions it was made in, and the later one replaces it.`,
      confidence: 0.7,
      negation: null,
    };
  }

  /* ---- rule 5 ---- */
  return {
    verdict: "neutral",
    rule: "no-rule",
    explanation: `Different variables (${a.variable} and ${b.variable}) and no negation reaching a shared value. Topically related at most; logically compatible.`,
    confidence: 0.4,
    negation: null,
  };
}

/* -------------------------------------------------------------------------- */
/* The hypothetical guard — §3.6's acceptance criterion                       */
/* -------------------------------------------------------------------------- */

/**
 * May this decision be classified at all?
 *
 * A `proposed` decision never became a belief, so it cannot contradict one. Neither can a
 * `superseded` or `archived` one against a live decision: the log has already withdrawn it,
 * and reporting a conflict with a belief the system no longer holds would put resolved
 * history back in the conflict queue.
 *
 * `contested` IS classifiable — that is precisely the state where a conflict is live and
 * awaiting a human call, so it must keep being visible.
 *
 * This lives here rather than in `ai/local/classify.ts` because `DecisionSnapshot` carries no
 * lifecycle status: whether a decision may be classified is pipeline policy applied before a
 * request is built, not engine behaviour. An engine told "don't classify this" would have to
 * invent a verdict to return; never being asked does not.
 */
export function isClassifiable(status: DecisionStatus): boolean {
  return status === "active" || status === "contested";
}

export function explainNotClassifiable(status: DecisionStatus): string {
  switch (status) {
    case "proposed":
      return "It is still a proposal. Nothing was ever believed, so nothing can contradict it.";
    case "superseded":
      return "It has been superseded. The log already withdrew it, so a conflict with it is resolved history, not a live finding.";
    case "archived":
      return "It has been archived. Same reason as superseded: reporting it would put settled history back in the conflict queue.";
    case "active":
    case "contested":
      return "";
  }
}

/* -------------------------------------------------------------------------- */
/* M1 / M2 diagnostics                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Borrowed from arXiv:2506.11005, and surfaced separately because they mean different
 * things and have different remedies.
 *
 *   M1 — SIMILAR decisions, CONTRADICTORY rationales → probable misunderstanding.
 *        The decision may be fine; the REASON is broken.
 *   M2 — CONTRADICTORY decisions, SIMILAR rationales → probable copy-paste or an
 *        extraction error. A DATA-QUALITY problem, not a reasoning problem.
 *
 * Both need a similarity judgement, which is the one thing invariant I3 forbids this file
 * from making about VERDICTS. Using it for a diagnostic is different in kind: an M1/M2 label
 * never changes what the system does, only how it describes what it found, and a wrong
 * diagnostic is a wrong footnote rather than a wrong retraction.
 */
export function diagnose(
  verdict: ContradictionVerdict,
  rationaleSimilarity: number,
): "M1" | "M2" | null {
  if (verdict === "contradiction" && rationaleSimilarity >= M2_RATIONALE_FLOOR) return "M2";
  if (verdict === "refinement" && rationaleSimilarity <= M1_RATIONALE_CEILING) return "M1";
  return null;
}

export const M1_RATIONALE_CEILING = 0.35;
export const M2_RATIONALE_FLOOR = 0.8;

export const DIAGNOSTIC_MEANING: Readonly<Record<"M1" | "M2", string>> = {
  M1: "Similar decisions with contradictory rationales — probable misunderstanding. The decision may be fine; the reason is broken.",
  M2: "Contradictory decisions with similar rationales — probable copy-paste or an extraction error. A data-quality problem, not a reasoning problem.",
};

/* -------------------------------------------------------------------------- */
/* Batch classification                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Classify every candidate pair retrieval produced.
 *
 * Pairs are de-duplicated by sorted id so a pair retrieved from both directions is judged
 * once, and only pairs where at least one side is `asserted` are judged at all — a
 * hypothetical cannot contradict a belief.
 */
export function classifyPairs(
  pairs: readonly { a: DecisionSnapshot; b: DecisionSnapshot }[],
  engine: EngineId,
): readonly ClassificationResult[] {
  const seen = new Set<string>();
  const out: ClassificationResult[] = [];

  for (const pair of pairs) {
    const key =
      pair.a.id < pair.b.id ? `${pair.a.id}\u0000${pair.b.id}` : `${pair.b.id}\u0000${pair.a.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const verdict = classifyPair(pair.a, pair.b);

    /* No similarity is available here, so no diagnostic is claimed. M1/M2 both need a
     * rationale-similarity judgement; guessing one would print a confident footnote over a
     * number nobody computed. */
    const diagnostic = null;

    out.push({
      verdict: verdict.verdict,
      gate: "semantic",
      explanation: verdict.explanation,
      confidence: asConfidence(verdict.confidence),
      engine,
      ...(diagnostic === null ? {} : { diagnostic }),
    });
  }

  return out;
}

/** Build the request the engine's `classify` expects, with this classifier's verdict as the
 *  structural answer the model must explicitly disagree with rather than silently override. */
export function requestFor(
  a: DecisionSnapshot,
  b: DecisionSnapshot,
  engine: EngineId,
  sharedPremises?: ClassificationRequest["sharedPremises"],
): ClassificationRequest {
  const local = classifyPair(a, b);

  return {
    decisionA: a,
    decisionB: b,
    ...(sharedPremises === undefined ? {} : { sharedPremises }),
    structuralVerdict: {
      verdict: local.verdict,
      gate: "semantic",
      explanation: local.explanation,
      confidence: asConfidence(local.confidence),
      engine,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeVerdict(verdict: ContradictionVerdict): string {
  switch (verdict) {
    case "contradiction":
      return "CONTRADICTION — cannot both hold. Full revision cycle.";
    case "reversal":
      return "REVERSAL — the newer deliberately replaces the older on the same variable. Supersede; both retained.";
    case "refinement":
      return "REFINEMENT — same variable, same value, added or corrected rationale. Merge; corroboration +1; no label change. This is by far the most common relationship between related decisions, and flagging it as a conflict is how the feature gets switched off.";
    case "premise-invalidation":
      return "PREMISE-INVALIDATION — no conflict between the decisions; a shared premise became false. Gate (c) handles this.";
    case "neutral":
      return "NEUTRAL — topically related, logically compatible. A `related` edge for the graph view; nothing else.";
  }
}

export function describeRule(rule: ClassifierRule): string {
  switch (rule) {
    case "antonym-pair":
      return "rule 1 — the ontology declares these two values mutually exclusive under this variable";
    case "negation-scope":
      return "rule 2 — the values agree but a negation cue falls within scope of the value";
    case "differing-value":
      return "rule 3 — same variable, different value, not a declared antonym pair";
    case "new-rationale":
      return "rule 4 — same variable and value, with a rationale one side has and the other does not";
    case "no-rule":
      return "rule 5 — no rule applies; neutral by default, never by guess";
  }
}

/** The five rules in order, for the health panel. Listing them is what makes the classifier
 *  auditable: there is no threshold to hide behind and no model to appeal to. */
export function describeRules(): string {
  return [
    "The contradiction classifier applies five rules in this order and reads no similarity score:",
    "  1. antonym pair on the same variable            → contradiction   (0.95)",
    "  2. negation in scope + same variable and value  → contradiction   (0.60)",
    "  3. same variable + differing value              → reversal        (0.70)",
    "  4. same variable and value + new rationale      → refinement      (0.55)",
    "  5. otherwise                                    → neutral         (0.40)",
    "",
    "§3.6 lists rule 4 (antonym pair) fourth, which makes it unreachable: an antonym pair is a",
    "differing value, so rule 3 would always fire first. §3.6 also requires all five verdicts to",
    "be individually testable, so the antonym test is moved to the front. Recorded in",
    "STRUCTURE.md §18.3 rather than silently reconciled.",
    "",
    "Invariant I3: similarity SELECTS candidates and is then discarded. Nothing here reads a",
    "score, and there is no threshold constant in this file to tune.",
  ].join("\n");
}

export type { DecisionId };
