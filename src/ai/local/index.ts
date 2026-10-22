/**
 * The local engine — the DEFAULT, not the fallback.
 *
 * Phase 0 · sub-phase 0.9 (seam + registration); completed in Phase 1
 * Plan: plan/OVERVIEW.md §8 · plan/phase-1-extraction-pipeline.md
 *
 * ---------------------------------------------------------------------------
 * WHAT "DEFAULT" COMMITS US TO
 *
 * Every capability the product claims has a local implementation, even a weaker
 * one. Keyless mode is therefore a product, not a demo: it extracts, it embeds, it
 * classifies structurally, it composes from templates, and it synthesises guards
 * from templates. The two things it genuinely cannot do are declared honestly in
 * `capabilities()` — cross-encoder RERANKING, which needs a model, and LLM-written
 * guard rationales.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM IS THE PROPERTY THAT MAKES IT TESTABLE
 *
 * Same input, same output, every time, on every machine. No sampling, no
 * temperature, no network. That is why Phase 7 can report exact numbers for the
 * local path and only distributions for the LLM path, and why a fixture's expected
 * output stays valid across runs.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COMPLETE AND WHAT IS NOT
 *
 *   embed      COMPLETE since Phase 0 — the 0.8 deliverable, and the index is real
 *   extract    COMPLETE since Phase 1 — cue-driven, episode-based, keyless. This is
 *              the walking skeleton: a messy transcript becomes reviewed,
 *              structured, persisted decisions WITH PREMISES.
 *   compose    template implementation, replaced in Phase 3
 *   classify   thin delegate to the §3.6 rule engine (retrieval/contradiction.ts);
 *              gate (a)'s verdict passes through unchanged
 *   synthesizeGuards  empty, with an `unverifiableReason`. Phase 4.
 *
 * An unimplemented stage returns an empty result stamped with this engine rather
 * than throwing. Empty is the honest answer, and it lets the app boot, render and
 * be clicked through with no key.
 * ---------------------------------------------------------------------------
 */

import { normaliseTranscript } from "@/extraction/normalizer";
import { segmentEpisodes } from "@/extraction/segmentation";
import type { EngineId } from "@/types/common";
import type { ClassificationResult } from "@/types/retrieval";
import { LOCAL_DIMENSIONS } from "../config";
import { EngineError, unsupportedError } from "../errors";
import { registerEngine } from "../registry";
import type {
  CompositionRequest,
  CompositionResult,
  EmbeddingResult,
  EngineCapabilities,
  ExtractionResult,
  GuardSynthesisRequest,
  GuardSynthesisResult,
  RerankRequest,
  RerankResult,
  WhyLogEngine,
} from "../types";
import { LOCAL_CAPABILITIES } from "../types";
import { localClassify } from "./classify";
import { templateCompose } from "./compose";
import {
  LOCAL_EMBEDDING_MODEL,
  LOCAL_ENGINE_ID,
  embedBatch,
  dimensions as embeddingDimensions,
} from "./embed";
import { extractLocal } from "./extract";

const ENGINE: EngineId = { kind: "local", model: "cue-extractor-v1" };

export function localEngineId(): EngineId {
  return ENGINE;
}

