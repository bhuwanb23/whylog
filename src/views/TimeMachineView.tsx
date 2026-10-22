/**
 * The time machine — 6.7.
 *
 * Phase 6 · sub-phase 6.7
 * Plan: plan/phase-6-presentation.md §6.7
 *
 * ---------------------------------------------------------------------------
 * THE PAYOFF FOR PHASE 0.3, AND IT REALLY IS NEARLY FREE
 *
 * The fold is pure and total, so replaying a prefix of the log is a call to `materializeAsOf`, which
 * has existed in the substrate since Phase 0. Nothing here is a new mechanism; it is a slider over an
 * existing one. That is worth stating because it is the clearest demonstration in the product that
 * append-only-plus-pure-fold buys things a mutable store cannot.
 *
 * ---------------------------------------------------------------------------
 * TWO SLIDERS, ALWAYS NAMED, NEVER SHOWN ALONE
 *
 * The plan's risk is "time machine confuses two timelines" and the mitigation is to label them
 * explicitly and never show one without naming it. So:
 *
 *   VALID TIME     "when it happened"   — what was TRUE at T
 *   LEARNED TIME   "when we learned"    — what the system KNEW at T
 *
 * They diverge constantly in this product's real workflow. Paste a three-week-old transcript and the
 * system learns TODAY about a decision MADE on the 3rd. Sliding learned time back hides it entirely;
 * sliding valid time back shows it. Both are correct, and a user who cannot see which axis they are
 * on will conclude the tool got a date wrong.
 *
 * Every rendering here therefore carries the axis name, and the diff strip says which axis it
 * measured along.
 * ---------------------------------------------------------------------------
 */

import { EmptyState } from "@/components/common";
import { DecisionCard } from "@/components/decision";
import { PremiseLattice } from "@/components/graph";
import {
  AXIS_LABEL,
  type TimeAxis,
  describeDiff,
  diffGraphs,
  graphAt,
  timeRange,
  visibleAt,
} from "@/components/time-machine/projection";
import { guardStatusMap } from "@/guards";
import { entrenchmentOf } from "@/reasoning/entrenchment";
import { type NodeId, label as labelGraph } from "@/reasoning/labeller";
import { useWhyLog } from "@/store/whylog";
import type { DecisionId, ISODateString } from "@/types/common";
import { type ReactElement, useMemo, useState } from "react";

