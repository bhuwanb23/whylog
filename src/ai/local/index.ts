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
 * PHASE 0 STATE
 *
 * The embedding path below is COMPLETE — it is the 0.8 deliverable and the index
 * is real. `extract`, `classify`, `compose` and `synthesizeGuards` are wired to
 * their Phase 1/2/4/5 modules, which do not exist yet; until they do, they return
 * an empty result stamped with this engine rather than throwing. An empty result is
 * the honest answer for an unimplemented stage, and it lets the app boot, render
 * and be clicked through with no key — the 0.9 and 0.10 acceptance criteria.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
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
import {
  LOCAL_EMBEDDING_MODEL,
  LOCAL_ENGINE_ID,
  embedBatch,
  dimensions as embeddingDimensions,
} from "./embed";

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
      // Honest about the Phase 0 state: the seam exists and the embedding path is
      // complete, the rest arrives in Phase 1. Reporting `extraction: true`
      // before the cue extractor exists would light up a button that returns
      // nothing, which is worse than a disabled one.
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

    /* ---------------- extraction: Phase 1 ---------------- */

    extract: async (request): Promise<ExtractionResult> => {
      const started = performanceSafeNow();
      if (request.signal?.aborted) {
        throw new EngineError("cancelled", "Cancelled.", { engine: id.model });
      }

      // Phase 1 replaces this body with: normalise -> segment -> cue match ->
      // ontology resolve -> confidence score. The shape of the return value does
      // not change, which is the point of fixing the seam first.
      return {
        decisions: [],
        premises: [],
        alternatives: [],
        episodes: [],
        discarded: [],
        engine: id,
        durationMs: performanceSafeNow() - started,
      };
    },

    /* ---------------- classification: Phase 2 ---------------- */

    classify: async (request): Promise<ClassificationResult> => {
      // The structural verdict, when the table produced one, IS the local
      // classifier's answer: gate (a) needs no model, and inventing a second
      // opinion on top of a table lookup would be strictly worse.
      if (request.structuralVerdict !== undefined) return request.structuralVerdict;

      // Phase 2 adds the antonym + negation + modality classifier here.
      return {
        verdict: "neutral",
        gate: "semantic",
        explanation:
          "The local classifier found no structural contradiction between these two decisions. A semantic judgement needs the LLM path.",
        confidence: asConfidence(0.2),
        engine: id,
      };
    },

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

      // Template composition is a real implementation, not a stub: it is what the
      // keyless path ships. Phase 3 replaces the templates with the fuller ones in
      // src/ai/local/compose.ts.
      const text = templateCompose(request);
      const cited = request.material.map((fact) => fact.decisionId);

      return {
        text,
        citedDecisionIds: cited,
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
/* Template composition                                                       */
/* -------------------------------------------------------------------------- */

function templateCompose(request: CompositionRequest): string {
  const facts = request.material;
  if (facts.length === 0) {
    return "Nothing in the log answers that yet. Import a transcript or record the decision and ask again.";
  }

  switch (request.kind) {
    case "answer": {
      const question = request.question ?? "your question";
      const lines = facts.map(
        (fact) =>
          `- ${fact.statement} (${fact.decisionId}, ${fact.label}, valid from ${fact.validFrom.slice(0, 10)})`,
      );
      const premises = [...new Set(facts.flatMap((f) => f.premises))];
      const premiseLine = premises.length > 0 ? `\nThese rest on: ${premises.join("; ")}.` : "";
      return `On ${question}, the log records ${facts.length} decision${facts.length === 1 ? "" : "s"}:\n${lines.join("\n")}${premiseLine}`;
    }

    case "export-narrative":
      return facts
        .map((fact) => {
          const why = fact.rationale === undefined ? "" : ` — ${fact.rationale}`;
          return `${fact.statement}${why}`;
        })
        .join("\n");

    case "guard-rationale":
      return facts.length > 0
        ? `Checks that "${facts[0]?.statement ?? ""}" still holds, because the log records it as a live decision.`
        : "";

    case "premise-summary":
      return facts
        .map(
          (fact) => `${fact.decisionId} assumes ${fact.premises.join(", ") || "nothing recorded"}`,
        )
        .join("; ");

    case "cascade-explanation":
      return facts
        .map((fact) => `${fact.decisionId} is affected because it rests on the same premise.`)
        .join(" ");

    default:
      return facts.map((f) => f.statement).join("\n");
  }
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
