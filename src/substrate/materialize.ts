/**
 * The fold: log -> state.
 *
 * Phase 0 · sub-phase 0.2
 * Plan: plan/phase-0-foundation.md §0.2
 *
 * ---------------------------------------------------------------------------
 * CONTRACT
 *
 * `fold(events)` is PURE and TOTAL.
 *
 *   PURE  — no clock, no randomness, no I/O, no mutation of its argument.
 *           The same event array always produces a structurally identical state,
 *           which is what makes export -> import -> identical head hash a
 *           testable property rather than a hope.
 *   TOTAL — every one of the 35 event types is handled, and a malformed or
 *           unresolvable event is RECORDED and skipped rather than thrown. A log
 *           that cannot be folded is a log that cannot be loaded, and a log that
 *           cannot be loaded is data loss.
 *
 * Target: full replay of 10^4 events in under 10 ms. The draft uses plain
 * mutable Maps internally and exposes ReadonlyMaps at the boundary, so a rebuild
 * is O(events) with no per-event copying.
 *
 * ---------------------------------------------------------------------------
 * WHY `applyEvent` IS EXPORTED SEPARATELY
 *
 * Incremental append must produce EXACTLY the state a full replay would. Keeping
 * one function that both `fold` and the live append path call is the only way
 * that property survives contact with Phase 2, where the case count grows.
 * ---------------------------------------------------------------------------
 */

import { asConfidence } from "@/types/common";
import type {
  AlternativeId,
  DecisionId,
  EngineId,
  EpisodeId,
  EventId,
  ExportId,
  GuardId,
  ISODateString,
  JustificationId,
  NogoodId,
  PremiseId,
  ProposalId,
  TranscriptId,
} from "@/types/common";
import type {
  Decision,
  DecisionLabel,
  DecisionVariable,
  Episode,
  Justification,
  Nogood,
  Premise,
  PremiseEvidence,
  RejectedAlternative,
  Transcript,
} from "@/types/domain";
import type { AnyEvent } from "@/types/events";
import type { ExportStats } from "@/types/export";
import type { Guard, GuardRunResult } from "@/types/guards";
import type { CascadeResult, NogoodRecord, RevisionProposal } from "@/types/reasoning";
import { entrenchmentBand } from "@/types/reasoning";
import { closeWindow, openWindow, reopenWindow } from "./bi-temporal";
import {
  INDEX_UNBUILT,
  ZERO_COUNTERS,
  type ContradictionRecord,
  type ExportRecordState,
  type GraphState,
} from "./graph-state";
import { GENESIS_HASH, linkHash } from "./hash-chain";
import { SCHEMA_VERSION } from "./schema";

/* -------------------------------------------------------------------------- */
/* The draft                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The mutable working form of {@link GraphState}.
 *
 * Every collection is widened to its mutable counterpart. Nothing outside this
 * module sees a Draft, and `freeze` is the only way out.
 */
export interface Draft {
  events: AnyEvent[];
  headHash: string;
  lastEventId: EventId | null;
  schemaVersion: number;

  decisions: Map<DecisionId, Decision>;
  premises: Map<PremiseId, Premise>;
  justifications: Map<JustificationId, Justification>;
  nogoods: Map<NogoodId, Nogood>;

  transcripts: Map<TranscriptId, Transcript>;
  episodes: Map<EpisodeId, Episode>;
  alternatives: Map<AlternativeId, RejectedAlternative>;

  guards: Map<GuardId, Guard>;
  proposals: Map<ProposalId, RevisionProposal>;
  contradictions: ContradictionRecord[];
  exports: Map<ExportId, ExportRecordState>;

  byVariable: Map<DecisionVariable, DecisionId[]>;
  byFingerprint: Map<string, DecisionId>;
  premiseByFingerprint: Map<string, PremiseId>;
  premiseToDecisions: Map<PremiseId, DecisionId[]>;
  guardIndex: Map<GuardId, DecisionId>;

  pendingReview: DecisionId[];
  pendingPremises: PremiseId[];
  overrides: Map<DecisionId, number>;

  engine: EngineId;
  index: GraphState["index"];
  counters: GraphState["counters"];

  metrics: Map<string, number>;
  computedAt: ISODateString;

  /** Events that could not be applied, in order. Reported, never thrown. */
  skipped: { eventId: EventId; type: string; reason: string }[];
}

/** A fresh draft. `engine` and `at` come from the caller — the fold never reads
 *  a clock, which is the whole of its purity. */
export function emptyDraft(engine: EngineId, at: ISODateString): Draft {
  return {
    events: [],
    headHash: GENESIS_HASH,
    lastEventId: null,
    schemaVersion: SCHEMA_VERSION,

    decisions: new Map(),
    premises: new Map(),
    justifications: new Map(),
    nogoods: new Map(),

    transcripts: new Map(),
    episodes: new Map(),
    alternatives: new Map(),

    guards: new Map(),
    proposals: new Map(),
    contradictions: [],
    exports: new Map(),

    byVariable: new Map(),
    byFingerprint: new Map(),
    premiseByFingerprint: new Map(),
    premiseToDecisions: new Map(),
    guardIndex: new Map(),

    pendingReview: [],
    pendingPremises: [],
    overrides: new Map(),

    engine,
    index: INDEX_UNBUILT,
    counters: ZERO_COUNTERS,

    metrics: new Map(),
    computedAt: at,
    skipped: [],
  };
}

/** Convert a frozen state back into a draft, for incremental append. */
/**
 * Copy a reverse index into the mutable form the draft needs.
 *
 * `GraphState` exposes these as `ReadonlyMap<K, readonly DecisionId[]>` so a projection cannot
 * mutate the graph. `new Map(source)` copies the ENTRIES but keeps the same readonly arrays, which
 * the fold cannot append to and which does not typecheck as the draft's `Map<K, DecisionId[]>`.
 * Copying the arrays too is what makes the draft independent of the state it was cloned from:
 * sharing them would let a fold mutate a graph that is still being read.
 */
function copyIdIndex<K>(source: ReadonlyMap<K, readonly DecisionId[]>): Map<K, DecisionId[]> {
  const out = new Map<K, DecisionId[]>();
  for (const [key, ids] of source) out.set(key, [...ids]);
  return out;
}

