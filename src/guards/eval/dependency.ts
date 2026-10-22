/**
 * `dependency_present` / `dependency_absent` — 4.3.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 *
 * The two most reliable kinds in the taxonomy, and the ones that make gate G4 demonstrable in
 * ten seconds. A dependency entry is a single parsed field with no ambiguity in it: no glob to
 * mis-scope, no pattern to over-match, no file contents to have forgotten to paste.
 *
 * `dependency_absent` is the natural expression of a REJECTED alternative, and it catches the
 * most common form of drift there is — someone installs the thing you turned down six weeks ago
 * and nothing tells them.
 */

import type { DependencySpec, VirtualProject } from "@/types/guards";
import { findDependency, hasManifest } from "../project";
import type { Evaluation } from "./types";

/**
 * Does `includeDev` default on or off?
 *
 * Asymmetric, and deliberately: an ABSENCE guard must check devDependencies, because a rejected
 * alternative installed as a dev dependency is still installed. A PRESENCE guard should not,
 * because a build-only dependency does not mean the decision was implemented — `pg` in
 * devDependencies alongside a SQLite decision is a migration script, not a reversal.
 */
export function includeDevDefault(kind: DependencySpec["kind"]): boolean {
  return kind === "dependency_absent";
}

export function evalDependency(spec: DependencySpec, project: VirtualProject): Evaluation {
  if (!hasManifest(project)) {
    return {
      outcome: "skip",
      evidence: "",
      skipReason:
        "No package.json was pasted, so there is no dependency tree to check. Paste one — this guard needs the manifest and nothing else.",
    };
  }

  const includeDev = spec.includeDev ?? includeDevDefault(spec.kind);
  const found = findDependency(project, spec.package, includeDev);

  if (spec.kind === "dependency_present") {
    if (found === null) {
      return {
        outcome: "fail",
        evidence: `"${spec.package}" is not in package.json${includeDev ? " (checked dependencies and devDependencies)" : " (checked dependencies only; devDependencies were not in scope for this guard)"}. Present packages: ${summarise(project, includeDev)}`,
      };
    }

    return {
      outcome: "pass",
      evidence: `"${spec.package}": "${found.version}" is present in ${found.dev ? "devDependencies" : "dependencies"}`,
    };
  }

  /* dependency_absent */
  if (found !== null) {
    return {
      outcome: "fail",
      evidence: `"${spec.package}": "${found.version}" found in package.json ${found.dev ? "devDependencies" : "dependencies"}.`,
    };
  }

  return {
    outcome: "pass",
    evidence: `"${spec.package}" does not appear in package.json${includeDev ? " dependencies or devDependencies." : " dependencies (devDependencies were not in scope)."}`,
  };
}

/** The failure evidence names what IS there, because "not found" on its own leaves the user
 *  guessing whether the guard looked in the right place. */
function summarise(project: VirtualProject, includeDev: boolean): string {
  const names = [
    ...Object.keys(project.dependencies),
    ...(includeDev ? Object.keys(project.devDependencies) : []),
  ];

  if (names.length === 0) return "(none)";
  const shown = names.slice(0, 12).join(", ");
  return names.length > 12 ? `${shown}, … (${names.length} total)` : shown;
}
