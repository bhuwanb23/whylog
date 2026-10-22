/**
 * The guard store — Phase 4 · sub-phases 4.2–4.7.
 *
 * Plan: plan/phase-4-executable-guards.md
 *
 * ---------------------------------------------------------------------------
 * WHAT IT OWNS
 *
 *   the virtual project   pasted `package.json` / listing / contents, persisted
 *   the baseline          frozen failures and the ratchet, persisted
 *   the run               evaluate → verification events → reasoning assertions
 *   the review actions    accept · suppress · delete · edit
 *   the metrics           all five, recomputed from the materialised graph
 *   the CI export         runner + workflow
 *
 * ---------------------------------------------------------------------------
 * THE RUN IS TWO BATCHES, FOR THE SAME REASON PHASE 2'S IS
 *
 * A guard failure produces verification events AND a reasoning assertion. They cannot go in one
 * batch, because `revise` must see the graph AFTER the failure is folded — the labeller, the
 * gates and the cascade all read state, and reasoning over a state that does not yet contain the
 * failure would produce a proposal about a world that has already moved on.
 *
 *   1. append `GuardRan` / `GuardFailed` → fold → new state
 *   2. `assertAndRevise(guardResultAssertion)` → append its drafts → fold
 *
 * Step 2 goes through `store/reasoning.ts`, which is the same entry point a transcript uses.
 * That is not convenience — it is §4.5's acceptance criterion. A guard failure that reached the
 * reasoner by a different route would mean two reasoning paths, and only one of them would be
 * exercised.
 *
 * ---------------------------------------------------------------------------
 * BASELINED FAILURES ARE RECORDED BUT NOT ASSERTED
 *
 * A failure the baseline already knew about still gets its `GuardFailed` event and still shows
 * in the panel. It does NOT produce a revision proposal, because firing one for a violation that
 * predates the guard would fill the queue with things the user already knows about, on the first
 * run — which is the wall of red the baseline pattern exists to prevent, arriving by another
 * route.
 * ---------------------------------------------------------------------------
 */

import {
  type DecisionGuards,
  type EvaluatedGuard,
  type MetricsResult,
  type ProjectInput,
  type ProjectParseReport,
  type SynthesisReport,
  acceptedGuards,
  buildProject,
  metrics as computeMetrics,
  describeBaseline,
  describeExport,
  describeProject,
  exportCi,
  freezeBaseline,
  guardsForDecision,
  hasBaseline,
  overCap,
  runAll,
  shrinkBaseline,
  synthesiseAll,
  synthesiseDecision,
  whyDisabled,
} from "@/guards";
import { nowISO } from "@/lib/format";
import { type Result, err, ok } from "@/lib/result";
import type { Assertion } from "@/reasoning/assert";
import { label } from "@/reasoning/labeller";
import type { GraphState } from "@/substrate/graph-state";
import type { Actor } from "@/types/common";
import type { DecisionId, GuardId, ISODateString } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type {
  GuardBaseline,
  GuardSeverity,
  GuardSpec,
  UnverifiableDecision,
  VirtualProject,
} from "@/types/guards";
import { EMPTY_VIRTUAL_PROJECT } from "@/types/guards";
import { create } from "zustand";
import { useReasoning } from "./reasoning";
import { useWhyLog } from "./whylog";

/** Persisted alongside the log. The virtual project is a paste, not a derivation: losing it on
 *  reload would mean re-pasting a file listing every session, which is enough friction that the
 *  compliance score stops getting looked at. */
export const GUARDS_STORAGE_KEY = "whylog:guards:v1";

/** `system`, not `engine`: evaluating a guard against a pasted project is deterministic given
 *  both, and stamping it as an engine act would claim a model produced a result that a
 *  dependency lookup produced. A judged guard names its own engine on its verdict. */
const GUARD_ACTOR: Actor = { kind: "system" };

export type GuardStoreStatus = "idle" | "synthesising" | "running" | "failed";

interface PersistedGuards {
  readonly project: VirtualProject | null;
  readonly baseline: GuardBaseline | null;
}

export interface GuardState {
  /* --- the project and the baseline --- */
  readonly project: VirtualProject;
  readonly parse: ProjectParseReport | null;
  readonly baseline: GuardBaseline | null;

