/**
 * The Export view — Phase 5, and the surface for gate G5.
 *
 * Plan: plan/phase-5-export-compiler.md
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS VIEW HAS TO MAKE VISIBLE
 *
 *   the budget, live          line count against the ~200-line target, and what fell to tier 2.
 *                             A budget the user cannot see is a budget they cannot plan against.
 *   the six properties        checked against a REAL emitted record, not asserted in prose. The
 *                             acceptance criterion is that every record has all six, so the view
 *                             shows one record and ticks them off.
 *   a blocked export          which two decisions conflict, and what to do. Never just "failed".
 *   what was excluded         and why. An export that silently omits half the log is
 *                             indistinguishable from one that omitted nothing.
 *   the stamp                 with the sentence that says it is auditability, not security.
 *
 * ---------------------------------------------------------------------------
 * G5 IS CHECKED MECHANICALLY, NOT BY EYE
 *
 * The gate says the generated CLAUDE.md must show a decision with MUST/MUST NOT, `applies_to`,
 * rejected alternatives, a runnable verify command, status, and a stamp. Every one of those is a
 * string predicate over the compiled artifact, so `checkGateG5` runs them and reports which
 * passed. A gate the user has to verify by reading a file is a gate that gets skipped under time
 * pressure; a gate that prints six ticks or names the one that failed does not.
 * ---------------------------------------------------------------------------
 */

import { TARGET_AUDIENCE, checkSixProperties, describeGate, describeVerifyPolicy } from "@/export";
import {
  describeExportState,
  describeSelectedBudget,
  describeStamp,
  selectedArtifact,
  useExport,
} from "@/store/export";
import { useWhyLog } from "@/store/whylog";
import type { ExportTarget } from "@/types/export";
import { EXPORT_TARGETS, TARGET_FILENAMES } from "@/types/export";
import { type ReactElement, useState } from "react";

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function ExportView(): ReactElement {
  const whylog = useWhyLog();
  const store = useExport();
  const [showReference, setShowReference] = useState(false);

  const busy = store.status === "compiling";
  const decisionCount = whylog.state.decisions.size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">Agent-native export</h2>

        <p className="dim" style={{ margin: "0 0 12px" }}>
          Compile the decision graph into every format an agent actually reads — scoped, imperative,
          addressable, <strong>verifiable</strong>, non-conflicting and token-budgeted. Multi-format
          export is not the claim; <code>ai-memory</code> ships it and <code>AGENTS.md</code> is in
          60,000+ projects. The three things that are: verify commands compiled from the Phase 4
          guards, a gate that refuses to export a self-contradictory log, and the
          rejected-alternatives block with each reason's premise status attached.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="badge"
            disabled={busy || decisionCount === 0}
            onClick={() => void store.compileAll()}
          >
            {busy ? "Compiling…" : "Compile all targets"}
          </button>

          <span className="faint" style={{ fontSize: 11 }}>
            {decisionCount} decision(s) · head {whylog.log.headHash.slice(0, 12) || "(empty log)"}
          </span>

          <button
            type="button"
            className="badge"
            style={{ marginLeft: "auto" }}
            onClick={() => setShowReference((previous) => !previous)}
          >
            {showReference ? "Hide reference" : "Reference"}
          </button>
        </div>

        {store.error !== null ? (
          <div className="notice notice-warning" style={{ marginTop: 12 }}>
            {store.error}
          </div>
        ) : null}
      </section>

      <GateG5Card />

      {store.blocked && store.blockedExplanation !== null ? (
        <section className="card">
          <h2 className="card-title" style={{ color: "var(--label-out)" }}>
            Export blocked by the consistency gate
          </h2>
          <pre
            className="mono"
            style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12, lineHeight: 1.6 }}
          >
            {store.blockedExplanation}
          </pre>
        </section>
      ) : null}

      {store.result !== null && !store.blocked ? (
        <>
          <OptionsCard />
          <BudgetCard />
          <ArtifactCard />
          <SixPropertiesCard />
        </>
      ) : null}

      <VerifyCard />
      <RoundTripCard />

      {showReference ? <ReferenceCard /> : null}

      <section className="card">
        <h2 className="card-title">Compiler</h2>
        <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
          {describeExportState(store)}
        </pre>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gate G5 — checked, not eyeballed                                           */
