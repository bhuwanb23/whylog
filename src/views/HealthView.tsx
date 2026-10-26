/**
 * The health view — 6.4.
 *
 * Phase 6 · sub-phase 6.4
 * Plan: plan/phase-6-presentation.md §6.4
 *
 * ---------------------------------------------------------------------------
 * SIX NUMBERS THAT SAY WHETHER THE LOG IS TRUSTWORTHY
 *
 * Each has a one-line plain-language gloss, because a metric without a gloss is a number the user
 * cannot act on and eventually stops reading. The glosses are written as sentences a person would
 * say, not as definitions — "your codebase has quietly stopped believing 3 of your 12 decisions"
 * rather than "compliance = 0.75".
 *
 * ---------------------------------------------------------------------------
 * THE AGENCY RATIO IS THE ONE NOBODY ELSE CAN COMPUTE
 *
 * It needs origin classification, which needs Phase 1 to have distinguished `human_stated` from
 * `agent_proposed` from `agent_inferred` on every node. No tool that does not classify decision
 * origin can produce it, and it is a small, sticky, genuinely interesting number: "you have
 * overridden your agent 4 times in 19 decisions."
 *
 * ---------------------------------------------------------------------------
 * PAIRS THAT MUST NOT BE SHOWN APART
 *
 * Compliance without coverage flatters itself — a log with one passing guard scores 100%. Soundness
 * without compliance misses that the code has drifted from a log that still supports itself. So the
 * six are rendered as a set with their denominators visible, and the two guard metrics share a card.
 * ---------------------------------------------------------------------------
 */

import { EmptyState } from "@/components/common";
import {
  compliance as complianceOf,
  coverage as coverageOf,
  describeDrift,
  deterministicRatio,
  driftAge,
  evaluatedFromState,
  soundness as soundnessOf,
} from "@/guards";
import { bar } from "@/guards/metrics/compliance";
import { type Labelled, type NodeId, label as labelGraph } from "@/reasoning/labeller";
import { useExport } from "@/store/export";
import { useWhyLog } from "@/store/whylog";
import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import { type ReactElement, useMemo } from "react";