  /* --- runs --- */
  readonly status: GuardStoreStatus;
  readonly error: string | null;
  readonly lastRunAt: ISODateString | null;
  readonly lastRunDurationMs: number;
  readonly lastRunSummary: string | null;
  /** The last run's results, retained so `freeze` has something to freeze and so metrics can be
   *  recomputed without re-running. Not persisted: it describes a project that may no longer be
   *  pasted, and a baseline frozen from a vanished paste would be meaningless. */
  readonly lastEvaluated: readonly EvaluatedGuard[];

  /* --- synthesis --- */
  readonly reports: readonly SynthesisReport[];
  readonly unverifiable: readonly UnverifiableDecision[];

  /* --- metrics --- */
  readonly metricsResult: MetricsResult | null;

  /* --- selection --- */
  readonly selected: DecisionId | null;

  /* --- actions --- */
  readonly loadProject: (input: ProjectInput) => void;
  readonly synthesise: (options?: { templatesOnly?: boolean; decisionId?: DecisionId }) => Promise<
    Result<number, string>
  >;
  readonly run: () => Promise<Result<number, string>>;
  readonly freeze: () => void;
  readonly removeFromBaseline: (guardId: GuardId) => void;
  readonly accept: (guardId: GuardId) => Result<void, string>;
  readonly suppress: (guardId: GuardId, reason: string) => Result<void, string>;
  readonly remove: (guardId: GuardId, reason: string) => Result<void, string>;
  readonly edit: (
    guardId: GuardId,
    spec: GuardSpec,
    rationale: string,
    severity?: GuardSeverity,
  ) => Result<void, string>;
  readonly select: (decisionId: DecisionId | null) => void;
  readonly exportForCi: () => Result<{ runner: string; workflow: string; summary: string }, string>;
  readonly groupFor: (decisionId: DecisionId) => DecisionGuards;
  readonly disabledReason: (guardId: GuardId) => string | null;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

function load(): PersistedGuards {
  try {
    const raw = localStorage.getItem(GUARDS_STORAGE_KEY);
    if (raw === null) return { project: null, baseline: null };

    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return { project: null, baseline: null };

    const record = parsed as Record<string, unknown>;

    /* The virtual project survives JSON intact — it is strings and arrays. The `Float32Array`s
     * that make the index blob awkward to persist have no counterpart here, which is part of why
     * the pasted-project design is the default rather than a fallback. */
    const project =
      record["project"] !== null && typeof record["project"] === "object"
        ? (record["project"] as VirtualProject)
        : null;

    const baseline =
      record["baseline"] !== null && typeof record["baseline"] === "object"
        ? (record["baseline"] as GuardBaseline)
        : null;

    return { project, baseline };
  } catch {
    /* A corrupt paste is not worth failing the app over. Starting empty costs one re-paste. */
    return { project: null, baseline: null };
  }
}

function persist(project: VirtualProject, baseline: GuardBaseline | null): void {
  try {
    localStorage.setItem(GUARDS_STORAGE_KEY, JSON.stringify({ project, baseline }));
  } catch {
    /* Quota or a disabled storage. The run still works in memory; only the reload loses it. */
  }
}

const initial = load();

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

export const useGuards = create<GuardState>()((set, get) => ({
  project: initial.project ?? EMPTY_VIRTUAL_PROJECT,
  parse: null,
  baseline: initial.baseline,

  status: "idle",
  error: null,
  lastRunAt: null,
  lastRunDurationMs: 0,
  lastRunSummary: null,
  lastEvaluated: [],

  reports: [],
  unverifiable: [],
  metricsResult: null,
  selected: null,

  /* ---------------------------------------------------------------------- */
  /* The project                                                            */
  /* ---------------------------------------------------------------------- */

  loadProject: (input) => {
    const report = buildProject(input);
    set({ project: report.project, parse: report });
    persist(report.project, get().baseline);
  },

  /* ---------------------------------------------------------------------- */
  /* Stage 1 — synthesise                                                   */
  /* ---------------------------------------------------------------------- */

  synthesise: async (options) => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message =
        "The log is read-only: its hash chain is broken. Synthesis needs to append events.";
      set({ status: "failed", error: message });
      return err(message);
    }
    if (whylog.engine === null) {
      const message = "No engine is available. Boot the app before synthesising guards.";
      set({ status: "failed", error: message });
      return err(message);
    }
    if (get().status === "synthesising") return err("Synthesis is already running.");

    set({ status: "synthesising", error: null });
    const at = nowISO() as ISODateString;

    try {
      /* ---- one decision, or the whole log ---- */
      let reports: readonly SynthesisReport[] = [];
      let unverifiable: readonly UnverifiableDecision[] = [];
      const drafts: NewEvent<EventType>[] = [];

      if (options?.decisionId !== undefined) {
        const result = await synthesiseDecision({
          state: whylog.state,
          decisionId: options.decisionId,
          engine: whylog.engine.engine,
          ...(options.templatesOnly === undefined ? {} : { templatesOnly: options.templatesOnly }),
          actor: GUARD_ACTOR,
          at,
        });
        reports = [result.report];
        unverifiable = result.report.unverifiable === null ? [] : [result.report.unverifiable];
        drafts.push(...result.drafts);
      } else {
        const all = await synthesiseAll({
          state: whylog.state,
          engine: whylog.engine.engine,
          ...(options?.templatesOnly === undefined ? {} : { templatesOnly: options.templatesOnly }),
        });

        reports = all.reports;
        unverifiable = all.unverifiable;

        /* Events are built here rather than inside `synthesiseAll`, because id suffixes depend
         * on how many guards each decision already has — and only the store knows whether a
         * previous batch in this same run has already claimed a suffix. */
        const claimed = new Map<DecisionId, number>();

        for (const report of all.reports) {
          let index =
            claimed.get(report.decisionId) ?? countExisting(whylog.state, report.decisionId);

          for (const proposed of report.proposed) {
            drafts.push({
              type: "GuardSynthesised",
              payload: {
                guardId: mintGuardId(report.decisionId, String(index)),
                decisionId: report.decisionId,
                kind: proposed.spec.kind,
                spec: proposed.spec,
                severity: proposed.severity,
                rationale: proposed.rationale,
                generatedBy: proposed.generatedBy,
              },
              actor: GUARD_ACTOR,
              reason: `Compiled from ${report.decisionId} by the ${proposed.generatedBy} path: ${proposed.spec.kind}. PROPOSED — it will not run until a human accepts it.`,
              at,
            });
            index += 1;
          }

          claimed.set(report.decisionId, index);
        }
      }

      if (drafts.length > 0) {
        const committed = whylog.recordBatch(drafts, {
          reason: `Synthesised ${drafts.length} proposed guard(s) from the decisions in the log. Nothing is installed: every one is PROPOSED and will not run until accepted.`,
          actor: GUARD_ACTOR,
          occurredAt: at,
        });

        if (!committed.ok) {
          set({ status: "failed", error: committed.error });
          return err(committed.error);
        }
      }

      set({ status: "idle", reports, unverifiable });
      recomputeMetrics();

      return ok(drafts.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "failed", error: message });
      return err(message);
    }
  },

