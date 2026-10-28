/**
 * The corpus — 7.1. One import site.
 */

export { corpus, CORPUS_VERSION, CORPUS_ROOT, DEMO_FIXTURE_IDS } from "./data";
export { loadCorpus, findSpan, describeLoad, type LoadReport } from "./loader";
export {
  compositionOf,
  describeCorpus,
  type Corpus,
  type CorpusComposition,
  type CorpusTier,
  type LabelledAlternative,
  type LabelledDecision,
  type LabelledEpisode,
  type LabelledPremise,
  type LabelledQuestion,
  type LabelledTranscript,
  type Plant,
  type PlantKind,
  type PlantLevel,
  type ResolvedAlternative,
  type ResolvedCorpus,
  type ResolvedDecision,
  type ResolvedPremise,
  type ResolvedTranscript,
} from "./labels";
