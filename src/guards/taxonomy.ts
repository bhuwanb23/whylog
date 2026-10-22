/**
 * Guard taxonomy — 4.1.
 *
 * Phase 4 · sub-phase 4.1
 * Plan: plan/phase-4-executable-guards.md §4.1
 * Docs: docs/04-executable-decision-guards.md §3
 *
 * ---------------------------------------------------------------------------
 * EIGHT KINDS, ORDERED BY DETERMINISM
 *
 * The ordering is not cosmetic — it is the rule the synthesiser follows. "Prefer the
 * highest-determinism guard that expresses the decision" means: when two kinds could both
 * express a decision, the more deterministic one wins, and `llm_judge` is only reached when
 * nothing else can say what a violation looks like.
 *
 * It is also the ranking used by the per-decision cap (§4.7). Three guards per decision means
 * something has to be dropped, and what gets dropped must be the least trustworthy kind
 * rather than whichever happened to be generated last.
 *
 * ---------------------------------------------------------------------------
 * THE TWO AXES ARE DIFFERENT AND BOTH MATTER
 *
 *   deterministic?   does the result depend only on the inputs, with no model and no shell
 *   browser-runnable? can it be evaluated HERE, against a pasted virtual project
 *
 * The six deterministic kinds are exactly the six browser-runnable ones, which is convenient
 * but not a definition: `command_exit_zero` is deterministic in principle and unrunnable here,
 * because there is no shell. `llm_judge` is runnable here with a key and non-deterministic
 * without one. Keeping the axes separate is what lets the Deterministic Ratio metric and the
 * compliance score mean different things — and they must, because a judged verdict laundered
 * into a compliance number is a number nobody can reproduce.
 * ---------------------------------------------------------------------------
 */

import type { GuardKind, GuardSeverity } from "@/types/guards";
import { DEFAULT_SEVERITY, isBrowserRunnable, isDeterministic } from "@/types/guards";

export interface KindMeta {
  readonly kind: GuardKind;
  /** One line, for the tooltip. Written for a person deciding whether this is the right kind
   *  of check for their decision. */
  readonly asserts: string;
  readonly deterministic: boolean;
  readonly browserRunnable: boolean;
  readonly defaultSeverity: GuardSeverity;
  /** Lower is more deterministic. The synthesiser's preference order and the cap's ranking. */
  readonly rank: number;
  /** Where it can be evaluated at all. */
  readonly target: "virtual-project" | "export-only" | "requires-key";
  readonly why: string;
}

/** The taxonomy, most deterministic first. Derived from the contract's own constants so the
 *  two cannot drift apart. */
export const TAXONOMY: readonly KindMeta[] = [
  {
    kind: "dependency_present",
    asserts: "A package IS in the dependency tree.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "blocking",
    rank: 0,
    target: "virtual-project",
    why: "A dependency entry is a single parsed field with no ambiguity in it. This is the most reliable check available, which is why it is `blocking` by default.",
  },
  {
    kind: "dependency_absent",
    asserts: "A package is NOT present — typically a rejected alternative.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "blocking",
    rank: 1,
    target: "virtual-project",
    why: "The natural expression of a REJECTED alternative, and the guard that catches the most common form of drift: someone installs the thing you turned down.",
  },
  {
    kind: "path_glob_absent",
    asserts: "No files match a glob.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "warning",
    rank: 2,
    target: "virtual-project",
    why: "Deterministic given a file listing, but a listing may be partial — which is why it is `warning` rather than `blocking`, and why it SKIPs rather than passes when no listing was pasted.",
  },
  {
    kind: "path_glob_exists",
    asserts: "Files matching a glob DO exist.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "warning",
    rank: 3,
    target: "virtual-project",
    why: "Same caveat as `path_glob_absent`, in the more dangerous direction: a truncated listing makes this fail against a codebase that is perfectly fine.",
  },
  {
    kind: "string_absent_in_files",
    asserts: "A pattern does NOT appear within a glob.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "warning",
    rank: 4,
    target: "virtual-project",
    why: "Word-boundary matching by default, because a bare substring match on \"pg\" hits \"pgp\", \"pgsql-tools\" and any passing comment. Needs file CONTENTS, not just paths, so it skips more often than the path guards.",
  },
  {
    kind: "string_in_files",
    asserts: "A pattern APPEARS within a glob.",
    deterministic: true,
    browserRunnable: true,
    defaultSeverity: "warning",
    rank: 5,
    target: "virtual-project",
    why: "The weakest of the deterministic six: a string can appear for reasons unrelated to the decision, so a pass is weak evidence and a fail is worth reading rather than acting on.",
  },
  {
    kind: "command_exit_zero",
    asserts: "An arbitrary command exits 0.",
    deterministic: false,
    browserRunnable: false,
    defaultSeverity: "warning",
    rank: 6,
    target: "export-only",
    why: "Deterministic in principle but ENVIRONMENT-dependent in practice: it depends on installed tooling, network state and whatever the command touches. It can only be exported to CI, never run here — and pretending otherwise would produce a skip labelled as a failure.",
  },
  {
    kind: "llm_judge",
    asserts: "A rubric verdict over a diff or file set.",
    deterministic: false,
    browserRunnable: true,
    defaultSeverity: "warning",
    rank: 7,
    target: "requires-key",
    why: "The last resort. Non-deterministic, requires a key, and its verdicts are scored SEPARATELY from compliance — a model's opinion laundered into a compliance number is a number nobody can reproduce.",
  },
];

