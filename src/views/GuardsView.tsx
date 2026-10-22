/**
 * The Guards view — 4.7, and the surface for gate G4.
 *
 * Phase 4 · sub-phases 4.2–4.7
 * Plan: plan/phase-4-executable-guards.md
 *
 * ---------------------------------------------------------------------------
 * THE FIVE THINGS THIS VIEW HAS TO MAKE VISIBLE
 *
 *   1. what the guards were COMPILED FROM — the decision, its rejected alternatives and its
 *      globs. A guard whose origin you cannot see is a lint rule.
 *   2. that nothing runs until a human accepts it — the proposed list is the default state.
 *   3. WHY each guard is disabled or skipped, every time. A disabled guard with no explanation
 *      reads as a broken one, and a skip that looks like a pass is the failure mode that makes
 *      a compliance score meaningless.
 *   4. the five metrics together. Compliance without coverage is a number that flatters itself:
 *      a log with one passing guard scores 100%.
 *   5. the unverifiable decisions. Silence is never the answer — they are the ones most likely
 *      to drift, because nothing would tell you if they did.
 *
 * ---------------------------------------------------------------------------
 * COLOUR ENCODES EPISTEMIC STATUS, NEVER SEVERITY
 *
 * The house rule from Phase 0. A `blocking` failure is not redder than a `warning` one because
 * it is more important — it is marked differently because it fails the build. And an
 * unverifiable decision is not an error: it is an honest gap, rendered as a gap.
 *
 * ---------------------------------------------------------------------------
 * GATE G4 IS A BUTTON
 *
 * "Pasting a package.json containing `pg` drops compliance and fires a structural contradiction
 * with no model involved." That is checkable in one click here, and a gate the user has to
 * reconstruct from the plan is a gate that does not get run.
 * ---------------------------------------------------------------------------
 */

