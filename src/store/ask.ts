/**
 * The Ask store — Phase 3 · sub-phase 3.10.
 *
 * Plan: plan/phase-3-retrieval.md §3.10
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS STORE OWNS
 *
 * Two things, and only two:
 *
 *   1. THE INDEX ARTIFACTS. Built once, reused for every question, rebuilt when the log or
 *      the engine changes. Nothing else in the app holds them — `store/reasoning.ts` reads
 *      them from here to generate gate (b)'s candidates, so there is one index and one notion
 *      of staleness rather than two that can disagree.
 *   2. THE QUESTION AND ITS ANSWER. Including the run trace, which is part of the answer and
 *      not a debugging extra: the evidence contract says the run leaves a trail a reader can
 *      audit, and a trail that is discarded after rendering is not a trail.
 *
 * ---------------------------------------------------------------------------
 * EVERY MUTATION IS append → fold → persist
 *
 * Building the index emits `IndexRebuilt` or `IndexStale` drafts. They are committed through
 * `recordBatch` exactly like every other state change, because the index is part of the log's
 * history: which engine built it, when, and over how many decisions is provenance, and
 * provenance is the product. A rebuild that did not record itself would leave the log unable
 * to explain why its own answers changed.
 *
 * ---------------------------------------------------------------------------
 * KEYLESS BY DEFAULT, AND IT SAYS SO
 *
 * `build({ skipDense: true })` produces L3/L4/L5 with no embeddings and no network. That is
 * not a degraded mode — BM25 plus exact structural and premise matching is what makes the
 * system usable with no key at all, and the levels that ran are reported on every answer.
 * With dense available, L1 and L2 join the fusion; without it, they drop out and the answer
 * says which levels carried it.
 * ---------------------------------------------------------------------------
 */

import { nowISO } from "@/lib/format";
import type { CandidatePair } from "@/reasoning/gates/semantic";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { label } from "@/reasoning/labeller";
import {
  type RetrievalResult,
  describePipeline,
  describeRetrieval,
  retrieve,
  ask as runAsk,
} from "@/retrieval";
import { type BuildReport, buildIndex, describeBuild } from "@/retrieval/build-index";
import { candidatePairs, describeCandidatePolicy, describeSource } from "@/retrieval/candidates";
import { type ExpandedCitationResult, expandAll, renderExpansion } from "@/retrieval/citations";
import { describeRules } from "@/retrieval/contradiction";
import { describeContract } from "@/retrieval/evidence-contract";
import { describeThresholds } from "@/retrieval/groundedness";
import { countPreemptions } from "@/retrieval/preemption";
import { describeWeights } from "@/retrieval/rerank";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId, ISODateString } from "@/types/common";
import type { Actor } from "@/types/common";
import type { Answer, IndexArtifacts, QueryOptions, RetrievedHit } from "@/types/retrieval";
import { DEFAULT_QUERY_OPTIONS } from "@/types/retrieval";
import { create } from "zustand";
import { useWhyLog } from "./whylog";

/** `system`, not `engine`: index construction and retrieval are deterministic given the
 *  artifacts, and stamping them as an engine act would claim the model produced the ranking.
 *  The engine is named separately on the answer, where it belongs. */
const ASK_ACTOR: Actor = { kind: "system" };

export type AskStatus = "idle" | "building" | "asking" | "answered" | "failed";

export interface AskHistoryEntry {
  readonly question: string;
  readonly answeredAt: ISODateString;
  readonly verdict: Answer["verdict"];
  readonly groundedness: number;
  readonly searches: number;
}

export interface AskState {
  /* --- the index --- */
  readonly artifacts: IndexArtifacts | null;
  readonly build: BuildReport | null;
  readonly buildError: string | null;

  /* --- the question --- */
  readonly status: AskStatus;
  readonly question: string;
  readonly answer: Answer | null;
  readonly error: string | null;
  readonly durationMs: number;

  /* --- what the answer rests on --- */
  readonly expansions: readonly ExpandedCitationResult[];
  readonly missingCitations: readonly DecisionId[];
  readonly selected: DecisionId | null;
  readonly history: readonly AskHistoryEntry[];

  /* --- actions --- */
  readonly buildTheIndex: (options?: { skipDense?: boolean }) => Promise<BuildReport | null>;
  readonly ensureIndex: () => Promise<IndexArtifacts | null>;
  readonly ask: (question: string) => Promise<Answer | null>;
  readonly setQuestion: (question: string) => void;
  readonly select: (id: DecisionId | null) => void;
  readonly clear: () => void;

  /* --- read by store/reasoning.ts for gate (b) --- */
  readonly candidatesFor: (state: GraphState) => Promise<readonly CandidatePair[]>;
}

/** Retrieve the artifacts, building them if the store has none. Callers get a consistent
 *  answer to "is there an index?" without each of them deciding how to build one. */
