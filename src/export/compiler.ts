/**
 * The compilation pipeline — 5.1.
 *
 * Phase 5 · sub-phase 5.1
 * Plan: plan/phase-5-export-compiler.md §5.1
 *
 * ---------------------------------------------------------------------------
 * ONE GRAPH IN, MANY ARTIFACTS OUT, IN A SINGLE PASS
 *
 *   graph → gate → CIF(s) → rank → budget → emitters → stamp → artifacts + events
 *
 * The single-pass rule is not about speed. It is the guarantee that an export can never carry a
 * verify command that disagrees with its guard set, a stamp that disagrees with its counts, or a
 * DECISIONS.md that disagrees with the CLAUDE.md compiled beside it. All of them are read from one
 * snapshot of one graph, once.
 *
 * A second pass — compile the docs, then compile the CI runner — would read a graph that may have
 * moved, and the risk table names the consequence: verify command drifts from the guard set.
 *
 * ---------------------------------------------------------------------------
 * TWO CIFs, AND WHY THAT IS STILL ONE PASS
 *
 * The agent files exclude OUT and superseded decisions and obey a token budget. DECISIONS.md does
 * neither, because a human reading history needs the reversals and has no attention budget.
 *
 * Both CIFs are built from the SAME graph snapshot in the SAME call, so this is still one pass.
 * What it is not is one emitter reading the graph — the emitters stay pure functions of a CIF,
 * which is the property that keeps five formats from drifting apart.
 *
 * ---------------------------------------------------------------------------
 * THE STAMP IS APPLIED LAST, AND THE DIGEST COVERS THE BODY ONLY
 *
 * Each artifact is emitted twice-over in a specific order:
 *
 *   1. render the body with an EMPTY stamp slot
 *   2. digest the body
 *   3. render the stamp block, embedding that digest
 *   4. append it
 *
 * The digest cannot cover the stamp that contains it — that is circular — so it covers the
 * compiled content, which is what a rewrite would actually change. `stamp/verify.ts` strips the
 * stamp before digesting on the way back in, so the two agree. Digesting a placeholder instead
 * would produce a stamp that fails verification the moment anyone checks it.
 *
 * ---------------------------------------------------------------------------
 * THE GATE RUNS FIRST AND CAN STOP EVERYTHING
 *
 * When it blocks, `compile` still returns the CIF, so the UI can show what WOULD have been emitted
 * and why it was refused — but `artifacts` is empty. Returning nothing at all would leave the user
 * staring at an error with no idea which two decisions caused it.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE WRITES
 *
 * The events are returned as drafts. The store owns `append → fold → persist`, and an export that
 * wrote its own events could not be composed with the mutation that follows it.
 * ---------------------------------------------------------------------------
 */

import type { Actor } from "@/types/common";
import type { DecisionId, ExportId, ISODateString } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { CompiledArtifact, ExportCif, ExportTarget, ExportWarning, IntegrityStamp } from "@/types/export";
import { EXPORT_TARGETS, TARGET_FILENAMES } from "@/types/export";
import type { Decision } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import { label } from "@/reasoning/labeller";
import { formatExportId } from "@/lib/ids";
import { nowISO } from "@/lib/format";
import { compliance, coverage, evaluatedFromState } from "@/guards";
import { buildCif, type CifResult } from "./cif";
import { buildStamp, renderStamp } from "./stamp";
import { emit, isDocumentTarget } from "./emitters";
import type { DecisionNarrative } from "./emitters/decisions-md";
import { emitCi } from "./ci";
import { RUNNER_PATH } from "./verify-command";
import { annotationsFor, renderBlocked, type GateReport } from "./consistency-gate";

export interface CompileInput {
  readonly state: GraphState;
  readonly headHash: string;
  readonly actor: Actor;
  readonly projectName?: string;
  /** Which targets to emit. All five by default: a builder switching editors should not have to
   *  re-export, and emitting all of them from one pass costs nothing extra. */
  readonly targets?: readonly ExportTarget[];
  readonly maxLines?: number;
  readonly includeOut?: boolean;
  readonly includeSuperseded?: boolean;
  readonly engineAtGeneration?: string;
  readonly now?: number;
}

