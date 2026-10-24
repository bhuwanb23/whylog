/**
 * Keyless verification of the demo — 7.5.
 *
 * Phase 7 · sub-phase 7.5
 *
 * ---------------------------------------------------------------------------
 * WHY "KEYLESS" IS A REQUIREMENT AND NOT A CONVENIENCE
 *
 * §7.5 asks for keyless verification for one reason: a demo whose correctness depends on an API key is a
 * demo that cannot be checked. A judge cannot reproduce it, a presenter cannot rehearse it on a plane,
 * and the numbers in the pitch cannot be audited by anyone who does not want to pay for the privilege of
 * verifying a claim.
 *
 * So every check below runs on the local engine. Where a check would need an LLM, it is marked `manual`
 * and says what a human has to look at — it is never marked `verified` on the strength of a code path
 * that did not run.
 *
 * ---------------------------------------------------------------------------
 * VERIFIED, MANUAL OR FAILED — AND NEVER A FOURTH THING
 *
 * There is no "skipped" state. A check that could not run is `manual`, which names the human action that
 * substitutes for it. A check that ran and did not hold is `failed`. Collapsing those two would produce a
 * green verification report for a demo that has never been exercised, which is the exact failure this
 * module exists to prevent.
 * ---------------------------------------------------------------------------
 */

import type { PremiseId } from "@/types/common";
import type { SeedResult } from "./kit";
import type { Beat, CheckId } from "./script";
import { SCRIPT } from "./script";

export type CheckStatus = "verified" | "manual" | "failed";

export interface CheckResult {
  readonly check: CheckId;
  readonly status: CheckStatus;
  readonly evidence: string;
  /** What a human must look at, when `status` is "manual". Empty otherwise. */
  readonly manualStep: string;
}

export interface VerificationReport {
  readonly results: readonly CheckResult[];
  readonly byBeat: readonly { beat: number; view: string; check: CheckId; status: CheckStatus }[];
  readonly verified: number;
  readonly manual: number;
  readonly failed: number;
  /** True only when nothing failed AND every beat's check resolved to something. A demo with an
   *  unverified beat can still be given — the manual steps cover it — but a demo with a FAILED beat
   *  cannot, because the beat will visibly not work. */
  readonly demoable: boolean;
}

/**
 * Verify every beat of the script against a built seed.
 *
 * Takes the seed rather than building one, so the caller decides when the pipeline runs. Building it
 * inside would make verification cost a full import and would hide that cost from whoever is waiting on
 * it during a rehearsal.
 */
export function verifyDemo(seed: SeedResult): VerificationReport {
  const results: CheckResult[] = [
    checkSeedHasSqlite(seed),
    checkSeedHasPremises(seed),
    checkReversalDetected(seed),
    checkL2Unsound(seed),
    checkNoHypotheticalNodes(seed),
    checkGuardsProposed(seed),
    checkExportContainsDecision(seed),
    checkAnswerIsGrounded(seed),
    checkGraphRenders(seed),
  ];

  const byBeat = SCRIPT.map((beat) => {
    const result = results.find((entry) => entry.check === beat.check);
    return {
      beat: beat.n,
      view: beat.view,
      check: beat.check,
      status: result?.status ?? "manual",
    };
  });

  return {
    results,
    byBeat,
    verified: results.filter((entry) => entry.status === "verified").length,
    manual: results.filter((entry) => entry.status === "manual").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    demoable: results.every((entry) => entry.status !== "failed"),
  };
}

/* -------------------------------------------------------------------------- */
/* Individual checks                                                          */
/* -------------------------------------------------------------------------- */

function checkSeedHasSqlite(seed: SeedResult): CheckResult {
  const hit = [...seed.state.decisions.values()].find(
    (decision) =>
      decision.variable === "DATABASE" && /sqlite/i.test(`${decision.value} ${decision.statement}`),
  );

  return hit === undefined
    ? failed(
        "seed-has-sqlite-decision",
        "No SQLite decision in the seed. Beat 1 has nothing to show and every later beat depends on it.",
      )
    : verified("seed-has-sqlite-decision", `${hit.id} · ${hit.statement}`);
}

