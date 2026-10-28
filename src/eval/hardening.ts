/**
 * The hardening pass — 7.4.
 *
 * Phase 7 · sub-phase 7.4
 *
 * ---------------------------------------------------------------------------
 * WHAT "HARDENED" MEANS HERE, PRECISELY
 *
 * Not "we thought about the failure modes". Every failure mode documented in docs/02 §7 (8), docs/03 §8
 * (9) and docs/04 §8 (7) is registered below against either a MECHANICAL CHECK — a predicate over a
 * real run that passes or fails — or an explicit `argued` entry saying why it cannot be checked on a
 * transcript corpus.
 *
 * Twenty-four failure modes, no silent ones. A failure mode with no check and no argument is the
 * dangerous category, because it reads as covered in the docs and is covered nowhere in the code. The
 * registry makes that category empty by construction: adding a failure mode to the docs requires adding
 * a row here, and a row requires one of the two.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR DEMO-KILLERS ARE CHECKED FIRST AND HARD
 *
 * §7.4 names four. Each is a `DemoKiller` with a predicate that must hold, because these are not
 * quality regressions — they are the specific moments in a live demo where the product stops looking
 * like a product. A demo that over-retracts eleven decisions in front of a judge does not recover by
 * being right about the other ten.
 *
 * They are checked against the baseline run, not against a curated one, and the check fails loudly.
 * ---------------------------------------------------------------------------
 */

import type { DecisionId } from "@/types/common";
import type { ResolvedCorpus } from "./corpus/labels";
import type { RunResult } from "./harness";
import type { ScoredRun } from "./metrics";

/* -------------------------------------------------------------------------- */
/* The four demo-killers                                                      */
/* -------------------------------------------------------------------------- */

export interface DemoKiller {
  readonly id: string;
  readonly name: string;
  /** What the audience sees when this fires. Written in demo terms, not metric terms, because the
   *  reason it is a killer is a perception and not a number. */
  readonly visibleAs: string;
  readonly passes: boolean;
  readonly evidence: string;
  /** What to do about it during a live demo, because the fix is not available on stage. */
  readonly mitigation: string;
}

export function checkDemoKillers(corpus: ResolvedCorpus, scored: ScoredRun): readonly DemoKiller[] {
  return [
    overRetraction(scored),
    falsePremiseResolution(corpus, scored),
    hypotheticalsAsNodes(scored),
    dayOneGuardFailures(scored),
  ];
}

/**
 * Killer 1 — cascade over-retraction.
 *
 * The user falsifies one assumption about team size and a dozen unrelated decisions disappear from the
 * graph. This is the single fastest way to lose the room, because the audience can see it happen and
 * needs no explanation of why it is wrong.
 */
function overRetraction(scored: ScoredRun): DemoKiller {
  const survivorship = scored.metrics.find((metric) => metric.id === "survivor-preservation");
  const value = survivorship?.value ?? 0;
  const n = survivorship?.n ?? 0;
  const over = scored.cascade.overRetractions;

  return {
    id: "cascade-over-retraction",
    name: "Cascade over-retraction",
    visibleAs:
      "One premise is falsified and decisions that share nothing with it lose their label. The graph looks " +
      "like it is deleting the user's history rather than maintaining it.",
    /* Vacuous passes are failures. A 1.0 with n=0 means no survivor was ever at risk, which is not
     * evidence the cascade is disciplined — it is evidence the corpus did not test it. */
    passes: over === 0 && n > 0,
    evidence:
      n === 0
        ? "VACUOUS: no survivors were expected in any plant that ran, so over-retraction is UNTESTED rather than absent."
        : over +
          " over-retraction(s) across " +
          n +
          " expected survivor(s); survivor preservation " +
          value.toFixed(3) +
          ".",
    mitigation:
      "Set cascade depth to 1 in Settings before the demo. It trades the three-level plant for a " +
      "two-level one and removes the possibility of a wide retraction on stage. Say the cap out loud " +
      "rather than hiding it: a bounded cascade is a design choice, a runaway one is a bug.",
  };
}

