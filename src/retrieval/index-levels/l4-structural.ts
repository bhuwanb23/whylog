/**
 * L4 ΓÇö structural index. 3.3
 *
 * Phase 3 ┬╖ sub-phase 3.3
 * Plan: plan/phase-3-retrieval.md ┬º3.3
 *
 * ---------------------------------------------------------------------------
 * NOT FUSED INTO THE RANKING
 *
 * This is the property that makes the level worth having, and it is the one most easily
 * lost in implementation. L4 has no score, so it cannot enter RRF ΓÇö and it should not
 * want to. A structural hit is **promoted to the top of the candidate list regardless of
 * its statistical rank.**
 *
 * Exact evidence outranks statistical evidence. "You asked about the DATABASE variable and
 * these three decisions settle it" is not a guess with a confidence attached; it is a
 * lookup that either matched or did not. Blending it into a weighted score would let a
 * high BM25 rank on an unrelated decision outrank the exact answer, which is the failure
 * that makes a retrieval system feel approximate rather than intelligent.
 *
 * ---------------------------------------------------------------------------
 * TWO INDEXES, THREE CONSUMERS
 *
 *   variableIndex  variable ΓåÆ [decisionIds]          Phase 2 gate (a)
 *   valueIndex     variable:value ΓåÆ [decisionIds]    pre-emption of rejected alternatives
 *
 * Both are maintained by `projections/indexes.ts:buildStructuralIndex` and rebuilt from
 * the log on every fold, which is what ┬º3.3's acceptance criterion means by "stay
 * consistent through merge, supersede and retraction": they are not incrementally patched,
 * they are derived, so they cannot drift.
 *
 * The third index in ┬º3.3's table ΓÇö `premiseIndex` ΓÇö is L5, in its own file, because it
 * serves a different consumer (gate (c) and the cascade) and promotes differently.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { DecisionVariable } from "@/types/domain";
import type { IndexArtifacts } from "@/types/retrieval";
import { canonicalValueOf, foldKey } from "@/ontology/canonicalize";

/** An exact structural match. Carries WHY it matched, because the promotion has to be
 *  explainable: "promoted because it settles DATABASE" is a reason, "promoted" is not. */
export interface StructuralMatch {
  readonly decisionId: DecisionId;
  readonly via: "variable" | "value";
  readonly explanation: string;
}

/**
 * Exact structural hits for a query.
 *
 * @param variable resolved from the query by `resolveVariable` upstream. Absent means the
 *   query named no ontology slot, and this level returns nothing ΓÇö it does not guess.
 * @param value a candidate canonical value mentioned in the query.
 */
export function searchL4(
  artifacts: IndexArtifacts,
  variable: DecisionVariable | null,
  value: string | null,
): readonly StructuralMatch[] {
  const out: StructuralMatch[] = [];
  const seen = new Set<DecisionId>();

  /* Value first: it is the more specific match, and promotion order should reflect
   * specificity. A decision that settles DATABASE=sqlite outranks one that merely
   * concerns DATABASE. */
  if (variable !== null && value !== null && value.length > 0) {
    const canonical = canonicalValueOf(variable, value);
    for (const decisionId of artifacts.structural.valueIndex.get(valueKey(variable, canonical)) ?? []) {
      if (seen.has(decisionId)) continue;
      seen.add(decisionId);
      out.push({
        decisionId,
        via: "value",
        explanation: "settles " + variable + " = " + canonical + " ΓÇö an exact structural match, not a similarity",
      });
    }
  }

  if (variable !== null) {
    for (const decisionId of artifacts.structural.variableIndex.get(variable) ?? []) {
      if (seen.has(decisionId)) continue;
      seen.add(decisionId);
      out.push({
        decisionId,
        via: "variable",
        explanation: "concerns the " + variable + " slot, which the query named",
      });
    }
  }

  return out;
}

/** The `valueIndex` key format. Kept in one place because the builder and the reader
 *  must agree on it exactly, and a disagreement is an index that silently never hits. */
export function valueKey(variable: DecisionVariable, canonicalValue: string): string {
  return variable + ":" + foldKey(canonicalValue);
}

/** Every decision settling a variable, for the Ask view's "what did we decide about X?". */
export function decisionsForVariable(
  artifacts: IndexArtifacts,
  variable: DecisionVariable,
): readonly DecisionId[] {
  return artifacts.structural.variableIndex.get(variable) ?? [];
}

export function l4Count(artifacts: IndexArtifacts): number {
  let total = 0;
  for (const ids of artifacts.structural.variableIndex.values()) total += ids.length;
  return total;
}

export function describeL4(artifacts: IndexArtifacts): string {
  const variables = artifacts.structural.variableIndex.size;
  const values = artifacts.structural.valueIndex.size;
  return "L4 structural ΓÇö " + variables + " variable slot(s), " + values + " distinct value(s). Exact and O(1); NOT fused into the ranking. A structural hit is promoted to the top regardless of its statistical score, because exact evidence outranks statistical evidence.";
}
