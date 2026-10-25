/**
 * Three consecutive dry runs — 7.5.
 *
 * Phase 7 · sub-phase 7.5
 *
 * ---------------------------------------------------------------------------
 * WHY THREE, AND WHY CONSECUTIVE
 *
 * §7.5 requires three consecutive dry runs. Not one, because a single run cannot distinguish a working
 * demo from a lucky one. Not two, because two agreeing runs are consistent with a cache that was warm
 * after the first. Three is the smallest number at which agreement starts to mean something about
 * determinism rather than about warm state.
 *
 * Consecutive matters more than the count. Three runs with a rebuild in between test the build; three
 * runs back to back test that the SECOND and THIRD start from whatever the first left behind — which is
 * the actual failure mode, because a demo that only works from a cold start is a demo that cannot be
 * repeated for a second judge who walks up to the table afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS COMPARED
 *
 * Node counts, label assignments and contradiction records. Not timings and not id strings: timings
 * vary with machine load and comparing them would produce a "non-deterministic" verdict for a run that
 * is perfectly reproducible, which teaches the presenter to ignore the report.
 *
 * Ids ARE compared, but only for stability across runs, not for value — a run that mints different ids
 * from the same input has a counter that depends on something other than the input, and that is a real
 * defect worth catching even though the specific ids do not matter.
 * ---------------------------------------------------------------------------
 */

import type { SeedResult } from "./kit";
import { buildSeed } from "./kit";
import { verifyDemo, type VerificationReport } from "./verify";

export const REQUIRED_DRY_RUNS = 3;

export interface DryRunFingerprint {
  readonly decisions: number;
  readonly premises: number;
  readonly alternatives: number;
  readonly guards: number;
  readonly contradictions: number;
  readonly justifications: number;
  /** Sorted decision ids. Compared for stability, not for value. */
  readonly decisionIds: readonly string[];
  /** Sorted `id=label` pairs. This is the comparison that matters: a cascade that fires on run one and
   *  not on run two produces identical counts and different labels, and counts alone would pass it. */
  readonly labels: readonly string[];
  readonly durationMs: number;
}

export interface DryRun {
  readonly n: number;
  readonly fingerprint: DryRunFingerprint;
  /** Null when the run threw. A stub report would look like a real one in the table. */
  readonly verification: VerificationReport | null;
  readonly warnings: readonly string[];
  readonly error: string | null;
}

export interface DryRunReport {
  readonly runs: readonly DryRun[];
  readonly deterministic: boolean;
  readonly divergences: readonly string[];
  readonly allDemoable: boolean;
  readonly passed: boolean;
}

/**
 * Run the demo dry-run sequence.
 *
 * Deliberately does NOT reset between runs. That is the point: run two and run three start from whatever
 * run one left in storage, which is exactly the condition a second judge at the table reproduces. A
 * harness that reset between runs would be testing a scenario nobody encounters.
 */