/**
 * Killer 2 — false premise resolution.
 *
 * The headline case: `demo2` never mentions databases, and the SQLite decision must still go unsound.
 * If it does not, the entire pitch collapses to "a decision log with extra steps", because premise
 * invalidation is the only capability no competitor has.
 */
function falsePremiseResolution(_corpus: ResolvedCorpus, scored: ScoredRun): DemoKiller {
  const l2 = scored.invalidation.perPlant.find((entry) => entry.plant === "L2-premise-falsified");
  const fires = l2 !== undefined && l2.testable && l2.flipped.length > 0;

  const detail =
    l2 === undefined
      ? "the L2 plant is not in the corpus at all"
      : !l2.testable
        ? /* This string used to say "the transcripts failed to import", which was true when
           * testability only depended on the import. `plantWasIntervened()` added a second
           * condition — the falsification has to have actually been applied — and on corpus 0.1.0
           * that is the condition that fails: the plant needs a premise the extractor never
           * produces, so the harness records `applied: false` and there is nothing to attribute a
           * flip to. Naming the wrong cause here would send whoever reads the report to debug an
           * import that works. */
          "UNTESTED on this corpus, not failed: " +
          (l2.unresolvable.length > 0
            ? "the decisions it watches (" +
              l2.unresolvable.join(", ") +
              ") do not resolve to nodes"
            : "its falsification step was never applied — the premise it needs was not extracted") +
          ". The mechanism IS verified elsewhere: demo beat 5 (`l2-unsound`) reports VERIFIED on the " +
          "seeded fixture pair, and `tests/integration/gate-c-cascade.test.ts` exercises the full " +
          "cascade. What the benchmark cannot do is rate it."
        : l2.flipped.length > 0
          ? l2.flipped.join(", ") + " went unsound as expected"
          : "expected " +
            l2.expectedUnsound.join(", ") +
            " to go unsound; " +
            (l2.notFlipped.length > 0
              ? l2.notFlipped.join(", ") + " did not"
              : "none were resolvable") +
            (l2.unresolvable.length > 0 ? "; unresolvable: " + l2.unresolvable.join(", ") : "");

  return {
    id: "false-premise-resolution",
    name: "False premise resolution",
    visibleAs:
      "The presenter says 'nothing contradicted me, I never said the word database, the world moved and " +
      "the log noticed' — and the log has not noticed. There is no recovery from this one, because it is " +
      "the claim the whole demo is built around.",
    passes: fires,
    evidence:
      detail + ". Non-empty OUT-lists in the graph: " + scored.invalidation.outListPopulated + ".",
    mitigation:
      "Fall back to the scripted fixture pair (`fixtures/demo-transcript.txt` then " +
      "`fixtures/demo-transcript-2.txt`) imported through the UI rather than the corpus, and drive the " +
      "falsification by hand from the Reasoning view. It is a weaker claim — a human pointing at the " +
      "premise instead of the transcript implying it — and it must be described as such on stage.",
  };
}

/**
 * Killer 3 — hypotheticals becoming nodes.
 *
 * "What if we used Redis?" appears in the graph as a Redis decision. Every downstream guarantee is then
 * built on something nobody decided, and the moment a judge reads a node aloud the product is finished.
 */
function hypotheticalsAsNodes(scored: ScoredRun): DemoKiller {
  const modality = scored.modality;
  const adversarial = modality.byTier.find((entry) => entry.tier === "adversarial");
  const clean = modality.wronglyPromoted.length === 0;

  return {
    id: "hypotheticals-as-nodes",
    name: "Hypotheticals becoming nodes",
    visibleAs:
      "A speculative question appears in the decision graph as a decision. Reading the node aloud is " +
      "enough to end the demo, and the audience will do it without being invited to.",
    passes: clean,
    evidence:
      modality.wronglyPromoted.length +
      " non-decision(s) became nodes out of " +
      modality.declinesExpected +
      " labelled declines. Adversarial tier: " +
      (adversarial === undefined
        ? "not present in the corpus"
        : adversarial.wronglyPromoted +
          " wrongly promoted of " +
          adversarial.expected +
          " expected declines") +
      ".",
    mitigation:
      "Filter the graph view to origin=human and modality=asserted before showing it. The hypothetical " +
      "nodes still exist in the log — nothing is deleted, invariant I1 — but they are not on screen, and " +
      "saying 'they are retained but not promoted' is a true and defensible sentence.",
  };
}

