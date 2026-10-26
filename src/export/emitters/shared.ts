/**
 * The record renderer shared by the agent targets — 5.2 / 5.3.
 *
 * Phase 5 · sub-phases 5.2, 5.3
 *
 * ---------------------------------------------------------------------------
 * ONE RENDERER, THREE AGENT FORMATS
 *
 * `CLAUDE.md`, `AGENTS.md` and `.cursorrules` all want the same thing: the agent-optimized record.
 * What differs between them is the FILE — the heading, the framing, the conventions — not the
 * record.
 *
 * So the record is rendered here, once, and the three emitters wrap it. That is the intermediate
 * form's guarantee pushed one level further down: not only does no emitter read the graph, no
 * emitter renders a record either. A record that read differently in CLAUDE.md than in AGENTS.md
 * would mean an agent following one file disagrees with an agent following the other, about the
 * same decision, from the same log.
 * ---------------------------------------------------------------------------
 */

import type { ExportRecord } from "@/types/export";
/* The Status line is rendered by `record.ts` so that all three agent targets print it identically.
 * It was called here without being imported — the exact blind spot the structural checker has: it
 * verifies that imports RESOLVE, not that every identifier used is declared. */
import { renderStatus } from "../record";

export interface RenderOptions {
  /** Append the gate's annotations inline. On by default for agent files. */
  readonly annotations?: boolean;
  /** The closing instruction. Omitted for `.cursorrules`, whose format is a flat rule list. */
  readonly antiRelitigation?: string;
  /** Heading level. `###` for a sectioned file, `##` for a flat one. */
  readonly heading?: string;
}

/**
 * One record, in the agent-optimized form.
 *
 *   ### WLD-0007 — MUST use SQLite (better-sqlite3). MUST NOT introduce Postgres.
 *   Applies to: src/db/**, package.json
 *   Because: single user (P-0002), no deploy infrastructure (P-0005)
 *   Rejected: Postgres — "deploy complexity" · Supabase — "hosted dependency"
 *   Verify: node -e "..."
 *   Status: IN · sound · guards 2/2 passing · last verified 2026-10-21
 *   Do not re-litigate without superseding this record.
 */
export function renderRecord(record: ExportRecord, options?: RenderOptions): string {
  const heading = options?.heading ?? "###";
  const lines: string[] = [];

  lines.push(heading + " " + record.id + " — " + record.imperative);

  if (record.appliesTo.length > 0) {
    lines.push("Applies to: " + record.appliesTo.join(", "));
  } else {
    /* Emitted rather than omitted. A record with no scope loads into every context, and saying so
     * lets a reader notice the gap and fill it — an absent line reads as "applies everywhere",
     * which may not be what was meant. */
    lines.push("Applies to: (no globs recorded — this rule loads into every context)");
  }

  lines.push(
    record.becauseText.length > 0
      ? "Because: " + record.becauseText
      : "Because: (no premise recorded — nothing can falsify this rule, so nothing would tell you when to stop following it)",
  );

  if (record.rejected.length > 0) {
    lines.push(
      "Rejected: " +
        record.rejected
          .map((entry) => entry.value + (entry.why === undefined ? "" : ' — "' + entry.why + '"'))
          .join(" · "),
    );
  }

  lines.push(
    record.verifyCommand === undefined
      ? "Verify: none — UNVERIFIABLE. No guard could be compiled from this decision."
      : "Verify: " + record.verifyCommand,
  );

  lines.push(renderStatus(record));

  /* Annotations go here, at the point of use. A contested premise or a failing guard mentioned in
   * a summary three sections away is one an agent never sees. */
  if (options?.annotations !== false) {
    if (record.contestedPremise) {
      lines.push(
        "> PREMISE CONTESTED — one of the conditions above is neither confirmed nor refuted. This rule may be about to change; check the log before relying on it.",
      );
    }
    if (record.failingGuard) {
      lines.push(
        "> VERIFY CURRENTLY FAILS — the code does not satisfy this rule right now. Either it has drifted or the decision was reversed in practice and not in the log.",
      );
    }
  }

  if (options?.antiRelitigation !== undefined) lines.push(options.antiRelitigation);

  return lines.join("\n");
}

/** The tier-2 one-liner. Same shape in every agent target, for the same reason. */
export function renderIndexLine(
  id: string,
  imperative: string,
  appliesTo: readonly string[],
  seeAlso: string,
): string {
  return (
    "- " +
    id +
    " · " +
    imperative +
    (appliesTo.length > 0 ? " · " + appliesTo.join(", ") : "") +
    " · see " +
    seeAlso
  );
}