  /* ---------------------------------------------------------------------- */
  /* Stage 3 — run, and stage 5 — feed back                                 */
  /* ---------------------------------------------------------------------- */

  run: async () => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message =
        "The log is read-only: its hash chain is broken. A guard run needs to append events.";
      set({ status: "failed", error: message });
      return err(message);
    }
    if (get().status === "running") return err("A guard run is already in progress.");

    const guards = acceptedGuards(whylog.state);
    if (guards.length === 0) {
      const message =
        "No ACCEPTED guards, so there is nothing to run. Synthesise first, then accept the checks worth hearing about — a proposed guard never runs, because an unaccepted check that fails is noise nobody agreed to hear.";
      set({ status: "failed", error: message });
      return err(message);
    }

    set({ status: "running", error: null });
    const at = nowISO() as ISODateString;
    const labels = label(whylog.state).labels;

    try {
      const result = await runAll({
        state: whylog.state,
        labels,
        project: get().project,
        baseline: get().baseline,
        engine: whylog.engine?.engine ?? null,
        engineId: whylog.engineId,
        actor: GUARD_ACTOR,
        at,
      });

      /* ---- batch 1: the verification events ---- */
      if (result.drafts.length > 0) {
        const committed = whylog.recordBatch(result.drafts, {
          reason: `Ran ${guards.length} accepted guard(s) against the pasted project: ${result.report.blockingFailures} new blocking failure(s), ${result.report.warningFailures} new warning(s).`,
          actor: GUARD_ACTOR,
          occurredAt: at,
        });

        if (!committed.ok) {
          set({ status: "failed", error: committed.error });
          return err(committed.error);
        }
      }

      set({
        baseline: result.baseline,
        lastRunAt: at,
        lastRunDurationMs: result.report.durationMs,
        lastEvaluated: result.evaluated,
        lastRunSummary: summariseRun(
          result.report.blockingFailures,
          result.report.warningFailures,
          result.report.nothingCheckable,
          result.assertions.length,
        ),
      });
      persist(get().project, result.baseline);

      /* ---- batch 2: the reasoning assertions, through the SAME entry point a transcript uses ---- */
      let proposals = 0;
      for (const assertion of result.assertions) {
        const outcome = await useReasoning.getState().assertAndRevise(assertion);
        if (outcome.ok) proposals += 1;
      }

      set({ status: "idle" });
      recomputeMetrics();

      return ok(proposals);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "failed", error: message });
      return err(message);
    }
  },

  /* ---------------------------------------------------------------------- */
  /* Stage 4 — the baseline                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Freeze the current failures as the baseline.
   *
   * Requires a completed run: freezing without results would produce an empty baseline, which
   * silently declares every future failure new — the opposite of what freezing is for.
   *
   * Freezing AGAIN replaces the baseline with the current state. That is how a user deliberately
   * accepts a new set of known failures, so the UI confirms before doing it rather than treating
   * it as a routine click.
   */
  freeze: () => {
    const evaluated = get().lastEvaluated;

    if (get().lastRunAt === null || evaluated.length === 0) {
      set({
        error: "Run the guards first. A baseline freezes a set of results, and there are none yet.",
      });
      return;
    }

    const frozen = freezeBaseline(evaluated, get().baseline);
    const known = Object.keys(frozen.frozenFailures).length;

    set({
      baseline: frozen,
      error: null,
      lastRunSummary: `Baseline frozen at ${frozen.frozenAt}: ${known} known failure(s) recorded and ${frozen.enforced.length} guard(s) ratcheted as enforced. Only violations NEW since this freeze surface as drift.`,
    });

    persist(get().project, frozen);
    recomputeMetrics();
  },

  removeFromBaseline: (guardId) => {
    const baseline = get().baseline;
    if (baseline === null) return;

    const next = shrinkBaseline(baseline, guardId);
    set({ baseline: next });
    persist(get().project, next);
  },

  /* ---------------------------------------------------------------------- */
  /* Stage 2 — review                                                       */
  /* ---------------------------------------------------------------------- */

  accept: (guardId) =>
    reviewAction(guardId, (guard, _state, at) => [
      {
        type: "GuardAccepted",
        payload: { guardId: guard.id },
        actor: GUARD_ACTOR,
        reason: `A human accepted guard ${guard.id} (${guard.spec.kind}) for ${guard.decisionId}. It was proposed by the ${guard.generatedBy} path and does not run before this point — an unaccepted check that fails is noise nobody agreed to hear.`,
        at,
      },
    ]),

  suppress: (guardId, reason) => {
    if (reason.trim().length === 0) {
      return err(
        "A suppression needs a reason. Silencing a failing check is the act most in need of a recorded justification.",
      );
    }

    return reviewAction(guardId, (guard, _state, at) => [
      {
        type: "GuardSuppressed",
        payload: { guardId: guard.id, suppressionReason: reason.trim() },
        actor: GUARD_ACTOR,
        reason: `A human suppressed guard ${guard.id} on ${guard.decisionId}: ${reason.trim()}`,
        at,
      },
    ]);
  },

  remove: (guardId, reason) =>
    reviewAction(guardId, (guard, _state, at) => [
      {
        type: "GuardDeleted",
        payload: { guardId: guard.id },
        actor: GUARD_ACTOR,
        reason: `A human deleted guard ${guard.id} from ${guard.decisionId}${reason.trim().length > 0 ? `: ${reason.trim()}` : ". No reason given."} The record is retained with lifecycle \`deleted\`; nothing is ever removed from the log.`,
        at,
      },
    ]),

  /** Editing is delete + re-synthesise. There is no `GuardEdited` event, and adding one would
   *  let a spec change without a record of the spec it replaced. */
  edit: (guardId, spec, rationale, severity) =>
    reviewAction(guardId, (guard, state, at) => {
      const suffix = nextFreeSuffix(state, guard.decisionId, guard.id);
      const newId = mintGuardId(guard.decisionId, suffix);

      return [
        {
          type: "GuardDeleted",
          payload: { guardId: guard.id },
          actor: GUARD_ACTOR,
          reason: `Guard ${guard.id} was edited, and editing is delete + re-synthesise: the closed vocabulary has no edit event, so the previous spec stays in the log. A guard whose spec changed quietly after it started failing would be indistinguishable from one weakened to make the failure go away.`,
          at,
        },
        {
          type: "GuardSynthesised",
          payload: {
            guardId: newId,
            decisionId: guard.decisionId,
            kind: spec.kind,
            spec,
            severity: severity ?? guard.severity,
            rationale: rationale.trim().length > 0 ? rationale.trim() : guard.rationale,
            generatedBy: "user" as const,
          },
          actor: GUARD_ACTOR,
          reason: `Replacement for ${guard.id}, written by a human: ${spec.kind}. PROPOSED — an edit does not inherit the old guard's acceptance, because that would let an edit activate a check nobody reviewed.`,
          at,
        },
      ];
    }),

  select: (decisionId) => set({ selected: decisionId }),

  /* ---------------------------------------------------------------------- */
  /* Stage 6 — CI export                                                    */
  /* ---------------------------------------------------------------------- */

  exportForCi: () => {
    const whylog = useWhyLog.getState();
    const labels = label(whylog.state).labels;

    const exported = exportCi({
      state: whylog.state,
      labels,
      headHash: whylog.log.headHash,
    });

    if (exported.guards.length === 0) {
      return err(
        `Nothing to export. ${
          acceptedGuards(whylog.state).length === 0
            ? "No guard has been accepted yet — CI should run what a human accepted, not what a template proposed."
            : "Every accepted guard is non-deterministic, so none can fail a build reproducibly."
        }`,
      );
    }

    return ok({
      runner: exported.runner,
      workflow: exported.workflow,
      summary: describeExport(exported),
    });
  },

  /* ---------------------------------------------------------------------- */
  /* Read helpers                                                           */
  /* ---------------------------------------------------------------------- */

  groupFor: (decisionId) => {
    const whylog = useWhyLog.getState();
    return guardsForDecision(whylog.state, label(whylog.state).labels, decisionId);
  },

  disabledReason: (guardId) => {
    const whylog = useWhyLog.getState();
    const guard = whylog.state.guards.get(guardId);
    if (guard === undefined) return null;

    const labels = label(whylog.state).labels;
    return whyDisabled(guard, guardsForDecision(whylog.state, labels, guard.decisionId));
  },
}));

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** One review action: build the events, append them, recompute. Every review action goes through
 *  here so none of them can forget the recompute — and a metric that is not recomputed after a
 *  guard is accepted is a metric that reports the pre-acceptance world. */