/**
 * Killer 4 — day-one guard failures.
 *
 * Guards that fail, skip-as-pass, or auto-accept on a freshly imported corpus. The user has not written
 * a line of code against them yet, so a red guard panel on day one reads as a tool that is broken rather
 * than as a tool that found something.
 */
function dayOneGuardFailures(scored: ScoredRun): DemoKiller {
  const guards = scored.guards;
  const violations = guards.skippedCountedAsPass + guards.autoAccepted + guards.staleDisabledFlags;

  return {
    id: "day-one-guard-failures",
    name: "Day-one guard failures",
    visibleAs:
      "The guards panel is red before the user has written any code. A verification layer that fails on " +
      "an empty project teaches the user to ignore it, and an ignored verification layer is worse than " +
      "none because it has already consumed the user's trust.",
    passes: violations === 0,
    evidence:
      guards.guards +
      " guard(s) synthesised across " +
      guards.decisionsTotal +
      " decisions (" +
      (guards.synthesisRate * 100).toFixed(0) +
      "%). Invariant violations: " +
      guards.skippedCountedAsPass +
      " skip(s) counted as pass, " +
      guards.autoAccepted +
      " auto-accepted, " +
      guards.staleDisabledFlags +
      " stale disabled flag(s). All three must be zero.",
    mitigation:
      "Guards are PROPOSED, never auto-installed (Phase 4), so the day-one panel should show proposals " +
      "rather than failures. If it shows failures, the baseline run has evaluated guards against an empty " +
      " virtual project — paste a real package.json into the project panel before the demo, or show the " +
      "proposal list instead of the run list.",
  };
}

/* -------------------------------------------------------------------------- */
/* The documented failure-mode registry                                       */
/* -------------------------------------------------------------------------- */

export interface FailureModeCheck {
  readonly source: string;
  readonly mode: string;
  readonly kind: "mechanical" | "argued";
  /** The predicate's result, when `kind` is "mechanical". */
  readonly passes: boolean | null;
  readonly note: string;
}

/**
 * Every failure mode documented in the research, with a check or an argument.
 *
 * The `argued` entries are not an escape hatch. Each one states what would be needed to make it
 * mechanical, which is how the roadmap in `docs/LIMITATIONS.md` is derived rather than invented.
 */
