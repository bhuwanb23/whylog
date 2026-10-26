/**
 * Negation and scope — 3.6.
 *
 * Phase 3 · sub-phase 3.6
 * Plan: plan/phase-3-retrieval.md §3.6
 * Docs: docs/03-retrieval-and-contradiction.md §4.4
 *
 * ---------------------------------------------------------------------------
 * WHY NEGATION NEEDS A SCOPE WINDOW
 *
 * A negation cue anywhere in a sentence does not negate the whole sentence.
 *
 *   "we chose SQLite because there is NO server to run"
 *
 * contains "no", and the decision is POSITIVE. Reading "no" as negating "chose SQLite"
 * would invert the polarity of the single clearest decision statement in the fixture. The
 * cue negates "server", six tokens away from the verb, inside a rationale clause.
 *
 * So polarity is determined by what falls inside a **<=6-token scope window** around the
 * cue, and by whether that window contains the decision's VALUE. A negation whose scope
 * does not reach the value is not a negation of the decision.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE DOES NOT REIMPLEMENT IT
 *
 * `ai/local/negation.ts` already has the cue inventory, the scope window, verb-pattern
 * polarity and the polarity evidence type — built in Phase 1 because extraction needs it to
 * decide modality. Reimplementing it here would create two notions of polarity that could
 * disagree, and a classifier whose polarity disagrees with the extractor's would flag a
 * decision as contradicting itself.
 *
 * What this file adds is the part retrieval needs and extraction did not: **scope relative
 * to a value**, and the shared vocabulary the classifier and gate (b) both consume.
 * ---------------------------------------------------------------------------
 */

import {
  NEGATION_SCOPE_TOKENS,
  type PolarityEvidence,
  isNegation,
  negationScope,
  polarityOf,
} from "@/ai/local/negation";
import { foldKey } from "@/ontology/canonicalize";

/** How far a negation cue reaches. Re-exported so the classifier and the UI quote the same
 *  number rather than each hardcoding one. */
export { NEGATION_SCOPE_TOKENS, isNegation, polarityOf };
export type { PolarityEvidence };

/**
 * Does a negation cue's scope actually reach this value?
 *
 * The question that decides polarity. "no server to run" does not reach "sqlite";
 * "not sqlite, use postgres" does.
 */
export function negationReachesValue(text: string, value: string): NegationScopeVerdict {
  const foldedText = text.toLowerCase();
  const foldedValue = foldKey(value);

  if (foldedValue.length === 0)
    return { negated: false, cue: null, window: [], reason: "no value to check" };

  const valueAt = foldedText.indexOf(foldedValue);
  if (valueAt < 0) {
    return {
      negated: false,
      cue: null,
      window: [],
      reason: "the value does not appear in this text, so nothing here can negate it",
    };
  }

  /* Look backwards from the value for a cue within the scope window. A cue AFTER the value
   * ("sqlite, which is not what we want") is a different construction and is handled by the
   * verb-pattern polarity in ai/local/negation.ts, not here. */
  const before = foldedText.slice(Math.max(0, valueAt - 60), valueAt);
  const tokens = before.split(/\s+/).filter((token) => token.length > 0);
  const window = tokens.slice(-NEGATION_SCOPE_TOKENS);

  for (let index = window.length - 1; index >= 0; index -= 1) {
    const token = window[index];
    if (token === undefined) continue;
    if (!isNegation(token.replace(/[^a-z']/g, ""))) continue;

    /* An intervening conjunction resets the scope: "no server, so we chose sqlite" has a
     * cue whose scope ends at "so". Without this, every rationale clause beginning with a
     * negative fact would invert the decision it explains. */
    const between = window.slice(index + 1);
    if (between.some((token) => RESETTING_CONJUNCTIONS.has(token.replace(/[^a-z]/g, "")))) {
      return {
        negated: false,
        cue: token,
        window,
        reason:
          "a negation cue appears before the value but a conjunction resets its scope before it reaches it",
      };
    }

    return {
      negated: true,
      cue: token,
      window,
      reason:
        "a negation cue falls within " +
        NEGATION_SCOPE_TOKENS +
        " tokens before the value, with nothing resetting its scope",
    };
  }

  return {
    negated: false,
    cue: null,
    window,
    reason: "no negation cue within " + NEGATION_SCOPE_TOKENS + " tokens of the value",
  };
}

export interface NegationScopeVerdict {
  readonly negated: boolean;
  readonly cue: string | null;
  readonly window: readonly string[];
  /** Always populated. A polarity decision with no stated reason cannot be audited, and
   *  polarity is the one judgement in this pipeline where being wrong is invisible. */
  readonly reason: string;
}

const RESETTING_CONJUNCTIONS: ReadonlySet<string> = new Set([
  "so",
  "therefore",
  "thus",
  "hence",
  "because",
  "since",
  "but",
  "and",
  "which",
  "that",
]);

/** Negation in a pair of statements, checked both ways. */
export function negationBetween(
  statementA: string,
  statementB: string,
  value: string,
): NegationScopeVerdict {
  const a = negationReachesValue(statementA, value);
  if (a.negated) return a;
  return negationReachesValue(statementB, value);
}

/** The scope window as text, for the UI: a user checking a polarity call needs to see the
 *  tokens the decision was made over, not just the verdict. */
export function describeScope(verdict: NegationScopeVerdict): string {
  const window = verdict.window.length === 0 ? "(empty)" : verdict.window.join(" ");
  return (
    (verdict.negated ? "NEGATED" : "not negated") +
    " — scope window: [" +
    window +
    "] — " +
    verdict.reason
  );
}

/** Re-exported for the classifier: `negationScope` needs a CueHit, which retrieval does not
 *  have, so this is the token-level predicate used directly. */
export { negationScope };
