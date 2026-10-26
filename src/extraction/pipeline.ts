/**
 * The extraction pipeline — the orchestrator.
 *
 * Phase 1 · all sub-phases
 * Plan: plan/phase-1-extraction-pipeline.md
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS
 *
 * The stages, in order, and the telemetry between them:
 *
 *     normalise → segment → recognise → validate → score → resolve → review queue
 *
 * The recognisers live in `src/ai/local/` and `src/ai/llm/` behind one interface.
 * Everything else is here, because everything else is the same whichever engine
 * ran — and a stage that is duplicated per engine is a stage whose two copies will
 * drift.
 *
 * ---------------------------------------------------------------------------
 * THE STAGE REPORTS ARE NOT DECORATION
 *
 * Extraction is the layer users trust least, so it reports what it DID rather than
 * only what it found. "4 turns unattributed, 2 episodes, 9 cues → 3 decisions,
 * 5 premises, 2 discarded, 1 snippet failed validation" is a sentence a user can
 * argue with. "3 decisions" is not.
 * ---------------------------------------------------------------------------
 */

import type { EngineId, ISODateString, TranscriptId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { Modality } from "@/types/domain";
import type { DiscardedCandidate } from "@/ai/types";
import { nowISO } from "@/lib/format";
import type { WhyLogEngine, ExtractionResult, ExtractionRequest } from "@/ai/types";
import type { GraphState } from "@/substrate/graph-state";
import { normaliseTranscript, describeNormalisation, type NormalizerOptions } from "./normalizer";
import { segmentEpisodes, describeSegmentation } from "./segmentation";
import { chunkTurns, describeChunking, type ChunkingResult } from "./chunking";
import { validateExtraction, describeValidation, type ValidationReport } from "./snippet-validation";
import { resolveExtraction, describeResolution, describeIdempotence, type ResolutionReport } from "./resolution";
import { summariseOrigins, describeProvenance, type OriginClassification } from "./provenance";
import { buildQueue, fallbackOrigin, mergeTiers, originOf } from "./queue-build";
import { describeHistogram } from "./confidence";
import { voteAcrossRuns, describeVoting, type VoteOutcome, type VotingOptions } from "./voting";
import type {
  ExtractionRun,
  NormalizedTranscript,
  EpisodeWindow,
  ResolvedCandidate,
  StageReport,
} from "./types";

export interface ExtractionInput {
  readonly transcriptId: TranscriptId;
  /** The RAW text, exactly as pasted. Never pre-normalised: the offset map has to
   *  start from the real characters or nothing downstream resolves. */
  readonly raw: string;
  readonly label?: string;
  readonly occurredAt?: ISODateString;
}

export interface PipelineOptions {
  readonly engine: WhyLogEngine;
  readonly engineId: EngineId;
  /** The graph as it stands, so resolution can merge instead of duplicating. */
  readonly state: GraphState;
  /** Force a transcript shape rather than detecting it. */
  readonly shape?: NormalizerOptions["shape"];
  readonly collapseNoise?: boolean;
  readonly chunkChars?: number;
  /** Three-run voting. Ignored when `engine.capabilities().voting` is false. */
  readonly voting?: VotingOptions;
  readonly signal?: AbortSignal;
}

export interface PipelineOutcome {
  readonly run: ExtractionRun;
  readonly normalized: NormalizedTranscript;
  readonly episodes: readonly EpisodeWindow[];
  readonly chunking: ChunkingResult;
  readonly result: ExtractionResult;
  readonly validation: ValidationReport;
  readonly resolution: ResolutionReport;
  readonly queue: readonly ResolvedCandidate[];
  readonly origins: readonly OriginClassification[];
  readonly stages: readonly StageReport[];
  readonly voting: VoteOutcome | null;
  readonly startedAt: ISODateString;
  readonly durationMs: number;
}

export type PipelineFailure =
  | { readonly kind: "empty-input" }
  | { readonly kind: "no-turns" }
  | { readonly kind: "engine-unsupported" }
  | { readonly kind: "engine-error"; readonly message: string }
  | { readonly kind: "cancelled" };

export type PipelineResult =
  | { readonly ok: true; readonly outcome: PipelineOutcome }
  | { readonly ok: false; readonly failure: PipelineFailure };

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function runExtraction(
  input: ExtractionInput,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const startedAt = nowISO();
  const started = nowMs();
  const stages: StageReport[] = [];

  if (input.raw.trim().length === 0) {
    return { ok: false, failure: { kind: "empty-input" } };
  }
  if (!options.engine.capabilities().extraction) {
    return { ok: false, failure: { kind: "engine-unsupported" } };
  }

  /* ---- 1.1 normalise ---- */
  let stageStart = nowMs();
  const normalized = normaliseTranscript(input.raw, {
    transcriptId: input.transcriptId,
    ...(options.shape === undefined ? {} : { shape: options.shape }),
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    ...(options.collapseNoise === undefined ? {} : { collapseNoise: options.collapseNoise }),
    ...(input.label === undefined ? {} : { label: input.label }),
  });
  stages.push(stage("normalise", stageStart, input.raw.length, normalized.text.length, describeNormalisation(normalized)));

  if (normalized.turns.length === 0) {
    return { ok: false, failure: { kind: "no-turns" } };
  }

  /* ---- 1.1 chunk ---- */
  stageStart = nowMs();
  const chunking = chunkTurns(normalized.turns, normalized, options.chunkChars);
  stages.push(stage("segment", stageStart, normalized.turns.length, chunking.chunks.length, describeChunking(chunking)));

  /* ---- 1.2 segment ---- */
  stageStart = nowMs();
  const segmentation = segmentEpisodes(normalized);
  stages.push(
    stage(
      "segment",
      stageStart,
      chunking.chunks.length,
      segmentation.episodes.length,
      describeSegmentation(segmentation, normalized.turns.length),
    ),
  );

  /* ---- 1.3–1.6 recognise, through the engine seam ---- */
  stageStart = nowMs();
  const request: ExtractionRequest = {
    transcriptId: input.transcriptId,
    text: normalized.text,
    ...(normalized.occurredAt.length > 0 ? { occurredAt: normalized.occurredAt } : {}),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  let result: ExtractionResult;
  let voting: VoteOutcome | null = null;

  const votingOn = options.voting !== undefined && options.voting.runs > 1 && options.engine.capabilities().voting;

  try {
    if (votingOn && options.voting !== undefined) {
      const runs: ExtractionResult[] = [];
      for (let i = 0; i < options.voting.runs; i += 1) {
        if (options.signal?.aborted) return { ok: false, failure: { kind: "cancelled" } };
        runs.push(await options.engine.extract(request));
      }
      voting = voteAcrossRuns(runs);
      result = voting.result;
    } else {
      result = await options.engine.extract(request);
    }
  } catch (error) {
    return { ok: false, failure: { kind: "engine-error", message: messageOf(error) } };
  }

  if (options.signal?.aborted) return { ok: false, failure: { kind: "cancelled" } };

  stages.push(
    stage(
      "recognise",
      stageStart,
      segmentation.episodes.length,
      result.decisions.length + result.premises.length + result.alternatives.length,
      voting === null
        ? `${result.decisions.length} decisions, ${result.premises.length} premises, ${result.alternatives.length} alternatives, ${result.discarded.length} discarded`
        : describeVoting(voting),
    ),
  );

  /* ---- 1.6 validate snippets ---- */
  stageStart = nowMs();
  const validated = validateExtraction(result, normalized.raw);
  stages.push(
    stage("recognise", stageStart, validated.report.checked, validated.report.passed, describeValidation(validated.report)),
  );
  result = validated.result;

  /* ---- 1.6 origin, which needs the whole turn list ---- */
  const origins = result.decisions.map((candidate) =>
    originOf(segmentation.episodes, candidate.snippet.text, candidate.modality),
  );

  /* ---- 1.8 tier ---- */
  stageStart = nowMs();
  const tiered = buildQueue(result, origins);
  stages.push(
    stage(
      "score",
      stageStart,
      result.decisions.length + result.premises.length + result.alternatives.length,
      tiered.queue.length,
      describeHistogram(tiered.histogram),
    ),
  );

  /* ---- 1.7 resolve ---- */
  stageStart = nowMs();
  const resolved = resolveExtraction(
    result.decisions.map((candidate, i) => ({ candidate, origin: origins[i] ?? fallbackOrigin })),
    result.premises,
    result.alternatives,
    { state: options.state, engine: options.engineId },
  );
  stages.push(
    stage("resolve", stageStart, tiered.queue.length, resolved.resolved.length, describeResolution(resolved.report)),
  );

  const run: ExtractionRun = {
    transcriptId: input.transcriptId,
    normalized,
    episodes: segmentation.episodes,
    decisions: result.decisions,
    premises: result.premises,
    alternatives: result.alternatives,
    discarded: [...result.discarded, ...discardsFromValidation(result, validated.report.failed)],
    engine: options.engineId,
    stages,
    startedAt,
    durationMs: nowMs() - started,
  };

  return {
    ok: true,
    outcome: {
      run,
      normalized,
      episodes: segmentation.episodes,
      chunking,
      result,
      validation: validated.report,
      resolution: resolved.report,
      queue: mergeTiers(tiered.queue, resolved.resolved),
      origins,
      stages,
      voting,
      startedAt,
      durationMs: run.durationMs,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function discardsFromValidation(result: ExtractionResult, failed: number): readonly DiscardedCandidate[] {
  if (failed === 0) return [];

  // A downgraded decision keeps its structure and loses its span, so an empty span
  // is the marker. It is counted as a discard because it IS a candidate the
  // extractor produced, and the discard list is the denominator of the precision
  // metric Phase 7 reports.
  return result.decisions
    .filter((candidate) => candidate.snippet.end <= candidate.snippet.start)
    .map((candidate) => ({
      kind: "decision" as const,
      discardedBy: "confidence-threshold" as const,
      rawText: candidate.statement,
      confidence: asConfidence(candidate.confidence),
    }));
}

function stage(
  name: StageReport["stage"],
  startedAt: number,
  itemsIn: number,
  itemsOut: number,
  note?: string,
): StageReport {
  return {
    stage: name,
    durationMs: Math.round(nowMs() - startedAt),
    itemsIn,
    itemsOut,
    ...(note === undefined ? {} : { note }),
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** The whole outcome as a paragraph, for the review header and for the notice the
 *  store raises when an import finishes. */
export function describeOutcome(outcome: PipelineOutcome): string {
  const summary = summariseOrigins(outcome.origins);
  return [
    describeNormalisation(outcome.normalized),
    describeSegmentation({ episodes: outcome.episodes, uncoveredTurns: 0, cueHits: 0 }, outcome.normalized.turns.length),
    describeValidation(outcome.validation),
    describeProvenance(summary, outcome.origins.length),
    describeResolution(outcome.resolution),
    describeIdempotence(outcome.resolution),
    outcome.voting === null ? "voting off" : describeVoting(outcome.voting),
  ].join("\n");
}
