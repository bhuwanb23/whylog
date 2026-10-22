/**
 * Decision cue phrases.
 *
 * Phase 1 · sub-phase 1.3 (data authored here in Phase 0.7)
 * Plan: plan/phase-1-extraction-pipeline.md §1.3
 *
 * ---------------------------------------------------------------------------
 * WHY CUES AND NOT JUST AN LLM
 *
 * The local engine is the DEFAULT, not the fallback. Without a cue table it has
 * no way to find a decision in prose at all, and "works with no API key" becomes
 * a claim rather than a behaviour.
 *
 * Cues also serve the LLM path: they mark EPISODE BOUNDARIES. A decision is
 * negotiated across several turns, and the cue is where the negotiation lands —
 * segmenting on cues rather than sentences is the deliberate deviation from
 * arXiv:2506.11005, whose single-sentence assumption holds for commit messages
 * and not for dialogue (plan/phase-1 §1.2).
 *
 * ---------------------------------------------------------------------------
 * POLARITY IS THE HARD PART
 *
 * A cue tells you a decision is present. It does not tell you which way it
 * points. "instead of Postgres" mentions Postgres and REJECTS it; "going with
 * Postgres" mentions Postgres and ACCEPTS it. Rationale Miner found negation
 * explicit in only 12% of rationale sentences, so polarity has to come from the
 * cue's own direction as often as from a negation word.
 *
 * Hence `direction`:
 *   accept  — the following value is CHOSEN
 *   reject  — the following value is REFUSED (feeds RejectedAlternative)
 *   pivot   — "X instead of Y": accepts X, rejects Y
 *   neutral — a decision is present, direction comes from elsewhere
 * ---------------------------------------------------------------------------
 */

export type CueDirection = "accept" | "reject" | "pivot" | "neutral";

export interface DecisionCue {
  readonly phrase: string;
  readonly direction: CueDirection;
  /** 0..1. How reliably this phrase marks a real decision rather than a passing
   *  mention. Feeds the additive confidence score (plan/phase-1 §1.8). */
  readonly weight: number;
  /** When true the phrase usually introduces the value IMMEDIATELY after it.
   *  When false, the value is usually BEFORE it ("sqlite it is"). */
  readonly valueAfter: boolean;
  /** Tense/mood marker: a cue in this set is a candidate for `hypothetical` or
   *  `proposed` modality rather than `asserted`. ONLY asserted modality creates
   *  an IN-labelled node, so this field is doing real work. */
  readonly speculative: boolean;
}

