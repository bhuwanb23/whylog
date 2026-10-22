/**
 * The evaluator's return shape — 4.3.
 *
 * Deliberately smaller than `GuardRunResult`: an evaluator decides WHAT happened, and the
 * dispatcher in `./index.ts` stamps it with the guard id, the timestamp and the duration. An
 * evaluator that set its own `ranAt` would be a pure function reading the clock, and a pure
 * function that reads the clock cannot be reasoned about or reproduced.
 */

import type { GuardOutcome } from "@/types/guards";

export interface Evaluation {
  readonly outcome: GuardOutcome;
  /**
   * The exact line, field or path that produced the result, quoted verbatim.
   *
   * Empty on `skip`. On `fail` this string is quoted into the revision proposal and into the CI
   * failure message, because evidence without a quote is not evidence.
   */
  readonly evidence: string;
  /** Present when outcome is `skip`. Always says what data was missing and how to supply it —
   *  a skip the user cannot act on is a skip they will read as a failure. */
  readonly skipReason?: string;
}

export const SKIP_NO_MANIFEST: Evaluation = {
  outcome: "skip",
  evidence: "",
  skipReason: "No package.json was pasted.",
};

export const SKIP_NO_LISTING: Evaluation = {
  outcome: "skip",
  evidence: "",
  skipReason:
    "No file listing was pasted, so this guard cannot tell absent from unlisted. Paste the output of `git ls-files`, `find . -type f` or `tree`.",
};

export const SKIP_NO_CONTENTS: Evaluation = {
  outcome: "skip",
  evidence: "",
  skipReason:
    "No file contents were pasted, so this guard has nothing to search. Paste the file(s) it should look in, headed like `--- src/db/schema.ts ---`.",
};

export const SKIP_NOT_RUNNABLE: Evaluation = {
  outcome: "skip",
  evidence: "",
  skipReason:
    "This guard kind cannot run in the browser. It is exported to CI, where it can run against the real project.",
};
