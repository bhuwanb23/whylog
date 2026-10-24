/**
 * The ground-truth label schema — 7.1.
 *
 * Phase 7 · sub-phase 7.1
 * Plan: plan/phase-7-evaluation.md §7.1
 *
 * ---------------------------------------------------------------------------
 * LABEL FROM THE TRANSCRIPT, NOT FROM THE EXTRACTOR OUTPUT
 *
 * The plan names the bias risk directly: "you labelled what your extractor finds". The defence is
 * procedural and it is written into this schema — a label records what the TRANSCRIPT says, with the
 * character span it was read from, and the span is verifiable against the source text. A label that
 * cannot be pointed at in the transcript is not a label.
 *
 * That is why `quote` is required on every labelled item and is VERBATIM. The loader resolves each
 * quote to a character span by searching the raw transcript, and REJECTS the label if the quote is
 * not a literal substring. That is strictly stronger than a hand-typed offset: an offset can point
 * at the wrong characters and still look plausible, while a quote that is not in the text cannot be
 * resolved at all. It makes label-from-output structurally harder, because you cannot quote a
 * decision the transcript does not contain.
 *
 * It is also the same discipline Phase 1 imposes on LLM-extracted snippets, applied to the ground
 * truth. If the labels were held to a weaker standard than the extractor, the benchmark would be
 * measuring the extractor against something less rigorous than itself.
 *
 * ---------------------------------------------------------------------------
 * THE PLANTED CASES ARE FIRST-CLASS, NOT ANNOTATIONS
 *
 * `plants` declares what was deliberately put into each transcript and what a correct system should
 * do about it. Three contradiction levels, plus the five special cases. Each has an `expect` field
 * naming the outcome, so the harness asserts against a declared expectation rather than against
 * whatever the system happened to produce.
 *
 * This is the part nobody else has: a benchmark for decision-rationale extraction does not exist in
 * the literature, and the L2/L3 levels cannot be built at all without a system that stores premises.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable, PremiseType } from "@/types/domain";

export type CorpusTier = "clean" | "messy" | "adversarial";

/** A labelled decision, as the transcript states it. */
export interface LabelledDecision {
  /** Local to the transcript, e.g. "d1". Mapped to a WLD id by the harness. */
  readonly key: string;
  readonly variable: DecisionVariable;
  readonly value: string;
  readonly statement: string;
  /** asserted / hypothetical / conditional / reported / question. Only `asserted` should ever
   *  become a node — that is what modality precision measures. */
  readonly modality: "asserted" | "hypothetical" | "conditional" | "reported" | "question";
  /** positive or negative polarity, for the "not X" constructions. */
  readonly polarity: "positive" | "negative";
  readonly origin: "human_stated" | "human_override" | "agent_proposed" | "agent_inferred";
  /** VERBATIM text from the transcript. REQUIRED. The loader resolves it to a character span and
   *  rejects the label if it is not a literal substring — see the header. */
  readonly quote: string;
  /** The premises this decision rests on, by local key. */
  readonly restsOn: readonly string[];
  /** The conditions it excludes — the OUT-list. */
  readonly excludes: readonly string[];
  /** Should this become a decision node at all? False for hypotheticals and agent proposals the
   *  human never accepted. */
  readonly expectNode: boolean;
}

export interface LabelledPremise {
  readonly key: string;
  readonly type: PremiseType;
  readonly predicate: string;
  readonly value?: string | number | boolean;
  readonly text: string;
  /** VERBATIM text from the transcript. REQUIRED — see the header. */
  readonly quote: string;
  /** True when the transcript states it as a fact, false when it is only mentioned. */
  readonly expectInList: boolean;
}

export interface LabelledAlternative {
  readonly key: string;
  readonly value: string;
  readonly whyRejected: string | null;
  readonly rejectedBy: string;
  /** VERBATIM text from the transcript. REQUIRED — see the header. */
  readonly quote: string;
  /** Alternatives require explicit human confirmation before entering the pre-emption index, so a
   *  label records whether the transcript actually contains a rejection rather than a mention. */
  readonly expectConfirmed: boolean;
}

export interface LabelledEpisode {
  readonly index: number;
  readonly title: string;
  readonly firstLine: number;
  readonly lastLine: number;
}

/* -------------------------------------------------------------------------- */
/* Planted cases                                                              */
/* -------------------------------------------------------------------------- */

export type PlantLevel = "L1-pairwise" | "L2-premise" | "L3-cascade";

export type PlantKind =
  | PlantLevel
  | "circular-justification"
  | "M1-similar-decisions-contradictory-rationales"
  | "M2-contradictory-decisions-similar-rationales"
  | "duplicate-restatement"
  | "unanswerable-question";

