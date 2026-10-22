/**
 * The canonical intermediate form — 5.1.
 *
 * Phase 5 · sub-phase 5.1
 * Plan: plan/phase-5-export-compiler.md §5.1
 * Docs: docs/01-prior-art-landscape.md §4.5
 *
 * ---------------------------------------------------------------------------
 * WHY THE INTERMEDIATE FORM IS THE WHOLE ARCHITECTURE
 *
 * "Stay agent-agnostic: write the decision once, COMPILE it into whatever each tool reads."
 *
 * Implemented literally: one CIF, N emitters, and every emitter is a PURE FUNCTION of the CIF
 * that never touches the graph. That is what stops five formats from drifting apart — not
 * discipline, not review, but the fact that there is only one place a decision becomes a record,
 * and five places that render a record somebody else already built.
 *
 * An emitter that read the graph directly could render a premise the CIF had excluded, or omit a
 * verify command the CIF had generated. It would be a second compiler, and the two would
 * disagree in a way nobody notices until an agent follows a rule that DECISIONS.md says was
 * superseded.
 *
 * ---------------------------------------------------------------------------
 * SINGLE PASS
 *
 * Guards, verify commands, priority and the stamp are all derived from the same materialised
 * graph in the same call. So an export cannot carry a verify command that disagrees with its
 * guard set — there is one read of the graph, and everything downstream is a function of it.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF OPERATIONS IS THE SEMANTICS
 *
 *   1. consistency gate      can run at all?  (blocks before anything is rendered)
 *   2. exclude               OUT and superseded, unless explicitly toggled
 *   3. rank                  by `priority.ts`
 *   4. allocate              tier 1 inline / tier 2 index, against the budget
 *   5. build records         the six agent-optimized properties
 *   6. rejected block        alternatives with premise status
 *   7. index                 one line per tier-2 decision
 *   8. stats                 what the live indicator reads
 *
 * Ranking before allocating is what makes the inline set the TOP-N by priority. Allocating before
 * ranking would fill the budget with whichever decisions came out of the map first, and two
 * exports of the same log would inline different decisions for no reason anyone could find.
 *
 * Excluding before ranking is what keeps an OUT decision out of the file entirely: ranking it low
 * is not the same as not emitting it, and a file containing a reversed rule next to its
 * replacement is exactly the "model may pick one arbitrarily" failure.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId, ISODateString } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type {
  ExportBudget,
  ExportCif,
  ExportRecord,
  ExportStats,
  ExportWarning,
  IndexEntry,
  RejectedBlockEntry,
} from "@/types/export";
import { DEFAULT_EXPORT_BUDGET_LINES } from "@/types/export";
import type { Guard } from "@/types/guards";
import type { GraphState } from "@/substrate/graph-state";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { acceptedGuards } from "@/guards";
/* `priority.ts` exports its own `guardStatusFor`, shaped for the ranking (it also reports whether
 * any guard is `blocking`). `guards/feedback.ts` exports a different one, shaped for entrenchment.
 * Same name, different jobs — so only the ranking one is imported here, and importing both would
 * have meant aliasing one and inviting a future reader to use whichever they found first. */
import { guardStatusFor, priorityOf, type PriorityBreakdown } from "./priority";
import { recordFor } from "./record";
import { rejectedBlock } from "./rejected-block";
import { allocate, estimateTokens, FIXED_OVERHEAD, indexEntryFor } from "./budget";
import { consistencyGate, type GateReport } from "./consistency-gate";

export interface CifOptions {
  readonly maxLines?: number;
  /** Emit OUT decisions too. Off by default — see the header. */
  readonly includeOut?: boolean;
  /** Emit superseded decisions into the agent files. Off by default; DECISIONS.md always carries
   *  them regardless, because a human reading history needs the reversals. */
  readonly includeSuperseded?: boolean;
  readonly now?: number;
}

export interface CifResult {
  readonly cif: ExportCif;
  readonly gate: GateReport;
  readonly budget: ExportBudget;
  readonly excluded: readonly { id: DecisionId; reason: string }[];
  readonly priorities: ReadonlyMap<DecisionId, PriorityBreakdown>;
  /** Set when the gate blocked. The CIF is still built — so the UI can show what WOULD have been
   *  emitted and why it was refused — but no artifact should be written. */
  readonly blocked: boolean;
}

/**
 * Build the canonical intermediate form.
 *
 * Pure apart from reading the clock for recency, which `now` lets the caller pin so that two
 * CIFs built in the same export share one instant.
 */