export const DECISION_CUES: readonly DecisionCue[] = [
  /* ---- committed, past tense: the strongest signals ---- */
  { phrase: "decided to", direction: "accept", weight: 0.95, valueAfter: true, speculative: false },
  { phrase: "decided on", direction: "accept", weight: 0.95, valueAfter: true, speculative: false },
  { phrase: "decided against", direction: "reject", weight: 0.95, valueAfter: true, speculative: false },
  { phrase: "we decided", direction: "accept", weight: 0.95, valueAfter: true, speculative: false },
  { phrase: "i decided", direction: "accept", weight: 0.95, valueAfter: true, speculative: false },
  { phrase: "decision:", direction: "accept", weight: 0.98, valueAfter: true, speculative: false },
  { phrase: "went with", direction: "accept", weight: 0.93, valueAfter: true, speculative: false },
  { phrase: "gone with", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "going with", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "go with", direction: "accept", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "chose", direction: "accept", weight: 0.93, valueAfter: true, speculative: false },
  { phrase: "chosen", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "picking", direction: "accept", weight: 0.82, valueAfter: true, speculative: false },
  { phrase: "picked", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "settled on", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "opted for", direction: "accept", weight: 0.88, valueAfter: true, speculative: false },
  { phrase: "sticking with", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "committed to", direction: "accept", weight: 0.88, valueAfter: true, speculative: false },
  { phrase: "locked in", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "final call", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },

  /* ---- migration: accepts the target, rejects the source ---- */
  { phrase: "switch to", direction: "pivot", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "switched to", direction: "pivot", weight: 0.93, valueAfter: true, speculative: false },
  { phrase: "switching to", direction: "pivot", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "moved to", direction: "pivot", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "moving to", direction: "pivot", weight: 0.87, valueAfter: true, speculative: false },
  { phrase: "migrate to", direction: "pivot", weight: 0.88, valueAfter: true, speculative: false },
  { phrase: "migrated to", direction: "pivot", weight: 0.92, valueAfter: true, speculative: false },
  { phrase: "replaced", direction: "pivot", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "swapped", direction: "pivot", weight: 0.83, valueAfter: true, speculative: false },
  { phrase: "dropped", direction: "reject", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "removed", direction: "reject", weight: 0.7, valueAfter: true, speculative: false },
  { phrase: "ditched", direction: "reject", weight: 0.82, valueAfter: true, speculative: false },

  /* ---- explicit rejection: the alternative-mining cues ---- */
  { phrase: "instead of", direction: "pivot", weight: 0.92, valueAfter: false, speculative: false },
  { phrase: "rather than", direction: "pivot", weight: 0.92, valueAfter: false, speculative: false },
  { phrase: "not using", direction: "reject", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "don't use", direction: "reject", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "dont use", direction: "reject", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "do not use", direction: "reject", weight: 0.92, valueAfter: true, speculative: false },
  { phrase: "avoid", direction: "reject", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "avoiding", direction: "reject", weight: 0.78, valueAfter: true, speculative: false },
  { phrase: "ruled out", direction: "reject", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "rejected", direction: "reject", weight: 0.88, valueAfter: true, speculative: false },
  { phrase: "skip", direction: "reject", weight: 0.72, valueAfter: true, speculative: false },
  { phrase: "skipping", direction: "reject", weight: 0.74, valueAfter: true, speculative: false },
  { phrase: "no need for", direction: "reject", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "out of scope", direction: "reject", weight: 0.78, valueAfter: true, speculative: false },
  { phrase: "too heavy", direction: "reject", weight: 0.75, valueAfter: false, speculative: false },
  { phrase: "overkill", direction: "reject", weight: 0.8, valueAfter: false, speculative: false },

  /* ---- present tense, plain assertion ---- */
  { phrase: "we use", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "we're using", direction: "accept", weight: 0.88, valueAfter: true, speculative: false },
  { phrase: "using", direction: "accept", weight: 0.6, valueAfter: true, speculative: false },
  { phrase: "it's", direction: "neutral", weight: 0.4, valueAfter: true, speculative: false },
  { phrase: "the stack is", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "stack:", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "we'll use", direction: "accept", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "will use", direction: "accept", weight: 0.78, valueAfter: true, speculative: false },
  { phrase: "let's use", direction: "accept", weight: 0.82, valueAfter: true, speculative: false },
  { phrase: "lets use", direction: "accept", weight: 0.82, valueAfter: true, speculative: false },
  { phrase: "i'll go", direction: "accept", weight: 0.75, valueAfter: true, speculative: false },

  /* ---- speculative: must NOT create an IN-labelled node ---- */
  { phrase: "what if", direction: "neutral", weight: 0.35, valueAfter: true, speculative: true },
  { phrase: "should we", direction: "neutral", weight: 0.35, valueAfter: true, speculative: true },
  { phrase: "could we", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "we could", direction: "neutral", weight: 0.35, valueAfter: true, speculative: true },
  { phrase: "might be worth", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "consider", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "considering", direction: "neutral", weight: 0.32, valueAfter: true, speculative: true },
  { phrase: "thinking about", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "maybe", direction: "neutral", weight: 0.2, valueAfter: true, speculative: true },
  { phrase: "one option", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "an option", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },
  { phrase: "alternative", direction: "neutral", weight: 0.35, valueAfter: true, speculative: true },
  { phrase: "trade-off", direction: "neutral", weight: 0.4, valueAfter: true, speculative: true },
  { phrase: "tradeoff", direction: "neutral", weight: 0.4, valueAfter: true, speculative: true },
  { phrase: "downside", direction: "neutral", weight: 0.45, valueAfter: true, speculative: true },
  { phrase: "if we ever", direction: "neutral", weight: 0.3, valueAfter: true, speculative: true },

    /* ---- human acceptance of a proposal the agent has just made --------------
   *
   * The single most common way a decision is actually reached in a transcript: the
   * agent proposes, the human says one word. "deal. Vite + React + Tailwind instead
   * of Next." is a decision, and a table without acceptance words cannot see it.
   *
   * `valueAfter: false` because the VALUE IS USUALLY BEFORE the acceptance — the
   * human is agreeing to something already on the table. `decisions.ts:pickValue`
   * reads backward first for these and forward as a fallback, so either order
   * works; getting the flag wrong only changes which is tried first.
   *
   * Punctuation is part of the phrase. "deal." and "deal with it" are different
   * sentences, and matching the bare word would fire on the second one.
   * ------------------------------------------------------------------------ */
  { phrase: "deal.", direction: "accept", weight: 0.85, valueAfter: false, speculative: false },
  { phrase: "deal,", direction: "accept", weight: 0.85, valueAfter: false, speculative: false },
  { phrase: "fine,", direction: "accept", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "fine.", direction: "accept", weight: 0.75, valueAfter: false, speculative: false },
  { phrase: "agreed.", direction: "accept", weight: 0.85, valueAfter: false, speculative: false },
  { phrase: "noted:", direction: "accept", weight: 0.7, valueAfter: true, speculative: false },
  { phrase: "let's do that", direction: "accept", weight: 0.85, valueAfter: false, speculative: false },
  { phrase: "let's do it", direction: "accept", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "ship it", direction: "accept", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "sounds good", direction: "accept", weight: 0.65, valueAfter: false, speculative: false },

  /* ---- commitment in the future tense ------------------------------------
   *
   * "we'll do embeddings inline" is a decision stated in the only tense available
   * for something not yet built. The past-tense cues ("decided to", "went with")
   * cannot cover a conversation that is happening before the code exists, which is
   * to say they cannot cover most of one.
   * ------------------------------------------------------------------------ */
  { phrase: "we'll do", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "we'll keep", direction: "accept", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "we'll go with", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "i'll use", direction: "accept", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "we're going with", direction: "accept", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "we're dropping", direction: "reject", weight: 0.9, valueAfter: true, speculative: false },
  { phrase: "we're skipping", direction: "reject", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "let's go with", direction: "accept", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "let's drop", direction: "reject", weight: 0.85, valueAfter: true, speculative: false },
  { phrase: "let's skip", direction: "reject", weight: 0.8, valueAfter: true, speculative: false },

  /* ---- the agent's recommendation ---------------------------------------
   *
   * `speculative: true`, so `assertiveCues()` excludes them and the modality
   * detector cannot read an assertion into a conditional. "Then I'd use SQLite" is
   * a proposal — but it is a proposal a human accepts two turns later, and an
   * extraction that never saw it has nothing to attribute the acceptance to.
   * ------------------------------------------------------------------------ */
  { phrase: "i'd use", direction: "accept", weight: 0.75, valueAfter: true, speculative: true },
  { phrase: "i'd go with", direction: "accept", weight: 0.75, valueAfter: true, speculative: true },
  { phrase: "i would use", direction: "accept", weight: 0.7, valueAfter: true, speculative: true },
  { phrase: "i would go with", direction: "accept", weight: 0.7, valueAfter: true, speculative: true },
  { phrase: "my recommendation is", direction: "accept", weight: 0.8, valueAfter: true, speculative: true },
  { phrase: "i recommend", direction: "accept", weight: 0.75, valueAfter: true, speculative: true },

  /* ---- the conclusion of a Socratic exchange -----------------------------
   *
   * A large share of agent transcripts are the agent asking questions until the
   * answer decides something. "Then Next.js is buying you nothing" and "Then auth
   * is pure cost right now" are the decision, and neither contains a verb from the
   * committed-past-tense block above.
   *
   * `valueAfter: false`: what follows "then" is usually the ARGUMENT, and the value
   * was named in the question.
   * ------------------------------------------------------------------------ */
  { phrase: "then no ", direction: "reject", weight: 0.8, valueAfter: true, speculative: false },
  { phrase: "then we ", direction: "accept", weight: 0.6, valueAfter: false, speculative: true },
  { phrase: "is buying you nothing", direction: "reject", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "is pure cost", direction: "reject", weight: 0.85, valueAfter: false, speculative: false },
  { phrase: "pure overhead", direction: "reject", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "not worth it", direction: "reject", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "overkill for", direction: "reject", weight: 0.8, valueAfter: false, speculative: false },
  { phrase: "absurd for", direction: "reject", weight: 0.75, valueAfter: false, speculative: false },
  { phrase: "instead", direction: "pivot", weight: 0.6, valueAfter: false, speculative: false },

/* ---- rationale markers: not decisions, but they bound the episode ---- */
  { phrase: "because", direction: "neutral", weight: 0.5, valueAfter: true, speculative: false },
  { phrase: "since", direction: "neutral", weight: 0.4, valueAfter: true, speculative: false },
  { phrase: "the reason is", direction: "neutral", weight: 0.6, valueAfter: true, speculative: false },
  { phrase: "so that", direction: "neutral", weight: 0.45, valueAfter: true, speculative: false },
  { phrase: "in order to", direction: "neutral", weight: 0.45, valueAfter: true, speculative: false },
  { phrase: "given that", direction: "neutral", weight: 0.55, valueAfter: true, speculative: false },
  { phrase: "assuming", direction: "neutral", weight: 0.55, valueAfter: true, speculative: false },
  { phrase: "as long as", direction: "neutral", weight: 0.5, valueAfter: true, speculative: false },
  { phrase: "the catch is", direction: "neutral", weight: 0.55, valueAfter: true, speculative: false },
  { phrase: "accepting that", direction: "neutral", weight: 0.6, valueAfter: true, speculative: false },
];