function checkSeedHasPremises(seed: SeedResult): CheckResult {
  const sqlite = [...seed.state.decisions.values()].find(
    (decision) =>
      decision.variable === "DATABASE" && /sqlite/i.test(`${decision.value} ${decision.statement}`),
  );

  if (sqlite === undefined) {
    return failed("seed-has-premises", "No SQLite decision, so its premises cannot be checked.");
  }

  /* Premises are reachable through justifications, not through a field on the decision — the graph is
   * bipartite and `Justification.consequent` is a DecisionId, so the edges are walked from the
   * justification side. Reading a `decision.premises` field here would be reading something that does
   * not exist and would silently report zero. */
  const premiseIds = new Set<string>();
  for (const justification of seed.state.justifications.values()) {
    if (justification.consequent !== sqlite.id) continue;
    for (const id of justification.inList) premiseIds.add(id);
    for (const id of justification.outList) premiseIds.add(id);
  }

  if (premiseIds.size === 0) {
    return failed(
      "seed-has-premises",
      `${sqlite.id} has no justification linking it to any premise. Beat 1's whole point — 'notice what is underneath it' — cannot be shown.`,
    );
  }

  const names = [...premiseIds]
    .map((id) => seed.state.premises.get(id as PremiseId))
    .filter((premise) => premise !== undefined)
    .map((premise) => (premise as { predicate: string }).predicate);

  return verified(
    "seed-has-premises",
    `${premiseIds.size} premise(s) linked: ${names.length > 0 ? names.join(", ") : "ids resolved but predicates unreadable"}`,
  );
}

function checkReversalDetected(seed: SeedResult): CheckResult {
  const records = seed.state.contradictions.filter(
    (record) => record.verdict === "contradiction" || record.verdict === "reversal",
  );

  if (records.length === 0) {
    return failed(
      "reversal-detected",
      "No contradiction or reversal record in the seed. Beat 3 would show an empty panel.",
    );
  }

  const structural = records.filter((record) => record.gate === "structural").length;
  return verified(
    "reversal-detected",
    `${records.length} record(s): ${structural} structural, ${records.length - structural} other gate(s).`,
  );
}

function checkL2Unsound(seed: SeedResult): CheckResult {
  /* The headline beat. The October SQLite decision must be OUT or UNFOUNDED after the November transcript
   * is imported, without the November transcript mentioning databases. */
  const sqlite = [...seed.state.decisions.values()].filter(
    (decision) =>
      decision.variable === "DATABASE" && /sqlite/i.test(`${decision.value} ${decision.statement}`),
  );

  if (sqlite.length === 0) return failed("l2-unsound", "No SQLite decision in the seed.");

  const unsound = sqlite.filter(
    (decision) => decision.label === "OUT" || decision.label === "UNFOUNDED",
  );

  if (unsound.length === 0) {
    return failed(
      "l2-unsound",
      `DEMO-KILLER: the SQLite decision is still ${sqlite.map((decision) => decision.label).join("/")} after the November transcript. Beat 5 is the peak of the demo and it does not land. Fall back to driving the falsification by hand from the Reasoning view and say so out loud.`,
    );
  }

  let outListTotal = 0;
  for (const justification of seed.state.justifications.values())
    outListTotal += justification.outList.length;

  return verified(
    "l2-unsound",
    `${unsound.map((decision) => decision.id).join(", ")} went unsound. ${outListTotal} OUT-list entry/entries in the graph, which is what makes the retraction non-monotonic rather than a supersede.`,
  );
}

function checkNoHypotheticalNodes(seed: SeedResult): CheckResult {
  const hypothetical = [...seed.state.decisions.values()].filter(
    (decision) => decision.modality === "hypothetical" && decision.label === "IN",
  );

  /* A hypothetical node in the seed is only a failure if it is labelled IN: retaining the sentence is
   * correct (nothing is deleted, invariant I1), promoting it to a live belief is not. */
  return hypothetical.length === 0
    ? verified("no-hypothetical-nodes", "No hypothetical-modality decision carries an IN label.")
    : failed(
        "no-hypothetical-nodes",
        `DEMO-KILLER: ${hypothetical.length} hypothetical decision(s) are labelled IN: ${hypothetical
          .map((decision) => `${decision.id} (${decision.statement.slice(0, 40)})`)
          .join(
            "; ",
          )}. Beat 6 shows the graph, and a judge who reads one of these aloud ends the demo.`,
      );
}

