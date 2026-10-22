/**
 * The extraction prompt and its output schema — 1.10, the LLM path.
 *
 * Phase 1 · sub-phase 1.10
 *
 * ---------------------------------------------------------------------------
 * THE PROMPT IS BUILT, NOT A TEMPLATE LITERAL
 *
 * The closed vocabulary is injected from the ontology at call time. A hand-written
 * prompt listing the 14 variables goes stale the day a fifteenth is added, and the
 * failure is invisible: the model happily returns a variable name that does not
 * exist, `resolveVariable` folds it to OTHER, and the extraction looks fine while
 * every slot is untyped.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PROMPT ASKS FOR AND WHY IT IS SHORT
 *
 * Under 200 lines of instruction, because the model is not being taught to reason —
 * it is being told the SHAPE of the answer and the RULES that make the answer
 * checkable. The three rules that matter:
 *
 *   1. quote VERBATIM — `snippet-validation.ts` rejects anything else
 *   2. only the listed variables and premise types — a closed set is the mitigation
 *      for RAAM's unbounded-assumption precision problem
 *   3. say "insufficient" rather than guessing — the RepoRationale evidence contract
 * ---------------------------------------------------------------------------
 */

import {
  DECISION_VARIABLES,
  PREMISE_TYPES,
  type DecisionVariable,
  type PremiseType,
} from "@/types/domain";
import { describeOntology } from "@/ontology/ontology";
import { VARIABLE_META } from "@/ontology/data/variables";
import { PREMISE_TYPE_META } from "@/ontology/data/premise-types";
import { allCuePhrases } from "@/ontology/ontology";

/** The schema the model must return. Kept as a TypeScript type AND as a string in
 *  the prompt, because a model cannot read a type. */
export interface LlmDecision {
  readonly variable: DecisionVariable | "OTHER";
  readonly value: string;
  readonly statement: string;
  readonly yStatement?: string;
  readonly rationale?: string;
  readonly acceptedDownside?: string;
  readonly appliesTo?: readonly string[];
  readonly modality: "asserted" | "proposed" | "hypothetical" | "reported";
  readonly origin: "human_stated" | "agent_proposed_human_accepted" | "agent_inferred";
  readonly confidence: number;
  /** VERBATIM substring of the input. Checked, not trusted. */
  readonly snippet: string;
  /** Indices into `premises`, not ids. Ids are minted at commit. */
  readonly premiseRefs: readonly number[];
  /** Indices into `alternatives`. */
  readonly alternativeRefs: readonly number[];
}

export interface LlmPremise {
  readonly type: PremiseType;
  readonly predicate: string;
  readonly value?: string | number | boolean;
  readonly text: string;
  readonly confidence: number;
  readonly snippet: string;
  /** True when this premise is a condition the decision EXCLUDES — the OUT-list.
   *  The model is asked directly because it can see the argument; the local engine
   *  has to derive it from the exclusion table. */
  readonly excluded?: boolean;
}

export interface LlmAlternative {
  readonly variable: DecisionVariable | "OTHER";
  readonly value: string;
  readonly whyRejected?: string;
  readonly confidence: number;
  readonly snippet: string;
  readonly decisionRef: number;
}

export interface LlmDiscard {
  readonly kind: "decision" | "premise" | "alternative";
  readonly discardedBy: "confidence-threshold" | "modality" | "duplicate";
  readonly rawText: string;
  readonly confidence: number;
}

export interface LlmExtraction {
  readonly decisions: readonly LlmDecision[];
  readonly premises: readonly LlmPremise[];
  readonly alternatives: readonly LlmAlternative[];
  readonly discarded: readonly LlmDiscard[];
}

export const EMPTY_LLM_EXTRACTION: LlmExtraction = {
  decisions: [],
  premises: [],
  alternatives: [],
  discarded: [],
};

/* -------------------------------------------------------------------------- */
/* The prompt                                                                 */
/* -------------------------------------------------------------------------- */

export const SYSTEM_PROMPT: string = buildSystemPrompt();