export function TimeMachineView(): ReactElement {
  const whylog = useWhyLog();
  const [axis, setAxis] = useState<TimeAxis>("valid");
  const [at, setAt] = useState<string>("");

  const range = useMemo(
    () => timeRange(whylog.log.events, whylog.state),
    [whylog.log.events, whylog.state],
  );

  const target = (at.length === 0 ? range.latest : at) as ISODateString;

  /* The replayed graph. On the learned axis this is a genuine prefix fold; on the valid axis it is
   * the current graph filtered by validity window, because the events are stored in LEARNED order
   * and cutting them by index would drop a decision made in January but recorded in October. */
  const past = useMemo(
    () => graphAt(whylog.log.events, whylog.state, target, axis, whylog.engineId),
    [whylog.log.events, whylog.state, target, axis, whylog.engineId],
  );

  const visible = useMemo(() => visibleAt(past, target, axis), [past, target, axis]);
  const diff = useMemo(
    () => diffGraphs(past, whylog.state, axis, target, whylog.state.computedAt),
    [past, whylog.state, axis, target],
  );

  const guards = useMemo(() => guardStatusMap(past), [past]);

  /* Labels for the REPLAYED graph, computed at the top level. Two reasons this cannot be inline or
   * skipped: a hook inside a conditional breaks the rules of hooks and will desync on the render
   * where the panel first appears, and an empty label map would make the card fall back to the
   * labels stored at extraction time — showing "IN" for a decision the replayed graph has already
   * retracted, which is the one thing this view must not do. */
  const pastLabels = useMemo(() => labelGraph(past).labels, [past]);

  const [selected, setSelected] = useState<DecisionId | null>(null);

  if (whylog.log.events.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Time machine</h2>
        <EmptyState
          title="No events to replay"
          what="The time machine replays a prefix of the append-only log. With no events there is no history to move through."
          action="Import a transcript, then make a change or two — reverse a decision or falsify a premise — and the two timelines will have something to diverge over."
        />
      </section>
    );
  }

  const axisMeta = AXIS_LABEL[axis];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">Time machine</h2>

        <p className="dim" style={{ margin: "0 0 12px", fontSize: 12 }}>
          Bi-temporal replay. Because the log is append-only and the fold is pure and total, this is
          a slider over an existing mechanism rather than a feature — nothing here computes history,
          it re-derives it.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(Object.keys(AXIS_LABEL) as TimeAxis[]).map((key) => (
            <button
              key={key}
              type="button"
              className="badge"
              style={{ opacity: axis === key ? 1 : 0.55 }}
              onClick={() => setAxis(key)}
              title={AXIS_LABEL[key].long}
            >
              {key === "valid" ? "valid time — when it happened" : "learned time — when we learned"}
            </button>
          ))}
        </div>

        <div className="notice notice-info" style={{ marginBottom: 12, fontSize: 12 }}>
          <strong>{axisMeta.question}</strong>
          <div className="dim" style={{ marginTop: 4 }}>
            {axisMeta.long}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="range"
            min={0}
            max={Math.max(1, whylog.log.events.length - 1)}
            value={eventIndexOf(whylog.log.events, target)}
            onChange={(event) => {
              const index = Number(event.target.value);
              const chosen = whylog.log.events[index];
              if (chosen !== undefined) setAt(chosen.at);
            }}
            style={{ flex: 1, minWidth: 240 }}
            aria-label={`Replay position on the ${axisMeta.short} axis`}
          />

          <input
            type="date"
            value={target.slice(0, 10)}
            onChange={(event) => setAt(event.target.value)}
            style={{ fontSize: 12 }}
            aria-label="Jump to a date"
          />

          <button type="button" className="badge" onClick={() => setAt("")}>
            back to now
          </button>
        </div>

        <div className="mono faint" style={{ fontSize: 11, marginTop: 8 }}>
          {target.slice(0, 10)} on the <strong>{axisMeta.short}</strong> axis · range{" "}
          {range.earliest.slice(0, 10)} … {range.latest.slice(0, 10)} · {whylog.log.events.length}{" "}
          event(s)
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          The log at {target.slice(0, 10)} · {axisMeta.short}
        </h2>

        <div className="metric-grid">
          <Metric label="decisions visible" value={visible.decisions.length} />
          <Metric label="hidden (outside window)" value={visible.hiddenDecisions.length} />
          <Metric label="premises visible" value={visible.premises.length} />
          <Metric label="hidden premises" value={visible.hiddenPremises.length} />
        </div>

        {axis === "learned" ? (
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            This is a genuine prefix replay: {past.decisions.size} decision(s) exist because only
            the events recorded at or before this moment were folded. Anything learned later is not
            merely hidden — it does not exist yet on this axis.
          </div>
        ) : (
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            Valid time cannot be produced by a prefix fold: the events are stored in LEARNED order,
            so cutting by index would drop a decision made in January but recorded in October.
            Instead the current graph is filtered by validity window, which is the definition of
            "true at T".
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <PremiseLattice
            state={past}
            focus={visible.decisions}
            height={360}
            onSelect={(id: NodeId) => setSelected(id.startsWith("P-") ? null : (id as DecisionId))}
          />
        </div>
      </section>

      {selected !== null ? (
        <section className="card">
          <h2 className="card-title">At that moment</h2>
          <DecisionCard
            state={past}
            labels={pastLabels}
            decisionId={selected}
            entrenchment={entrenchmentOf(past, selected, Date.now(), guards.get(selected))}
          />
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">What changed between {target.slice(0, 10)} and now</h2>
        <pre
          className="mono dim"
          style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11.5, lineHeight: 1.6 }}
        >
          {describeDiff(diff)}
        </pre>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

/** The slider position for a timestamp. Events are in learned order, so this is a search for the last
 *  event at or before the target — not an exact lookup, because the target may be a date with no
 *  event on it. */
function eventIndexOf(events: readonly { at: string }[], target: string): number {
  let index = 0;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) continue;
    if (event.at <= target) index = i;
  }
  return index;
}
