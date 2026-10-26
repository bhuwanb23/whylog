/**
 * The demo kit — 7.5. One import site.
 *
 * Script, seed, reset, verification and dry runs. The script is data and the verifier walks it, so the
 * artefact that gets rehearsed, the artefact that gets checked and the artefact that gets presented are
 * the same one.
 */

export { DERIVED_KEYS, INTEGRITY_KEY, NOT_A_STORAGE_KEY, STORAGE_KEYS } from "./keys";
export { buildSeed, describeReset, resetDemo } from "./kit";
export type { SeedResult } from "./kit";
export { cuttableBeats, renderScript, totalSeconds, SCRIPT, DEMO_SECONDS } from "./script";
export type { Beat, CheckId, ViewId } from "./script";
export { renderVerification, verifyDemo } from "./verify";
export type { CheckResult, CheckStatus, VerificationReport } from "./verify";
export { REQUIRED_DRY_RUNS, renderDryRuns, runDryRuns } from "./dryrun";
export type { DryRun, DryRunFingerprint, DryRunReport } from "./dryrun";
