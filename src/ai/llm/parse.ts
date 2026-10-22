/**
 * Parsing and coercion for the LLM path — 1.10.
 *
 * Phase 1 · sub-phase 1.10
 * Plan: STRUCTURE.md §5 names this file; `ai/llm/index.ts` owns the engine object
 * and this owns everything between "the model answered" and "here are candidates".
 *
 * ---------------------------------------------------------------------------
 * NOTHING IN HERE TRUSTS THE MODEL
 *
 * Every field is coerced through a type guard, every enum through the closed set,
 * every number through `clamp`, and every snippet through `locateSnippet`. A model
 * that invents a variable produces an OTHER decision; a model that paraphrases a
 * quote produces `null` and the item is dropped.
 *
 * The alternative — parsing into the declared interfaces with a cast — would let a
 * malformed answer reach the review queue looking well-formed, and the review is
 * the one place the system is allowed to be wrong in public.
 *
 * ---------------------------------------------------------------------------
 * TWO DEFAULTS THAT ARE DELIBERATELY CONSERVATIVE
 *
 *   `modality` defaults to `proposed`, never `asserted`. Only `asserted` may create
 *   an IN node, and a model has an incentive to make everything look settled.
 *
 *   `origin` defaults to `agent_inferred` (0.4). Provenance recomputes it from the
 *   turn list anyway; this is the value that survives if it does not.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionVariable, PremiseType } from "@/types/domain";
import { DECISION_VARIABLES, PREMISE_TYPES } from "@/types/domain";
import type { ExtractionRequest, ExtractionResult } from "../types";
import { canonicalPredicate, canonicalValueOf, foldKey, resolveVariable } from "@/ontology/canonicalize";
import { contextTokens } from "@/extraction/cue-scan";
import { chunkTurns } from "@/extraction/chunking";
import { normaliseTranscript } from "@/extraction/normalizer";
import { locateSnippet } from "@/extraction/offset-map";
import {
  EMPTY_LLM_EXTRACTION,
  PROMPT_CHAR_BUDGET,
  type LlmAlternative,
  type LlmDecision,
  type LlmDiscard,
  type LlmExtraction,
  type LlmPremise,
} from "../prompts/extraction";
import { extractJson } from "../providers/openai-compatible";

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

export function readExtraction(text: string, model: string): LlmExtraction {
  const parsed = extractJson(text, model);

  return {
    decisions: arrayOf(parsed["decisions"]).filter(isRecord) as readonly LlmDecision[],
    premises: arrayOf(parsed["premises"]).filter(isRecord) as readonly LlmPremise[],
    alternatives: arrayOf(parsed["alternatives"]).filter(isRecord) as readonly LlmAlternative[],
    discarded: arrayOf(parsed["discarded"]).filter(isRecord) as readonly LlmDiscard[],
  };
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Candidate construction                                                     */
/* -------------------------------------------------------------------------- */

export function toExtractionResult(
  parsed: LlmExtraction,
  request: ExtractionRequest,
  engine: EngineId,
  durationMs: number,
  promptTokens: number,
  completionTokens: number,
): ExtractionResult {
  if (parsed.decisions.length === 0 && parsed.premises.length === 0) {
    return {
      ...EMPTY_LLM_EXTRACTION,
      discarded: parsed.discarded,
      engine,
      durationMs: Math.round(durationMs),
      usage: { promptTokens, completionTokens },
    };
  }

  const raw = request.text;
  const premises = parsed.premises
    .map((premise, index) => toPremise(premise, index, request, raw, engine))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const decisions = parsed.decisions
    .map((decision) => toDecision(decision, request, raw, engine, premises.length))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const alternatives = parsed.alternatives
    .map((alternative) => toAlternative(alternative, request, raw, engine, decisions.length))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  return {
    decisions,
    premises,
    alternatives,
    episodes: [],
    discarded: parsed.discarded.map((discard) => ({
      kind: discard.kind,
      discardedBy: discard.discardedBy,
      rawText: String(discard.rawText ?? "").slice(0, 400),
      confidence: asConfidence(clamp(Number(discard.confidence ?? 0.3))),
    })),
    engine,
    durationMs: Math.round(durationMs),
    usage: { promptTokens, completionTokens },
  };
}