/**
 * One deliberately planted case.
 *
 * `expect` is the outcome a correct system produces, stated before the run. The harness compares
 * against this, so a result is a pass or a fail rather than an observation.
 */
export interface Plant {
  readonly kind: PlantKind;
  readonly id: string;
  /** What was planted, in one sentence. */
  readonly description: string;
  /** The transcripts involved, by corpus id. */
  readonly transcripts: readonly string[];
  /** What a correct system does. */
  readonly expect: string;
  /** The node ids expected to flip, and the ones expected to survive. Both are asserted — a
   *  cascade that flips the right nodes and also flips a survivor is a FAILURE, and checking only
   *  the flips would pass it. */
  readonly expectUnsound: readonly string[];
  readonly expectSurvivors: readonly string[];
  /**
   * What the harness must DO to this graph once every transcript is imported.
   *
   * Absent for most plants. Present for the ones whose whole point is a reaction to an event rather
   * than a state: L2 and L3 are not "the corpus contains a contradiction", they are "the corpus
   * contains a premise, and when that premise is falsified the graph must respond in a specific way".
   *
   * Declaring the intervention as DATA rather than as harness code is what keeps the plant readable
   * next to its expectation. A reader looking at `expectUnsound: ["l03/d1"]` can see two lines above
   * exactly what was done to provoke it, and can check that the expectation is the right one.
   *
   * The premise is named by transcript and PREDICATE, not by label key, because the harness has to
   * find the node in the graph it actually built — and if extraction never produced that premise, the
   * intervention cannot be applied. That is recorded as an unapplied intervention and scored as a
   * failure of the plant, which is the honest reading: the cascade cannot be measured on a premise the
   * system never extracted.
   */
  readonly falsify?: readonly FalsifyStep[];
}

/** One intervention: find the premise with this predicate in this transcript, and falsify it. */
export interface FalsifyStep {
  /** Corpus transcript id. */
  readonly transcript: string;
  /** Namespaced predicate, e.g. "scale.max_users". Matched against the graph, not the labels. */
  readonly predicate: string;
  /** The human-readable reason recorded on the event. STATE_CHANGING_EVENTS require a non-empty
   *  reason, and an eval harness is not exempt from the invariant it is measuring. */
  readonly reason: string;
}

/* -------------------------------------------------------------------------- */
/* The transcript record                                                      */
/* -------------------------------------------------------------------------- */

export interface LabelledTranscript {
  readonly id: string;
  readonly tier: CorpusTier;
  /** Path relative to the repo root. */
  readonly file: string;
  /** What this transcript is for, in one line. */
  readonly purpose: string;
  readonly decisions: readonly LabelledDecision[];
  readonly premises: readonly LabelledPremise[];
  readonly alternatives: readonly LabelledAlternative[];
  readonly episodes: readonly LabelledEpisode[];
  /** The plants this transcript participates in. */
  readonly plants: readonly string[];
  /** Valid time of the conversation. The timeline orders by this, so a corpus without it cannot
   *  test ordering at all. */
  readonly occurredAt: string;
}

/** A question with a known answer status, for the retrieval and groundedness metrics. */
export interface LabelledQuestion {
  readonly id: string;
  readonly question: string;
  /** The decisions a correct retrieval should surface. Empty means the question is UNANSWERABLE
   *  from this corpus, which is itself a labelled case — §7.1 plants one deliberately. */
  readonly relevant: readonly string[];
  readonly expectVerdict: "GROUNDED" | "PARTIAL" | "INSUFFICIENT_EVIDENCE";
}

/** The whole corpus. Versioned, so a metric result is always tied to the labels it was scored
 *  against — a corpus that changes silently makes every published number meaningless. */
