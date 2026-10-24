/**
 * Round-trip re-import — 5.7.
 *
 * Phase 5 · sub-phase 5.7
 * Plan: plan/phase-5-export-compiler.md §5.7
 *
 * ---------------------------------------------------------------------------
 * TWO FORMATS, TWO VERY DIFFERENT KINDS OF ROUND TRIP
 *
 *   whylog.json     EXACT. It is the event log itself, hash-chained. Importing it onto a clean log
 *                   reproduces the same decisions with the same ids because it replays the same
 *                   events — `substrate/portability.ts` already does this, including chain
 *                   verification and head-hash checking. Nothing here improves on it.
 *
 *   DECISIONS.md    LOSSY, AND HONESTLY SO. It is Markdown rendered for a human. Parsing it back
 *                   recovers ids, imperatives, scopes and premise ids — not the original snippets,
 *                   spans, confidence or learned times, which were never in it.
 *
 * Claiming a Markdown round trip is exact would be the same category of error as faking a
 * cross-encoder result: an unavailable thing presented as available. So the Markdown path reports
 * what it recovered and what it could not, and merges rather than replaces.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS VERIFY → RESOLVE → MERGE, AND VERIFY IS NOT SKIPPABLE
 *
 * 1. Verify the integrity stamp FIRST. Importing a file whose head does not match anything is how
 *    a log acquires decisions from a different project, and the merge would look successful.
 * 2. Resolve against existing nodes by ID, then by content. An id present locally is the same
 *    decision; an id absent with matching content is a rename or a re-number by another tool.
 * 3. Merge as `refinement` where content matches; propose as new where it does not.
 *
 * Step 2 is where the Phase 2 audit's worst bug lives: minting a fresh id for something the log
 * already holds creates a duplicate node, breaks the shared-premise invariant, and leaves the real
 * node's label unchanged so no gate ever fires. Resolution uses the fold's own identity, never a
 * locally invented id.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, ISODateString, PremiseId } from "@/types/common";
import type { Actor } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type { StampVerification } from "@/types/export";
import { explainVerification, parseStamp, verifyStamp } from "./stamp/verify";

/* -------------------------------------------------------------------------- */
/* What a parsed Markdown record holds                                        */
/* -------------------------------------------------------------------------- */

export interface ParsedRecord {
  readonly id: string;
  readonly imperative: string;
  readonly appliesTo: readonly string[];
  readonly premiseIds: readonly string[];
  readonly rejected: readonly { value: string; why: string | null }[];
  readonly verifyCommand: string | null;
  readonly status: string | null;
}

export interface ParsedDocument {
  readonly records: readonly ParsedRecord[];
  readonly stampPresent: boolean;
  readonly headHash: string | null;
  /** Lines that looked like records but could not be parsed. Kept, not dropped — a silent parse
   *  gap is how a decision disappears during a merge. */
  readonly unparsed: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Parsing DECISIONS.md                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Parse the records back out of a DECISIONS.md.
 *
 * Keyed on the headings this exporter writes (`## WLD-0007 — ...`), which is why the round trip is
 * a property of OUR format rather than of Markdown in general. A hand-written ADR file will not
 * parse, and should not: guessing at a structure nobody specified is how a merge invents decisions.
 */
export function parseDecisionsMd(contents: string): ParsedDocument {
  const lines = contents.split("\n");
  const records: ParsedRecord[] = [];
  const unparsed: string[] = [];

  /* LOCAL to this parse. A module-level accumulator would carry rows from the previous document
   * into the next one, so parsing two files in a session would attribute the first file's
   * rejections to the second file's decisions — and the corruption would be invisible, because
   * each parse would look individually plausible. */
  const rejectedTable: { value: string; decisionId: string; why: string | null }[] = [];

  const stamp = parseStamp(contents);

  let current: MutableRecord | null = null;
  let section: Section | null = null;

  const flush = (): void => {
    if (current === null) return;
    records.push(freeze(current));
    current = null;
    section = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    /* A new decision heading. */
    const heading = /^##\s+((?:WLD|ADR)-[0-9A-Za-z-]+)\s*[—-]\s*(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      current = {
        id: heading[1] ?? "",
        imperative: (heading[2] ?? "").trim(),
        appliesTo: [],
        premiseIds: [],
        rejected: [],
        verifyCommand: null,
        status: null,
      };
      continue;
    }

