/**
 * Event builders.
 *
 * Every builder returns a `NewEvent<T>` — an UNSEALED draft. Sealing happens through the real
 * `appendBatch`, never by hand, because a sealed event carries a minted id, a learned timestamp and
 * a hash-chain link, and a test that fabricates those is testing its own fabrication rather than the
 * substrate. If a draft cannot be sealed the helper THROWS: a test that silently builds on a
 * rejected event reports a pass for a graph that does not exist.
 */
import { appendBatch, emptyLog, type AppendContext, type EventLog } from "@/substrate/event-log";
import { validationMessage } from "@/substrate/event-validation";
import { formatAlternativeId, formatDecisionId, formatEpisodeId, formatGuardId, formatJustificationId, formatPremiseId, formatTranscriptId } from "@/lib/ids";
import { asConfidence, asISO } from "@/types/common";
import type {
  Actor,
  AlternativeId,
  Confidence,
  DecisionId,
  EngineId,
  EpisodeId,
  GuardId,
  ISODateString,
  JustificationId,
  PremiseId,
  SourceSpan,
  TranscriptId,
} from "@/types/common";
import type { AnyEvent, EventType, NewEvent } from "@/types/events";
import type { DecisionLabel, DecisionOrigin, DecisionVariable, Justification, Modality, PremiseType } from "@/types/domain";

export const ACTOR: Actor = { kind: "system" };
export const HUMAN: Actor = { kind: "human" };
export const LOCAL_ENGINE: EngineId = { kind: "local", model: "" };
export const LLM_ENGINE: EngineId = { kind: "llm", model: "test-model" };

/* -------------------------------------------------------------------------- */
/* Clock                                                                       */
/* -------------------------------------------------------------------------- */

const BASE = Date.parse("2026-01-01T00:00:00.000Z");
let cursor = BASE;

/** One second per call. The log enforces monotonic learned time, so a shared advancing clock is
 *  what lets a test append a batch without threading timestamps through every builder. */
export function nextAt(): ISODateString {
  cursor += 1000;
  return asISO(new Date(cursor).toISOString());
}

export function resetClock(): void {
  cursor = BASE;
}

export function at(offsetSeconds: number): ISODateString {
  return asISO(new Date(BASE + offsetSeconds * 1000).toISOString());
}

/* -------------------------------------------------------------------------- */
/* Ids and spans                                                               */
/* -------------------------------------------------------------------------- */

export const transcriptId = (n: number): TranscriptId => formatTranscriptId(n);
export const decisionId = (n: number): DecisionId => formatDecisionId(n) as DecisionId;
export const premiseId = (n: number): PremiseId => formatPremiseId(n) as PremiseId;
export const justificationId = (n: number): JustificationId => formatJustificationId(n);
export const alternativeId = (d: DecisionId, n: number): AlternativeId => formatAlternativeId(d, n);
export const guardId = (d: DecisionId, suffix: string): GuardId => formatGuardId(d, suffix);
export const episodeId = (n: number): EpisodeId => formatEpisodeId(n) as EpisodeId;
export const confidence = (n: number): Confidence => asConfidence(n);

/** A span whose `text` is a literal substring at `start`, which is what snippet validation demands. */
export function span(transcript: TranscriptId, text: string, start = 0): SourceSpan {
  return { transcriptId: transcript, start, end: start + text.length, text };
}

/* -------------------------------------------------------------------------- */
/* Drafts                                                                      */
/* -------------------------------------------------------------------------- */

export function transcriptImported(
  id: TranscriptId,
  raw: string,
  engine: EngineId = LOCAL_ENGINE,
  occurredAt?: ISODateString,
): NewEvent<"TranscriptImported"> {
  return {
    type: "TranscriptImported",
    payload: {
      transcriptId: id,
      rawChars: raw.length,
      engine,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    },
    actor: ACTOR,
    reason: `Test importing transcript ${id}.`,
  };
}

export interface PremiseDraft {
  id: PremiseId;
  transcript: TranscriptId;
  type: PremiseType;
  predicate: string;
  text: string;
  value?: string | number | boolean;
  confidence?: number;
  engine?: EngineId;
  snippet?: SourceSpan;
}

export function premiseAsserted(d: PremiseDraft): NewEvent<"PremiseAsserted"> {
  return {
    type: "PremiseAsserted",
    payload: {
      premiseId: d.id,
      transcriptId: d.transcript,
      type: d.type,
      predicate: d.predicate,
      ...(d.value === undefined ? {} : { value: d.value }),
      text: d.text,
      confidence: confidence(d.confidence ?? 0.8),
      engine: d.engine ?? LOCAL_ENGINE,
      snippet: d.snippet ?? span(d.transcript, d.text),
    },
    actor: ACTOR,
    reason: `Test asserting premise ${d.id} (${d.predicate}).`,
  };
}

export interface DecisionDraft {
  id: DecisionId;
  transcript: TranscriptId;
  episode?: EpisodeId;
  variable: DecisionVariable;
  value: string;
  statement?: string;
  origin?: DecisionOrigin;
  modality?: Modality;
  confidence?: number;
  engine?: EngineId;
  snippet?: SourceSpan;
  premiseIds?: readonly PremiseId[];
  alternativeIds?: readonly AlternativeId[];
}

