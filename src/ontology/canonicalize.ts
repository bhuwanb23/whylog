/**
 * Alias folding and value normalisation.
 *
 * Phase 0 · sub-phase 0.7
 * Plan: plan/phase-0-foundation.md §0.7
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS SITS IN THE PIPELINE
 *
 * Canonicalisation runs BEFORE identity resolution, not inside it. The ladder's
 * rung 2 compares canonical values and rung 3 asks whether a surface form is a
 * known alias of an existing canonical value; both are meaningless if the values
 * arriving still say "pg" in one place and "PostgreSQL" in another.
 *
 * It also runs before the antonym lookup, which is what lets gate (a) fire on
 * ("pg", "sqlite") without the model ever seeing it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * CANONICALISATION NEVER LOSES INFORMATION. The original surface form is kept on
 * the node's provenance and in the snippet; only the indexed value is folded. A
 * user searching for "pg" still finds the decision, because the sparse index
 * keeps the original tokens as well as the canonical one.
 * ---------------------------------------------------------------------------
 */

import { normalise } from "@/lib/text";
import type { DecisionVariable, PremiseType } from "@/types/domain";
import type { Canonicalizer } from "@/substrate/identity";
import { ALIASES, GLOBAL_ALIASES, NONE_VALUES, canonicalToVariables } from "./data/aliases";
import { VARIABLE_META, variableKeywords } from "./data/variables";
import { PREMISE_TYPE_META, lookupPredicate, splitPredicate } from "./data/premise-types";

/* -------------------------------------------------------------------------- */
/* Surface-form cleanup                                                       */
/* -------------------------------------------------------------------------- */

/** Strip the decoration people put around a technology name in prose.
 *  "`postgres`", "Postgres.", "(postgres)", "the Postgres database". */
