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

import { validate } from "@/guards/synth/llm";
/* `performanceSafeNow` was called in six places in this file but declared only in
 * ../local/index.ts, where it is private — so none of those calls resolved. It now lives in
 * lib/format.ts as `monotonicNow` and is aliased here to keep the call sites unchanged. */
import { monotonicNow as performanceSafeNow } from "@/lib/format";
import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
/* `ProposedGuard` is the shape a synthesis returns, and `validate` is the guard that stops a
 * hallucinated spec reaching a guard record: it switches on `kind`, rebuilds the spec field by
 * field, and returns null for anything that does not fit. Nothing is repaired, because a repaired
 * spec is a check nobody proposed and could evaluate to `pass` — the most dangerous result a
 * guard can give. */
import type { ProposedGuard } from "@/types/guards";
import type { ClassificationResult } from "@/types/retrieval";
import {
  DEFAULT_MODELS,
  type EngineConfig,
  LOCAL_DIMENSIONS,
  type ProviderId,
  readConfig,
} from "../config";
import { EngineError, unsupportedError } from "../errors";
import { embedBatch } from "../local/embed";
import {
  type LlmAlternative,
  type LlmDecision,
  type LlmDiscard,
  type LlmExtraction,
  type LlmPremise,
  SYSTEM_PROMPT,
  needsChunking,
  userPrompt,
} from "../prompts/extraction";
import { type ChatMessage, chat } from "../providers/openai-compatible";
import { registerEngine } from "../registry";
import {
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
  llmCapabilities,
} from "../types";
import { readExtraction, splitForPrompt, toExtractionResult } from "./parse";

export interface LlmEngineOptions {
  readonly config: EngineConfig;
  readonly id: EngineId;
}

export function createLlmEngine(options: LlmEngineOptions): WhyLogEngine {
  const { config, id } = options;
  const provider = config.provider as Exclude<ProviderId, "local">;

  const requireKey = (): string => {
    if (config.apiKey === null || config.apiKey.length === 0) {
      throw new EngineError(
        "no-key",
        "No API key is saved. Add one in Settings, or switch to the local engine.",
        {
          engine: id.model,
        },
      );
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
      /* The accumulator is built from MUTABLE arrays and assembled once at the end.
       * `LlmExtraction` declares its arrays readonly, so pushing into a value of
       * that type is a type error - and the fix is to accumulate locally, not to
       * weaken the published shape. */
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
      return toExtractionResult(
        merged,
        request,
        id,
        performanceSafeNow() - started,
        promptTokens,
        completionTokens,
      );
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

    /**
     * Guard synthesis, for the decisions the templates miss.
     *
     * The model is asked for strict JSON and every proposal is validated before it is returned:
     * unknown kind, empty package, empty glob or empty pattern is dropped rather than repaired.
     * A repaired spec is a check nobody proposed, and a guard that silently evaluates something
     * other than what was asked for can return `pass` — the most dangerous result it could give.
     *
     * Everything from here is marked `requiresReview` and capped in confidence by
     * `guards/synth/llm.ts`. A model-proposed guard is never `blocking` until a human reads it,
     * because blocking fails a build and a guess should not be able to do that.
     */
    synthesizeGuards: async (request: GuardSynthesisRequest): Promise<GuardSynthesisResult> => {
      /* No `started` clock here: `GuardSynthesisResult` carries no duration, and measuring one
       * nothing reads would be a number with no consumer. */
      const apiKey = requireKey();

      const response = await chat(provider, apiKey, {
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "You compile an architectural decision into machine-checkable guards. Reply with ONLY a JSON array. Each element has: kind (one of dependency_present, dependency_absent, path_glob_exists, path_glob_absent, string_in_files, string_absent_in_files, command_exit_zero, llm_judge); the fields that kind needs (package, or glob, or pattern+glob, or command, or rubric+scopeGlobs); severity (blocking|warning); rationale (one sentence saying WHY this check verifies that decision, naming the decision id). Prefer deterministic kinds; use llm_judge only if nothing else can express the decision. Propose at most 3. If you cannot describe what a violation looks like, reply with [].",
          },
          { role: "user", content: guardSynthesisPrompt(request) },
        ],
        temperature: 0.1,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });

      const parsed = parseGuardProposals(response.text);

      if (parsed.length === 0) {
        return {
          guards: [],
          // Stated rather than omitted: a decision with no synthesizable guard is
          // marked unverifiable and SHOWN, because a compliance score computed only
          // over the decisions that happened to be checkable flatters itself.
          unverifiableReason: `The model proposed no check for ${request.variable} = ${request.value}, which means it could not describe what a violation would look like. That is the literature's own test for an unverifiable decision, and it is reported rather than filled in with a guess.`,
          engine: id,
        };
      }

      const guards: ProposedGuard[] = [];
      for (const proposal of parsed) {
        const validated = validate(proposal);
        if (validated === null) continue;
        guards.push({ ...validated, generatedBy: "llm", requiresReview: true });
      }

      return {
        guards,
        ...(guards.length > 0
          ? {}
          : {
              unverifiableReason: `The model proposed ${parsed.length} guard(s) but none survived validation — each had an unknown kind or an empty package, glob or pattern. Nothing was repaired, because a repaired spec is a check nobody proposed.`,
            }),
        engine: id,
      };
    },
  };
}

