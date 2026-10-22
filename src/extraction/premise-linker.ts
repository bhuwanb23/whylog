/**
 * Premise linking ΓÇö 1.4, the IN-list and the OUT-list.
 *
 * Phase 1 ┬╖ sub-phase 1.4
 * Plan: plan/phase-1-extraction-pipeline.md ┬º1.4
 *
 * ---------------------------------------------------------------------------
 * THE OUT-LIST IS THE SUBTLE PART AND MUST NOT BE SKIPPED
 *
 * "Use SQLite" is justified by
 *
 *     IN:  [ scale.single_user, deployment.local_only ]
 *     OUT: [ scale.concurrent_writers ]
 *
 * A justification with a non-empty OUT-list is Doyle's NON-MONOTONIC justification,
 * and it is the only mechanism in the system that detects invalidation when the
 * user never states a contradiction. Gate (a) fires when YOU contradict yourself.
 * Gate (c) fires when REALITY does ΓÇö and gate (c) needs an OUT-list, because what
 * reality does is make one of those excluded conditions true.
 *
 * Concretely: the day the app gets a second writer, `scale.concurrent_writers`
 * becomes IN. The justification is then invalid ΓÇö an OUT-list node is IN ΓÇö SQLite
 * is relabelled OUT, and the cascade walks to everything that rested on it. No
 * event was ever recorded saying "SQLite is wrong". The world just moved.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE OUT-LIST PREMISE COMES FROM
 *
 * Nobody says "we exclude concurrent writers". They say "it's one person, one
 * machine, one log". So the excluded condition is DERIVED, from
 * `src/ontology/data/exclusions.ts`: a curated table pairing each supporting
 * predicate with the condition that would break it, in words.
 *
 * The derived node reuses the SOURCE premise's snippet rather than inventing one.
 * That keeps the evidence contract intact ΓÇö the quote is verbatim and resolves ΓÇö at
 * the cost of a node whose text is a quote about something adjacent. The trade is
 * deliberate: a fabricated snippet is a lie the user cannot detect, and an adjacent
 * quote is an inference the user can see labelled as one.
 *
 * ---------------------------------------------------------------------------
 * POLICIES THAT ARE EASY TO GET BACKWARDS
 *
 *   ΓÇó A premise with `negative` polarity ("no other users") is a TRUE FACT about a
 *     bound, so it goes in the IN-list. Its exclusion rule supplies the OUT-list
 *     entry. It does NOT go in the OUT-list itself ΓÇö an OUT-list node is one that
 *     must NOT hold, and "no other users" does hold.
 *
 *   ΓÇó One OUT-list entry per supporting premise, from its PRIMARY exclusion.
 *     `scale.single_user` is broken by concurrent writers AND by multi-tenancy;
 *     emitting both doubles the review burden for one decision. The rest are
 *     reachable from the decision card, which lists all exclusions for its
 *     premises.
 *
 *   ΓÇó An OUT-list entry whose predicate is not world-observable is still emitted.
 *     Only a human can retract it (Phase 2), but recording it is what lets the
 *     human SEE what the decision assumed away.
 * ---------------------------------------------------------------------------
 */

import type { PremiseId } from "@/types/common";
import { asConfidence } from "@/types/common";
import type { DecisionVariable, PremiseType } from "@/types/domain";
import type { PremiseCandidate } from "@/ai/types";
import type { RecoveredPremise } from "./premises";
import type { RecoveredDecision } from "./decisions";
import { primaryExclusion, exclusionsFor, type ExclusionRule } from "@/ontology/data/exclusions";
import { lookupPredicate } from "@/ontology/data/premise-types";
import { VARIABLE_META } from "@/ontology/data/variables";
import { canonicalPredicate } from "@/ontology/canonicalize";

export interface LinkedPremise {
  readonly premise: RecoveredPremise;
  readonly supports: boolean;
}

/**
 * An OUT-list entry derived from a supporting premise.
 *
 * This is a CANDIDATE, not a node: it goes through the same review gate and the
 * same identity ladder as everything else, and it can be discarded like anything
 * else. An exclusion the user disagrees with is a wrong exclusion, and silently
 * applying it would put a phantom constraint on a real decision.
 */
export interface ExcludedPremise {
  readonly candidate: PremiseCandidate;
  readonly type: PremiseType;
  readonly predicate: string;
  /** The condition that would break the source premise, in words. Shown verbatim
   *  in the decision card's EXCLUDES row. */
  readonly text: string;
  /** Reused from the source premise. See the file header. */
  readonly snippet: RecoveredPremise["candidate"]["snippet"];
  readonly sourcePremiseIndex: number;
  readonly rule: ExclusionRule;
  readonly confidence: ReturnType<typeof asConfidence>;
}