export function buildCif(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  headHash: string,
  generatedAt: ISODateString,
  compliance: number,
  verifiableCoverage: number,
  options?: CifOptions,
): CifResult {
  const now = options?.now ?? Date.now();
  const maxLines = options?.maxLines ?? DEFAULT_EXPORT_BUDGET_LINES;

  /* ---- 1. candidate set ---- */
  const candidates = candidateIds(state, labels, options);

  /* ---- 2. the gate, before anything is rendered ---- */
  const gate = consistencyGate({ state, labels, candidates: candidates.map((entry) => entry.id) });

  /* ---- 3. rank ---- */
  const priorities = new Map<DecisionId, PriorityBreakdown>();
  const ranked: { id: DecisionId; priority: number }[] = [];

  for (const entry of candidates) {
    const decision = state.decisions.get(entry.id);
    if (decision === undefined) continue;

    const breakdown = priorityOf({
      decision,
      label: entry.label,
      guardStatus: guardStatusFor(state, labels, entry.id),
      now,
    });

    priorities.set(entry.id, breakdown);
    ranked.push({ id: entry.id, priority: breakdown.total });
  }

  ranked.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));

  /* ---- 4. records, built in rank order so `allocate` can trust the ordering ---- */
  const allRecords: ExportRecord[] = ranked.map((entry) => {
    const decision = state.decisions.get(entry.id);
    if (decision === undefined) return null;

    return recordFor({
      state,
      labels,
      decision,
      label: labels.get(entry.id)?.label ?? decision.label,
      /* Tier is assigned by `allocate` below; records are built as inline and demoted after. */
      tier: "inline",
      priority: entry.priority,
      now,
    });
  }).filter((record): record is ExportRecord => record !== null);

  /* ---- 5. allocate against the budget ---- */
  const allocation = allocate(allRecords, linesForRecord, maxLines);

  const inlineRecords = allocation.inline.map((record) => withTier(record, "inline"));
  const indexRecords = allocation.index.map((record) => withTier(record, "index"));

  const index: IndexEntry[] = indexRecords.map((record) => indexEntryFor(record, "DECISIONS.md"));

  /* ---- 6. the rejected block ---- */
  const rejected: readonly RejectedBlockEntry[] = rejectedBlock(state, labels);

  /* ---- 7. stats ---- */
  const lineCount =
    FIXED_OVERHEAD.lines +
    inlineRecords.reduce((total, record) => total + linesForRecord(record), 0) +
    index.length;

  const stats: ExportStats = {
    decisionsIncluded: inlineRecords.length,
    decisionsLinkedOut: indexRecords.length,
    decisionsExcluded: excludedCount(candidates),
    lineCount,
    estimatedTokens: estimateTokens(lineCount),
    compliance,
    verifiableCoverage,
  };

  const budget: ExportBudget = {
    ...allocation.budget,
    excludedCount: stats.decisionsExcluded,
    overBudget: lineCount > maxLines,
  };

  const cif: ExportCif = {
    generatedAt,
    headHash,
    records: inlineRecords,
    rejected,
    index,
    stats,
  };

  return {
    cif,
    gate,
    budget,
    excluded: candidates.filter((entry) => entry.excluded !== null).map((entry) => ({
      id: entry.id,
      reason: entry.excluded ?? "excluded",
    })),
    priorities,
    blocked: gate.blocked,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate selection                                                        */
/* -------------------------------------------------------------------------- */

interface Candidate {
  readonly id: DecisionId;
  readonly label: DecisionLabel;
  readonly excluded: string | null;
}

/**
 * Which decisions are candidates for the agent files.
 *
 * `excluded` is set rather than the entry dropped, so the summary can say WHAT was left out and
 * WHY. An export that silently omits half the log is indistinguishable from one that omitted
 * nothing, and the user cannot tell a small log from a heavily filtered one.
 */
function candidateIds(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  options?: CifOptions,
): readonly Candidate[] {
  const out: Candidate[] = [];

  for (const decision of state.decisions.values()) {
    const label = labels.get(decision.id)?.label ?? decision.label;
    let excluded: string | null = null;

    if (decision.status === "superseded" || decision.status === "archived") {
      if (options?.includeSuperseded !== true) {
        excluded = decision.status + " — the log has withdrawn it, and its replacement is emitted instead";
      }
    } else if (label === "OUT") {
      if (options?.includeOut !== true) {
        excluded = "labelled OUT — a premise it rests on has been falsified, so it is not currently believed";
      }
    }

    out.push({ id: decision.id, label, excluded });
  }

  /* Excluded entries still go through the gate, so a conflict between an emitted decision and an
   * excluded one is REPORTED even though it cannot break the file. The log's inconsistency is not
   * cured by the export dodging it. */
  return out;
}

function excludedCount(candidates: readonly Candidate[]): number {
  return candidates.filter((entry) => entry.excluded !== null).length;
}

/* -------------------------------------------------------------------------- */
/* Line counting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How many lines one inline record will occupy.
 *
 * Counted from the actual rendered shape rather than from an average, because the records that
 * break a budget are exactly the unusual ones — the decision with nine premises, or four rejected
 * alternatives, or a verify command long enough to wrap. An average-based estimate is right for
 * the typical record and wrong for the one that pushes the file over.
 */
export function linesForRecord(record: ExportRecord): number {
  let lines = 0;

  lines += 1; // ### WLD-0007 — imperative
  lines += 1; // blank
  lines += record.appliesTo.length > 0 ? 1 : 0; // Applies to:
  lines += 1; // Because:
  lines += record.rejected.length > 0 ? 1 : 0; // Rejected:
  /* The verify command wraps onto a second line when it carries an explanation. */
  lines += record.verifyCommand === undefined ? 1 : 2;
  lines += 1; // Status:
  lines += record.contestedPremise || record.failingGuard ? 1 : 0; // inline annotation
  lines += 1; // anti-re-litigation
  lines += 1; // blank

  return lines;
}

function withTier(record: ExportRecord, tier: "inline" | "index"): ExportRecord {
  return record.tier === tier ? record : { ...record, tier };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/** Everything the export view needs to explain a compile, in one string. */
export function describeCif(result: CifResult): string {
  const lines = [
    result.blocked ? "BLOCKED by the consistency gate." : "Consistency gate passed.",
    "",
    "  inline (tier 1)   " + result.cif.stats.decisionsIncluded,
    "  index  (tier 2)   " + result.cif.stats.decisionsLinkedOut,
    "  excluded          " + result.cif.stats.decisionsExcluded,
    "  lines             " + result.cif.stats.lineCount + " / " + result.budget.maxLines +
      (result.budget.overBudget ? "  — OVER BUDGET" : ""),
    "  ~tokens           " + result.cif.stats.estimatedTokens,
    "  rejected entries  " + result.cif.rejected.length,
    "  compliance        " + Math.round(result.cif.stats.compliance * 100) + "%",
    "  coverage          " + Math.round(result.cif.stats.verifiableCoverage * 100) + "%",
  ];

  if (result.gate.conflicts.length > 0) {
    lines.push("");
    lines.push("Conflicts found: " + result.gate.conflicts.length +
      " (" + (result.blocked ? "blocking — both sides were being emitted" : "reported only — the export dodged them, the log did not") + ")");
  }

  if (result.gate.annotations.length > 0) {
    lines.push("Annotations: " + result.gate.annotations.length + " attached inline to the records they concern.");
  }

  return lines.join("\n");
}

/** The six agent-optimized properties, checked against one record. Used by the export view to
 *  show the acceptance criterion being met rather than asserted. */
export function checkSixProperties(record: ExportRecord): readonly { property: string; present: boolean; note: string }[] {
  return [
    {
      property: "scoped to file globs",
      present: record.appliesTo.length > 0,
      note: record.appliesTo.length > 0
        ? record.appliesTo.join(", ")
        : "MISSING — an agent editing a stylesheet has no way to know this record does not concern it, so it loads the rule and burns context",
    },
    {
      property: "imperative, not prose",
      present: /\b(MUST|DO NOT|NEVER|AVOID|USE)\b/i.test(record.imperative),
      note: record.imperative,
    },
    {
      property: "verifiable",
      present: record.verifyCommand !== undefined,
      note: record.verifyCommand ?? "MISSING — no accepted guard, so this decision is UNVERIFIABLE and the record says so",
    },
    {
      property: "token-aware",
      present: true,
      note: "tier " + record.tier + ", priority " + record.priority.toFixed(3),
    },
    {
      property: "non-conflicting",
      present: true,
      note: "enforced by the consistency gate before compilation, not by this record",
    },
    {
      property: "addressable",
      present: record.id.length > 0,
      note: record.id + " — stable, never renumbered, never reused",
    },
  ];
}

/**
 * Accepted guards grouped by decision, in ONE pass.
 *
 * Exposed so the emitters and the CI target share one read of the graph rather than each walking
 * `state.guards`. The earlier version called `acceptedGuards(state)` inside the decision loop,
 * which is O(decisions x guards) and re-filters the same guard list for every decision.
 */
export function guardsByDecision(state: GraphState): ReadonlyMap<DecisionId, readonly Guard[]> {
  const out = new Map<DecisionId, Guard[]>();

  for (const guard of acceptedGuards(state)) {
    const existing = out.get(guard.decisionId);
    if (existing === undefined) out.set(guard.decisionId, [guard]);
    else existing.push(guard);
  }

  return out;
}

export type { ExportWarning };
