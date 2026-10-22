/**
 * Gate (a) — structural contradiction. 2.3.
 *
 * Phase 2 · sub-phase 2.3
 * Plan: plan/phase-2-truth-maintenance.md §2.3
 * Research: docs/03 §4 (three-gate detector), docs/02 §4
 *
 * ---------------------------------------------------------------------------
 * THE CREDIBILITY ANCHOR
 *
 * This gate needs no model, no network, no threshold and no judgement. When somebody
 * asks "isn't this just an LLM wrapper?", the answer is that the most important
 * contradiction in the demo fires from a hash lookup and a date comparison.
 *
 * It is also the gate that works when everything else is degraded: no key, a stale
 * index, an embedding model that changed. Determinism is not a limitation here, it
 * is the feature.
 *
 * ---------------------------------------------------------------------------
 * THE LOAD-BEARING FACT BEHIND IT
 *
 * "use Postgres" and "don't use Postgres" are ~0.9 cosine similar (docs/03). A
 * negation changes almost nothing in vector space, so embeddings CANNOT detect
 * contradiction — they detect topical similarity. Gate (a) fires precisely where
 * retrieval is blind, which is why it runs first and never consults a vector.
 *
 * ---------------------------------------------------------------------------
 * PRECISION DISCIPLINE
 *
 * Structural hits are high-precision and low-recall: they fire only when both
 * decisions resolved to the same ontology variable. NEVER widen this gate with fuzzy
 * matching to improve recall — that is gate (b)'s job, and mixing them destroys the
 * one detector whose false-positive rate is provably zero. A user who learns that
 * "contradiction" sometimes means "these two seemed related" stops reading the
 * warnings, and then the real one is missed too.
 * ---------------------------------------------------------------------------
 */

import { canonicalValueOf } from "@/ontology/canonicalize";
import { areAntonyms } from "@/ontology/data/antonyms";
import { overlaps } from "@/substrate/bi-temporal";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, ValidityWindow } from "@/types/common";
import type { DecisionVariable } from "@/types/domain";
import type { ContradictionVerdict } from "@/types/retrieval";

export interface StructuralHit {
  readonly gate: "structural";
  readonly verdict: ContradictionVerdict;
  readonly decisionA: DecisionId;
  readonly decisionB: DecisionId;
  readonly variable: DecisionVariable;
  readonly valueA: string;
  readonly valueB: string;
  /** Which of the two rules fired. Shown verbatim, so the user is told the RULE
   *  rather than shown a similarity score they cannot argue with. */
  readonly via: "different-value" | "antonym-pair";
  readonly explanation: string;
  readonly why: string | null;
}

/**
 * Every structural contradiction among LIVE, IN-labelled decisions.
 *
 * Two rules, and a pair may satisfy both:
 *
 *   1. same variable, different canonical value — two live answers to one question
 *   2. both values are a declared antonym pair — the table says why they cannot
 *      coexist, which is a better explanation than "they differ"
 *
 * Superseded and archived decisions are excluded. Reversing a decision is not
 * contradicting it: the log keeps both, linked by `supersedes`, and flagging every
 * reversal would put the whole supersession mechanism in the conflict queue.
 */
export function detectStructural(state: GraphState): readonly StructuralHit[] {
  const hits: StructuralHit[] = [];
  const seen = new Set<string>();

  for (const [variable, ids] of state.byVariable) {
    const live = ids
      .map((id) => state.decisions.get(id))
      .filter(
        (decision) =>
          decision !== undefined &&
          decision.label === "IN" &&
          decision.status !== "superseded" &&
          decision.status !== "archived",
      );

    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const a = live[i];
        const b = live[j];
        if (a === undefined || b === undefined) continue;

        const canonicalA = canonicalValueOf(variable, a.value);
        const canonicalB = canonicalValueOf(variable, b.value);
        if (canonicalA === canonicalB) continue;

        // A reversal is recorded as a supersession, not as a contradiction. If the
        // graph already links them, this pair has been adjudicated once and the
        // answer was "the later one wins".
        if (a.edges.supersedes.includes(b.id) || b.edges.supersedes.includes(a.id)) continue;

        // Overlapping VALIDITY WINDOWS are part of the rule, not a refinement. Two
        // decisions that were true at different times are a history, not a conflict,
        // and firing on a history is how a detector learns to cry wolf.
        if (!overlaps(a.temporal, b.temporal)) continue;

        const key = pairKey(a.id, b.id);
        if (seen.has(key)) continue;
        seen.add(key);

        const antonym = areAntonyms(variable, canonicalA, canonicalB);
        const why = antonym.antonym ? antonym.why : null;

        hits.push({
          gate: "structural",
          verdict: "contradiction",
          decisionA: a.id,
          decisionB: b.id,
          variable,
          valueA: canonicalA,
          valueB: canonicalB,
          via: antonym.antonym ? "antonym-pair" : "different-value",
          explanation: antonym.antonym
            ? `${a.id} and ${b.id} are both live and IN on ${variable}, and "${canonicalA}" and "${canonicalB}" are a declared antonym pair. ${why ?? ""}`.trim()
            : `${a.id} and ${b.id} are both live and IN on ${variable} with different values: "${canonicalA}" and "${canonicalB}". One question, two current answers.`,
          why,
        });
      }
    }
  }

  return hits;
}