export function toDraft(state: GraphState): Draft {
  return {
    events: [...state.events],
    headHash: state.headHash,
    lastEventId: state.lastEventId,
    schemaVersion: state.schemaVersion,

    decisions: new Map(state.decisions),
    premises: new Map(state.premises),
    justifications: new Map(state.justifications),
    nogoods: new Map(state.nogoods),

    transcripts: new Map(state.transcripts),
    episodes: new Map(state.episodes),
    alternatives: new Map(state.alternatives),

    guards: new Map(state.guards),
    proposals: new Map(state.proposals),
    contradictions: [...state.contradictions],
    exports: new Map(state.exports),

    byVariable: copyIdIndex(state.byVariable),
    byFingerprint: new Map(state.byFingerprint),
    premiseByFingerprint: new Map(state.premiseByFingerprint),
    premiseToDecisions: copyIdIndex(state.premiseToDecisions),
    guardIndex: new Map(state.guardIndex),

    pendingReview: [...state.pendingReview],
    pendingPremises: [...state.pendingPremises],
    overrides: new Map(state.overrides),

    engine: state.engine,
    index: state.index,
    counters: state.counters,

    metrics: new Map(state.metrics),
    computedAt: state.computedAt,
    skipped: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Draft helpers                                                              */
/* -------------------------------------------------------------------------- */

function skip(draft: Draft, event: AnyEvent, reason: string): void {
  draft.skipped.push({ eventId: event.id, type: event.type, reason });
}

/** Update one node. Returns false when the node does not exist, so callers can
 *  record a skip rather than silently no-op. */
function patchDecision(
  draft: Draft,
  id: DecisionId,
  patch: (current: Decision) => Decision,
): boolean {
  const current = draft.decisions.get(id);
  if (!current) return false;
  draft.decisions.set(id, patch(current));
  return true;
}

function patchPremise(draft: Draft, id: PremiseId, patch: (c: Premise) => Premise): boolean {
  const current = draft.premises.get(id);
  if (!current) return false;
  draft.premises.set(id, patch(current));
  return true;
}

function patchGuard(draft: Draft, id: GuardId, patch: (c: Guard) => Guard): boolean {
  const current = draft.guards.get(id);
  if (!current) return false;
  draft.guards.set(id, patch(current));
  return true;
}

type EdgeKey = "supersedes" | "supersededBy" | "conflictsWith" | "dependsOn" | "related";

const MIRROR: Readonly<Record<EdgeKey, EdgeKey | null>> = {
  supersedes: "supersededBy",
  supersededBy: "supersedes",
  conflictsWith: "conflictsWith",
  dependsOn: null,
  related: "related",
};

/** Add an edge, mirroring it when the relation is symmetric. `supersedes` and
 *  `conflictsWith` mirror; `dependsOn` does not. */
function addEdge(draft: Draft, from: DecisionId, to: DecisionId, key: EdgeKey): void {
  if (from === to) return;
  const source = draft.decisions.get(from);
  const target = draft.decisions.get(to);
  if (!source || !target) return;

  const uniq = (ids: readonly DecisionId[], value: DecisionId): DecisionId[] =>
    ids.includes(value) ? [...ids] : [...ids, value];

  draft.decisions.set(from, {
    ...source,
    edges: { ...source.edges, [key]: uniq(source.edges[key], to) },
  });

  const back = MIRROR[key];
  if (back === null) return;

  const fresh = draft.decisions.get(to);
  if (!fresh) return;
  draft.decisions.set(to, {
    ...fresh,
    edges: { ...fresh.edges, [back]: uniq(fresh.edges[back], from) },
  });
}

function removePending(draft: Draft, id: DecisionId): void {
  const at = draft.pendingReview.indexOf(id);
  if (at >= 0) draft.pendingReview.splice(at, 1);
}

function removePendingPremise(draft: Draft, id: PremiseId): void {
  const at = draft.pendingPremises.indexOf(id);
  if (at >= 0) draft.pendingPremises.splice(at, 1);
}

function withEvidence(premise: Premise, evidence: PremiseEvidence): readonly PremiseEvidence[] {
  return [...premise.evidence, evidence];
}

/* -------------------------------------------------------------------------- */
/* The dispatch                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Apply one event to a draft, in place.
 *
 * Exhaustive over the closed 35-type vocabulary. The `never` assignment in the
 * default branch is what keeps it exhaustive: a 36th event type produces a
 * compile error HERE, the cheapest possible place to find out.
 */
export function applyEvent(draft: Draft, event: AnyEvent): Draft {
  switch (event.type) {
    /* ---------------- ingest ---------------- */

    case "TranscriptImported": {
      const p = event.payload;
      const transcript: Transcript = {
        id: p.transcriptId,
        ...(p.label === undefined ? {} : { label: p.label }),
        rawChars: p.rawChars,
        importedAt: event.at,
        ...(p.occurredAt === undefined ? {} : { occurredAt: p.occurredAt }),
        episodeIds: [],
      };
      draft.transcripts.set(p.transcriptId, transcript);
      draft.counters = { ...draft.counters, transcripts: draft.counters.transcripts + 1 };
      return draft;
    }

    /* ---------------- extraction ---------------- */

    case "DecisionProposed": {
      const p = event.payload;
      if (draft.decisions.has(p.decisionId)) {
        skip(draft, event, `decision ${p.decisionId} already exists`);
        return draft;
      }

      // An episode referenced but never separately announced is created here so
      // provenance always resolves. A citation that cannot resolve is not a
      // citation (docs/03 §5).
      if (!draft.episodes.has(p.episodeId)) {
        // Prefer the real bounds from Phase 1.2 segmentation. Falling back to the
        // decision's own snippet keeps hand-recorded decisions working, but a
        // synthesised episode cannot show the negotiation that produced the
        // decision, which is what the review UI needs for context.
        const bounds = p.episode;
        const episode: Episode = {
          id: p.episodeId,
          transcriptId: p.transcriptId,
          ...(bounds?.variable === undefined
            ? { variable: p.variable }
            : { variable: bounds.variable }),
          turnRange: bounds === undefined ? ([0, 0] as const) : bounds.turnRange,
          charRange:
            bounds === undefined
              ? ([p.snippet.start, p.snippet.end] as const)
              : bounds.charRange,
        };
        draft.episodes.set(p.episodeId, episode);
        draft.counters = { ...draft.counters, episodes: draft.counters.episodes + 1 };
        const transcript = draft.transcripts.get(p.transcriptId);
        if (transcript) {
          draft.transcripts.set(p.transcriptId, {
            ...transcript,
            episodeIds: [...transcript.episodeIds, p.episodeId],
          });
        }
      }

      // ONLY `asserted` modality can become an IN-labelled node. Everything else
      // starts UNKNOWN and must be promoted by a human. This single line is what
      // stops "what if we used Redis?" from becoming a decision and then
      // contradicting the Redis decision made three sessions later.
      const label: DecisionLabel = p.modality === "asserted" ? "IN" : "UNKNOWN";

      const decision: Decision = {
        id: p.decisionId,
        variable: p.variable,
        value: p.value,
        statement: p.statement,
        ...(p.rationale === undefined ? {} : { rationale: p.rationale }),
        ...(p.yStatement === undefined ? {} : { yStatement: p.yStatement }),
        ...(p.acceptedDownside === undefined ? {} : { acceptedDownside: p.acceptedDownside }),
        label,
        status: "proposed",
        modality: p.modality,
        justificationIds: [],
        alternativeIds: [...p.alternativeIds],
        guardIds: [],
        edges: {
          supersedes: [],
          supersededBy: [],
          conflictsWith: [],
          dependsOn: [],
          sharesPremiseWith: [],
          related: [],
        },
        provenance: {
          transcriptId: p.transcriptId,
          episodeId: p.episodeId,
          snippet: p.snippet,
          origin: p.origin,
          extractedBy: p.engine,
          confidence: p.confidence,
        },
        temporal: openWindow(event.occurredAt, event.at),
        // Written properly by src/reasoning/entrenchment.ts in Phase 2. A stale
        // 0 here is honest: the fold does not compute policy.
        entrenchment: 0,
        corroboration: 0,
        appliesTo: p.appliesTo === undefined ? [] : [...p.appliesTo],
        verifiability: "pending",
      };

      draft.decisions.set(p.decisionId, decision);
      draft.pendingReview.push(p.decisionId);
      for (const premiseId of p.premiseIds) {
        if (!draft.pendingPremises.includes(premiseId)) draft.pendingPremises.push(premiseId);
      }
      draft.counters = { ...draft.counters, decisions: draft.counters.decisions + 1 };
      return draft;
    }

    case "PremiseAsserted": {
      const p = event.payload;
      const existing = draft.premises.get(p.premiseId);

      if (existing) {
        // Re-assertion of an existing node appends evidence instead of creating a
        // duplicate. Premises are SHARED nodes (invariant I2) and a second copy
        // would silently halve the corroboration count on both.
        draft.premises.set(p.premiseId, {
          ...existing,
          confidence: asConfidence(Math.max(existing.confidence, p.confidence)),
          evidence: withEvidence(existing, {
            kind: "transcript",
            supports: true,
            span: p.snippet,
            eventId: event.id,
            at: event.occurredAt,
          }),
        });
        return draft;
      }

      const premise: Premise = {
        id: p.premiseId,
        type: p.type,
        predicate: p.predicate,
        ...(p.value === undefined ? {} : { value: p.value }),
        text: p.text,
        label: "UNKNOWN",
        evidence: [
          {
            kind: "transcript",
            supports: true,
            span: p.snippet,
            eventId: event.id,
            at: event.occurredAt,
          },
        ],
        temporal: openWindow(event.occurredAt, event.at),
        corroboration: 0,
        confidence: p.confidence,
        resolvedFrom: [event.id],
      };

      draft.premises.set(p.premiseId, premise);
      draft.counters = { ...draft.counters, premises: draft.counters.premises + 1 };
      return draft;
    }

    case "AlternativeRejected": {
      const p = event.payload;
      const alternative: RejectedAlternative = {
        id: p.alternativeId,
        decisionId: p.decisionId,
        variable: p.variable,
        value: p.value,
        ...(p.whyRejected === undefined ? {} : { whyRejected: p.whyRejected }),
        snippet: p.snippet,
        confidence: p.confidence,
        // Alternatives need explicit confirmation before entering the
        // pre-emption index: a false pre-emption is worse than none, and ARGUS
        // measured 15.4% precision on exactly this component.
        confirmedByHuman: false,
      };
      draft.alternatives.set(p.alternativeId, alternative);

      patchDecision(draft, p.decisionId, (d) =>
        d.alternativeIds.includes(p.alternativeId)
          ? d
          : { ...d, alternativeIds: [...d.alternativeIds, p.alternativeId] },
      );
      return draft;
    }

    case "ExtractionDiscarded":
      // Lives in the log as the precision metric's denominator; projects to
      // nothing. A discarded candidate must not appear anywhere in the graph.
      return draft;

    /* ---------------- review ---------------- */

    case "DecisionApproved": {
      const p = event.payload;
      const promoted = patchDecision(draft, p.decisionId, (d) => ({
        ...d,
        status: "active",
        // Bulk approval is a weaker signal than individual review, so it opens
        // the node for use without asserting its label.
        label: d.label === "UNKNOWN" && !p.viaBulkApprove ? "IN" : d.label,
      }));
      if (!promoted) skip(draft, event, `unknown decision ${p.decisionId}`);
      removePending(draft, p.decisionId);
      return draft;
    }

    case "DecisionEdited": {
      const p = event.payload;
      const applied = patchDecision(draft, p.decisionId, (d) => applyEdit(d, p.fields));
      if (!applied) skip(draft, event, `unknown decision ${p.decisionId}`);
      // The ORIGINAL extraction stays on the DecisionProposed event, so an edit
      // never destroys provenance. That is why this patches and never replaces.
      return draft;
    }

    case "DecisionRejected": {
      const p = event.payload;
      const rejected = patchDecision(draft, p.decisionId, (d) => ({
        ...d,
        status: "archived",
        label: "OUT",
        temporal: closeWindow(d.temporal, event.occurredAt, event.id, event.reason),
      }));
      if (!rejected) skip(draft, event, `unknown decision ${p.decisionId}`);
      removePending(draft, p.decisionId);
      return draft;
    }

    case "PremiseConfirmed": {
      const p = event.payload;
      const confirmed = patchPremise(draft, p.premiseId, (premise) => ({
        ...premise,
        label: "IN",
        evidence: withEvidence(premise, {
          kind: "human",
          supports: true,
          eventId: event.id,
          at: event.occurredAt,
        }),
      }));
      if (!confirmed) skip(draft, event, `unknown premise ${p.premiseId}`);
      removePendingPremise(draft, p.premiseId);
      return draft;
    }

    case "PremiseCorrected": {
      const p = event.payload;
      const corrected = patchPremise(draft, p.premiseId, (premise) =>
        applyPremiseEdit(premise, p.fields),
      );
      if (!corrected) skip(draft, event, `unknown premise ${p.premiseId}`);
      return draft;
    }

    /* ---------------- reasoning ---------------- */

    case "JustificationAttached": {
      const p = event.payload;
      // The informant's eventId is REWRITTEN to the event that created the
      // justification. A batch producer cannot know its own event ids — they are
      // minted inside `appendBatch` — so it supplies a placeholder, and the fold is
      // the only place that knows the truth. Deriving it here rather than trusting
      // the payload is what makes the provenance correct instead of merely present.
      const justification: Justification = {
        ...p.justification,
        informant:
          p.justification.informant.kind === "extraction"
            ? { ...p.justification.informant, eventId: event.id }
            : p.justification.informant,
      };
      draft.justifications.set(p.justificationId, justification);
      draft.counters = {
        ...draft.counters,
        justifications: draft.counters.justifications + 1,
      };
      patchDecision(draft, p.consequent, (d) =>
        d.justificationIds.includes(p.justificationId)
          ? d
          : { ...d, justificationIds: [...d.justificationIds, p.justificationId] },
      );
      // A premise becomes load-bearing when it acquires a consequent, so it
      // leaves the pending queue here rather than at approval.
      for (const id of [...justification.inList, ...justification.outList]) {
        removePendingPremise(draft, id);
      }
      return draft;
    }

    case "LabelChanged": {
      const p = event.payload;
      const asDecision = draft.decisions.get(p.nodeId as DecisionId);
      if (asDecision) {
        draft.decisions.set(asDecision.id, { ...asDecision, label: p.to });

        /* Guards INHERIT their decision's label (Phase 4.7). A decision that stops being IN
         * must stop having its guards run, and one that returns to IN must have them run again
         * — without anyone remembering to touch the guards.
         *
         * Maintaining `disabledByDecisionLabel` here rather than deriving it at read time keeps
         * the stored field honest: the export in `guards/ci-export.ts` reads the guard record,
         * and a CI runner enforcing a withdrawn decision would block work the log has already
         * approved. The interpreter ALSO checks the live label, so a stale field cannot make a
         * disabled guard run — but it could make an exported one wrong, which is why both exist.
         */
        const disabled = p.to !== "IN";
        for (const guardId of asDecision.guardIds) {
          const guard = draft.guards.get(guardId);
          if (guard === undefined) continue;
          if (guard.disabledByDecisionLabel === disabled) continue;
          draft.guards.set(guardId, { ...guard, disabledByDecisionLabel: disabled });
        }

        return draft;
      }
      const asPremise = draft.premises.get(p.nodeId as PremiseId);
      if (asPremise) {
        draft.premises.set(asPremise.id, { ...asPremise, label: p.to });
        return draft;
      }
      skip(draft, event, `unknown node ${p.nodeId}`);
      return draft;
    }

    case "ContradictionDetected": {
      const p = event.payload;
      const record: ContradictionRecord = {
        id: event.id,
        gate: p.gate,
        verdict: p.verdict,
        decisionA: p.decisionA,
        ...(p.decisionB === undefined ? {} : { decisionB: p.decisionB }),
        ...(p.premiseId === undefined ? {} : { premiseId: p.premiseId }),
        explanation: p.explanation,
        ...(p.diagnostic === undefined ? {} : { diagnostic: p.diagnostic }),
        engine: p.engine,
        detectedAt: event.at,
        validAt: event.occurredAt,
      };
      draft.contradictions.push(record);

      // `conflictsWith` is symmetric and is explicitly NEVER a cascade path: two
      // decisions may conflict without either supporting the other.
      if (p.decisionB !== undefined) addEdge(draft, p.decisionA, p.decisionB, "conflictsWith");
      return draft;
    }

    case "PremiseInvalidated": {
      const p = event.payload;
      const kind: PremiseEvidence["kind"] =
        p.invalidatedBy.kind === "guard"
          ? "guard"
          : p.invalidatedBy.kind === "human"
            ? "human"
            : "transcript";

      const invalidated = patchPremise(draft, p.premiseId, (premise) => ({
        ...premise,
        label: "OUT",
        temporal: closeWindow(premise.temporal, event.occurredAt, event.id, event.reason),
        evidence: withEvidence(premise, {
          kind,
          // An assertion or a human invalidates; a guard failure is evidence
          // AGAINST the premise, so `supports` is false only in that case.
          supports: kind !== "guard",
          ...(p.evidenceSpan === undefined ? {} : { span: p.evidenceSpan }),
          eventId: event.id,
          at: event.occurredAt,
        }),
      }));
      if (!invalidated) skip(draft, event, `unknown premise ${p.premiseId}`);
      return draft;
    }

    case "NogoodRecorded": {
      const p = event.payload;
      const conjunction = p.premiseIds
        .map((id) => draft.premises.get(id)?.text ?? String(id))
        .join(" AND ");
      const nogood: Nogood = {
        id: p.nogoodId,
        premiseIds: p.premiseIds,
        derivedFrom: p.derivedFrom,
        recordedAt: event.at,
        // The event's reason is the human-facing explanation; the conjunction is
        // appended so the sentence stands alone wherever it is rendered.
        explanation: `${event.reason} (${conjunction})`,
      };
      draft.nogoods.set(p.nogoodId, nogood);
      draft.counters = { ...draft.counters, nogoods: draft.counters.nogoods + 1 };
      return draft;
    }

    case "CascadePropagated":
      // The labels themselves arrive as LabelChanged events. This event exists so
      // the cascade PATH — including where it stopped and why — stays
      // reconstructable, which is the difference between "these four decisions
      // changed" and "these four changed because this premise died, and these two
      // survived because they had independent support".
      return draft;

    /* ---------------- revision ---------------- */

    case "RevisionProposed": {
      const p = event.payload;
      const failedPremise = draft.premises.get(p.failedPremiseId);
      const cascade: CascadeResult = {
        steps: p.cascade.map((step, i) => ({
          from: p.failedPremiseId,
          to: step.decisionId,
          depth: i + 1,
          became: step.became,
          stoppedAtIndependentSupport: p.survivors.includes(step.decisionId),
          reason: event.reason,
        })),
        flipped: p.cascade.map((step) => step.decisionId),
        survivors: p.survivors,
        truncated: false,
        potentiallyAffectedBeyondCap: 0,
      };

      const stored = p.nogoodId === undefined ? undefined : draft.nogoods.get(p.nogoodId);
      const nogood: NogoodRecord | undefined =
        p.nogoodId === undefined
          ? undefined
          : {
              id: p.nogoodId,
              premiseIds: stored?.premiseIds ?? [],
              explanation: stored?.explanation ?? "",
              derivedFrom: stored?.derivedFrom ?? event.id,
            };

      const proposal: RevisionProposal = {
        id: p.proposalId,
        createdAt: event.id,
        unsoundDecisionId: p.unsoundDecisionId,
        failedPremiseId: p.failedPremiseId,
        failedPremiseText: failedPremise?.text ?? String(p.failedPremiseId),
        evidence:
          p.evidence === undefined
            ? {
                /* Logs written before the payload carried evidence reconstructed it from
                 * the reason, which is a paraphrase. Keep that path only for replaying
                 * old events; new ones store the finding's verbatim quote and source. */
                quote: event.reason,
                source: "transcript",
                confidence: asConfidence(failedPremise?.confidence ?? 0.5),
              }
            : {
                quote: p.evidence.quote,
                source: p.evidence.source,
                confidence: p.evidence.confidence,
                ...(p.evidence.span === undefined ? {} : { span: p.evidence.span }),
              },
        ...(nogood === undefined ? {} : { nogood }),
        cascade,
        entrenchment: p.entrenchment,
        entrenchmentBand: entrenchmentBand(p.entrenchment.total),
        availableActions: p.availableActions,
        // Invariant I4, on the record rather than only in the docs: the proposal
        // exists BECAUSE the system is not allowed to apply it.
        whyNotAutoApplied: p.rejectedNewcomer
          ? `Newcomer screened out: ${p.rejectedNewcomer.why}`
          : "Extracted prose may not silently rewrite a considered decision. A human picks the action.",
        status: "open",
      };

      draft.proposals.set(p.proposalId, proposal);
      draft.counters = { ...draft.counters, proposals: draft.counters.proposals + 1 };
      return draft;
    }

    case "DecisionReversed": {
      const p = event.payload;
      const old = draft.decisions.get(p.decisionId);
      if (!old) {
        skip(draft, event, `unknown decision ${p.decisionId}`);
        return draft;
      }

      // Reversal mints a NEW node and closes the old one. Nothing is deleted
      // (I1), and the pair stays linked so the export compiler can drop the
      // superseded rule instead of shipping both — shipping both is exactly the
      // "the model may pick one arbitrarily" failure.
      draft.counters = { ...draft.counters, decisions: draft.counters.decisions + 1 };
      const newId = mintDecisionId(draft.counters.decisions);

      const replacement: Decision = {
        ...old,
        id: newId,
        value: p.newValue,
        statement: `${old.variable}: ${p.newValue} (reverses ${old.id})`,
        label: "IN",
        status: "active",
        justificationIds: [],
        alternativeIds: [],
        guardIds: [],
        edges: {
          supersedes: [old.id],
          supersededBy: [],
          conflictsWith: [],
          dependsOn: [],
          sharesPremiseWith: [],
          related: [],
        },
        provenance: { ...old.provenance, origin: "human_override" },
        temporal: reopenWindow(event.occurredAt, event.at),
        entrenchment: 0,
        corroboration: 0,
        verifiability: "pending",
      };
      draft.decisions.set(newId, replacement);

      draft.decisions.set(old.id, {
        ...old,
        status: "superseded",
        label: "OUT",
        temporal: closeWindow(old.temporal, event.occurredAt, event.id, event.reason),
      });
      addEdge(draft, old.id, newId, "supersededBy");
      return draft;
    }

    case "DecisionRejustified": {
      const p = event.payload;
      const rejustified = patchDecision(draft, p.decisionId, (d) => ({
        ...d,
        label: "IN",
        status: "active",
        justificationIds: d.justificationIds.includes(p.newJustificationId)
          ? d.justificationIds
          : [...d.justificationIds, p.newJustificationId],
      }));
      if (!rejustified) skip(draft, event, `unknown decision ${p.decisionId}`);
      // The most common real outcome of a cascade, and the one no prior system
      // offers: the decision survives on a NEW premise rather than dying.
      removePendingPremise(draft, p.newPremiseId);
      return draft;
    }

    case "PremiseContested": {
      const p = event.payload;
      const contested = patchPremise(draft, p.premiseId, (premise) => ({
        ...premise,
        label: "UNKNOWN",
        temporal: closeWindow(premise.temporal, event.occurredAt, event.id, event.reason),
      }));
      if (!contested) skip(draft, event, `unknown premise ${p.premiseId}`);
      return draft;
    }

    case "DecisionSuperseded": {
      const p = event.payload;
      const closed = patchDecision(draft, p.oldDecisionId, (d) => ({
        ...d,
        status: "superseded",
        label: "OUT",
        temporal: closeWindow(d.temporal, event.occurredAt, event.id, event.reason),
      }));
      if (!closed) skip(draft, event, `unknown decision ${p.oldDecisionId}`);
      addEdge(draft, p.oldDecisionId, p.newDecisionId, "supersededBy");
      return draft;
    }

    case "HumanOverride": {
      const p = event.payload;
      const count = draft.overrides.get(p.overriddenDecisionId) ?? 0;
      draft.overrides.set(p.overriddenDecisionId, count + 1);

      // Raising origin to human_override moves source_authority from 0.4 to 0.9,
      // which is how a screened-out newcomer eventually wins the next
      // adjudication instead of sitting in the contested queue forever.
      patchDecision(draft, p.overriddenDecisionId, (d) => ({
        ...d,
        provenance: { ...d.provenance, origin: "human_override" },
        status: d.status === "contested" ? "active" : d.status,
      }));

      const proposal = draft.proposals.get(p.proposalId);
      if (proposal) {
        draft.proposals.set(p.proposalId, {
          ...proposal,
          status: "resolved",
          resolvedBy: event.id,
        });
      }
      return draft;
    }

    /* ---------------- verification ---------------- */

    case "GuardSynthesised": {
      const p = event.payload;
      const guard: Guard = {
        id: p.guardId,
        decisionId: p.decisionId,
        spec: p.spec,
        rationale: p.rationale,
        severity: p.severity,
        generatedBy: p.generatedBy,
        engine: draft.engine,
        // A `proposed` guard NEVER RUNS. An unaccepted check that fails is noise
        // the user has not agreed to hear.
        lifecycle: "proposed",
        disabledByDecisionLabel: false,
        createdAt: event.at,
        createdByEvent: event.id,
      };
      draft.guards.set(p.guardId, guard);
      draft.guardIndex.set(p.guardId, p.decisionId);
      patchDecision(draft, p.decisionId, (d) =>
        d.guardIds.includes(p.guardId) ? d : { ...d, guardIds: [...d.guardIds, p.guardId] },
      );
      return draft;
    }

    case "GuardAccepted": {
      const p = event.payload;
      const accepted = patchGuard(draft, p.guardId, (g) => ({ ...g, lifecycle: "accepted" }));
      if (!accepted) skip(draft, event, `unknown guard ${p.guardId}`);
      const guard = draft.guards.get(p.guardId);
      if (guard) patchDecision(draft, guard.decisionId, (d) => ({ ...d, verifiability: "verified" }));
      return draft;
    }

    case "GuardRan": {
      const p = event.payload;
      const ran = patchGuard(draft, p.guardId, (g) => ({
        ...g,
        lastRun: runResult(p.guardId, p.result, p.evidence, p.ranAt),
      }));
      if (!ran) skip(draft, event, `unknown guard ${p.guardId}`);
      // A passing re-run clears Drift Age: the decision is being honoured again.
      if (p.result === "pass") {
        patchGuard(draft, p.guardId, (g) => ({ ...g, firstFailedAt: undefined }));
      }
      return draft;
    }

    case "GuardFailed": {
      const p = event.payload;
      const failed = patchGuard(draft, p.guardId, (g) => ({
        ...g,
        // Drift Age starts at the FIRST failure and is not reset by later failing
        // runs. How long a decision has been knowingly violated is the number
        // worth showing.
        firstFailedAt: g.firstFailedAt ?? p.firstFailedAt,
        lastRun: runResult(p.guardId, "fail", p.evidence, p.ranAt),
      }));
      if (!failed) skip(draft, event, `unknown guard ${p.guardId}`);

      // A failure that falsifies a WORLD-OBSERVABLE premise is gate (c): nothing
      // contradicts the user, the world simply moved.
      if (p.falsifiesPremiseId !== undefined) {
        patchPremise(draft, p.falsifiesPremiseId, (premise) => ({
          ...premise,
          label: "OUT",
          temporal: closeWindow(premise.temporal, event.occurredAt, event.id, event.reason),
          evidence: withEvidence(premise, {
            kind: "guard",
            supports: false,
            eventId: event.id,
            at: event.occurredAt,
          }),
        }));
      }
      return draft;
    }

    case "GuardSuppressed": {
      const p = event.payload;
      const suppressed = patchGuard(draft, p.guardId, (g) => ({
        ...g,
        lifecycle: "suppressed",
        suppressionReason: p.suppressionReason,
      }));
      if (!suppressed) skip(draft, event, `unknown guard ${p.guardId}`);
      return draft;
    }

    case "GuardDeleted": {
      const p = event.payload;
      // `deleted` is a lifecycle state, not a removal. The guard stays in the map
      // so its run history — and therefore the compliance trend — survives.
      const removed = patchGuard(draft, p.guardId, (g) => ({ ...g, lifecycle: "deleted" }));
      if (!removed) skip(draft, event, `unknown guard ${p.guardId}`);
      return draft;
    }

    /* ---------------- export ---------------- */

    case "ExportCompiled": {
      const p = event.payload;
      const record: ExportRecordState = {
        id: p.exportId,
        stats: exportStats(p),
        compiledAt: event.at,
        mismatches: [],
      };
      draft.exports.set(p.exportId, record);
      draft.counters = { ...draft.counters, exports: draft.counters.exports + 1 };
      return draft;
    }

    case "ExportStamped": {
      const p = event.payload;
      const existing = draft.exports.get(p.exportId);
      if (!existing) {
        skip(draft, event, `unknown export ${p.exportId}`);
        return draft;
      }
      draft.exports.set(p.exportId, { ...existing, stamp: p.stamp });
      return draft;
    }

    case "ExportIntegrityMismatch": {
      const p = event.payload;
      const latest = draft.exports.size === 0 ? undefined : [...draft.exports.values()].at(-1);
      if (!latest) {
        skip(draft, event, "integrity mismatch with no export in the log");
        return draft;
      }
      draft.exports.set(latest.id, {
        ...latest,
        mismatches: [
          ...latest.mismatches,
          { path: p.path, expectedHead: p.expectedHead, foundHead: p.foundHead },
        ],
      });
      return draft;
    }

    /* ---------------- system ---------------- */

    case "EngineSwitched": {
      const p = event.payload;
      draft.engine = p.to;
      // Cosine similarity across embedding spaces is meaningless. Switching
      // engine DISABLES semantic retrieval until an explicit re-index, rather
      // than quietly mixing two vector spaces and returning confident nonsense.
      const wasBuilt = draft.index.builtBy !== undefined;
      draft.index = {
        ...draft.index,
        stale: wasBuilt || draft.index.stale,
        staleSince: wasBuilt && draft.index.staleSince === undefined ? event.at : draft.index.staleSince,
        lastEventId: event.id,
      };
      return draft;
    }

    case "IndexRebuilt": {
      const p = event.payload;
      draft.index = {
        levels: p.levels,
        decisionsIndexed: p.decisionsIndexed,
        builtBy: p.engine,
        builtAt: event.at,
        stale: false,
        lastEventId: event.id,
      };
      return draft;
    }

    case "IndexStale": {
      const p = event.payload;
      draft.index = {
        ...draft.index,
        stale: true,
        staleSince: event.at,
        builtBy: p.staleEngine,
        lastEventId: event.id,
      };
      return draft;
    }

    case "LogImported":
      // The merge/create counts exist for the double-import test (sub-phase 0.4:
      // importing the same file twice must create ZERO new nodes). Projects to
      // nothing else.
      return draft;

    case "SchemaMigrated": {
      draft.schemaVersion = event.payload.toVersion;
      return draft;
    }

    default: {
      // Exhaustiveness: add a 36th type to EventType and this line fails to
      // compile, naming the missing case.
      const unhandled: never = event;
      skip(draft, unhandled as AnyEvent, "unhandled event type");
      return draft;
    }
  }
}


/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

type EditableFields = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Apply a `DecisionEdited` payload.
 *
 * Unknown keys are IGNORED rather than written: an edit event from a future
 * schema must not be able to inject arbitrary fields into a Decision, and a
 * typo'd key silently vanishing is far cheaper than a corrupted node.
 */
function applyEdit(decision: Decision, fields: EditableFields): Decision {
  let next = decision;

  const statement = fields["statement"];
  if (typeof statement === "string") next = { ...next, statement };

  const rationale = fields["rationale"];
  if (typeof rationale === "string") next = { ...next, rationale };
  else if (rationale === null) next = { ...next, rationale: undefined };

  const downside = fields["acceptedDownside"];
  if (typeof downside === "string") next = { ...next, acceptedDownside: downside };
  else if (downside === null) next = { ...next, acceptedDownside: undefined };

  const yStatement = fields["yStatement"];
  if (typeof yStatement === "string") next = { ...next, yStatement };
  else if (yStatement === null) next = { ...next, yStatement: undefined };

  const value = fields["value"];
  if (typeof value === "string") next = { ...next, value };

  const variable = fields["variable"];
  if (typeof variable === "string") next = { ...next, variable: variable as DecisionVariable };

  const appliesTo = fields["appliesTo"];
  if (typeof appliesTo === "string") {
    next = {
      ...next,
      appliesTo: appliesTo
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
  }

  return next;
}

function applyPremiseEdit(premise: Premise, fields: EditableFields): Premise {
  let next = premise;

  const text = fields["text"];
  if (typeof text === "string") next = { ...next, text };

  const predicate = fields["predicate"];
  if (typeof predicate === "string") next = { ...next, predicate };

  const type = fields["type"];
  if (typeof type === "string") next = { ...next, type: type as Premise["type"] };

  const value = fields["value"];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    next = { ...next, value };
  } else if (value === null) {
    next = { ...next, value: undefined };
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/* Small constructors used by the dispatch                                    */
/* -------------------------------------------------------------------------- */

function runResult(
  guardId: GuardId,
  outcome: "pass" | "fail" | "skip",
  evidence: string,
  ranAt: ISODateString,
): GuardRunResult {
  return {
    guardId,
    outcome,
    evidence,
    ranAt,
    // The fold does not measure; the runner does. A replay reconstructs the
    // result, not the timing.
    durationMs: 0,
  };
}

function exportStats(p: {
  decisionsIncluded: number;
  decisionsLinkedOut: number;
  lineCount: number;
}): ExportStats {
  return {
    decisionsIncluded: p.decisionsIncluded,
    decisionsLinkedOut: p.decisionsLinkedOut,
    // Recomputed from the graph in finalise(); the payload carries only what the
    // compiler counted at generation time.
    decisionsExcluded: 0,
    lineCount: p.lineCount,
    estimatedTokens: Math.ceil((p.lineCount * 48) / 4),
    compliance: 0,
    verifiableCoverage: 0,
  };
}

function mintDecisionId(n: number): DecisionId {
  return `WLD-${String(n).padStart(4, "0")}` as DecisionId;
}

/* -------------------------------------------------------------------------- */
/* Finalise: rebuild every DERIVED field                                      */
/* -------------------------------------------------------------------------- */

/**
 * Derived fields are rebuilt once per fold rather than maintained incrementally,
 * because each is a function of the WHOLE graph: `sharesPremiseWith` needs every
 * justification, corroboration needs every reference, the queues need every
 * status.
 *
 * Maintaining them across 35 event types instead is precisely where replay and
 * append would drift apart — and that drift is invisible until a round-trip
 * produces a different head hash.
 */
export function finalise(draft: Draft): Draft {
  rebuildDecisionIndexes(draft);
  rebuildPremiseIndexes(draft);
  rebuildSharedPremiseEdges(draft);
  rebuildCorroboration(draft);
  rebuildGuardInheritance(draft);
  rebuildQueues(draft);
  rebuildExportStats(draft);
  rebuildMetrics(draft);
  return draft;
}

function fingerprintOf(variable: DecisionVariable, value: string): string {
  return `${variable}\u0000${value.trim().toLowerCase()}`;
}

function rebuildDecisionIndexes(draft: Draft): void {
  const byVariable = new Map<DecisionVariable, DecisionId[]>();
  const byFingerprint = new Map<string, DecisionId>();

  // Insertion order is learned-time order, so the EARLIEST node keeps the
  // fingerprint. Identity resolution consults the ladder before it ever reaches
  // this map (src/substrate/identity.ts); this is the dedup fast path only.
  for (const decision of draft.decisions.values()) {
    const bucket = byVariable.get(decision.variable);
    if (bucket) bucket.push(decision.id);
    else byVariable.set(decision.variable, [decision.id]);

    const fp = fingerprintOf(decision.variable, decision.value);
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, decision.id);
  }

  draft.byVariable = byVariable;
  draft.byFingerprint = byFingerprint;
}

function rebuildPremiseIndexes(draft: Draft): void {
  const byFingerprint = new Map<string, PremiseId>();
  for (const premise of draft.premises.values()) {
    // Type is part of the fingerprint: merging across premise TYPES is forbidden
    // regardless of text similarity. "single user" (scale) and "single sign-on
    // user flow" (requirement) are never the same node, and a false merge there
    // produces a spectacular wrong cascade.
    const fp = `${premise.type}\u0000${premise.predicate}`;
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, premise.id);
  }
  draft.premiseByFingerprint = byFingerprint;

  const toDecisions = new Map<PremiseId, DecisionId[]>();
  const link = (premiseId: PremiseId, decisionId: DecisionId): void => {
    const bucket = toDecisions.get(premiseId);
    if (bucket) {
      if (!bucket.includes(decisionId)) bucket.push(decisionId);
    } else {
      toDecisions.set(premiseId, [decisionId]);
    }
  };

  for (const justification of draft.justifications.values()) {
    for (const id of justification.inList) link(id, justification.consequent);
    // OUT-list membership is a dependency too: the justification is valid only
    // while that premise stays OUT, so invalidating it must reach the decision.
    for (const id of justification.outList) link(id, justification.consequent);
  }

  draft.premiseToDecisions = toDecisions;
}

function rebuildSharedPremiseEdges(draft: Draft): void {
  const shared = new Map<DecisionId, Set<DecisionId>>();

  for (const decisionIds of draft.premiseToDecisions.values()) {
    if (decisionIds.length < 2) continue;
    for (const a of decisionIds) {
      let bucket = shared.get(a);
      if (!bucket) {
        bucket = new Set();
        shared.set(a, bucket);
      }
      for (const b of decisionIds) {
        if (a !== b) bucket.add(b);
      }
    }
  }

  for (const [id, peers] of shared) {
    const decision = draft.decisions.get(id);
    if (!decision) continue;
    draft.decisions.set(id, {
      ...decision,
      edges: { ...decision.edges, sharesPremiseWith: [...peers].sort() },
    });
  }
}

function rebuildCorroboration(draft: Draft): void {
  // premiseToDecisions was rebuilt immediately before this, so it is the
  // authoritative reference count for both premises and decisions.
  const premiseRefs = new Map<PremiseId, number>();
  for (const [premiseId, decisionIds] of draft.premiseToDecisions) {
    premiseRefs.set(premiseId, decisionIds.length);
  }

  for (const [id, premise] of draft.premises) {
    const refs = premiseRefs.get(id) ?? 0;
    // log2 scaling: the fourth independent justification is worth much less than
    // the second. Matches docs/02 §3.4's corroboration term.
    const corroboration = refs <= 1 ? (refs === 1 ? 0.5 : 0) : Math.min(1, 0.5 + Math.log2(refs) / 4);
    draft.premises.set(id, { ...premise, corroboration });
  }

  for (const [id, decision] of draft.decisions) {
    const refs = decision.justificationIds.length;
    const corroboration = refs <= 1 ? (refs === 1 ? 0.5 : 0) : Math.min(1, 0.5 + Math.log2(refs) / 4);
    draft.decisions.set(id, { ...decision, corroboration });
  }
}

/**
 * Guards INHERIT their decision's label.
 *
 * A decision that is OUT or superseded has its guards auto-disabled, and
 * re-enabling requires the decision to return to IN. Without this, reversing a
 * decision leaves its old guard failing forever — the fastest known way to get a
 * verification feature switched off.
 */
function rebuildGuardInheritance(draft: Draft): void {
  for (const [id, guard] of draft.guards) {
    const decision = draft.decisions.get(guard.decisionId);
    const disabled =
      decision === undefined || decision.label === "OUT" || decision.status === "superseded";
    if (guard.disabledByDecisionLabel !== disabled) {
      draft.guards.set(id, { ...guard, disabledByDecisionLabel: disabled });
    }
  }
}

function rebuildQueues(draft: Draft): void {
  // Derived from status rather than maintained as events arrive, so a replay and
  // an incremental append cannot disagree about what is still awaiting review.
  draft.pendingReview = [...draft.decisions.values()]
    .filter((d) => d.status === "proposed")
    .map((d) => d.id);

  draft.pendingPremises = [...draft.premises.values()]
    .filter((p) => p.label === "UNKNOWN" && p.temporal.invalidFrom === undefined)
    .map((p) => p.id);
}

function rebuildExportStats(draft: Draft): void {
  if (draft.exports.size === 0) return;

  const decisions = [...draft.decisions.values()];
  const live = decisions.filter((d) => d.label === "IN" && d.status !== "superseded");
  const withGuard = live.filter((d) => d.guardIds.length > 0);
  const verifiableCoverage = live.length === 0 ? 0 : withGuard.length / live.length;

  for (const [id, record] of draft.exports) {
    draft.exports.set(id, {
      ...record,
      stats: {
        ...record.stats,
        decisionsExcluded: Math.max(0, decisions.length - record.stats.decisionsIncluded),
        verifiableCoverage,
      },
    });
  }
}

function rebuildMetrics(draft: Draft): void {
  const decisions = [...draft.decisions.values()];
  const live = decisions.filter((d) => d.label === "IN" && d.temporal.invalidFrom === undefined);
  const guards = [...draft.guards.values()];
  const accepted = guards.filter((g) => g.lifecycle === "accepted");
  const passing = accepted.filter((g) => g.lastRun?.outcome === "pass");
  const failing = accepted.filter((g) => g.lastRun?.outcome === "fail");

  const otherCount = draft.byVariable.get("OTHER")?.length ?? 0;

  const metrics: [string, number][] = [
    ["events", draft.events.length],
    ["decisions", decisions.length],
    ["decisionsLive", live.length],
    ["decisionsOut", decisions.filter((d) => d.label === "OUT").length],
    ["decisionsUnknown", decisions.filter((d) => d.label === "UNKNOWN").length],
    ["decisionsUnfounded", decisions.filter((d) => d.label === "UNFOUNDED").length],
    ["premises", draft.premises.size],
    ["premisesOpen", [...draft.premises.values()].filter((p) => p.temporal.invalidFrom === undefined).length],
    ["justifications", draft.justifications.size],
    ["nonMonotonicJustifications", [...draft.justifications.values()].filter((j) => j.outList.length > 0).length],
    ["nogoods", draft.nogoods.size],
    ["transcripts", draft.transcripts.size],
    ["episodes", draft.episodes.size],
    ["alternatives", draft.alternatives.size],
    ["alternativesConfirmed", [...draft.alternatives.values()].filter((a) => a.confirmedByHuman).length],
    ["guards", guards.length],
    ["guardsAccepted", accepted.length],
    ["guardsPassing", passing.length],
    ["guardsFailing", failing.length],
    ["contradictions", draft.contradictions.length],
    ["proposalsOpen", [...draft.proposals.values()].filter((p) => p.status === "open").length],
    ["overrides", [...draft.overrides.values()].reduce((a, b) => a + b, 0)],
    ["pendingReview", draft.pendingReview.length],
    ["pendingPremises", draft.pendingPremises.length],
    // The ontology health check (sub-phase 0.7). Above ~0.15 the 14 typed slots
    // are not covering the corpus and Phase 1's numbers cannot be trusted.
    ["otherVariableRate", decisions.length === 0 ? 0 : otherCount / decisions.length],
    ["compliance", accepted.length === 0 ? 1 : passing.length / accepted.length],
    ["verifiableCoverage", live.length === 0 ? 0 : live.filter((d) => d.guardIds.length > 0).length / live.length],
    ["skippedEvents", draft.skipped.length],
  ];

  draft.metrics = new Map(metrics);
}

/* -------------------------------------------------------------------------- */
/* Freeze                                                                     */
/* -------------------------------------------------------------------------- */

/** The only way out of a Draft. Exposes every collection as Readonly. */
export function freeze(draft: Draft): GraphState {
  return {
    events: draft.events,
    headHash: draft.headHash,
    lastEventId: draft.lastEventId,
    schemaVersion: draft.schemaVersion,

    decisions: draft.decisions,
    premises: draft.premises,
    justifications: draft.justifications,
    nogoods: draft.nogoods,

    transcripts: draft.transcripts,
    episodes: draft.episodes,
    alternatives: draft.alternatives,

    guards: draft.guards,
    proposals: draft.proposals,
    contradictions: draft.contradictions,
    exports: draft.exports,

    byVariable: draft.byVariable,
    byFingerprint: draft.byFingerprint,
    premiseByFingerprint: draft.premiseByFingerprint,
    premiseToDecisions: draft.premiseToDecisions,
    guardIndex: draft.guardIndex,

    pendingReview: draft.pendingReview,
    pendingPremises: draft.pendingPremises,
    overrides: draft.overrides,

    engine: draft.engine,
    index: draft.index,
    counters: draft.counters,

    metrics: draft.metrics,
    computedAt: draft.computedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                        */
/* -------------------------------------------------------------------------- */

export interface FoldOptions {
  readonly engine: EngineId;
  /** Stamps `computedAt`. Supplied by the caller so the fold stays pure. */
  readonly now: ISODateString;
  /** Skip finalise(). Only for benchmarks that measure raw dispatch cost. */
  readonly raw?: boolean;
}

/**
 * Fold an event log into a state.
 *
 * The hash chain is advanced here as well, so `state.headHash` always agrees
 * with `verifyChain(state.events).headHash`. Computing it in two places is how
 * the two would eventually disagree.
 */
export function fold(events: readonly AnyEvent[], options: FoldOptions): GraphState {
  const draft = emptyDraft(options.engine, options.now);

  for (const event of events) {
    draft.events.push(event);
    draft.headHash = linkHash(draft.headHash, event);
    draft.lastEventId = event.id;
    if (event.schemaVersion !== undefined) {
      draft.schemaVersion = Math.max(draft.schemaVersion, event.schemaVersion);
    }
    draft.counters = { ...draft.counters, events: draft.counters.events + 1 };
    applyEvent(draft, event);
  }

  return freeze(options.raw === true ? draft : finalise(draft));
}

/** Fold nothing: the state the app renders on first boot (sub-phase 0.10). */
export function emptyFold(options: FoldOptions): GraphState {
  return freeze(finalise(emptyDraft(options.engine, options.now)));
}

/**
 * Materialise the graph AS OF a point in time.
 *
 * Replay stops after the last event whose LEARNED time is at or before `asOf`.
 * That is the audit-trail question — "what did WhyLog believe then?" — and it is
 * answerable only because learned time is on every event.
 *
 * Passing a VALID-time instant instead is a different question ("what was true
 * then?") and is answered by filtering the full state with
 * src/substrate/bi-temporal.ts `matchesAsOf`, not by truncating the replay:
 * truncating on valid time would drop events the system genuinely knew about.
 */
export function materializeAsOf(
  events: readonly AnyEvent[],
  asOfLearned: ISODateString,
  options: FoldOptions,
): GraphState {
  const visible = events.filter((e) => e.at <= asOfLearned);
  return fold(visible, options);
}

/** Materialise up to and including a specific event id. */
export function materializeThrough(
  events: readonly AnyEvent[],
  throughEventId: EventId,
  options: FoldOptions,
): GraphState {
  const cut = events.findIndex((e) => e.id === throughEventId);
  return fold(cut < 0 ? events : events.slice(0, cut + 1), options);
}

/**
 * Apply one event to an existing state.
 *
 * Used by the live append path. Produces exactly what a full replay would,
 * because it runs the same `applyEvent` and the same `finalise`.
 */
export function applyToState(state: GraphState, event: AnyEvent): GraphState {
  const draft = toDraft(state);
  draft.events.push(event);
  draft.headHash = linkHash(draft.headHash, event);
  draft.lastEventId = event.id;
  draft.counters = { ...draft.counters, events: draft.counters.events + 1 };
  applyEvent(draft, event);
  return freeze(finalise(draft));
}

/** Apply a batch. One finalise for the whole batch — appending N events one at a
 *  time would rebuild every derived index N times. */
export function applyBatch(state: GraphState, events: readonly AnyEvent[]): GraphState {
  if (events.length === 0) return state;
  const draft = toDraft(state);
  for (const event of events) {
    draft.events.push(event);
    draft.headHash = linkHash(draft.headHash, event);
    draft.lastEventId = event.id;
    draft.counters = { ...draft.counters, events: draft.counters.events + 1 };
    applyEvent(draft, event);
  }
  return freeze(finalise(draft));
}

/**
 * Throw the cache away and rebuild it.
 *
 * Exposed as a first-class operation because the projections ARE disposable: if
 * a derived index is ever suspected of drift, rebuilding from the log is the
 * answer, and having a button for it is better than having a theory about it.
 */
export function rebuild(state: GraphState, options: FoldOptions): GraphState {
  return fold(state.events, options);
}
