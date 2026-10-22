/**
 * Y-statement formation — 1.3, component 6.
 *
 * Phase 1 · sub-phase 1.3
 * Plan: plan/phase-1-extraction-pipeline.md §1.3
 *
 * ---------------------------------------------------------------------------
 * WHY Y-STATEMENTS RATHER THAN FREE PROSE
 *
 *   "In the context of ⟨premises⟩, facing ⟨concern⟩, we decided for ⟨value⟩
 *    to achieve ⟨quality⟩, accepting ⟨downside⟩."
 *
 * Two properties matter, and neither is about sounding formal:
 *
 *   1. **The slots are named, so they are extractable.** A statement in this form
 *      can be parsed back into premises, concern, value, quality and downside —
 *      which is what lets the export compiler emit `applies_to`, a rationale line
 *      and a guard from ONE field instead of three that can disagree.
 *
 *   2. **The output is self-justifying without prose bloat.** An agent reading
 *      "In the context of a single user and no deployment infrastructure, we
 *      decided for SQLite" learns the boundary condition in the same breath as the
 *      decision. "We use SQLite" teaches it nothing, and it will re-propose
 *      Postgres the moment the project grows a second user.
 *
 * ---------------------------------------------------------------------------
 * `complete` IS THE POINT
 *
 * A Y-statement with two slots missing is not a Y-statement, it is a sentence
 * wearing one. `complete` is false unless every slot was recovered, and a partial
 * is stored as `statement` plus whatever slots were found — never padded with
 * "unspecified" placeholders, which read as content and are not.
 * ---------------------------------------------------------------------------
 */

import type { DecisionVariable } from "@/types/domain";
import { variableFromValue } from "@/ontology/canonicalize";
import type { ClauseFields } from "./rationale";

export interface YStatementSlots {
  readonly variable: DecisionVariable;
  readonly value: string;
  /** The imperative form: "Use SQLite, not Postgres". */
  readonly statement: string;
  /** Supporting conditions — the IN-list, in plain words. */
  readonly context: readonly string[];
  readonly concern: string | null;
  readonly quality: string | null;
  readonly downside: string | null;
}

export interface YStatementResult {
  readonly text: string;
  readonly complete: boolean;
  /** Which slots are missing. Named, because "partial" alone tells the reviewer
   *  nothing about what to add. */
  readonly missing: readonly YSlot[];
}

export type YSlot = "context" | "concern" | "value" | "quality" | "downside";

export const Y_SLOTS: readonly YSlot[] = ["context", "concern", "value", "quality", "downside"];

export const Y_SLOT_LABELS: Readonly<Record<YSlot, string>> = {
  context: "In the context of",
  concern: "facing",
  value: "we decided for",
  quality: "to achieve",
  downside: "accepting",
};

/* -------------------------------------------------------------------------- */
/* Formation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build the slots from what the recognisers recovered.
 *
 * `context` comes from the PREMISES attached to the decision, not from the
 * rationale clause: the rationale is the sentence the human wrote, the premises are
 * the nodes the truth-maintenance layer will actually reason over. Using the
 * premises keeps the Y-statement honest about what the decision rests on — if a
 * premise is later invalidated, the statement names it.
 */
export function slotsFrom(
  variable: DecisionVariable,
  value: string,
  statement: string,
  fields: ClauseFields,
  premiseTexts: readonly string[],
): YStatementSlots {
  return {
    variable,
    value,
    statement,
    context: premiseTexts.filter((text) => text.trim().length > 0).slice(0, 4),
    concern: fields.concern,
    quality: fields.quality,
    downside: fields.downside?.text ?? null,
  };
}

/** Render the slots. Missing slots are OMITTED, not filled with a placeholder. */
export function renderYStatement(slots: YStatementSlots): YStatementResult {
  const missing: YSlot[] = [];
  const parts: string[] = [];

  if (slots.context.length > 0) {
    parts.push(`In the context of ${joinList(slots.context)}`);
  } else {
    missing.push("context");
    parts.push("In the context of this project");
  }

  if (slots.concern !== null) {
    parts.push(`facing ${lowerFirst(slots.concern)}`);
  } else {
    missing.push("concern");
  }

  parts.push(`we decided for ${slots.value}`);

  if (slots.quality !== null) {
    parts.push(`to achieve ${lowerFirst(slots.quality)}`);
  } else {
    missing.push("quality");
  }

  if (slots.downside !== null) {
    parts.push(`accepting ${lowerFirst(slots.downside)}`);
  } else {
    missing.push("downside");
  }

  const text = `${capitalise(joinClauses(parts))}.`;
  return { text, complete: missing.length === 0, missing };
}

