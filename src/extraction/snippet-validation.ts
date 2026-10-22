/**
 * Snippet validation — 1.6's hard rule.
 *
 * Phase 1 · sub-phase 1.6
 * Plan: plan/phase-1-extraction-pipeline.md §1.6, §1.10
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * **Any snippet an engine returns that is not a LITERAL substring of the input is
 * downgraded, and its span is dropped.**
 *
 * This is the single most important check on the LLM path, and it is cheap. A
 * model that is asked to quote will usually quote — and will occasionally
 * paraphrase, tidy punctuation, fix a typo, or compose a sentence that reads like
 * the transcript but was never in it. Every one of those produces a citation that
 * looks perfect and resolves to nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY DOWNRADE RATHER THAN DISCARD
 *
 * The STRUCTURE of an extraction can be right while its quotation is wrong: the
 * model correctly saw that SQLite was chosen over Postgres and then wrote the
 * evidence in its own words. Discarding the item loses a true decision; keeping it
 * at full confidence loses the evidence contract.
 *
 * Downgrading to the LOW tier does neither. The item survives, collapsed, with no
 * resolvable span — so the review UI shows it as "unverifiable quote" and the user
 * decides. And an engine that paraphrases everything produces an entirely
 * collapsed queue, which is a visible, self-diagnosing failure rather than a
 * silent one.
 *
 * ---------------------------------------------------------------------------
 * THE LOCAL PATH CANNOT FAIL THIS CHECK
 *
 * Its spans come from the offset map by construction. The check still runs, because
 * a check that only applies to one engine is a check that will be skipped by the
 * next one — and because it costs one `indexOf` per item.
 * ---------------------------------------------------------------------------
 */