const BY_KIND = new Map<GuardKind, KindMeta>(TAXONOMY.map((meta) => [meta.kind, meta]));

export function metaOf(kind: GuardKind): KindMeta | undefined {
  return BY_KIND.get(kind);
}

export function assertsOf(kind: GuardKind): string {
  return BY_KIND.get(kind)?.asserts ?? kind;
}

export function whyOf(kind: GuardKind): string {
  return BY_KIND.get(kind)?.why ?? "";
}

/** The kinds the interpreter can actually run here. Used to decide skip vs evaluate, and to
 *  tell the user why a guard did not run rather than showing it as passing. */
export function runnableHere(kind: GuardKind): boolean {
  return isBrowserRunnable(kind) && isDeterministic(kind);
}

/** The deterministic six, for the health panel's ratio. */
export function deterministicKinds(): readonly GuardKind[] {
  return TAXONOMY.filter((meta) => meta.deterministic).map((meta) => meta.kind);
}

export function defaultSeverityOf(kind: GuardKind): GuardSeverity {
  /* Falls back to the contract's table rather than to a literal, so there is one source of
   * truth for severity policy. */
  return BY_KIND.get(kind)?.defaultSeverity ?? DEFAULT_SEVERITY[kind];
}

/** The taxonomy as text, for the Guards view's reference panel. Listing the eight kinds with
 *  their determinism and default severity is what makes "prefer the most deterministic kind"
 *  a rule the user can check the synthesiser against. */
export function describeTaxonomy(): string {
  const lines = [
    "Eight guard kinds, most deterministic first. The synthesiser prefers the highest-determinism",
    "kind that expresses the decision; llm_judge is a last resort.",
    "",
  ];

  for (const meta of TAXONOMY) {
    lines.push(
      "  " + String(meta.rank + 1) + ". " + meta.kind.padEnd(24) +
        (meta.deterministic ? "deterministic  " : "NON-deterministic") +
        (meta.browserRunnable ? " runs here   " : " export only  ") +
        meta.defaultSeverity.padEnd(9) +
        meta.asserts,
    );
  }

  lines.push(
    "",
    "Determinism and browser-runnability are SEPARATE axes. command_exit_zero is deterministic in",
    "principle and unrunnable here (no shell); llm_judge is runnable with a key and",
    "non-deterministic. Keeping them apart is what lets the Deterministic Ratio and the",
    "compliance score mean different things — and they must, because a judged verdict laundered",
    "into a compliance number is a number nobody can reproduce.",
  );

  return lines.join("\n");
}

/** Per-kind detail, for a tooltip or the reference drawer. */
export function describeKind(kind: GuardKind): string {
  const meta = BY_KIND.get(kind);
  if (meta === undefined) return kind;

  return [
    meta.kind,
    "  asserts:      " + meta.asserts,
    "  deterministic:" + (meta.deterministic ? " yes" : " no"),
    "  runs here:    " + (meta.browserRunnable ? " yes" : " no — " + meta.target),
    "  severity:     " + meta.defaultSeverity + " by default",
    "",
    "  " + meta.why,
  ].join("\n");
}
