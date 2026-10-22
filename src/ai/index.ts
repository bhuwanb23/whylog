/**
 * The AI seam: one interface, two implementations, selected at runtime, badged in
 * the UI, never mixed silently.
 *
 * Import `getEngine` from here. Everything else in this directory is either an
 * implementation or a type.
 */

export {
  getEngine,
  getLocalEngine,
  activeEngineId,
  activeCapabilities,
  can,
  invalidateEngine,
  type ActiveEngine,
} from "./engine";
export {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  EMBEDDING_MODELS,
  LOCAL_DIMENSIONS,
  PROVIDERS,
  engineIdOf,
  embeddingEngineIdOf,
  forgetKey,
  hasKey,
  isLlmUsable,
  readConfig,
  redacted,
  resolveEngine,
  writeConfig,
  type EngineConfig,
  type ProviderId,
} from "./config";
export {
  createEngine,
  listEngines,
  nullEngine,
  registerEngine,
  unregisterEngine,
  clearRegistry,
  type EngineChoice,
  type EngineFactory,
  type EngineOptions,
} from "./registry";

/* The LLM path. Imported for its registration side effect by `main.tsx`; these
 * exports are for Settings, which needs to say which provider a saved key belongs
 * to, and for Phase 7, which measures the two engines against each other. */
export { createLlmEngine, providerWithKey, SYSTEM_PROMPT, type LlmEngineOptions } from "./llm";
export {
  chat,
  extractJson,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
} from "./providers/openai-compatible";
export {
  LOCAL_CAPABILITIES,
  NULL_CAPABILITIES,
  llmCapabilities,
  type AlternativeCandidate,
  type CompositionFact,
  type CompositionKind,
  type CompositionRequest,
  type CompositionResult,
  type DecisionCandidate,
  type DecisionSnapshot,
  type DiscardedCandidate,
  type EmbeddingResult,
  type EngineCapabilities,
  type EpisodeSpan,
  type ExtractionRequest,
  type ExtractionResult,
  type GuardSynthesisRequest,
  type GuardSynthesisResult,
  type PremiseCandidate,
  type PremiseSnapshot,
  type RerankRequest,
  type RerankResult,
  type WhyLogEngine,
} from "./types";
export {
  EngineError,
  describeError,
  fromResponse,
  isEngineError,
  retryPolicy,
  type EngineErrorCode,
} from "./errors";
