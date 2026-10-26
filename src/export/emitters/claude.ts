/**
 * CLAUDE.md — 5.2.
 *
 * Phase 5 · sub-phase 5.2
 * Plan: plan/phase-5-export-compiler.md §5.2
 *
 * Read by Claude Code at the start of every session. Anthropic's guidance is to keep it under
 * ~200 lines, because longer files consume more context and reduce adherence — so this is the
 * target the budget is calibrated against, and the one where tier-2 link-out matters most.
 *
 * It is a PURE FUNCTION of the CIF. It never reads the graph: if it did, it could render a premise
 * the CIF excluded or omit a verify command the CIF generated, and it would be a second compiler
 * rather than a second format.
 */

import type { ExportCif, ExportRecord } from "@/types/export";
import { renderIndex } from "../budget";
import { ANTI_RELITIGATION } from "../record";
import { renderRejectedBlock } from "../rejected-block";
import { renderRecord } from "./shared";

export interface ClaudeOptions {
  readonly projectName?: string;
}

export function emitClaudeMd(cif: ExportCif, stampBlock: string, options?: ClaudeOptions): string {
  const name = options?.projectName ?? "this project";

  const sections: string[] = [];

  sections.push("# " + name + " — decision record for agents");
  sections.push("");
  sections.push(
    "These rules were compiled from a decision log, not written by hand. Each carries the premises " +
      "it rests on, what was rejected and why, and a command that checks whether it still holds. " +
      "Read the `Because:` line before changing code a rule governs: it says what would have to be " +
      "true for the rule to stop applying.",
  );
  sections.push("");

  if (cif.records.length === 0) {
    sections.push(
      "No decisions are currently in force. Either the log is empty, or everything in it is " +
        "labelled OUT or superseded — in which case there is deliberately nothing here, because a " +
        "file containing a reversed rule next to its replacement invites an agent to pick one arbitrarily.",
    );
  } else {
    sections.push("## Active decisions (" + cif.records.length + ")");
    sections.push("");

    for (const record of cif.records) {
      sections.push(
        renderRecord(record, { annotations: true, antiRelitigation: ANTI_RELITIGATION }),
      );
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

  sections.push(stampBlock);

  return sections.join("\n");
}

/** Re-exported so the export view can show one record in isolation, which is how the six
 *  properties get checked against something a reader can actually see. */
export type { ExportRecord };