/** Placeholder standing in for the decision that does not exist yet. `wouldContradict`
 *  runs BEFORE a commit, so there is no id to name; a sentinel keeps the hit shape
 *  identical to a real one and the review UI can render both with one component. */
export const NEWCOMER_ID = "WLD-NEW" as DecisionId;

/** Stable regardless of argument order, so a pair is never reported twice. */
export function pairKey(a: DecisionId, b: DecisionId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Would asserting this value contradict something already live?
 *
 * Called BEFORE a commit rather than after, which is what lets the review UI say
 * "this contradicts WLD-0003" at the moment the user is deciding whether to keep an
 * extracted decision. Detecting it afterwards is still correct, but by then the node
 * exists and retracting it is a bigger act than refusing it.
 */
export function wouldContradict(
  state: GraphState,
  variable: DecisionVariable,
  value: string,
  window?: ValidityWindow,
): readonly StructuralHit[] {
  const canonical = variable === "OTHER" ? value : canonicalValueOf(variable, value);
  const ids = state.byVariable.get(variable) ?? [];
  const hits: StructuralHit[] = [];

  for (const id of ids) {
    const existing = state.decisions.get(id);
    if (existing === undefined) continue;
    if (existing.label !== "IN") continue;
    if (existing.status === "superseded" || existing.status === "archived") continue;

    const existingCanonical = canonicalValueOf(variable, existing.value);
    if (existingCanonical === canonical) continue;
    if (window !== undefined && !overlaps(existing.temporal, window)) continue;

    const antonym = areAntonyms(variable, canonical, existingCanonical);
    hits.push({
      gate: "structural",
      verdict: "contradiction",
      decisionA: id,
      decisionB: NEWCOMER_ID,
      variable,
      valueA: existingCanonical,
      valueB: canonical,
      via: antonym.antonym ? "antonym-pair" : "different-value",
      explanation: antonym.antonym
        ? `A new ${variable} decision of "${canonical}" contradicts ${id} ("${existingCanonical}"): ${antonym.why}`
        : `A new ${variable} decision of "${canonical}" contradicts ${id}, which is live and IN with "${existingCanonical}".`,
      why: null,
    });
  }

  return hits;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeHits(hits: readonly StructuralHit[]): string {
  if (hits.length === 0)
    return "no structural contradictions — no two live decisions answer the same question differently";
  const antonyms = hits.filter((hit) => hit.via === "antonym-pair").length;
  return [
    `${hits.length} structural contradiction${hits.length === 1 ? "" : "s"}`,
    antonyms > 0 ? `${antonyms} from the antonym table` : "none from the antonym table",
    `${hits.length - antonyms} from same-variable-different-value`,
    "detected with no model, no network and no threshold",
  ].join(" · ");
}

/**
 * What this gate CANNOT see, stated plainly.
 *
 * Shown in the health panel because a detector whose blind spots are invisible is a
 * detector that will be over-trusted. Gate (a) only fires when both decisions
 * resolved to the same ontology variable — so a contradiction between a DATABASE
 * decision and an ARCHITECTURE decision that implies it is gate (b)'s problem, and
 * until Phase 3 exists it is nobody's problem.
 */
export function describeBlindSpots(): string {
  return [
    "Requires both decisions to resolve to the SAME ontology variable.",
    "Cannot see a contradiction implied across variables (a DATABASE choice that rules out an ARCHITECTURE choice).",
    "Cannot see two decisions that are compatible in words and incompatible in effect.",
    "Those are gate (b), which needs Phase 3's retrieval stack.",
  ].join(" ");
}
