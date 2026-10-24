/**
 * `npm run demo:verify` — build the seed, verify every beat, run the dry runs.
 *
 * Phase 7 · sub-phase 7.5
 *
 * The rehearsal command. It answers three questions in order, and stops at the first one that fails:
 *   1. does the seed build at all
 *   2. does every beat of the script have something to show
 *   3. does it do the same thing three times in a row
 *
 * Keyless throughout. If this command needs an API key to pass, the demo is not verifiable and the
 * requirement in §7.5 has not been met.
 */

import { banner, blank, heading, line, readArgs, write } from "../cli";
import { buildSeed, describeReset, resetDemo } from "./kit";
import { renderScript } from "./script";
import { renderVerification, verifyDemo } from "./verify";
import { REQUIRED_DRY_RUNS, renderDryRuns, runDryRuns } from "./dryrun";

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));

  banner("Demo kit — keyless verification");

  heading("Script");
  line(renderScript());

  heading("Reset");
  /* In Node there is no localStorage, so the reset reports that and the seed is built from scratch
   * anyway. Printed rather than skipped: a presenter rehearsing in a browser needs to know the reset is
   * a real action there, and a rehearsal harness that silently did nothing would not catch a key it
   * forgot to clear. */
  line(describeReset(resetDemo(null)));

  heading("Seed");
  const seed = await buildSeed();
  line(
    "built in " + (seed.durationMs / 1000).toFixed(1) + "s · " + seed.decisions + " decisions · " +
    seed.premises + " premises · engine " + seed.engineId.kind,
  );
  for (const warning of seed.warnings) line("  warning: " + warning);

  heading("Beat verification");
  const report = verifyDemo(seed);
  line(renderVerification(report));

  if (!report.demoable && !args.has("force")) {
    blank();
    line("STOPPING: a beat will visibly not work. Fix it or use the mitigation printed above.");
    line("Pass --force to run the dry runs anyway.");
    process.exitCode = 1;
    if (args.has("out")) write(args.get("out") ?? "demo-verification.md", renderVerification(report));
    return;
  }

  const count = Number(args.get("runs") ?? REQUIRED_DRY_RUNS);
  heading("Dry runs — " + count + " consecutive, no reset between them");
  const dry = await runDryRuns(Number.isFinite(count) && count > 0 ? count : REQUIRED_DRY_RUNS);
  line(renderDryRuns(dry));

  if (args.has("out")) {
    write(
      args.get("out") ?? "demo-verification.md",
      ["# Demo verification", "", "```", renderScript(), "", renderVerification(report), "", renderDryRuns(dry), "```", ""].join("\n"),
    );
  }

  blank();
  line(dry.passed ? "DEMO IS READY." : "DEMO IS NOT READY — see the divergences and failures above.");
  if (!dry.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write("\n" + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