import {
  GUARDS_PER_DECISION_CAP,
  describeFeedbackLoop,
  describeReviewPolicy,
  describeTaxonomy,
  renderDashboard,
} from "@/guards";
import type { EvaluatedGuard } from "@/guards";
import { label } from "@/reasoning/labeller";
import { describeGuardStore, overCapDecisions, useGuards } from "@/store/guards";
import { useWhyLog } from "@/store/whylog";
import { LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import type { DecisionId, GuardId } from "@/types/common";
import type { GuardSeverity, GuardSpec } from "@/types/guards";
import { type ReactElement, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/* Gate G4                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The manifest G4 is defined by.
 *
 * It contains `pg` and `next` — one violating a DATABASE decision that rejected Postgres, one
 * violating a FRAMEWORK decision that chose Vite. Pasting it into a log holding the demo
 * fixture's decisions must drop compliance and fire a structural contradiction, with no model
 * involved at any point: the guard is a dependency lookup, the contradiction is an ontology
 * antonym check, and the proposal comes from the deterministic reasoning cycle.
 */
const G4_MANIFEST = `{
  "name": "whylog-demo",
  "version": "0.1.0",
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "pg": "^8.11.3",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "next": "^15.1.0",
    "vite": "^6.0.0",
    "typescript": "^5.6.0"
  }
}`;

const G4_LISTING = `src/db/schema.ts
src/db/client.ts
src/main.tsx
package.json
vite.config.ts
next.config.js`;

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function GuardsView(): ReactElement {
  const whylog = useWhyLog();
  const guards = useGuards();
  const [showReference, setShowReference] = useState(false);

  /* No `labels` binding here. Each row derives the label it needs from the labeller itself, so a
   * snapshot held at the top of the view could disagree with the one a row computes after a
   * mutation — two readings of one fact is how a stale label reaches the screen. */
  const decisionCount = whylog.state.decisions.size;
  const guardCount = whylog.state.guards.size;
  const over = useMemo(() => overCapDecisions(whylog.state), [whylog.state]);

  const busy = guards.status === "running" || guards.status === "synthesising";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">Executable decision guards</h2>

        <p className="dim" style={{ margin: "0 0 12px" }}>
          Every important architectural decision should have a corresponding fitness function — but
          in every workflow the literature surveys, a human writes the check by hand, because nobody
          has the decision in a structured enough form to generate from. Phase 1 produced that form,
          so the checks here are <strong>compiled from your decisions</strong>, not written for
          them. {decisionCount} decision(s), {guardCount} guard record(s).
        </p>

        {decisionCount === 0 ? (
          <div className="notice notice-info">
            The log is empty. Import a transcript on the Import &amp; review tab first — guards are
            compiled from decisions, so there is nothing to compile yet.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="badge"
            disabled={busy || decisionCount === 0}
            onClick={() => void guards.synthesise({ templatesOnly: true })}
          >
            {guards.status === "synthesising" ? "Compiling…" : "Synthesise guards (keyless)"}
          </button>

          <button type="button" className="badge" disabled={busy} onClick={() => void guards.run()}>
            {guards.status === "running" ? "Running…" : "Run accepted guards"}
          </button>

          <button
            type="button"
            className="badge"
            disabled={busy || guards.lastRunAt === null}
            onClick={() => guards.freeze()}
          >
            Freeze baseline
          </button>

          <button
            type="button"
            className="badge"
            style={{ marginLeft: "auto" }}
            onClick={() => setShowReference((previous) => !previous)}
          >
            {showReference ? "Hide reference" : "Reference"}
          </button>
        </div>

        {guards.error !== null ? (
          <div className="notice notice-warning" style={{ marginTop: 12 }}>
            {guards.error}
          </div>
        ) : null}

        {guards.lastRunSummary !== null ? (
          <div className="notice notice-info" style={{ marginTop: 12 }}>
            {guards.lastRunSummary}
          </div>
        ) : null}

        {over.length > 0 ? (
          <div className="notice notice-warning" style={{ marginTop: 12 }}>
            {over.length} decision(s) have more than the cap of {GUARDS_PER_DECISION_CAP} guards:{" "}
            {over.map((entry) => `${entry.decisionId} (+${entry.over})`).join(", ")}. The cap ranks
            by determinism, so the least trustworthy kinds are the ones to remove.
          </div>
        ) : null}
      </section>

      <GateG4Card />

      {guards.metricsResult !== null ? <DashboardCard /> : null}

      <RunResultsCard evaluated={guards.lastEvaluated} />

      <ProjectCard />

      <ReviewCard />

      <UnverifiableCard />

      <CiExportCard />

      {showReference ? <ReferenceCard /> : null}

      <section className="card">
        <h2 className="card-title">Store state</h2>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
          {describeGuardStore(guards)}
        </pre>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gate G4                                                                    */
/* -------------------------------------------------------------------------- */

function GateG4Card(): ReactElement {
  const guards = useGuards();
  const whylog = useWhyLog();
  const [done, setDone] = useState<string | null>(null);

  const runGate = async (): Promise<void> => {
    const steps: string[] = [];

    guards.loadProject({ manifest: G4_MANIFEST, listing: G4_LISTING });
    steps.push('1. Pasted a package.json containing "pg": "^8.11.3" and "next": "^15.1.0".');

    const synthesised = await guards.synthesise({ templatesOnly: true });
    steps.push(
      synthesised.ok
        ? `2. Compiled ${synthesised.value} guard(s) from the log's decisions — templates only, no model consulted.`
        : `2. Synthesis failed: ${synthesised.error}`,
    );

    /* Accept everything the templates produced, so the run has something to evaluate. In normal
     * use this is a human reading each one; the gate does it in bulk because the gate is testing
     * the LOOP, not the review. */
    const accepted = acceptAllProposed();
    steps.push(
      `3. Accepted ${accepted} proposed guard(s) in bulk — the gate tests the loop, not the review.`,
    );

    const ran = await guards.run();
    steps.push(
      ran.ok
        ? `4. Ran the guards. ${ran.value} failure(s) entered REVISE() as evidence, through the same entry point a transcript uses.`
        : `4. Run failed: ${ran.error}`,
    );

    steps.push(
      "5. Check below: compliance must have DROPPED, and the Reasoning tab must show a proposal whose evidence quotes the manifest line verbatim. No model was involved at any step — the guard is a dependency lookup, the contradiction is an ontology antonym check.",
    );

    steps.push(
      `Decisions in log: ${whylog.state.decisions.size}. Guards: ${whylog.state.guards.size}.`,
    );

    setDone(steps.join("\n"));
  };

  return (
    <section className="card">
      <h2 className="card-title">Gate G4 — it verifies</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        Pastes a <span className="mono">package.json</span> containing{" "}
        <span className="mono">pg</span>, compiles guards from the log's decisions, accepts them,
        and runs them. The gate passes if compliance drops <em>and</em> a structural contradiction
        fires — deterministically, with no model involved at any step.
      </p>

      <button
        type="button"
        className="badge"
        disabled={guards.status === "running" || guards.status === "synthesising"}
        onClick={() => void runGate()}
      >
        Run gate G4
      </button>

      {done !== null ? (
        <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 11 }}>
          {done}
        </pre>
      ) : null}
    </section>
  );
}

/** Accept every proposed guard. Lives here rather than in the store because bulk-accepting is a
 *  gate-running convenience, not a product action: in normal use each guard is read first, and
 *  offering a bulk button in the review list would undermine the one rule that keeps a
 *  synthesised guard from failing on day one. */
function acceptAllProposed(): number {
  const whylog = useWhyLog.getState();
  const guards = useGuards.getState();
  let count = 0;

  for (const guard of whylog.state.guards.values()) {
    if (guard.lifecycle !== "proposed") continue;
    if (guards.accept(guard.id).ok) count += 1;
  }

  return count;
}

/* -------------------------------------------------------------------------- */
/* The dashboard                                                              */
/* -------------------------------------------------------------------------- */

function DashboardCard(): ReactElement {
  const guards = useGuards();
  const result = guards.metricsResult;

  if (result === null) return <span />;

  return (
    <section className="card">
      <h2 className="card-title">Compliance dashboard</h2>

      <pre
        className="mono"
        style={{ whiteSpace: "pre-wrap", margin: "0 0 12px", fontSize: 12, lineHeight: 1.7 }}
      >
        {renderDashboard(result)}
      </pre>

      <div className="notice notice-info" style={{ fontSize: 12 }}>
        Compliance is computed over <strong>deterministic guards only</strong>. A judged verdict
        cannot reach the quotient, because a score that moved when the model changed would not be a
        measurement of the codebase. Compliance and coverage are never shown apart: a log with one
        passing guard scores 100% compliance, so the headline number flatters itself without the
        denominator beside it.
      </div>

      {result.compliance.baselinedOnly.length > 0 ? (
        <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
          {result.compliance.baselinedOnly.length} decision(s) fail only on violations the baseline
          already knew about:{" "}
          <span className="mono">{result.compliance.baselinedOnly.join(", ")}</span>. These are
          recorded and listed, but they are not drift, and they do not fire revision proposals —
          firing one for a violation that predates the guard would fill the queue with things you
          already know about.
        </div>
      ) : null}

      {result.drift.worst !== null ? (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <strong>Drift age:</strong> {result.drift.worstDays} day(s) on{" "}
          <span className="mono">{result.drift.worst.decisionId}</span>. A failure ignored for 30
          days is a decision you no longer hold — either reverse it in the log or fix the code.
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Run results                                                                */
/* -------------------------------------------------------------------------- */

function RunResultsCard({ evaluated }: { evaluated: readonly EvaluatedGuard[] }): ReactElement {
  const [showPassing, setShowPassing] = useState(false);

  if (evaluated.length === 0) return <span />;

  const failures = evaluated.filter((entry) => entry.result.outcome === "fail");
  const skips = evaluated.filter((entry) => entry.skipped);
  const passes = evaluated.filter((entry) => entry.result.outcome === "pass");

  return (
    <section className="card">
      <h2 className="card-title">
        Last run · {failures.length} failing · {skips.length} skipped · {passes.length} passing
      </h2>

      {failures.length === 0 && skips.length === 0 ? (
        <div className="notice notice-info">
          Every accepted guard passed. The code still does what the log says it does.
        </div>
      ) : null}

      {failures.map((entry) => (
        <FailureRow key={entry.guard.id} entry={entry} />
      ))}

      {skips.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>
            SKIPPED — a skip is never a pass. Each says what data was missing.
          </div>
          {skips.map((entry) => (
            <div key={entry.guard.id} className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
              <span className="mono">{entry.guard.id}</span> ({entry.guard.spec.kind}) —{" "}
              {entry.skipReason}
            </div>
          ))}
        </div>
      ) : null}

      {passes.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="badge"
            onClick={() => setShowPassing((previous) => !previous)}
          >
            {showPassing ? "Hide" : "Show"} {passes.length} passing
          </button>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
            Passing guards collapse into a count by default (§4.7): a list of green checks is noise
            that hides the one red line.
          </div>

          {showPassing ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {passes.map((entry) => (
                <li key={entry.guard.id} className="dim" style={{ fontSize: 12 }}>
                  <span className="mono">{entry.guard.id}</span> ({entry.guard.spec.kind}) —{" "}
                  {entry.result.evidence}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The failure message is the product.
 *
 * It does the job of an ADR, a code-review comment and an onboarding document, at the exact
 * moment it is useful — the moment someone has just installed the thing you turned down six
 * weeks ago and has no idea you turned it down.
 */
function FailureRow({ entry }: { entry: EvaluatedGuard }): ReactElement {
  const guards = useGuards();
  const whylog = useWhyLog();
  const [reason, setReason] = useState("");

  const decision = whylog.state.decisions.get(entry.guard.decisionId);
  const labels = useMemo(() => label(whylog.state).labels, [whylog.state]);

  const premises: { id: string; text: string; label: string }[] = [];
  if (decision !== undefined) {
    for (const justificationId of decision.justificationIds) {
      const justification = whylog.state.justifications.get(justificationId);
      if (justification === undefined) continue;
      for (const premiseId of justification.inList) {
        const premise = whylog.state.premises.get(premiseId);
        if (premise === undefined) continue;
        premises.push({
          id: premiseId,
          text: premise.text,
          label: labels.get(premiseId)?.label ?? premise.label,
        });
      }
    }
  }

  const rejected: { value: string; whyRejected?: string }[] = [];
  if (decision !== undefined) {
    for (const alternativeId of decision.alternativeIds) {
      const alternative = whylog.state.alternatives.get(alternativeId);
      if (alternative === undefined) continue;
      rejected.push(
        alternative.whyRejected === undefined
          ? { value: alternative.value }
          : { value: alternative.value, whyRejected: alternative.whyRejected },
      );
    }
  }

  return (
    <div
      style={{
        borderLeft: `3px solid ${entry.guard.severity === "blocking" ? "var(--label-out)" : "var(--label-unknown)"}`,
        padding: "10px 12px",
        marginBottom: 10,
        background: `color-mix(in srgb, ${entry.guard.severity === "blocking" ? "var(--label-out)" : "var(--label-unknown)"} 7%, transparent)`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        ✗ {entry.guard.decisionId} — {decision?.statement ?? "(decision not in log)"}
      </div>

      <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
        Guard {entry.guard.id} ({entry.guard.spec.kind}) FAILED · {entry.guard.severity}
        {entry.newViolation ? "" : " · BASELINED (not new drift)"}
      </div>

      <div style={{ fontSize: 12, marginTop: 6 }}>
        <strong>Evidence:</strong> <span className="mono">{entry.result.evidence}</span>
      </div>

      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        <strong>Why this check verifies that decision:</strong> {entry.guard.rationale}
      </div>

      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        Decided: {decision?.temporal.valid.slice(0, 10) ?? "unknown"} · Rests on:{" "}
        {premises.length === 0
          ? "nothing recorded — so nothing can falsify it, which is a gap worth filling"
          : premises.map((p) => `${p.id} ${p.text} (${p.label})`).join(", ")}
      </div>

      {rejected.map((alt) => (
        <div className="dim" key={alt.value} style={{ fontSize: 12, marginTop: 2 }}>
          Rejected alternative {alt.value}
          {alt.whyRejected === undefined
            ? " — no reason recorded"
            : ` — reason: "${alt.whyRejected}"`}
        </div>
      ))}

      <div style={{ marginTop: 10, fontSize: 12 }}>
        <div>→ Is this a deliberate reversal? Record it, so the log stops claiming otherwise.</div>
        <div>→ Or is this drift? Undo the change, or suppress this guard with a reason.</div>
      </div>

      <div
        style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <button
          type="button"
          className="badge"
          onClick={() => {
            const outcome = guards.suppress(entry.guard.id, reason);
            if (!outcome.ok) setReason("");
          }}
        >
          Suppress
        </button>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="reason (required — silencing a failing check needs a justification)"
          style={{ flex: 1, minWidth: 220, fontSize: 12 }}
        />
        <button
          type="button"
          className="badge"
          onClick={() => guards.removeFromBaseline(entry.guard.id)}
        >
          Remove from baseline
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The virtual project                                                        */
/* -------------------------------------------------------------------------- */

function ProjectCard(): ReactElement {
  const guards = useGuards();
  const [manifest, setManifest] = useState("");
  const [listing, setListing] = useState("");
  const [contents, setContents] = useState("");

  const apply = (): void => {
    guards.loadProject({
      ...(manifest.trim().length === 0 ? {} : { manifest }),
      ...(listing.trim().length === 0 ? {} : { listing }),
      ...(contents.trim().length === 0 ? {} : { contents }),
    });
  };

  return (
    <section className="card">
      <h2 className="card-title">The virtual project</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        Guards have to run somewhere, and there is no shell or filesystem here. Paste what your
        project looks like and the six deterministic kinds evaluate against it in memory — real
        logic, real data, no network. This is the designed default, not a compromise: the only thing
        missing is automatic file discovery, which is a repo-connection concern.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field
          title="package.json — or just its dependencies"
          hint="Enables dependency_present / dependency_absent, the two most reliable kinds."
          value={manifest}
          onChange={setManifest}
          rows={6}
        />
        <Field
          title="File listing — `git ls-files`, `find . -type f` or `tree`"
          hint="Enables the path guards. Without it they SKIP rather than pass: absence of evidence is not evidence of absence."
          value={listing}
          onChange={setListing}
          rows={5}
        />
        <Field
          title="File contents (optional)"
          hint={
            "Separate files with a header line like `--- src/db/schema.ts ---`. Enables the string guards."
          }
          value={contents}
          onChange={setContents}
          rows={5}
        />
      </div>

      <button type="button" className="badge" style={{ marginTop: 10 }} onClick={apply}>
        Load project
      </button>

      {guards.parse !== null ? (
        <div style={{ marginTop: 12 }}>
          <div className="metric-grid">
            <Metric label="dependencies" value={guards.parse.dependenciesParsed} />
            <Metric label="dev deps" value={guards.parse.devDependenciesParsed} />
            <Metric label="files" value={guards.parse.filesParsed} />
            <Metric label="with contents" value={guards.parse.contentsParsed} />
          </div>

          {guards.parse.notices.map((notice) => (
            <div key={notice} className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              · {notice}
            </div>
          ))}

          {guards.parse.unparsed.length > 0 ? (
            <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
              {guards.parse.unparsed.length} line(s) could not be interpreted and were KEPT rather
              than dropped — a parse that silently ignores a line produces a project missing a file,
              and a missing file makes a path guard fail for a reason that has nothing to do with
              the codebase.
              <pre
                className="mono"
                style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 11 }}
              >
                {guards.parse.unparsed.slice(0, 8).join("\n")}
                {guards.parse.unparsed.length > 8
                  ? `\n… ${guards.parse.unparsed.length - 8} more`
                  : ""}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The prop is `title`, not `label`: this file imports `label` from the labeller, and shadowing
 *  it inside a component would make `{label(...)}` mean something different two lines apart. */
function Field({
  title,
  hint,
  value,
  onChange,
  rows,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  rows: number;
}): ReactElement {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11, marginBottom: 3 }}>
        {title}
      </div>
      <textarea
        className="mono"
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: "100%", fontSize: 11, resize: "vertical" }}
      />
      <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>
        {hint}
      </div>
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

/* -------------------------------------------------------------------------- */
/* Review                                                                     */
/* -------------------------------------------------------------------------- */

/** Takes no labels prop: each row derives the label it needs from the labeller itself, so a
 *  snapshot passed down from the parent could disagree with the one the row computes after a
 *  mutation. Two readings of one fact is how a stale label reaches the screen. */
function ReviewCard(): ReactElement {
  const whylog = useWhyLog();
  const _guards = useGuards();

  const decisions = [...whylog.state.decisions.values()].filter(
    (decision) => decision.status !== "superseded" && decision.status !== "archived",
  );

  return (
    <section className="card">
      <h2 className="card-title">Guard review</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        No guard runs until it is accepted. A synthesised guard that fails on day one is worse than
        no guard, because it teaches you to ignore the panel — and a panel that gets ignored stops
        being verification.
      </p>

      {decisions.length === 0 ? (
        <div className="faint" style={{ fontSize: 12 }}>
          No decisions yet.
        </div>
      ) : null}

      {decisions.map((decision) => (
        <DecisionGuardRow key={decision.id} decisionId={decision.id} />
      ))}

      <pre
        className="mono dim"
        style={{ whiteSpace: "pre-wrap", margin: "12px 0 0", fontSize: 11 }}
      >
        {describeReviewPolicy()}
      </pre>
    </section>
  );
}

function DecisionGuardRow({ decisionId }: { decisionId: DecisionId }): ReactElement {
  const whylog = useWhyLog();
  const guards = useGuards();
  const [editing, setEditing] = useState<GuardId | null>(null);

  const group = guards.groupFor(decisionId);
  const decision = whylog.state.decisions.get(decisionId);
  const decisionLabel =
    label(whylog.state).labels.get(decisionId)?.label ?? decision?.label ?? "UNKNOWN";

  if (group.guards.length === 0) return <span />;

  return (
    <div style={{ borderTop: "1px solid var(--edge-soft, #333)", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          className="badge"
          title={LABEL_MEANING[decisionLabel as keyof typeof LABEL_MEANING] ?? ""}
          style={{ color: LABEL_COLOUR[decisionLabel as keyof typeof LABEL_COLOUR] ?? "inherit" }}
        >
          {decisionLabel}
        </span>
        <span className="mono" style={{ fontSize: 12 }}>
          {decisionId}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{decision?.statement}</span>
        <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>
          {group.proposed.length} proposed · {group.accepted.length} accepted ·{" "}
          {group.suppressed.length} suppressed
        </span>
      </div>

      {group.disabledByLabel ? (
        <div className="notice notice-warning" style={{ marginTop: 8, fontSize: 12 }}>
          This decision is not labelled IN, so its guards are disabled and will not run. Guards
          inherit their decision's label: a reversed or unsupported decision must stop nagging. They
          re-enable automatically if the decision returns to IN.
        </div>
      ) : null}

      {group.guards.map((guard) => {
        const disabled = guards.disabledReason(guard.id);

        return (
          <div
            key={guard.id}
            style={{
              marginTop: 8,
              paddingLeft: 10,
              borderLeft: "2px solid var(--edge-soft, #444)",
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 11 }}>
                {guard.id}
              </span>
              <span className="badge">{guard.spec.kind}</span>
              <span
                className="badge"
                style={{
                  color:
                    guard.severity === "blocking" ? "var(--label-out)" : "var(--label-unknown)",
                }}
              >
                {guard.severity}
              </span>
              <span className="badge">{guard.lifecycle}</span>
              <span className="faint" style={{ fontSize: 11 }}>
                by {guard.generatedBy}
              </span>
              {guard.lastRun !== undefined ? (
                <span className="faint mono" style={{ fontSize: 11 }}>
                  last run: {guard.lastRun.outcome}
                </span>
              ) : null}
            </div>

            <div className="mono" style={{ fontSize: 11, marginTop: 3 }}>
              {describeSpec(guard.spec)}
            </div>

            <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>
              {guard.rationale}
            </div>

            {disabled !== null ? (
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                ⏸ {disabled}
              </div>
            ) : null}

            {guard.suppressionReason !== undefined ? (
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                Suppressed: {guard.suppressionReason}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {guard.lifecycle === "proposed" ? (
                <button type="button" className="badge" onClick={() => guards.accept(guard.id)}>
                  Accept
                </button>
              ) : null}

              {guard.lifecycle !== "deleted" ? (
                <>
                  <button type="button" className="badge" onClick={() => setEditing(guard.id)}>
                    {editing === guard.id ? "Close editor" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="badge"
                    onClick={() => guards.remove(guard.id, "")}
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>

            {editing === guard.id ? (
              <EditForm
                guardId={guard.id}
                spec={guard.spec}
                rationale={guard.rationale}
                severity={guard.severity}
                onDone={() => setEditing(null)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EditForm({
  guardId,
  spec,
  rationale,
  severity,
  onDone,
}: {
  guardId: GuardId;
  spec: GuardSpec;
  rationale: string;
  severity: GuardSeverity;
  onDone: () => void;
}): ReactElement {
  const guards = useGuards();
  const [text, setText] = useState(specToJson(spec));
  const [why, setWhy] = useState(rationale);
  const [level, setLevel] = useState<GuardSeverity>(severity);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("That is not valid JSON.");
      return;
    }

    if (parsed === null || typeof parsed !== "object") {
      setError("The spec must be a JSON object.");
      return;
    }

    const candidate = parsed as GuardSpec;
    if (typeof candidate.kind !== "string") {
      setError('The spec needs a "kind" — one of the eight in the taxonomy.');
      return;
    }

    const outcome = guards.edit(guardId, candidate, why, level);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setError(null);
    onDone();
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div className="notice notice-warning" style={{ fontSize: 11 }}>
        Editing is <strong>delete + re-synthesise</strong>, recorded as two events. The closed
        vocabulary has no edit event, and adding one would let a spec change without a record of the
        spec it replaced — a guard quietly weakened after it started failing would be
        indistinguishable from one that was fixed. The replacement is PROPOSED again: an edit does
        not inherit acceptance, because that would activate a check nobody reviewed.
      </div>

      <textarea
        className="mono"
        value={text}
        rows={5}
        onChange={(event) => setText(event.target.value)}
        style={{ width: "100%", fontSize: 11, marginTop: 8 }}
      />

      <input
        value={why}
        onChange={(event) => setWhy(event.target.value)}
        placeholder="rationale — mandatory; a guard without one is indistinguishable from a lint rule"
        style={{ width: "100%", fontSize: 12, marginTop: 6 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value as GuardSeverity)}
          style={{ fontSize: 12 }}
        >
          <option value="blocking">blocking — fails the build</option>
          <option value="warning">warning — advisory</option>
        </select>

        <button type="button" className="badge" onClick={save}>
          Save as new guard
        </button>
      </div>

      {error !== null ? (
        <div className="notice notice-error" style={{ marginTop: 6, fontSize: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function specToJson(spec: GuardSpec): string {
  return JSON.stringify(spec, null, 2);
}

function describeSpec(spec: GuardSpec): string {
  switch (spec.kind) {
    case "dependency_present":
    case "dependency_absent":
      return spec.package + (spec.includeDev === true ? " (including devDependencies)" : "");
    case "path_glob_exists":
    case "path_glob_absent":
      return spec.glob;
    case "string_in_files":
    case "string_absent_in_files":
      return `${JSON.stringify(spec.pattern)} within ${spec.glob}${spec.wordBoundary === false ? ", no word boundary" : ", word-boundary matched"}`;
    case "command_exit_zero":
      return spec.command;
    case "llm_judge":
      return `rubric over ${spec.scopeGlobs.join(", ")}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Unverifiable                                                               */
/* -------------------------------------------------------------------------- */

function UnverifiableCard(): ReactElement {
  const guards = useGuards();

  if (guards.unverifiable.length === 0) return <span />;

  return (
    <section className="card">
      <h2 className="card-title">Unverifiable · {guards.unverifiable.length} decision(s)</h2>

      <div className="notice notice-warning" style={{ fontSize: 12 }}>
        No guard could be compiled for these. They are SHOWN, never silently skipped: the
        literature's own test is whether you can describe what a violation looks like, and for these
        you cannot yet. Unverifiable decisions are exactly the ones most likely to drift, because
        nothing would tell you if they did — and a compliance score computed only over the decisions
        that happened to be checkable is a score that flatters itself.
      </div>

      <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        {guards.unverifiable.map((entry) => (
          <li key={entry.decisionId} style={{ fontSize: 12, marginBottom: 6 }}>
            <span className="mono">{entry.decisionId}</span> — {entry.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* CI export                                                                  */
/* -------------------------------------------------------------------------- */

function CiExportCard(): ReactElement {
  const guards = useGuards();
  const [output, setOutput] = useState<{
    runner: string;
    workflow: string;
    summary: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<"runner" | "workflow">("runner");

  const generate = (): void => {
    const result = guards.exportForCi();
    if (!result.ok) {
      setError(result.error);
      setOutput(null);
      return;
    }
    setError(null);
    setOutput(result.value);
  };

  const download = (): void => {
    if (output === null) return;

    const name = which === "runner" ? "guards.cjs" : "decision-guards.yml";
    const text = which === "runner" ? output.runner : output.workflow;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card">
      <h2 className="card-title">CI export</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        A standalone Node runner (standard library only — no install step) and a GitHub Actions
        workflow. The exported runner evaluates the same six predicates as the interpreter here, and
        the guard set is serialised as data rather than regenerated, so the two cannot drift apart
        by having been written twice.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="badge" onClick={generate}>
          Generate
        </button>

        {output !== null ? (
          <>
            <button type="button" className="badge" onClick={() => setWhich("runner")}>
              {which === "runner" ? "• guards.cjs" : "guards.cjs"}
            </button>
            <button type="button" className="badge" onClick={() => setWhich("workflow")}>
              {which === "workflow" ? "• decision-guards.yml" : "decision-guards.yml"}
            </button>
            <button type="button" className="badge" onClick={download}>
              Download
            </button>
          </>
        ) : null}
      </div>

      {error !== null ? (
        <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      {output !== null ? (
        <>
          <pre
            className="mono dim"
            style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 11 }}
          >
            {output.summary}
          </pre>
          <pre
            className="mono"
            style={{
              whiteSpace: "pre-wrap",
              margin: "10px 0 0",
              fontSize: 10,
              maxHeight: 320,
              overflow: "auto",
              borderTop: "1px solid var(--edge-soft, #333)",
              paddingTop: 8,
            }}
          >
            {which === "runner" ? output.runner : output.workflow}
          </pre>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference                                                                  */
/* -------------------------------------------------------------------------- */

function ReferenceCard(): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">Reference</h2>

      <Block title="The eight guard kinds" body={describeTaxonomy()} />
      <Block title="Guards as evidence — the feedback loop" body={describeFeedbackLoop()} />
      <Block title="Review policy" body={describeReviewPolicy()} />
    </section>
  );
}

function Block({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>{title}</h3>
      <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
        {body}
      </pre>
    </div>
  );
}
