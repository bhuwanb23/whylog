/**
 * Type layer barrel.
 *
 * Phase 0 · sub-phase 0.1
 *
 * Every contract in the system lives here. Modules import from "@/types" and
 * never from each other's internals, which is what keeps the five layers
 * (substrate -> extraction -> reasoning -> retrieval -> synthesis) from
 * tangling.
 *
 * Reading order if you are new to the codebase:
 *   1. common.ts    — branded ids, bi-temporal pair, provenance primitives
 *   2. domain.ts    — decisions, PREMISES, justifications, labels, the KB
 *   3. events.ts    — the closed event vocabulary (invariant I1)
 *   4. reasoning.ts — entrenchment, cascade, proposals (Phase 2)
 *   5. retrieval.ts — index levels, verdicts, evidence contract (Phase 3)
 *   6. guards.ts    — executable verification (Phase 4)
 *   7. export.ts    — the agent-native compiler (Phase 5)
 */

export * from "./common";
export * from "./domain";
export * from "./events";
export * from "./reasoning";
export * from "./retrieval";
export * from "./guards";
export * from "./export";
