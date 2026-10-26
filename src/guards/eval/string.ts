/**
 * `string_in_files` / `string_absent_in_files` — 4.3.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 * Docs: docs/04-executable-decision-guards.md §8 (false-positive drift)
 *
 * ---------------------------------------------------------------------------
 * WORD-BOUNDARY MATCHING IS THE WHOLE MITIGATION
 *
 * A bare substring match on "pg" hits "pgp", "pgsql-tools", and any passing mention in a
 * comment. That is the documented failure mode of this kind, and it is why string guards
 * default to `warning` rather than `blocking`: a pattern is far easier to match by accident
 * than a dependency entry is.
 *
 * `compilePattern` from `lib/glob.ts` already implements the boundary, and defaults to it ON.
 * This file does not reimplement matching — it decides WHICH files to search and turns the hit
 * into an evidence string.
 *
 * ---------------------------------------------------------------------------
 * SCOPED BY GLOB, ALWAYS
 *
 * Every string guard carries a glob, and the search is restricted to it. An unscoped
 * `string_absent_in_files: "postgres"` over a whole repository fails on the migration script
 * that moves data OUT of Postgres — a file whose existence is evidence FOR the decision, being
 * reported as evidence against it.
 * ---------------------------------------------------------------------------
 */

import { filterByGlob, findMatchInText } from "@/lib/glob";
import type { StringSpec, VirtualProject } from "@/types/guards";
import { hasFileContents, hasFileListing } from "../project";
import { type Evaluation, SKIP_NO_CONTENTS, SKIP_NO_LISTING } from "./types";

export function evalString(spec: StringSpec, project: VirtualProject): Evaluation {
  /* Both a listing AND contents are needed: the glob scopes the search over the listing, and
   * the contents are what gets searched. Having one without the other means the guard cannot
   * tell "not present" from "not pasted". */
  if (!hasFileListing(project)) return SKIP_NO_LISTING;
  if (!hasFileContents(project)) return SKIP_NO_CONTENTS;

  const scoped = filterByGlob(project.filePaths, spec.glob);
  if (scoped.length === 0) {
    return {
      outcome: "skip",
      evidence: "",
      skipReason:
        "No pasted file matches the scope glob `" +
        spec.glob +
        "`, so there was nothing to search. Widen the glob or paste a file it covers.",
    };
  }

  const withContents = scoped.filter((path) => project.fileContents[path] !== undefined);
  if (withContents.length === 0) {
    return {
      outcome: "skip",
      evidence: "",
      skipReason:
        scoped.length +
        " file(s) match the scope `" +
        spec.glob +
        "` but none of their contents were pasted, so there was nothing to search: " +
        scoped.slice(0, 4).join(", ") +
        (scoped.length > 4 ? ", …" : ""),
    };
  }

  const options = {
    wordBoundary: spec.wordBoundary ?? true,
    caseSensitive: spec.caseSensitive ?? false,
  };

  for (const path of withContents) {
    const text = project.fileContents[path];
    if (text === undefined) continue;

    const hit = findMatchInText(text, spec.pattern, options);
    if (hit === null) continue;

    const quoted = hit.text.length > 160 ? hit.text.slice(0, 157) + "..." : hit.text;
    const where = path + ":" + hit.line;

    if (spec.kind === "string_absent_in_files") {
      return {
        outcome: "fail",
        evidence:
          '"' +
          spec.pattern +
          '" found at ' +
          where +
          " — " +
          JSON.stringify(quoted) +
          (options.wordBoundary
            ? ""
            : " (matched WITHOUT word boundaries, so this may be part of a longer identifier)"),
      };
    }

    /* string_in_files: a hit is a PASS. Return on the first one — the guard asserts presence,
     * not absence, so further hits add nothing to the evidence. */
    return {
      outcome: "pass",
      evidence: '"' + spec.pattern + '" found at ' + where + " — " + JSON.stringify(quoted),
    };
  }

  const searched = withContents.length + " file(s) matching `" + spec.glob + "`";

  if (spec.kind === "string_in_files") {
    return {
      outcome: "fail",
      evidence:
        '"' +
        spec.pattern +
        '" does not appear in ' +
        searched +
        "." +
        (withContents.length < scoped.length
          ? " " +
            (scoped.length - withContents.length) +
            " file(s) in scope had no pasted contents and were not searched."
          : ""),
    };
  }

  return {
    outcome: "pass",
    evidence: '"' + spec.pattern + '" does not appear in ' + searched + ".",
  };
}
