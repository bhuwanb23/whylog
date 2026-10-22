/**
 * The ontology facade: one place to ask the vocabulary anything.
 *
 * Phase 0 · sub-phase 0.7
 * Plan: plan/phase-0-foundation.md §0.7
 *
 * Every extractor, gate, guard template and exporter reads through this module
 * rather than reaching into `data/`. That is what makes the vocabulary a single
 * artifact: change a table here and every layer above changes with it, with no
 * second copy to keep in sync.
 */

import type { DecisionVariable, PremiseType } from "@/types/domain";
import { DECISION_VARIABLES, PREMISE_TYPES } from "@/types/domain";
import { ALIASES, GLOBAL_ALIASES, NONE_VALUES } from "./data/aliases";
import { ANTONYMS, antonymPairCount, antonymsOf, areAntonyms } from "./data/antonyms";
import {
  DECISION_CUES,
  assertiveCues,
  pivotCues,
  rejectionCues,
  speculativeCues,
} from "./data/decision-cues";
import {
  PREMISE_CUES,
  cueCountByType,
  cuesFor,
  explicitCues,
  topicalCues,
} from "./data/premise-cues";
import {
  PREMISE_TYPE_META,
  PREMISE_TYPE_ORDER,
  allPredicates,
  isGuardable,
  isWorldObservable,
  lookupPredicate,
  premiseTypesForVariable,
} from "./data/premise-types";
import {
  TEMPLATE_VERIFIABLE_VARIABLES,
  TYPED_VARIABLES,
  VARIABLE_META,
  VARIABLE_ORDER,
} from "./data/variables";

/* -------------------------------------------------------------------------- */
/* Re-exports — the lookups named in STRUCTURE.md §4                          */
/* -------------------------------------------------------------------------- */

export {
  canonicalPredicate,
  canonicalValue,
  canonicalValueOf,
  canonicalValueUnscoped,
  cleanSurface,
  foldKey,
  resolveVariable,
  snakeCase,
  variableFromContext,
  variableFromValue,
  ONTOLOGY_CANONICALIZER,
} from "./canonicalize";

export { areAntonyms, antonymsOf, antonymPairCount };
export { isWorldObservable, isGuardable, lookupPredicate, allPredicates };

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The 14 typed slots plus OTHER. */
export const VARIABLES: readonly DecisionVariable[] = DECISION_VARIABLES;
export const TYPED_SLOTS: readonly DecisionVariable[] = TYPED_VARIABLES;
export const SLOT_ORDER: readonly DecisionVariable[] = VARIABLE_ORDER;
export const TEMPLATE_VERIFIABLE: readonly DecisionVariable[] = TEMPLATE_VERIFIABLE_VARIABLES;

/** The closed set of 8. */
export const PREMISE_TYPES_CLOSED: readonly PremiseType[] = PREMISE_TYPES;
export const PREMISE_ORDER: readonly PremiseType[] = PREMISE_TYPE_ORDER;

/** World-observable = falsifiable by a guard or repo scan. Intent-based = only a
 *  human can retract it. */
export const WORLD_OBSERVABLE_TYPES: readonly PremiseType[] =
  PREMISE_ORDER.filter(isWorldObservable);
export const INTENT_BASED_TYPES: readonly PremiseType[] = PREMISE_ORDER.filter(
  (t) => !isWorldObservable(t),
);

export function variableMetaOf(variable: DecisionVariable) {
  return VARIABLE_META[variable];
}

export function premiseMetaOf(type: PremiseType) {
  return PREMISE_TYPE_META[type];
}

/** Which premise types to try first for a slot. */
export function premiseTypesFor(variable: DecisionVariable): readonly PremiseType[] {
  return premiseTypesForVariable(VARIABLE_META[variable].typicalPremises);
}

/** The globs a slot usually governs — seeds `applies_to` in export and guard
 *  scoping in Phase 4. */
export function typicalGlobsFor(variable: DecisionVariable): readonly string[] {
  return VARIABLE_META[variable].typicalGlobs;
}

/* -------------------------------------------------------------------------- */
/* Cue access                                                                 */
/* -------------------------------------------------------------------------- */

export const DECISION_CUE_LIST = DECISION_CUES;
export const PREMISE_CUE_LIST = PREMISE_CUES;

export { assertiveCues, speculativeCues, rejectionCues, pivotCues };
export { cuesFor, explicitCues, topicalCues, cueCountByType };

/** Every cue phrase, sorted longest-first. Longest-first matters: "do not use"
 *  must match before "not", or the longer, more informative cue is never seen. */
export function allCuePhrases(): readonly string[] {
  const phrases = new Set<string>();
  for (const cue of DECISION_CUES) phrases.add(cue.phrase);
  for (const cue of PREMISE_CUES) phrases.add(cue.phrase);
  return [...phrases].sort((a, b) => b.length - a.length);
}

/* -------------------------------------------------------------------------- */
/* The structural contradiction check                                         */
/* -------------------------------------------------------------------------- */

export interface StructuralCheck {
  readonly contradicts: boolean;
  readonly why: string;
}

