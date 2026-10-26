/**
 * The demo log, built two ways.
 *
 * The fixture (`fixtures/demo-transcript.txt`) states its OWN expected extraction
 * in its own informal words — six decisions. The ONTOLOGY (src/ontology/data/variables.ts)
 * resolves those six onto SEVEN typed slots, because some lines span two slots and
 * "single-user" is its own variable:
 *
 *   1. DATABASE   | Use SQLite (better-sqlite3), not Postgres  -> DATABASE=sqlite
 *   2. AUTH       | Drop auth entirely                         -> AUTH=local
 *   3. FRAMEWORK  | Vite + React + Tailwind instead of Next.js -> FRAMEWORK=single-page
 *                                                                 + UI_KIT=tailwind
 *   4. STORAGE    | Embeddings inline in JSON, brute-force scan -> RETRIEVAL=embeddings
 *   5. TESTING    | Golden-file tests on the extractor only    -> TESTING=golden-file
 *   6. (weaker)   | "one person, one machine, one log"          -> SCOPE=single-user
 *
 * The local engine extracts NINETEEN decision candidates from that transcript, because it
 * also reads the assistant's QUESTIONS and the REJECTED ALTERNATIVES as if they were
 * decisions: "Postgres with Supabase?" becomes DATABASE=postgres, "fixture transcripts"
 * becomes TESTING=fixture, and the single sentence about migrating later is resolved into
 * five separate decisions (DATABASE=multi-user, DATABASE=single-user, AUTH=schema,
 * AUTH=local, DATABASE=sqlite). The fixture calls Postgres "the trap" for exactly this
 * reason.
 *
 * That matters because the pre-export consistency gate (§5.6) is now real: a log with two
 * live IN decisions on the same variable is a log that contradicts itself, and the export
 * is REFUSED because a file that tells an agent two different answers is worse than no
 * file. So the two ways of building the demo log are not two flavours of the same thing -
 * they are two different products:
 *
 *   - "curated"     the review a human does with the fixture's expected list in hand: keep
 *                   the six decisions the transcript settled, discard the artefacts. The
 *                   log is consistent and the export compiles.
 *   - "approve-all" what the test harness used to do: approve everything the engine
 *                   proposed. The log contradicts itself and the export is refused.
 *
 * Both are asserted, in `tests/integration/consistency-gate.test.ts`. Neither is a
 * convenience: the first is the happy path, the second is the gate doing its job.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createLocalEngine } from "@/ai/local";
import { commitReview } from "@/extraction/commit";
import { runExtraction } from "@/extraction/pipeline";
import { applyAction, approve, discard, edit } from "@/extraction/review/actions";
import { useWhyLog } from "@/store/whylog";
import type { GraphState } from "@/substrate/graph-state";
import { type DecisionId, type TranscriptId, asISO } from "@/types/common";

export const FIXTURE = resolve(process.cwd(), "fixtures", "demo-transcript.txt");
export const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;
export const NOW = asISO("2026-10-03T15:00:00.000Z");

/**
 * The decisions the transcript settled, as the engine resolved them — the seven
 * keys curated review keeps (one per variable).
 *
 * The fixture names its decisions informally; the engine maps them onto the ONTOLOGY's
 * 14 typed slots (src/ontology/data/variables.ts). The mapping is spelled out here
 * because the ontology — not this file — is the authority, and when the two disagree
 * the ontology wins. (They disagreed once: this set was stale and read SCOPE=sqlite /
 * AUTH=auth / FRAMEWORK=tailwind / ARCHITECTURE=single. The engine emits finer slots —
 * tailwind is a UI_KIT, not a FRAMEWORK — so the stale set left the curated log with
 * two decisions instead of six and every downstream gate failed. Updated to the real
 * mapping.)
 *
 *   fixture DATABASE      "Use SQLite"           -> DATABASE=sqlite
 *   fixture AUTH          "Drop auth entirely"    -> AUTH=local
 *   fixture FRAMEWORK     "Vite + React"          -> FRAMEWORK=single-page
 *   fixture FRAMEWORK     "+ Tailwind"            -> UI_KIT=tailwind  (styling is its own slot)
 *   fixture STORAGE       "Embeddings inline"     -> RETRIEVAL=embeddings
 *   fixture TESTING       "Golden-file tests"     -> TESTING=golden-file
 *   fixture (single-user) "one person, one log"   -> SCOPE=single-user
 *
 * Postgres, multi-user, and the migration alternatives are NOT kept: they are the
 * rejected alternatives and the questions the transcript raised, and keeping them
 * alongside the chosen value would make the log contradict itself (two live DATABASE
 * decisions), which the export gate refuses.
 *
 * One decision per variable, which is what a consistent log looks like: the ontology says
 * one question, one current answer, and the export gate enforces it.
 */
const KEEP: ReadonlySet<string> = new Set([
  "DATABASE=sqlite",
  "AUTH=local",
  "FRAMEWORK=single-page",
  "UI_KIT=tailwind",
  "RETRIEVAL=embeddings",
  "TESTING=golden-file",
  "SCOPE=single-user",
]);

export type ReviewMode = "curated" | "approve-all";

/** Import the fixture, review it, commit it, and hand back the log. */
export async function buildDemoLog(
  mode: ReviewMode = "curated",
  options?: { readonly editDownside?: boolean },
): Promise<GraphState> {
  const raw = readFileSync(FIXTURE, "utf-8");
  const engine = createLocalEngine();

  const run = await runExtraction(
    { transcriptId: "T-0001" as TranscriptId, raw, occurredAt: NOW },
    { engine, engineId: ENGINE_ID, state: useWhyLog.getState().state },
  );
  if (!run.ok) throw new Error(`extraction failed: ${run.failure.kind}`);

  let edited = false;
  const reviewed = run.outcome.queue.map((item) => {
    if (mode === "approve-all" || item.kind !== "decision" || item.decision === null) {
      return applyAction(item, approve(false));
    }

    const key = `${item.decision.variable}=${item.decision.value}`;
    if (KEEP.has(key)) {
      /* The local engine never extracts an accepted downside - the LLM path does, and the
       * prompt asks for it - so the only way a keyless log carries one is if the human
       * records it in review. That is the real flow, and it is what the decision card's
       * "accepted downside" section is for. */
      if (options?.editDownside === true && !edited) {
        edited = true;
        return applyAction(
          item,
          edit({ acceptedDownside: "single-writer only, until the schema grows" }),
        );
      }
      return applyAction(item, approve(false));
    }

    return applyAction(
      item,
      discard("the transcript did not settle this: it is a question or a rejected alternative"),
    );
  });

  const committed = commitReview(
    {
      transcriptId: "T-0001" as TranscriptId,
      engine: ENGINE_ID,
      occurredAt: NOW,
      items: reviewed,
      machineDiscards: [],
    },
    useWhyLog.getState().state,
  );
  if (!committed.ok) throw new Error("commit failed");

  const recorded = useWhyLog.getState().recordBatch(committed.drafts, {
    reason: "Reviewed and approved: the Oct-3 transcript.",
    actor: { kind: "human" },
    occurredAt: NOW,
  });
  if (!recorded.ok) throw new Error(`record failed: ${recorded.error}`);

  return useWhyLog.getState().state;
}

/** The decision ids in the log, for assertions that name them. */
export function decisionIds(state: GraphState): readonly DecisionId[] {
  return [...state.decisions.values()].map((d) => d.id);
}
