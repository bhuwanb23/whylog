/**
 * Label keys to runtime ids.
 *
 * Phase 7 · sub-phase 7.2
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The corpus names nodes `"l03/d1"` — a stable, readable key. The graph names them `WLD-0007`, minted
 * from a counter whose value depends on how many nodes every earlier transcript produced. Neither can
 * be written in terms of the other: hardcoding runtime ids in the corpus would make the labels break
 * whenever extraction improves, and deriving corpus keys from the graph would make the ground truth a
 * function of the system being measured, which is circular.
 *
 * So the bridge is built at scoring time from the ALIGNMENT the extraction metrics already computed.
 * A label that did not align has no runtime id, and every metric that depends on it reports the plant
 * as UNTESTED rather than as passed. That distinction is the whole reason this module exists: a plant
 * whose decision was never extracted cannot have its cascade verified, and scoring it as a pass would
 * be the single most misleading number this benchmark could produce.
 * ---------------------------------------------------------------------------
 */

import type { AlternativeId, DecisionId, PremiseId } from "@/types/common";
import type { ResolvedCorpus } from "../corpus/labels";
import type { RunResult } from "../harness";
import type { Alignment } from "./match";

export interface Resolver {
  decision(key: string): DecisionId | null;
  premise(key: string): PremiseId | null;
  alternative(key: string): AlternativeId | null;
  /** Keys the corpus asked about that have no runtime node. Reported, never swallowed. */
  readonly unresolvable: readonly string[];
}

/**
 * The extraction side of an alignment. Every caller passes `{ transcript, key }` — that is what
 * the corpus labels are and what the run's extracted labels are — so this used to be `any` for no
 * reason. Naming it keeps `suspicious/noExplicitAny` honest and documents the contract.
 */
export interface ExtractedLabel {
  readonly transcript: string;
  readonly key: string;
}

export interface Alignments<TDecision, TPremise, TAlternative> {
  readonly decisions: Alignment<ExtractedLabel, TDecision>;
  readonly premises: Alignment<ExtractedLabel, TPremise>;
  readonly alternatives: Alignment<ExtractedLabel, TAlternative>;
}

export function buildResolver(
  corpus: ResolvedCorpus,
  _run: RunResult,
  decisions: Alignment<ExtractedLabel, { id: DecisionId }>,
  premises: Alignment<ExtractedLabel, { id: PremiseId }>,
  alternatives: Alignment<ExtractedLabel, { id: AlternativeId }>,
): Resolver {
  const decisionMap = new Map<string, DecisionId>();
  const premiseMap = new Map<string, PremiseId>();
  const alternativeMap = new Map<string, AlternativeId>();
  const unresolvable: string[] = [];

  for (const pair of decisions.pairs)
    decisionMap.set(pair.label.transcript + "/" + pair.label.key, pair.node.id);
  for (const pair of premises.pairs)
    premiseMap.set(pair.label.transcript + "/" + pair.label.key, pair.node.id);
  for (const pair of alternatives.pairs)
    alternativeMap.set(pair.label.transcript + "/" + pair.label.key, pair.node.id);

  /* Every key the plants reference is checked up front, so a missing node is reported once, here,
   * rather than surfacing as a mysterious zero in whichever metric happened to ask. */
  for (const plant of corpus.plants) {
    for (const key of [...plant.expectUnsound, ...plant.expectSurvivors]) {
      if (!decisionMap.has(key) && !premiseMap.has(key)) unresolvable.push(plant.id + " -> " + key);
    }
  }

  return {
    decision: (key) => decisionMap.get(key) ?? null,
    premise: (key) => premiseMap.get(key) ?? null,
    alternative: (key) => alternativeMap.get(key) ?? null,
    unresolvable,
  };
}

/** Runtime id of the transcript with this corpus key, or null if it failed to import. */
export function runtimeTranscriptId(run: RunResult, corpusKey: string): string | null {
  const entry = run.transcripts.find((candidate) => candidate.transcript.id === corpusKey);
  return entry === undefined ? null : entry.runtimeId;
}

/** Whether a plant's transcripts all imported. A plant spanning a failed transcript is untested. */
export function plantIsTestable(run: RunResult, transcripts: readonly string[]): boolean {
  return transcripts.every((key) => runtimeTranscriptId(run, key) !== null);
}

/**
 * Did this plant's intervention actually HAPPEN?
 *
 * `plantIsTestable` above only asks whether the transcripts imported. That is not enough, and the gap
 * produced a headline result that was an artefact: with the `premiseInvalidation` toggle OFF the
 * harness plants no `PremiseInvalidated` events at all, the transcripts still import, so the plant
 * stayed "testable" — and the decision it expects to go unsound was ALREADY OUT for unrelated reasons.
 * L2 scored 1.000 with gate (c) removed. The ablation then reported that disabling the component the
 * product exists for IMPROVED its own metric, which is a vacuous pass wearing the shape of a finding.
 *
 * A metric that can score perfectly when the mechanism it measures was never switched on is not
 * measuring the mechanism. So: a plant with `falsify` steps is testable only if every one of them was
 * applied. The harness already records `applied: false` with a reason when the premise it needs was
 * never extracted, which is the honest "untested, not passed" case.
 */
export function plantWasIntervened(
  run: RunResult,
  plant: { readonly id: string; readonly falsify?: readonly { readonly predicate: string }[] },
): boolean {
  const steps = plant.falsify ?? [];
  /* No falsify steps means NOTHING was ever falsified, so a plant that expects a decision to go
   * unsound has no cause to attribute it to. Returning true here was the second half of the same
   * vacuous pass: such a plant counted as testable and its already-OUT decision scored as a
   * detection. Both callers of this function are falsification metrics, so an absent intervention is
   * an absent test, never a passed one. */
  if (steps.length === 0) return false;
  return steps.every((step) =>
    run.interventions.some(
      (outcome) =>
        outcome.plant === plant.id && outcome.predicate === step.predicate && outcome.applied,
    ),
  );
}

export type { ResolvedCorpus };
