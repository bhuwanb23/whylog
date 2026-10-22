/**
 * Answer synthesis — 3.9.
 *
 * Phase 3 · sub-phase 3.9
 * Plan: plan/phase-3-retrieval.md §3.9
 *
 * ---------------------------------------------------------------------------
 * THE ANSWER IS ASSEMBLED FROM FACTS, NEVER WRITTEN FROM SCRATCH
 *
 * `CompositionRequest.material` is the retrieval result, already selected, scored and ranked.
 * Composition is never asked to retrieve, and retrieval is never asked to write. That split
 * is what makes the evidence contract enforceable: if the prose could reach outside the
 * material, no citation rule could bind it.
 *
 * Both engines go through `engine.compose()` — the interface requires it and the local engine
 * implements it with the templates in `ai/local/compose.ts`. There is deliberately no
 * local-shaped branch here: a second template engine living in the retrieval layer would be
 * two implementations of one judgement, which is exactly the failure the Phase 2 audit found
 * in the adjudicator. The difference between the engines is fluency and cross-decision
 * synthesis, not the path the answer takes.
 *
 * ---------------------------------------------------------------------------
 * NEITHER ENGINE'S CITATION LIST IS TRUSTED
 *
 * A composer returns prose plus the ids it believes it cited. Those ids are NOT taken at face
 * value. Each sentence of the prose is checked for the ids that actually appear in it, and:
 *
 *   a sentence containing a cited id that resolved this run → a grounded claim
 *   a sentence containing no cited id                       → an UNGROUNDED claim
 *
 * Ungrounded claims are kept, marked, and counted against groundedness. The local templates
 * end every sentence with its decision id, so they attribute cleanly and score high; a model
 * that generalises beyond its citations does not, and PARTIAL is how the answer says so
 * instead of hiding it. A composer that cites nothing produces zero grounded claims and is
 * refused — the correct outcome for a hallucinated answer rather than an embarrassing one.
 *
 * ---------------------------------------------------------------------------
 * REFUSAL IS A COMPLETE ANSWER, NOT AN ERROR PATH
 *
 * When nothing on-topic came back, `composeAnswer` returns a full `Answer` with
 * `verdict: "INSUFFICIENT_EVIDENCE"`, prose that says what is missing, and `nearestRelated`
 * carrying the best hits regardless of score. The reader gets the closest thing the log has
 * and is told explicitly that it did not answer the question. Returning an exception here
 * would make "I don't know" a crash, and a crash gets caught and replaced with a guess.
 * ---------------------------------------------------------------------------
 */

import type { CompositionFact, CompositionRequest, WhyLogEngine } from "@/ai/types";
import type { DecisionId, EngineId, ISODateString } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type {
  Answer,
  Claim,
  GroundednessVerdict,
  IndexLevel,
  PreemptionNotice,
  RetrievedHit,
} from "@/types/retrieval";
import {
  MAX_SEARCHES,
  type SearchTrace,
  groundClaims,
  resolveCitations,
  unresolvedCount,
} from "./evidence-contract";
import { PARTIAL_FLOOR, groundednessOf } from "./groundedness";
import { renderPreemption } from "./preemption";

/**
 * Below this final score a hit is not treated as on-topic.
 *
 * This is a RETRIEVAL threshold, and using one here does not touch invariant I3 — I3 forbids
 * similarity from producing a CONTRADICTION verdict, not from deciding whether a document is
 * worth reading. Nothing here classifies a pair of decisions.
 *
 * 0.15 is deliberately low. Promoted hits bypass it entirely, because an exact structural or
 * premise match is evidence and a low statistical score alongside it is a failure of the
 * statistical side, not a reason to discard the match.
 */
export const TOPICALITY_FLOOR = 0.15;

/** How many retrieved hits are offered as "nearest related" when refusing. Enough to be
 *  useful, few enough that offering them does not read as answering anyway. */
export const NEAREST_RELATED_LIMIT = 3;