/**
 * Gate (a) in one call.
 *
 * Two decisions on the same variable whose CANONICAL values are a declared
 * antonym pair. No model, no embedding, no threshold — a table lookup. It fires
 * while the semantic gate is still uncertain, and it fires identically every
 * time, which is the property that makes it trustworthy enough to show a user
 * without a confidence bar.
 *
 * The caller must additionally check that both decisions are IN-labelled and
 * that their validity windows OVERLAP: two decisions on the same variable in
 * disjoint intervals are a refinement over time, not a contradiction, and
 * accusing the user of contradicting themselves every time they change their
 * mind sequentially is how a tool gets switched off.
 */
export function structuralContradiction(
  variable: DecisionVariable,
  valueA: string,
  valueB: string,
): StructuralCheck {
  const result = areAntonyms(variable, valueA, valueB);
  return result.antonym ? { contradicts: true, why: result.why } : { contradicts: false, why: "" };
}

/** Is this value a deliberate absence? "no auth at all" is a DECISION, not a
 *  missing field, and collapsing it into undefined would delete the most
 *  interesting kind of choice. */
export function isNoneValue(value: string): boolean {
  return NONE_VALUES.has(value.trim().toLowerCase());
}

/** All values that would contradict `value` under `variable`. Used to pre-empt a
 * decision while it is being authored rather than detecting it afterwards. */
export function contradictsValue(variable: DecisionVariable, value: string): readonly string[] {
  return antonymsOf(variable, value);
}

/* -------------------------------------------------------------------------- */
/* Self-description                                                           */
/* -------------------------------------------------------------------------- */

export interface OntologySize {
  readonly variables: number;
  readonly typedVariables: number;
  readonly premiseTypes: number;
  readonly predicates: number;
  readonly aliases: number;
  readonly antonymPairs: number;
  readonly decisionCues: number;
  readonly premiseCues: number;
  readonly worldObservableTypes: number;
}

/** Counts, for the health panel and for the pitch. Every number here is derived
 *  from the tables, so the panel cannot drift from the data. */
export function ontologySize(): OntologySize {
  let aliases = Object.keys(GLOBAL_ALIASES).length;
  for (const variable of Object.keys(ALIASES) as DecisionVariable[]) {
    aliases += Object.keys(ALIASES[variable]).length;
  }

  return {
    variables: DECISION_VARIABLES.length,
    typedVariables: TYPED_VARIABLES.length,
    premiseTypes: PREMISE_TYPES.length,
    predicates: allPredicates().length,
    aliases,
    antonymPairs: antonymPairCount(),
    decisionCues: DECISION_CUES.length,
    premiseCues: PREMISE_CUES.length,
    worldObservableTypes: WORLD_OBSERVABLE_TYPES.length,
  };
}

/** One paragraph describing the vocabulary, for the About panel and for the
 *  exported README. Written from the tables so it never goes stale. */
export function describeOntology(): string {
  const size = ontologySize();
  const observable = WORLD_OBSERVABLE_TYPES.join(", ");
  const intent = INTENT_BASED_TYPES.join(", ");
  return [
    `${size.typedVariables} typed decision slots (plus OTHER as a tracked escape hatch), `,
    `${size.premiseTypes} premise types with ${size.predicates} standard predicates, `,
    `${size.aliases} value aliases and ${size.antonymPairs} variable-scoped antonym pairs. `,
    `World-observable premise types — falsifiable by a guard: ${observable}. `,
    `Intent-based — retractable only by a human: ${intent}.`,
  ].join("");
}

/** Sanity check the tables against each other. Returns human-readable problems;
 *  an empty array means the ontology is internally consistent. Run at boot in
 *  development so a broken table is never shipped. */
export function validateOntology(): readonly string[] {
  const problems: string[] = [];

  for (const variable of DECISION_VARIABLES) {
    if (!VARIABLE_META[variable]) problems.push(`${variable}: no entry in VARIABLE_META`);
  }

  for (const type of PREMISE_TYPES) {
    const meta = PREMISE_TYPE_META[type];
    if (!meta) {
      problems.push(`${type}: no entry in PREMISE_TYPE_META`);
      continue;
    }
    if (meta.namespace !== type) {
      problems.push(`${type}: namespace "${meta.namespace}" does not match the type name`);
    }
    for (const predicate of meta.predicates) {
      if (lookupPredicate(`${type}.${predicate.name}`) === null) {
        problems.push(`${type}.${predicate.name}: not resolvable by lookupPredicate`);
      }
    }
  }

  // Antonyms must be over CANONICAL values: if a pair names a surface form, gate
  // (a) silently never fires for it.
  for (const variable of DECISION_VARIABLES) {
    for (const pair of ANTONYMS[variable]) {
      for (const value of [pair.a, pair.b]) {
        const isAlias = Object.keys(ALIASES[variable]).includes(value);
        if (isAlias) {
          problems.push(
            `${variable}: antonym pair uses the ALIAS "${value}", not its canonical form — gate (a) would never fire on it`,
          );
        }
      }
    }
  }

  for (const cue of PREMISE_CUES) {
    if (cue.predicate !== undefined && lookupPredicate(cue.predicate) === null) {
      problems.push(`premise cue "${cue.phrase}": predicate ${cue.predicate} is not in the table`);
    }
  }

  return problems;
}
