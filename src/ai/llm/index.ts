/**
 * The LLM engine — 1.10, the second path.
 *
 * Phase 1 · sub-phase 1.10
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A FALLBACK
 *
 * The local engine is the default because it is keyless, deterministic and private.
 * This engine exists because it recovers premises the cue table cannot see: a model
 * can read "it's one person, one machine, one log" and return `scale.single_user`,
 * while a lexicon needs the phrase to contain a cue.
 *
 * What it costs: tokens, latency, non-reproducibility, and the transcript leaving
 * the browser. All four are shown in the mode badge and in Settings, because an
 * engine switch that is not visible is a privacy incident.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IT RETURNS IS TRUSTED
 *
 * Every snippet goes through `snippet-validation.ts` before it reaches the review,
 * every variable through `resolveVariable`, every premise type through the closed
 * set. A model that invents a variable produces an OTHER decision; a model that
 * paraphrases a quote produces an item with no span and a collapsed tier. The
 * pipeline downstream is identical to the local path, which is the point of the
 * seam: adding an engine must not add a code path.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
import { performanceSafeNow } from "@/lib/format";
import { EngineError, unsupportedError } from "../errors";
import {
  llmCapabilities,
  type ClassificationRequest,
  type CompositionRequest,
  type CompositionResult,
  type EmbeddingResult,
  type EngineCapabilities,
  type ExtractionRequest,
  type ExtractionResult,
  type GuardSynthesisRequest,
  type GuardSynthesisResult,
  type RerankRequest,
  type RerankResult,
  type WhyLogEngine,
} from "../types";
import type { ClassificationResult } from "@/types/retrieval";
import {
  DEFAULT_MODELS,
  LOCAL_DIMENSIONS,
  readConfig,
  type EngineConfig,
  type ProviderId,
} from "../config";
import { registerEngine } from "../registry";
import { embedBatch } from "../local/embed";
import { chat, extractJson, type ChatMessage } from "../providers/openai-compatible";
import {
  EMPTY_LLM_EXTRACTION,
  PROMPT_CHAR_BUDGET,
  SYSTEM_PROMPT,
  needsChunking,
  userPrompt,
  type LlmAlternative,
  type LlmDecision,
  type LlmDiscard,
  type LlmExtraction,
  type LlmPremise,
} from "../prompts/extraction";
import { readExtraction, splitForPrompt, toExtractionResult } from "./parse";
import { chunkTurns } from "@/extraction/chunking";
import { normaliseTranscript } from "@/extraction/normalizer";

export interface LlmEngineOptions {
  readonly config: EngineConfig;
  readonly id: EngineId;
}

export function createLlmEngine(options: LlmEngineOptions): WhyLogEngine {
  const { config, id } = options;
  const provider = config.provider as Exclude<ProviderId, "local">;

  const requireKey = (): string => {
    if (config.apiKey === null || config.apiKey.length === 0) {
      throw new EngineError("no-key", "No API key is saved. Add one in Settings, or switch to the local engine.", {
        engine: id.model,
      });
    }
    return config.apiKey;
  };

  return {
    id: (): EngineId => id,

    dimensions: LOCAL_DIMENSIONS,

    capabilities: (): EngineCapabilities => llmCapabilities(config.model),

    /* ---------------- extraction ---------------- */

    extract: async (request: ExtractionRequest): Promise<ExtractionResult> => {
      const started = performanceSafeNow();
      const apiKey = requireKey();

      if (request.signal?.aborted) {
        throw new EngineError("cancelled", "Cancelled.", { engine: id.model });
      }

      const raw = request.text;
      const pieces = needsChunking(raw) ? splitForPrompt(raw, request.transcriptId) : [raw];

      let promptTokens = 0;
      let completionTokens = 0;
      // Mutable while merging: a transcript is split into chunks and each
      // chunk's candidates are appended.
      const decisions: LlmDecision[] = [];
      const premises: LlmPremise[] = [];
      const alternatives: LlmAlternative[] = [];
      const discarded: LlmDiscard[] = [];

      for (const piece of pieces) {
        if (request.signal?.aborted) {
          throw new EngineError("cancelled", "Cancelled mid-extraction.", { engine: id.model });
        }

        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(piece) },
        ];

        const response = await chat(provider, apiKey, {
          model: config.model,
          messages,
          // Low but not zero: three-run voting needs the runs to disagree
          // somewhere, and at temperature 0 they would not.
          temperature: config.voting ? 0.2 : 0.1,
          json: true,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        promptTokens += response.promptTokens;
        completionTokens += response.completionTokens;

        const parsed = readExtraction(response.text, id.model);
        decisions.push(...parsed.decisions);
        premises.push(...parsed.premises);
        alternatives.push(...parsed.alternatives);
        discarded.push(...parsed.discarded);
      }

      const merged: LlmExtraction = { decisions, premises, alternatives, discarded };

      return toExtractionResult(merged, request, id, performanceSafeNow() - started, promptTokens, completionTokens);
    },

    /* ---------------- classification: Phase 2 ---------------- */

    classify: async (request: ClassificationRequest): Promise<ClassificationResult> => {
      // The structural gate's answer is returned unchanged: a table lookup that says
      // two IN-labelled values are antonyms is not something a model should be asked
      // to reconsider, and asking it invites a second opinion that contradicts the
      // first without evidence.
      if (request.structuralVerdict !== undefined) return request.structuralVerdict;

      // Phase 2 adds the semantic classifier here. `neutral` means "no opinion",
      // which the gate composes with the structural verdict rather than overriding.
      return {
        verdict: "neutral",
        gate: "semantic",
        explanation: "The semantic classifier arrives in Phase 2; no model opinion is offered yet.",
        confidence: asConfidence(0.2),
        engine: id,
      };
    },

    /* ---------------- embedding: always local ---------------- */

    /**
     * Embeddings are the LOCAL vectoriser even on the LLM path.
     *
     * Anthropic has no first-party embedding model, so a provider-dependent
     * embedding would make the index unreadable after an engine switch. Hashing
     * tokens into 512 dimensions is weaker than a trained embedder and it is stable,
     * reproducible and free — and `embeddingEngineIdOf` exists precisely so the
     * index can be tagged with what actually built it.
     */
    embed: async (texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult> => {
      const started = performanceSafeNow();
      if (signal?.aborted) throw new EngineError("cancelled", "Cancelled.", { engine: id.model });

      const vectors = embedBatch(texts);
      return {
        vectors,
        dimensions: LOCAL_DIMENSIONS,
        engine: id,
        durationMs: performanceSafeNow() - started,
      };
    },

    rerank: async (_request: RerankRequest): Promise<RerankResult> => {
      // A reranker is one of the two things a key actually buys, and it arrives in
      // Phase 3. Throwing is the backstop for a caller that ignored the capability
      // flag: a "reranker" that returns its input unchanged is indistinguishable
      // from one that is broken.
      throw unsupportedError("reranking", id.model);
    },

    /* ---------------- composition: Phase 3 ---------------- */

    compose: async (request: CompositionRequest): Promise<CompositionResult> => {
      const started = performanceSafeNow();
      const apiKey = requireKey();

      const response = await chat(provider, apiKey, {
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "You write a section of a decision record from supplied facts. Cite only the decision ids you were given. Do not add facts that are not in the material; if the material does not support the section, say so in one sentence.",
          },
          { role: "user", content: compositionPrompt(request) },
        ],
        temperature: 0.2,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });

      return {
        text: response.text.trim(),
        citedDecisionIds: request.material.map((fact) => fact.decisionId),
        engine: id,
        durationMs: performanceSafeNow() - started,
      };
    },

    /* ---------------- guards: Phase 4 ---------------- */

    synthesizeGuards: async (request: GuardSynthesisRequest): Promise<GuardSynthesisResult> => {
      void request;
      return {
        guards: [],
        // Stated rather than omitted: a decision with no synthesizable guard is
        // marked unverifiable and SHOWN, because a compliance score computed only
        // over the decisions that happened to be checkable flatters itself.
        unverifiableReason: "LLM guard synthesis arrives in Phase 4.",
        engine: id,
      };
    },
  };
}

