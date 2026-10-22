/**
 * The pre-export consistency gate — 5.6. ★
 *
 * Phase 5 · sub-phase 5.6
 * Plan: plan/phase-5-export-compiler.md §5.6
 * Docs: docs/01-prior-art-landscape.md §4.5
 *
 * ---------------------------------------------------------------------------
 * THE ONLY PLACE THE TWO PILLARS VISIBLY INTERLOCK
 *
 * "A human reconciles contradictions on the fly. An agent needs them reconciled in advance."
 *
 * Everywhere else in the product, truth maintenance produces a finding for a person to read.
 * Here it PREVENTS an outcome: a log containing two mutually exclusive IN decisions cannot be
 * compiled into a context file, because the file would tell an agent to do two incompatible
 * things and — in Anthropic's words — "the model may pick one arbitrarily".
 *
 * That is worth saying out loud, because it is the moment the reasoning layer stops being a
 * dashboard and starts being load-bearing for something the user ships.
 *
 * ---------------------------------------------------------------------------
 * IT DELEGATES TO GATE (a) RATHER THAN RE-DETECTING
 *
 * `wouldContradict` from `reasoning/gates/structural.ts` decides what conflicts. This file only
 * decides whether both sides are being exported.
 *
 * That is a deliberate lesson from the Phase 2 audit, where the adjudicator implemented a
 * NARROWER rule than gate (a) — antonym pairs only, where the gate fired on two conditions — so
 * a newcomer could be ACCEPTED while gate (a) reported a contradiction. A detector and a
 * consumer of that detector must never each have their own idea of what it detects. If this file
 * re-implemented the antonym lookup, an export could be blocked for a pair the reasoning layer
 * considered fine, or cleared for one it had already flagged.
 *
 * ---------------------------------------------------------------------------
 * FOUR OUTCOMES, AND ONLY ONE OF THEM STOPS THE EXPORT
 *
 *   two exported decisions in conflict      BLOCK   — never silently drop one side
 *   an exported decision labelled OUT       WARN + exclude
 *   a contested premise in a Because: line  ANNOTATE
 *   a failing guard on an emitted decision  ANNOTATE
 *
 * Blocking is reserved for the case where the file would be actively wrong. Everything else is
 * surfaced in the artifact itself, at the point of use, because a warning in a side panel is a
 * warning an agent never sees.
 *
 * Dropping one side of a conflict would be the easy implementation and the wrong one: the user
 * would get a clean-looking file and no idea that the log disagrees with itself.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, PremiseId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { ConflictPair, ConsistencyGateResult, ExportWarning } from "@/types/export";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { wouldContradict } from "@/reasoning/gates/structural";

export interface GateInput {
  readonly state: GraphState;
  readonly labels: ReadonlyMap<NodeId, Labelled>;
  /** The decisions the caller intends to emit. */
  readonly candidates: readonly DecisionId[];
}

export interface GateReport {
  readonly result: ConsistencyGateResult;
  /** Conflicts found, whether or not they block. A conflict where one side is already excluded
   *  is reported as a warning: the file will be consistent, but the log is not, and hiding that
   *  because the export happened to dodge it would be the wrong kind of helpful. */
  readonly conflicts: readonly ConflictPair[];
  readonly warnings: readonly ExportWarning[];
  readonly annotations: readonly Annotation[];
  readonly blocked: boolean;
}

/** An inline annotation to attach to a specific record. */
export interface Annotation {
  readonly decisionId: DecisionId;
  readonly kind: "contested-premise" | "failing-guard" | "no-guards";
  readonly text: string;
}

/**
 * Run the gate.
 *
 * Pure and synchronous: it reads the graph and returns a verdict. It does not modify the
 * candidate list — `cif.ts` applies the exclusions, so the gate can be run on its own for a
 * preview ("would this export be blocked?") without committing to a compile.
 */
