/**
 * Metric 13 — modality precision: of the statements the system DECLINED, how many were correctly declined.
 *
 * Phase 7 · sub-phase 7.2
 * Comparator: none published. §7.2 calls this one of the two unusual metrics.
 *
 * ---------------------------------------------------------------------------
 * THE INVERSE OF THE USUAL QUESTION, AND THE ONE THAT MATTERS HERE
 *
 * Every extraction metric asks "did you find the things that are there". This one asks "did you leave
 * alone the things that are not decisions". A system that turns "what if we used Redis?" into a Redis
 * decision has perfect recall and is unusable, because the graph now contains things nobody decided
 * and every downstream guarantee — contradiction detection, cascade, export — is built on a lie.
 *
 * It is called precision rather than specificity because that is what it is: of the population the
 * system declined to promote, the fraction it was right to decline. The denominator is the declines,
 * not the hypotheticals, so a system that declines nothing scores zero rather than undefined.
 *
 * ---------------------------------------------------------------------------
 * WHY NOBODY MEASURES IT
 *
 * Because nobody's extractor is allowed to decline. A rationale miner over commit messages has no
 * hypotheticals to decline — a commit message does not speculate. Agent dialogue is the first corpus
 * in this literature where speculation, reported speech and rejected proposals outnumber decisions,
 * which is why the metric exists here and not in the surveyed systems. Reporting it as "no comparator"
 * is accurate rather than modest.
 *
 * ---------------------------------------------------------------------------
 * THE DEMO-KILLER THIS GUARDS
 *
 * §7.4 names "hypotheticals becoming nodes" as one of four demo-killers. This is the number that says
 * whether it happens. It is reported per transcript tier as well as in aggregate, because the
 * adversarial tier is where the failure lives and an aggregate over twelve transcripts can hide a
 * catastrophic 0.0 on three of them behind a good score on nine.
 * ---------------------------------------------------------------------------
 */

import type { EngineId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { ResolvedCorpus, ResolvedDecision } from "../corpus/labels";
import type { RunResult } from "../harness";
import { overlapOf } from "./match";
import { METRIC_NAMES, describeEngineId, type MetricResult } from "./types";

export interface ModalityOutcome {
  readonly metric: MetricResult;
  /** Statements the corpus says must NOT become nodes, and did. Each one is a visible defect. */
  readonly wronglyPromoted: readonly { label: ResolvedDecision; node: Decision }[];
  /** Statements the corpus says must not become nodes, and did not. Correct declines. */
  readonly correctlyDeclined: number;
  readonly declinesExpected: number;
  readonly byTier: readonly { tier: string; expected: number; wronglyPromoted: number }[];
}

export function scoreModalityPrecision(corpus: ResolvedCorpus, run: RunResult, engine: EngineId): ModalityOutcome {
  const nodes: Decision[] = [...run.state.decisions.values()];
  const declines: { label: ResolvedDecision; tier: string }[] = [];

  for (const transcript of corpus.transcripts) {
    for (const label of transcript.decisions) {
      if (label.expectNode) continue;
      declines.push({ label, tier: transcript.tier });
    }
  }

  const wronglyPromoted: { label: ResolvedDecision; node: Decision }[] = [];

  for (const entry of declines) {
    /* A decline is violated when ANY node overlaps the labelled span. Variable agreement is not
     * required, because the failure mode is not "found it and mislabelled the variable" — it is "made
     * a node out of a sentence that was not a decision", and such a node may carry any variable. */
    const hit = nodes.find((node) =>
      overlapOf(entry.label.span, { start: node.provenance.snippet.start, end: node.provenance.snippet.end }) > 0,
    );
    if (hit !== undefined) wronglyPromoted.push({ label: entry.label, node: hit });
  }

  const correctlyDeclined = declines.length - wronglyPromoted.length;
  const value = declines.length === 0 ? 1 : correctlyDeclined / declines.length;

  const tiers = [...new Set(corpus.transcripts.map((transcript) => transcript.tier))];
  const byTier = tiers.map((tier) => {
    const expected = declines.filter((entry) => entry.tier === tier).length;
    const wrong = wronglyPromoted.filter((entry) => tierOf(corpus, entry.label) === tier).length;
    return { tier, expected, wronglyPromoted: wrong };
  });

  return {
    wronglyPromoted,
    correctlyDeclined,
    declinesExpected: declines.length,
    byTier,
    metric: {
      id: "modality-precision",
      name: METRIC_NAMES["modality-precision"],
      value,
      detail: null,
      n: declines.length,
      perEngine: [{ engine: describeEngineId(engine), value, n: declines.length, detail: null }],
      comparator: null,
      gloss:
        correctlyDeclined + " of " + declines.length + " non-decisions were correctly left out of the graph; " +
        wronglyPromoted.length + " became nodes anyway.",
      honestNote:
        "This is a PRECISION over declines, not a recall over hypotheticals: the denominator is the statements the corpus " +
        "marks as must-not-become-nodes, so a system that declines nothing scores 0 rather than undefined. n=" +
        declines.length + ", concentrated in the adversarial tier, which is small enough that one violation moves the number " +
        "by several points — the per-tier breakdown is printed beside it for that reason. No comparator exists because no " +
        "surveyed extractor operates on a corpus where speculation outnumbers decisions; the absence is a property of the " +
        "literature, not a gap in this measurement.",
    },
  };
}

function tierOf(corpus: ResolvedCorpus, label: ResolvedDecision): string {
  for (const transcript of corpus.transcripts) {
    if (transcript.decisions.some((candidate) => candidate === label)) return transcript.tier;
  }
  return "unknown";
}
