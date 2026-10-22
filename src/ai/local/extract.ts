/**
 * The local recogniser ΓÇö the engine-side half of Phase 1.
 *
 * Phase 1 ┬╖ sub-phase 1.10 (the local path)
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.10
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 *
 * `LocalEngine.extract()` is one call: normalised text in, candidates out. This is
 * the composition of the recognisers around that call, and it is deliberately thin
 * ΓÇö every stage it calls lives in `src/extraction/` or `src/ai/local/` and is
 * separately tunable, because Phase 7 measures them separately.
 *
 * What it adds that no single stage can:
 *
 *   ΓÇó the EPISODE LOOP, so candidates carry the episode they came from;
 *   ΓÇó PROVENANCE, which needs the whole turn list and therefore cannot be computed
 *     inside one episode;
 *   ΓÇó the LOCAL-INDEX WIRING that connects premises and alternatives to the
 *     decisions they belong to.
 *
 * ---------------------------------------------------------------------------
 * LOCAL INDICES, NOT IDS
 *
 * Candidates refer to each other by index (`premiseRefs`, `alternativeRefs`,
 * `decisionRef`) because ids are minted at COMMIT, not at extraction. Minting them
 * earlier would make a re-run over the same transcript produce a different graph
 * shape depending on what was already in the log ΓÇö and "import twice, get zero new
 * nodes" would stop being true.
 *
 * The indices are GLOBAL across the whole extraction, not per episode, so a
 * decision in episode 3 can reference a premise in episode 3 without the caller
 * having to know which episode either came from.
 * ---------------------------------------------------------------------------
 */

import type { EngineId, ISODateString } from "@/types/common";
import { asConfidence } from "@/types/common";
import type {
  AlternativeCandidate,
  DecisionCandidate,
  DiscardedCandidate,
  EpisodeSpan,
  ExtractionRequest,
  ExtractionResult,
  PremiseCandidate,
} from "@/ai/types";
import { isWorldObservable } from "@/types/domain";
import type { EpisodeWindow, NormalizedTranscript } from "@/extraction/types";
import type { OffsetMap } from "@/extraction/offset-map";
import { recoverDecisions, type DecisionContext, type RecoveredDecision } from "@/extraction/decisions";
import { recoverPremises, type RecoveredPremise } from "@/extraction/premises";
import { linkPremises } from "@/extraction/premise-linker";
import { recoverAlternatives } from "@/extraction/alternatives";
import { classifyOrigin, type OriginClassification } from "@/extraction/provenance";
import { scoreAlternative, scoreDecision, scorePremise } from "@/ai/local/confidence";

export interface LocalExtractionContext {
  readonly normalized: NormalizedTranscript;
  readonly episodes: readonly EpisodeWindow[];
  readonly engine: EngineId;
}