export function consistencyGate(input: GateInput): GateReport {
  const candidateSet = new Set(input.candidates);
  const conflicts: ConflictPair[] = [];
  const warnings: ExportWarning[] = [];
  const annotations: Annotation[] = [];
  const seenPairs = new Set<string>();

  for (const decisionId of input.candidates) {
    const decision = input.state.decisions.get(decisionId);
    if (decision === undefined) continue;

    const label = input.labels.get(decisionId)?.label ?? decision.label;

    /* ---- OUT: warn and exclude ---- */
    if (label === "OUT") {
      warnings.push({ kind: "out-decision-excluded", decisionId });
    }

    /* ---- conflicts: delegated to gate (a) ---- */
    const hits = wouldContradict(input.state, decision.variable, decision.value, decision.temporal);

    for (const hit of hits) {
      const other = hit.decisionA === decisionId ? hit.decisionB : hit.decisionA;
      const key = decisionId < other ? decisionId + "\u0000" + other : other + "\u0000" + decisionId;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      const pair: ConflictPair = {
        a: hit.decisionA,
        b: hit.decisionB,
        explanation:
          hit.explanation +
          (candidateSet.has(hit.decisionA) && candidateSet.has(hit.decisionB)
            ? " BOTH are being exported, so the compiled file would tell an agent to do two incompatible things."
            : " Only one of the two is being exported, so the file itself stays consistent — but the log does not."),
      };

      conflicts.push(pair);

      if (!candidateSet.has(other)) {
        warnings.push({ kind: "out-decision-excluded", decisionId: other });
      }
    }

    /* ---- contested premise in the Because: line ---- */
    for (const premiseId of premisesOf(input.state, decisionId)) {
      const premise = input.state.premises.get(premiseId);
      const premiseLabel = input.labels.get(premiseId)?.label ?? premise?.label ?? "UNKNOWN";

      if (premiseLabel === "UNKNOWN") {
        warnings.push({ kind: "contested-premise", decisionId, premiseId });
        annotations.push({
          decisionId,
          kind: "contested-premise",
          text:
            "Premise " + premiseId + (premise === undefined ? "" : ' ("' + premise.text + '")') +
            " is CONTESTED — neither confirmed nor refuted. This rule rests on something the log has not settled, so it may be about to change.",
        });
      }
    }

    /* ---- failing guard ---- */
    const failing = failingGuardIds(input.state, decision);
    if (failing.length > 0) {
      warnings.push({ kind: "failing-guard", decisionId });
      annotations.push({
        decisionId,
        kind: "failing-guard",
        text:
          "VERIFY CURRENTLY FAILS: " + failing.join(", ") +
          ". The code does not currently satisfy this rule. Either the rule has drifted or the decision has been reversed in practice and not in the log — resolve it before trusting the rule.",
      });
    }

    /* ---- no guards at all ---- */
    if (decision.guardIds.length === 0) {
      annotations.push({
        decisionId,
        kind: "no-guards",
        text:
          "UNVERIFIABLE: no guard could be compiled from this decision, so nothing would tell you if it stopped holding. It is emitted because it is believed, not because it is checked.",
      });
    }
  }

  /* Only a conflict where BOTH sides are emitted blocks. Anything else the file survives. */
  const blocking = conflicts.filter(
    (pair) => candidateSet.has(pair.a) && candidateSet.has(pair.b),
  );

  const result: ConsistencyGateResult =
    blocking.length === 0
      ? { ok: true }
      : { ok: false, blocking, warnings };

  return { result, conflicts, warnings, annotations, blocked: blocking.length > 0 };
}

/** The premise ids a decision rests on. Typed `PremiseId`, not `DecisionId`: getting this wrong
 *  forces a cast at every use site, and a cast silencing the checker exactly where two id kinds
 *  meet is how a premise id ends up compared against a decision id. */
function premisesOf(state: GraphState, decisionId: DecisionId): readonly PremiseId[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: PremiseId[] = [];
  const seen = new Set<PremiseId>();

  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;
    for (const premiseId of justification.inList) {
      if (seen.has(premiseId)) continue;
      seen.add(premiseId);
      out.push(premiseId);
    }
  }

  return out;
}