export interface JustificationLink {
  /** Index into the recovered decisions. */
  readonly decisionIndex: number;
  /** Indices into the recovered premises ΓÇö the IN-list. */
  readonly inRefs: readonly number[];
  /** Indices into `excluded` ΓÇö the OUT-list. */
  readonly outRefs: readonly number[];
}

export interface PremiseLinking {
  readonly links: readonly JustificationLink[];
  readonly excluded: readonly ExcludedPremise[];
  /** Premises that could not be attached to any decision in the episode. They are
   *  still asserted ΓÇö a premise with no decision yet is a fact about the project ΓÇö
   *  but they get no justification, and that is worth reporting. */
  readonly unlinked: readonly number[];
}

/** An OUT-list entry is an inference, so it inherits less than full confidence from
 *  its source. Below the review tier either way; the number matters for ranking. */
const EXCLUSION_CONFIDENCE_FACTOR = 0.8;

/* -------------------------------------------------------------------------- */
/* Linking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Attach the episode's premises to the episode's decisions.
 *
 * Episode-scoped, not transcript-scoped: a premise stated in one negotiation is
 * evidence for the decision made in THAT negotiation. Attaching every premise in a
 * transcript to every decision in it would produce a justification that looks
 * thorough and means nothing ΓÇö and would make the cascade fire across the whole
 * graph whenever any premise moved.
 */
export function linkPremises(
  decisions: readonly RecoveredDecision[],
  premises: readonly RecoveredPremise[],
): PremiseLinking {
  if (decisions.length === 0) {
    return { links: [], excluded: [], unlinked: premises.map((_, i) => i) };
  }

  const excluded: ExcludedPremise[] = [];
  const links: JustificationLink[] = [];
  const attached = new Set<number>();

  for (let decisionIndex = 0; decisionIndex < decisions.length; decisionIndex += 1) {
    const decision = decisions[decisionIndex];
    if (decision === undefined) continue;

    const inRefs: number[] = [];
    const outRefs: number[] = [];

    for (let premiseIndex = 0; premiseIndex < premises.length; premiseIndex += 1) {
      const premise = premises[premiseIndex];
      if (premise === undefined) continue;

      if (!relevantTo(decision, premise)) continue;

      inRefs.push(premiseIndex);
      attached.add(premiseIndex);

      const exclusion = deriveExclusion(premise, premiseIndex);
      if (exclusion === null) continue;

      const duplicate = excluded.findIndex(
        (existing) =>
          existing.predicate === exclusion.predicate &&
          existing.sourcePremiseIndex === exclusion.sourcePremiseIndex,
      );
      if (duplicate >= 0) {
        outRefs.push(duplicate);
        continue;
      }

      outRefs.push(excluded.length);
      excluded.push(exclusion);
    }

    links.push({ decisionIndex, inRefs, outRefs });
  }

  const unlinked: number[] = [];
  for (let i = 0; i < premises.length; i += 1) {
    if (!attached.has(i)) unlinked.push(i);
  }

  return { links, excluded, unlinked };
}

/* -------------------------------------------------------------------------- */
/* Relevance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Is this premise evidence for this decision?
 *
 * Three routes, in order of strength:
 *
 *   1. the decision's own rationale clause CONTAINS the premise text ΓÇö the human
 *      wrote the reason and the cue found it independently, which is two signals
 *      agreeing;
 *   2. the premise's type is one the ontology lists as typical for the decision's
 *      variable ΓÇö `scale` and `deployment` for DATABASE;
 *   3. the premise is in the same episode and the decision has no other premises
 *      at all, so there is nothing better to attach.
 *
 * Route 3 is what stops a decision from being asserted with an empty justification
 * when the transcript plainly stated a constraint. An empty IN-list is not a
 * neutral outcome: it means the truth-maintenance layer has nothing to maintain,
 * which is the failure this whole phase exists to avoid.
 */
function relevantTo(decision: RecoveredDecision, premise: RecoveredPremise): boolean {
  const rationale = decision.fields.rationale?.text.toLowerCase() ?? "";
  const premiseText = premise.candidate.text.toLowerCase();

  if (rationale.length > 0 && premiseText.length > 0) {
    if (rationale.includes(premiseText)) return true;
    if (sharesContentWords(rationale, premiseText)) return true;
  }

  if (decision.candidate.variable !== "OTHER") {
    const typical = typicalPremiseTypes(decision.candidate.variable);
    if (typical.includes(premise.candidate.type)) return true;
  }

  // A world-observable premise in the same episode is relevant by default: it is
  // the kind of thing a guard could later falsify, and attaching it is what makes
  // gate (c) possible at all.
  return premise.candidate.type === "scale"
    || premise.candidate.type === "deployment"
    || premise.candidate.type === "capability"
    || premise.candidate.type === "external";
}