/* -------------------------------------------------------------------------- */

interface GateCheck {
  readonly property: string;
  readonly passed: boolean;
  readonly evidence: string;
}

/**
 * Does the compiled CLAUDE.md satisfy gate G5?
 *
 * Every clause of the gate is a predicate over the artifact text. Running them is what makes the
 * gate a gate rather than a description of one.
 */
function checkGateG5(contents: string | null): readonly GateCheck[] {
  if (contents === null) {
    return [
      { property: "artifact exists", passed: false, evidence: "Nothing has been compiled yet." },
    ];
  }

  /* Take the first `### WLD-…` block, which is the highest-priority decision by construction. */
  const start = contents.indexOf("\n### ");
  const end = contents.indexOf("\n### ", start + 1);
  const block = start < 0 ? "" : contents.slice(start, end < 0 ? contents.length : end);

  const recordId = /^###\s+((?:WLD|ADR)-[0-9A-Za-z-]+)/.exec(block.trim())?.[1] ?? null;

  return [
    {
      property: "a decision record is present",
      passed: recordId !== null,
      evidence:
        recordId === null
          ? "No `### WLD-…` block found in the artifact."
          : recordId + " is the highest-priority record and is checked below.",
    },
    {
      property: "MUST / MUST NOT imperative form",
      passed: /\bMUST NOT\b/.test(block) || /\bMUST\b/.test(block),
      evidence:
        firstMatch(block, /\bMUST(?: NOT)?\b[^.\n]*\.?/) ??
        "no normative keyword found — the record is prose, which an agent has to summarise before it can follow it",
    },
    {
      property: "applies_to scope",
      passed: /^Applies to:\s*\S/m.test(block),
      evidence:
        firstMatch(block, /^Applies to:.*$/m) ??
        "no scope line — the rule would load into every context",
    },
    {
      property: "Because: with premise IDs",
      passed: /^Because:.*\bP-[0-9]/m.test(block),
      evidence:
        firstMatch(block, /^Because:.*$/m) ??
        "no premise IDs — a reader cannot see what would have to change for the rule to stop applying",
    },
    {
      property: "rejected alternatives",
      passed: /^Rejected:/m.test(block) || /## Rejected — do not re-propose/.test(contents),
      evidence:
        firstMatch(block, /^Rejected:.*$/m) ??
        (contents.includes("## Rejected — do not re-propose")
          ? "present as a top-level section rather than on this record"
          : "nothing rejected is recorded, so an agent is free to re-propose what was already turned down"),
    },
    {
      property: "a runnable verify command",
      passed: /^Verify:\s*(?!none)/m.test(block),
      evidence:
        firstMatch(block, /^Verify:.*$/m) ??
        "no verify line — the requirement no ADR tool satisfies automatically",
    },
    {
      property: "status line",
      passed: /^Status:/m.test(block),
      evidence: firstMatch(block, /^Status:.*$/m) ?? "no status line",
    },
    {
      property: "integrity stamp",
      passed: contents.includes("<!-- whylog:stamp"),
      evidence: contents.includes("<!-- whylog:stamp")
        ? "present, with the log head and the content digest"
        : "MISSING — the artifact cannot be tied back to the log that produced it",
    },
    {
      property: "anti-re-litigation line",
      passed: contents.includes("Do not re-litigate without superseding this record."),
      evidence: contents.includes("Do not re-litigate")
        ? "present — disagreeing is allowed but has a form, and the form is a recorded supersession"
        : "absent",
    },
  ];
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  const found = match?.[0]?.trim();
  return found === undefined || found.length === 0 ? null : found;
}

