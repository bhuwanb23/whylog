/**
 * Groundedness — 3.8.
 *
 * Phase 3 · sub-phase 3.8
 * Plan: plan/phase-3-retrieval.md §3.8
 *
 * ---------------------------------------------------------------------------
 * ONE NUMBER, COMPUTED NOT ASSERTED
 *
 *     groundedness = |claims with >= 1 resolving citation| / |total claims|
 *
 * Not "how good was the retrieval", not a mean of scores, not the model's own opinion of its
 * answer. It is a count of claims that point at something the log actually contains, over a
 * count of claims made. Anyone can recompute it from the answer alone, which is the point:
 * the number has to survive being checked by someone who does not trust the system.
 *
 * ---------------------------------------------------------------------------
 * THE ZERO-CLAIM CASE IS THE ONE THAT MATTERS
 *
 * 0 / 0 is not 1. An answer with no claims must NOT report GROUNDED by vacuous truth — a
 * system that scores an empty answer as perfectly grounded has made "say nothing" the
 * optimal strategy, and a model that learns that stops answering. Zero claims is
 * INSUFFICIENT_EVIDENCE, always, with the assessment saying so in words.
 *
 * ---------------------------------------------------------------------------
 * THRESHOLDS ARE WIDE ON PURPOSE
 *
 *   >= 0.95            GROUNDED
 *   0.50 .. 0.95       PARTIAL
 *   <  0.50            INSUFFICIENT_EVIDENCE
 *
 * GROUNDED requires near-totality, not a majority. One ungrounded claim in six is enough to
 * make an answer PARTIAL, because the user cannot tell WHICH claim was the invented one —
 * a 5-in-6 accurate answer with no marking is worse than useless, since the reader has to
 * re-verify everything to find the one bad claim. PARTIAL exists so the answer can say
 * "this part I know and this part I inferred", and `ungroundedNotes` names the part.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { Claim, GroundednessVerdict } from "@/types/retrieval";

/** At or above this, every claim resolves. */
export const GROUNDED_FLOOR = 0.95;
/** At or above this, enough resolves to answer with the gaps marked. */
export const PARTIAL_FLOOR = 0.5;

export interface Groundedness {
  readonly score: number;
  readonly verdict: GroundednessVerdict;
  readonly totalClaims: number;
  readonly groundedClaims: number;
  /** One note per ungrounded claim, naming it. Present exactly when verdict !== GROUNDED. */
  readonly notes: readonly string[];
  readonly assessment: string;
}

/**
 * Score a set of claims.
 *
 * `resolving` is the set of decision ids whose citations actually resolved IN THIS RUN — not
 * the set of decisions that exist. A claim citing a decision the log contains but this
 * retrieval never surfaced is not grounded, because nothing in this run checked that the
 * citation supports the claim. See `evidence-contract.ts` for the resolution rule.
 */
export function groundednessOf(
  claims: readonly Claim[],
  resolving: ReadonlySet<DecisionId>,
): Groundedness {
  if (claims.length === 0) {
    return {
      score: 0,
      verdict: "INSUFFICIENT_EVIDENCE",
      totalClaims: 0,
      groundedClaims: 0,
      notes: ["The answer makes no claims at all, so there is nothing to ground."],
      assessment:
        "No claims were made. 0/0 is not treated as perfectly grounded — that would make " +
        "\"say nothing\" the optimal answer, and an empty answer reported as GROUNDED is the " +
        "single most misleading thing this layer could produce.",
    };
  }

  const notes: string[] = [];
  let grounded = 0;

  for (const [index, claim] of claims.entries()) {
    /* A claim is grounded iff at least one of ITS citations resolved. Not "at least one
     * citation in the answer resolved" — grounding is per claim, because the reader
     * consumes claims one at a time. */
    const resolves = claim.citations.some((id) => resolving.has(id));

    if (resolves && claim.citations.length > 0) {
      grounded += 1;
      continue;
    }

    const why =
      claim.citations.length === 0
        ? "it cites nothing"
        : "it cites " +
          claim.citations.join(", ") +
          ", none of which resolved to a decision retrieved in this run";

    notes.push("Claim " + (index + 1) + ' — "' + truncate(claim.text) + '" — is not grounded because ' + why + ".");
  }

  const score = grounded / claims.length;
  const verdict = verdictFor(score);

  return {
    score,
    verdict,
    totalClaims: claims.length,
    groundedClaims: grounded,
    notes,
    assessment: assess(verdict, grounded, claims.length, score),
  };
}

export function verdictFor(score: number): GroundednessVerdict {
  if (score >= GROUNDED_FLOOR) return "GROUNDED";
  if (score >= PARTIAL_FLOOR) return "PARTIAL";
  return "INSUFFICIENT_EVIDENCE";
}

function assess(
  verdict: GroundednessVerdict,
  grounded: number,
  total: number,
  score: number,
): string {
  const fraction = grounded + "/" + total + " claims (" + (score * 100).toFixed(0) + "%)";

  switch (verdict) {
    case "GROUNDED":
      return fraction + " resolve to decisions retrieved in this run. Every claim in this answer points at something the log contains.";
    case "PARTIAL":
      return (
        fraction +
        " resolve. The rest is inferred from the retrieved material rather than stated by it, and is marked below — read the marked claims as a hypothesis, not as a record."
      );
    case "INSUFFICIENT_EVIDENCE":
      return (
        fraction +
        " resolve, which is below the " +
        (PARTIAL_FLOOR * 100).toFixed(0) +
        "% floor for answering at all. The honest response is to refuse, say what is missing, and offer the nearest related decisions — not to answer confidently from a thin retrieval."
      );
  }
}

export function describeVerdict(verdict: GroundednessVerdict): string {
  switch (verdict) {
    case "GROUNDED":
      return "GROUNDED (>= " + (GROUNDED_FLOOR * 100).toFixed(0) + "%) — every claim maps to at least one retrieved decision and all citations resolve.";
    case "PARTIAL":
      return (
        "PARTIAL (" + (PARTIAL_FLOOR * 100).toFixed(0) + "-" + (GROUNDED_FLOOR * 100).toFixed(0) +
        "%) — some claims grounded, some inferred. The inferred part is marked, because a reader cannot tell which claim was invented unless the answer says."
      );
    case "INSUFFICIENT_EVIDENCE":
      return (
        "INSUFFICIENT_EVIDENCE (< " + (PARTIAL_FLOOR * 100).toFixed(0) +
        "%) — refuse, state what is missing, then offer the nearest related decisions. \"I don\'t know\" is a first-class answer here, not a failure mode."
      );
  }
}

/** The thresholds, printed. The health panel shows these because a threshold nobody can see
 *  is a threshold nobody can argue with. */
export function describeThresholds(): string {
  return [
    "Groundedness = |claims with >= 1 resolving citation| / |total claims|.",
    "",
    "  >= " + GROUNDED_FLOOR + "        GROUNDED",
    "  " + PARTIAL_FLOOR + " .. " + GROUNDED_FLOOR + "    PARTIAL   (inferred claims are marked by name)",
    "  <  " + PARTIAL_FLOOR + "        INSUFFICIENT_EVIDENCE   (refuse, then offer nearest related)",
    "",
    "Zero claims is INSUFFICIENT_EVIDENCE, never GROUNDED: 0/0 is not 1.",
    "A claim is grounded iff at least one of ITS OWN citations resolved in this run.",
    "Resolution is against what this run retrieved, not against what the log contains.",
  ].join("\n");
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 70 ? flat : flat.slice(0, 67) + "...";
}
