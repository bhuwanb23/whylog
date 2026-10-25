/**
 * Stamp verification — 5.5.
 *
 * Phase 5 · sub-phase 5.5
 * Plan: plan/phase-5-export-compiler.md §5.5
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS CAN BE WRONG, AND THEY MEAN DIFFERENT THINGS
 *
 *   head mismatch      the log has moved on since this file was written. The file is STALE, and
 *                      the fix is to re-export.
 *   digest mismatch    the file was edited in place while the log stayed put. The file is
 *                      ALTERED, and the fix is to find out who altered it and why.
 *   missing stamp      the file was not produced by WhyLog, or the stamp was removed. Either way
 *                      nothing about it can be trusted, including its contents.
 *   schema incompatible  written by a build whose stamp shape this one cannot parse. Refusing is
 *                      correct: guessing at fields would read a zero as a count.
 *
 * Reporting "mismatch" for all four would be useless, because the remedies are unrelated. So each
 * is its own reason, and `explainVerification` says what to DO.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION IS READ-ONLY UNTIL THE USER ACTS
 *
 * A mismatch produces a report. The `ExportIntegrityMismatch` EVENT is written by the store, not
 * here, because this module is called on every "check my files" action and most of them find
 * nothing — and an event log full of "checked, fine" entries would bury the one that mattered.
 * ---------------------------------------------------------------------------
 */

import type { StampVerification } from "@/types/export";
import { artifactDigest, shortHash, STAMP_MARKER, STAMP_MARKER_END } from "./hash";
import { STAMP_SCHEMA_VERSION } from "./index";

export interface ParsedStamp {
  readonly schemaVersion: number;
  readonly headHash: string;
  readonly generatedAt: string;
  readonly digest: string;
  readonly raw: string;
}

/**
 * Extract the stamp from an artifact's text.
 *
 * Returns null when there is no parseable stamp. It does NOT throw: a file with no stamp is an
 * ordinary finding, and the caller has to be able to report "this file was not written by WhyLog"
 * rather than crash on it.
 */
export function parseStamp(contents: string): ParsedStamp | null {
  const start = contents.lastIndexOf(STAMP_MARKER);
  if (start < 0) return null;

  const payloadStart = start + STAMP_MARKER.length;
  const end = contents.indexOf(STAMP_MARKER_END, payloadStart);
  if (end < 0) return null;

  const raw = contents.slice(payloadStart, end).trim();
  if (raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  const head = typeof record["head"] === "string" ? record["head"] : "";
  if (head.length === 0) return null;

  return {
    schemaVersion: typeof record["v"] === "number" ? record["v"] : 0,
    headHash: head,
    generatedAt: typeof record["at"] === "string" ? record["at"] : "",
    digest: typeof record["digest"] === "string" ? record["digest"] : "",
    raw,
  };
}

export interface VerifyInput {
  /** The artifact's text, as read back from disk or pasted in. */
  readonly contents: string;
  /** The local log's current head. */
  readonly currentHeadHash: string;
}

/**
 * Verify an artifact against the current log.
 *
 * Order matters: schema first, because a stamp from an incompatible build cannot be interpreted
 * at all and every subsequent comparison would be meaningless. Then presence, then head, then
 * digest.
 */
export function verifyStamp(input: VerifyInput): StampVerification {
  const parsed = parseStamp(input.contents);

  if (parsed === null) {
    return {
      ok: false,
      reason: "missing-stamp",
      expected: shortHash(input.currentHeadHash),
    };
  }

  if (parsed.schemaVersion !== STAMP_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "schema-incompatible",
      expected: "v" + STAMP_SCHEMA_VERSION,
      found: "v" + parsed.schemaVersion,
    };
  }

  if (parsed.headHash !== input.currentHeadHash) {
    return {
      ok: false,
      reason: "head-mismatch",
      expected: shortHash(input.currentHeadHash),
      found: shortHash(parsed.headHash),
    };
  }

  /* The head matches, so the log has not moved. If the content digest differs, the file was
   * edited in place — the one case the head hash alone cannot detect. */
  if (parsed.digest.length > 0) {
    const actual = artifactDigest(input.contents);
    if (actual !== parsed.digest) {
      return {
        ok: false,
        reason: "head-mismatch",
        expected: shortHash(parsed.digest),
        found: shortHash(actual),
      };
    }
  }

  return { ok: true };
}

/** What to do about it. Each reason has a different remedy, and saying "mismatch" for all four
 *  would leave the user guessing which one they have. */
export function explainVerification(verification: StampVerification, path: string): string {
  if (verification.ok) {
    return path + " matches the current log head. Nothing to do.";
  }

  switch (verification.reason) {
    case "missing-stamp":
      return (
        path + " carries no WhyLog stamp. Either it was not generated by WhyLog, or the stamp was " +
        "removed — and if the stamp was removed, the contents may have been altered too, so nothing " +
        "in it can be trusted. Re-export to replace it."
      );
    case "schema-incompatible":
      return (
        path + " was stamped by a WhyLog build using stamp schema " + (verification.found ?? "?") +
        "; this build reads " + (verification.expected ?? "?") + ". Refusing to guess at fields it " +
        "cannot parse — a misread count is worse than no count. Re-export from this build."
      );
    case "head-mismatch":
      return (
        path + " does not correspond to the current log. Expected " + (verification.expected ?? "?") +
        ", found " + (verification.found ?? "?") + ". If the log has moved on since this file was " +
        "written, it is STALE — re-export. If the log has NOT moved, the file was edited in place, " +
        "which is worth finding out about: an agent that rewrites a rule without superseding it has " +
        "done exactly what the anti-re-litigation line exists to prevent."
      );
  }
}

/** The event payload shape `ExportIntegrityMismatch` expects, for the store to write. */
export function mismatchPayload(
  path: string,
  expectedHead: string,
  verification: StampVerification,
): { path: string; expectedHead: string; foundHead: string | null } {
  return {
    path,
    expectedHead,
    foundHead: verification.ok ? null : verification.found ?? null,
  };
}
