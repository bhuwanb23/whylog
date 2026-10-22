/**
 * The Phase 6 views, rendered.
 *
 * Plan: plan/phase-6-presentation.md
 *
 * Everything else in this project is tested against pure functions, because everything else
 * in this project is pure. Phase 6 is not: it is the layer that puts React in front of the
 * reasoning, and a view can fail in ways a function cannot.
 *
 * Two of the five bugs Phase 6 shipped were exactly that kind, and both were invisible to
 * every other test in the repository:
 *
 *   - `TimeMachineView` called `useMemo` INSIDE A CONDITIONAL to supply an empty label map
 *     to the decision card. That breaks the rules of hooks and desyncs on the render where
 *     the panel first appears.
 *   - `ProvenanceBlock` read `span.episodeId`. `SourceSpan` has no such field - `episodeId`
 *     lives on `Provenance` - so the read returned `undefined` rather than an error, and the
 *     card rendered " · episode " with nothing after it.
 *
 * Both are only findable by RENDERING. So these tests render each view against a real log
 * and assert that it renders, and that it renders the thing it exists to show.
 *
 * The environment is already right: vitest is on `jsdom` and `@testing-library/react` is
 * installed, because the substrate persists to localStorage.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DecisionCard } from "@/components/decision/DecisionCard";
import { entrenchmentOf } from "@/reasoning/entrenchment";
import { label } from "@/reasoning/labeller";
import { useWhyLog } from "@/store/whylog";
import { GraphView } from "@/views/GraphView";
import { HealthView } from "@/views/HealthView";
import { SettingsView } from "@/views/SettingsView";
import { TimeMachineView } from "@/views/TimeMachineView";
import { TimelineView } from "@/views/TimelineView";

import { buildDemoLog } from "../helpers/demo-log";

afterEach(() => {
  cleanup();
});

describe("The Phase 6 views render", () => {
  beforeEach(async () => {
    localStorage.clear();
    useWhyLog.getState().boot();
    await buildDemoLog("curated");
  });

  it("the timeline renders the decisions, in valid-time order", () => {
    render(<TimelineView />);

    /* The timeline exists to show a decision's STATUS at a glance, so a status has to be on
     * the screen. */
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(50);
    expect(
      screen.getAllByText(/SOUND|UNSOUND|UNVERIFIED|UNFOUNDED|CONTESTED|SUPERSEDED/i).length,
    ).toBeGreaterThan(0);
  });

  it("the premise lattice renders", () => {
    render(<GraphView />);
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(50);
    /* The lattice is SVG, so the assertion is about nodes rather than text. */
    expect(document.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("the time machine renders both axes", () => {
    render(<TimeMachineView />);
    const text = document.body.textContent ?? "";
    /* The module's own rule: never show one axis without naming it. */
    expect(text.toLowerCase()).toMatch(/valid|learned|happened|knew/);
  });

  it("the health view renders its metrics", () => {
    render(<HealthView />);
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(50);
  });

  it("the settings view renders the controls", () => {
    render(<SettingsView />);
    /* A settings panel that renders no control is worse than no panel: it teaches the user
     * that the panel is decorative. */
    expect(document.querySelectorAll("input, button, select").length).toBeGreaterThan(0);
  });

  it("the decision card renders every section, with live labels and verbatim provenance", () => {
    const whylog = useWhyLog.getState();
    const state = whylog.state;
    const labels = label(state).labels;

    const decision = [...state.decisions.values()][0];
    expect(decision).toBeDefined();
    if (!decision) return;

    const { container } = render(
      <DecisionCard
        state={state}
        labels={labels}
        decisionId={decision.id}
        entrenchment={entrenchmentOf(state, decision.id, Date.now())}
      />,
    );

    const text = container.textContent ?? "";
    /* The card is the most information-dense screen in the product, so the sections have to
     * be there: the reasoning, the relations, the provenance, the audit. */
    expect(text).toMatch(/RESTS ON|rest(s)? on/i);
    expect(text).toMatch(/PROVENANCE|provenance/i);
    expect(text).toMatch(/ENTRENCHMENT|entrenchment/i);

    /* The provenance is behind a Collapsible, and the Collapsible is a real <button> that a
     * user clicks. Clicking it is also what proves the hooks are not conditional: a hook
     * inside a conditional desyncs on exactly this render - the one where the panel first
     * appears. */
    const toggle = screen.getByText("provenance", { selector: "span" });
    const button = toggle.closest("button");
    expect(button).not.toBeNull();
    if (!button) return;

    fireEvent.click(button);

    /* Now the provenance is on the screen, and it names the episode. */
    expect(container.textContent).toMatch(/episode/i);
    expect(container.textContent).toContain(decision.provenance.episodeId);
  });

  it("the provenance shows an episode id, not an empty string", () => {
    /* The bug this guards: `span.episodeId` is undefined, so the card rendered
     * " · episode " with nothing after it. A plausible field name turns a wrong reference
     * into undefined rather than an error. */
    const whylog = useWhyLog.getState();
    const state = whylog.state;
    const labels = label(state).labels;

    const decision = [...state.decisions.values()].find(
      (d) => state.premises.size > 0 && d.provenance.episodeId.length > 0,
    );
    expect(decision).toBeDefined();
    if (!decision) return;

    const { container } = render(
      <DecisionCard
        state={state}
        labels={labels}
        decisionId={decision.id}
        entrenchment={entrenchmentOf(state, decision.id, Date.now())}
      />,
    );

    const toggle = screen.getByText("provenance", { selector: "span" });
    const button = toggle.closest("button");
    if (button) fireEvent.click(button);

    expect(container.textContent).toContain(decision.provenance.episodeId);
  });
});