export function HealthView(): ReactElement {
  const whylog = useWhyLog();
  const exportStore = useExport();

  const labels = useMemo(() => labelGraph(whylog.state).labels, [whylog.state]);

  const metrics = useMemo(() => {
    const evaluated = evaluatedFromState(whylog.state);
    const guardToDecision = new Map<string, DecisionId>();
    for (const guard of whylog.state.guards.values())
      guardToDecision.set(guard.id, guard.decisionId);

    return {
      compliance: complianceOf(evaluated, labels, guardToDecision),
      coverage: coverageOf(whylog.state, labels, []),
      soundness: soundnessOf(whylog.state, labels),
      drift: driftAge(whylog.state, Date.now()),
      ratio: deterministicRatio(whylog.state),
    };
  }, [whylog.state, labels]);

  const agency = useMemo(() => agencyRatio(whylog.state), [whylog.state]);
  const contention = useMemo(() => premiseContention(whylog.state, labels), [whylog.state, labels]);

  if (whylog.state.decisions.size === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Health</h2>
        <EmptyState
          title="No log to assess"
          what="These six numbers describe whether a decision log is trustworthy. With no decisions there is nothing to measure, and every metric would read as a misleading zero."
          action="Import a transcript on the Import & review tab. The demo fixture is enough to see all six compute."
        />
      </section>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">Six numbers</h2>

        <MetricRow
          name="Decision Compliance"
          value={metrics.compliance.score}
          fraction={metrics.compliance.compliant + " / " + metrics.compliance.denominator}
          gloss={
            metrics.compliance.denominator === 0
              ? "Nothing to measure yet: no IN decision has an accepted deterministic guard. Synthesise and accept guards and this becomes the headline number."
              : metrics.compliance.denominator - metrics.compliance.compliant === 0
                ? "Every checkable decision holds. The code still does what the log says it does."
                : "Your codebase has quietly stopped believing " +
                  (metrics.compliance.denominator - metrics.compliance.compliant) +
                  " of " +
                  metrics.compliance.denominator +
                  " checkable decisions."
          }
        />

        <MetricRow
          name="Verifiable Coverage"
          value={metrics.coverage.score}
          fraction={metrics.coverage.covered + " / " + metrics.coverage.inDecisions}
          gloss={
            metrics.coverage.score < 0.5
              ? "Most of the log is unfalsifiable prose — nothing would tell you if these decisions stopped holding. Shown next to compliance on purpose: compliance without coverage is a score that flatters itself."
              : metrics.coverage.inDecisions -
                metrics.coverage.covered +
                " IN decision(s) have no accepted guard."
          }
        />

        <MetricRow
          name="Log Soundness"
          value={metrics.soundness.score}
          fraction={metrics.soundness.inCount + " / " + metrics.soundness.denominator}
          gloss={
            "How much of what you believe is still supported by its premises. The truth-maintenance counterpart to compliance: a log can be perfectly compliant and unsound — every guard passing while half the decisions rest on premises that went OUT."
          }
        />

        <MetricRow
          name="Premise Contention"
          value={contention.score}
          fraction={contention.contested + contention.out + " / " + contention.total}
          gloss={
            contention.contested + contention.out === 0
              ? "No premise is contested or falsified. The ground has not shifted since these decisions were made."
              : "How much of the ground has shifted: " +
                contention.contested +
                " contested and " +
                contention.out +
                " falsified premise(s). Each one is a decision that may no longer be justified."
          }
          inverted
        />

        <MetricRow
          name="Agency Ratio"
          value={agency.score}
          fraction={agency.overridden + " overridden / " + agency.total}
          gloss={agency.gloss}
        />

        <MetricRow
          name="Drift Age (worst)"
          value={metrics.drift.worstDays === 0 ? 0 : Math.min(1, metrics.drift.worstDays / 30)}
          fraction={
            metrics.drift.worst === null
              ? "none"
              : metrics.drift.worstDays + " days · " + metrics.drift.worst.decisionId
          }
          gloss={
            metrics.drift.worst === null
              ? "No unresolved guard failures, so nothing is drifting."
              : "How long you have been ignoring a disagreement between the log and the code. A failure left for 30 days is a decision you no longer hold."
          }
          inverted
        />

        <MetricRow
          name="Deterministic Ratio"
          value={metrics.ratio.score}
          fraction={metrics.ratio.deterministic + " / " + metrics.ratio.total}
          gloss={
            metrics.ratio.total === 0
              ? "No accepted guards yet."
              : "How much of your verification is trustworthy without a model. At 100% the whole loop — synthesis, evaluation, compliance, drift and the revision a failure triggers — runs keyless and reproduces exactly. This is the direct answer to 'is this an LLM wrapper?'."
          }
        />
      </section>

      <section className="card">
        <h2 className="card-title">Drift</h2>
        <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11.5 }}>
          {describeDrift(metrics.drift)}
        </pre>
      </section>

      <section className="card">
        <h2 className="card-title">Integrity</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <IntegrityRow
            ok={whylog.status !== "degraded"}
            label="Hash chain"
            detail={
              whylog.status === "degraded"
                ? "BROKEN — the log is read-only. Every event is chained to its predecessor, so a broken chain means an event was altered or removed, and nothing appended since can be trusted."
                : "Verified. " +
                  whylog.log.events.length +
                  " event(s), head " +
                  (whylog.log.headHash.slice(0, 12) || "empty") +
                  ". Every event is chained to its predecessor, so an alteration anywhere downstream invalidates the head."
            }
          />

          <IntegrityRow
            ok={whylog.verification === null || whylog.verification.valid}
            label="Last verification"
            detail={
              whylog.verification === null
                ? "Not run since boot."
                : whylog.verification.valid
                  ? "Chain verified at boot."
                  : "Chain verification FAILED at boot — see the Foundation view."
            }
          />

          <IntegrityRow
            ok={exportStore.checks.every((check) => check.verification.ok)}
            label="Export stamps"
            detail={
              exportStore.checks.length === 0
                ? "No exported file has been checked against the log. Paste one on the Export tab to find out whether it still corresponds — auditability, not security."
                : exportStore.checks.filter((check) => !check.verification.ok).length +
                  " of " +
                  exportStore.checks.length +
                  " checked file(s) do not match the current log head."
            }
          />

          <IntegrityRow
            ok={!whylog.state.index.stale}
            label="Semantic index"
            detail={
              whylog.state.index.stale
                ? "STALE — the stored vectors came from a different embedding space, so semantic retrieval is disabled until you rebuild. Cosine similarity across embedding spaces is meaningless, which is why staleness is detected rather than ignored."
                : "Current. " + whylog.state.index.levels.join(", ") + " available."
            }
          />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

