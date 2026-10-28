/**
 * The export store — Phase 5.
 *
 * Plan: plan/phase-5-export-compiler.md
 *
 * ---------------------------------------------------------------------------
 * WHAT IT OWNS
 *
 *   the compile       one graph → artifacts, in one pass, plus the events that record it
 *   the target set    all five by default; a builder switching editors should not re-export
 *   the verification  "check my files" — compare a pasted artifact's stamp against the log
 *   the round trip    plan a merge from a DECISIONS.md, show it, apply it only on confirmation
 *
 * ---------------------------------------------------------------------------
 * A BLOCKED EXPORT IS A RESULT, NOT AN ERROR
 *
 * When the consistency gate blocks, the store keeps the CIF and the explanation and sets
 * `blocked`, rather than throwing or clearing. The user needs to see WHICH two decisions conflict
 * and why — an export that fails with "contradiction detected" and no pair named is an export that
 * cannot be acted on, and the temptation is to reach for the `includeOut` toggle instead of
 * resolving the conflict.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION IS READ-ONLY UNTIL IT FINDS SOMETHING
 *
 * Checking a file writes no event when it matches. Only a MISMATCH produces
 * `ExportIntegrityMismatch`, because a log full of "checked, fine" entries would bury the one that
 * mattered — and the mismatch is the only finding here that says something about the world rather
 * than about the user having clicked a button.
 * ---------------------------------------------------------------------------
 */

import {
  type CompileResult,
  type MergePlan,
  compile,
  describeBudget,
  describeCompile,
  describeExportPhase,
  describeMergePlan,
  explainVerification,
  importedEvent,
  mismatchPayload,
  planMerge,
  verifyStamp,
} from "@/export";
import { nowISO } from "@/lib/format";
import { type Result, err, ok } from "@/lib/result";
import type { Actor } from "@/types/common";
import type { DecisionId, ISODateString } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import type {
  CompiledArtifact,
  ExportTarget,
  IntegrityStamp,
  StampVerification,
} from "@/types/export";
import { EXPORT_TARGETS, TARGET_FILENAMES } from "@/types/export";
import { create } from "zustand";
import { useWhyLog } from "./whylog";

/** `system`, not `engine`: compiling a graph into Markdown is deterministic, and stamping it as
 *  an engine act would claim a model produced a file that a fold and five pure functions did. */
const EXPORT_ACTOR: Actor = { kind: "system" };

export type ExportStatus = "idle" | "compiling" | "failed";

export interface CheckResult {
  readonly path: string;
  readonly verification: StampVerification;
  readonly note: string;
}

export interface ExportState {
  readonly status: ExportStatus;
  readonly error: string | null;
  readonly result: CompileResult | null;
  readonly blocked: boolean;
  readonly blockedExplanation: string | null;

  readonly targets: readonly ExportTarget[];
  readonly projectName: string;
  readonly maxLines: number;
  readonly includeOut: boolean;
  readonly includeSuperseded: boolean;

  readonly selected: ExportTarget | null;
  readonly checks: readonly CheckResult[];
  readonly mergePlan: MergePlan | null;
  readonly mergeNote: string | null;

  readonly compileAll: () => Promise<Result<number, string>>;
  readonly toggleTarget: (target: ExportTarget) => void;
  readonly setProjectName: (name: string) => void;
  readonly setMaxLines: (lines: number) => void;
  readonly setIncludeOut: (on: boolean) => void;
  readonly setIncludeSuperseded: (on: boolean) => void;
  readonly select: (target: ExportTarget | null) => void;
  readonly checkFile: (path: string, contents: string) => Result<CheckResult, string>;
  readonly planImport: (contents: string) => Result<MergePlan, string>;
  readonly applyImport: () => Promise<Result<number, string>>;
  readonly clearChecks: () => void;
}