export interface Corpus {
  readonly version: string;
  readonly transcripts: readonly LabelledTranscript[];
  readonly questions: readonly LabelledQuestion[];
  readonly plants: readonly Plant[];
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

export interface CorpusComposition {
  readonly total: number;
  readonly clean: number;
  readonly messy: number;
  readonly adversarial: number;
  readonly decisions: number;
  readonly premises: number;
  readonly alternatives: number;
  readonly plants: number;
  readonly plantsByKind: Readonly<Record<string, number>>;
}

export function compositionOf(corpus: Corpus): CorpusComposition {
  const plantsByKind: Record<string, number> = {};
  for (const plant of corpus.plants) {
    plantsByKind[plant.kind] = (plantsByKind[plant.kind] ?? 0) + 1;
  }

  return {
    total: corpus.transcripts.length,
    clean: corpus.transcripts.filter((t) => t.tier === "clean").length,
    messy: corpus.transcripts.filter((t) => t.tier === "messy").length,
    adversarial: corpus.transcripts.filter((t) => t.tier === "adversarial").length,
    decisions: corpus.transcripts.reduce((total, t) => total + t.decisions.length, 0),
    premises: corpus.transcripts.reduce((total, t) => total + t.premises.length, 0),
    alternatives: corpus.transcripts.reduce((total, t) => total + t.alternatives.length, 0),
    plants: corpus.plants.length,
    plantsByKind,
  };
}

/**
 * The corpus, described honestly.
 *
 * The plan's own mitigation for "corpus too small to be credible" is to state the size, state the
 * limitation, and publish the corpus so others can extend it. This is that statement, generated
 * from the data rather than written by hand, so it cannot drift from what is actually there.
 */
export function describeCorpus(corpus: Corpus): string {
  const c = compositionOf(corpus);

  const lines = [
    `DecisionMemEval v${corpus.version} — ${c.total} transcript(s)`,
    "",
    `  clean          ${c.clean}`,
    `  messy          ${c.messy}`,
    `  adversarial    ${c.adversarial}`,
    "",
    `  labelled decisions      ${c.decisions}`,
    `  labelled premises       ${c.premises}`,
    `  labelled alternatives   ${c.alternatives}`,
    `  planted cases           ${c.plants}`,
    `  labelled questions      ${corpus.questions.length}`,
  ];

  if (Object.keys(c.plantsByKind).length > 0) {
    lines.push("");
    lines.push("Planted cases by kind:");
    for (const [kind, count] of Object.entries(c.plantsByKind)) {
      lines.push(`  ${kind.padEnd(46)}${count}`);
    }
  }

  lines.push("");
  lines.push("LIMITATION, stated because the plan says to: this corpus is hand-labelled by the");
  lines.push("author of the extractor. Labels were written from the transcripts and every one");
  lines.push("carries a character span verifiable against the source, which is the procedural");
  lines.push("defence against labelling what the extractor finds — but it is a defence, not a");
  lines.push("cure. An independent labeller would be the cure, and there is not one.");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Resolved labels                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A label after the loader resolved its quote to a character span.
 *
 * Separate from the authored label because the span is DERIVED, not written: the author supplies
 * verbatim text and the loader computes offsets. Keeping the two shapes apart means a hand-written
 * offset cannot sneak in, and a label whose quote does not appear in the transcript cannot be
 * silently scored as a match at offset zero.
 */
export interface ResolvedDecision extends Omit<LabelledDecision, "quote"> {
  readonly quote: string;
  readonly span: { readonly start: number; readonly end: number };
  /** The corpus id of the transcript this label belongs to.
   *
   * Carried on the label rather than looked up later because the resolver that bridges corpus keys
   * ("l03/d1") to runtime ids (WLD-0007) needs both halves of the key, and an alignment pair hands it
   * a label and a node with no transcript in scope. Searching every transcript for the label would be
   * quadratic inside a loop that already runs per metric, and would silently return the wrong
   * transcript if the same label object ever appeared twice. */
  readonly transcript: string;
}

export interface ResolvedPremise extends Omit<LabelledPremise, "quote"> {
  readonly quote: string;
  readonly span: { readonly start: number; readonly end: number };
  /** The corpus id of the transcript this label belongs to.
   *
   * Carried on the label rather than looked up later because the resolver that bridges corpus keys
   * ("l03/d1") to runtime ids (WLD-0007) needs both halves of the key, and an alignment pair hands it
   * a label and a node with no transcript in scope. Searching every transcript for the label would be
   * quadratic inside a loop that already runs per metric, and would silently return the wrong
   * transcript if the same label object ever appeared twice. */
  readonly transcript: string;
}

export interface ResolvedAlternative extends Omit<LabelledAlternative, "quote"> {
  readonly quote: string;
  readonly span: { readonly start: number; readonly end: number };
  /** The corpus id of the transcript this label belongs to.
   *
   * Carried on the label rather than looked up later because the resolver that bridges corpus keys
   * ("l03/d1") to runtime ids (WLD-0007) needs both halves of the key, and an alignment pair hands it
   * a label and a node with no transcript in scope. Searching every transcript for the label would be
   * quadratic inside a loop that already runs per metric, and would silently return the wrong
   * transcript if the same label object ever appeared twice. */
  readonly transcript: string;
}

export interface ResolvedTranscript
  extends Omit<LabelledTranscript, "decisions" | "premises" | "alternatives"> {
  readonly raw: string;
  readonly decisions: readonly ResolvedDecision[];
  readonly premises: readonly ResolvedPremise[];
  readonly alternatives: readonly ResolvedAlternative[];
  /** Labels whose quote could not be found in the transcript. Reported, never dropped: a label that
   *  silently vanishes would lower recall for a reason nobody can see. */
  readonly unresolved: readonly { kind: string; key: string; quote: string }[];
}

export interface ResolvedCorpus extends Omit<Corpus, "transcripts"> {
  readonly transcripts: readonly ResolvedTranscript[];
}
