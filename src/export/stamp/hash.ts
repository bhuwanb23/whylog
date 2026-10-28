/**
 * Export hashing — 5.5.
 *
 * Phase 5 · sub-phase 5.5
 * Plan: plan/phase-5-export-compiler.md §5.5
 *
 * ---------------------------------------------------------------------------
 * TWO HASHES, DOING DIFFERENT JOBS
 *
 *   head hash      the log's own chain head. Says WHICH LOG STATE produced this artifact. It is
 *                  already computed by the hash chain, so it is read, never recalculated — a
 *                  second implementation of the chain head would eventually disagree with the
 *                  first, and then "matches the log" would mean nothing.
 *
 *   artifact digest  a stable hash of the rendered file. Says whether THIS FILE has been altered
 *                  since it was written. The head hash cannot do that: an agent can rewrite
 *                  CLAUDE.md without the log moving at all, and the stamp would still name a head
 *                  that exists.
 *
 * Detecting a rewrite needs both. Head mismatch means the log has moved on and the file is stale;
 * digest mismatch with a matching head means the file was edited in place.
 *
 * ---------------------------------------------------------------------------
 * THIS IS AUDITABILITY, NOT SECURITY
 *
 * Both hashes are unsalted and the algorithm is in this file, so anyone can recompute them. That
 * is the point: the requirement is to be able to say "this artifact corresponds to log head
 * a3f91c…" and later detect that it no longer does. Claiming tamper-PROOFING would be a lie —
 * an agent that can rewrite the file can rewrite the stamp too — and a lie about security is
 * worse than no security, because it stops the user checking.
 * ---------------------------------------------------------------------------
 */

import { hashStable, shortHash } from "@/lib/hash";

/** The stamp line is the last thing in every artifact, and the only part `stamp/verify.ts` needs
 *  to parse. Keeping the marker in one constant means the emitter and the parser cannot disagree
 *  about what they are looking for. */
export const STAMP_MARKER = "<!-- whylog:stamp";
export const STAMP_MARKER_END = "-->";

/** The log's chain head. Read, never recomputed — see the header. */
export function headHashOf(headHash: string): string {
  return headHash.length === 0 ? "empty-log" : headHash;
}

/** A stable digest of an artifact's CONTENT, excluding the stamp itself.
 *
 * Excluding the stamp is what makes the digest stable across re-exports of an unchanged log: if
 * the timestamp were inside the digested text, every export would produce a different digest for
 * identical content, and "unchanged" would be undetectable.
 */
export function artifactDigest(contents: string): string {
  return hashStable(stripStamp(contents));
}

/** Remove the stamp block so a digest covers only the compiled content. */
export function stripStamp(contents: string): string {
  const start = contents.lastIndexOf(STAMP_MARKER);
  if (start < 0) return contents.trim();

  const end = contents.indexOf(STAMP_MARKER_END, start);
  if (end < 0) return contents.slice(0, start).trim();

  return (contents.slice(0, start) + contents.slice(end + STAMP_MARKER_END.length)).trim();
}

/** Re-exported from `lib/hash.ts` rather than reimplemented. A full 64-character hash in a
 *  sentence is unreadable and nobody compares hashes by eye beyond the first few characters, so
 *  the stamp, the mismatch warning and the audit trail all use the same truncation — two versions
 *  would eventually show different prefixes for the same head and make a match look like a
 *  mismatch. */
export { shortHash };