export const useExport = create<ExportState>()((set, get) => ({
  status: "idle",
  error: null,
  result: null,
  blocked: false,
  blockedExplanation: null,

  /* All five by default. Emit-all-at-once is the plan's default and the right one: they are
   * compiled from one pass, so selecting fewer saves no work, and a builder who switches editors
   * next month should not have to remember to re-export. */
  targets: EXPORT_TARGETS,
  projectName: "",
  maxLines: 200,
  includeOut: false,
  includeSuperseded: false,

  selected: null,
  checks: [],
  mergePlan: null,
  mergeNote: null,

  /* ---------------------------------------------------------------------- */
  /* Compile                                                                */
  /* ---------------------------------------------------------------------- */

  compileAll: async () => {
    const whylog = useWhyLog.getState();

    if (whylog.status === "degraded") {
      const message =
        "The log is read-only: its hash chain is broken. An export needs to append the events that record it.";
      set({ status: "failed", error: message });
      return err(message);
    }

    if (whylog.state.decisions.size === 0) {
      const message =
        "The log holds no decisions, so there is nothing to compile. Import a transcript first.";
      set({ status: "failed", error: message });
      return err(message);
    }

    if (get().status === "compiling") return err("An export is already compiling.");

    set({ status: "compiling", error: null });

    try {
      const result = await compile({
        state: whylog.state,
        headHash: whylog.log.headHash,
        actor: EXPORT_ACTOR,
        targets: get().targets,
        maxLines: get().maxLines,
        includeOut: get().includeOut,
        includeSuperseded: get().includeSuperseded,
        ...(get().projectName.trim().length === 0 ? {} : { projectName: get().projectName.trim() }),
        engineAtGeneration:
          whylog.engineId.kind +
          (whylog.engineId.model.length > 0 ? "/" + whylog.engineId.model : ""),
      });

      /* ---- a blocked export keeps its explanation ---- */
      if (result.blocked) {
        set({
          status: "idle",
          result,
          blocked: true,
          blockedExplanation: result.blockedExplanation,
          error: null,
        });
        return err(
          "Blocked by the pre-export consistency gate. " +
            result.gate.conflicts.length +
            " conflicting pair(s). Nothing was written — see the explanation below.",
        );
      }

      /* ---- commit the events that record the export ---- */
      if (result.drafts.length > 0) {
        const committed = whylog.recordBatch(result.drafts, {
          reason:
            "Compiled " +
            result.artifacts.length +
            " export artifact(s) from log head " +
            result.stamp.headHash.slice(0, 12) +
            " and stamped them, so each file can be tied back to " +
            "the state that produced it.",
          actor: EXPORT_ACTOR,
          occurredAt: nowISO() as ISODateString,
        });

        if (!committed.ok) {
          set({ status: "failed", error: committed.error, result, blocked: false });
          return err(committed.error);
        }
      }

      set({ status: "idle", result, blocked: false, blockedExplanation: null });
      return ok(result.artifacts.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ status: "failed", error: message });
      return err(message);
    }
  },

  /* ---------------------------------------------------------------------- */
  /* Options                                                                */
  /* ---------------------------------------------------------------------- */

  toggleTarget: (target) => {
    const current = get().targets;
    set({
      targets: current.includes(target)
        ? current.filter((entry) => entry !== target)
        : [...current, target],
    });
  },

  setProjectName: (name) => set({ projectName: name }),
  setMaxLines: (lines) => set({ maxLines: Math.max(40, Math.min(2000, Math.round(lines) || 200)) }),
  setIncludeOut: (on) => set({ includeOut: on }),
  setIncludeSuperseded: (on) => set({ includeSuperseded: on }),
  select: (target) => set({ selected: target }),
  clearChecks: () => set({ checks: [] }),

  /* ---------------------------------------------------------------------- */
  /* Verify a file                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Compare a pasted artifact against the current log.
   *
   * Writes an event only on mismatch. A match is the expected outcome of clicking "check" and
   * recording it would fill the log with non-findings.
   */
  checkFile: (path, contents) => {
    const whylog = useWhyLog.getState();
    const current = whylog.log.headHash;

    const verification = verifyStamp({ contents, currentHeadHash: current });
    const note = explainVerification(verification, path);
    const check: CheckResult = { path, verification, note };

    set({ checks: [...get().checks, check] });

    if (verification.ok) return ok(check);

    const payload = mismatchPayload(path, current, verification);
    const at = nowISO() as ISODateString;

    const draft: NewEvent<EventType> = {
      type: "ExportIntegrityMismatch",
      payload,
      actor: EXPORT_ACTOR,
      reason:
        "A manual check of " +
        path +
        " found it does not correspond to the current log. Expected head " +
        (payload.expectedHead.slice(0, 12) || "(empty log)") +
        ", found " +
        (payload.foundHead === null ? "no stamp" : payload.foundHead.slice(0, 12)) +
        ". Recorded because an artifact that no longer matches its log is either stale or has been " +
        "rewritten — and an agent reading a rewritten rule is following something nobody decided.",
      at,
      occurredAt: at,
    };

    const committed = whylog.recordBatch([draft], {
      reason: draft.reason,
      actor: EXPORT_ACTOR,
      occurredAt: at,
    });

    if (!committed.ok) {
      return err("The mismatch was detected but could not be recorded: " + committed.error);
    }

    return ok(check);
  },

  /* ---------------------------------------------------------------------- */
  /* Round trip                                                             */
  /* ---------------------------------------------------------------------- */

  planImport: (contents) => {
    const whylog = useWhyLog.getState();
    const plan = planMerge(contents, whylog.state, whylog.log.headHash);

    set({ mergePlan: plan, mergeNote: describeMergePlan(plan) });

    if (plan.refuse) return err(plan.refusalReason ?? "Refused.");
    return ok(plan);
  },

  /**
   * Apply a planned merge.
   *
   * Only the `LogImported` event is written here. Records resolved as `new` are NOT committed as
   * decisions: invariant I4 says the system proposes and the human disposes, so they belong in the
   * review queue, and an import that silently created decisions would be an import that could
   * rewrite the log from a Markdown file.
   */
  applyImport: async () => {
    const whylog = useWhyLog.getState();
    const plan = get().mergePlan;

    if (plan === null) return err("Plan an import first.");
    if (plan.refuse) return err(plan.refusalReason ?? "This import was refused.");

    const at = nowISO() as ISODateString;
    const drafts: NewEvent<EventType>[] = [importedEvent(plan, EXPORT_ACTOR, at)];

    const committed = whylog.recordBatch(drafts, {
      reason: drafts[0]?.reason ?? "Imported decisions from an exported DECISIONS.md.",
      actor: EXPORT_ACTOR,
      occurredAt: at,
    });

    if (!committed.ok) return err(committed.error);

    set({ mergePlan: null, mergeNote: null });
    return ok(plan.counts.new);
  },
}));

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function describeExportState(state: ExportState): string {
  const parts = [describeExportPhase()];

  if (state.result !== null) {
    parts.push("", "──────── last compile ────────", describeCompile(state.result));
  }

  return parts.join("\n");
}

