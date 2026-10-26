/**
 * .cursorrules — 5.2.
 *
 * Phase 5 · sub-phase 5.2
 *
 * ---------------------------------------------------------------------------
 * A FLAT RULE LIST, NOT A DOCUMENT
 *
 * Cursor reads `.cursorrules` as project instructions. The convention is imperative lines rather
 * than sections with prose, so this emitter produces a flat list — no headings per decision, no
 * anti-re-litigation paragraph on each one, no narrative.
 *
 * What it must NOT do is drop the parts that make the rules checkable. A flat format is a reason
 * to be terse, not a reason to omit the premise IDs, the rejected alternatives or the verify
 * command — those are the three things that distinguish this from a hand-written rules file, and
 * flattening them away would leave exactly the artifact every other tool already ships.
 *
 * So: one block per decision, compact, with everything load-bearing kept and everything
 * explanatory removed.
 *
 * ---------------------------------------------------------------------------
 * `.cursor/rules/*.md` IS MENTIONED IN THE PLAN AND NOT EMITTED HERE
 *
 * The per-rule-file layout needs one file per decision with front-matter globs, which is a
 * different output shape (a directory, not a file) and a different download flow. `.cursorrules`
 * is the single-file format that works today and everywhere; the split layout is a v2 target and
 * is recorded as such in the notes rather than half-implemented.
 * ---------------------------------------------------------------------------
 */

import type { ExportCif, ExportRecord } from "@/types/export";
import { renderIndexLine } from "./shared";

export function emitCursorRules(cif: ExportCif, stampBlock: string): string {
  const lines: string[] = [];

  lines.push("# Project rules — compiled from a WhyLog decision log.");
  lines.push("# Each rule is addressable by ID, scoped to globs, and carries a verify command.");
  lines.push("# A rule's BECAUSE line lists the premises it rests on: if one stops holding, the");
  lines.push("# rule stops applying, and that is a supersession rather than a violation.");
  lines.push("");

  for (const record of cif.records) {
    lines.push(...renderCursorRecord(record));
    lines.push("");
  }

  if (cif.rejected.length > 0) {
    lines.push("# Rejected — do not re-propose without superseding the record.");
    for (const entry of cif.rejected) {
      lines.push(
        "# - " +
          entry.value +
          " (" +
          entry.decisionId +
          "): " +
          entry.why +
          " [" +
          entry.premiseStatus +
          "]" +
          (entry.contested ? " UNDER REVIEW" : ""),
      );
    }
    lines.push("");
  }

  if (cif.index.length > 0) {
    lines.push("# In force but not inline — see DECISIONS.md before changing code they govern.");
    for (const entry of cif.index) {
      lines.push(renderIndexLine(entry.id, entry.imperative, entry.appliesTo, entry.seeAlso));
    }
    lines.push("");
  }

  lines.push(stampBlock);

  return lines.join("\n");
}

/** One compact block. Comments carry the metadata so the rules themselves stay imperative. */
function renderCursorRecord(record: ExportRecord): readonly string[] {
  const out: string[] = [];

  out.push(
    "# " +
      record.id +
      (record.appliesTo.length > 0
        ? "  [" + record.appliesTo.join(", ") + "]"
        : "  [no scope recorded]"),
  );

  if (record.becauseText.length > 0) out.push("# BECAUSE: " + record.becauseText);
  else out.push("# BECAUSE: no premise recorded — nothing can falsify this rule");

  out.push(record.imperative);

  if (record.rejected.length > 0) {
    out.push(
      "# REJECTED: " +
        record.rejected
          .map((entry) => entry.value + (entry.why === undefined ? "" : " (" + entry.why + ")"))
          .join(", "),
    );
  }

  if (record.verifyCommand !== undefined) out.push("# VERIFY: " + record.verifyCommand);
  else out.push("# VERIFY: none — this decision is UNVERIFIABLE");

  const flags: string[] = [];
  if (record.contestedPremise) flags.push("PREMISE CONTESTED");
  if (record.failingGuard) flags.push("VERIFY CURRENTLY FAILS");
  if (record.guardsTotal > 0)
    flags.push("guards " + record.guardsPassing + "/" + record.guardsTotal);
  if (flags.length > 0) out.push("# STATUS: " + flags.join(" · "));

  return out;
}
