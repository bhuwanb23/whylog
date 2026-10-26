/**
 * The remaining decision-card sections — 6.2.
 *
 * Phase 6 · sub-phase 6.2
 *
 * Five small sections in one file. They are grouped because each is under twenty lines of markup and
 * each reads one field off the decision: splitting them into five files would make the card's
 * structure harder to see, not easier, and the plan's density risk is about the rendered card rather
 * than the file count.
 *
 * The three sections no competitor has — RESTS ON / EXCLUDES, ENTRENCHMENT and ACCEPTED DOWNSIDE —
 * are the ones with their own files, because each carries an argument worth stating at length.
 */

import type { GraphState } from "@/substrate/graph-state";
import { EDGE_STYLE } from "@/theme";
import type { DecisionId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { GuardSpec } from "@/types/guards";
import type { ReactElement } from "react";
import { SectionLabel } from "./PremiseList";

/* -------------------------------------------------------------------------- */
/* Y-statement                                                                */
/* -------------------------------------------------------------------------- */

/**
 * "In the context of ⟨premises⟩, facing ⟨concern⟩, we decided for ⟨value⟩ to achieve ⟨quality⟩,
 *  accepting ⟨downside⟩."
 *
 * Rendered verbatim when Phase 1 recovered it. When it did not, the card falls back to the short
 * imperative statement rather than synthesising a Y-statement from parts — a generated one would read
 * as though someone had said it, and the whole provenance discipline exists to prevent exactly that.
 */
export function YStatement({ decision }: { decision: Decision }): ReactElement | null {
  if (decision.yStatement === undefined || decision.yStatement.trim().length === 0) return null;

  return (
    <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6 }}>
      {decision.yStatement}
      <span className="faint mono" style={{ fontSize: 9, marginLeft: 8 }}>
        Y-statement
      </span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Rejected alternatives                                                      */
/* -------------------------------------------------------------------------- */

/** The rejected alternatives, with the reason each was turned down. An alternative with no recorded
 *  reason is shown as having none, rather than omitted: the absence is information, because it means
 *  the rejection cannot pre-empt a repeat question and cannot appear in the export's
 *  do-not-re-propose block. */
export function AlternativeList({
  state,
  decision,
}: { state: GraphState; decision: Decision }): ReactElement {
  const alternatives = decision.alternativeIds
    .map((id) => state.alternatives.get(id))
    .filter((entry) => entry !== undefined);

  if (alternatives.length === 0) {
    return (
      <div>
        <SectionLabel>rejected</SectionLabel>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Nothing recorded as rejected. Without alternatives the log can say what was chosen but not
          what was turned down — which is the half that stops the next person, or the next agent,
          proposing it again.
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>rejected</SectionLabel>
      <ul
        style={{
          margin: "6px 0 0",
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {alternatives.map((alternative) => (
          <li key={alternative.id} style={{ fontSize: 12 }}>
            <strong>{alternative.value}</strong>
            {alternative.whyRejected === undefined ? (
              <span
                className="faint"
                style={{ marginLeft: 8 }}
                title="A rejection with no reason cannot pre-empt a repeat question and is excluded from the export's do-not-re-propose block."
              >
                — no reason recorded
              </span>
            ) : (
              <span className="dim" style={{ marginLeft: 8 }}>
                — “{alternative.whyRejected}”
              </span>
            )}
            {!alternative.confirmedByHuman ? (
              <span
                className="faint mono"
                style={{ fontSize: 9, marginLeft: 8 }}
                title="Alternatives need explicit human confirmation before entering the pre-emption index. At 15.4% extraction precision, an unconfirmed inferred rejection is more likely wrong than right."
              >
                unconfirmed
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Accepted downside                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The third section no competitor has.
 *
 * Nobody stores the downside they knowingly accepted, and it is precisely what a future you needs
 * when the downside arrives. "Single-writer limit; migration needed if multi-user" turns a surprise
 * into a scheduled event — the second user shows up, the card already said this would happen, and the
 * response is a supersession rather than a discovery.
 */
export function AcceptedDownside({ decision }: { decision: Decision }): ReactElement | null {
  if (decision.acceptedDownside === undefined || decision.acceptedDownside.trim().length === 0)
    return null;

  return (
    <div>
      <SectionLabel>accepted downside</SectionLabel>
      <div
        style={{
          marginTop: 4,
          padding: "6px 10px",
          borderLeft: "2px solid var(--label-unknown)",
          fontSize: 12,
        }}
        title="Nobody stores the downside they knowingly accepted, and it is precisely what a future you needs when the downside arrives. This turns a surprise into a scheduled event."
      >
        {decision.acceptedDownside}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

export function GuardSummary({
  state,
  decision,
}: { state: GraphState; decision: Decision }): ReactElement {
  const guards = decision.guardIds
    .map((id) => state.guards.get(id))
    .filter((guard) => guard !== undefined && guard.lifecycle !== "deleted");

  const passing = guards.filter((guard) => guard?.lastRun?.outcome === "pass").length;
  const failing = guards.filter((guard) => guard?.lastRun?.outcome === "fail").length;
  const accepted = guards.filter((guard) => guard?.lifecycle === "accepted").length;

  return (
    <div>
      <SectionLabel>guards</SectionLabel>

      {guards.length === 0 ? (
        <div className="notice notice-warning" style={{ fontSize: 12, marginTop: 6 }}>
          None. Nothing automatically checks whether this decision still holds — it is recorded
          because it is believed, not because it is enforced. Synthesise guards on the Guards tab.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            <strong style={{ color: failing > 0 ? "var(--edge-conflict)" : "var(--label-in)" }}>
              {passing}/{accepted} passing
            </strong>
            {failing > 0 ? (
              <span style={{ color: "var(--edge-conflict)" }}> · {failing} FAILING</span>
            ) : null}
            {guards.length - accepted > 0 ? (
              <span className="faint"> · {guards.length - accepted} not yet accepted</span>
            ) : null}
          </div>

          <ul
            style={{
              margin: "6px 0 0",
              paddingLeft: 18,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {guards.map((guard) => {
              if (guard === undefined) return null;
              const outcome = guard.lastRun?.outcome ?? "never run";
              const mark = outcome === "pass" ? "✓" : outcome === "fail" ? "✗" : "–";
              const colour =
                outcome === "pass"
                  ? "var(--label-in)"
                  : outcome === "fail"
                    ? "var(--edge-conflict)"
                    : "var(--text-faint)";

              return (
                <li key={guard.id} style={{ fontSize: 11.5 }}>
                  <span className="mono" style={{ color: colour }}>
                    {mark}
                  </span>{" "}
                  <span className="mono faint">{guard.id}</span>{" "}
                  <span className="mono">{guard.spec.kind}</span>{" "}
                  <span className="dim">{guardTarget(guard.spec)}</span>{" "}
                  <span
                    className="badge"
                    style={{
                      color:
                        guard.severity === "blocking"
                          ? "var(--edge-conflict)"
                          : "var(--label-unknown)",
                    }}
                  >
                    {guard.severity}
                  </span>{" "}
                  <span className="badge faint">{guard.lifecycle}</span>
                  {guard.disabledByDecisionLabel ? (
                    <span className="faint" style={{ fontSize: 10 }}>
                      {" "}
                      disabled — decision not IN
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** What the guard actually checks, in one short phrase. Switched over the spec union rather than
 *  reached into with a cast, so adding a ninth guard kind produces a compile error here instead of
 *  rendering "undefined" into the card. */
function guardTarget(spec: GuardSpec): string {
  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return spec.package;
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return JSON.stringify(spec.pattern) + " in " + spec.glob;
    case "command_exit_zero":
      return spec.command;
    case "llm_judge":
      return "rubric over " + spec.scopeGlobs.join(", ");
  }
}

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

/** The five edge kinds, each with the style the lattice gives it, so the card and the picture agree
 *  about what a relationship means. */
export function RelationList({
  state,
  decision,
}: { state: GraphState; decision: Decision }): ReactElement {
  const groups: { kind: keyof Decision["edges"]; label: string; ids: readonly DecisionId[] }[] = [
    { kind: "dependsOn", label: "depends on", ids: decision.edges.dependsOn },
    { kind: "sharesPremiseWith", label: "shares a premise", ids: decision.edges.sharesPremiseWith },
    { kind: "supersedes", label: "supersedes", ids: decision.edges.supersedes },
    { kind: "supersededBy", label: "superseded by", ids: decision.edges.supersededBy },
    { kind: "conflictsWith", label: "conflicts with", ids: decision.edges.conflictsWith },
    { kind: "related", label: "related", ids: decision.edges.related },
  ];

  const present = groups.filter((group) => group.ids.length > 0);

  if (present.length === 0) {
    return (
      <div>
        <SectionLabel>relates to</SectionLabel>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Nothing. This decision shares no premise with another, depends on nothing and supersedes
          nothing — so falsifying any other premise cannot reach it, and it cannot reach anything
          else.
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>relates to</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {present.map((group) => {
          const style = EDGE_STYLE[group.kind];
          return (
            <div
              key={group.kind}
              style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}
            >
              <svg width="24" height="8" aria-hidden="true" style={{ flexShrink: 0 }}>
                <line
                  x1="0"
                  y1="4"
                  x2="24"
                  y2="4"
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                />
              </svg>
              <span className="faint" style={{ fontSize: 11, minWidth: 110 }} title={style.label}>
                {group.label}
              </span>
              <span className="mono">
                {group.ids.map((id) => state.decisions.get(id)?.id ?? id).join(", ")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 10, marginTop: 6 }}>
        Edge styles match the premise lattice exactly, so a relationship means the same thing in
        both views. `conflicts` is the only red: red means an action is available.
      </div>
    </div>
  );
}