function guardSynthesisPrompt(request: GuardSynthesisRequest): string {
  const lines = [
    `Decision ${request.decisionId}: ${request.statement}`,
    `Variable: ${request.variable}`,
    `Chosen value: ${request.value}`,
  ];

  if (request.appliesTo.length > 0)
    lines.push(`Governs these paths: ${request.appliesTo.join(", ")}`);

  if (request.premises.length > 0) {
    lines.push("Rests on:");
    for (const premise of request.premises) lines.push(`  - ${premise.id} ${premise.text}`);
  }

  const rejected = request.rejected ?? [];
  if (rejected.length > 0) {
    lines.push(
      "Rejected alternatives (each is a guard waiting to happen — the thing turned down should be absent):",
    );
    for (const entry of rejected) {
      lines.push(
        `  - ${entry.value}${entry.whyRejected === undefined ? "" : ` — "${entry.whyRejected}"`}`,
      );
    }
  }

  lines.push("", "Reply with the JSON array only.");
  return lines.join("\n");
}

/**
 * Pull a JSON array of proposals out of a model response.
 *
 * Tolerates the three shapes models actually return: bare JSON, JSON in a ```json fence, and
 * JSON with prose around it. Anything that cannot be parsed yields an empty list, which the
 * caller turns into an `unverifiableReason` — a parse failure is reported, never papered over
 * with a plausible-looking guard.
 */
function parseGuardProposals(text: string): readonly ProposedGuard[] {
  const candidates: string[] = [];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1]);
  candidates.push(text);

  const bracketed = /\[[\s\S]*\]/.exec(text);
  if (bracketed?.[0] !== undefined) candidates.push(bracketed[0]);

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate.trim());
    } catch {
      continue;
    }

    if (!Array.isArray(value)) continue;

    const out: ProposedGuard[] = [];
    for (const entry of value) {
      if (entry === null || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record["kind"] !== "string") continue;

      /* The whole record is passed through as the spec, because which fields a spec has depends
       * on `kind` and this function does not know the kind yet. `validate` is what narrows it:
       * it switches on `kind`, rebuilds the spec field by field with the right type, and returns
       * null for anything that does not fit. Nothing reaches a guard unvalidated. */
      out.push({
        spec: record as unknown as ProposedGuard["spec"],
        rationale: typeof record["rationale"] === "string" ? record["rationale"] : "",
        severity: record["severity"] === "blocking" ? "blocking" : "warning",
        generatedBy: "llm",
        confidence: asConfidence(
          typeof record["confidence"] === "number" ? record["confidence"] : 0.4,
        ),
        requiresReview: true,
      });
    }

    if (out.length > 0) return out;
  }

  return [];
}

function compositionPrompt(request: CompositionRequest): string {
  // Each fact carries its label and its premises, because a composition that
  // quotes a decision without the conditions it rests on is exactly the export an
  // agent will obey after those conditions stop holding.
  const material = request.material
    .map((fact) => {
      const premises = fact.premises.length > 0 ? ` [given: ${fact.premises.join("; ")}]` : "";
      const rationale =
        fact.rationale !== undefined && fact.rationale.length > 0
          ? ` — because ${fact.rationale}`
          : "";
      return `- ${fact.decisionId} (${fact.label}): ${fact.statement}${premises}${rationale}`;
    })
    .join("\n");

  return [
    `Write the "${request.kind}" section.`,
    request.question !== undefined && request.question.length > 0
      ? `Question: ${request.question}`
      : "",
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
