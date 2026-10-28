/**
 * Persistent prediction-audit summary for `npm run readiness`.
 *
 * The full ablation study is fifteen corpus runs — too slow for the daily
 * readiness path. Readiness reuses this cache unless `--ablation` is passed;
 * `npm run eval:ablation` refreshes it whenever a deliberate study completes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { AblationStudy } from "./run";
import { summarizePredictionAudit } from "./table";
import { NOISE_FLOOR, fullPlan } from "./toggles";

export const ABLATION_CACHE_PATH = "docs/generated/ablation-audit.json";
/** Bump when the cache shape or audit meaning changes. */
export const ABLATION_CACHE_SCHEMA = 1;

export interface AblationCache {
  readonly schema: number;
  readonly planFingerprint: string;
  readonly ranAt: string;
  readonly corpusVersion: string;
  readonly confirmed: number;
  readonly falsified: number;
  readonly belowFloor: number;
  readonly untestable: number;
  readonly notWired: number;
  /** Readiness G6 gap: ≥1 declared hypothesis confirmed or falsified. */
  readonly hypothesisResolved: boolean;
}

/** Fingerprint of the study definition — ids, expected-damage thresholds, noise floor. */
export function planFingerprint(): string {
  const plan = fullPlan();
  const parts = plan.map((entry) => {
    const damage = entry.expectsDamage
      .map((d) => d.metric + ":" + d.threshold.toFixed(3))
      .join(",");
    return entry.id + "{" + damage + "}";
  });
  return "n=" + plan.length + ";floor=" + NOISE_FLOOR.toFixed(3) + ";" + parts.join("|");
}

export function cacheFromStudy(study: AblationStudy): AblationCache {
  const summary = summarizePredictionAudit(study);
  return {
    schema: ABLATION_CACHE_SCHEMA,
    planFingerprint: planFingerprint(),
    ranAt: study.ranAt,
    corpusVersion: study.corpusVersion,
    confirmed: summary.confirmed,
    falsified: summary.falsified,
    belowFloor: summary.belowFloor,
    untestable: summary.untestable,
    notWired: summary.notWired,
    hypothesisResolved: summary.hypothesisResolved,
  };
}

export function writeAblationCache(cache: AblationCache): void {
  const path = resolvePath(process.cwd(), ABLATION_CACHE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export function persistAblationAudit(study: AblationStudy): void {
  writeAblationCache(cacheFromStudy(study));
}

export function readAblationCache(): AblationCache | null {
  const path = resolvePath(process.cwd(), ABLATION_CACHE_PATH);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AblationCache>;
    if (
      typeof raw.ranAt !== "string" ||
      typeof raw.corpusVersion !== "string" ||
      typeof raw.confirmed !== "number" ||
      typeof raw.falsified !== "number" ||
      typeof raw.belowFloor !== "number" ||
      typeof raw.untestable !== "number" ||
      typeof raw.notWired !== "number"
    ) {
      return null;
    }
    const schema = typeof raw.schema === "number" ? raw.schema : 0;
    const fingerprint = typeof raw.planFingerprint === "string" ? raw.planFingerprint : "";
    return {
      schema,
      planFingerprint: fingerprint,
      ranAt: raw.ranAt,
      corpusVersion: raw.corpusVersion,
      confirmed: raw.confirmed,
      falsified: raw.falsified,
      belowFloor: raw.belowFloor,
      untestable: raw.untestable,
      notWired: raw.notWired,
      hypothesisResolved:
        typeof raw.hypothesisResolved === "boolean"
          ? raw.hypothesisResolved
          : raw.confirmed + raw.falsified >= 1,
    };
  } catch {
    return null;
  }
}

export function ablationCacheUsable(
  cache: AblationCache | null,
  corpusVersion: string,
): cache is AblationCache {
  if (cache === null) return false;
  if (cache.schema !== ABLATION_CACHE_SCHEMA) return false;
  if (cache.corpusVersion !== corpusVersion) return false;
  if (cache.planFingerprint !== planFingerprint()) return false;
  return true;
}
