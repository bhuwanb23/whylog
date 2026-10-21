/**
 * Public API of the ontology layer.
 *
 * Import from "@/ontology" everywhere above this layer. Reaching into
 * "@/ontology/data/*" from an extractor is how a second copy of the vocabulary
 * appears, and a second copy is how the gates start disagreeing with the
 * extractor about what a value is.
 */

export * from "./ontology";
export * from "./canonicalize";

export type { AntonymPair } from "./data/antonyms";
export type { CueDirection, DecisionCue } from "./data/decision-cues";
export type { PremiseCue, PremiseCueKind } from "./data/premise-cues";
export type { PremisePredicate, PremiseTypeMeta } from "./data/premise-types";
export type { VariableMeta } from "./data/variables";