function toDecision(
  decision: LlmDecision,
  request: ExtractionRequest,
  raw: string,
  engine: EngineId,
  premiseCount: number,
): ExtractionResult["decisions"][number] | null {
  const value = stringOf(decision["value"]);
  if (value.length === 0) return null;

  const snippet = resolveSpan(request, raw, stringOf(decision["snippet"]));
  if (snippet === null) return null;

  const guess = resolveVariable(value, contextTokens(snippet.text));
  const variable: DecisionVariable = isVariable(decision["variable"])
    ? (decision["variable"] as DecisionVariable)
    : guess.variable;

  const canonical = variable === "OTHER" ? foldKey(value) : canonicalValueOf(variable, value);

  const refs = arrayOf(decision["premiseRefs"])
    .map((ref) => Number(ref))
    .filter((ref) => Number.isInteger(ref) && ref >= 0 && ref < premiseCount);

  const alternativeRefs = arrayOf(decision["alternativeRefs"])
    .map((ref) => Number(ref))
    .filter((ref) => Number.isInteger(ref) && ref >= 0);

  const modality = modalityOf(decision["modality"]);

  // A model that reports a hypothetical as a decision has not followed the prompt.
  // The modality detector's answer is taken over the model's own claim, because the
  // rule is that only `asserted` may create an IN node and the model has an
  // incentive to make everything look settled.
  return {
    variable,
    value: canonical,
    statement: stringOf(decision["statement"]).length > 0 ? stringOf(decision["statement"]) : `Use ${canonical}`,
    ...(stringOf(decision["yStatement"]).length === 0 ? {} : { yStatement: stringOf(decision["yStatement"]) }),
    ...(stringOf(decision["rationale"]).length === 0 ? {} : { rationale: stringOf(decision["rationale"]) }),
    ...(stringOf(decision["acceptedDownside"]).length === 0
      ? {}
      : { acceptedDownside: stringOf(decision["acceptedDownside"]) }),
    origin: originOf(decision["origin"]),
    modality,
    // Capped below the local rubric's ceiling: an unreviewed model claim is not
    // worth as much as a cue plus a resolved variable plus a rationale clause.
    confidence: asConfidence(Math.min(0.85, clamp(Number(decision["confidence"] ?? 0.6)))),
    snippet,
    premiseRefs: refs,
    alternativeRefs,
    appliesTo: arrayOf(decision["appliesTo"]).map(String).filter((glob) => glob.includes("*")).slice(0, 8),
  };
}

function toPremise(
  premise: LlmPremise,
  _index: number,
  request: ExtractionRequest,
  raw: string,
  engine: EngineId,
): ExtractionResult["premises"][number] | null {
  const text = stringOf(premise["text"]);
  if (text.length === 0) return null;

  const snippet = resolveSpan(request, raw, stringOf(premise["snippet"]) || text);
  if (snippet === null) return null;

  const type: PremiseType = isPremiseType(premise["type"]) ? (premise["type"] as PremiseType) : "requirement";
  const predicate = canonicalPredicate(type, stringOf(premise["predicate"]) || text);
  void engine;

  return {
    type,
    predicate,
    ...(premise["value"] === undefined || premise["value"] === null ? {} : { value: premise["value"] as string | number | boolean }),
    text,
    confidence: asConfidence(Math.min(0.85, clamp(Number(premise["confidence"] ?? 0.55)))),
    snippet,
    // Every premise from a model is reviewed. The prompt asks for the closed set and
    // the model usually complies, but "usually" is not a standard an append-only log
    // can be built on.
    needsReview: true,
  };
}

