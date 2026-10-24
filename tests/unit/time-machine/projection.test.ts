/**
 * The time machine — 6.7.
 *
 * Plan: plan/phase-6-presentation.md §6.7
 *
 * "Two sliders, because two timelines, and they diverge constantly."
 *
 *   valid time    "what was true then"     -> filter by the validity window over a full fold
 *   learned time  "what did we know then"  -> fold only the events with `at <= T`
 *
 * The plan's risk is "time machine confuses two timelines", and the mitigation is to label
 * them explicitly and never show one without naming it. STRUCTURE.md §18.6 records the
 * deviation that makes this testable rather than decorative:
 *
 *   "Learned time is a genuine prefix fold via materializeAsOf. Valid time CANNOT be a prefix
 *    fold - events are stored in learned order, so cutting by index would drop a decision
 *    made in January but recorded in October. Valid time filters the current graph by
 *    validity window instead, which is the definition of 'true at T'. Presenting both as the
 *    same mechanism would be wrong about one of them."
 *
 * These tests need a log whose two timelines ACTUALLY DIVERGE, and the demo fixture is
 * exactly that: a transcript from Oct 3, imported and learned today. So the demo decision
 * is VALID from Oct 3 and LEARNED today, and the two sliders answer different questions
 * about it.
 *
 * (That divergence only exists because `recordBatch` forwards the valid time. It used to
 * drop it, which silently made every event claim it happened at the moment it was learned
 * — and made the two axes permanently identical. See src/store/whylog.ts.)
 */

import { describe, expect, it } from "vitest";

import {
  AXIS_LABEL,
  diffGraphs,
  graphAt,
  timeRange,
  visibleAt,
} from "@/components/time-machine/projection";
import { label } from "@/reasoning/labeller";
import { useWhyLog } from "@/store/whylog";

import { buildDemoLog } from "../../helpers/demo-log";

const ENGINE_ID = { kind: "local", model: "cue-extractor-v1" } as const;

describe("The time machine", () => {
  it("names both axes, because showing one without naming it is the confusion the plan warns about", () => {
    expect(AXIS_LABEL.valid.short).toMatch(/true|valid|happened/i);
    expect(AXIS_LABEL.learned.short).toMatch(/knew|learned/i);
    expect(AXIS_LABEL.valid.question).not.toBe(AXIS_LABEL.learned.question);
    /* Both are explained, because a slider whose meaning is only in a tooltip is a slider
     * the user has to guess at. */
    expect(AXIS_LABEL.valid.long.length).toBeGreaterThan(40);
    expect(AXIS_LABEL.learned.long.length).toBeGreaterThan(40);
  });

  it("the demo log's two timelines genuinely diverge", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);

    /* The transcript is from Oct 3; it was learned today. So the range spans both. */
    expect(range.earliest < range.latest).toBe(true);

    const decision = [...whylog.state.decisions.values()][0];
    expect(decision?.temporal.valid).not.toBe(decision?.temporal.learned);
  });

  it("the LEARNED axis is a genuine prefix fold: earlier means fewer events known", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);

    const early = graphAt(
      whylog.log.events,
      whylog.state,
      range.earliest as never,
      "learned",
      ENGINE_ID,
    );
    const late = graphAt(
      whylog.log.events,
      whylog.state,
      range.latest as never,
      "learned",
      ENGINE_ID,
    );

    /* A prefix fold: the earlier graph is a SUBSET of the later one. Never larger. */
    expect(early.decisions.size).toBeLessThan(late.decisions.size);
    for (const id of early.decisions.keys()) {
      expect(late.decisions.has(id)).toBe(true);
    }
  });

  it("the VALID axis shows the decision even before the system had heard of it", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);

    const at = range.earliest as never;
    const valid = graphAt(whylog.log.events, whylog.state, at, "valid", ENGINE_ID);
    const learned = graphAt(whylog.log.events, whylog.state, at, "learned", ENGINE_ID);

    /* This is the divergence the module exists for. On Oct 3 the decision was TRUE - the
     * person had made it - but the system had not learned of it yet. So the valid axis
     * shows it and the learned axis does not. */
    expect(valid.decisions.size).toBeGreaterThan(0);
    expect(learned.decisions.size).toBe(0);
  });

  it("visibleAt says what it hid, and why that matters", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);

    const visible = visibleAt(whylog.state, range.latest as never, "valid");

    /* Everything is accounted for: shown or hidden, never quietly dropped. A view that
     * silently omits a decision looks like a view that has no such decision. */
    expect(visible.decisions.length + visible.hiddenDecisions.length).toBe(
      whylog.state.decisions.size,
    );
    expect(visible.premises.length + visible.hiddenPremises.length).toBe(
      whylog.state.premises.size,
    );
  });

  it("the diff strip says which axis it measured along", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);
    const at = range.latest as never;

    const diff = diffGraphs(
      graphAt(whylog.log.events, whylog.state, at, "valid", ENGINE_ID),
      whylog.state,
      "valid",
      at,
      at,
    );

    expect(diff.axis).toBe("valid");
    expect(diff.from).toBe(at);
    expect(diff.to).toBe(at);
  });

  it("the diff strip reports a real change when the graph really changed", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const range = timeRange(whylog.log.events, whylog.state);
    const at = range.latest as never;

    /* Same graph on both sides: nothing to report. A diff strip that always has entries is
     * a diff strip that is not measuring anything. */
    const same = diffGraphs(whylog.state, whylog.state, "valid", at, at);
    expect(same.entries).toHaveLength(0);

    /* The current graph against a fold of nothing: the decisions must show up. */
    const early = graphAt(
      whylog.log.events,
      whylog.state,
      range.earliest as never,
      "learned",
      ENGINE_ID,
    );
    const changed = diffGraphs(early, whylog.state, "learned", range.earliest as never, at);
    expect(changed.entries.length).toBeGreaterThan(0);
  });

  it("labels the current graph with the labeller, not with the labels stored at extraction", async () => {
    await buildDemoLog("curated");
    const whylog = useWhyLog.getState();
    const labels = label(whylog.state).labels;

    /* Every decision the labeller has a view on must be present in its map. A stale label
     * is the failure mode the card and the lattice both guard against, and the time machine
     * is a third place it would show. */
    for (const id of whylog.state.decisions.keys()) {
      expect(labels.has(id)).toBe(true);
    }
  });
});
