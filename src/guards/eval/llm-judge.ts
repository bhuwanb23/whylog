/**
 * `llm_judge` — 4.3. The last resort, scored separately.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 * Docs: docs/04-executable-decision-guards.md §8
 *
 * ---------------------------------------------------------------------------
 * JUDGED VERDICTS NEVER ENTER THE COMPLIANCE SCORE
 *
 * This is the documented failure mode: "`llm_judge` results laundered into the compliance
 * number". The mitigation is structural, not a warning label — `isDeterministic(kind)` is false
 * for this kind, `metrics/compliance.ts` filters on exactly that predicate, and there is no
 * code path by which a judged verdict reaches the headline number.
 *
 * A compliance score that includes a model's opinion is a score nobody can reproduce, and a
 * number that changes when the model changes is not a measurement of the codebase.
 *
 * ---------------------------------------------------------------------------
 * IT IS STILL WORTH HAVING
 *
 * Some decisions genuinely cannot be expressed deterministically. "Keep the API surface small"
 * has no dependency to check and no glob to match. For those, a rubric verdict over the scoped
 * files is better than an `unverifiable` mark — but it is reported as ADVISORY, in its own
 * section, with the engine named on every verdict, and it never contributes to compliance.
 *
 * And when no key is configured, it does not fake a verdict. It skips, with a reason that says
 * what is missing. The downloaded-cross-encoder lesson from Phase 3 applies unchanged: an
 * unavailable path is documented as unavailable, never simulated.
 * ---------------------------------------------------------------------------
 */

import type { WhyLogEngine } from "@/ai/types";
import { filterByGlob } from "@/lib/glob";
import type { EngineId } from "@/types/common";
import type { LlmJudgeSpec, VirtualProject } from "@/types/guards";
import { hasFileContents, hasFileListing } from "../project";
import { type Evaluation, SKIP_NO_CONTENTS, SKIP_NO_LISTING } from "./types";

/** How much file text is sent to the judge. Bounded because a rubric verdict over 200 KB of
 *  source is not a better verdict than one over the first 20 KB — it is a slower and more
 *  expensive one, and the bound keeps the cost of an advisory check predictable. */
export const JUDGE_CHAR_BUDGET = 20_000;

/** How many files, at most. */
export const JUDGE_FILE_LIMIT = 8;

export interface JudgeInput {
  readonly spec: LlmJudgeSpec;
  readonly project: VirtualProject;
  readonly engine: WhyLogEngine | null;
  readonly engineId: EngineId;
  readonly decisionStatement: string;
  readonly signal?: AbortSignal;
}

export interface JudgeVerdict {
  readonly evaluation: Evaluation;
  /** Named on every verdict. A judgement with no attributed judge cannot be weighed. */
  readonly engine: EngineId | null;
  readonly filesJudged: readonly string[];
  readonly truncated: boolean;
}

/**
 * Ask the engine to judge.
 *
 * Returns a SKIP evaluation — never a fabricated verdict — when there is no engine, when the
 * engine cannot classify, or when the data the rubric needs was not pasted.
 */
export async function evalLlmJudge(input: JudgeInput): Promise<JudgeVerdict> {
  const { spec, project } = input;

  if (input.engine === null) {
    return skipped(
      "No engine is available, so this guard cannot be judged. It is advisory in any case and never contributes to the compliance score.",
      input.engineId,
    );
  }

  if (!input.engine.capabilities().classification) {
    return skipped(
      "The active engine (" +
        input.engineId +
        ") cannot produce a judgement. Configure an LLM engine in Settings, or replace this guard with a deterministic one.",
      input.engineId,
    );
  }

  if (!hasFileListing(project))
    return skippedResult(SKIP_NO_LISTING.skipReason ?? "", input.engineId);
  if (!hasFileContents(project))
    return skippedResult(SKIP_NO_CONTENTS.skipReason ?? "", input.engineId);

  const scoped: string[] = [];
  for (const glob of spec.scopeGlobs) {
    for (const path of filterByGlob(project.filePaths, glob)) {
      if (project.fileContents[path] === undefined) continue;
      if (!scoped.includes(path)) scoped.push(path);
    }
  }

  if (scoped.length === 0) {
    return skipped(
      "No pasted file matches this guard's scope (" +
        spec.scopeGlobs.join(", ") +
        "), so there was nothing to judge.",
      input.engineId,
    );
  }

  const files = scoped.slice(0, JUDGE_FILE_LIMIT);
  let budget = JUDGE_CHAR_BUDGET;
  let truncated = scoped.length > files.length;
  const material: string[] = [];

  for (const path of files) {
    const text = project.fileContents[path] ?? "";
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const slice = text.length > budget ? text.slice(0, budget) : text;
    if (text.length > budget) truncated = true;
    budget -= slice.length;
    material.push("--- " + path + " ---\n" + slice);
  }

  const prompt = [
    "Decision under test: " + input.decisionStatement,
    "",
    "Rubric: " + spec.rubric,
    "",
    "Files in scope:",
    material.join("\n\n"),
    "",
    "Answer with exactly one of PASS or FAIL on the first line, then one line of evidence",
    "quoting the file and the text that decided it. If the files do not let you tell, answer",
    "SKIP and say what is missing.",
  ].join("\n");

  const result = await input.engine.compose({
    kind: "guard-rationale",
    material: [],
    question: prompt,
    maxLengthChars: 600,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  const firstLine = result.text.split("\n")[0]?.trim().toUpperCase() ?? "";
  const rest = result.text.split("\n").slice(1).join(" ").trim();

  if (firstLine.startsWith("PASS")) {
    return {
      evaluation: {
        outcome: "pass",
        evidence:
          "Judged by " +
          result.engine +
          ": " +
          (rest.length > 0 ? rest : "the rubric was satisfied"),
      },
      engine: result.engine,
      filesJudged: files,
      truncated,
    };
  }

  if (firstLine.startsWith("FAIL")) {
    return {
      evaluation: {
        outcome: "fail",
        evidence:
          "Judged by " +
          result.engine +
          ": " +
          (rest.length > 0 ? rest : "the rubric was not satisfied"),
      },
      engine: result.engine,
      filesJudged: files,
      truncated,
    };
  }

  return {
    evaluation: {
      outcome: "skip",
      evidence: "",
      skipReason:
        "The judge could not tell from the files in scope" +
        (rest.length > 0 ? ": " + rest : ".") +
        (truncated ? " The material was truncated to " + JUDGE_CHAR_BUDGET + " characters." : ""),
    },
    engine: result.engine,
    filesJudged: files,
    truncated,
  };
}

function skipped(reason: string, engineId: EngineId): JudgeVerdict {
  return {
    evaluation: { outcome: "skip", evidence: "", skipReason: reason },
    engine: engineId,
    filesJudged: [],
    truncated: false,
  };
}

function skippedResult(reason: string, engineId: EngineId): JudgeVerdict {
  return skipped(reason, engineId);
}

/** The advisory framing, printed wherever a judged verdict appears. */
export const ADVISORY_NOTICE =
  "Judged guards are ADVISORY. They are produced by a model, they are not reproducible, and " +
  "they never enter the compliance score — which is computed over deterministic guards only. " +
  "A compliance number that included a model's opinion would change when the model changed, " +
  "and would no longer be a measurement of the codebase.";