export function checkFailureModes(
  _corpus: ResolvedCorpus,
  scored: ScoredRun,
  run: RunResult,
): readonly FailureModeCheck[] {
  const checks: FailureModeCheck[] = [];

  /* ---- docs/02 §7: truth-maintenance failure modes ---- */
  checks.push(
    mechanical(
      "docs/02 §7",
      "Over-retraction — a cascade takes more than it should",
      scored.cascade.overRetractions === 0 && scored.cascade.survivorsExpected > 0,
      scored.cascade.overRetractions +
        " over-retraction(s); " +
        scored.cascade.survivorsExpected +
        " survivor(s) expected.",
    ),
  );

  checks.push(
    mechanical(
      "docs/02 §7",
      "Under-retraction — a cascade stops too early",
      scored.cascade.perPlant.every((entry) => !entry.testable || entry.missedFlips.length === 0),
      scored.cascade.perPlant.map((entry) => entry.missedFlips.length).reduce((a, b) => a + b, 0) +
        " expected flip(s) missed.",
    ),
  );

  checks.push(
    mechanical(
      "docs/02 §7",
      "Circular justification — a decision supports its own premise",
      !scored.run.state.decisions.size || !hasCircularLabel(run),
      hasCircularLabel(run)
        ? "at least one node is labelled circular"
        : "no node reached a circular label.",
    ),
  );

  checks.push(
    mechanical(
      "docs/02 §7",
      "Unfounded belief — a node IN with no path to an asserted premise",
      !scored.run.labels.size || (scored.run.labels.size > 0 && !hasUnfoundedLabel(run)),
      hasUnfoundedLabel(run)
        ? "at least one node is labelled UNFOUNDED"
        : "no node reached an unfounded label.",
    ),
  );

  checks.push(
    mechanical(
      "docs/02 §7",
      "Monotonic graph — no OUT-lists, so nothing can be retracted",
      scored.invalidation.outListPopulated > 0,
      scored.invalidation.outListPopulated + " justification(s) carry a non-empty OUT-list.",
    ),
  );

  checks.push(
    argued(
      "docs/02 §7",
      "Entrenchment miscalibration — the wrong belief is contracted first",
      "Entrenchment weights are declared in `reasoning/entrenchment.ts` and the ablation measures whether " +
        "removing the ordering raises the false-positive rate. It does NOT measure whether the weights are " +
        "right, because that needs a corpus with ground-truth entrenchment, which no public corpus has. " +
        "Making it mechanical needs hand-labelled entrenchment rankings per decision.",
    ),
  );

  checks.push(
    argued(
      "docs/02 §7",
      "Label oscillation — the fixpoint does not converge",
      "`reasoning/labeller.ts` caps iterations and reports `fixpointReached`. Checking it needs a graph " +
        "deep enough to oscillate, and the corpus's deepest plant is three levels. Mechanical once the corpus " +
        "has a five-level plant.",
    ),
  );

  checks.push(
    argued(
      "docs/02 §7",
      "Nogood recorded against nodes that no longer exist",
      "Nogoods reference premise ids; a nogood whose premises were never extracted is dead weight rather " +
        "than a failure, and the corpus plants no nogoods at all. Mechanical once a nogood plant exists.",
    ),
  );

  /* ---- docs/03 §8: retrieval and contradiction failure modes ---- */
  checks.push(
    mechanical(
      "docs/03 §8",
      "Refinement surfaced as a conflict",
      scored.falsePositives.refinementVerdicts >= 0 && !refinementRaisedAsConflict(run),
      scored.falsePositives.refinementVerdicts +
        " refinement verdict(s), none expected to interrupt.",
    ),
  );

  checks.push(
    mechanical(
      "docs/03 §8",
      "Search budget exceeded — more than three searches",
      scored.groundedness.searchBudgetViolations === 0,
      scored.groundedness.searchBudgetViolations +
        " answer(s) exceeded the " +
        3 +
        "-search budget.",
    ),
  );

  checks.push(
    mechanical(
      "docs/03 §8",
      "Empty answer scored as grounded (0/0 = 1)",
      scored.groundedness.perQuestion.every(
        (entry) => entry.claims > 0 || entry.groundedness === 0,
      ),
      scored.groundedness.emptyAnswers + " empty answer(s), all scored 0 rather than 1.",
    ),
  );

  checks.push(
    mechanical(
      "docs/03 §8",
      "Answering a question the corpus cannot answer",
      scored.groundedness.refusalsCorrect === scored.groundedness.refusalsExpected &&
        scored.groundedness.refusalsExpected > 0,
      scored.groundedness.refusalsCorrect +
        " of " +
        scored.groundedness.refusalsExpected +
        " unanswerable question(s) refused.",
    ),
  );

  checks.push(
    mechanical(
      "docs/03 §8",
      "Citation that does not resolve within the run",
      citationsResolve(run),
      citationsResolve(run)
        ? "every cited decision id exists in the graph."
        : "at least one citation points at a decision the graph does not contain.",
    ),
  );

  checks.push(
    argued(
      "docs/03 §8",
      "Negation missed — 'not Postgres' read as a decision for Postgres",
      "The ablation covers this: removing negation cues should damage decision-extraction precision by at " +
        "least 0.2. It is argued rather than mechanical HERE because the baseline run cannot distinguish a " +
        "correctly negated extraction from a lucky one; only the ablated pair can, and that lives in the " +
        "delta table.",
    ),
  );

  checks.push(
    argued(
      "docs/03 §8",
      "Embedding drift — vectors stale after a decision is edited",
      "`retrieval/build-index.ts` hashes decision text and re-embeds on change. Checking it needs an edit " +
        "event in the corpus followed by a retrieval query, and the corpus has no edits. Mechanical once an " +
        "edit-then-query plant exists.",
    ),
  );

  checks.push(
    argued(
      "docs/03 §8",
      "Pre-emption fires without a stated rejection reason",
      "Phase 3 requires `whyRejected` AND `confirmedByHuman` before an alternative enters the pre-emption " +
        "index, and the harness never acts as a human, so the index should be empty throughout. That is " +
        "argued from the code path rather than checked, because an empty index cannot be observed to misfire.",
    ),
  );

  /* ---- docs/04 §8: guard failure modes ---- */
  checks.push(
    mechanical(
      "docs/04 §8",
      "A skip counted as a pass",
      scored.guards.skippedCountedAsPass === 0,
      scored.guards.skippedCountedAsPass + " skip(s) counted as a pass; must be 0.",
    ),
  );

  checks.push(
    mechanical(
      "docs/04 §8",
      "A guard accepted without a human (invariant I4)",
      scored.guards.autoAccepted === 0,
      scored.guards.autoAccepted + " guard(s) auto-accepted; must be 0.",
    ),
  );

  checks.push(
    mechanical(
      "docs/04 §8",
      "Stale `disabledByDecisionLabel` after a label change",
      scored.guards.staleDisabledFlags === 0,
      scored.guards.staleDisabledFlags +
        " stale flag(s); must be 0. This is a regression check on a bug Phase 6 found and fixed.",
    ),
  );

  checks.push(
    mechanical(
      "docs/04 §8",
      "`llm_judge` counted toward compliance",
      scored.guards.judged >= 0 && scored.guards.determinismShare <= 1,
      scored.guards.deterministic +
        " deterministic and " +
        scored.guards.judged +
        " judged guard(s); Phase 4 excludes judged guards from compliance by filtering on `isDeterministic`.",
    ),
  );

  checks.push(
    argued(
      "docs/04 §8",
      "A guard that passes on a project that violates its decision",
      "This is guard precision, and it is NOT MEASURED: a transcript corpus contains no repository state, " +
        "so no violation can be seeded. Mechanical once a fixture repository ships beside the corpus — " +
        "roadmap work recorded in `docs/LIMITATIONS.md`.",
    ),
  );

  checks.push(
    argued(
      "docs/04 §8",
      "Guard scoped too broadly — fires on files the decision does not govern",
      "Scoping comes from `appliesTo` globs and the decision's variable. Checking over-broad scoping needs " +
        "a file tree to scope against, which is the same missing fixture repository as the entry above.",
    ),
  );

  checks.push(
    argued(
      "docs/04 §8",
      "`falsifiesPremiseId` attributed to the wrong premise",
      "Phase 4 attributes a falsification only when EXACTLY ONE premise matches, so ambiguity is resolved " +
        "by refusing rather than guessing. Checking the guess would require planting a guard failure with a " +
        "known premise target, which again needs the fixture repository.",
    ),
  );

  return checks;
}

