/**
 * ENTRENCHMENT — 6.2. ★ one of the three sections no competitor has.
 *
 * Phase 6 · sub-phase 6.2
 * Plan: plan/phase-6-presentation.md §6.2
 * Research: docs/02-truth-maintenance-theory.md §3.4
 *
 * ---------------------------------------------------------------------------
 * THE NUMBER IS ARGUABLE BECAUSE THE BREAKDOWN IS VISIBLE
 *
 *   E(d) = 0.30 · source_authority + 0.20 · implementation_cost + 0.20 · corroboration
 *        + 0.15 · confidence + 0.15 · recency        capped by EE3
 *
 * An entrenchment score nobody can decompose is an authority figure: the system says "this is
 * entrenched, 0.78" and the only available responses are to accept it or ignore the feature. Showing
 * all five weighted terms turns it into an argument the user can have — "corroboration 0.31? that is
 * one transcript, and I have said it four times" is a sentence this breakdown makes possible.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN IS DISPLAYED AS UNKNOWN
 *
 * `implementationCostUnknown` is true when no accepted guard has ever run, which makes the term a
 * DEFAULT of 0.5 rather than a measurement. It is rendered as "unknown — no guard", never as
 * "medium". A missing measurement that masquerades as a measurement is the one way this number could
 * actively mislead, and Phase 4 exists to replace the default with a real fraction.
 *
 * ---------------------------------------------------------------------------
 * THE EE3 CAP IS NAMED WHEN IT BINDS
 *
 * A derived belief is never more entrenched than its weakest premise. When the cap binds, the card
 * says which premise capped it — because "this is entrenched at 0.31 because `single-user` is only at
 * 0.31" is the sentence that explains why premise invalidation can beat entrenchment, which is the
 * whole demo.
 * ---------------------------------------------------------------------------
 */

import type { ReactElement } from "react";
import type { DecisionId } from "@/types/common";
import type { EntrenchmentBreakdown as Breakdown } from "@/types/reasoning";
import { entrenchmentBand } from "@/types/reasoning";
import { SectionLabel } from "./PremiseList";

const TERM_LABEL: Readonly<Record<keyof Breakdown["components"], { name: string; why: string }>> = {
  sourceAuthority: {
    name: "authority",
    why: "Who said it. human_stated is 1.00; an override is 0.90 so it can itself be overridden; agent_inferred is lowest and most worth checking.",
  },
  implementationCost: {
    name: "implementation",
    why: "How much is built on it. A MEASUREMENT from Phase 4 — the fraction of this decision's accepted guards that ran and passed — or 0.5 UNKNOWN when none has.",
  },
  corroboration: {
    name: "corroboration",
    why: "How many independent sources support it. One transcript is not corroboration; a second source saying the same thing is.",
  },
  confidence: {
    name: "confidence",
    why: "How sure the extraction was. Low confidence caps entrenchment, so a guessed decision cannot become hard to retract.",
  },
  recency: {
    name: "recency",
    why: "How recently it was decided, on VALID time with a 30-day half-life. Age alone does not make a decision wrong, but it does reduce its claim on the present.",
  },
};

export function EntrenchmentBreakdown({
  breakdown,
  expanded = false,
}: {
  breakdown: Breakdown;
  expanded?: boolean;
}): ReactElement {
  const band = entrenchmentBand(breakdown.capped);

  return (
    <div>
      <SectionLabel>entrenchment</SectionLabel>

      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 4, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
          {breakdown.capped.toFixed(2)}
        </span>
        <span
          className="badge"
          title={
            band === "HIGH"
              ? "Strongly held. Reversing this costs the most, and the adjudicator will screen a newcomer against it rather than accepting the newcomer by default."
              : band === "MEDIUM"
                ? "Moderately held. A newcomer with better evidence can outrank it."
                : "Weakly held. Little stands between this decision and being revised."
          }
        >
          {band}
        </span>

        {breakdown.ee3CapApplied ? (
          <span
            className="badge"
            style={{ color: "var(--label-unknown)" }}
            title={
              "The EE3 cap binds: a derived belief is never more entrenched than its weakest premise. " +
              (breakdown.weakestPremiseId === undefined
                ? ""
                : "Capped by " + breakdown.weakestPremiseId + ".")
            }
          >
            EE3 cap
            {breakdown.weakestPremiseId !== undefined ? " · " + breakdown.weakestPremiseId : ""}
          </span>
        ) : null}
      </div>

      {/* The bar, with the cap marked when it binds, so "0.78 raw but 0.31 after the cap" is
          visible as two positions rather than as one number with a footnote. */}
      <div style={{ position: "relative", height: 6, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 3, marginTop: 8 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(breakdown.total), background: "var(--text-faint)", opacity: 0.45, borderRadius: 3 }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(breakdown.capped), background: "var(--label-in)", borderRadius: 3 }} />
      </div>

      {breakdown.ee3CapApplied ? (
        <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>
          Raw {breakdown.total.toFixed(2)} (grey), capped to {breakdown.capped.toFixed(2)} (green) by
          its weakest premise. This is what lets premise invalidation beat entrenchment — without the
          cap, a decision resting entirely on `single-user` could out-rank the arrival of a second
          user on corroboration and recency alone, and the system would refuse the very evidence that
          invalidates it.
        </div>
      ) : null}

      {expanded ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 11 }}>
          <tbody>
            {(Object.keys(breakdown.components) as (keyof Breakdown["components"])[]).map((key) => {
              const meta = TERM_LABEL[key];
              const value = breakdown.components[key];
              const weight = breakdown.weights[key];
              const unknown = key === "implementationCost" && breakdown.implementationCostUnknown;

              return (
                <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }} title={meta.why}>
                    {meta.name}
                  </td>
                  <td className="mono faint" style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                    {weight.toFixed(2)} ×
                  </td>
                  <td className="mono" style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                    {unknown ? "0.50 UNKNOWN" : value.toFixed(2)}
                  </td>
                  <td className="mono faint" style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                    = {(value * weight).toFixed(3)}
                  </td>
                  <td className="dim" style={{ padding: "4px 6px" }}>
                    {unknown
                      ? "No accepted guard has run, so this is a DEFAULT, not a measurement. Phase 4 replaces it with the passing-guard fraction. A missing measurement must not masquerade as one — which is why it says UNKNOWN and never 'medium'."
                      : meta.why}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function pct(value: number): string {
  return (Math.max(0, Math.min(1, value)) * 100).toFixed(1) + "%";
}

export type { DecisionId };