function reviewAction(
  guardId: GuardId,
  build: (
    guard: NonNullable<ReturnType<typeof findGuard>>,
    state: GraphState,
    at: ISODateString,
  ) => readonly NewEvent<EventType>[],
): Result<void, string> {
  const whylog = useWhyLog.getState();

  if (whylog.status === "degraded") return err("The log is read-only: its hash chain is broken.");

  const guard = findGuard(whylog.state, guardId);
  if (guard === undefined) return err(`Guard ${guardId} is not in the log.`);

  const at = nowISO() as ISODateString;
  const events = build(guard, whylog.state, at);
  if (events.length === 0) return err("That action produced no events.");

  const committed = whylog.recordBatch(events, {
    reason: events[0]?.reason ?? `Guard review action on ${guardId}.`,
    actor: GUARD_ACTOR,
    occurredAt: at,
  });

  if (!committed.ok) return err(committed.error);

  recomputeMetrics();
  return ok(undefined);
}

function findGuard(state: GraphState, guardId: GuardId) {
  return state.guards.get(guardId);
}

function countExisting(state: GraphState, decisionId: DecisionId): number {
  let count = 0;
  for (const guard of state.guards.values()) {
    if (guard.decisionId === decisionId) count += 1;
  }
  return count;
}

function nextFreeSuffix(state: GraphState, decisionId: DecisionId, excluding: GuardId): string {
  const used = new Set<string>();

  for (const guard of state.guards.values()) {
    if (guard.decisionId !== decisionId) continue;
    if (guard.id === excluding) continue;
    used.add(guard.id.slice(`G-${decisionId.slice(4)}`.length));
  }

  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(letter)) return letter;
  }
  return String(used.size + 1);
}