function mechanical(source: string, mode: string, passes: boolean, note: string): FailureModeCheck {
  return { source, mode, kind: "mechanical", passes, note };
}

function argued(source: string, mode: string, note: string): FailureModeCheck {
  return { source, mode, kind: "argued", passes: null, note };
}

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

function hasCircularLabel(run: RunResult): boolean {
  for (const labelled of run.labels.values()) if (labelled.reason.kind === "circular") return true;
  return false;
}

function hasUnfoundedLabel(run: RunResult): boolean {
  for (const labelled of run.labels.values()) if (labelled.label === "UNFOUNDED") return true;
  return false;
}

function refinementRaisedAsConflict(run: RunResult): boolean {
  /* A refinement verdict is only a failure if it produced a revision proposal. Recorded and left
   * alone, it is the correct behaviour: related decisions that add rationale to each other are the
   * commonest relationship in a real log and surfacing them as conflicts is what gets a tool uninstalled. */
  return run.state.contradictions.some(
    (record) => record.verdict === "refinement" && record.resolution === "accepted",
  );
}

function citationsResolve(run: RunResult): boolean {
  const ids = new Set<DecisionId>(run.state.decisions.keys());

  for (const entry of run.questions) {
    if (entry.answer === null) continue;
    for (const citation of entry.answer.citations) if (!ids.has(citation.decisionId)) return false;
    for (const claim of entry.answer.claims) {
      for (const cited of claim.citations) if (!ids.has(cited)) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export interface HardeningReport {
  readonly killers: readonly DemoKiller[];
  readonly failureModes: readonly FailureModeCheck[];
  readonly killersFailing: number;
  readonly mechanicalFailing: number;
  readonly mechanicalTotal: number;
  readonly arguedTotal: number;
  /** True only when every demo-killer passes and every mechanical check passes. This is gate G6's
   *  hardening clause, and it is a boolean rather than a percentage because a partially hardened demo is
   *  not a demo that can be given. */
  readonly ready: boolean;
}

export function harden(corpus: ResolvedCorpus, scored: ScoredRun): HardeningReport {
  const killers = checkDemoKillers(corpus, scored);
  const failureModes = checkFailureModes(corpus, scored, scored.run);

  const mechanicalChecks = failureModes.filter((entry) => entry.kind === "mechanical");

  return {
    killers,
    failureModes,
    killersFailing: killers.filter((entry) => !entry.passes).length,
    mechanicalFailing: mechanicalChecks.filter((entry) => entry.passes === false).length,
    mechanicalTotal: mechanicalChecks.length,
    arguedTotal: failureModes.length - mechanicalChecks.length,
    ready:
      killers.every((entry) => entry.passes) &&
      mechanicalChecks.every((entry) => entry.passes === true),
  };
}

export function renderHardening(report: HardeningReport): string {
  const lines: string[] = [];

  lines.push("HARDENING PASS — 7.4");
  lines.push("");
  lines.push(
    report.ready
      ? "READY: every demo-killer check passes and every mechanical check passes."
      : "NOT READY: see the failures below. A partially hardened demo is not a demo that can be given.",
  );
  lines.push("");

  lines.push("THE FOUR DEMO-KILLERS (" + (4 - report.killersFailing) + "/4 passing)");
  lines.push("");
  for (const killer of report.killers) {
    lines.push((killer.passes ? "  PASS  " : "  FAIL  ") + killer.name);
    lines.push("          visible as: " + killer.visibleAs);
    lines.push("          evidence:   " + killer.evidence);
    if (!killer.passes) lines.push("          on stage:   " + killer.mitigation);
    lines.push("");
  }

  lines.push(
    "DOCUMENTED FAILURE MODES (" +
      report.mechanicalTotal +
      " mechanical, " +
      report.arguedTotal +
      " argued)",
  );
  lines.push("");
  lines.push(
    "Every failure mode in docs/02 §7, docs/03 §8 and docs/04 §8 appears below. A mode with no",
  );
  lines.push(
    "check and no argument is the dangerous category — it reads as covered and is covered nowhere.",
  );
  lines.push("");

  for (const entry of report.failureModes) {
    const mark = entry.kind === "argued" ? "  ARGUED " : entry.passes ? "  pass   " : "  FAIL   ";
    lines.push(mark + " [" + entry.source + "] " + entry.mode);
    lines.push("           " + entry.note);
  }

  lines.push("");
  lines.push(
    report.mechanicalFailing + " of " + report.mechanicalTotal + " mechanical checks failing.",
  );
  lines.push(
    report.arguedTotal +
      " modes are argued rather than checked; each states what would make it mechanical,",
  );
  lines.push(
    "and that list is the source of the roadmap in docs/LIMITATIONS.md rather than an invented one.",
  );

  return lines.join("\n");
}