export interface LocalExtraction {
  readonly result: ExtractionResult;
  /** Kept for the review queue, which needs origins and tiers that the engine
   *  interface does not carry. */
  readonly decisions: readonly RecoveredDecision[];
  readonly premises: readonly RecoveredPremise[];
  readonly origins: readonly OriginClassification[];
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function extractLocal(request: ExtractionRequest, context: LocalExtractionContext): LocalExtraction {
  const started = nowMs();
  const map = mapOf(context.normalized);

  const decisionContext: DecisionContext = {
    transcriptId: request.transcriptId,
    raw: context.normalized.raw,
    map,
  };

  const decisions: RecoveredDecision[] = [];
  const premises: RecoveredPremise[] = [];
  const alternatives: AlternativeCandidate[] = [];
  const discarded: DiscardedCandidate[] = [];
  const episodes: EpisodeSpan[] = [];
  const origins: OriginClassification[] = [];

  /** Index of the first decision belonging to each episode, so alternatives can
   *  attach to a decision in their own episode rather than to the first one. */
  const decisionBaseByEpisode: number[] = [];
  let premiseCount = 0;

  for (const episode of context.episodes) {
    episodes.push({
      ...(episode.variable === null ? {} : { variable: episode.variable }),
      turnRange: episode.turnRange,
      charRange: episode.charRange,
    });

    decisionBaseByEpisode[episode.index] = decisions.length;

    /* ---- decisions ---- */
    const decisionRecovery = recoverDecisions(episode, decisionContext);
    discarded.push(...decisionRecovery.discarded);
    const episodeDecisions = decisionRecovery.decisions;

    /* ---- premises ---- */
    const premiseRecovery = recoverPremises(episode, decisionContext);
    discarded.push(...premiseRecovery.discarded);

    /* ---- linking: which premise supports which decision, and what is excluded ---- */
    const linking = linkPremises(episodeDecisions, premiseRecovery.premises);

    /* ---- provenance + scoring, per decision ---- */
    const episodePremises: RecoveredPremise[] = premiseRecovery.premises;
    const episodeExcluded = linking.excluded;

    episodeDecisions.forEach((decision, localIndex) => {
      const origin = classifyOrigin(episode, decision.cue.start, decision.candidate.modality);
      origins.push(origin);

      const breakdown = scoreDecision(decision, origin.origin);
      const link = linking.links[localIndex];

      // `premiseRefs` carries the IN-list AND the OUT-list, because the engine
      // interface has one list and the split is recoverable at commit time from the
      // ontology's exclusion table. Both kinds must be asserted before the
      // justification that references them, and one list is what makes that ordering
      // easy to get right.
      const premiseBase = premiseCount;
      const refs = [
        ...(link?.inRefs ?? []).map((i) => premiseBase + i),
        ...(link?.outRefs ?? []).map((i) => premiseBase + episodePremises.length + i),
      ];

      decisions.push({
        ...decision,
        candidate: {
          ...decision.candidate,
          origin: origin.origin,
          confidence: breakdown.total,
          premiseRefs: refs,
          alternativeRefs: [],
        },
      });
    });

    /* ---- premises become candidates, with their tier-affecting context ---- */
    episodePremises.forEach((premise, localIndex) => {
      const attached = (linking.links.find((l) => l.inRefs.includes(localIndex)) ?? null) !== null;
      const breakdown = scorePremise(premise, attached, isWorldObservable(premise.candidate.type));

      premises.push({
        ...premise,
        candidate: { ...premise.candidate, confidence: breakdown.total },
      });
    });
    premiseCount += episodePremises.length;

    /* ---- excluded conditions become premises too ---- */
    episodeExcluded.forEach((excluded) => {
      const source = episodePremises[excluded.sourcePremiseIndex];
      const attached = source !== undefined;
      const breakdown = scorePremise(
        source ?? synthesisedSource(excluded),
        attached,
        isWorldObservable(excluded.type),
      );

      premises.push({
        ...(source ?? synthesisedSource(excluded)),
        candidate: {
          ...excluded.candidate,
          // An exclusion inherits its source's score, discounted: it is an
          // inference from a premise, not an observation of one.
          confidence: asConfidence(Math.min(breakdown.total, excluded.confidence)),
        },
      });
    });
    premiseCount += episodeExcluded.length;

    /* ---- alternatives ---- */
    const alternativeRecovery = recoverAlternatives(episode, episodeDecisions, decisionContext);
    discarded.push(...alternativeRecovery.discarded);

    const base = decisionBaseByEpisode[episode.index] ?? decisions.length - episodeDecisions.length;
    for (const alternative of alternativeRecovery.alternatives) {
      const breakdown = scoreAlternative(alternative);
      const globalDecisionIndex = base + alternative.decisionIndex;

      alternatives.push({ ...alternative.candidate, confidence: breakdown.total, decisionRef: globalDecisionIndex });

      const target = decisions[globalDecisionIndex];
      if (target !== undefined) {
        decisions[globalDecisionIndex] = {
          ...target,
          candidate: {
            ...target.candidate,
            alternativeRefs: [...target.candidate.alternativeRefs, alternatives.length - 1],
          },
        };
      }
    }
  }

  const result: ExtractionResult = {
    decisions: decisions.map((d) => d.candidate),
    premises: premises.map((p) => p.candidate),
    alternatives,
    episodes,
    discarded,
    engine: context.engine,
    durationMs: nowMs() - started,
  };

  return { result, decisions, premises, origins };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The offset map, rebuilt from the anchors the normaliser stored.
 *
 * Rebuilding rather than threading the map through `NormalizedTranscript` keeps the
 * transcript serialisable ΓÇö it is persisted with the extraction run so a review can
 * be resumed after a reload, and a class instance would not survive that.
 */
function mapOf(normalized: NormalizedTranscript): OffsetMap {
  return {
    anchors: normalized.anchors,
    normalisedLength: normalized.text.length,
    rawLength: normalized.raw.length,
  };
}

/** An exclusion whose source premise was somehow not kept still needs a scoreable
 *  shape. Synthesising one is cheaper than threading a nullable through
 *  `scorePremise`, and the synthesised source is never emitted ΓÇö only its score is
 *  used. */
function synthesisedSource(excluded: { type: PremiseCandidate["type"]; candidate: PremiseCandidate }): RecoveredPremise {
  return {
    candidate: excluded.candidate,
    cue: {
      phrase: excluded.candidate.predicate,
      type: excluded.type,
      kind: "explicit",
      weight: 0.6,
      predicate: excluded.candidate.predicate,
    },
    kind: "explicit",
    polarity: "negative",
    turn: { index: -1, speaker: "unknown", text: excluded.candidate.text, start: 0, end: 0, attribution: "none" },
    episodeIndex: -1,
    predicateVia: "cue",
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** The `occurredAt` every event from this extraction will carry. Exposed because
 *  `commit.ts` needs the same value and deriving it twice would risk a mismatch ΓÇö
 *  and a mismatch between a premise's valid time and its decision's would put them
 *  in the wrong order on the timeline. */
export function occurredAtOf(normalized: NormalizedTranscript, fallback: ISODateString): ISODateString {
  return normalized.occurredAt.length > 0 ? normalized.occurredAt : fallback;
}