export interface ComposeInput {
  readonly question: string;
  readonly retrieved: readonly RetrievedHit[];
  readonly engine: WhyLogEngine;
  readonly engineId: EngineId;
  readonly trace: SearchTrace;
  readonly labels: ReadonlyMap<DecisionId, DecisionLabel>;
  /** decision → its premises, rendered "P-0002 \"single-user desktop app\" (IN)".
   *
   *  Supplied by the pipeline, which holds the graph state. Carrying the `given` into the
   *  composed fact is what makes the answer actionable rather than merely informative: the
   *  premises are the part that tells the reader when the answer stops being true, and they
   *  are the part no competitor can supply. */
  readonly premisesOf: ReadonlyMap<DecisionId, readonly string[]>;
  readonly preemptions: readonly PreemptionNotice[];
  /** Total decisions in the log. Zero changes the assessment entirely: an empty log is not
   *  a failed search, and saying "nothing matched" when nothing exists is misleading. */
  readonly logSize: number;
  readonly answeredAt: ISODateString;
  readonly signal?: AbortSignal;
}

/** The dense levels. Their evidence is statistical, and statistical evidence
 *  needs a domain to be statistical WITHIN. */
const DENSE_LEVELS: readonly IndexLevel[] = ["L1", "L2"];

/**
 * Is this hit actually about the question?
 *
 * A promoted hit carries EXACT evidence — a variable match, a value match, a
 * shared premise — and exact evidence is evidence whatever the score says.
 *
 * A hit carried ONLY by the dense levels is a different matter. The local
 * vectoriser is a hashed n-gram bag, and two short unrelated strings score
 * around 0.19 of cosine similarity against each other. That clears a 0.15
 * floor, so a dense-only hit is admitted even when the question shares not one
 * word, not one variable and not one premise with the log.
 *
 * The consequence was concrete: "What did we decide about the payment
 * provider?" came back GROUNDED at 100%, listing the six decisions least
 * unlike it. The evidence contract is not decorative — the whole point of
 * refusing is that a system which always answers has implemented a guess.
 *
 * So a dense-only hit is admissible only when some OTHER level also matched
 * something for this question. The dense level ranks WITHIN a domain; it does
 * not establish the domain. If the question has no lexical, structural or
 * premise overlap with the log at all, then a dense match is a coincidence
 * between two bags of characters, and the honest answer is that the log does
 * not say.
 */
function isOnTopic(hit: RetrievedHit, all: readonly RetrievedHit[]): boolean {
  if (hit.promoted) return true;

  const onlyDense =
    hit.matchedOn.length > 0 && hit.matchedOn.every((level) => DENSE_LEVELS.includes(level));

  if (onlyDense) {
    const someNonDenseEvidence = all.some((other) =>
      other.matchedOn.some((level) => !DENSE_LEVELS.includes(level)),
    );
    if (!someNonDenseEvidence) return false;
  }

  return hit.finalScore >= TOPICALITY_FLOOR;
}