/** Index by phrase for O(1) lookup during matching. */
export const DECISION_CUE_INDEX: ReadonlyMap<string, DecisionCue> = (() => {
  const map = new Map<string, DecisionCue>();
  for (const cue of DECISION_CUES) map.set(cue.phrase, cue);
  return map;
})();

/** Cues that can create an `asserted` modality node. Everything else produces
 *  `proposed`, `hypothetical` or `reported` and starts UNKNOWN. */
export function assertiveCues(): readonly DecisionCue[] {
  return DECISION_CUES.filter((c) => !c.speculative && c.weight >= 0.7);
}

export function speculativeCues(): readonly DecisionCue[] {
  return DECISION_CUES.filter((c) => c.speculative);
}

/** Rejection cues, in weight order — the alternative-mining vocabulary. ARGUS
 *  measured 15.4% precision on alternatives, so this list is deliberately short
 *  and high-weight: a false pre-emption is worse than none. */
export function rejectionCues(): readonly DecisionCue[] {
  return DECISION_CUES.filter((c) => c.direction === "reject").sort((a, b) => b.weight - a.weight);
}

/** Pivot cues: "X instead of Y". These yield BOTH an accepted value and a
 *  rejected alternative from one sentence, which is why they are worth their own
 *  direction rather than being folded into accept/reject. */
export function pivotCues(): readonly DecisionCue[] {
  return DECISION_CUES.filter((c) => c.direction === "pivot");
}

export function cueFor(phrase: string): DecisionCue | undefined {
  return DECISION_CUE_INDEX.get(phrase.toLowerCase().trim());
}