function currentArtifacts(): IndexArtifacts | null {
  return useAsk.getState().artifacts;
}

export const useAsk = create<AskState>()((set, get) => ({
  artifacts: null,
  build: null,
  buildError: null,

  status: "idle",
  question: "",
  answer: null,
  error: null,
  durationMs: 0,

  expansions: [],
  missingCitations: [],
  selected: null,
  history: [],

  /* ---------------------------------------------------------------------- */
  /* The index                                                              */
  /* ---------------------------------------------------------------------- */

  buildTheIndex: async (options) => {
    const whylog = useWhyLog.getState();

    if (whylog.engine === null) {
      set({ buildError: "No engine is available. Boot the app before building the index." });
      return null;
    }

    if (get().status === "building") return get().build;

    set({ status: "building", buildError: null });

    const report = await buildIndex({
      state: whylog.state,
      engine: whylog.engine.engine,
      actor: ASK_ACTOR,
      ...(options?.skipDense === undefined ? {} : { skipDense: options.skipDense }),
    });

    set({ artifacts: report.artifacts, build: report });

    /* append → fold → persist. The index is part of the log's history, and `IndexRebuilt` is
     * one of the state-changing events that requires a non-empty reason: an index whose
     * rebuild cannot be explained is an index whose answers cannot be trusted later. */
    if (report.drafts.length > 0) {
      const committed = whylog.recordBatch(report.drafts, {
        reason:
          report.embedded === 0
            ? "Index rebuilt with no new embeddings: L3/L4/L5 are pure functions of the log and every vector was already current."
            : "Index rebuilt: " +
              report.embedded +
              " decision(s) embedded, " +
              report.skipped +
              " unchanged, levels " +
              report.levels.join("/") +
              ".",
        actor: ASK_ACTOR,
        occurredAt: nowISO() as ISODateString,
      });

      if (!committed.ok) {
        set({
          buildError:
            "The index was built but its events could not be committed: " +
            committed.error +
            ". Retrieval will still work from the in-memory artifacts; the log just cannot explain this rebuild later.",
        });
        return report;
      }
    }

    set({ status: "idle" });
    return report;
  },

  /** Build only if there is nothing to reuse. Called on first ask so the keyless path works
   *  with no setup step, and by gate (b) so the reasoning layer never waits on a rebuild it
   *  did not ask for. */
  ensureIndex: async () => {
    const existing = get().artifacts;
    if (existing !== null && !existing.stale) return existing;
    const report = await get().buildTheIndex();
    return report?.artifacts ?? null;
  },

  /* ---------------------------------------------------------------------- */
  /* The question                                                           */
  /* ---------------------------------------------------------------------- */

  ask: async (question) => {
    const trimmed = question.trim();
    if (trimmed.length === 0) {
      set({ error: "Ask something first." });
      return null;
    }

    const whylog = useWhyLog.getState();
    if (whylog.engine === null) {
      set({ error: "No engine is available. Boot the app first." });
      return null;
    }
    if (get().status === "asking") return get().answer;

    const started = Date.now();
    set({ status: "asking", question: trimmed, error: null, answer: null });

    const artifacts = await get().ensureIndex();
    if (artifacts === null) {
      const message =
        get().buildError ?? "The index could not be built, so there is nothing to search.";
      set({ status: "failed", error: message, durationMs: Date.now() - started });
      return null;
    }

    /* Labels are COMPUTED, not stored: the label follows from the graph, so the current
     * labelling is derived on demand rather than read from a field that could go stale. A
     * citation expansion showing a stale label would claim a falsified premise still holds,
     * which is the one sentence this feature must never print. */
    const labels = label(whylog.state).labels;

    const options: Partial<QueryOptions> = {
      topK: DEFAULT_QUERY_OPTIONS.topK,
      /* The user's search-step cap, already a setting from Phase 2. The evidence contract
       * keeps its own hard ceiling of 3; this can only lower it, never raise it. */
      recallK: DEFAULT_QUERY_OPTIONS.recallK,
      rrfK: DEFAULT_QUERY_OPTIONS.rrfK,
    };

    try {
      const answer = await runAsk({
        state: whylog.state,
        artifacts,
        labels: labels as ReadonlyMap<NodeId, Labelled>,
        engine: whylog.engine.engine,
        engineId: whylog.engineId,
        question: trimmed,
        options,
      });

      /* Expand every citation the answer made, so the reader can check each one against the
       * premises it rests on rather than taking the sentence's word for it. */
      const cited = answer.citations.map((citation) => citation.decisionId);
      const { expanded, missing } = expandAll(whylog.state, labels, cited, whylog.engineId);

      const entry: AskHistoryEntry = {
        question: trimmed,
        answeredAt: answer.answeredAt,
        verdict: answer.verdict,
        groundedness: answer.groundedness,
        searches: answer.trace.searches.length,
      };

      set({
        status: "answered",
        answer,
        expansions: expanded,
        missingCitations: missing,
        durationMs: Date.now() - started,
        history: [entry, ...get().history].slice(0, HISTORY_LIMIT),
      });

      return answer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "failed", error: message, durationMs: Date.now() - started });
      return null;
    }
  },

  setQuestion: (question) => set({ question }),
  select: (id) => set({ selected: id }),

  clear: () =>
    set({
      status: "idle",
      question: "",
      answer: null,
      error: null,
      expansions: [],
      missingCitations: [],
      selected: null,
      durationMs: 0,
    }),

  /* ---------------------------------------------------------------------- */
  /* Gate (b)                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Candidate pairs for gate (b), in the signature `ReviseInput.retrieve` expects.
   *
   * Reads the L1 vectors already in the index, so it makes ZERO embedding calls and works
   * keyless. When there is no index at all it returns an empty list rather than throwing:
   * gate (b) then reports itself unavailable, which is the honest outcome and the one
   * `gates/semantic.ts` was written to produce.
   */
  candidatesFor: async (state) => {
    const artifacts = currentArtifacts();
    if (artifacts === null) return [];
    return candidatePairs(state, artifacts);
  },
}));

