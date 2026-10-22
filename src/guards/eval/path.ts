/**
 * `path_glob_exists` / `path_glob_absent` — 4.3.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 *
 * ---------------------------------------------------------------------------
 * THE DANGEROUS DIRECTION IS `path_glob_exists`
 *
 * Both kinds are deterministic given a listing. But a TRUNCATED listing makes
 * `path_glob_exists` fail against a codebase that is perfectly fine, while making
 * `path_glob_absent` pass against a file that is there. The first is a false alarm and the
 * second is a false all-clear, and the false all-clear is worse: it goes into the compliance
 * score.
 *
 * So both default to `warning` severity rather than `blocking`, and both SKIP rather than
 * evaluate when no listing was pasted at all. What cannot be mitigated is a listing that was
 * pasted but incomplete — which is why `project.ts` reports every line it could not parse, so
 * the user can see the extent of what the interpreter is working from.
 * ---------------------------------------------------------------------------
 */

import { filterByGlob, matchesGlob } from "@/lib/glob";
import type { PathGlobSpec, VirtualProject } from "@/types/guards";
import { hasFileListing } from "../project";
import { type Evaluation, SKIP_NO_LISTING } from "./types";

/** Cap on how many matching paths are quoted into the evidence string. A glob matching 400
 *  files produces a failure message nobody reads, and the first few are enough to act on. */
export const EVIDENCE_PATH_LIMIT = 6;

export function evalPath(spec: PathGlobSpec, project: VirtualProject): Evaluation {
  if (!hasFileListing(project)) return SKIP_NO_LISTING;

  const matches = filterByGlob(project.filePaths, spec.glob);

  if (spec.kind === "path_glob_exists") {
    if (matches.length === 0) {
      return {
        outcome: "fail",
        evidence: `No file matches \`${spec.glob}\` among the ${project.filePaths.length} path(s) in the pasted listing. If the listing was partial, this failure may be an artifact of the paste rather than of the codebase.`,
      };
    }

    return {
      outcome: "pass",
      evidence: `${matches.length} file(s) match \`${spec.glob}\`: ${quote(matches)}`,
    };
  }

  /* path_glob_absent */
  if (matches.length > 0) {
    return {
      outcome: "fail",
      evidence: `${matches.length} file(s) match \`${spec.glob}\` but none should: ${quote(matches)}`,
    };
  }

  return {
    outcome: "pass",
    evidence: `No file matches \`${spec.glob}\` among the ${project.filePaths.length} path(s) in the listing. Note that this passes on the listing as pasted — a file that exists but was not listed is invisible to it.`,
  };
}

function quote(paths: readonly string[]): string {
  const shown = paths
    .slice(0, EVIDENCE_PATH_LIMIT)
    .map((path) => path)
    .join(", ");
  return paths.length > EVIDENCE_PATH_LIMIT ? `${shown}, … (${paths.length} total)` : shown;
}

/** Whether a glob matches anything in the pasted listing. Used by synthesis to check that a
 *  decision's `applies_to` globs describe something real before proposing a guard over them —
 *  a guard scoped to a glob that matches nothing can only ever skip, and proposing one is
 *  proposing noise. Returns false, rather than true, when there is no listing: without a
 *  listing nothing is known about the project's paths, and claiming a glob matches would be
 *  inventing a fact. */
export function globHasMatches(project: VirtualProject, glob: string): boolean {
  if (!hasFileListing(project)) return false;
  return project.filePaths.some((path) => matchesGlob(path, glob));
}