export async function composeAnswer(input: ComposeInput): Promise<Answer> {
  const onTopic = input.retrieved.filter((hit) => isOnTopic(hit, input.retrieved));

  const facts = onTopic.map((hit) => factFor(hit, input));

  /* ---- the refusal path ---- */
  if (facts.length === 0) {
    return refuse(input);
  }

  const composed = await composeWithEngine(input, facts);

  /* ---- hold the prose to the contract ---- */
  const { citations, resolving } = resolveCitations(composed.claims, input.trace.retrievedIds);
  const claims = groundClaims(composed.claims, resolving);
  const groundedness = groundednessOf(claims, resolving);

  const verdict: GroundednessVerdict = groundedness.verdict;
  const unresolved = unresolvedCount(citations);

  const text = assembleText(
    input,
    composed.text,
    verdict,
    groundedness.score,
    unresolved,
    composed.disclosure,
  );

  return {
    question: input.question,
    verdict,
    text,
    claims,
    groundedness: groundedness.score,
    citations,
    retrieved: input.retrieved,
    trace: input.trace.freeze(groundedness.assessment),
    engine: composed.engine,
    answeredAt: input.answeredAt,
    ...(verdict === "GROUNDED" && input.preemptions.length === 0
      ? {}
      : { nearestRelated: input.retrieved.slice(0, NEAREST_RELATED_LIMIT) }),
    ...(groundedness.notes.length === 0 ? {} : { ungroundedNotes: groundedness.notes }),
    ...(composed.disclosure === undefined ? {} : { disclosure: composed.disclosure }),
  };
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One retrieved hit becomes one grounded fact.
 *
 * The premises are rendered as text WITH their ids, because the composition may quote them
 * and a quoted premise the reader cannot look up is a claim without a citation.
 */
function factFor(hit: RetrievedHit, input: ComposeInput): CompositionFact {
  const decision = hit.decision;
  const label = input.labels.get(decision.id) ?? decision.label;

  return {
    decisionId: decision.id,
    statement: decision.statement,
    ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
    premises: input.premisesOf.get(decision.id) ?? [],
    label,
    validFrom: decision.temporal.valid,
  };
}

/* -------------------------------------------------------------------------- */
/* The engine path                                                            */
/* -------------------------------------------------------------------------- */

async function composeWithEngine(
  input: ComposeInput,
  facts: readonly CompositionFact[],
): Promise<{ text: string; claims: readonly Claim[]; engine: EngineId; disclosure?: string }> {
  const request: CompositionRequest = {
    kind: "answer",
    material: facts,
    question: input.question,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };

  const result = await input.engine.compose(request);

  /* The model's own citation list is NOT trusted. Claims are derived from the prose: a
   * sentence is grounded iff an id it actually contains resolved in this run. See the header. */
  const claims = claimsFromProse(result.text, result.citedDecisionIds);

  return {
    text: result.text,
    claims,
    engine: result.engine,
    ...(result.disclosure === undefined ? {} : { disclosure: result.disclosure }),
  };
}

/**
 * Split prose into sentences and attribute each to the decision ids it mentions.
 *
 * Attribution is by id SUBSTRING, which is why every composed sentence is expected to carry
 * its citation inline. A sentence mentioning no id is an ungrounded claim — kept, marked, and
 * counted, never dropped.
 */
function claimsFromProse(text: string, cited: readonly DecisionId[]): readonly Claim[] {
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  /* A citation bracket belongs to the sentence it terminates.
   *
   * The composer ends every sentence with its decision ids: "6 decisions in the
   * log bear on Why did we choose SQLite over Postgres?. [WLD-0005, WLD-0001,
   * ...]". The split above breaks after the question mark, so the bracket is
   * orphaned onto the NEXT fragment and the sentence it belongs to is left
   * citing nothing — an ungrounded claim, counted against the score, for a
   * sentence that is perfectly well sourced.
   *
   * The general rule: a leading bracket on a fragment, where the sentence
   * before it cites nothing, is that sentence's citation and moves back to it. */
  const sentences: string[] = [];
  for (const fragment of raw) {
    const leading = /^\[([^\]]*)\]\s*/.exec(fragment);
    const previous = sentences.length > 0 ? (sentences[sentences.length - 1] as string) : null;

    if (leading !== null && previous !== null && !cited.some((id) => previous.includes(id))) {
      sentences[sentences.length - 1] = `${previous} ${leading[0].trim()}`;
      const rest = fragment.slice(leading[0].length).trim();
      if (rest.length > 0) sentences.push(rest);
      continue;
    }

    sentences.push(fragment);
  }

  return sentences.map((sentence) => {
    const mentioned = cited.filter((id) => sentence.includes(id));
    return { text: sentence, citations: mentioned, grounded: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Refusal                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The unanswerable case — gate G3's second half.
 *
 * Says what is missing, offers the nearest related decisions, and makes no claim about the
 * question. Zero claims means groundedness is INSUFFICIENT_EVIDENCE by the zero-claim rule in
 * `groundedness.ts`, which is the point: a refusal must not be scoreable as grounded.
 */
function refuse(input: ComposeInput): Answer {
  const nearest = input.retrieved.slice(0, NEAREST_RELATED_LIMIT);

  const body =
    input.logSize === 0
      ? "The log is empty, so nothing can answer this yet. Paste a transcript on the Foundation tab and the decisions in it become searchable."
      : nearest.length === 0
        ? `The log holds ${input.logSize} decisions and none of them came back for this question, at any score. Either the wording does not overlap the vocabulary the decisions were recorded in, or the decision was never recorded.`
        : `The log holds ${input.logSize} decisions and none of them cleared the topicality floor of ${TOPICALITY_FLOOR} for this question.`;

  const offering =
    nearest.length === 0
      ? ""
      : `\n\nNearest related decisions — offered as the closest thing the log has, NOT as an answer:\n${nearest
          .map(
            (hit, index) =>
              `  ${index + 1}. ${hit.decision.id} · ${hit.decision.statement}  (score ${hit.finalScore.toFixed(3)}${hit.promoted ? ", promoted on an exact match" : ""})`,
          )
          .join("\n")}`;

  const firstPreemption = input.preemptions[0];
  const preemption =
    firstPreemption === undefined ? "" : `\n\n${renderPreemption(firstPreemption)}`;

  const text = `INSUFFICIENT EVIDENCE. ${body}${offering}${preemption}\n\n${input.trace.searchCount} of a maximum of ${MAX_SEARCHES} searches were used; each is recorded in the trace below.`;

  return {
    question: input.question,
    verdict: "INSUFFICIENT_EVIDENCE",
    text,
    claims: [],
    groundedness: 0,
    citations: [],
    retrieved: input.retrieved,
    trace: input.trace.freeze(
      input.logSize === 0
        ? "No searches could answer this because the log is empty. This is not a retrieval failure — there is nothing to retrieve from."
        : `Nothing cleared the topicality floor of ${TOPICALITY_FLOOR}. Refusing and offering the nearest related decisions rather than composing an answer from material that does not bear on the question.`,
    ),
    engine: input.engineId,
    answeredAt: input.answeredAt,
    ...(nearest.length === 0 ? {} : { nearestRelated: nearest }),
    ungroundedNotes: [
      "No claims were made. An answer with no claims cannot be grounded, and 0/0 is not treated as 1.",
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* The assembled prose                                                        */
/* -------------------------------------------------------------------------- */

/** Prepend the verdict banner and any pre-emption, so the reader meets the epistemic status
 *  before the content rather than after it. */
function assembleText(
  input: ComposeInput,
  body: string,
  verdict: GroundednessVerdict,
  score: number,
  unresolved: number,
  disclosure?: string,
): string {
  const banner = `${verdict} · ${(score * 100).toFixed(0)}% grounded${unresolved > 0 ? ` · ${unresolved} citation(s) could not be checked against this run` : ""}`;

  const firstPreemption = input.preemptions[0];
  const preemption =
    firstPreemption === undefined
      ? ""
      : `\n\nBEFORE THE ANSWER — ${renderPreemption(firstPreemption)}`;

  return `${banner + preemption}\n\n${body}${disclosure === undefined ? "" : `\n\n${disclosure}`}`;
}

/** The thresholds and the floor, printed for the health panel. */
export function describeComposition(): string {
  return [
    "Answers are assembled from retrieved facts, never written from scratch.",
    "",
    `  topicality floor   ${TOPICALITY_FLOOR}  (promoted hits bypass it — an exact match is evidence)`,
    `  partial floor      ${PARTIAL_FLOOR}  (below this the system refuses)`,
    `  nearest related    ${NEAREST_RELATED_LIMIT}  (offered on refusal, explicitly NOT as an answer)`,
    "",
    "Both engines go through engine.compose(); there is no local-shaped branch here. A second",
    "template engine in the retrieval layer would be two implementations of one judgement.",
    "",
    "Neither engine's citation list is trusted. Each sentence is attributed to the decision",
    "ids that actually appear in it; a sentence citing nothing is kept, marked ungrounded, and",
    "counted against the score. That is how PARTIAL becomes reachable.",
    "",
    "The local templates end every sentence with its decision id, so they attribute cleanly.",
    "What they cannot do is synthesise ACROSS decisions — that gap is disclosed on every local",
    "answer by ai/local/compose.ts rather than left for the reader to discover.",
  ].join("\n");
}
