/**
 * DECISIONS.md — 5.2. The human target.
 *
 * Phase 5 · sub-phase 5.2
 * Plan: plan/phase-5-export-compiler.md §5.2
 *
 * ---------------------------------------------------------------------------
 * FULL ADR FORM, AND THE ONLY TARGET THAT CARRIES HISTORY
 *
 * Context · Decision · Consequences · Alternatives · Related. Plus superseded and OUT decisions,
 * which the agent files exclude by default.
 *
 * That exclusion is correct for agents and wrong for humans. An agent following rules needs the
 * current set and nothing else — a reversed rule next to its replacement is the "model may pick
 * one arbitrarily" failure. A human reading history needs the reversals, because "we tried
 * Postgres and moved back" is the single most useful sentence in a decision log, and it exists
 * only in the superseded records.
 *
 * So the compiler builds TWO CIFs: one with exclusions and a budget for the agent files, one
 * without either for this. Both come from the same graph in the same pass, which keeps the
 * single-pass guarantee — there is still exactly one read of the graph, and still no emitter that
 * reads it.
 *
 * ---------------------------------------------------------------------------
 * THE NARRATIVE IS PASSED IN, NOT FETCHED
 *
 * `DecisionNarrative` carries what an ADR needs and the agent record does not: the Y-statement,
 * the accepted downside, what this supersedes, what shares its premises. The compiler builds the
 * map once from the graph; this emitter is a pure function of (CIF, narratives).
 *
 * Letting this file read the graph directly would be convenient and would break the one property
 * that keeps five formats from drifting: that there is a single place a decision becomes a record.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { ExportCif, ExportRecord } from "@/types/export";
import { renderStatus } from "../record";

/** What an ADR needs beyond the agent record. Built by the compiler, consumed here. */
export interface DecisionNarrative {
  readonly yStatement?: string;
  readonly rationale?: string;
  readonly acceptedDownside?: string;
  readonly supersedes: readonly DecisionId[];
  readonly supersededBy: readonly DecisionId[];
  readonly sharesPremiseWith: readonly DecisionId[];
  readonly dependsOn: readonly DecisionId[];
  readonly conflictsWith: readonly DecisionId[];
  readonly variable: string;
  readonly value: string;
  readonly origin: string;
  readonly confidence: number;
  readonly decidedAt: string;
  readonly entrenchment: number;
  readonly status: string;
}

export function emitDecisionsMd(
  cif: ExportCif,
  stampBlock: string,
  narratives: ReadonlyMap<DecisionId, DecisionNarrative>,
  projectName?: string,
): string {
  const name = projectName ?? "this project";
  const sections: string[] = [];

  sections.push(`# ${name} — Decision log`);
  sections.push("");
  sections.push(
    "Compiled from a WhyLog decision log. Every decision the log holds is here, including the " +
      "superseded and unsupported ones — unlike the agent files, which carry only what is " +
      "currently in force. A reversal is the most useful sentence in a decision log, and it exists " +
      "only in the records an agent should not see.",
  );
  sections.push("");
  sections.push(
    "Each entry is a belief held under assumptions. The **Context** is the set of conditions that " +
      "made it right; when one of them stops holding, the decision stops being justified, and that " +
      "is a supersession rather than a mistake.",
  );
  sections.push("");

  sections.push("## Summary");
  sections.push("");
  sections.push("| | |");
  sections.push("|---|---|");
  sections.push(`| Decisions rendered | ${cif.records.length} |`);
  sections.push(
    `| Inline / linked out | ${cif.stats.decisionsIncluded} / ${cif.stats.decisionsLinkedOut} |`,
  );
  sections.push(`| Excluded from the agent files | ${cif.stats.decisionsExcluded} |`);
  sections.push(`| Compliance | ${Math.round(cif.stats.compliance * 100)}% |`);
  sections.push(`| Verifiable coverage | ${Math.round(cif.stats.verifiableCoverage * 100)}% |`);
  sections.push(`| Log head | \`${cif.headHash}\` |`);
  sections.push(`| Generated | ${cif.generatedAt} |`);
  sections.push("");

  if (cif.records.length === 0) sections.push("_The log holds no decisions._");

  for (const record of cif.records) {
    sections.push(renderAdr(record, narratives.get(record.id)));
    sections.push("");
  }

  if (cif.rejected.length > 0) {
    sections.push("## Rejected alternatives");
    sections.push("");
    sections.push(
      "Recorded so nobody re-litigates them by accident. Each carries the reason and the status of " +
        "the premise that reason rests on — a rejection whose premise has since been falsified is " +
        "an invitation to revisit, not a rule to obey.",
    );
    sections.push("");
    sections.push("| Alternative | Decision | Reason | Premise status |");
    sections.push("|---|---|---|---|");

    for (const entry of cif.rejected) {
      sections.push(
        `| **${entry.value}** | ${entry.decisionId} | ${entry.why} | ${entry.premiseStatus}${entry.contested ? " ⚠ **UNDER REVIEW**" : ""} |`,
      );
    }
    sections.push("");
  }

  if (cif.index.length > 0) {
    sections.push("## Linked out of the agent files");
    sections.push("");
    sections.push(
      "These are in force but did not fit the agent files' token budget, so they appear there as " +
        "one-line index entries pointing here.",
    );
    sections.push("");
    for (const entry of cif.index) {
      sections.push(`- ${entry.id} · ${entry.imperative}`);
    }
    sections.push("");
  }

  sections.push(stampBlock);

  return sections.join("\n");
}

