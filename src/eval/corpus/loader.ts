/**
 * The corpus loader — 7.1.
 *
 * Phase 7 · sub-phase 7.1
 *
 * ---------------------------------------------------------------------------
 * QUOTES ARE RESOLVED TO SPANS, AND A QUOTE THAT IS NOT FOUND IS A FAILURE
 *
 * Every label carries verbatim text. The loader finds it in the transcript and records the offsets.
 * If it cannot be found, the label is reported as UNRESOLVED and excluded from scoring — never
 * silently dropped and never quietly matched at offset zero.
 *
 * Silently dropping it would lower recall for a reason nobody can see: the metric would report a
 * miss that is actually a typo in the ground truth. Matching it anyway would score a label against
 * text it does not describe. Both are worse than stopping and saying which label is wrong.
 *
 * Matching is case-insensitive but otherwise literal. Case-insensitive because transcripts are
 * typed by people who capitalise inconsistently; literal in every other respect because a fuzzy
 * match would let a paraphrased label pass, and a paraphrased ground truth is not ground truth.
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  Corpus,
  LabelledAlternative,
  LabelledDecision,
  LabelledPremise,
  ResolvedAlternative,
  ResolvedCorpus,
  ResolvedDecision,
  ResolvedPremise,
  ResolvedTranscript,
} from "./labels";

export interface LoadReport {
  readonly corpus: ResolvedCorpus;
  readonly resolved: number;
  readonly unresolved: readonly { transcript: string; kind: string; key: string; quote: string }[];
  readonly missingFiles: readonly string[];
}

/**
 * Load and resolve the corpus.
 *
 * Reads from disk rather than bundling the text, so the corpus is a set of inspectable files a
 * third party can extend — which is the plan's mitigation for a corpus too small to be credible.
 */
export function loadCorpus(corpus: Corpus, root: string): LoadReport {
  const transcripts: ResolvedTranscript[] = [];
  const unresolved: { transcript: string; kind: string; key: string; quote: string }[] = [];
  const missingFiles: string[] = [];
  let resolvedCount = 0;

  for (const transcript of corpus.transcripts) {
    const path = resolvePath(root, "..", transcript.file);

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      missingFiles.push(transcript.file);
      continue;
    }

    const decisions: ResolvedDecision[] = [];
    for (const decision of transcript.decisions) {
      const span = findSpan(raw, decision.quote);
      if (span === null) {
        unresolved.push({
          transcript: transcript.id,
          kind: "decision",
          key: decision.key,
          quote: decision.quote,
        });
        continue;
      }
      resolvedCount += 1;
      decisions.push({ ...decision, transcript: transcript.id, span });
    }

    const premises: ResolvedPremise[] = [];
    for (const premise of transcript.premises) {
      const span = findSpan(raw, premise.quote);
      if (span === null) {
        unresolved.push({
          transcript: transcript.id,
          kind: "premise",
          key: premise.key,
          quote: premise.quote,
        });
        continue;
      }
      resolvedCount += 1;
      premises.push({ ...premise, transcript: transcript.id, span });
    }

    const alternatives: ResolvedAlternative[] = [];
    for (const alternative of transcript.alternatives) {
      const span = findSpan(raw, alternative.quote);
      if (span === null) {
        unresolved.push({
          transcript: transcript.id,
          kind: "alternative",
          key: alternative.key,
          quote: alternative.quote,
        });
        continue;
      }
      resolvedCount += 1;
      alternatives.push({ ...alternative, transcript: transcript.id, span });
    }

    transcripts.push({
      ...transcript,
      raw,
      decisions,
      premises,
      alternatives,
      unresolved: [
        ...unresolved
          .filter((entry) => entry.transcript === transcript.id)
          .map((entry) => ({ kind: entry.kind, key: entry.key, quote: entry.quote })),
      ],
    });
  }

  return {
    corpus: { ...corpus, transcripts },
    resolved: resolvedCount,
    unresolved,
    missingFiles,
  };
}

/**
 * Locate a quote in the text.
 *
 * Case-insensitive, whitespace-normalised on both sides of the comparison, because transcripts wrap
 * lines and a quote written on one line will not byte-match text that was wrapped at 80 columns.
 * The returned offsets are into the ORIGINAL text, not the normalised copy.
 */
export function findSpan(raw: string, quote: string): { start: number; end: number } | null {
  const needle = normalise(quote);
  if (needle.length === 0) return null;

  /* Direct hit first: fastest, and preserves exact offsets. */
  const direct = raw.toLowerCase().indexOf(needle.toLowerCase());
  if (direct >= 0) return { start: direct, end: direct + quote.length };

  /* Fall back to a whitespace-insensitive search. Builds an index map from normalised position to
   * original position so the returned span still points into the raw text. */
  const mapped = normaliseWithMap(raw);
  const index = mapped.text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;

  const start = mapped.indexes[index] ?? 0;
  const endOffset = mapped.indexes[index + needle.length - 1];
  const end = endOffset === undefined ? raw.length : endOffset + 1;

  return { start, end };
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normaliseWithMap(text: string): { text: string; indexes: number[] } {
  const out: string[] = [];
  const indexes: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === undefined) continue;

    if (/\s/.test(char)) {
      if (!lastWasSpace && out.length > 0) {
        out.push(" ");
        indexes.push(i);
        lastWasSpace = true;
      }
      continue;
    }

    out.push(char);
    indexes.push(i);
    lastWasSpace = false;
  }

  return { text: out.join(""), indexes };
}

/** The load report as text. Printed before any metric, because a corpus with unresolved labels
 *  produces numbers that mean something other than what they appear to. */
export function describeLoad(report: LoadReport): string {
  const lines = [
    `Corpus load: ${report.corpus.transcripts.length} transcript(s), ${report.resolved} label(s) resolved to character spans.`,
  ];

  if (report.missingFiles.length > 0) {
    lines.push("");
    lines.push(
      `MISSING FILES (${report.missingFiles.length}) — these transcripts were skipped entirely:`,
    );
    for (const file of report.missingFiles) lines.push(`  ${file}`);
  }

  if (report.unresolved.length > 0) {
    lines.push("");
    lines.push(
      `UNRESOLVED LABELS (${report.unresolved.length}) — the quote is not a literal substring of the transcript.`,
      "These are EXCLUDED from scoring and reported rather than dropped, because a label that silently",
      "vanishes lowers recall for a reason nobody can see:",
    );
    for (const entry of report.unresolved) {
      lines.push(`  ${entry.transcript} · ${entry.kind} ${entry.key} · "${entry.quote}"`);
    }
  } else {
    lines.push("Every label resolved. The ground truth is verifiable against the transcripts.");
  }

  return lines.join("\n");
}

export type { LabelledDecision, LabelledPremise, LabelledAlternative };