function MetricRow({
  name,
  value,
  fraction,
  gloss,
  inverted = false,
}: {
  name: string;
  value: number;
  fraction: string;
  gloss: string;
  /** True for metrics where HIGH is bad — contention and drift age. The bar then fills toward the
   *  bad end, so a long bar always means "look at this" regardless of which metric it is. */
  inverted?: boolean;
}): ReactElement {
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12.5, minWidth: 170 }}>{name}</strong>
        <span
          className="mono"
          style={{ fontSize: 12, letterSpacing: 1, color: barColour(clamped, inverted) }}
        >
          {bar(clamped)}
        </span>
        <span className="mono" style={{ fontSize: 12 }}>
          {(clamped * 100).toFixed(0).padStart(3)}%
        </span>
        <span className="mono faint" style={{ fontSize: 11 }}>
          {fraction}
        </span>
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 5, maxWidth: 780 }}>
        {gloss}
      </div>
    </div>
  );
}

function barColour(value: number, inverted: boolean): string {
  const bad = inverted ? value : 1 - value;
  if (bad > 0.5) return "var(--edge-conflict)";
  if (bad > 0.2) return "var(--label-unknown)";
  return "var(--label-in)";
}

function IntegrityRow({
  ok,
  label,
  detail,
}: { ok: boolean; label: string; detail: string }): ReactElement {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span
        className="mono"
        style={{ color: ok ? "var(--label-in)" : "var(--edge-conflict)", flexShrink: 0 }}
      >
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span className="dim" style={{ fontSize: 11.5 }}>
        {detail}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The two metrics with no existing implementation                            */
/* -------------------------------------------------------------------------- */

/**
 * Premise contention: how much of the ground has shifted.
 *
 * Contested (UNKNOWN) and falsified (OUT) premises both count, because both mean a decision's
 * footing has moved — one because it was never settled, the other because it settled the wrong way.
 */
export function premiseContention(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
): { score: number; contested: number; out: number; total: number } {
  let contested = 0;
  let out = 0;
  let total = 0;

  for (const premise of state.premises.values()) {
    total += 1;
    const nodeLabel = labels.get(premise.id)?.label ?? premise.label;
    if (nodeLabel === "UNKNOWN") contested += 1;
    else if (nodeLabel === "OUT") out += 1;
  }

  return { score: total === 0 ? 0 : (contested + out) / total, contested, out, total };
}

/**
 * The agency ratio — how often you override your agent versus adopt its proposals.
 *
 * Computed from `provenance.origin`, which Phase 1 classifies on every node. This is the metric
 * nobody else can produce, because nobody else distinguishes a decision a human stated from one an
 * agent proposed and a human accepted from one an agent inferred and nobody checked.
 */
export function agencyRatio(state: GraphState): {
  score: number;
  overridden: number;
  humanStated: number;
  agentProposed: number;
  agentInferred: number;
  total: number;
  gloss: string;
} {
  let humanStated = 0;
  let humanOverride = 0;
  let agentProposed = 0;
  let agentInferred = 0;
  let total = 0;

  for (const decision of state.decisions.values()) {
    if (decision.status === "archived") continue;
    total += 1;

    switch (decision.provenance.origin) {
      case "human_stated":
        humanStated += 1;
        break;
      case "human_override":
        humanOverride += 1;
        break;
      case "agent_proposed_human_accepted":
        agentProposed += 1;
        break;
      case "agent_inferred":
        agentInferred += 1;
        break;
      default:
        break;
    }
  }

  const agentSourced = agentProposed + agentInferred;
  const score = agentSourced === 0 ? 0 : humanOverride / Math.max(1, agentSourced + humanOverride);

  const gloss =
    total === 0
      ? "No decisions yet."
      : agentSourced === 0
        ? "Every one of your " +
          total +
          " decision(s) was stated by you, so there is nothing to measure agency against. This metric becomes interesting the first time an agent proposes something."
        : "You have overridden your agent " +
          humanOverride +
          " time(s) out of " +
          (agentSourced + humanOverride) +
          " agent-sourced decision(s). " +
          agentProposed +
          " proposed and accepted, " +
          agentInferred +
          " inferred and never checked, " +
          humanStated +
          " stated by you outright. Nobody who does not classify decision origin can compute this.";

  return {
    score,
    overridden: humanOverride,
    humanStated,
    agentProposed,
    agentInferred,
    total,
    gloss,
  };
}