    /* The rejected-alternatives table starts a section that is not a record. */
    if (/^##\s+Rejected alternatives/i.test(line)) {
      flush();
      section = "rejected-table";
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      section = null;
      continue;
    }

    if (current === null) {
      if (section === "rejected-table") {
        const row = parseRejectedRow(line);
        if (row !== null) rejectedTable.push(row);
      }
      continue;
    }

    /* ---- within a record ---- */
    if (/^###\s+/.test(line)) {
      section = sectionOf(line);
      continue;
    }

    const applies = /^Applies to:\s*(.+)$/.exec(line);
    if (applies !== null && applies[1] !== undefined) {
      const value = applies[1].trim();
      if (!value.startsWith("(no globs")) {
        current.appliesTo = value
          .split(",")
          .map((glob) => glob.replace(/`/g, "").trim())
          .filter((glob) => glob.length > 0);
      }
      continue;
    }

    const status = /^Status:\s*(.+)$/.exec(line);
    if (status !== null) {
      current.status = status[1]?.trim() ?? null;
      continue;
    }

    const verify = /^Verified by:|^Verify:\s*(.+)$/.exec(line);
    if (verify !== null) {
      if (verify[1] !== undefined && !verify[1].startsWith("none"))
        current.verifyCommand = verify[1].trim();
      section = "verify";
      continue;
    }

    if (section === "verify" && /^```/.test(line)) continue;
    if (section === "verify" && line.trim().length > 0 && current.verifyCommand === null) {
      current.verifyCommand = line.trim();
      continue;
    }

    if (section === "context") {
      /* Premise bullets: `- \`P-0002\` — single-user desktop app` */
      const bullet = /^-\s*`(P-[0-9A-Za-z-]+)`/.exec(line);
      if (bullet !== null && bullet[1] !== undefined) {
        current.premiseIds.push(bullet[1]);
        continue;
      }
    }

    if (section === "alternatives") {
      const bullet = /^-\s*\*\*(.+?)\*\*\s*(?:—\s*(.*))?$/.exec(line);
      if (bullet !== null) {
        current.rejected.push({
          value: (bullet[1] ?? "").trim(),
          why: bullet[2] === undefined || bullet[2].trim().length === 0 ? null : bullet[2].trim(),
        });
      }
    }
  }

  flush();

  /* Records recovered from the rejected table are attached to whichever record they name; any that
   * name no record are reported rather than dropped. */
  for (const entry of rejectedTable) {
    const target = records.find((record) => record.id === entry.decisionId);
    if (target === undefined) {
      unparsed.push(
        `Rejected-alternative row naming ${entry.decisionId}, which is not among the parsed records.`,
      );
    }
  }

  return {
    records,
    stampPresent: stamp !== null,
    headHash: stamp?.headHash ?? null,
    unparsed,
  };
}

function parseRejectedRow(
  line: string,
): { value: string; decisionId: string; why: string | null } | null {
  /* `| **Postgres** | WLD-0007 | deploy complexity | premise P-0005 still IN |` */
  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (cells.length < 3) return null;
  if (/^-+$/.test(cells[0] ?? "")) return null;
  if (cells[0] === "Alternative") return null;

  const value = (cells[0] ?? "").replace(/\*\*/g, "");
  const decisionId = cells[1] ?? "";
  if (value.length === 0 || !/^[A-Z]+-[0-9A-Za-z-]+$/.test(decisionId)) return null;

  return { value, decisionId, why: cells[2] ?? null };
}

type Section =
  | "context"
  | "decision"
  | "consequences"
  | "alternatives"
  | "related"
  | "verify"
  | "rejected-table"
  | null;

function sectionOf(line: string): Section {
  const text = line.toLowerCase();
  if (text.includes("context")) return "context";
  if (text.includes("decision")) return "decision";
  if (text.includes("consequences")) return "consequences";
  if (text.includes("alternative")) return "alternatives";
  if (text.includes("related")) return "related";
  return null;
}

interface MutableRecord {
  id: string;
  imperative: string;
  appliesTo: string[];
  premiseIds: string[];
  rejected: { value: string; why: string | null }[];
  verifyCommand: string | null;
  status: string | null;
}

function freeze(record: MutableRecord): ParsedRecord {
  return {
    id: record.id,
    imperative: record.imperative,
    appliesTo: [...record.appliesTo],
    premiseIds: [...record.premiseIds],
    rejected: record.rejected.map((entry) => ({ value: entry.value, why: entry.why })),
    verifyCommand: record.verifyCommand,
    status: record.status,
  };
}

/* -------------------------------------------------------------------------- */
/* The merge plan                                                             */
/* -------------------------------------------------------------------------- */

export type MergeAction = "identical" | "refinement" | "new" | "conflict" | "unverifiable-stamp";

export interface MergeEntry {
  readonly record: ParsedRecord;
  readonly action: MergeAction;
  readonly existing: DecisionId | null;
  readonly explanation: string;
}

export interface MergePlan {
  readonly entries: readonly MergeEntry[];
  readonly counts: Readonly<Record<MergeAction, number>>;
  readonly verification: StampVerification;
  readonly verificationNote: string;
  /** The head the FILE was stamped with. Recorded on the plan rather than derived from the
   *  verification result, which is inverted for this purpose: a successful verification reports no
   *  `found` hash at all, because nothing was wrong. */
  readonly sourceHeadHash: string;
  /** True when nothing should be imported at all. */
  readonly refuse: boolean;
  readonly refusalReason: string | null;
}

/**
 * Plan the merge. Never executes it.
 *
 * Resolution ladder, in order:
 *
 *   1. ID match           the same decision. Compare content to decide identical vs refinement.
 *   2. Content match      same variable and value as an existing decision under a different id —
 *                         a re-numbering by another tool, or a hand-written ADR. Merged as a
 *                         refinement of the existing node rather than created beside it.
 *   3. Neither            genuinely new. Proposed, never auto-committed: the system proposes and
 *                         the human disposes (invariant I4).
 */
export function planMerge(contents: string, state: GraphState, currentHeadHash: string): MergePlan {
  const parsed = parseDecisionsMd(contents);
  const verification = verifyStamp({ contents, currentHeadHash });
  const verificationNote = explainVerification(verification, "DECISIONS.md");

  /* No stamp means nothing about the file can be trusted, including which project it came from.
   * Refusing is the only safe answer: importing decisions from an unknown log would merge two
   * projects' histories, and the merge would look successful. */
  if (!parsed.stampPresent) {
    return {
      entries: [],
      counts: emptyCounts(),
      verification,
      verificationNote,
      sourceHeadHash: "",
      refuse: true,
      refusalReason:
        "The file carries no WhyLog stamp, so there is no way to tell which log it came from or " +
        "whether it has been altered. Importing it could merge another project's decisions into " +
        "this one. Re-export from the log you mean, or import the JSON export instead — that " +
        "carries the full event chain and verifies exactly.",
    };
  }

  const entries: MergeEntry[] = [];

  for (const record of parsed.records) {
    entries.push(classifyRecord(record, state));
  }

  const counts = emptyCounts();
  for (const entry of entries) counts[entry.action] += 1;

  return {
    entries,
    counts,
    verification,
    verificationNote,
    sourceHeadHash: parsed.headHash ?? "",
    refuse: false,
    refusalReason: null,
  };
}

function classifyRecord(record: ParsedRecord, state: GraphState): MergeEntry {
  /* ---- 1. by id ---- */
  const byId = state.decisions.get(record.id as DecisionId);

  if (byId !== undefined) {
    const sameScope =
      record.appliesTo.every((glob) => byId.appliesTo.includes(glob)) &&
      byId.appliesTo.every((glob) => record.appliesTo.includes(glob));
    const samePremises = record.premiseIds.every((id) => premiseIdsOf(state, byId.id).includes(id));

    if (sameScope && samePremises) {
      return {
        record,
        action: "identical",
        existing: byId.id,
        explanation: `${record.id} is already in the log with the same scope and the same premises. Nothing to do — importing it would create a duplicate node.`,
      };
    }

    return {
      record,
      action: "refinement",
      existing: byId.id,
      explanation: `${record.id} is already in the log, but the file's copy differs — ${sameScope ? "the premise set has changed" : "the scope has changed"}. Merging as a refinement of the existing node rather than creating a second one: two nodes for one decision would break the shared-premise invariant and leave neither one's label correct.`,
    };
  }

  /* ---- 2. by content ---- */
  const imperative = record.imperative.toLowerCase();

  for (const decision of state.decisions.values()) {
    if (decision.status === "superseded" || decision.status === "archived") continue;

    const matchesValue =
      imperative.includes(decision.value.toLowerCase()) && decision.value.toLowerCase().length > 2;
    const matchesStatement = imperative.includes(decision.statement.toLowerCase().slice(0, 24));

    if (matchesValue || matchesStatement) {
      return {
        record,
        action: "refinement",
        existing: decision.id,
        explanation: `No decision with id ${record.id} exists here, but ${decision.id} ("${decision.statement}") looks like the same decision under a different id. Merging into the existing node: creating a second one would put two live records for a single belief in the log, and the contradiction gates would then fire on a decision contradicting itself.`,
      };
    }
  }

  /* ---- 3. new ---- */
  return {
    record,
    action: "new",
    existing: null,
    explanation: `${record.id} is not in this log and nothing here matches its content. It would be PROPOSED, not committed: the system proposes and the human disposes, so an imported decision lands in the review queue where it can be checked against the log that already exists.`,
  };
}

function premiseIdsOf(state: GraphState, decisionId: DecisionId): readonly string[] {
  const decision = state.decisions.get(decisionId);
  if (decision === undefined) return [];

  const out: string[] = [];
  for (const justificationId of decision.justificationIds) {
    const justification = state.justifications.get(justificationId);
    if (justification === undefined) continue;
    for (const premiseId of justification.inList) out.push(premiseId);
  }
  return out;
}

function emptyCounts(): Record<MergeAction, number> {
  return { identical: 0, refinement: 0, new: 0, conflict: 0, "unverifiable-stamp": 0 };
}

/* -------------------------------------------------------------------------- */
/* The import event                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The `LogImported` event for a completed merge.
 *
 * Carries the SOURCE stamp's head hash, not the local one: the point of recording it is to be able
 * to say later which log the imported decisions came from. An empty string means the file carried
 * no stamp, which `planMerge` refuses — so in practice this is always populated.
 */
export function importedEvent(
  plan: MergePlan,
  actor: Actor,
  at: ISODateString,
): NewEvent<EventType> {
  return {
    type: "LogImported",
    payload: {
      sourceHeadHash: plan.sourceHeadHash,
      eventsImported: plan.entries.length,
      merged: plan.counts.identical + plan.counts.refinement,
      created: plan.counts.new,
    },
    actor,
    reason: `Imported from a DECISIONS.md stamped at log head ${plan.sourceHeadHash.length === 0 ? "(unstamped)" : plan.sourceHeadHash.slice(0, 12)}${plan.verification.ok ? ", which matches this log" : ", which does not match this log"}: ${plan.counts.identical} identical, ${plan.counts.refinement} merged as refinements, ${plan.counts.new} proposed as new.`,
    at,
  };
}

/** The merge plan as the user reads it, before they decide to apply it. */
export function describeMergePlan(plan: MergePlan): string {
  if (plan.refuse) {
    return `REFUSED. ${plan.refusalReason ?? ""}`;
  }

  const lines = [
    plan.verificationNote,
    "",
    `${plan.entries.length} record(s) parsed from the file:`,
    `  identical      ${plan.counts.identical}  — already here, nothing to do`,
    `  refinement     ${plan.counts.refinement}  — merged into an existing node`,
    `  new            ${plan.counts.new}  — PROPOSED for review, never auto-committed`,
    "",
  ];

  for (const entry of plan.entries.slice(0, 20)) {
    lines.push(
      `  ${entry.action.toUpperCase().padEnd(11)}${entry.record.id} — ${entry.explanation}`,
    );
  }
  if (plan.entries.length > 20) lines.push(`  … ${plan.entries.length - 20} more`);

  lines.push("");
  lines.push("A Markdown round trip is LOSSY and says so: DECISIONS.md never carried the original");
  lines.push("snippets, spans, confidence or learned times, so they cannot come back. The JSON");
  lines.push("export carries the full event chain and reproduces ids exactly — use that when the");
  lines.push("round trip has to be faithful.");

  return lines.join("\n");
}

export type { PremiseId };
