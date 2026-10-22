/**
 * The reasoning view — gate G2: "it reasons".
 *
 * Phase 2 · the demo surface for sub-phases 2.1–2.10
 * Plan: plan/phase-2-truth-maintenance.md §2.11
 *
 * ---------------------------------------------------------------------------
 * WHAT G2 HAS TO SHOW
 *
 * Not that a graph exists. That a change in one place MOVES a belief somewhere else,
 * through a chain the user can read, and that the system stopped short of acting on it.
 *
 * Three things on screen, in this order, because this is the order the argument runs:
 *
 *   1. THE FINDING      what is unsound, and which gate said so
 *   2. THE DIAGNOSIS    backtracking → nogood → cascade → entrenchment, as prose
 *   3. THE PROPOSAL     seven parts, with buttons that require a reason
 *
 * Plus the two things that make it credible rather than impressive:
 *
 *   · GATE AVAILABILITY, always visible. Gate (b) is unavailable until Phase 3, and
 *     saying so on screen is the difference between a demo and a claim.
 *   · THE AUDIT TRAIL, on demand. "Why do you believe this?" answered as a chain
 *     ordered by LEARNED time, with the weak link named.
 *
 * ---------------------------------------------------------------------------
 * COLOUR ENCODES EPISTEMIC STATUS, NEVER SEVERITY
 *
 * IN is green, OUT is grey, UNKNOWN amber, UNFOUNDED violet — the same four colours
 * used everywhere else in the product. Red is reserved for "an action is available",
 * which is why the proposal buttons are the only red things here. A finding is not an
 * error; it is information about the state of a belief.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState, type ReactElement } from "react";
import type { DecisionId, PremiseId, ProposalId } from "@/types/common";
import type { EntrenchmentBreakdown } from "@/types/reasoning";
import type { DecisionLabel } from "@/types/domain";
import type { Labelled, NodeId } from "@/reasoning/labeller";
import { isWorldObservable, PREMISE_TYPES_CLOSED, VARIABLES } from "@/ontology";
import type { PremiseType } from "@/types/domain";
import { LABEL_BACKGROUND, LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import { useWhyLog } from "@/store/whylog";
import {
  applyContest,
  applyOverride,
  applyVouch,
  assertPremiseFalsified,
  applyRejustification,
  applyReversal,
  contestedCases,
  deterministicCases,
  hardestCase,
  truncatedCases,
  useReasoning,
} from "@/store/reasoning";
import {
  auditDecision,
  chronologicalOrder,
  describeAction,
  describeAvailability,
  describeRun,
  renderTrail,
  renderWeakest,
  type Newcomer,
  type RevisionCase,
} from "@/reasoning";

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function ReasoningView(): ReactElement {
  const state = useWhyLog((s) => s.state);
  const logStatus = useWhyLog((s) => s.status);

  const reasoning = useReasoning();
  const { status, result, cases, selected, error, committed, durationMs } = reasoning;
  const unresolved = useReasoning((s) => s.unresolved);

  const [showAudit, setShowAudit] = useState(false);
  const [newcomerText, setNewcomerText] = useState("");
  const [newcomerVariable, setNewcomerVariable] = useState<string>("DATABASE");
  const [newcomerValue, setNewcomerValue] = useState("postgres");
  /** The last newcomer that went through screening. Kept so "override anyway" can force
   *  the SAME information through rather than making the user retype it — an override
   *  that requires re-entry is an override nobody performs. */
  const [pendingNewcomer, setPendingNewcomer] = useState<Newcomer | null>(null);

  const decisionCount = state.decisions.size;
  const premiseCount = state.premises.size;

  const deterministic = useMemo(() => deterministicCases(cases), [cases]);
  const contested = useMemo(() => contestedCases(cases), [cases]);
  const truncated = useMemo(() => truncatedCases(cases), [cases]);
  const hardest = useMemo(() => hardestCase(cases), [cases]);

  const selectedCase = cases.find((entry) => entry.proposal.id === selected) ?? null;


  /* ---------------------------------------------------------------------- */

  if (decisionCount === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Reasoning</h2>
        <p className="dim">
          There is nothing to reason about yet. Import a transcript and review it first — the
          reasoning cycle works on decisions and the premises they rest on, and neither exists
          until an extraction has been committed.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ---- the run ---- */}
      <section className="card">
        <h2 className="card-title">Truth maintenance</h2>
        <p className="dim" style={{ marginTop: 0 }}>
          {decisionCount} decision(s), {premiseCount} premise(s). Running the cycle labels the
          graph, fires all three gates, backtracks to the minimal set of assumptions responsible,
          cascades — stopping wherever a decision has independent support — screens any new
          information against what it contradicts, and proposes. It never applies.
        </p>

        <div className="metric-grid">
          <Metric label="findings" value={String(cases.length)} />
          <Metric label="deterministic" value={String(deterministic.length)} />
          <Metric label="contested" value={String(contested.length)} />
          <Metric label="events appended" value={String(committed)} />
          <Metric label="run time" value={`${durationMs} ms`} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <RunButton
            label={status === "running" ? "Running…" : "Run the revision cycle"}
            disabled={status === "running" || logStatus === "degraded"}
            onClick={() => void reasoning.run()}
          />
          <RunButton
            label="Re-examine, skipping gate (b)"
            disabled={status === "running"}
            secondary
            onClick={() => void reasoning.run({ skipSemantic: true })}
          />
          <RunButton
            label={showAudit ? "Hide audit trails" : "Audit every decision"}
            secondary
            onClick={() => setShowAudit((current) => !current)}
          />
        </div>

        {logStatus === "degraded" ? (
          <p className="notice notice-error" style={{ marginTop: 12 }}>
            The log is read-only because its hash chain failed verification. The cycle can still
            label and diagnose, but it cannot record what it found.
          </p>
        ) : null}

        {error !== null ? (
          <p className="notice notice-error" style={{ marginTop: 12 }}>
            {error}
          </p>
        ) : null}

        {result !== null ? (
          <pre className="mono faint" style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 11 }}>
            {describeRun(result.gates)}
            {"\n"}
            {describeAvailability(result.gates)}
          </pre>
        ) : null}
      </section>

      {/* ---- new information: the adjudication demo ---- */}
      <NewInformation
        text={newcomerText}
        variable={newcomerVariable}
        value={newcomerValue}
        disabled={status === "running"}
        onText={setNewcomerText}
        onVariable={setNewcomerVariable}
        onValue={setNewcomerValue}
        onSubmit={(newcomer) => void reasoning.run({ newcomer })}
      />

      {result?.adjudication?.kind === "reject-newcomer" ? (
        <ContestedCard
          why={result.adjudication.why}
          blockingDecisionId={result.adjudication.blockingDecisionId}
          newcomerBreakdown={result.adjudication.newcomerBreakdown ?? null}
          incumbentBreakdown={result.adjudication.incumbentBreakdown ?? null}
          newcomer={pendingNewcomer}
        />
      ) : null}

      {unresolved.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Not acted on — needs your confirmation</h2>
          <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
            These assertions matched no premise by exact (type, predicate), so nothing was
            invalidated. Gate (c) fires only on RESOLVED premise identity: a false match
            does not miss a conflict, it produces a confident, spectacular, entirely wrong
            cascade. Guessing here is the one thing worse than asking.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {unresolved.map((entry, index) => (
              <li key={`${entry.assertion.predicate}-${index}`} style={{ marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 11 }}>
                  {entry.assertion.type}.{entry.assertion.predicate}
                </span>{" "}
                — “{entry.assertion.text}”{" "}
                <span className="badge" style={{ fontSize: 10 }}>
                  {entry.kind === "ambiguous" ? `${entry.candidates.length} candidates` : "no match"}
                </span>
                <div className="faint" style={{ fontSize: 11 }}>{entry.explanation}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- the G2 demonstration ---- */}
      <FalsifySection />

      {/* ---- findings + diagnosis ---- */}
      {cases.length > 0 ? (
        <section style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 16 }}>
          <CaseList
            cases={cases}
            selected={selected}
            truncated={truncated}
            onSelect={reasoning.select}
          />
          {selectedCase === null ? (
            <section className="card">
              <p className="dim">Select a finding.</p>
            </section>
          ) : (
            <CaseDetail
              entry={selectedCase}
              isHardest={hardest?.proposal.id === selectedCase.proposal.id}
            />
          )}
        </section>
      ) : status === "done" ? (
        <section className="card">
          <h2 className="card-title">No gate fired</h2>
          <p className="dim" style={{ marginTop: 0 }}>
            Nothing in the log contradicts anything else, no world-observable premise has been
            falsified, and no excluded condition has arrived. That is a result, not an absence of
            one — and it is only meaningful because the availability report above says which gates
            actually ran.
          </p>
        </section>
      ) : null}

      {/* ---- audit trails ---- */}
      {showAudit ? <AuditSection /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function RunButton({
  label,
  onClick,
  disabled,
  secondary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className="nav-item"
      onClick={onClick}
      disabled={disabled === true}
      style={
        secondary === true
          ? undefined
          : { borderColor: "var(--action)", color: "var(--action)" }
      }
    >
      {label}
    </button>
  );
}

function NewInformation({
  text,
  variable,
  value,
  disabled,
  onText,
  onVariable,
  onValue,
  onSubmit,
}: {
  text: string;
  variable: string;
  value: string;
  disabled: boolean;
  onText: (next: string) => void;
  onVariable: (next: string) => void;
  onValue: (next: string) => void;
  onSubmit: (newcomer: Newcomer) => void;
}): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">New information</h2>
      <p className="dim" style={{ marginTop: 0 }}>
        Something changed in the world. Enter it and the cycle will screen it against everything
        it contradicts — and may REFUSE it. This is the second-user scenario: a log built on
        "single user" meeting the arrival of a second one.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="faint">variable</span>
          <select
            className="mono"
            value={variable}
            onChange={(event) => onVariable(event.target.value)}
          >
            {VARIABLES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="faint">value</span>
          <input
            className="mono"
            value={value}
            onChange={(event) => onValue(event.target.value)}
            placeholder="postgres"
            style={{ minWidth: 140 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: 1 }}>
          <span className="faint">what was said, verbatim</span>
          <input
            value={text}
            onChange={(event) => onText(event.target.value)}
            placeholder="we just added a second editor, and they overwrote each other's changes"
            style={{ minWidth: 260 }}
          />
        </label>

        <RunButton
          label="Screen it"
          disabled={disabled || text.trim().length === 0}
          onClick={() =>
            onSubmit({
              variable: variable as Newcomer["variable"],
              value,
              text,
              /* A human typed this in, so it carries the highest source authority there
               * is. That is the honest classification, and it is also what makes the
               * refusal interesting: even a human-stated observation can lose to an
               * incumbent with corroboration and guards behind it. */
              origin: "human_stated",
              confidence: 0.9,
            })
          }
        />
      </div>
    </section>
  );
}

function CaseList({
  cases,
  selected,
  truncated,
  onSelect,
}: {
  cases: readonly RevisionCase[];
  selected: ProposalId | null;
  truncated: readonly RevisionCase[];
  onSelect: (id: ProposalId) => void;
}): ReactElement {
  const truncatedIds = new Set(truncated.map((entry) => entry.proposal.id));

  return (
    <section className="card" style={{ alignSelf: "start" }}>
      <h2 className="card-title">Findings</h2>
      <p className="faint" style={{ fontSize: 11, marginTop: 0 }}>
        Deterministic gates first. A finding from gate (a) or (c) can be checked against the graph
        without forming an opinion about a model; a finding from gate (b) cannot.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[...cases]
          .sort((a, b) => Number(b.finding.deterministic) - Number(a.finding.deterministic))
          .map((entry) => (
            <button
              key={entry.proposal.id}
              type="button"
              className="nav-item"
              aria-current={selected === entry.proposal.id ? "true" : undefined}
              onClick={() => onSelect(entry.proposal.id)}
              style={{ textAlign: "left", flexDirection: "column", alignItems: "flex-start", gap: 4 }}
            >
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <GateBadge gate={entry.finding.gate} />
                <span className="mono" style={{ fontSize: 11 }}>
                  {entry.finding.decisionId}
                </span>
                {truncatedIds.has(entry.proposal.id) ? (
                  <span className="faint" style={{ fontSize: 10 }} title="Backtracking or the cascade hit its depth cap. The diagnosis is knowingly incomplete.">
                    incomplete
                  </span>
                ) : null}
              </span>
              <span className="dim" style={{ fontSize: 12 }}>
                {entry.finding.explanation.split("\n")[0]}
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}

function GateBadge({ gate }: { gate: "structural" | "semantic" | "premise" }): ReactElement {
  const label =
    gate === "structural" ? "(a) structural" : gate === "premise" ? "(c) premise" : "(b) semantic";
  const meaning =
    gate === "structural"
      ? "Same variable, antonym values, both IN. The ontology's antonym table decided this — no model, no threshold."
      : gate === "premise"
        ? "A world-observable premise was falsified, or an excluded condition arrived. Label arithmetic on the justification set."
        : "Retrieval found the pair and a model adjudicated it. Weaker than the other two, and shown as such.";

  return (
    <span
      className="badge"
      title={meaning}
      style={{
        color: gate === "semantic" ? "var(--label-unknown)" : "var(--label-in)",
        fontSize: 10,
      }}
    >
      {label}
    </span>
  );
}

function CaseDetail({ entry, isHardest }: { entry: RevisionCase; isHardest: boolean }): ReactElement {
  const state = useWhyLog((s) => s.state);
  const proposal = entry.proposal;
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  /* Reversing needs the value that REPLACES the old one. When the finding names the
   * other decision, its canonical value is the honest default; when it does not — a
   * premise invalidation with no rival — the user has to supply one, because inventing
   * it here would put a value in the log that nobody said. */
  const rival =
    entry.finding.otherDecisionId === null
      ? null
      : state.decisions.get(entry.finding.otherDecisionId) ?? null;
  const [newValue, setNewValue] = useState(rival?.value ?? "");

  /* Rejustifying needs the premise the decision ACTUALLY rests on. Defaults come from
   * the premise that failed: a rejustification usually replaces a reason of the same
   * kind, and pre-filling the predicate keeps the new premise resolvable against the
   * old one instead of creating a near-duplicate node. */
  const failedPremise = state.premises.get(proposal.failedPremiseId);
  const [premiseText, setPremiseText] = useState("");
  const [premiseType, setPremiseType] = useState<PremiseType>(failedPremise?.type ?? "requirement");
  const [predicate, setPredicate] = useState(failedPremise?.predicate ?? "requirement.statement");

  const [busy, setBusy] = useState(false);

  /* Every action re-runs the cycle afterwards (§2.9: the label follows from the graph,
   * never from the event), so all of them are async and the buttons lock while one is
   * in flight. A second click mid-run would append a second batch against a graph that
   * is about to change. */
  const act = async (
    run: () => Promise<{ ok: boolean; error?: string; value?: string }>,
  ): Promise<void> => {
    setBusy(true);
    const outcome = await run();
    setBusy(false);
    setMessage(
      outcome.ok ? outcome.value ?? "Recorded." : outcome.error ?? "Failed.",
    );
  };

  const wantsReverse = proposal.availableActions.includes("reverse");
  const wantsRejustify = proposal.availableActions.includes("rejustify");
  const needsValue = wantsReverse && newValue.trim().length === 0;
  const needsPremise = wantsRejustify && premiseText.trim().length === 0;
  const ready = reason.trim().length > 0 && !needsValue && !needsPremise;

  return (
    <section className="card">
      <h2 className="card-title">
        {proposal.unsoundDecisionId}{" "}
        <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>
          proposal {proposal.id}
        </span>
      </h2>

      {isHardest ? (
        <p className="notice notice-warning">
          This is the most entrenched finding in the run — the one that will cost the most to act
          on. It is called out on purpose: the proposals most likely to be dismissed unread are the
          ones that matter most.
        </p>
      ) : null}

      {/* 1 */}
      <Part n={1} title="What failed">
        <p style={{ marginTop: 0 }}>{proposal.failedPremiseText}</p>
      </Part>

      {/* 2 */}
      <Part n={2} title="The evidence">
        <blockquote
          style={{
            margin: "0 0 6px",
            padding: "6px 10px",
            borderLeft: "2px solid var(--edge-related)",
            fontSize: 13,
          }}
        >
          {proposal.evidence.quote}
        </blockquote>
        <p className="faint" style={{ fontSize: 11, margin: 0 }}>
          source: {proposal.evidence.source} · confidence{" "}
          {proposal.evidence.confidence.toFixed(2)} · verbatim, never paraphrased
        </p>
      </Part>

      {/* 3 */}
      <Part n={3} title="What cannot both hold">
        {proposal.nogood === undefined ? (
          <p className="dim" style={{ marginTop: 0 }}>
            No conjunction was recorded for this finding.
          </p>
        ) : (
          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
            {proposal.nogood.explanation}
          </pre>
        )}
      </Part>

      {/* the diagnosis: steps 5 and 6 in prose */}
      <Part n={0} title="The diagnosis">
        <p style={{ marginTop: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{entry.narrative}</p>
      </Part>

      {/* 4 */}
      <Part n={4} title="What else it affects">
        {entry.cascade.steps.length === 0 ? (
          <p className="dim" style={{ marginTop: 0 }}>Nothing else depended on it.</p>
        ) : (
          <>
            <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13 }}>
              {entry.cascade.steps.map((step, index) => (
                <li key={`${step.to}-${index}`}>
                  <span className="mono">{step.to}</span>{" "}
                  {step.stoppedAtIndependentSupport ? (
                    <span style={{ color: "var(--label-in)" }}>
                      STOPS — independent support survives
                    </span>
                  ) : (
                    <LabelChip label={step.became} />
                  )}
                  <div className="faint" style={{ fontSize: 11 }}>
                    depth {step.depth} · {step.reason}
                  </div>
                </li>
              ))}
            </ul>
            {entry.cascade.truncated ? (
              <p className="notice notice-warning" style={{ fontSize: 12 }}>
                Propagation hit the depth cap with {entry.cascade.potentiallyAffectedBeyondCap}{" "}
                decision(s) unexamined. There may be more downstream than this shows.
              </p>
            ) : null}
          </>
        )}
      </Part>

      {/* 5 */}
      <Part n={5} title="How costly is it to change">
        <p style={{ marginTop: 0 }}>
          <strong>{proposal.entrenchment.capped.toFixed(2)}</strong>{" "}
          <span className="badge">{proposal.entrenchmentBand}</span>
        </p>
        <ul className="faint" style={{ fontSize: 11, margin: 0, paddingLeft: 18 }}>
          <li>source authority {proposal.entrenchment.components.sourceAuthority.toFixed(2)} × 0.30</li>
          <li>
            implementation cost{" "}
            {proposal.entrenchment.implementationCostUnknown
              ? "UNKNOWN — no guard exists yet, counted as 0.50 but not measured"
              : `${proposal.entrenchment.components.implementationCost.toFixed(2)} × 0.20`}
          </li>
          <li>corroboration {proposal.entrenchment.components.corroboration.toFixed(2)} × 0.20</li>
          <li>confidence {proposal.entrenchment.components.confidence.toFixed(2)} × 0.15</li>
          <li>recency {proposal.entrenchment.components.recency.toFixed(2)} × 0.15</li>
          {proposal.entrenchment.ee3CapApplied ? (
            <li>
              EE3 cap binds at {proposal.entrenchment.capped.toFixed(2)} because of{" "}
              <span className="mono">{proposal.entrenchment.weakestPremiseId}</span> — a derived
              belief is never more entrenched than its weakest premise
            </li>
          ) : null}
        </ul>
      </Part>

      {/* 6 */}
      <Part n={6} title="What you can do">
        <p className="faint" style={{ fontSize: 11, marginTop: 0 }}>
          Every action requires a reason. The reason is what the audit trail shows six months from
          now when somebody asks why this changed.
        </p>

        {wantsReverse ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, marginBottom: 8 }}>
            <span className="faint">
              the value that replaces it{rival === null ? "" : ` — defaults to ${rival.id} "${rival.value}"`}
            </span>
            <input
              className="mono"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="postgres"
            />
          </label>
        ) : null}

        {wantsRejustify ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: 1 }}>
              <span className="faint">
                what it really rests on{failedPremise === undefined ? "" : ` — replacing "${failedPremise.text}"`}
              </span>
              <input
                value={premiseText}
                onChange={(event) => setPremiseText(event.target.value)}
                placeholder="we are fine with two users as long as writes are serialised"
                style={{ minWidth: 240 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span className="faint">premise type</span>
              <select
                className="mono"
                value={premiseType}
                onChange={(event) => setPremiseType(event.target.value as PremiseType)}
              >
                {PREMISE_TYPES_CLOSED.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span className="faint">predicate</span>
              <input
                className="mono"
                value={predicate}
                onChange={(event) => setPredicate(event.target.value)}
                style={{ minWidth: 160 }}
              />
            </label>
          </div>
        ) : null}

        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="why — required, and it goes in the log"
          style={{ width: "100%", marginBottom: 8 }}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {proposal.availableActions.map((action) => (
            <RunButton
              key={action}
              label={action}
              disabled={!ready || busy}
              onClick={() => {
                switch (action) {
                  case "reverse":
                    void act(() => applyReversal(proposal.unsoundDecisionId, newValue.trim(), reason));
                    return;
                  case "rejustify":
                    /* Creates the premise, its justification and the link in one batch.
                     * It cannot take an id from here: ids come from the folded counters,
                     * so any id invented in the view would point at nothing. */
                    void act(() =>
                      applyRejustification(proposal.unsoundDecisionId, {
                        premiseText: premiseText.trim(),
                        premiseType,
                        predicate,
                        reason,
                      }),
                    );
                    return;
                  case "contest":
                    void act(() => applyContest(proposal.failedPremiseId, reason));
                    return;
                }
              }}
            />
          ))}
          <RunButton
            label="keep it — I vouch for this"
            secondary
            disabled={reason.trim().length === 0 || busy}
            onClick={() => void act(() => applyVouch(proposal.id, reason))}
          />
        </div>

        <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          {proposal.availableActions.map((action) => describeAction(action)).join(" · ")} ·
          keep it — vouch for the decision personally, raising its authority to 0.9 and
          resolving the proposal
        </p>

        {entry.reassertsNogood !== null ? (
          <p className="notice notice-warning" style={{ fontSize: 12, marginTop: 8 }}>
            You are re-asserting a combination this log already found impossible on{" "}
            {entry.reassertsNogood.recordedAt.slice(0, 10)} (
            <span className="mono">{entry.reassertsNogood.id}</span>).{" "}
            {entry.reassertsNogood.explanation}
          </p>
        ) : null}

        {message !== null ? (
          <p className="notice notice-info" style={{ fontSize: 12 }}>
            {message}
          </p>
        ) : null}
      </Part>

      {/* 7 */}
      <Part n={7} title="Why this was not applied for you">
        <p style={{ marginTop: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {proposal.whyNotAutoApplied}
        </p>
      </Part>
    </section>
  );
}

function Part({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 12, letterSpacing: "0.02em", margin: "0 0 6px" }}>
        {n > 0 ? `${n}. ` : ""}
        {title}
      </h3>
      {children}
    </div>
  );
}

function LabelChip({ label }: { label: DecisionLabel }): ReactElement {
  return (
    <span
      className="badge"
      title={LABEL_MEANING[label]}
      style={{ color: LABEL_COLOUR[label], background: LABEL_BACKGROUND[label] }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The Contested queue                                                        */
/* -------------------------------------------------------------------------- */

/**
 * §2.8: "A rejected newcomer appears in a Contested queue with the FULL ENTRENCHMENT
 * BREAKDOWN OF BOTH SIDES and an explicit 'override anyway' action."
 *
 * Both breakdowns are rendered term by term, not as two totals. That is what makes
 * override an informed choice: the user can see that the newcomer lost on corroboration
 * and implementation cost — the two terms it structurally cannot have — rather than on
 * authority, and decide whether that is a good enough reason to refuse them.
 */
function ContestedCard({
  why,
  blockingDecisionId,
  newcomerBreakdown,
  incumbentBreakdown,
  newcomer,
}: {
  why: string;
  blockingDecisionId: DecisionId;
  newcomerBreakdown: EntrenchmentBreakdown | null;
  incumbentBreakdown: EntrenchmentBreakdown | null;
  newcomer: Newcomer | null;
}): ReactElement {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const override = async (): Promise<void> => {
    if (newcomer === null) return;
    setBusy(true);
    const outcome = await applyOverride(newcomer, null, reason);
    setBusy(false);
    setMessage(outcome.ok ? outcome.value : outcome.error);
  };

  return (
    <section className="card">
      <h2 className="card-title">Contested — the new information was refused</h2>
      <p style={{ marginTop: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{why}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <BreakdownColumn title="the newcomer" breakdown={newcomerBreakdown} tone="var(--label-unknown)" />
        <BreakdownColumn
          title={`${blockingDecisionId} (incumbent)`}
          breakdown={incumbentBreakdown}
          tone="var(--label-in)"
        />
      </div>

      <p className="faint" style={{ fontSize: 11, marginTop: 10 }}>
        Non-prioritized revision (Hansson). AGM's Success postulate — always accept new
        information — would let one remark in a transcript overwrite a decision made over
        three days. Refusal is never silent: this is the queue, and the override is right
        here.
      </p>

      {newcomer === null ? (
        <p className="faint" style={{ fontSize: 12 }}>
          The refused information is no longer in hand — re-enter it above to override.
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="why you are overruling the arithmetic — required, and it goes in the log"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <RunButton
            label={busy ? "Overriding…" : "override anyway"}
            disabled={busy || reason.trim().length === 0}
            onClick={() => void override()}
          />
          <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            Writes a <span className="mono">HumanOverride</span> event and raises the
            newcomer's source authority to 0.9 — high enough to win every subsequent
            adjudication, but still below a directly human-stated decision (1.0), so an
            override can itself be overridden by better evidence. An override that could
            never be overturned is not a queue, it is a dead end.
          </p>
        </div>
      )}

      {message !== null ? (
        <p className="notice notice-info" style={{ fontSize: 12, marginTop: 8 }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

function BreakdownColumn({
  title,
  breakdown,
  tone,
}: {
  title: string;
  breakdown: EntrenchmentBreakdown | null;
  tone: string;
}): ReactElement {
  if (breakdown === null) {
    return (
      <div>
        <h3 style={{ fontSize: 12, margin: "0 0 6px", color: tone }}>{title}</h3>
        <p className="dim" style={{ fontSize: 12, margin: 0 }}>No breakdown recorded.</p>
      </div>
    );
  }

  const c = breakdown.components;

  return (
    <div>
      <h3 style={{ fontSize: 12, margin: "0 0 6px", color: tone }}>
        {title} — {breakdown.capped.toFixed(2)}
      </h3>
      <ul className="faint" style={{ fontSize: 11, margin: 0, paddingLeft: 18 }}>
        <li>source authority {c.sourceAuthority.toFixed(2)} × 0.30</li>
        <li>
          implementation cost {c.implementationCost.toFixed(2)} × 0.20
          {breakdown.implementationCostUnknown ? " — unknown, not measured" : ""}
        </li>
        <li>corroboration {c.corroboration.toFixed(2)} × 0.20</li>
        <li>confidence {c.confidence.toFixed(2)} × 0.15</li>
        <li>recency {c.recency.toFixed(2)} × 0.15</li>
        {breakdown.ee3CapApplied ? (
          <li>
            EE3 cap binds at {breakdown.capped.toFixed(2)} via{" "}
            <span className="mono">{breakdown.weakestPremiseId}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The G2 demonstration                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Falsify a world-observable premise.
 *
 * This is gate G2: `single-user` becomes false, the decision resting on it goes
 * UNSOUND, anything downstream cascades, anything with independent support survives,
 * and a proposal appears with its entrenchment broken down.
 *
 * Only WORLD-OBSERVABLE premises are listed — `scale`, `deployment`, `capability`,
 * `external`. The intent-based ones (`team`, `budget`, `time`, `requirement`) are
 * excluded on purpose: nobody can observe that you stopped wanting offline mode, so
 * only a human can retract those, and offering a button that pretends otherwise would
 * be offering a lie. They are listed separately, greyed, saying exactly that.
 */
function FalsifySection(): ReactElement {
  const state = useWhyLog((s) => s.state);
  const labels = useReasoning((s) => s.result?.labels);
  const empty = useMemo(() => new Map<NodeId, Labelled>(), []);
  const labelMap: ReadonlyMap<NodeId, Labelled> = labels ?? empty;

  const [target, setTarget] = useState<PremiseId | null>(null);
  const [observed, setObserved] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const premises = useMemo(() => {
    const all = [...state.premises.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      observable: all.filter((premise) => isWorldObservable(premise.type)),
      intent: all.filter((premise) => !isWorldObservable(premise.type)),
    };
  }, [state.premises]);

  if (premises.observable.length === 0 && premises.intent.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Falsify a premise</h2>
        <p className="dim" style={{ marginTop: 0 }}>
          No premises in the log yet. Premises are what make this more than a decision
          list: they are the conditions a decision was true under, and they are what
          reality invalidates.
        </p>
      </section>
    );
  }

  const submit = async (): Promise<void> => {
    if (target === null) return;
    setBusy(true);
    const outcome = await assertPremiseFalsified(target, observed);
    setBusy(false);
    setMessage(outcome.ok ? outcome.value : outcome.error);
    if (outcome.ok) {
      setTarget(null);
      setObserved("");
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Something stopped being true</h2>
      <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
        This is the demonstration the whole project exists for. Pick a premise about the
        world, say what you observed instead, and the cycle will find every decision that
        was true <em>given</em> it — then backtrack, cascade, weigh what it would cost to
        change, and propose. It will not apply anything.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {premises.observable.map((premise) => {
          const expanded = target === premise.id;
          const label = labelMap.get(premise.id)?.label ?? premise.label;

          return (
            <div key={premise.id} style={{ borderTop: "1px solid var(--edge-related)" }}>
              <button
                type="button"
                className="nav-item"
                onClick={() => setTarget(expanded ? null : premise.id)}
                style={{ width: "100%", justifyContent: "space-between", textAlign: "left" }}
              >
                <span>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {premise.id}
                  </span>{" "}
                  {premise.text}
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <LabelChip label={label} />
                  <span className="badge faint" style={{ fontSize: 10 }}>
                    {premise.type}
                  </span>
                </span>
              </button>

              {expanded ? (
                <div style={{ padding: "8px 4px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={observed}
                    onChange={(event) => setObserved(event.target.value)}
                    placeholder={`what you observed instead — e.g. "there are two of us editing it now"`}
                    style={{ flex: 1, minWidth: 260 }}
                    autoFocus
                  />
                  <RunButton
                    label={busy ? "Running the cycle…" : "Falsify it"}
                    disabled={busy || observed.trim().length === 0}
                    onClick={() => void submit()}
                  />
                  <p className="faint" style={{ fontSize: 11, width: "100%", margin: 0 }}>
                    Recorded as a <span className="mono">repo-scan</span> observation that
                    refutes <span className="mono">{premise.predicate}</span>. The same path a
                    guard will take in Phase 4 — no branch in the reasoning code knows or
                    cares which one it was.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {premises.intent.length > 0 ? (
        <details style={{ marginTop: 12 }}>
          <summary className="faint" style={{ fontSize: 12, cursor: "pointer" }}>
            {premises.intent.length} premise(s) about intent, which cannot be falsified by
            observation
          </summary>
          <ul className="faint" style={{ fontSize: 12, paddingLeft: 18 }}>
            {premises.intent.map((premise) => (
              <li key={premise.id}>
                <span className="mono">{premise.id}</span> {premise.text}{" "}
                <span className="badge" style={{ fontSize: 10 }}>
                  {premise.type}
                </span>
              </li>
            ))}
          </ul>
          <p className="faint" style={{ fontSize: 11 }}>
            <span className="mono">team</span>, <span className="mono">budget</span>,{" "}
            <span className="mono">time</span> and <span className="mono">requirement</span>{" "}
            premises record what you wanted, not what the world is. No scan can observe that
            you stopped wanting offline mode, so no guard can check them and nothing here will
            retract them. Only you can, and the log marks them unverifiable rather than
            pretending otherwise.
          </p>
        </details>
      ) : null}

      {message !== null ? (
        <p className="notice notice-info" style={{ fontSize: 12, marginTop: 12, whiteSpace: "pre-wrap" }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The audit section                                                          */
/* -------------------------------------------------------------------------- */

function AuditSection(): ReactElement {
  const state = useWhyLog((s) => s.state);
  const labels = useReasoning((s) => s.result?.labels);
  const [open, setOpen] = useState<DecisionId | null>(null);

  const empty = useMemo(() => new Map<NodeId, Labelled>(), []);
  const labelMap: ReadonlyMap<NodeId, Labelled> = labels ?? empty;

  const decisions = useMemo(
    () => [...state.decisions.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    [state.decisions],
  );

  return (
    <section className="card">
      <h2 className="card-title">Why do you believe this?</h2>
      <p className="dim" style={{ marginTop: 0, fontSize: 13 }}>
        The full support chain for every decision, ordered by <strong>learned</strong> time — when
        the system found out, not when it happened. An audit ordered by valid time would claim the
        system reasoned about something before it knew about it, and an audit that lies about its
        own clock is not an audit.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {decisions.map((decision) => {
          const trail = auditDecision(state, labelMap, decision.id);
          const expanded = open === decision.id;

          return (
            <div key={decision.id} style={{ borderTop: "1px solid var(--edge-related)" }}>
              <button
                type="button"
                className="nav-item"
                onClick={() => setOpen(expanded ? null : decision.id)}
                style={{ width: "100%", justifyContent: "space-between", textAlign: "left" }}
              >
                <span>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {decision.id}
                  </span>{" "}
                  {decision.statement}
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <LabelChip label={labelMap.get(decision.id)?.label ?? decision.label} />
                  <span className="faint" style={{ fontSize: 11 }}>
                    {trail.premiseCount} premise(s)
                    {trail.weakest === null ? "" : ` · weak: ${trail.weakest.kind}`}
                  </span>
                </span>
              </button>

              {expanded ? (
                <div style={{ padding: "8px 4px 14px" }}>
                  <p className="notice notice-info" style={{ fontSize: 12 }}>
                    {renderWeakest(trail)}
                  </p>
                  <pre
                    className="mono"
                    style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: "8px 0 0" }}
                  >
                    {renderTrail(trail)}
                  </pre>
                  <details style={{ marginTop: 8 }}>
                    <summary className="faint" style={{ fontSize: 11, cursor: "pointer" }}>
                      the same chain in learned-time order ({chronologicalOrder(trail).length} node
                      (s))
                    </summary>
                    <ol className="faint" style={{ fontSize: 11, paddingLeft: 18 }}>
                      {chronologicalOrder(trail).map((step, index) => (
                        <li key={`${step.nodeId}-${index}`}>
                          <span className="mono">{step.nodeId}</span> {step.text}
                          {step.learnedAt === null ? "" : ` — learned ${step.learnedAt}`}
                          {step.learnedFrom === null ? "" : ` via ${step.learnedFrom}`}
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