export const HISTORY_LIMIT = 20;

/* -------------------------------------------------------------------------- */
/* Reporting — everything the Ask view's "how was this produced?" panel shows */
/* -------------------------------------------------------------------------- */

export function describeIndex(state: AskState): string {
  const whylog = useWhyLog.getState();
  const artifacts = state.artifacts;

  if (artifacts === null) {
    return "No index has been built yet. Ask a question and it will be built first.";
  }

  if (state.build !== null)
    return (
      describeBuild(state.build) + "\n\nLog size: " + whylog.state.decisions.size + " decisions."
    );

  return (
    "Index built by " +
    artifacts.engine +
    " at " +
    artifacts.computedAt +
    (artifacts.stale ? " — STALE: the engine or the log has changed since." : "") +
    "\nLog size: " +
    whylog.state.decisions.size +
    " decisions."
  );
}

export function describeHowProduced(_state: AskState, result: RetrievalResult | null): string {
  const parts = [
    describePipeline(),
    "",
    "──────── reranker ────────",
    describeWeights(),
    "",
    "──────── evidence contract ────────",
    describeContract(),
    "",
    "──────── groundedness ────────",
    describeThresholds(),
    "",
    "──────── contradiction classifier ────────",
    describeRules(),
    "",
    "──────── gate (b) candidates ────────",
    describeCandidatePolicy(),
  ];

  if (result !== null) {
    parts.push("", "──────── this question ────────", describeRetrieval(result));
  }

  return parts.join("\n");
}

/** The pre-emption index's coverage, for the health panel. The gap between eligible and total
 *  alternatives is what Phase 1's 15.4% alternative precision costs, and showing it is more
 *  honest than showing a pre-emption feature that never fires and letting the user assume it
 *  is broken. */
export function describePreemptionCoverage(state: GraphState): string {
  const counts = countPreemptions(state);

  if (counts.total === 0) {
    return "No alternatives have been recorded, so nothing can pre-empt. Alternatives come from transcript extraction and from the Review tab.";
  }

  return [
    counts.eligible +
      " of " +
      counts.total +
      " recorded alternatives can pre-empt a repeat question.",
    counts.missingReason > 0
      ? "  " +
        counts.missingReason +
        " have no recorded reason — pre-empting without a reason is nagging, so they are excluded."
      : "",
    counts.unconfirmed > 0
      ? "  " +
        counts.unconfirmed +
        " have a reason but were never confirmed by a human — an inferred rejection is far more likely to be wrong than right, so they are excluded too."
      : "",
    "",
    "Confirm an alternative on the Review tab to make it eligible. A false pre-emption costs",
    "more trust than a missed one, so both conditions are required rather than one.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Re-exported for the view, which renders the expansion of whichever citation is selected. */
export { renderExpansion, describeSource };
export type { ExpandedCitationResult, RetrievalResult };

/** Run retrieval without composing an answer — used by the Ask view's "show me the ranking"
 *  panel and by Phase 7's ablation, neither of which needs prose. Labels are derived here for
 *  the same reason they are derived in `ask`: they follow from the graph, so nothing stores
 *  them. */
export async function retrieveOnly(
  state: GraphState,
  artifacts: IndexArtifacts,
  question: string,
): Promise<RetrievalResult | null> {
  const whylog = useWhyLog.getState();
  if (whylog.engine === null) return null;

  return retrieve({
    state,
    artifacts,
    labels: label(state).labels,
    engine: whylog.engine.engine,
    question,
  });
}

export type { Answer, RetrievedHit };