/** `G-0007a` — mirrors `formatGuardId` in `lib/ids.ts`. */
function mintGuardId(decisionId: DecisionId, suffix: string): GuardId {
  return `G-${decisionId.slice(4)}${suffix}` as GuardId;
}

function summariseRun(
  blocking: number,
  warnings: number,
  nothingCheckable: boolean,
  assertions: number,
): string {
  if (nothingCheckable) {
    return "Every guard SKIPPED — the pasted project did not contain the data any of them needs. This is not a clean run: nothing was checked. Paste a package.json, a file listing, or file contents.";
  }

  const parts = [`${blocking} new blocking failure(s), ${warnings} new warning(s).`];

  if (assertions > 0) {
    parts.push(
      `${assertions} failure(s) entered the reasoning cycle as evidence, through the same entry point a transcript uses.`,
    );
  } else if (blocking + warnings > 0) {
    parts.push(
      "No revision proposals: every failure was already in the baseline, so none counts as new drift. Shrink the baseline deliberately as you fix things.",
    );
  }

  return parts.join(" ");
}

/** Recompute all five metrics from the materialised graph. */
function recomputeMetrics(): void {
  const whylog = useWhyLog.getState();
  const guardStore = useGuards.getState();
  const labels = label(whylog.state).labels;

  /* Prefer the retained run: it carries baseline-relative novelty, which `evaluatedFrom` cannot
   * reconstruct, because a stored `lastRun` does not record whether the baseline knew about it. */
  const evaluated =
    guardStore.lastEvaluated.length > 0 ? guardStore.lastEvaluated : evaluatedFrom(whylog.state);

  useGuards.setState({
    metricsResult: computeMetrics({
      state: whylog.state,
      labels,
      evaluated,
      unverifiable: guardStore.unverifiable,
      now: Date.now(),
    }),
  });
}