function compositionPrompt(request: CompositionRequest): string {
  // Each fact carries its label and its premises, because a composition that
  // quotes a decision without the conditions it rests on is exactly the export an
  // agent will obey after those conditions stop holding.
  const material = request.material
    .map((fact) => {
      const premises = fact.premises.length > 0 ? ` [given: ${fact.premises.join("; ")}]` : "";
      const rationale = fact.rationale !== undefined && fact.rationale.length > 0 ? ` — because ${fact.rationale}` : "";
      return `- ${fact.decisionId} (${fact.label}): ${fact.statement}${premises}${rationale}`;
    })
    .join("\n");

  return [
    `Write the "${request.kind}" section.`,
    request.question !== undefined && request.question.length > 0 ? `Question: ${request.question}` : "",
    request.maxLengthChars !== undefined ? `At most ${request.maxLengthChars} characters.` : "",
    "",
    "MATERIAL:",
    material,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The three LLM providers, registered on import alongside `local`.
 *
 * `available: true` means the ENGINE EXISTS, not that it can be used: whether a key
 * is present changes per provider and per moment, and registration happens once at
 * import. Settings reads `providerWithKey()` for the live answer, so a greyed row
 * says "no key saved" rather than "not installed" — and `requiresKey: true` makes
 * `createEngine` throw `no-key` BEFORE the factory runs, which is what turns "asked
 * for an LLM with no key" into the visible fallback in `resolveEngine` rather than
 * a failed request.
 */
const LLM_PROVIDERS: readonly { id: Exclude<ProviderId, "local">; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
];

for (const entry of LLM_PROVIDERS) {
  registerEngine({
    id: entry.id,
    label: `${entry.label} — ${DEFAULT_MODELS[entry.id]}`,
    factory: (options) => {
      const id: EngineId = { kind: "llm", model: options.model };
      return createLlmEngine({
        id,
        config: {
          provider: entry.id,
          model: options.model,
          apiKey: options.apiKey,
          wantsLlmWithoutKey: options.apiKey === null,
          voting: options.voting,
          questionGeneration: options.questionGeneration,
          localDimensions: options.dimensions,
        },
      });
    },
    requiresKey: true,
    available: true,
  });
}

/**
 * The provider a saved key belongs to, or null.
 *
 * `src/ai/config.ts` stores ONE key, not one per provider, because the key is
 * whatever the user last saved and a second one would have to be a second secret to
 * keep out of the log, the store and every export. So at most one LLM row is
 * selectable at a time, and Settings says which.
 */
export function providerWithKey(): ProviderId | null {
  const config = readConfig();
  if (config.apiKey === null || config.apiKey.length === 0) return null;
  return config.provider === "local" ? null : config.provider;
}

export { SYSTEM_PROMPT };
