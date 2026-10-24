/**
 * Metric 1 — decision extraction precision / recall / F1.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: RecovAr, 75% recall / 77% precision (docs/05 §4.1).
 *
 * ---------------------------------------------------------------------------
 * NOT THE SAME TASK AS THE COMPARATOR, AND THE NOTE SAYS SO
 *
 * RecovAr recovers rationale from commit messages and issue threads. This recovers decisions from
 * agent dialogue. The corpora differ in genre, length and how explicitly the decision is stated, so
 * the two numbers are adjacent rather than comparable. Printing them side by side without saying that
 * would be exactly the overstatement docs/07 §2 warns about — the comparator is cited because it is
 * the nearest published number that exists, and the gap between the tasks is stated in the same
 * breath.
 *
 * ---------------------------------------------------------------------------
 * `expectNode: false` IS A LABEL, NOT AN ABSENCE
 *
 * A labelled decision with `expectNode: false` is one the corpus says must NOT become a graph node —
 * a hypothetical, a report of someone else's decision, a proposal that was talked out of. Counting
 * those as false negatives would punish the system for correctly declining, so they are excluded here
 * and scored by `modality.ts` instead, where declining correctly is the thing being measured.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, EngineId, TranscriptId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { ResolvedCorpus, ResolvedDecision } from "../corpus/labels";
import type { RunResult, TranscriptRun } from "../harness";
import { type Alignment, MATCH_RULE, align } from "./match";
import {
  COMPARATORS,
  METRIC_NAMES,
  type MetricResult,
  describeEngineId,
  precisionRecall,
} from "./types";

export interface ExtractionOutcome {
  readonly metric: MetricResult;
  readonly alignment: Alignment<ResolvedDecision, Decision>;
  /** Overlapping spans whose variable disagrees: found the sentence, understood it as the wrong kind
   *  of decision. Diagnosed separately because it is the most actionable failure the extractor has. */
  readonly variableErrors: readonly { label: ResolvedDecision; node: Decision }[];
  readonly perTranscript: readonly { transcript: string; tp: number; fp: number; fn: number }[];
}

export function scoreDecisionExtraction(
  corpus: ResolvedCorpus,
  run: RunResult,
  engine: EngineId,
): ExtractionOutcome {
  const labels: ResolvedDecision[] = [];
  const nodes: Decision[] = [];
  const transcriptOf = new Map<DecisionId, TranscriptId>();
  const runByRuntime = new Map<TranscriptId, TranscriptRun>();

  for (const entry of run.transcripts) runByRuntime.set(entry.runtimeId, entry);

  for (const transcript of corpus.transcripts) {
    /* A transcript the harness never imported has no runtime id. Skipping it is right: its labels
     * are counted as misses by the metrics that own them, and inventing an id here would attribute
     * them to whatever transcript happened to land at that index. */
    const runtimeId = transcriptIdOf(run, transcript.id);
    if (runtimeId === null) continue;

    const entry = runByRuntime.get(runtimeId);
    if (entry === undefined) continue;

    for (const label of transcript.decisions) {
      if (!label.expectNode) continue; /* declined-on-purpose; scored by modality.ts */
      labels.push(label);
    }
  }

  for (const decision of run.state.decisions.values()) {
    nodes.push(decision);
    transcriptOf.set(decision.id, decision.provenance.transcriptId);
  }

  const alignment = align(
    labels,
    nodes,
    (label) => label.span,
    (node) => ({ start: node.provenance.snippet.start, end: node.provenance.snippet.end }),
    (label, node) => sameTranscript(run, label, node, transcriptOf),
  );

  const variableErrors = alignment.pairs
    .filter((pair) => pair.label.variable !== pair.node.variable)
    .map((pair) => ({ label: pair.label, node: pair.node }));

  const perTranscript = corpus.transcripts.map((transcript) => {
    const owned = alignment.pairs.filter(
      (pair) => transcriptOf.get(pair.node.id) === transcriptIdOf(run, transcript.id),
    );
    return {
      transcript: transcript.id,
      tp: owned.length,
      fp: alignment.spurious.filter(
        (node) => transcriptOf.get(node.id) === transcriptIdOf(run, transcript.id),
      ).length,
      fn: transcript.decisions.filter(
        (label) => label.expectNode && !owned.some((pair) => pair.label === label),
      ).length,
    };
  });

  const detail = precisionRecall(
    alignment.truePositives,
    alignment.falsePositives,
    alignment.falseNegatives,
  );

  return {
    alignment,
    variableErrors,
    perTranscript,
    metric: {
      id: "decision-extraction",
      name: METRIC_NAMES["decision-extraction"],
      value: detail.f1,
      detail,
      n: labels.length,
      perEngine: [{ engine: describeEngineId(engine), value: detail.f1, n: labels.length, detail }],
      comparator: COMPARATORS["decision-extraction"] ?? null,
      gloss: `${detail.truePositives} of ${labels.length} labelled decisions became graph nodes; ${detail.falsePositives} node(s) had no label behind them.`,
      honestNote: `Matched by ${MATCH_RULE}. Labels marked expectNode:false are excluded here and scored by modality precision, because counting a correctly declined hypothetical as a miss would punish the right behaviour. n=${labels.length} across ${corpus.transcripts.length} transcripts hand-labelled by the author of the system, which is the largest methodological weakness in this benchmark: the labels were written by the person being scored. The comparator is a different genre (commit messages, not agent dialogue) and is cited as the nearest published number, not as a like-for-like baseline.`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Transcript identity                                                        */
/* -------------------------------------------------------------------------- */

function transcriptIdOf(run: RunResult, corpusKey: string): TranscriptId | null {
  const entry = run.transcripts.find((candidate) => candidate.transcript.id === corpusKey);
  return entry === undefined ? null : entry.runtimeId;
}

/**
 * Which transcript a label belongs to.
 *
 * A label carries the corpus key of its transcript, not a runtime id, because runtime ids depend on
 * import order and the corpus file must stay readable. This resolves one to the other at match time.
 */
function sameTranscript(
  run: RunResult,
  label: ResolvedDecision,
  node: Decision,
  transcriptOf: ReadonlyMap<DecisionId, TranscriptId>,
): boolean {
  const owner = transcriptOf.get(node.id);
  if (owner === undefined) return false;

  const entry = run.transcripts.find((candidate) => candidate.runtimeId === owner);
  if (entry === undefined) return false;

  return entry.transcript.decisions.some((candidate) => candidate === label);
}