export async function runDryRuns(count: number = REQUIRED_DRY_RUNS): Promise<DryRunReport> {
  const runs: DryRun[] = [];

  for (let n = 1; n <= count; n += 1) {
    const started = Date.now();
    try {
      const seed = await buildSeed();
      runs.push({
        n,
        fingerprint: fingerprintOf(seed, Date.now() - started),
        verification: verifyDemo(seed),
        warnings: seed.warnings,
        error: null,
      });
    } catch (error) {
      /* No verification is attempted on a run that threw. Building a stub report to fill the slot would
       * print a row of zeros that looks like a measured result, and the whole point of the table is that
       * every number in it came from a run that completed. */
      runs.push({
        n,
        fingerprint: emptyFingerprint(Date.now() - started),
        verification: null,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const divergences = compare(runs);

  return {
    runs,
    divergences,
    deterministic: divergences.length === 0,
    allDemoable: runs.every((run) => run.verification !== null && run.verification.demoable),
    /* Passing requires determinism AND demoability across all three. A demo that works differently each
     * time is not a demo that can be relied on, even if each individual run looked fine. */
    passed: divergences.length === 0 && runs.every((run) => run.verification !== null && run.verification.demoable),
  };
}

function fingerprintOf(seed: SeedResult, durationMs: number): DryRunFingerprint {
  const decisions = [...seed.state.decisions.values()];

  return {
    decisions: decisions.length,
    premises: seed.state.premises.size,
    alternatives: seed.state.alternatives.size,
    guards: seed.state.guards.size,
    contradictions: seed.state.contradictions.length,
    justifications: seed.state.justifications.size,
    decisionIds: decisions.map((decision) => String(decision.id)).sort(),
    labels: decisions.map((decision) => decision.id + "=" + decision.label).sort(),
    durationMs,
  };
}

function emptyFingerprint(durationMs: number): DryRunFingerprint {
  return {
    decisions: 0, premises: 0, alternatives: 0, guards: 0, contradictions: 0, justifications: 0,
    decisionIds: [], labels: [], durationMs,
  };
}

function compare(runs: readonly DryRun[]): readonly string[] {
  const out: string[] = [];
  const first = runs[0];
  if (first === undefined) return ["no runs completed"];

  for (const run of runs.slice(1)) {
    if (run.error !== null) {
      out.push("run " + run.n + " threw: " + run.error);
      continue;
    }
    if (first.error !== null) continue;

    const fields: (keyof DryRunFingerprint)[] = [
      "decisions", "premises", "alternatives", "guards", "contradictions", "justifications",
    ];

    for (const field of fields) {
      const a = first.fingerprint[field];
      const b = run.fingerprint[field];
      if (typeof a === "number" && typeof b === "number" && a !== b) {
        out.push(field + ": run 1 had " + a + ", run " + run.n + " had " + b);
      }
    }

    if (first.fingerprint.labels.join("|") !== run.fingerprint.labels.join("|")) {
      const differing = run.fingerprint.labels.filter((entry) => !first.fingerprint.labels.includes(entry));
      out.push(
        "LABELS DIVERGED between run 1 and run " + run.n + " — the same input produced different " +
        "epistemic states. Counts alone would not have caught this. Differing: " +
        (differing.length === 0 ? "(reordered only)" : differing.slice(0, 6).join(", ")),
      );
    }

    if (first.fingerprint.decisionIds.join("|") !== run.fingerprint.decisionIds.join("|")) {
      out.push("IDS DIVERGED between run 1 and run " + run.n + " — a counter depends on something other than the input.");
    }
  }

  return out;
}

export function renderDryRuns(report: DryRunReport): string {
  const lines: string[] = [];

  lines.push("DRY RUNS — " + report.runs.length + " consecutive, no reset between them");
  lines.push(report.passed ? "PASSED: deterministic and demoable across all runs." : "NOT PASSED.");
  lines.push("");

  lines.push("Run".padEnd(5) + "dec".padStart(5) + "prem".padStart(6) + "alt".padStart(5) +
    "grd".padStart(5) + "contra".padStart(8) + "just".padStart(6) + "  verified/manual/failed".padEnd(26) + "secs");
  lines.push("-".repeat(78));

  for (const run of report.runs) {
    const f = run.fingerprint;
    const v = run.verification;
    if (v === null) {
      lines.push(String(run.n).padEnd(5) + "  THREW — " + (run.error ?? "unknown"));
      continue;
    }
    lines.push(
      String(run.n).padEnd(5) +
      String(f.decisions).padStart(5) + String(f.premises).padStart(6) + String(f.alternatives).padStart(5) +
      String(f.guards).padStart(5) + String(f.contradictions).padStart(8) + String(f.justifications).padStart(6) +
      ("  " + v.verified + "/" + v.manual + "/" + v.failed).padEnd(26) +
      (f.durationMs / 1000).toFixed(1),
    );
  }

  lines.push("");
  lines.push("Timings are shown but NOT compared: they vary with machine load, and treating a slow run as");
  lines.push("non-determinism teaches the presenter to ignore this report.");

  if (report.divergences.length > 0) {
    lines.push("");
    lines.push("DIVERGENCES (" + report.divergences.length + "):");
    for (const divergence of report.divergences) lines.push("  " + divergence);
  } else {
    lines.push("");
    lines.push("No divergences. Runs 2 and 3 started from whatever run 1 left in storage and produced");
    lines.push("identical node counts, identical labels and identical ids.");
  }

  const warnings = report.runs.flatMap((run) => run.warnings.map((warning) => "run " + run.n + ": " + warning));
  if (warnings.length > 0) {
    lines.push("");
    lines.push("WARNINGS:");
    for (const warning of [...new Set(warnings)]) lines.push("  " + warning);
  }

  return lines.join("\n");
}
