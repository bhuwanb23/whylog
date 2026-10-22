/**
 * Identifier minting.
 *
 * Phase 0 · sub-phase 0.4
 * Plan: plan/phase-0-foundation.md §0.4
 *
 * Ids are STABLE, ADDRESSABLE, SEQUENTIAL, never renumbered and never reused.
 * A review comment, a commit message, a CI failure or the agent itself must be
 * able to cite the exact decision by id, forever.
 */

import type {
  AlternativeId,
  DecisionId,
  EpisodeId,
  EventId,
  ExportId,
  GuardId,
  JustificationId,
  NogoodId,
  PremiseId,
  ProposalId,
  TranscriptId,
} from "@/types/common";
import { hash128 } from "./hash";

/* -------------------------------------------------------------------------- */
/* Sequential counters                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A counter that only ever moves forward. Persisted with the log so ids survive
 * a reload, and monotonically increasing so ids sort chronologically by issue
 * order (which is NOT the same as valid-time order — see bi-temporal.ts).
 */
export interface IdCounter {
  readonly next: number;
}

export const zeroCounter = (): IdCounter => ({ next: 1 });

export function takeId(counter: IdCounter): { id: number; counter: IdCounter } {
  return { id: counter.next, counter: { next: counter.next + 1 } };
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                 */
/* -------------------------------------------------------------------------- */

const pad = (n: number, width = 4): string => String(n).padStart(width, "0");

/** WLD-0007 */
export const formatDecisionId = (n: number): DecisionId => `WLD-${pad(n)}` as DecisionId;

/** P-0002 */
export const formatPremiseId = (n: number): PremiseId => `P-${pad(n)}` as PremiseId;

/** J-0007 */
export const formatJustificationId = (n: number): JustificationId =>
  `J-${pad(n)}` as JustificationId;

/** G-0007a — decision id plus a letter suffix. */
export const formatGuardId = (decisionId: DecisionId, suffix: string): GuardId =>
  `G-${decisionId.slice(4)}${suffix}` as GuardId;

/** T-0001 */
export const formatTranscriptId = (n: number): TranscriptId => `T-${pad(n)}` as TranscriptId;

/** E-0003 */
export const formatEpisodeId = (n: number): EpisodeId => `E-${pad(n)}` as EpisodeId;

/** A-0007-1 */
export const formatAlternativeId = (decisionId: DecisionId, n: number): AlternativeId =>
  `A-${decisionId.slice(4)}-${n}` as AlternativeId;

/** NG-0001 */
export const formatNogoodId = (n: number): NogoodId => `NG-${pad(n)}` as NogoodId;

/** RP-0001 */
export const formatProposalId = (n: number): ProposalId => `RP-${pad(n)}` as ProposalId;

/** X-0001 */
export const formatExportId = (n: number): ExportId => `X-${pad(n)}` as ExportId;

/**
 * Event ids are monotonic AND sortable, but not sequential integers: an import
 * can bring in events issued elsewhere. `EV-<ms>-<seq>-<rand>` sorts by time
 * first and stays unique under concurrent minting.
 */
export const formatEventId = (atMs: number, seq: number): EventId =>
  `EV-${atMs.toString(36)}-${pad(seq, 6)}` as EventId;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

export interface ParsedGuardId {
  readonly decisionId: DecisionId;
  readonly suffix: string;
}

export function parseGuardId(id: GuardId): ParsedGuardId | null {
  const match = /^G-(\d{4})([a-z])$/.exec(id);
  if (!match) return null;
  const [, digits, suffix] = match as unknown as [string, string, string];
  return { decisionId: `WLD-${digits}` as DecisionId, suffix };
}

export function nextGuardSuffix(existing: readonly GuardId[]): string {
  const used = new Set(
    existing.flatMap((id) => {
      const parsed = parseGuardId(id);
      return parsed ? [parsed.suffix] : [];
    }),
  );
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(letter)) return letter;
  }
  // More than 26 guards on one decision is a smell, but do not crash.
  return `z${used.size}`;
}

/* -------------------------------------------------------------------------- */
/* Fingerprints                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Content fingerprint for DEDUP DETECTION ONLY — never for identity.
 *
 * Two decisions with the same variable and canonical value are probably the same
 * decision, but the identity is the sequential id, because a decision can be
 * edited and its fingerprint would then change while its citations must not.
 */
export const decisionFingerprint = (variable: string, canonicalValue: string): string =>
  hash128(`${variable}\u0000${canonicalValue}`);

/** Premise identity is PREDICATE-FIRST: `type.predicate`. */
export const premiseFingerprint = (type: string, predicate: string): string =>
  hash128(`${type}\u0000${predicate}`);

/** A fingerprint over a verbatim snippet, used to detect the same sentence
 *  being extracted twice from two imports of the same transcript. */
export const snippetFingerprint = (transcriptHash: string, start: number, end: number): string =>
  hash128(`${transcriptHash}\u0000${start}\u0000${end}`);