function GateG5Card(): ReactElement {
  const store = useExport();
  const [ran, setRan] = useState<readonly GateCheck[] | null>(null);

  const artifact = selectedArtifact(store);
  const claude = store.result?.artifacts.find((entry) => entry.target === "claude-md") ?? null;

  return (
    <section className="card">
      <h2 className="card-title">Gate G5 — it closes the loop</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        The gate requires that the generated <span className="mono">CLAUDE.md</span> shows a
        decision with MUST / MUST NOT, <span className="mono">applies_to</span>, rejected
        alternatives, a runnable verify command, status, and a stamp. Each of those is a string
        predicate, so it is checked rather than eyeballed.
      </p>

      <button
        type="button"
        className="badge"
        disabled={store.result === null || store.blocked}
        onClick={() => setRan(checkGateG5(claude?.contents ?? null))}
      >
        Check gate G5
      </button>

      {store.result === null ? (
        <span className="faint" style={{ marginLeft: 8, fontSize: 11 }}>
          compile first
        </span>
      ) : null}

      {ran !== null ? (
        <div style={{ marginTop: 12 }}>
          {ran.every((check) => check.passed) ? (
            <div className="notice notice-info" style={{ marginBottom: 10 }}>
              G5 PASSES. Every property the gate names is present in the compiled artifact, and the
              export carries both the reasoning and the check — which is the whole claim.
            </div>
          ) : (
            <div className="notice notice-warning" style={{ marginBottom: 10 }}>
              G5 does not pass yet. {ran.filter((check) => !check.passed).length} of {ran.length}{" "}
              properties missing. Each line below says which and why — most commonly because the
              fixture log has no rejected alternatives or no accepted guards yet.
            </div>
          )}

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {ran.map((check) => (
                <tr key={check.property} style={{ borderTop: "1px solid var(--edge-soft, #333)" }}>
                  <td
                    style={{
                      padding: "4px 6px",
                      whiteSpace: "nowrap",
                      color: check.passed ? "var(--label-in)" : "var(--label-out)",
                    }}
                  >
                    {check.passed ? "✓" : "✗"}
                  </td>
                  <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{check.property}</td>
                  <td className="mono dim" style={{ padding: "4px 6px", fontSize: 11 }}>
                    {check.evidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {artifact !== null ? (
            <div className="faint" style={{ marginTop: 8, fontSize: 11 }}>
              Checked against {TARGET_FILENAMES["claude-md"]}. Switch targets below to inspect the
              others; the gate is defined on the Claude file because it is the strictest reader.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

function OptionsCard(): ReactElement {
  const store = useExport();

  return (
    <section className="card">
      <h2 className="card-title">Targets and budget</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {EXPORT_TARGETS.map((target) => (
          <label
            key={target}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={store.targets.includes(target)}
              onChange={() => store.toggleTarget(target)}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="mono">{TARGET_FILENAMES[target]}</span>
              <span className="dim" style={{ marginLeft: 8 }}>
                {TARGET_AUDIENCE[target]}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div
        style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}
      >
        <label style={{ fontSize: 12 }}>
          Project name{" "}
          <input
            value={store.projectName}
            onChange={(event) => store.setProjectName(event.target.value)}
            placeholder="appears in each file's title"
            style={{ fontSize: 12, marginLeft: 6 }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Line budget{" "}
          <input
            type="number"
            value={store.maxLines}
            min={40}
            max={2000}
            onChange={(event) => store.setMaxLines(Number(event.target.value))}
            style={{ width: 70, fontSize: 12, marginLeft: 6 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={store.includeOut}
            onChange={(event) => store.setIncludeOut(event.target.checked)}
          />{" "}
          Include OUT decisions in the agent files
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={store.includeSuperseded}
            onChange={(event) => store.setIncludeSuperseded(event.target.checked)}
          />{" "}
          Include superseded decisions in the agent files
        </label>
      </div>

      <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
        Both are off by default and should stay off. A file containing a reversed rule alongside its
        replacement is exactly the failure the whole gate exists to prevent: "if two rules
        contradict each other, the model may pick one arbitrarily." DECISIONS.md carries the history
        regardless, because a human reading it needs the reversals and an agent following rules does
        not.
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

function BudgetCard(): ReactElement {
  const store = useExport();

  if (store.result === null) return <span />;

  const stats = store.result.agentCif.stats;
  const budget = store.result.artifacts[0]?.budget;

  return (
    <section className="card">
      <h2 className="card-title">Token budget</h2>

      <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>
        {describeSelectedBudget(store)}
      </pre>

      <div className="metric-grid" style={{ marginTop: 12 }}>
        <Metric label="inline" value={stats.decisionsIncluded} />
        <Metric label="linked out" value={stats.decisionsLinkedOut} />
        <Metric label="excluded" value={stats.decisionsExcluded} />
        <Metric label="lines" value={stats.lineCount} />
        <Metric label="~tokens" value={stats.estimatedTokens} />
        <Metric label="budget" value={budget?.maxLines ?? 0} />
      </div>

      {store.result.ciAddedBecause !== null ? (
        <div className="notice notice-info" style={{ marginTop: 10, fontSize: 12 }}>
          {store.result.ciAddedBecause}
        </div>
      ) : null}

      <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
        Tier 2 is not a discard pile. Decisions that miss the inline budget become one-line index
        entries, so the agent still learns the decision exists and where to read it. A truncated
        file silently omits rules, and an agent cannot follow a rule it has never heard of.
      </div>
    </section>
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
/* The artifact                                                               */
/* -------------------------------------------------------------------------- */

function ArtifactCard(): ReactElement {
  const store = useExport();
  const artifact = selectedArtifact(store);

  if (store.result === null) return <span />;

  const download = (): void => {
    if (artifact === null) return;
    const blob = new Blob([artifact.contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename.split("/").pop() ?? artifact.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card">
      <h2 className="card-title">
        Artifact
        {artifact !== null ? (
          <span className="mono" style={{ marginLeft: 8, fontSize: 12 }}>
            {artifact.filename}
          </span>
        ) : null}
        {artifact !== null ? (
          <button type="button" className="badge" style={{ marginLeft: 8 }} onClick={download}>
            Download
          </button>
        ) : null}
      </h2>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {store.result.artifacts.map((entry) => (
          <button
            type="button"
            key={entry.filename}
            className="badge"
            style={{ opacity: artifact?.filename === entry.filename ? 1 : 0.6 }}
            onClick={() => store.select(entry.target as ExportTarget)}
          >
            {entry.filename}
          </button>
        ))}
      </div>

      {artifact === null ? (
        <div className="notice notice-warning">No artifact selected.</div>
      ) : (
        <>
          {artifact.warnings.length > 0 ? (
            <div className="notice notice-warning" style={{ marginBottom: 10, fontSize: 12 }}>
              {artifact.warnings.length} annotation(s) applied inline to the records they concern —
              a warning in a side panel is one an agent never sees.
            </div>
          ) : null}

          <pre
            className="mono"
            style={{
              whiteSpace: "pre-wrap",
              margin: 0,
              fontSize: 11,
              lineHeight: 1.55,
              maxHeight: 460,
              overflow: "auto",
            }}
          >
            {artifact.contents}
          </pre>

          <details style={{ marginTop: 12 }}>
            <summary className="faint" style={{ fontSize: 11, cursor: "pointer" }}>
              Integrity stamp, parsed
            </summary>
            <pre
              className="mono dim"
              style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 11 }}
            >
              {describeStamp(artifact.stamp)}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The six properties                                                         */
/* -------------------------------------------------------------------------- */

function SixPropertiesCard(): ReactElement {
  const store = useExport();
  const [index, setIndex] = useState(0);

  const records = store.result?.agentCif.records ?? [];
  const record = records[index];

  if (record === undefined) return <span />;

  const checks = checkSixProperties(record);
  const missing = checks.filter((check) => !check.present);

  return (
    <section className="card">
      <h2 className="card-title">
        The six agent-optimized properties · {record.id}
        {records.length > 1 ? (
          <span
            className="badge"
            style={{ marginLeft: 8 }}
            onClick={() => setIndex((index + 1) % records.length)}
          >
            next record
          </span>
        ) : null}
      </h2>

      {missing.length === 0 ? (
        <div className="notice notice-info" style={{ fontSize: 12 }}>
          All six present on this record. Two of them — <strong>verifiable</strong> and{" "}
          <strong>non-conflicting</strong> — are the ones no ADR tool delivers automatically,
          because both require a reasoning layer rather than a template.
        </div>
      ) : (
        <div className="notice notice-warning" style={{ fontSize: 12 }}>
          {missing.length} of six missing on this record. Each is named below with what the absence
          costs; the record is still emitted, because an incomplete rule is better than no rule —
          but the gap is stated rather than hidden.
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
        <tbody>
          {checks.map((check) => (
            <tr key={check.property} style={{ borderTop: "1px solid var(--edge-soft, #333)" }}>
              <td
                style={{
                  padding: "4px 6px",
                  color: check.present ? "var(--label-in)" : "var(--label-unknown)",
                }}
              >
                {check.present ? "✓" : "—"}
              </td>
              <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{check.property}</td>
              <td className="mono dim" style={{ padding: "4px 6px", fontSize: 11 }}>
                {check.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
        {record.imperative}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Verify a file                                                              */
/* -------------------------------------------------------------------------- */

function VerifyCard(): ReactElement {
  const store = useExport();
  const [path, setPath] = useState("CLAUDE.md");
  const [contents, setContents] = useState("");

  return (
    <section className="card">
      <h2 className="card-title">Check a file against the log</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        Paste a previously exported file to find out whether it still corresponds to this log. A
        mismatch is recorded as an <span className="mono">ExportIntegrityMismatch</span> event; a
        match records nothing, because a log full of "checked, fine" entries would bury the one that
        mattered.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="path, e.g. CLAUDE.md"
          style={{ fontSize: 12, width: 200 }}
        />
        <button
          type="button"
          className="badge"
          disabled={contents.trim().length === 0}
          onClick={() => store.checkFile(path.trim() || "CLAUDE.md", contents)}
        >
          Check stamp
        </button>
        {store.checks.length > 0 ? (
          <button type="button" className="badge" onClick={() => store.clearChecks()}>
            Clear
          </button>
        ) : null}
      </div>

      <textarea
        className="mono"
        value={contents}
        rows={5}
        onChange={(event) => setContents(event.target.value)}
        placeholder="paste the whole file, including its stamp footer"
        style={{ width: "100%", fontSize: 11, resize: "vertical" }}
      />

      {store.checks.map((check, index) => (
        <div
          key={String(index) + check.path}
          className={"notice " + (check.verification.ok ? "notice-info" : "notice-warning")}
          style={{ marginTop: 10, fontSize: 12 }}
        >
          <strong>{check.path}</strong> — {check.note}
        </div>
      ))}

      <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
        This is <strong>auditability, not security</strong>. The hash is unsalted and the algorithm
        is in the source, so an agent that rewrites the file can rewrite the stamp too. The check
        tells you whether the file still corresponds to the log; it cannot stop anyone changing it.
        Compare against the log, do not trust the file.
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Round trip                                                                 */
/* -------------------------------------------------------------------------- */

function RoundTripCard(): ReactElement {
  const store = useExport();
  const [contents, setContents] = useState("");
  const [error, setError] = useState<string | null>(null);

  const plan = (): void => {
    const result = store.planImport(contents);
    setError(result.ok ? null : result.error);
  };

  return (
    <section className="card">
      <h2 className="card-title">Round-trip re-import</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        Paste an exported <span className="mono">DECISIONS.md</span>. The stamp is verified first,
        then each record is resolved against the log by ID and then by content, and merged as a
        refinement where it matches. Nothing is committed until you apply the plan.
      </p>

      <textarea
        className="mono"
        value={contents}
        rows={6}
        onChange={(event) => setContents(event.target.value)}
        placeholder="paste a DECISIONS.md, including its stamp footer"
        style={{ width: "100%", fontSize: 11, resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="badge"
          disabled={contents.trim().length === 0}
          onClick={plan}
        >
          Plan the merge
        </button>
        <button
          type="button"
          className="badge"
          disabled={store.mergePlan === null || store.mergePlan.refuse}
          onClick={() => void store.applyImport()}
        >
          Apply
        </button>
      </div>

      {error !== null ? (
        <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      {store.mergeNote !== null ? (
        <pre
          className="mono dim"
          style={{ whiteSpace: "pre-wrap", margin: "10px 0 0", fontSize: 11 }}
        >
          {store.mergeNote}
        </pre>
      ) : null}

      <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
        A Markdown round trip is <strong>lossy and says so</strong>. DECISIONS.md never carried the
        original snippets, spans, confidence or learned times, so they cannot come back. Records
        resolved as new are <strong>proposed, never auto-committed</strong> — the system proposes
        and the human disposes. When the round trip has to be exact, use the JSON export on the
        Foundation tab: it carries the full event chain and reproduces IDs identically.
      </div>
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
      <Block title="The pre-export consistency gate" body={describeGate()} />
      <Block title="Verify commands" body={describeVerifyPolicy()} />
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
