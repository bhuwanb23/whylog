/**
 * The local engine's alternative vocabulary ΓÇö 1.5.
 *
 * Phase 1 ┬╖ sub-phase 1.5
 *
 * `extraction/alternatives.ts` owns the pipeline-side recovery. This module owns the
 * one piece that is recognition rather than mechanics: WHICH NOUNS COUNT AS
 * ALTERNATIVES. It exists because ARGUS measured 15.4% precision on this component,
 * and the cheapest available precision gain is refusing to treat an unknown noun as
 * a rejected technology.
 */

import type { DecisionVariable } from "@/types/domain";
import { canonicalValueOf, foldKey } from "@/ontology/canonicalize";
import { NONE_VALUES } from "@/ontology/data/aliases";
import { isTechShaped, knownValuesIn, variablesFor } from "./value-phrase";

export interface AlternativeValue {
  readonly surface: string;
  readonly canonical: string;
  readonly variable: DecisionVariable;
  /** `known` values are safe to pre-empt on. `shaped` ones are stored only. */
  readonly strength: "known" | "shaped";
}

/**
 * Values in a window that could be a rejected alternative.
 *
 * Two sources, in order of trust: the ontology's known values, then
 * technology-shaped tokens (kebab-case, dotted, CamelCase) that the ontology does
 * not know. A bare noun is never returned ΓÇö "the database" is not an alternative,
 * it is the topic.
 *
 * @param variable the decision's own variable, used as a hint and as the fallback
 *                 for shaped tokens the ontology cannot place.
 */
export function alternativeValues(
  text: string,
  start: number,
  end: number,
  variable: DecisionVariable,
): readonly AlternativeValue[] {
  const out: AlternativeValue[] = [];
  const seen = new Set<string>();

  for (const candidate of knownValuesIn(text, start, end)) {
    const key = candidate.canonical;
    if (seen.has(key) || isNoneValue(candidate.surface)) continue;
    seen.add(key);
    out.push({
      surface: candidate.surface,
      canonical: key,
      variable: candidate.variable ?? variable,
      strength: "known",
    });
  }

  const window = text.slice(Math.max(0, start), Math.min(text.length, end));
  for (const token of shapedTokens(window)) {
    const key = foldKey(token);
    if (seen.has(key) || isNoneValue(token)) continue;
    seen.add(key);

    const guess = variablesFor(token);
    const resolved = guess[0] ?? variable;
    out.push({
      surface: token,
      canonical: resolved === "OTHER" ? key : canonicalValueOf(resolved, token),
      variable: resolved,
      strength: "shaped",
    });
  }

  return out;
}

/**
 * Is this a non-choice?
 *
 * "none", "nothing", "no auth" are DECISIONS, not alternatives, and treating them as
 * rejected options produces a nonsense pre-emption ΓÇö "you rejected nothing" ΓÇö which
 * is the kind of wrong that makes a user stop reading the warnings.
 */
export function isNoneValue(value: string): boolean {
  return NONE_VALUES.has(value.trim().toLowerCase());
}

const SHAPED = /[A-Za-z][A-Za-z0-9]*(?:[.\-+_/][A-Za-z0-9]+)+|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

function shapedTokens(window: string): readonly string[] {
  const out: string[] = [];
  for (const match of window.matchAll(SHAPED)) {
    const token = match[0];
    if (token.length < 3 || token.length > 40) continue;
    if (!isTechShaped(token)) continue;
    out.push(token);
  }
  return out;
}

/**
 * Which of these is worth PRE-EMPTING on.
 *
 * Only ontology-known values. A shaped token the ontology does not recognise might
 * be a variable name, a filename, or a typo, and warning the user "you rejected
 * `handleClick`" is exactly the false pre-emption that gets the feature switched
 * off.
 */
export function preemptionEligible(values: readonly AlternativeValue[]): readonly AlternativeValue[] {
  return values.filter((value) => value.strength === "known");
}

export function describeValues(values: readonly AlternativeValue[]): string {
  if (values.length === 0) return "no alternative values recognised";
  const known = values.filter((v) => v.strength === "known").length;
  return `${values.length} candidate${values.length === 1 ? "" : "s"}, ${known} known to the ontology and therefore eligible to pre-empt on`;
}