function checkGuardsProposed(seed: SeedResult): CheckResult {
  const guards = [...seed.state.guards.values()];

  if (guards.length === 0) {
    return failed(
      "guards-proposed-not-failing",
      "No guards synthesised. Beat 7 has nothing to show.",
    );
  }

  /* Day-one failures are the killer: a guard that has already FAILED before the user wrote any code
   * reads as a broken tool rather than as a tool that found something. */
  const failing = guards.filter((guard) => guard.lastRun?.outcome === "fail");
  const accepted = guards.filter((guard) => guard.lifecycle === "accepted");

  if (accepted.length > 0) {
    return failed(
      "guards-proposed-not-failing",
      `DEMO-KILLER: ${accepted.length} guard(s) reached \`accepted\` with no human in the loop. Invariant I4 says the system proposes and the human disposes.`,
    );
  }

  return {
    check: "guards-proposed-not-failing",
    status: failing.length === 0 ? "verified" : "manual",
    evidence: `${guards.length} guard(s) synthesised, all in \`proposed\` or \`suppressed\` lifecycle. ${failing.length} currently failing against the empty virtual project.`,
    manualStep:
      failing.length === 0
        ? ""
        : `${failing.length} guard(s) fail against an empty project. Paste a real package.json into the project panel before beat 7, or show the proposal list instead of the run list.`,
  };
}

function checkExportContainsDecision(seed: SeedResult): CheckResult {
  /* The export compiler runs in the browser against the current state and writes files through the UI.
   * It can be driven headlessly, but doing so here would duplicate `export/index.ts`'s entry point and
   * the two would drift. Marked manual, with the exact thing to look for. */
  return {
    check: "export-contains-decision",
    status: "manual",
    evidence: `${seed.state.decisions.size} decision(s) available to export; ${seed.state.exports.size} export record(s) already in the log.`,
    manualStep:
      "In the Export view, compile CLAUDE.md and confirm three things: (1) the Postgres decision appears " +
      "as an imperative MUST scoped to a glob, (2) the rejected-alternatives block names SQLite, (3) the " +
      "stamp's digest is non-empty and not the literal string 'unknown' — that was a real Phase 4 bug " +
      "where every CI export stamped 'unknown' because the code read `log.head.hash` instead of " +
      "`log.headHash`.",
  };
}

function checkAnswerIsGrounded(_seed: SeedResult): CheckResult {
  return {
    check: "answer-is-grounded",
    status: "manual",
    evidence:
      "Asking a question runs the retrieval pipeline over the seeded index, which is built in the browser.",
    manualStep:
      "In the Ask view, ask 'Why did we choose SQLite over Postgres?' and confirm the answer carries a " +
      "GROUNDED verdict with at least one citation that resolves to a real decision. Then ask a question " +
      "the corpus cannot answer and confirm it says INSUFFICIENT_EVIDENCE rather than inventing a claim — " +
      "that refusal is the evidence contract and it is the half of the feature a judge will not think to " +
      "test unless shown.",
  };
}

function checkGraphRenders(seed: SeedResult): CheckResult {
  /* The lattice layout is deterministic by design, so its input can be checked headlessly even though
   * the SVG cannot: a graph with premises and decisions on both sides of a bipartition will lay out. */
  const decisions = seed.state.decisions.size;
  const premises = seed.state.premises.size;

  return decisions > 0 && premises > 0
    ? verified(
        "graph-renders",
        `${decisions} decision(s) and ${premises} premise(s): both sides of the bipartition are populated.`,
      )
    : failed(
        "graph-renders",
        `${decisions} decision(s), ${premises} premise(s). An empty side produces an empty diagram.`,
      );
}

function verified(check: CheckId, evidence: string): CheckResult {
  return { check, status: "verified", evidence, manualStep: "" };
}

function failed(check: CheckId, evidence: string): CheckResult {
  return { check, status: "failed", evidence, manualStep: "" };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export function renderVerification(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push("KEYLESS DEMO VERIFICATION");
  lines.push(`${report.verified} verified · ${report.manual} manual · ${report.failed} FAILED`);
  lines.push(report.demoable ? "DEMOABLE." : "NOT DEMOABLE — a beat will visibly not work.");
  lines.push("");

  lines.push(`${"Beat".padEnd(6) + "View".padEnd(14) + "Check".padEnd(32)}Status`);
  lines.push("-".repeat(70));
  for (const entry of report.byBeat) {
    lines.push(
      String(entry.beat).padEnd(6) +
        entry.view.padEnd(14) +
        entry.check.padEnd(32) +
        entry.status.toUpperCase(),
    );
  }
  lines.push("");

  for (const result of report.results) {
    lines.push(`[${result.status.toUpperCase()}] ${result.check}`);
    lines.push(`  ${result.evidence}`);
    if (result.manualStep.length > 0) lines.push(`  HUMAN: ${result.manualStep}`);
    lines.push("");
  }

  return lines.join("\n");
}

export type { Beat };