function buildSystemPrompt(): string {
  return [
    "You extract software design decisions from a transcript of a human working with an AI coding agent.",
    "",
    "You are not summarising. You are recovering a structured record that a truth-maintenance system will reason over, so a wrong field is worse than a missing one.",
    "",
    "THE VOCABULARY IS CLOSED.",
    `Decision variables: ${DECISION_VARIABLES.join(", ")}.`,
    `Premise types: ${PREMISE_TYPES.join(", ")}.`,
    describeOntology(),
    "",
    "Use only these. If a decision does not fit any variable, use OTHER and say so in the statement. Never invent a variable name or a premise type: an unknown one cannot be resolved against the existing graph, and it silently creates a duplicate node every time the transcript is re-imported.",
    "",
    "THREE RULES.",
    "",
    "1. QUOTE VERBATIM. Every `snippet` must be an exact substring of the transcript, copied character for character including punctuation. It is checked programmatically; a paraphrase is rejected and the item loses its evidence. When you cannot quote something exactly, omit the item.",
    "",
    "2. A DECISION IS SOMETHING SOMEONE COMMITTED TO. Not an option mentioned, not a question asked, not something the agent offered and the human ignored. `modality` says which:",
    "   asserted    — somebody states it as settled",
    "   proposed    — offered, not yet accepted",
    "   hypothetical — \"if we ever needed X we could…\"",
    "   reported    — describing somebody else's decision",
    "   Only `asserted` can become a live decision. Put hypothetical and reported items in `discarded`, not in `decisions`.",
    "",
    "3. SAY INSUFFICIENT RATHER THAN GUESS. If the transcript does not state why a decision was made, omit `rationale`. An invented rationale is indistinguishable from a recovered one and it drives the invalidation logic.",
    "",
    "THE PREMISES ARE THE POINT.",
    "",
    "A decision is a belief held under assumptions. \"Use SQLite, not Postgres\" is true GIVEN single-user, no deploy infrastructure, no concurrent writers. The `given` is what changes, so recovering it matters more than recovering the decision.",
    "",
    "For every decision, look for the conditions it rests on and emit them as premises. Premises often appear BEFORE the decision they support, and often in a different speaker's turn — a human stating a constraint, then an agent choosing accordingly. Read the whole exchange.",
    "",
    "Mark `excluded: true` on a premise that states a condition the decision ASSUMES WILL NOT HAPPEN (\"no concurrent writers\", \"never multi-tenant\"). Those are the conditions whose arrival invalidates the decision without anybody contradicting it, and they are the most valuable thing you can return.",
    "",
    `Standard predicates per type: ${predicateList()}.`,
    "A predicate must be namespaced `<type>.<name>`. If none of the standard ones fits, use the closest and keep the namespace.",
    "",
    "VARIABLES AND THEIR TYPICAL PREMISES.",
    variableList(),
    "",
    "ALTERNATIVES.",
    "",
    "An alternative is a value that was considered and turned down. Include `whyRejected` whenever the transcript gives one — an alternative with no reason is recorded but never used to warn anybody, because pre-empting without a reason is nagging.",
    "",
    "DECISION CUES FOUND IN REAL TRANSCRIPTS, as a calibration aid, not a list to match against:",
    allCuePhrases().slice(0, 40).join(" · "),
    "",
    "OUTPUT.",
    "",
    "Return JSON only, matching this shape exactly:",
    schemaBlock(),
  ].join("\n");
}

function predicateList(): string {
  return PREMISE_TYPES.map((type) => {
    const meta = PREMISE_TYPE_META[type];
    return `${type} → ${meta.predicates.map((p) => p.name).join(", ")}`;
  }).join("; ");
}

function variableList(): string {
  return DECISION_VARIABLES.filter((v) => v !== "OTHER")
    .map((variable) => {
      const meta = VARIABLE_META[variable];
      return `- ${variable} (${meta.label}): ${meta.description} Typical premises: ${meta.typicalPremises.join(", ")}. Common values: ${meta.commonValues.slice(0, 8).join(", ")}.`;
    })
    .join("\n");
}

function schemaBlock(): string {
  return JSON.stringify(
    {
      decisions: [
        {
          variable: "DATABASE",
          value: "sqlite",
          statement: "Use SQLite, not Postgres",
          yStatement:
            "In the context of a single-user local tool with no deploy infrastructure, facing the concern of operational overhead, we decided for SQLite to achieve zero-infrastructure persistence, accepting that concurrent writers would force a migration.",
          rationale: "it's one person, one machine, one log",
          acceptedDownside: "if we ever need multi-user we can migrate",
          appliesTo: ["src/store/**"],
          modality: "asserted",
          origin: "human_stated",
          confidence: 0.9,
          snippet: "going with SQLite, not Postgres",
          premiseRefs: [0, 1],
          alternativeRefs: [0],
        },
      ],
      premises: [
        {
          type: "scale",
          predicate: "scale.single_user",
          value: true,
          text: "it's one person, one machine, one log",
          confidence: 0.85,
          snippet: "it's one person, one machine, one log",
        },
        {
          type: "scale",
          predicate: "scale.concurrent_writers",
          value: 0,
          text: "no concurrent writers",
          confidence: 0.7,
          snippet: "single-user and no deploy hassle",
          excluded: true,
        },
      ],
      alternatives: [
        {
          variable: "DATABASE",
          value: "postgres",
          whyRejected: "it means a hosted dependency",
          confidence: 0.8,
          snippet: "Postgres via Supabase would work, but it means a hosted dependency",
          decisionRef: 0,
        },
      ],
      discarded: [
        {
          kind: "decision",
          discardedBy: "modality",
          rawText: "if we ever need multi-user we can migrate",
          confidence: 0.3,
        },
      ],
    },
    null,
    2,
  );
}

/* -------------------------------------------------------------------------- */
/* The user turn                                                              */
/* -------------------------------------------------------------------------- */

export function userPrompt(text: string, hint?: string): string {
  const parts = [
    "Extract the decisions, their premises and the rejected alternatives from this transcript.",
    "",
  ];
  if (hint !== undefined && hint.trim().length > 0) {
    parts.push(`Context from the user: ${hint.trim()}`, "");
  }
  parts.push("TRANSCRIPT:", "<<<", text, ">>>", "", "Return JSON only.");
  return parts.join("\n");
}

/** How much transcript goes in one request. Below the usual context limit with
 *  room for the system prompt and a verbose answer. */
export const PROMPT_CHAR_BUDGET = 24_000;

/** Does this text need chunking before it can be sent? */
export function needsChunking(text: string): boolean {
  return text.length > PROMPT_CHAR_BUDGET;
}