export function decisionProposed(d: DecisionDraft): NewEvent<"DecisionProposed"> {
  return {
    type: "DecisionProposed",
    payload: {
      decisionId: d.id,
      transcriptId: d.transcript,
      episodeId: d.episode ?? episodeId(1),
      variable: d.variable,
      value: d.value,
      statement: d.statement ?? `Use ${d.value}.`,
      origin: d.origin ?? "human_stated",
      modality: d.modality ?? "asserted",
      confidence: confidence(d.confidence ?? 0.8),
      engine: d.engine ?? LOCAL_ENGINE,
      snippet: d.snippet ?? span(d.transcript, d.statement ?? `Use ${d.value}.`),
      premiseIds: d.premiseIds ?? [],
      alternativeIds: d.alternativeIds ?? [],
    },
    actor: ACTOR,
    reason: `Test proposing decision ${d.id} (${d.variable} → ${d.value}).`,
  };
}

export function alternativeRejected(
  id: AlternativeId,
  decision: DecisionId,
  variable: DecisionVariable,
  value: string,
  whyRejected?: string,
  transcript: TranscriptId = transcriptId(1),
): NewEvent<"AlternativeRejected"> {
  return {
    type: "AlternativeRejected",
    payload: {
      alternativeId: id,
      decisionId: decision,
      variable,
      value,
      ...(whyRejected === undefined ? {} : { whyRejected }),
      confidence: confidence(0.8),
      engine: LOCAL_ENGINE,
      snippet: span(transcript, value),
    },
    actor: ACTOR,
    reason: `Test recording ${value} as rejected in favour of ${decision}.`,
  };
}

/** A Doyle SL-justification. `outList` non-empty is what makes the graph non-monotonic. */
export function justificationAttached(
  id: JustificationId,
  consequent: DecisionId,
  inList: readonly PremiseId[],
  outList: readonly PremiseId[] = [],
  engine: EngineId = LOCAL_ENGINE,
  createdAt: ISODateString = nextAt(),
): NewEvent<"JustificationAttached"> {
  const justification: Justification = {
    id,
    consequent,
    inList,
    outList,
    informant: { kind: "extraction", engine, eventId: "EV-000000-000000" as AnyEvent["id"] },
    createdAt,
  };

  return {
    type: "JustificationAttached",
    payload: { justificationId: id, consequent, justification },
    actor: ACTOR,
    reason:
      `Test attaching a justification for ${consequent}: ${inList.length} supporting premise(s)` +
      (outList.length === 0 ? "." : ` and ${outList.length} excluded condition(s).`),
  };
}

/** A human confirming a premise. Without this the premise stays UNKNOWN, every justification that
 *  rests on it is invalid, and every decision is OUT — which is correct, not a bug: I4 says the
 *  system proposes and the human disposes. Fixtures that test gate (c) must start from a REVIEWED
 *  graph or they test a graph nobody has accepted yet. */
export function premiseConfirmed(id: PremiseId): NewEvent<"PremiseConfirmed"> {
  return {
    type: "PremiseConfirmed",
    payload: { premiseId: id },
    actor: HUMAN,
    reason: `Test confirming premise ${id}: a human has accepted it as stated.`,
  };
}

export function premiseInvalidated(
  id: PremiseId,
  by: "human" | "assertion" | "guard" = "human",
): NewEvent<"PremiseInvalidated"> {
  return {
    type: "PremiseInvalidated",
    payload: {
      premiseId: id,
      invalidatedBy:
        by === "human" ? { kind: "human" } : by === "guard" ? { kind: "guard", guardId: "G-0000a" as GuardId } : { kind: "assertion", eventId: "EV-000000-000000" as AnyEvent["id"] },
    },
    actor: by === "human" ? HUMAN : ACTOR,
    reason: `Test falsifying premise ${id}.`,
  };
}

export function labelChanged(
  nodeId: DecisionId | PremiseId,
  from: DecisionLabel,
  to: DecisionLabel,
  gate: "structural" | "semantic" | "premise" | "cascade" = "premise",
): NewEvent<"LabelChanged"> {
  return {
    type: "LabelChanged",
    payload: { nodeId, from, to, gate },
    actor: ACTOR,
    reason: `Test moving ${nodeId} from ${from} to ${to} via the ${gate} gate.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Sealing                                                                     */
/* -------------------------------------------------------------------------- */

export interface Sealed {
  readonly log: EventLog;
  readonly events: readonly AnyEvent[];
}

/** Append drafts through the real log. Throws on rejection rather than returning a partial chain. */
export function seal(
  drafts: readonly { draft: NewEvent<EventType>; context?: AppendContext }[],
  log: EventLog = emptyLog(),
): Sealed {
  const outcome = appendBatch(
    log,
    drafts.map((entry) => ({
      draft: entry.draft,
      context: entry.context ?? { now: nextAt(), actor: ACTOR, reason: "Test batch." },
    })),
  );

  if (!outcome.ok) {
    throw new Error(`seal() rejected at index ${outcome.failedAt}: ${validationMessage(outcome.validation)}`);
  }

  return { log: outcome.log, events: outcome.log.events };
}

/** Convenience: seal a flat list of drafts with an automatically advancing clock. */
export function sealAll(drafts: readonly NewEvent<EventType>[], log: EventLog = emptyLog()): Sealed {
  return seal(drafts.map((draft) => ({ draft })), log);
}

export { emptyLog, validationMessage };

/** Re-exported so a test can stamp an event without importing `lib/format` separately. */
export { nowISO as nowIsoForTest } from "@/lib/format";