export function createLocalEngine(): WhyLogEngine {
  const id = ENGINE;

  return {
    id: () => id,
    dimensions: LOCAL_DIMENSIONS,

    capabilities: (): EngineCapabilities => ({
      ...LOCAL_CAPABILITIES,
      // `extraction: true` and `voting: false` are both load-bearing. Extraction
      // is real, so the Import control must be live. Voting is NOT, because the
      // local engine is deterministic: three runs would return three identical
      // results, so the toggle is hidden rather than offered and ignored.
      notes: LOCAL_CAPABILITIES.notes,
    }),

    /* ---------------- embedding: COMPLETE ---------------- */

    embed: async (texts, signal): Promise<EmbeddingResult> => {
      const started = performanceSafeNow();
      if (signal?.aborted) throw new EngineError("cancelled", "Cancelled.", { engine: id.model });

      const vectors = embedBatch(texts, {
        dimensions: embeddingDimensions(),
        namespace: "decision",
      });

      return {
        vectors,
        dimensions: embeddingDimensions(),
        // Stamped with the EMBEDDING model, not the extractor model: the index is
        // tagged by whatever produced the vectors, and mixing those two ids would
        // make the staleness check compare the wrong things.
        engine: LOCAL_ENGINE_ID,
        durationMs: performanceSafeNow() - started,
      };
    },

    /* ---------------- extraction: COMPLETE ---------------- */

    /**
     * normalise → segment → recognise → score → stamp.
     *
     * Snippet spans come from the offset map BY CONSTRUCTION, so the local path
     * cannot produce a paraphrased citation. `snippet-validation.ts` still checks
     * it, because a check that only applies to one engine is a check the next
     * engine will skip.
     */
    extract: async (request): Promise<ExtractionResult> => {
      const _started = performanceSafeNow();
      if (request.signal?.aborted) {
        throw new EngineError("cancelled", "Cancelled.", { engine: id.model });
      }

      const normalized = normaliseTranscript(request.text, {
        transcriptId: request.transcriptId,
        ...(request.occurredAt === undefined ? {} : { occurredAt: request.occurredAt }),
      });

      const { episodes } = segmentEpisodes(normalized);
      const extraction = extractLocal(request, { normalized, episodes, engine: id });

      if (request.signal?.aborted) {
        throw new EngineError("cancelled", "Cancelled after extraction.", { engine: id.model });
      }

      return extraction.result;
    },

    /* ---------------- classification: Phase 2 ---------------- */

    /**
     * Gate (b) on the local path: four NLI-style rules, no model.
     *
     * Implemented in `./classify` so the rules can be listed and audited independently
     * of the engine that hosts them — `describeLocalRules()` is the classifier's whole
     * behaviour in text, which is the strongest possible answer to "what is this
     * actually deciding?".
     *
     * Gate (a)'s verdict is returned unchanged when it exists: inventing a second
     * opinion on top of an antonym-table lookup would be strictly worse than the lookup.
     */
    classify: async (request): Promise<ClassificationResult> => localClassify(request, id),

    /* ---------------- reranking: NOT SUPPORTED ---------------- */

    rerank: async (_request: RerankRequest): Promise<RerankResult> => {
      // Declared false in capabilities(), so the UI never offers it. Throwing is
      // the backstop for a caller that ignored the flag — and it must throw rather
      // than return the input order, because a "reranker" that does nothing is
      // indistinguishable from one that is broken.
      throw unsupportedError("reranking", id.model);
    },

    /* ---------------- composition: Phase 3 ---------------- */

    compose: async (request: CompositionRequest): Promise<CompositionResult> => {
      const started = performanceSafeNow();

      /* Template composition is a real implementation, not a stub — it is what the
       * keyless path ships. The fuller Phase 3 templates live in ./compose.ts and emit
       * every sentence with its decision id inline, which is what lets
       * retrieval/answer.ts attribute claims to citations by the same rule it applies to
       * an LLM's prose. */
      const composed = templateCompose(request);
      const cited = request.material.map((fact) => fact.decisionId);

      return {
        text: composed.text,
        citedDecisionIds: cited,
        ...(composed.disclosure === undefined ? {} : { disclosure: composed.disclosure }),
        engine: id,
        durationMs: performanceSafeNow() - started,
      };
    },

    /* ---------------- guard synthesis: Phase 4 ---------------- */

    synthesizeGuards: async (request: GuardSynthesisRequest): Promise<GuardSynthesisResult> => {
      // Phase 4 fills this from src/guards/templates. The honest Phase 0 answer is
      // "no guard, and here is why", which marks the decision `unverifiable`
      // rather than silently skipping it.
      return {
        guards: [],
        unverifiableReason: `The local engine has no guard template for ${request.variable} in this build.`,
        engine: id,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

function performanceSafeNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Register on import. `local` is always available and never requires a key, so
 *  there is no configuration in which the app has no engine. */
registerEngine({
  id: "local",
  label: `Local (${LOCAL_EMBEDDING_MODEL})`,
  factory: () => createLocalEngine(),
  requiresKey: false,
  available: true,
});

export { LOCAL_EMBEDDING_MODEL };

/**
 * The local classifier's four rules, as text.
 *
 * Re-exported so the health panel (Phase 6.9) can show what gate (b) actually decides on
 * the keyless path. A rule-based classifier whose rules cannot be listed is not auditable,
 * and "the local engine has no model here, it applies these four rules and defaults to
 * neutral" is the sentence that answers "is this an LLM wrapper?" for gate (b) specifically.
 */
export { describeLocalRules, LOCAL_CONFIDENCE_CAP } from "./classify";
export { NEGATION_CUES } from "./negation";