/** The stored last-run results are on the guard records themselves (`lastRun`), so the metrics
 *  can be recomputed from the graph without keeping a run report in the store. */
function evaluatedFrom(state: GraphState): readonly EvaluatedGuard[] {
  const out: EvaluatedGuard[] = [];

  for (const guard of state.guards.values()) {
    if (guard.lifecycle !== "accepted") continue;
    if (guard.lastRun === undefined) continue;

    out.push({
      guard,
      result: guard.lastRun,
      skipped: guard.lastRun.outcome === "skip",
      skipReason: guard.lastRun.skipReason ?? null,
      /* Without a baseline in hand this cannot be decided, so a stored failure counts as new.
       * The run path computes it properly; this is only for recomputing metrics between runs. */
      newViolation: guard.lastRun.outcome === "fail",
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeGuardStore(state: GuardState): string {
  const whylog = useWhyLog.getState();
  const accepted = acceptedGuards(whylog.state);

  return [
    "Virtual project:",
    describeProject(state.project),
    "",
    `Guards: ${whylog.state.guards.size} record(s), ${accepted.length} accepted.`,
    "",
    "Baseline:",
    describeBaseline(state.baseline),
    "",
    hasBaseline(state.baseline) ? "" : "Freeze a baseline after the first full run.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Decisions with more guards than the cap, for the review panel.
 *
 *  Takes the graph state as an argument rather than reading the global store:
 *  a view that memoises on one state must not be answered from another. */
export function overCapDecisions(
  state: GraphState,
): readonly { decisionId: DecisionId; over: number }[] {
  const labels = label(state).labels;
  const out: { decisionId: DecisionId; over: number }[] = [];

  for (const decision of state.decisions.values()) {
    const group = guardsForDecision(state, labels, decision.id);
    const over = overCap(group);
    if (over.length > 0) out.push({ decisionId: decision.id, over: over.length });
  }

  return out;
}

export type { Assertion };