import type { Confidence, SourceSpan, TranscriptId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type {
  AlternativeCandidate,
  DecisionCandidate,
  DiscardedCandidate,
  ExtractionResult,
  PremiseCandidate,
} from "@/ai/types";
import { isLiteralSubstring } from "@/lib/text";
import { locateSnippet } from "./offset-map";

/** The confidence a failed validation is reduced TO, not by. A flat floor rather
 *  than a multiplier: the item's structure may be excellent and its quote useless,
 *  and multiplying would keep a high-scoring item in the medium tier where it looks
 *  trustworthy. */
export const FAILED_VALIDATION_CONFIDENCE: Confidence = asConfidence(0.2);

export interface SnippetVerdict {
  readonly ok: boolean;
  /** The resolved span, when the snippet was located. Null means the item has no
   *  evidence to show, which the review UI states rather than hides. */
  readonly span: SourceSpan | null;
  readonly reason: SnippetFailure | null;
}

export type SnippetFailure =
  | "not-a-substring"
  | "empty"
  | "too-long"
  | "ambiguous";

/** A snippet longer than this is a paragraph, not a quote. Models that dump a whole
 *  turn as a "snippet" produce citations that highlight everything and therefore
 *  nothing. */
export const MAX_SNIPPET_CHARS = 600;

/* -------------------------------------------------------------------------- */
/* One snippet                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Validate one snippet and resolve it to a raw span.
 *
 * @param transcriptId the transcript the snippet claims to come from
 * @param raw          the VERBATIM input
 * @param snippet      what the engine returned
 * @param hint         where to look first, when known. The same sentence can appear
 *                     twice in a long transcript and the hint is what
 *                     disambiguates it; without one, the first occurrence wins.
 */
export function validateSnippet(
  transcriptId: TranscriptId,
  raw: string,
  snippet: SourceSpan | null | undefined,
  hint?: { readonly start: number; readonly end: number },
): SnippetVerdict {
  if (snippet === null || snippet === undefined) {
    return { ok: false, span: null, reason: "empty" };
  }

  const text = snippet.text;
  if (text.trim().length === 0) {
    return { ok: false, span: null, reason: "empty" };
  }
  if (text.length > MAX_SNIPPET_CHARS) {
    return { ok: false, span: null, reason: "too-long" };
  }

  if (!isLiteralSubstring(text, raw)) {
    return { ok: false, span: null, reason: "not-a-substring" };
  }

  // The engine may also have supplied offsets. Trust them only if they agree with
  // the text — an offset that disagrees with its own quote is wrong, and the quote
  // is the thing the user will read.
  if (snippet.start >= 0 && snippet.end > snippet.start && raw.slice(snippet.start, snippet.end) === text) {
    return { ok: true, span: snippet, reason: null };
  }

  const located = locateSnippet(transcriptId, raw, text, hint);
  if (located === null) {
    return { ok: false, span: null, reason: "ambiguous" };
  }
  return { ok: true, span: located, reason: null };
}

/* -------------------------------------------------------------------------- */
/* A whole result                                                             */
/* -------------------------------------------------------------------------- */

export interface ValidationReport {
  readonly checked: number;
  readonly passed: number;
  readonly failed: number;
  readonly byReason: Readonly<Record<SnippetFailure, number>>;
  /** Mean confidence lost. Reported because an engine whose snippets fail 40% of
   *  the time is producing a review queue that is 40% collapsed, and the user
   *  deserves to be told why before they blame the extractor. */
  readonly confidenceLost: number;
}

export interface ValidatedExtraction {
  readonly result: ExtractionResult;
  readonly report: ValidationReport;
}

/**
 * Validate every snippet in an extraction result, in place.
 *
 * Items whose snippet fails keep their structure and lose their span and most of
 * their confidence. Nothing is removed here: removal is the review's job, and the
 * review is a human.
 */
export function validateExtraction(result: ExtractionResult, raw: string): ValidatedExtraction {
  const byReason: Record<SnippetFailure, number> = {
    "not-a-substring": 0,
    empty: 0,
    "too-long": 0,
    ambiguous: 0,
  };

  let checked = 0;
  let passed = 0;
  let confidenceLost = 0;

  const decisions = result.decisions.map((candidate) => {
    const verdict = validateSnippet(candidate.snippet.transcriptId, raw, candidate.snippet);
    checked += 1;
    if (verdict.ok && verdict.span !== null) {
      passed += 1;
      return { ...candidate, snippet: verdict.span };
    }
    if (verdict.reason !== null) byReason[verdict.reason] += 1;
    confidenceLost += candidate.confidence - FAILED_VALIDATION_CONFIDENCE;
    return downgradeDecision(candidate);
  });

  const premises = result.premises.map((candidate) => {
    const verdict = validateSnippet(candidate.snippet.transcriptId, raw, candidate.snippet);
    checked += 1;
    if (verdict.ok && verdict.span !== null) {
      passed += 1;
      return { ...candidate, snippet: verdict.span };
    }
    if (verdict.reason !== null) byReason[verdict.reason] += 1;
    confidenceLost += candidate.confidence - FAILED_VALIDATION_CONFIDENCE;
    return downgradePremise(candidate);
  });

  const alternatives = result.alternatives.map((candidate) => {
    const verdict = validateSnippet(candidate.snippet.transcriptId, raw, candidate.snippet);
    checked += 1;
    if (verdict.ok && verdict.span !== null) {
      passed += 1;
      return { ...candidate, snippet: verdict.span };
    }
    if (verdict.reason !== null) byReason[verdict.reason] += 1;
    confidenceLost += candidate.confidence - FAILED_VALIDATION_CONFIDENCE;
    return downgradeAlternative(candidate);
  });

  return {
    result: { ...result, decisions, premises, alternatives },
    report: {
      checked,
      passed,
      failed: checked - passed,
      byReason,
      confidenceLost: Math.round(confidenceLost * 100) / 100,
    },
  };
}

/**
 * A downgraded decision keeps everything except its span and its confidence.
 *
 * The snippet is replaced by an EMPTY span rather than removed, because
 * `SourceSpan` is not optional on `DecisionCandidate` and making it optional would
 * push a null check into every consumer. An empty span with `start === end` is
 * unambiguous: `SnippetHighlight` renders nothing and says why.
 */
function downgradeDecision(candidate: DecisionCandidate): DecisionCandidate {
  return {
    ...candidate,
    confidence: FAILED_VALIDATION_CONFIDENCE,
    snippet: emptySpan(candidate.snippet.transcriptId),
  };
}

function downgradePremise(candidate: PremiseCandidate): PremiseCandidate {
  return {
    ...candidate,
    confidence: FAILED_VALIDATION_CONFIDENCE,
    snippet: emptySpan(candidate.snippet.transcriptId),
    // A premise whose evidence cannot be shown must be reviewed. It already is —
    // `needsReview` is true for every premise in Phase 1 — but the flag is set
    // here too so that loosening the threshold later does not silently admit
    // unverifiable premises.
    needsReview: true,
  };
}

function downgradeAlternative(candidate: AlternativeCandidate): AlternativeCandidate {
  return {
    ...candidate,
    confidence: FAILED_VALIDATION_CONFIDENCE,
    snippet: emptySpan(candidate.snippet.transcriptId),
  };
}

function emptySpan(transcriptId: TranscriptId): SourceSpan {
  return { transcriptId, start: 0, end: 0, text: "" };
}

/** Is this span empty, i.e. did its item fail validation? */
export function isUnverified(span: SourceSpan): boolean {
  return span.end <= span.start || span.text.length === 0;
}

/* -------------------------------------------------------------------------- */
/* Discards                                                                   */
/* -------------------------------------------------------------------------- */

/** Failed validations become discards too, so the precision denominator counts
 *  them. An item that was extracted and then unverifiable is still an item the
 *  extractor produced. */
export function discardsFromFailures(
  result: ExtractionResult,
  report: ValidationReport,
): readonly DiscardedCandidate[] {
  if (report.failed === 0) return [];

  const out: DiscardedCandidate[] = [];
  for (const candidate of result.decisions) {
    if (isUnverified(candidate.snippet)) {
      out.push({
        kind: "decision",
        discardedBy: "confidence-threshold",
        rawText: candidate.statement,
        confidence: candidate.confidence,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export const FAILURE_EXPLANATIONS: Readonly<Record<SnippetFailure, string>> = {
  "not-a-substring":
    "the engine returned text that does not appear in the transcript — a paraphrase, not a quote",
  empty: "the engine returned no snippet at all",
  "too-long": `the snippet exceeded ${MAX_SNIPPET_CHARS} characters, which is a paragraph rather than a citation`,
  ambiguous: "the snippet appears in the transcript but could not be located to a single range",
};

export function describeValidation(report: ValidationReport): string {
  if (report.checked === 0) return "no snippets to validate";
  if (report.failed === 0) {
    return `all ${report.checked} snippets resolve to verbatim transcript text`;
  }

  const reasons = (Object.keys(report.byReason) as SnippetFailure[])
    .filter((reason) => (report.byReason[reason] ?? 0) > 0)
    .map((reason) => `${report.byReason[reason]} ${reason.replace(/-/g, " ")}`);

  return [
    `${report.passed} of ${report.checked} snippets resolve verbatim`,
    `${report.failed} failed (${reasons.join(", ")})`,
    "those items keep their structure, lose their span, and drop to the collapsed tier",
  ].join(" — ");
}