function failingGuardIds(state: GraphState, decision: Decision): readonly string[] {
  const out: string[] = [];

  for (const guardId of decision.guardIds) {
    const guard = state.guards.get(guardId);
    if (guard === undefined) continue;
    if (guard.lifecycle !== "accepted") continue;
    if (guard.disabledByDecisionLabel) continue;
    if (guard.lastRun === undefined) continue;
    if (guard.lastRun.outcome === "fail") out.push(guardId);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The blocked-export explanation.
 *
 * Shows the conflicting pair, the rule that fired, the nogood if the log has one covering these
 * premises, and where to resolve it. Never one side alone — presenting one decision as "the
 * problem" would invite deleting it, and deleting a decision is not reconciling a contradiction.
 */
export function renderBlocked(report: GateReport, state: GraphState): string {
  const blocking = report.result.ok ? [] : report.result.blocking;

  const lines = [
    "EXPORT BLOCKED — the log contradicts itself, and compiling it would hand an agent two",
    "incompatible rules. \"If two rules contradict each other, the model may pick one",
    "arbitrarily.\" Neither side is dropped: dropping one would produce a clean-looking file and",
    "hide the fact that the log disagrees with itself.",
    "",
  ];

  for (const pair of blocking) {
    const a = state.decisions.get(pair.a);
    const b = state.decisions.get(pair.b);

    lines.push("  " + pair.a + " — " + (a?.statement ?? "(not in log)"));
    lines.push("  " + pair.b + " — " + (b?.statement ?? "(not in log)"));
    lines.push("  " + pair.explanation);

    const nogood = relevantNogood(state, pair);
    if (nogood !== null) {
      lines.push("  Recorded nogood " + nogood.id + ": " + nogood.explanation);
    }

    const proposal = relevantProposal(state, pair);
    if (proposal !== null) lines.push("  Revision proposal " + proposal + " already covers this pair.");

    lines.push("");
    lines.push("  Resolve it on the Reasoning tab: reverse one, re-justify one, or vouch for the");
    lines.push("  incumbent. Then re-export.");
    lines.push("");
  }

  return lines.join("\n");
}

function relevantNogood(state: GraphState, pair: ConflictPair): { id: string; explanation: string } | null {
  const a = state.decisions.get(pair.a);
  const b = state.decisions.get(pair.b);
  if (a === undefined || b === undefined) return null;

  /* Relevant when the nogood covers premises on BOTH sides: the log has already recorded that
   * this conjunction of assumptions is impossible, which is the strongest available explanation
   * of why the two decisions cannot both stand. */
  const aPremises = premisesOf(state, pair.a);
  const bPremises = premisesOf(state, pair.b);
  if (aPremises.length === 0 || bPremises.length === 0) return null;

  for (const nogood of state.nogoods.values()) {
    const premises = new Set<PremiseId>(nogood.premiseIds);
    if (aPremises.some((id) => premises.has(id)) && bPremises.some((id) => premises.has(id))) {
      return { id: nogood.id, explanation: nogood.explanation };
    }
  }

  return null;
}

/** A proposal covers this pair when either side is the decision it found unsound.
 *  `RevisionProposal` names that field `unsoundDecisionId` — it has no `decisionId`, because a
 *  proposal is ABOUT a failure, not about a decision in the abstract. */
function relevantProposal(state: GraphState, pair: ConflictPair): string | null {
  for (const proposal of state.proposals.values()) {
    if (proposal.unsoundDecisionId === pair.a || proposal.unsoundDecisionId === pair.b) return proposal.id;
  }
  return null;
}

/** The annotations for one record, as the lines appended to it. */
export function annotationsFor(report: GateReport, decisionId: DecisionId): readonly string[] {
  return report.annotations.filter((entry) => entry.decisionId === decisionId).map((entry) => entry.text);
}

/** Warnings that do not block, for the export summary. */
export function renderWarnings(report: GateReport): string {
  if (report.warnings.length === 0) return "No warnings. Every emitted decision is IN, settled, and currently passing its guards.";

  const counts = new Map<string, number>();
  for (const warning of report.warnings) {
    counts.set(warning.kind, (counts.get(warning.kind) ?? 0) + 1);
  }

  const lines = ["Annotated rather than hidden:"];
  for (const [kind, count] of counts) {
    lines.push("  " + count + " × " + describeWarningKind(kind));
  }

  lines.push("");
  lines.push("Each of these appears INLINE on the record it concerns. An agent reading the file has");
  lines.push("to see them at the point of use — a warning in a side panel is a warning it never sees.");

  return lines.join("\n");
}

function describeWarningKind(kind: string): string {
  switch (kind) {
    case "out-decision-excluded":
      return "OUT decision excluded from the export";
    case "contested-premise":
      return "contested premise in a Because: line";
    case "failing-guard":
      return "failing guard on an emitted decision";
    case "over-budget":
      return "decision pushed to the tier-2 index by the token budget";
    default:
      return kind;
  }
}

export function describeGate(): string {
  return [
    "Pre-export consistency gate — four outcomes, one of which stops the export:",
    "",
    "  two exported decisions in conflict      BLOCK    never silently drop one side",
    "  an exported decision labelled OUT       WARN + exclude",
    "  a contested premise in a Because: line  ANNOTATE inline",
    "  a failing guard on an emitted decision  ANNOTATE inline",
    "",
    "Conflict detection is DELEGATED to gate (a)'s `wouldContradict`. This file decides only",
    "whether both sides are being exported. A detector and a consumer of that detector must never",
    "each have their own idea of what it detects — that mismatch was the Phase 2 audit's gap 3,",
    "where an adjudicator with a narrower rule than its gate let a newcomer be ACCEPTED while the",
    "gate reported a contradiction.",
    "",
    "This is the only place in the product where truth maintenance PREVENTS an outcome rather than",
    "reporting one. Everywhere else it produces a finding for a person to read; here it stops a",
    "self-contradictory file from reaching an agent's context window.",
  ].join("\n");
}
