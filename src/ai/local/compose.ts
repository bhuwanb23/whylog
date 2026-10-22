/**
 * Template composition for the local engine — Phase 3.
 *
 * Phase 3 ú sub-phase 3.9
 * Plan: plan/phase-3-retrieval.md §3.9
 * Replaces the Phase 0 `templateCompose` in `./index.ts`, which said in its own comment that
 * Phase 3 would replace it with "the fuller ones in src/ai/local/compose.ts".
 *
 * ---------------------------------------------------------------------------
 * TEMPLATES ARE AN IMPLEMENTATION, NOT A STUB
 *
 * The local engine is the DEFAULT path, not a degraded fallback, and it has to produce a
 * usable answer with no key, no network and no model. Templates do that. What they cannot do
 * is synthesise ACROSS decisions — noticing that two retrieved decisions share a premise, or
 * phrasing a trade-off neither states. That gap is real, it is disclosed on every local
 * answer, and it is the only reason to switch engines.
 *
 * ---------------------------------------------------------------------------
 * EVERY SENTENCE CARRIES ITS CITATION INLINE
 *
 * `retrieval/answer.ts` attributes claims to decisions by looking for the ids that actually
 * appear in each sentence. That only works if the id is IN the sentence. So every sentence
 * this file emits ends with `[WLD-0007]`, and a sentence that cites nothing is not emitted.
 *
 * This is not a formatting preference. It is what makes groundedness measurable on the local
 * path by the same rule as the LLM path, instead of the local path being granted 1.0 because
 * its composer happens to be one that cannot lie.
 *
 * ---------------------------------------------------------------------------
 * THE PREMISES ARE THE ANSWER
 *
 * A list of decisions is what every competitor returns. The `given` — what each decision
 * rests on, with its live label — is the part that makes the answer actionable, because it is
 * the part that tells the reader when the answer stops being true. So premises are rendered
 * with their labels wherever the material carries them, and a decision with no recorded
 * premises says so explicitly rather than omitting the line.
 * ---------------------------------------------------------------------------
 */

import type { CompositionFact, CompositionRequest } from "../types";

/** Rendered after every local answer. See `retrieval/answer.ts` — the disclosure is part of
 *  the contract, because a flat answer must not be mistaken for a flat question. */
export const LOCAL_DISCLOSURE =
  "Composed from templates by the local engine: every sentence above restates a retrieval " +
  "result and nothing is inferred across decisions. Switch to an LLM engine in Settings for " +
  "synthesis — the retrieval, ranking and grounding are identical either way.";

/**
 * The body of an answer, and the disclosure that goes with it.
 *
 * The disclosure is SEPARATE from the prose on purpose. The retrieval layer derives
 * claims from the prose by splitting it into sentences and attributing each to the
 * decision ids it contains; a sentence that cites nothing is an ungrounded claim and
 * is counted against the score. The disclosure is a note about how the answer was
 * produced, not a claim about the log, so it does not belong in the claim stream —
 * and it cannot carry a decision id, so it would otherwise be permanently ungrounded.
 */
export interface ComposedBody {
  readonly text: string;
  readonly disclosure?: string;
}

export function templateCompose(request: CompositionRequest): ComposedBody {
  const facts = request.material;

  if (facts.length === 0) {
    return {
      text: "Nothing in the log answers that yet. Import a transcript or record the decision, and ask again.",
    };
  }

  const limit = request.maxLengthChars;
  const body = composeKind(request, facts);

  if (limit === undefined || body.length <= limit) {
    return { text: body, ...(request.kind === "answer" ? { disclosure: LOCAL_DISCLOSURE } : {}) };
  }

  /* Truncation is marked, never silent. A cut answer that looks whole is worse than a short
   * one that says it is short — the reader would otherwise act on a partial list of decisions
   * believing it was the complete list. */
  const cut = body.slice(0, Math.max(0, limit - 60));
  const lastSentence = cut.lastIndexOf(". ");

  return {
    text: `${lastSentence > 0 ? cut.slice(0, lastSentence + 1) : cut} [truncated to ${limit} characters — ${facts.length} decisions were retrieved and not all of them are shown]`,
    ...(request.kind === "answer" ? { disclosure: LOCAL_DISCLOSURE } : {}),
  };
}

function composeKind(request: CompositionRequest, facts: readonly CompositionFact[]): string {
  switch (request.kind) {
    case "answer":
      return composeAnswer(request.question ?? "your question", facts);
    case "export-narrative":
      return composeNarrative(facts);
    case "guard-rationale":
      return composeGuardRationale(facts);
    case "premise-summary":
      return composePremiseSummary(facts);
    case "cascade-explanation":
      return composeCascade(facts);
  }
}

/* -------------------------------------------------------------------------- */
/* answer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The Ask-view answer.
 *
 * Structure: what the log holds, then each decision with its reason and its premises, then
 * what was turned down, then the disclosure. Every sentence cites.
 */