export interface CompileResult {
  readonly artifacts: readonly CompiledArtifact[];
  readonly agentCif: ExportCif;
  readonly humanCif: ExportCif;
  readonly gate: GateReport;
  readonly stamp: IntegrityStamp;
  readonly drafts: readonly NewEvent<EventType>[];
  readonly blocked: boolean;
  /** Present when blocked: what to show the user, naming both sides of every conflict. */
  readonly blockedExplanation: string | null;
  /** Present when the CI runner was pulled in by a document's verify command rather than being
   *  selected. Recorded rather than silent: a user who unticked the CI target deserves to know
   *  why it came back. */
  readonly ciAddedBecause: string | null;
  readonly exportId: ExportId;
  readonly durationMs: number;
  readonly narratives: ReadonlyMap<DecisionId, DecisionNarrative>;
}

export async function compile(input: CompileInput): Promise<CompileResult> {
  const started = Date.now();
  const generatedAt = nowISO() as ISODateString;
  const labels = label(input.state).labels;
  const targets = input.targets ?? EXPORT_TARGETS;

  /* ---- metrics, read once, used by the stamp and both CIFs ---- */
  const evaluated = evaluatedFromState(input.state);
  const guardToDecision = new Map<string, DecisionId>();
  for (const guard of input.state.guards.values()) guardToDecision.set(guard.id, guard.decisionId);

  const complianceResult = compliance(evaluated, labels, guardToDecision);
  const coverageResult = coverage(input.state, labels, []);

  const exportId = formatExportId(input.state.counters.exports + 1);

  const stamp = buildStamp({
    state: input.state,
    labels,
    headHash: input.headHash,
    generatedAt,
    engineAtGeneration: input.engineAtGeneration ?? "unknown",
    compliance: complianceResult.score,
    verifiableCoverage: coverageResult.score,
  });

  /* ---- the agent CIF: exclusions on, budget on ---- */
  const agentResult: CifResult = buildCif(input.state, labels, stamp.headHash, generatedAt, complianceResult.score, coverageResult.score, {
    ...(input.maxLines === undefined ? {} : { maxLines: input.maxLines }),
    ...(input.includeOut === undefined ? {} : { includeOut: input.includeOut }),
    ...(input.includeSuperseded === undefined ? {} : { includeSuperseded: input.includeSuperseded }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  /* ---- the gate blocks before anything is rendered ---- */
  if (agentResult.blocked) {
    return {
      artifacts: [],
      agentCif: agentResult.cif,
      humanCif: agentResult.cif,
      gate: agentResult.gate,
      stamp,
      drafts: [],
      blocked: true,
      blockedExplanation: renderBlocked(agentResult.gate, input.state),
      ciAddedBecause: null,
      exportId,
      durationMs: Date.now() - started,
      narratives: new Map(),
    };
  }

  /* ---- the human CIF: no exclusions, no budget ---- */
  const humanResult = buildCif(input.state, labels, stamp.headHash, generatedAt, complianceResult.score, coverageResult.score, {
    includeOut: true,
    includeSuperseded: true,
    /* A human document is not read into a context window. Sizing the budget to the log guarantees
     * everything lands inline rather than in an index that would point at itself. */
    maxLines: Math.max(1000, input.state.decisions.size * 40),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  const narratives = buildNarratives(input.state);

  /* ---- emit ---- */
  const artifacts: CompiledArtifact[] = [];
  let needsRunner = false;

  for (const target of targets) {
    if (!isDocumentTarget(target)) continue;

    const cif = target === "decisions-md" ? humanResult.cif : agentResult.cif;

    /* Step 1: the body, with no stamp. Step 2-4 happen in `finishArtifact`. */
    const body = emit({
      target,
      cif,
      stampBlock: "",
      ...(input.projectName === undefined ? {} : { projectName: input.projectName }),
      ...(target === "decisions-md" ? { narratives } : {}),
    });

    /* A document that tells an agent to run the runner makes the runner mandatory. Emitting the
     * documents without it would hand out instructions that fail, which is worse than not
     * emitting them at all. */
    if (cif.records.some((record) => record.verifyCommand?.includes(RUNNER_PATH) ?? false)) {
      needsRunner = true;
    }

    artifacts.push(finishArtifact(exportId, target, body, stamp, target === "decisions-md" ? humanResult : agentResult, agentResult.gate, cif));
  }

  /* ---- the CI target, same graph, same pass ---- */
  let ciAddedBecause: string | null = null;

  if (targets.includes("ci-guards") || needsRunner) {
    const ci = emitCi(
      {
        state: input.state,
        labels,
        headHash: stamp.headHash,
        exportId,
        generatedAt,
        /* The runner is JavaScript, so it gets the stamp as a comment header built from the same
         * `IntegrityStamp` rather than the HTML-comment block the documents use. */
        stampBlock: "",
        stamp,
      },
      needsRunner,
    );

    artifacts.push(...ci.artifacts);

    if (needsRunner && !targets.includes("ci-guards")) {
      ciAddedBecause =
        "The CI runner was emitted even though it was not selected, because verify commands in the " +
        "exported documents invoke " + RUNNER_PATH + ". Without it those commands would be " +
        "instructions that fail.";
    }
  }

  /* ---- events ---- */
  const totalLines = artifacts.reduce((total, artifact) => total + artifact.contents.split("\n").length, 0);
  const emittedTargets = targets.filter((target) => artifacts.some((artifact) => artifact.target === target));

  const drafts: NewEvent<EventType>[] = [
    {
      type: "ExportCompiled",
      payload: {
        exportId,
        targets: emittedTargets,
        decisionsIncluded: agentResult.cif.stats.decisionsIncluded,
        decisionsLinkedOut: agentResult.cif.stats.decisionsLinkedOut,
        lineCount: totalLines,
      },
      actor: input.actor,
      reason:
        "Compiled " + artifacts.length + " artifact(s) from log head " + stamp.headHash.slice(0, 12) +
        ": " + agentResult.cif.stats.decisionsIncluded + " decision(s) inline, " +
        agentResult.cif.stats.decisionsLinkedOut + " linked out, " +
        agentResult.cif.stats.decisionsExcluded + " excluded. One pass over one graph, so the verify " +
        "commands and the guard set cannot disagree.",
      at: generatedAt,
      occurredAt: generatedAt,
    },
    {
      type: "ExportStamped",
      payload: { exportId, stamp },
      actor: input.actor,
      reason:
        "Stamped with log head " + stamp.headHash.slice(0, 12) + " so each artifact can be tied back " +
        "to the state that produced it and a later rewrite detected. Auditability, not security: the " +
        "hash is unsalted and the algorithm is in the source.",
      at: generatedAt,
      occurredAt: generatedAt,
    },
  ];

  return {
    artifacts,
    agentCif: agentResult.cif,
    humanCif: humanResult.cif,
    gate: agentResult.gate,
    stamp,
    drafts,
    blocked: false,
    blockedExplanation: null,
    ciAddedBecause,
    exportId,
    durationMs: Date.now() - started,
    narratives,
  };
}

/**
 * Steps 2–4 of the stamp: digest the body, render the stamp carrying that digest, append it.
 */
function finishArtifact(
  exportId: ExportId,
  target: ExportTarget,
  body: string,
  stamp: IntegrityStamp,
  result: CifResult,
  gate: GateReport,
  cif: ExportCif,
): CompiledArtifact {
  const stampBlock = renderStamp(stamp, body);
  const contents = body.trimEnd() + "\n\n" + stampBlock + "\n";

  return {
    exportId,
    target,
    filename: TARGET_FILENAMES[target],
    contents,
    stamp,
    budget: result.budget,
    warnings: gateWarnings(gate, cif),
  };
}

/* -------------------------------------------------------------------------- */
/* The ADR narrative                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What DECISIONS.md needs beyond the agent record.
 *
 * Built here, once, from the graph — so `decisions-md.ts` stays a pure function of (CIF,
 * narratives) and no emitter reads the graph directly.
 */
export function buildNarratives(state: GraphState): ReadonlyMap<DecisionId, DecisionNarrative> {
  const out = new Map<DecisionId, DecisionNarrative>();

  for (const decision of state.decisions.values()) {
    out.set(decision.id, narrativeFor(decision));
  }

  return out;
}

function narrativeFor(decision: Decision): DecisionNarrative {
  return {
    ...(decision.yStatement === undefined ? {} : { yStatement: decision.yStatement }),
    ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
    ...(decision.acceptedDownside === undefined ? {} : { acceptedDownside: decision.acceptedDownside }),
    supersedes: decision.edges.supersedes,
    supersededBy: decision.edges.supersededBy,
    sharesPremiseWith: decision.edges.sharesPremiseWith,
    dependsOn: decision.edges.dependsOn,
    conflictsWith: decision.edges.conflictsWith,
    variable: decision.variable,
    value: decision.value,
    origin: decision.provenance.origin,
    confidence: decision.provenance.confidence,
    decidedAt: decision.temporal.valid,
    entrenchment: decision.entrenchment,
    status: decision.status,
  };
}

/* -------------------------------------------------------------------------- */
/* Warnings and annotations                                                   */
/* -------------------------------------------------------------------------- */

/** The gate's warnings, filtered to decisions this artifact actually carries. A warning about an
 *  excluded decision belongs in the summary, not in a file that never mentions it. */
function gateWarnings(gate: GateReport, cif: ExportCif): readonly ExportWarning[] {
  const present = new Set<string>(cif.records.map((record) => record.id as string));
  const out: ExportWarning[] = [];

  for (const warning of gate.warnings) {
    if (warning.kind === "over-budget") {
      out.push(warning);
      continue;
    }
    if (present.has(warning.decisionId)) out.push(warning);
  }

  return out;
}

/** The annotations the gate produced for one record, for the view to render beside it. */
export function annotationsForResult(result: CompileResult, decisionId: DecisionId): readonly string[] {
  return annotationsFor(result.gate, decisionId);
}

/** What the whole compile did, for the export view. */
export function describeCompile(result: CompileResult): string {
  if (result.blocked) {
    return result.blockedExplanation ?? "Blocked by the consistency gate.";
  }

  const lines = [
    "Compiled " + result.artifacts.length + " artifact(s) in " + result.durationMs + " ms, one pass over one graph.",
    "",
  ];

  for (const artifact of result.artifacts) {
    lines.push(
      "  " + artifact.filename.padEnd(38) + artifact.contents.split("\n").length + " lines" +
        (artifact.warnings.length > 0 ? "  · " + artifact.warnings.length + " annotation(s)" : ""),
    );
  }

  lines.push("");
  lines.push("  inline      " + result.agentCif.stats.decisionsIncluded);
  lines.push("  linked out  " + result.agentCif.stats.decisionsLinkedOut);
  lines.push("  excluded    " + result.agentCif.stats.decisionsExcluded);
  lines.push("  budget      " + result.agentCif.stats.lineCount + " / " + result.artifacts[0]?.budget.maxLines +
    (result.agentCif.stats.lineCount > (result.artifacts[0]?.budget.maxLines ?? 0) ? "  — OVER" : ""));
  lines.push("  compliance  " + Math.round(result.agentCif.stats.compliance * 100) + "%");
  lines.push("  coverage    " + Math.round(result.agentCif.stats.verifiableCoverage * 100) + "%");
  lines.push("  log head    " + result.stamp.headHash.slice(0, 12));

  if (result.ciAddedBecause !== null) {
    lines.push("");
    lines.push(result.ciAddedBecause);
  }

  return lines.join("\n");
}

export { buildCif };
export type { CifResult };