export function cleanSurface(input: string): string {
  let value = input.trim();

  // Trailing punctuation and quote marks.
  value = value.replace(/^[`'""(\[]+/, "").replace(/[`'"".,;:!?)\]]+$/, "");

  // A leading article.
  value = value.replace(/^(the|a|an)\s+/i, "");

  // "the X database" / "the X framework" — keep X.
  value = value.replace(/\s+(database|db|framework|library|package|provider|service|platform|tool)$/i, "");

  return value.trim();
}

/** Lowercase, collapse whitespace, strip decoration. The form every table key
 *  is stored in. */
export function foldKey(input: string): string {
  return normalise(cleanSurface(input));
}

/* -------------------------------------------------------------------------- */
/* Value canonicalisation                                                     */
/* -------------------------------------------------------------------------- */

export interface CanonicalValueResult {
  readonly canonical: string;
  /** The surface form as supplied, cleaned but not folded. Kept for display. */
  readonly surface: string;
  /** True when the alias table did the work rather than mere normalisation. */
  readonly folded: boolean;
  /** True when the value means "deliberately absent". */
  readonly isNone: boolean;
  /** Which variable the value was folded under. */
  readonly variable: DecisionVariable;
}

/**
 * Fold a value to its canonical form for a variable.
 *
 * Two-stage: variable-scoped table first, then the global table. Scoping wins
 * because "none" under AUTH and "none" under DATABASE are both legitimate but
 * mean different things, and "local" is a hosting target and a storage location.
 */
export function canonicalValue(variable: DecisionVariable, value: string): CanonicalValueResult {
  const surface = cleanSurface(value);
  const key = foldKey(surface);

  const scoped = ALIASES[variable][key];
  if (scoped !== undefined) {
    return {
      canonical: scoped,
      surface,
      folded: scoped !== key,
      isNone: NONE_VALUES.has(scoped),
      variable,
    };
  }

  // The value may already BE canonical — the tables map alias -> canonical and
  // do not list canonical -> canonical, so a miss is not a failure.
  const known = new Set<string>(Object.values(ALIASES[variable]));
  if (known.has(key)) {
    return { canonical: key, surface, folded: false, isNone: NONE_VALUES.has(key), variable };
  }

  const global = GLOBAL_ALIASES[key];
  if (global !== undefined) {
    return {
      canonical: global,
      surface,
      folded: global !== key,
      isNone: NONE_VALUES.has(global),
      variable,
    };
  }

  return { canonical: key, surface, folded: false, isNone: NONE_VALUES.has(key), variable };
}

/** Canonical string only, for callers that do not need the provenance. */
export function canonicalValueOf(variable: DecisionVariable, value: string): string {
  return canonicalValue(variable, value).canonical;
}

/** Fold without a variable — used while the slot is still unknown. Less
 *  accurate, and the result should be re-folded once a variable is chosen. */
export function canonicalValueUnscoped(value: string): string {
  const key = foldKey(value);
  return GLOBAL_ALIASES[key] ?? key;
}

/* -------------------------------------------------------------------------- */
/* Variable resolution                                                        */
/* -------------------------------------------------------------------------- */

const CANONICAL_TO_VARIABLES: ReadonlyMap<string, readonly DecisionVariable[]> =
  canonicalToVariables();
const KEYWORD_TABLE: ReadonlyMap<string, readonly DecisionVariable[]> = variableKeywords();

export interface VariableGuess {
  readonly variable: DecisionVariable;
  readonly score: number;
  readonly via: "value" | "keyword" | "context" | "fallback";
}

/**
 * Guess the slot from a value.
 *
 * "sqlite" -> DATABASE with high confidence, because the alias table claims it.
 * This is what lets the local extractor recover a decision from a bare noun
 * phrase, and it is why extending `commonValues` in variables.ts improves the
 * classifier with no second edit.
 */
export function variableFromValue(value: string): VariableGuess | null {
  const key = foldKey(value);
  const direct = CANONICAL_TO_VARIABLES.get(key);
  if (direct && direct.length > 0) {
    // Unambiguous when exactly one slot claims the value. When several do
    // ("local" under HOSTING and STORAGE), the score drops and the review queue
    // gets to decide.
    return {
      variable: direct[0] as DecisionVariable,
      score: direct.length === 1 ? 0.9 : 0.55,
      via: "value",
    };
  }

  // Also try the raw surface, since canonical values are keys of the reverse map
  // and common values are not always aliases of themselves.
  for (const variable of Object.keys(VARIABLE_META) as DecisionVariable[]) {
    if (VARIABLE_META[variable].commonValues.includes(key)) {
      return { variable, score: 0.9, via: "value" };
    }
  }

  return null;
}

/**
 * Guess the slot from surrounding words.
 *
 * Scores accumulate over tokens, so a sentence mentioning "database" and
 * "sqlite" agrees with itself and scores higher than one mentioning either
 * alone. Agreement between two independent signals is the cheapest confidence
 * boost available.
 */
export function variableFromContext(tokens: readonly string[]): VariableGuess | null {
  const tally = new Map<DecisionVariable, number>();

  for (const token of tokens) {
    const hits = KEYWORD_TABLE.get(token);
    if (!hits) continue;
    for (const variable of hits) {
      tally.set(variable, (tally.get(variable) ?? 0) + (hits.length === 1 ? 1 : 0.4));
    }
  }

  if (tally.size === 0) return null;

  const ranked = [...tally.entries()].sort((a, b) =>
    b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1],
  );
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;

  const [variable, score] = best;
  // A token that hints at several slots ("storage") is worth less than one that
  // hints at exactly one ("pgvector"), so the tally is already discounted.
  const margin = second ? score - second[1] : score;

  return {
    variable,
    score: Math.min(0.9, 0.3 + margin * 0.18),
    via: "keyword",
  };
}

/**
 * Resolve a slot, preferring the value signal and falling back to context.
 *
 * Returns OTHER only when both fail. OTHER is tracked, not hidden: if it exceeds
 * ~15% of the corpus the ontology needs extending before Phase 1's numbers can
 * be trusted, and that check lives in the health panel for exactly this reason.
 */
export function resolveVariable(
  value: string,
  contextTokens: readonly string[],
): VariableGuess {
  const fromValue = variableFromValue(value);
  const fromContext = variableFromContext(contextTokens);

  if (fromValue && fromContext && fromValue.variable === fromContext.variable) {
    // Two independent signals agree. This is the case that can skip review.
    return {
      variable: fromValue.variable,
      score: Math.min(0.97, fromValue.score + fromContext.score * 0.5),
      via: "value",
    };
  }

  if (fromValue) {
    return fromValue.score >= (fromContext?.score ?? 0)
      ? fromValue
      : { ...fromValue, score: fromValue.score * 0.8 };
  }

  if (fromContext) return fromContext;

  return { variable: "OTHER", score: 0.2, via: "fallback" };
}

/* -------------------------------------------------------------------------- */
/* Predicate canonicalisation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fold a premise predicate to `type.name`.
 *
 * Accepts "single user", "single-user", "scale.single_user", "singleUser" and
 * returns "scale.single_user" whenever the table knows it. An unrecognised
 * predicate is snake_cased and namespaced under the declared type, so it is still
 * stable across imports — rung 1 of the ladder matches on exact canonical
 * predicates, and an unstable predicate means a duplicate node every time.
 */
export function canonicalPredicate(type: PremiseType, predicate: string): string {
  const raw = predicate.trim();

  // Already namespaced and known?
  const known = lookupPredicate(raw);
  if (known) return `${known.type}.${known.predicate.name}`;

  // Known name under this type?
  const { type: declaredType, name } = splitPredicate(raw);
  const candidateType = (declaredType ?? type) as PremiseType;
  const snake = snakeCase(name);

  const meta = PREMISE_TYPE_META[candidateType];
  if (meta) {
    const match = meta.predicates.find((p) => p.name === snake);
    if (match) return `${candidateType}.${match.name}`;

    // Label match — "single user" is the LABEL of `scale.single_user`.
    const byLabel = meta.predicates.find(
      (p) => normalise(p.label) === normalise(name),
    );
    if (byLabel) return `${candidateType}.${byLabel.name}`;
  }

  // Unknown predicate: still namespace and snake_case it, so the same surface
  // form always produces the same key.
  return `${type}.${snake}`;
}

/** "single user" -> "single_user"; "maxUsers" -> "max_users". */
export function snakeCase(input: string): string {
  return normalise(input)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* -------------------------------------------------------------------------- */
/* The Canonicalizer implementation                                           */
/* -------------------------------------------------------------------------- */

/**
 * The real canonicalizer, injected into src/substrate/identity.ts.
 *
 * `isAliasOf` answers "is `value` a known surface form of `canonical` under this
 * variable?" — rung 3 of the ladder. It checks both the scoped and the global
 * table, because a value can be canonical under one slot and an alias under
 * another.
 */
export const ONTOLOGY_CANONICALIZER: Canonicalizer = {
  canonicalValue: (variable, value) => canonicalValueOf(variable, value),
  canonicalPredicate: (type, predicate) => canonicalPredicate(type, predicate),
  isAliasOf: (variable, value, canonical) => {
    const key = foldKey(value);
    if (key === canonical) return false; // identical, not an alias
    const scoped = ALIASES[variable][key];
    if (scoped === canonical) return true;
    return GLOBAL_ALIASES[key] === canonical;
  },
};

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/** How much of the alias table is actually being used. A table nobody exercises
 *  is a table nobody maintains. */
export interface CanonicalizationStats {
  readonly total: number;
  readonly folded: number;
  readonly alreadyCanonical: number;
  readonly noneValues: number;
  readonly otherVariables: number;
}

export function emptyCanonicalizationStats(): CanonicalizationStats {
  return { total: 0, folded: 0, alreadyCanonical: 0, noneValues: 0, otherVariables: 0 };
}

export function recordCanonicalization(
  stats: CanonicalizationStats,
  result: CanonicalValueResult,
): CanonicalizationStats {
  return {
    total: stats.total + 1,
    folded: stats.folded + (result.folded ? 1 : 0),
    alreadyCanonical: stats.alreadyCanonical + (result.folded ? 0 : 1),
    noneValues: stats.noneValues + (result.isNone ? 1 : 0),
    otherVariables: stats.otherVariables + (result.variable === "OTHER" ? 1 : 0),
  };
}

/** Total alias-table size. The antonym and cue counts live in
 *  `ontologySize()` in src/ontology/ontology.ts, which imports all three tables;
 *  counting them here would create a cycle between canonicalize and the data. */
export function aliasTableSize(): number {
  let aliases = Object.keys(GLOBAL_ALIASES).length;
  for (const variable of Object.keys(ALIASES) as DecisionVariable[]) {
    aliases += Object.keys(ALIASES[variable]).length;
  }
  return aliases;
}