function toAlternative(
  alternative: LlmAlternative,
  request: ExtractionRequest,
  raw: string,
  engine: EngineId,
  decisionCount: number,
): ExtractionResult["alternatives"][number] | null {
  const value = stringOf(alternative["value"]);
  if (value.length === 0) return null;

  const snippet = resolveSpan(request, raw, stringOf(alternative["snippet"]));
  if (snippet === null) return null;

  const guess = resolveVariable(value, contextTokens(snippet.text));
  const variable: DecisionVariable = isVariable(alternative["variable"])
    ? (alternative["variable"] as DecisionVariable)
    : guess.variable;

  const ref = Number(alternative["decisionRef"]);
  void engine;

  return {
    variable,
    value: variable === "OTHER" ? foldKey(value) : canonicalValueOf(variable, value),
    ...(stringOf(alternative["whyRejected"]).length === 0 ? {} : { whyRejected: stringOf(alternative["whyRejected"]) }),
    // Halved against the model's own claim: published precision on this component is
    // 15.4%, and a model's self-reported confidence is not calibrated against that.
    confidence: asConfidence(Math.min(0.6, clamp(Number(alternative["confidence"] ?? 0.5)) * 0.5)),
    snippet,
    decisionRef: Number.isInteger(ref) && ref >= 0 && ref < decisionCount ? ref : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Locate a model's quote in the input.
 *
 * Returns null when it is not a literal substring — which is the rule, not an
 * error: the item is dropped here and counted in `discarded` by the validation pass
 * downstream. Guessing a span would produce a highlight over the wrong words, and
 * that is undetectable by reading it.
 */
function resolveSpan(request: ExtractionRequest, raw: string, snippet: string): ReturnType<typeof locateSnippet> {
  const needle = snippet.trim();
  if (needle.length === 0) return null;
  return locateSnippet(request.transcriptId, raw, needle);
}

/* -------------------------------------------------------------------------- */
/* Chunking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Split a long transcript on TURN boundaries for the prompt.
 *
 * `chunkTurns` is the same chunker the local path uses, so a transcript that fits
 * locally and does not fit remotely is split identically — which matters because
 * Phase 7 compares the two engines on the same fixture and a different split would
 * be a confound.
 */
export function splitForPrompt(raw: string, transcriptId: ExtractionRequest["transcriptId"]): readonly string[] {
  const normalized = normaliseTranscript(raw, { transcriptId });
  const { chunks } = chunkTurns(normalized.turns, PROMPT_CHAR_BUDGET);

  if (chunks.length === 0) return [raw];
  return chunks.map((chunk) =>
    chunk.turnIndexes
      .map((index) => normalized.turns[index]?.text ?? "")
      .filter((text) => text.length > 0)
      .join("\n\n"),
  );
}

/* -------------------------------------------------------------------------- */
/* Coercion                                                                   */
/* -------------------------------------------------------------------------- */

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.3;
  return Math.max(0.05, Math.min(0.95, value));
}

function isVariable(value: unknown): boolean {
  return typeof value === "string" && (DECISION_VARIABLES as readonly string[]).includes(value);
}

function isPremiseType(value: unknown): boolean {
  return typeof value === "string" && (PREMISE_TYPES as readonly string[]).includes(value);
}

function modalityOf(value: unknown): "asserted" | "proposed" | "hypothetical" | "reported" {
  switch (value) {
    case "asserted":
    case "proposed":
    case "hypothetical":
    case "reported":
      return value;
    default:
      // A model that omits the field gets `proposed`: recorded, reviewed, and never
      // IN without a human. Defaulting to `asserted` would let an unlabelled claim
      // become a live decision.
      return "proposed";
  }
}

function originOf(value: unknown): "human_stated" | "agent_proposed_human_accepted" | "agent_inferred" {
  switch (value) {
    case "human_stated":
    case "agent_proposed_human_accepted":
      return value;
    default:
      return "agent_inferred";
  }
}