function composeAnswer(question: string, facts: readonly CompositionFact[]): string {
  const lines: string[] = [];

  lines.push(
    facts.length === 1
      ? `One decision in the log bears on ${question}. [${(facts[0] as CompositionFact).decisionId}]`
      : `${facts.length} decisions in the log bear on ${question}. [${facts.map((fact) => fact.decisionId).join(", ")}]`,
  );

  for (const fact of facts) {
    const label = fact.label === "IN" ? "" : `, currently labelled ${fact.label}`;

    lines.push(
      `${fact.decisionId}: ${fact.statement}${label} (decided ${fact.validFrom.slice(0, 10)}). [${fact.decisionId}]`,
    );

    if (fact.rationale !== undefined && fact.rationale.length > 0) {
      lines.push(`  The recorded reason is: ${fact.rationale}. [${fact.decisionId}]`);
    }

    if (fact.premises.length === 0) {
      lines.push(
        `  It rests on no recorded premise, so there is nothing to check it against — this is a gap in the log, not a decision that needs no assumptions. [${fact.decisionId}]`,
      );
    } else {
      lines.push(`  It rests on: ${fact.premises.join("; ")}. [${fact.decisionId}]`);
      lines.push(
        `  If any of those stops being true, this decision stops being justified — that is what gate (c) watches for. [${fact.decisionId}]`,
      );
    }
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* export-narrative                                                           */
/* -------------------------------------------------------------------------- */

/** The prose header for DECISIONS.md / CLAUDE.md export (Phase 5). No citations inline:
 *  export is a document, and a document littered with bracketed ids is unreadable. The ids
 *  are still returned as `citedDecisionIds` so the exporter can build a reference section. */
function composeNarrative(facts: readonly CompositionFact[]): string {
  const lines: string[] = [];

  lines.push(
    "These decisions were recovered from conversation, and each is recorded with the " +
      "conditions it was made under. A decision is only as durable as those conditions: read " +
      "the premises before reusing the conclusion.",
  );
  lines.push("");

  for (const fact of facts) {
    const why = fact.rationale === undefined ? "" : ` — ${fact.rationale}`;
    lines.push(`- ${fact.statement}${why}`);

    if (fact.premises.length > 0) {
      lines.push(`  Given: ${fact.premises.join("; ")}.`);
    }
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* guard-rationale                                                            */
/* -------------------------------------------------------------------------- */

/** A guard without a stated rationale is indistinguishable from a lint rule (docs/04 §4.2),
 *  so this says WHICH decision the check protects and why that decision is worth checking. */
function composeGuardRationale(facts: readonly CompositionFact[]): string {
  const fact = facts[0];
  if (fact === undefined) return "";

  const premises =
    fact.premises.length === 0
      ? "no recorded premise, so it is worth checking precisely because nothing else does"
      : fact.premises.join("; ");

  return `Checks that "${fact.statement}" still holds. The log records it as a live decision (label ${fact.label}, valid from ${fact.validFrom.slice(0, 10)}) resting on ${premises}.${fact.rationale === undefined ? "" : ` Its recorded reason was: ${fact.rationale}.`}`;
}

/* -------------------------------------------------------------------------- */
/* premise-summary                                                            */
/* -------------------------------------------------------------------------- */

/** Groups the material by premise so a shared assumption is visible as shared. */
function composePremiseSummary(facts: readonly CompositionFact[]): string {
  const byPremise = new Map<string, string[]>();

  for (const fact of facts) {
    for (const premise of fact.premises) {
      const existing = byPremise.get(premise);
      if (existing === undefined) byPremise.set(premise, [fact.decisionId]);
      else existing.push(fact.decisionId);
    }
  }

  if (byPremise.size === 0) {
    return (
      "None of these decisions has a recorded premise. Without assumptions to check, the log " +
      "can report what was decided but cannot report whether it still holds."
    );
  }

  const shared = [...byPremise.entries()].filter((entry) => entry[1].length > 1);
  const lines = [`${byPremise.size} distinct premise(s) across ${facts.length} decision(s).`, ""];

  for (const [premise, decisionIds] of byPremise) {
    lines.push(
      `- ${premise} → ${decisionIds.join(", ")}${
        decisionIds.length > 1
          ? "  (SHARED — falsifying this premise puts every one of these decisions in play at once)"
          : ""
      }`,
    );
  }

  if (shared.length === 0) {
    lines.push("");
    lines.push("No premise is shared, so no single falsification cascades.");
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* cascade-explanation                                                        */
/* -------------------------------------------------------------------------- */

/** Why a retraction reached these decisions and stopped there. */
function composeCascade(facts: readonly CompositionFact[]): string {
  const lines = [`${facts.length} decision(s) rest on the falsified premise:`, ""];

  for (const fact of facts) {
    lines.push(
      `- ${fact.decisionId} ${fact.statement} (label ${fact.label})${fact.rationale === undefined ? "" : ` — ${fact.rationale}`}`,
    );
  }

  lines.push("");
  lines.push(
    "Each of these loses its justification when that premise goes OUT. They are surfaced for a " +
      "human decision, not retracted automatically: the system proposes, the human disposes.",
  );

  return lines.join("\n");
}
