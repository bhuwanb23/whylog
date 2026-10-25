/**
 * `npm run eval` — score the full system once, on the local engine, and print every number.
 *
 * Phase 7 · sub-phase 7.2
 *
 * This is the entry point a judge should be invited to run. It needs no API key, no network and no
 * build step: `tsx src/eval/run.ts` against the checked-in corpus. If it cannot be run by a stranger in
 * under a minute, the numbers in the pitch are not verifiable and the pitch is an advertisement.
 */

import { describeFailures, runConfig } from "./harness";
import { FULL, DEFAULT_PARAMS } from "./ablation/toggles";
import { renderSuite, scoreAll } from "./metrics";
import { banner, blank, heading, line, prepare, readArgs, write } from "./cli";
import { renderFullReport } from "./report";
import { harden, renderHardening } from "./hardening";

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const { corpus: resolved, engine, engineId } = prepare();

  banner("Baseline run — all eleven components on");

  const run = await runConfig(resolved, {
    id: "full",
    engine,
    engineId,
    toggles: FULL,
    params: DEFAULT_PARAMS,
  });

  heading("Import");
  line(describeFailures(run));
  line(
    run.state.decisions.size + " decisions · " + run.state.premises.size + " premises · " +
    run.state.alternatives.size + " alternatives · " + run.state.guards.size + " guards · " +
    run.state.contradictions.length + " contradiction record(s)",
  );
  line("Wall time " + (run.durationMs / 1000).toFixed(1) + "s · " + run.proposalsRaised + " revision proposal(s) raised");

  /* A revision the log refused means the reasoner emitted a draft that failed validation, so the
   * graph scored below is the PRE-revision graph for that pass. Printed rather than swallowed:
   * without it a cascade score of "nothing changed" is indistinguishable from "nothing was allowed
   * to change". */
  if (run.revisionFailures.length > 0) {
    blank();
    line("Revision passes the log REFUSED (" + run.revisionFailures.length + "):");
    for (const failure of run.revisionFailures) line("  " + failure);
  }

  if (run.interventions.length > 0) {
    blank();
    line("Planted interventions:");
    for (const intervention of run.interventions) {
      line("  " + (intervention.applied ? "APPLIED  " : "UNAPPLIED") + " " + intervention.plant + " · " + intervention.predicate);
      line("           " + intervention.reason);
    }
  }

  const scored = scoreAll(resolved, run, engineId);

  heading("Metrics");
  line(renderSuite(scored));

  const hardened = harden(resolved, scored);

  heading("Hardening pass (7.4)");
  line(renderHardening(hardened));

  heading("What each number does not establish");
  for (const metric of scored.metrics) {
    line("· " + metric.name);
    line("  " + metric.gloss);
    line("  honest note: " + metric.honestNote);
    blank();
  }

  if (args.has("out")) write(args.get("out") ?? "eval-report.md", renderFullReport(resolved, scored, null, hardened));
  if (args.has("json")) {
    write(
      args.get("json") ?? "eval-report.json",
      JSON.stringify(
        {
          corpus: resolved.version,
          engine: engineId,
          ranAt: run.startedAt,
          metrics: scored.metrics,
        },
        null,
        2,
      ),
    );
  }

  blank();
  line("Run `npm run eval:ablation` for the delta table and the prediction audit.");
  line("Run `npm run demo:verify` for the demo kit: script, beat verification, three dry runs.");

  if (!hardened.ready) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write("\n" + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