/** The budget line for whichever artifact is selected. */
export function describeSelectedBudget(state: ExportState): string {
  const artifact = selectedArtifact(state);
  if (artifact === null) return "Nothing compiled yet.";

  return (
    artifact.filename +
    "\n" +
    describeBudget(
      artifact.budget,
      artifact.contents.split("\n").length,
      Math.round(artifact.contents.length / 4),
    )
  );
}

export function selectedArtifact(state: ExportState): CompiledArtifact | null {
  if (state.result === null) return null;
  if (state.selected === null) return state.result.artifacts[0] ?? null;

  return state.result.artifacts.find((artifact) => artifact.target === state.selected) ?? null;
}

export function describeTarget(target: ExportTarget): string {
  return TARGET_FILENAMES[target];
}

export function describeStamp(stamp: IntegrityStamp): string {
  return [
    "Log head           " + stamp.headHash.slice(0, 12),
    "Generated          " + stamp.generatedAt,
    "Schema             whylog/v" + stamp.schemaVersion,
    "Decisions          " +
      stamp.decisions.total +
      " (IN " +
      stamp.decisions.inLabel +
      " · OUT " +
      stamp.decisions.out +
      " · superseded " +
      stamp.decisions.superseded +
      ")",
    "Premises           " +
      stamp.premises.total +
      " (IN " +
      stamp.premises.inLabel +
      " · OUT " +
      stamp.premises.out +
      " · contested " +
      stamp.premises.contested +
      ")",
    "Compliance         " + Math.round(stamp.compliance * 100) + "%",
    "Coverage           " + Math.round(stamp.verifiableCoverage * 100) + "%",
    "Guards             " +
      stamp.guards.passing +
      " passing / " +
      stamp.guards.failing +
      " failing",
    "Engine             " + stamp.engineAtGeneration,
    "",
    "Auditability, NOT security. The hash is unsalted and the algorithm is in the source, so",
    "anyone can recompute it — including an agent that has just rewritten the file and the stamp",
    "along with it. Compare against the log; do not trust the file.",
  ].join("\n");
}

export type { DecisionId };
