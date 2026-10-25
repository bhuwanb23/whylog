/**
 * AGENTS.md — 5.2. The cross-agent standard, and the default recommendation.
 *
 * Phase 5 · sub-phase 5.2
 *
 * "A README for agents", used in more than 60,000 projects. It is the target with the broadest
 * compatibility, so it is the one to emit when the user does not know which tool their next
 * contributor will use.
 *
 * Same records as CLAUDE.md, different framing: AGENTS.md readers are not all Claude, so the
 * preamble explains the conventions rather than assuming them, and the file names the log it came
 * from so a reader who has never seen WhyLog can tell where the rules originated.
 */

import type { ExportCif } from "@/types/export";
import { renderIndex } from "../budget";
import { renderRejectedBlock } from "../rejected-block";
import { ANTI_RELITIGATION } from "../record";
import { renderRecord } from "./shared";

export function emitAgentsMd(cif: ExportCif, stampBlock: string, projectName?: string): string {
  const name = projectName ?? "this project";
  const sections: string[] = [];

  sections.push("# AGENTS.md — " + name);
  sections.push("");
  sections.push(
    "Machine-readable decision record, compiled from a WhyLog decision log. Each rule below is " +
      "addressable by a stable ID, scoped to file globs, and carries the command that verifies it.",
  );
  sections.push("");
  sections.push("**How to use these rules:**");
  sections.push("");
  sections.push("- A rule's `Applies to:` globs say whether it concerns the file you are editing. If none match, ignore it — it is here because the log holds it, not because your task needs it.");
  sections.push("- A rule's `Because:` line lists the PREMISES it rests on, by ID. If one of those stops being true, the rule stops applying — that is a supersession, not a violation.");
  sections.push("- A rule's `Verify:` line is runnable. If you are about to change code a rule governs, run it first and after.");
  sections.push("- The `Rejected` section lists options already considered and turned down, with the reason and whether that reason still holds. Do not re-propose one without superseding the record.");
  sections.push("");

  if (cif.records.length === 0) {
    sections.push(
      "_No decisions are currently in force._ The log is empty, or everything in it is OUT or superseded.",
    );
  } else {
    sections.push("## Active decisions (" + cif.records.length + ")");
    sections.push("");
    for (const record of cif.records) {
      sections.push(renderRecord(record, { antiRelitigation: ANTI_RELITIGATION }));
      sections.push("");
    }
  }

  sections.push(renderRejectedBlock(cif.rejected));
  sections.push("");

  const index = renderIndex(cif.index);
  if (index.length > 0) {
    sections.push(index);
    sections.push("");
  }

  sections.push(
    "## Provenance",
    "",
    "Compiled from log head `" + cif.headHash.slice(0, 12) + "\u2026` at " + cif.generatedAt +
      ". " + cif.stats.decisionsIncluded + " decision(s) inline, " + cif.stats.decisionsLinkedOut +
      " linked out, " + cif.stats.decisionsExcluded + " excluded. To change a rule, change the " +
      "decision in the log and re-export: editing this file directly will be detected as a stamp " +
      "mismatch and the edit will be lost on the next export.",
  );
  sections.push("");
  sections.push(stampBlock);

  return sections.join("\n");
}
