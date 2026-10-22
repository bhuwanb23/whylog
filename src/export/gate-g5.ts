/**
 * Gate G5 — "it closes the loop".
 *
 * Plan: plan/OVERVIEW.md §5.2
 *   "G5 - It closes the loop | P5 | Does the export carry the reasoning *and* the check?
 *    | Generated `CLAUDE.md` shows WLD-0007 with MUST/MUST NOT, `applies_to`, rejected
 *      alternatives, and a runnable verify command"
 *
 * Every clause of the gate is a PREDICATE over the compiled artifact. Running them
 * is what makes the gate a gate rather than a description of one — and it is why
 * this file exists as a module and not as a function inside the view: a predicate
 * that can only be reached by clicking a button in a browser has never been run.
 *
 * The predicates are deliberately literal. They are not a parser and they are not
 * a model of the format: they assert that the things the gate names are PRESENT in
 * the artifact, which is the whole claim.
 */

export interface GateCheck {
  readonly property: string;
  readonly passed: boolean;
  readonly evidence: string;
}

/** The first `### WLD-...` block, which is the highest-priority decision by
 *  construction. */
function firstRecord(contents: string): string {
  const start = contents.indexOf("\n### ");
  const end = contents.indexOf("\n### ", start + 1);
  return start < 0 ? "" : contents.slice(start, end < 0 ? contents.length : end);
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  const found = match?.[0]?.trim();
  return found === undefined || found.length === 0 ? null : found;
}

/**
 * Does the compiled artifact satisfy gate G5?
 *
 * `contents` is the compiled CLAUDE.md, or null if nothing has been compiled yet.
 */
export function checkGateG5(contents: string | null): readonly GateCheck[] {
  if (contents === null) {
    return [
      { property: "artifact exists", passed: false, evidence: "Nothing has been compiled yet." },
    ];
  }

  const block = firstRecord(contents);
  const recordId = /^###\s+((?:WLD|ADR)-[0-9A-Za-z-]+)/.exec(block.trim())?.[1] ?? null;

  return [
    {
      property: "a decision record is present",
      passed: recordId !== null,
      evidence:
        recordId === null
          ? "No `### WLD-...` block found in the artifact."
          : `${recordId} is the highest-priority record and is checked below.`,
    },
    {
      property: "MUST / MUST NOT imperative form",
      passed: /\bMUST NOT\b/.test(block) || /\bMUST\b/.test(block),
      evidence:
        firstMatch(block, /\bMUST(?: NOT)?\b[^.\n]*\.?/) ??
        "no normative keyword found — the record is prose, which an agent has to summarise before it can follow it",
    },
    {
      property: "applies_to scope",
      passed: /^Applies to:\s*\S/m.test(block),
      evidence:
        firstMatch(block, /^Applies to:.*$/m) ??
        "no scope line — the rule would load into every context",
    },
    {
      property: "Because: with premise IDs",
      passed: /^Because:.*\bP-[0-9]/m.test(block),
      evidence:
        firstMatch(block, /^Because:.*$/m) ??
        "no premise IDs — a reader cannot see what would have to change for the rule to stop applying",
    },
    {
      property: "rejected alternatives",
      passed: /^Rejected:/m.test(block) || /## Rejected — do not re-propose/.test(contents),
      evidence:
        firstMatch(block, /^Rejected:.*$/m) ??
        (contents.includes("## Rejected — do not re-propose")
          ? "present as a top-level section rather than on this record"
          : "nothing rejected is recorded, so an agent is free to re-propose what was already turned down"),
    },
    {
      property: "a runnable verify command",
      /* The lookahead has to swallow the whitespace ITSELF: `/^Verify:\s*(?!none)/`
       * matches "Verify:" with ZERO whitespace consumed, so the lookahead sees
       * " none — UNVERIFIABLE" — which does not start with "none" — and the
       * predicate passes on an artifact that has no check in it at all. The
       * gate then reports a runnable command for a decision that has none, and
       * G5 passes on a log where nothing is verified. */
      passed: /^Verify:(?!\s*none)/m.test(block),
      evidence:
        firstMatch(block, /^Verify:.*$/m) ??
        "no verify line — the requirement no ADR tool satisfies automatically",
    },
    {
      property: "status line",
      passed: /^Status:/m.test(block),
      evidence: firstMatch(block, /^Status:.*$/m) ?? "no status line",
    },
    {
      property: "integrity stamp",
      passed: contents.includes("<!-- whylog:stamp"),
      evidence: contents.includes("<!-- whylog:stamp")
        ? "present, with the log head and the content digest"
        : "MISSING — the artifact cannot be tied back to the log that produced it",
    },
    {
      property: "anti-re-litigation line",
      passed: contents.includes("Do not re-litigate without superseding this record."),
      evidence: contents.includes("Do not re-litigate")
        ? "present — disagreeing is allowed but has a form, and the form is a recorded supersession"
        : "absent",
    },
  ];
}

/** One line per predicate, for a report. */
export function renderGateG5(checks: readonly GateCheck[]): string {
  return checks
    .map((check) => `${(check.passed ? "PASS  " : "FAIL  ") + check.property} — ${check.evidence}`)
    .join("\n");
}