function renderAdr(record: ExportRecord, narrative: DecisionNarrative | undefined): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("");
  lines.push(`## ${record.id} — ${narrative?.yStatement ?? record.imperative}`);
  lines.push("");

  lines.push(renderStatus(record));
  if (narrative !== undefined) {
    lines.push(
      `Lifecycle: ${narrative.status} · Variable: ${narrative.variable} = ${narrative.value} · Origin: ${narrative.origin} (confidence ${narrative.confidence.toFixed(2)}) · Entrenchment ${narrative.entrenchment.toFixed(2)} · Decided ${narrative.decidedAt.slice(0, 10)}`,
    );
  }
  lines.push("");

  /* ---- context ---- */
  lines.push("### Context");
  lines.push("");
  if (record.becauseText.length > 0) {
    lines.push("Held under these assumptions:");
    lines.push("");
    for (const premiseId of record.becausePremiseIds) {
      lines.push(`- \`${premiseId}\` — ${premiseTextFor(record, premiseId)}`);
    }
    lines.push("");
    lines.push(
      "If any of these stops being true, this decision stops being justified. That is not a " +
        "violation of the decision; it is the condition for revisiting it.",
    );
    if (record.contestedPremise) {
      lines.push("");
      lines.push(
        "**At least one of these premises is contested** — neither confirmed nor refuted.",
      );
    }
  } else {
    lines.push(
      "**No premises recorded.** This decision was captured without the conditions that made it " +
        "right, so nothing can falsify it and nothing would tell you when to stop following it. " +
        "That is a gap in the log worth filling.",
    );
  }
  lines.push("");

  /* ---- decision ---- */
  lines.push("### Decision");
  lines.push("");
  lines.push(record.imperative);
  if (narrative?.rationale !== undefined && narrative.rationale.length > 0) {
    lines.push("");
    lines.push(`Rationale: ${narrative.rationale}`);
  }
  if (record.appliesTo.length > 0) {
    lines.push("");
    lines.push(`Applies to: ${record.appliesTo.map((glob) => `\`${glob}\``).join(", ")}`);
  }
  lines.push("");

  /* ---- consequences ---- */
  lines.push("### Consequences");
  lines.push("");
  if (narrative?.acceptedDownside !== undefined && narrative.acceptedDownside.length > 0) {
    lines.push(`Accepted downside: ${narrative.acceptedDownside}`);
    lines.push("");
  }
  if (record.verifyCommand !== undefined) {
    lines.push("Verified by:");
    lines.push("");
    lines.push("```sh");
    lines.push(record.verifyCommand);
    lines.push("```");
    lines.push("");
    lines.push(
      `Guards ${record.guardsPassing}/${record.guardsTotal} passing${record.failingGuard ? " — **currently failing**" : ""}${record.lastVerifiedAt !== undefined ? ` · last verified ${record.lastVerifiedAt.slice(0, 10)}` : ""}.`,
    );
  } else {
    lines.push(
      "**Unverifiable.** No guard could be compiled from this decision, so nothing checks whether " +
        "it still holds. It is recorded because it is believed, not because it is enforced.",
    );
  }
  lines.push("");

  /* ---- alternatives ---- */
  if (record.rejected.length > 0) {
    lines.push("### Alternatives considered");
    lines.push("");
    for (const entry of record.rejected) {
      lines.push(
        `- **${entry.value}**${entry.why === undefined ? " — no reason recorded" : ` — ${entry.why}`}`,
      );
    }
    lines.push("");
  }

  /* ---- related ---- */
  const related = relatedLines(narrative);
  if (related.length > 0) {
    lines.push("### Related");
    lines.push("");
    for (const line of related) lines.push(line);
    lines.push("");
  }

  return lines.join("\n");
}

function relatedLines(narrative: DecisionNarrative | undefined): readonly string[] {
  if (narrative === undefined) return [];

  const out: string[] = [];
  if (narrative.supersedes.length > 0) out.push(`- Supersedes: ${narrative.supersedes.join(", ")}`);
  if (narrative.supersededBy.length > 0)
    out.push(`- **Superseded by: ${narrative.supersededBy.join(", ")}** — this record is history`);
  if (narrative.dependsOn.length > 0) out.push(`- Depends on: ${narrative.dependsOn.join(", ")}`);
  if (narrative.sharesPremiseWith.length > 0) {
    out.push(
      `- Shares a premise with: ${narrative.sharesPremiseWith.join(", ")} — falsifying that premise puts all of them in play at once`,
    );
  }
  if (narrative.conflictsWith.length > 0)
    out.push(`- Recorded conflict with: ${narrative.conflictsWith.join(", ")}`);

  return out;
}

/** `becauseText` is a joined string; the ADR wants one bullet per premise. The ids are on the
 *  record, so the text is split back out rather than re-read from the graph — which would be the
 *  emitter reaching past the CIF. */
function premiseTextFor(record: ExportRecord, premiseId: string): string {
  const marker = ` (${premiseId})`;

  for (const part of record.becauseText.split(", ")) {
    if (part.endsWith(marker)) return part.slice(0, part.length - marker.length);
  }

  return "";
}