/**
 * The short imperative form that goes in `statement`.
 *
 * "Use SQLite, not Postgres" rather than the full Y-statement: the statement is
 * what a timeline row and an export rule show, and both need the decision in as
 * few words as possible. The Y-statement is the long form, stored alongside.
 */
export function imperativeStatement(
  value: string,
  rejected?: readonly string[],
): string {
  const chosen = capitalise(ensureVerb(value));
  if (rejected === undefined || rejected.length === 0) return chosen;
  return `${chosen}, not ${rejected.slice(0, 2).join(" or ")}`;
}

/** A value on its own is a noun; the statement needs a verb. Values that already
 *  read as instructions ("none", "no auth") are left alone. */
function ensureVerb(value: string): string {
  const lower = value.toLowerCase().trim();
  if (lower === "none" || lower === "no auth" || lower.startsWith("no ")) return value.trim();
  if (/^(use|switch|move|migrate|adopt|keep|drop|add|remove|stick)\b/i.test(lower)) return value.trim();
  return `use ${value.trim()}`;
}

/* -------------------------------------------------------------------------- */
/* Parsing back                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Recover the slots from a Y-statement.
 *
 * The inverse of `renderYStatement`, and the reason the form is worth enforcing:
 * Phase 5's export compiler and Phase 3's answer composer both need the slots, and
 * a hand-written ADR in this form parses too. Returns null when the text is not in
 * the form at all, rather than a half-filled result that looks parsed.
 */
export function parseYStatement(text: string): YStatementSlots | null {
  const source = text.trim();
  if (!/^In the context of\b/i.test(source)) return null;

  const context = capture(source, /^In the context of\s+(.+?)(?=,\s*facing\b|,\s*we decided for\b)/i);
  const concern = capture(source, /,\s*facing\s+(.+?)(?=,\s*we decided for\b)/i);
  const value = capture(source, /we decided for\s+(.+?)(?=,\s*to achieve\b|,\s*accepting\b|\.?\s*$)/i);
  const quality = capture(source, /,\s*to achieve\s+(.+?)(?=,\s*accepting\b|\.?\s*$)/i);
  const downside = capture(source, /,\s*accepting\s+(.+?)\.?\s*$/i);

  if (value === null) return null;

  // The variable is not written in the statement, so it is re-derived from the
  // value. `OTHER` is the honest answer when the ontology has no opinion — which
  // is also the signal that the alias table needs this value added.
  return {
    variable: variableFromValue(value.trim())?.variable ?? "OTHER",
    value: value.trim(),
    statement: imperativeStatement(value.trim()),
    context: context === null ? [] : splitList(context),
    concern: concern,
    quality,
    downside,
  };
}

function capture(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  const captured = match?.[1]?.trim();
  return captured === undefined || captured.length === 0 ? null : captured;
}

function splitList(joined: string): readonly string[] {
  return joined
    .split(/\s+and\s+|,\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Prose helpers                                                              */
/* -------------------------------------------------------------------------- */

function joinList(items: readonly string[]): string {
  if (items.length === 1) return (items[0] ?? "").trim();
  const head = items.slice(0, -1).map((i) => i.trim());
  const last = (items[items.length - 1] ?? "").trim();
  return `${head.join(", ")} and ${last}`;
}

function joinClauses(parts: readonly string[]): string {
  return parts.join(", ");
}

function lowerFirst(input: string): string {
  const trimmed = input.trim().replace(/\.$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function capitalise(input: string): string {
  const trimmed = input.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeCompleteness(result: YStatementResult): string {
  if (result.complete) return "all five Y-statement slots recovered";
  return `partial — missing ${result.missing.map((slot) => Y_SLOT_LABELS[slot].toLowerCase()).join(", ")}`;
}