function sharesContentWords(a: string, b: string): boolean {
  const words = (text: string): Set<string> =>
    new Set(
      text
        .split(/[^a-z0-9]+/i)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length > 3),
    );

  const left = words(a);
  const right = words(b);
  for (const word of left) {
    if (right.has(word)) return true;
  }
  return false;
}

function typicalPremiseTypes(variable: DecisionVariable): readonly PremiseType[] {
  return VARIABLE_META[variable].typicalPremises;
}

/* -------------------------------------------------------------------------- */
/* Exclusion derivation                                                       */
/* -------------------------------------------------------------------------- */

function deriveExclusion(premise: RecoveredPremise, premiseIndex: number): ExcludedPremise | null {
  const rule = primaryExclusion(premise.candidate.predicate);
  if (rule === null) return null;

  const predicate = canonicalPredicate(rule.breaksType, rule.breaksPredicate);
  if (lookupPredicate(predicate) === null) return null;

  const value = rule.breaksValue ?? negateValue(premise.candidate.value);

  const candidate: PremiseCandidate = {
    type: rule.breaksType,
    predicate,
    ...(value === undefined ? {} : { value }),
    // The rule's own wording, plus the verbatim quote that produced it. The quote
    // is what makes the inference checkable; the wording is what makes it readable.
    text: `${rule.text} ΓÇö excluded by "${premise.candidate.text}"`,
    confidence: asConfidence(premise.candidate.confidence * EXCLUSION_CONFIDENCE_FACTOR),
    snippet: premise.candidate.snippet,
    // Always reviewed. A derived constraint on a real decision is exactly the kind
    // of thing a human should see before it can trigger a cascade.
    needsReview: true,
  };

  return {
    candidate,
    type: rule.breaksType,
    predicate,
    text: rule.text,
    snippet: premise.candidate.snippet,
    sourcePremiseIndex: premiseIndex,
    rule,
    confidence: candidate.confidence,
  };
}

/** A boolean premise's exclusion is its negation. A counted premise has no
 *  mechanical negation ΓÇö the curated table supplies one, and if it does not, there
 *  is no honest OUT-list entry to emit. */
function negateValue(value: string | number | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return !value;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeLinking(linking: PremiseLinking, decisionCount: number, premiseCount: number): string {
  const withOut = linking.links.filter((link) => link.outRefs.length > 0).length;
  const parts = [
    `${linking.links.length} justification${linking.links.length === 1 ? "" : "s"} over ${decisionCount} decision${decisionCount === 1 ? "" : "s"}`,
    `${linking.excluded.length} excluded condition${linking.excluded.length === 1 ? "" : "s"}`,
  ];
  if (withOut > 0) {
    parts.push(`${withOut} decision${withOut === 1 ? "" : "s"} non-monotonic ΓÇö gate (c) can fire on ${withOut === 1 ? "it" : "them"}`);
  } else {
    parts.push("no OUT-lists ΓÇö gate (c) cannot fire on anything from this transcript");
  }
  if (linking.unlinked.length > 0) {
    parts.push(`${linking.unlinked.length} of ${premiseCount} premises attached to no decision`);
  }
  return parts.join(" ┬╖ ");
}

/** Every exclusion available for a premise, not just the primary one. The decision
 *  card lists these so a user can see what else the decision assumes away. */
export function allExclusionsFor(predicate: string): readonly ExclusionRule[] {
  return exclusionsFor(predicate);
}

/** Which premise ids a committed justification should carry. Called by
 *  `commit.ts` once local indices have become real ids. */
export interface ResolvedJustification {
  readonly decisionIndex: number;
  readonly inList: readonly PremiseId[];
  readonly outList: readonly PremiseId[];
}

export function resolveJustification(
  link: JustificationLink,
  premiseIds: readonly (PremiseId | null)[],
  excludedIds: readonly (PremiseId | null)[],
): ResolvedJustification {
  const inList = link.inRefs
    .map((index) => premiseIds[index] ?? null)
    .filter((id): id is PremiseId => id !== null);

  const outList = link.outRefs
    .map((index) => excludedIds[index] ?? null)
    .filter((id): id is PremiseId => id !== null);

  return { decisionIndex: link.decisionIndex, inList, outList };
}
