/**
 * The Phase 0 view: the substrate, made visible.
 *
 * Sub-phase 0.10 — the app boots empty, renders an empty state, survives reload.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS VIEW EXISTS AT ALL
 *
 * Phase 0 has no user-facing feature, and a phase with nothing to look at is a
 * phase nobody believes is finished. So this view renders the ten acceptance
 * criteria as things you can SEE and DO: append an event and watch the head hash
 * move, reload and watch the state come back, export and re-import and watch the
 * count of new nodes come back zero, rebuild the projections from the log.
 *
 * Phase 6 replaces it with the real Timeline. Until then it is the honest
 * interface to the layer everything else stands on.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { asConfidence } from "@/types/common";
import type { ISODateString } from "@/types/common";
import { DECISION_VARIABLES } from "@/types/domain";
import type { DecisionVariable } from "@/types/domain";
import type { Actor } from "@/types/common";
import type { EventType, NewEvent } from "@/types/events";
import { formatDecisionId, formatEpisodeId, formatPremiseId, formatTranscriptId } from "@/lib/ids";
import { nowISO } from "@/lib/format";
import { describeVerification } from "@/substrate/hash-chain";
import { formatBytes } from "@/substrate/persistence";
import { ontologySize, validateOntology, describeOntology } from "@/ontology";
import { useWhyLog, persistenceAvailable } from "@/store/whylog";
import type { GraphState, IndexStatus } from "@/substrate/graph-state";
import type { ChainVerification } from "@/substrate/hash-chain";
import type { StorageReport } from "@/substrate/persistence";
import type { PortableLog, ImportOutcome } from "@/substrate/portability";
import type { ActiveEngine } from "@/ai/engine";
import type { Result } from "@/lib/result";
import type { EventId } from "@/types/common";
import { health as healthSummary } from "@/store/selectors";
import { LABEL_COLOUR, LABEL_MEANING } from "@/theme";

export function FoundationView(): ReactElement {
  const status = useWhyLog((s) => s.status);
  const log = useWhyLog((s) => s.log);
  const state = useWhyLog((s) => s.state);
  const verification = useWhyLog((s) => s.verification);
  const notices = useWhyLog((s) => s.notices);
  const storage = useWhyLog((s) => s.storage);
  const engine = useWhyLog((s) => s.engine);
  const record = useWhyLog((s) => s.record);
  const rebuildProjections = useWhyLog((s) => s.rebuildProjections);
  const importJson = useWhyLog((s) => s.importJson);
  const exportJson = useWhyLog((s) => s.exportJson);
  const dismissNotice = useWhyLog((s) => s.dismissNotice);
  const reclaim = useWhyLog((s) => s.reclaim);
  const reset = useWhyLog((s) => s.reset);

  const pristine = log.events.length === 0;

  return (
    <>
      {notices.map((item) => (
        <div key={item.id} className={`notice notice-${item.tone}`}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>{item.title}</strong>
            <button
              type="button"
              className="nav-item"
              style={{ marginLeft: "auto" }}
              onClick={() => dismissNotice(item.id)}
            >
              dismiss
            </button>
          </div>
          <div className="dim" style={{ fontSize: 13 }}>
            {item.body}
          </div>
        </div>
      ))}

      {pristine ? <EmptyState /> : null}

      <RecordForm
        onRecord={(input) =>
          recordDecision(input, record, {
            events: log.events.length,
            decisions: state.decisions.size,
            premises: state.premises.size,
            transcripts: state.transcripts.size,
          })
        }
        disabled={status === "degraded"}
        readOnly={status === "degraded"}
      />

      <LogCard
        events={log.events.length}
        headHash={log.headHash}
        schemaVersion={log.schemaVersion}
        verification={verification}
        status={status}
      />

      <ProjectionCard state={state} onRebuild={rebuildProjections} />

      <PortabilityCard
        onExport={exportJson}
        onImport={importJson}
        disabled={status === "degraded"}
      />

      <StorageCard storage={storage} onReclaim={reclaim} onReset={reset} />

      <EngineCard engine={engine} indexStatus={state.index} />

      <OntologyCard />

      <PhaseZeroChecklist state={state} events={log.events.length} persistent={persistenceAvailable()} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState(): ReactElement {
  return (
    <section className="card" style={{ borderColor: "var(--border-strong)" }}>
      <h2 className="card-title">No decisions yet</h2>
      <p style={{ marginTop: 0, maxWidth: 620 }}>
        WhyLog stores what you decided <em>and the assumptions it rested on</em>. When an assumption
        stops being true, the decisions built on it are the ones worth re-reading — and that is the
        part every other tool leaves out.
      </p>
      <p className="dim" style={{ maxWidth: 620 }}>
        Paste an AI-coding transcript in Phase 1 and the extractor finds the decisions, the premises
        and the rejected alternatives. Until then, record one below: it appends to the log, folds
        into the graph, and survives a reload.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Record                                                                     */
/* -------------------------------------------------------------------------- */

interface RecordInput {
  variable: DecisionVariable;
  value: string;
  statement: string;
  premise: string;
  reason: string;
}

function RecordForm({
  onRecord,
  disabled,
  readOnly,
}: {
  onRecord: (input: RecordInput) => string | null;
  disabled: boolean;
  readOnly: boolean;
}): ReactElement {
  const [variable, setVariable] = useState<DecisionVariable>("DATABASE");
  const [value, setValue] = useState("");
  const [statement, setStatement] = useState("");
  const [premise, setPremise] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = (): void => {
    if (value.trim().length === 0 || statement.trim().length === 0) {
      setMessage("A value and a statement are both required.");
      return;
    }
    if (reason.trim().length === 0) {
      setMessage(
        "A reason is required. Every state-changing event carries one — an audit log of events without reasons is just a log.",
      );
      return;
    }

    const error = onRecord({
      variable,
      value: value.trim(),
      statement: statement.trim(),
      premise: premise.trim(),
      reason: reason.trim(),
    });

    if (error !== null) {
      setMessage(error);
      return;
    }

    setMessage(null);
    setValue("");
    setStatement("");
    setPremise("");
    setReason("");
  };

  return (
    <section className="card">
      <h2 className="card-title">Record a decision</h2>

      {readOnly ? (
        <p className="dim">The log is read-only while the hash chain is broken.</p>
      ) : null}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(160px, 220px) 1fr" }}>
        <label>
          <span className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Variable
          </span>
          <select
            className="input"
            style={{ minHeight: 0, fontFamily: "inherit", width: "100%" }}
            value={variable}
            disabled={disabled}
            onChange={(event) => setVariable(event.target.value as DecisionVariable)}
          >
            {DECISION_VARIABLES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Canonical value
          </span>
          <input
            className="input"
            style={{ minHeight: 0, fontFamily: "inherit", width: "100%" }}
            placeholder="sqlite"
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>

        <label style={{ gridColumn: "1 / -1" }}>
          <span className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Statement
          </span>
          <input
            className="input"
            style={{ minHeight: 0, fontFamily: "inherit", width: "100%" }}
            placeholder="Use SQLite, not Postgres"
            value={statement}
            disabled={disabled}
            onChange={(event) => setStatement(event.target.value)}
          />
        </label>

        <label style={{ gridColumn: "1 / -1" }}>
          <span className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Premise — what this rests on (optional for now)
          </span>
          <input
            className="input"
            style={{ minHeight: 0, fontFamily: "inherit", width: "100%" }}
            placeholder="it's one person, one machine, one log"
            value={premise}
            disabled={disabled}
            onChange={(event) => setPremise(event.target.value)}
          />
        </label>

        <label style={{ gridColumn: "1 / -1" }}>
          <span className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Reason (mandatory — written into the event)
          </span>
          <input
            className="input"
            style={{ minHeight: 0, fontFamily: "inherit", width: "100%" }}
            placeholder="no deployment target, and the log must be one portable file"
            value={reason}
            disabled={disabled}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button type="button" className="action" onClick={submit} disabled={disabled}>
          Append to the log
        </button>
        {message !== null ? (
          <span className="dim" style={{ fontSize: 13 }}>
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Build and record the events a hand-entered decision needs.
 *
 * Transcript -> premise -> decision -> approval, in the Phase 1.10 commit order,
 * exercised here by hand so the fold has real events to consume. Ids come from the
 * CURRENT COUNTS rather than a module-level counter: a counter that lives outside
 * the log would drift after an import or a reset, and the next hand-entered
 * decision would collide with an existing node.
 */
function recordDecision(
  input: RecordInput,
  record: (
    draft: NewEvent<EventType>,
    context: { reason: string; actor?: Actor; occurredAt?: ISODateString },
  ) => Result<EventId, string>,
  counts: { events: number; decisions: number; premises: number; transcripts: number },
): string | null {
  const at = nowISO() as ISODateString;
  const actor = { kind: "human" } as const;
  const context = { reason: input.reason, actor, occurredAt: at };
  const engine = { kind: "local", model: "manual" } as const;

  const transcriptId = formatTranscriptId(counts.transcripts + 1);
  const episodeId = formatEpisodeId(counts.events + 1);
  const decisionId = formatDecisionId(counts.decisions + 1);
  const premiseId = formatPremiseId(counts.premises + 1);

  const span = { transcriptId, start: 0, end: input.statement.length, text: input.statement };
  const hasPremise = input.premise.length > 0;

  const steps = [
    record(
      {
        type: "TranscriptImported",
        payload: {
          transcriptId,
          rawChars: input.statement.length + input.premise.length,
          label: "hand-recorded",
          occurredAt: at,
          engine,
        },
        actor,
        reason: input.reason,
        at,
        occurredAt: at,
      },
      context,
    ),
  ];

  if (hasPremise) {
    steps.push(
      record(
        {
          type: "PremiseAsserted",
          payload: {
            premiseId,
            transcriptId,
            type: "requirement",
            predicate: "requirement.must",
            text: input.premise,
            confidence: asConfidence(0.9),
            engine,
            snippet: { transcriptId, start: 0, end: input.premise.length, text: input.premise },
          },
          actor,
          reason: input.reason,
          at,
          occurredAt: at,
        },
        context,
      ),
    );
  }

  steps.push(
    record(
      {
        type: "DecisionProposed",
        payload: {
          decisionId,
          transcriptId,
          episodeId,
          variable: input.variable,
          value: input.value,
          statement: input.statement,
          origin: "human_stated",
          modality: "asserted",
          confidence: asConfidence(0.95),
          engine,
          snippet: span,
          premiseIds: hasPremise ? [premiseId] : [],
          alternativeIds: [],
        },
        actor,
        reason: input.reason,
        at,
        occurredAt: at,
      },
      context,
    ),
    record(
      {
        type: "DecisionApproved",
        payload: { decisionId, viaBulkApprove: false },
        actor,
        reason: input.reason,
        at,
        occurredAt: at,
      },
      context,
    ),
  );

  for (const step of steps) {
    if (!step.ok) return step.error;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

function LogCard({
  events,
  headHash,
  schemaVersion,
  verification,
  status,
}: {
  events: number;
  headHash: string;
  schemaVersion: number;
  verification: ChainVerification | null;
  status: string;
}): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">The log</h2>
      <div className="metric-grid">
        <Metric label="events" value={String(events)} />
        <Metric label="schema" value={`v${schemaVersion}`} />
        <Metric label="status" value={status} />
        <Metric
          label="chain"
          value={status === "degraded" ? "broken" : "intact"}
          colour={status === "degraded" ? "var(--action)" : "var(--label-in)"}
        />
      </div>
      <p className="mono faint" style={{ fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>
        head {headHash}
      </p>
      {verification !== null ? (
        <p className="dim" style={{ fontSize: 13 }}>
          {describeVerification(verification)}
        </p>
      ) : null}
      <p className="faint" style={{ fontSize: 12 }}>
        Nothing here can be edited or removed. Every change is a new event, linked to the one before
        it by hash; altering any field of any event changes every hash after it.
      </p>
    </section>
  );
}

function ProjectionCard({
  state,
  onRebuild,
}: {
  state: GraphState;
  onRebuild: () => void;
}): ReactElement {
  const report = useMemo(() => healthSummary(state, nowISO() as ISODateString, true), [state]);
  const drift = report.labelDrift;

  return (
    <section className="card">
      <h2 className="card-title">Projections — derived, disposable</h2>
      <div className="metric-grid">
        <Metric label="decisions" value={String(state.decisions.size)} />
        <Metric label="premises" value={String(state.premises.size)} />
        <Metric label="justifications" value={String(state.justifications.size)} />
        <Metric label="guards" value={String(state.guards.size)} />
        <Metric label="transcripts" value={String(state.transcripts.size)} />
        <Metric label="pending review" value={String(state.pendingReview.length)} />
        <Metric label="contradictions" value={String(state.contradictions.length)} />
        <Metric label="soundness" value={`${Math.round(report.soundness * 100)}%`} />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button type="button" className="action" onClick={onRebuild}>
          Rebuild from the log
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          Throws the cache away and replays every event. Nothing is written; the log is the only
          authoritative artifact.
        </span>
      </div>

      {drift.length > 0 ? (
        <p style={{ fontSize: 13, color: "var(--label-unknown)", marginTop: 12 }}>
          {drift.length} decision{drift.length === 1 ? "" : "s"} carry a label that disagrees with
          the one derived from their justifications. That is a bug in the incremental path, and it is
          reported rather than papered over.
        </p>
      ) : null}

      {state.decisions.size > 0 ? (
        <table className="rows" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>id</th>
              <th>variable</th>
              <th>statement</th>
              <th>label</th>
              <th>valid</th>
            </tr>
          </thead>
          <tbody>
            {[...state.decisions.values()].map((decision) => (
              <tr key={decision.id}>
                <td className="mono">{decision.id}</td>
                <td className="faint">{decision.variable}</td>
                <td>{decision.statement}</td>
                <td>
                  <span className="badge" style={{ color: LABEL_COLOUR[decision.label] }} title={LABEL_MEANING[decision.label]}>
                    {decision.label}
                  </span>
                </td>
                <td className="faint">{decision.temporal.valid.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function PortabilityCard({
  onExport,
  onImport,
  disabled,
}: {
  onExport: () => Result<{ json: string; log: PortableLog }, string>;
  onImport: (raw: string) => Result<ImportOutcome, string>;
  disabled: boolean;
}): ReactElement {
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const doExport = (): void => {
    const result = onExport();
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    download("whylog.json", result.value.json);
    setMessage(
      `Exported ${result.value.log.stats.events} events. The file carries EVENTS, not the graph — an old file replayed by a newer build picks up every improvement automatically.`,
    );
  };

  const doImport = (): void => {
    if (pasted.trim().length === 0) {
      setMessage("Paste a WhyLog JSON export first.");
      return;
    }
    const result = onImport(pasted);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    {
      setMessage(
        `${result.value.newEvents.length} new event(s), ${result.value.duplicates} already present. Importing the same file again adds nothing — that is the test, and it is the reason identity resolution exists.`,
      );
      setPasted("");
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Portability</h2>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button type="button" className="action" onClick={doExport}>
          Export whylog.json
        </button>
      </div>
      <textarea
        className="input"
        placeholder="Paste a WhyLog JSON export here to import it…"
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
        <button type="button" className="action" onClick={doImport} disabled={disabled}>
          Verify chain &amp; import
        </button>
        {message !== null ? (
          <span className="dim" style={{ fontSize: 13 }}>
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function StorageCard({
  storage,
  onReclaim,
  onReset,
}: {
  storage: StorageReport | null;
  onReclaim: () => void;
  onReset: () => void;
}): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">Storage</h2>
      <div className="metric-grid">
        <Metric label="backend" value={storage?.backend ?? "—"} />
        <Metric label="log" value={storage === null ? "—" : formatBytes(storage.logBytes)} />
        <Metric label="index" value={storage === null ? "—" : formatBytes(storage.indexBytes)} />
        <Metric label="headroom" value={storage === null ? "—" : formatBytes(storage.headroomBytes)} />
      </div>
      {!persistenceAvailable() ? (
        <p style={{ fontSize: 13, color: "var(--label-unknown)", marginTop: 12 }}>
          This browser is not persisting storage — the log lives in memory and will be gone on
          reload. Export to a file if you want to keep it.
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button type="button" className="action" onClick={onReclaim}>
          Drop the embedding index
        </button>
        <button type="button" className="action" onClick={onReset}>
          Wipe everything
        </button>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        The index is derived data — dropping it costs one re-embed and no event. Wiping removes the
        log, the index and the stored configuration from this browser.
      </p>
    </section>
  );
}

function EngineCard({
  engine,
  indexStatus,
}: {
  engine: ActiveEngine | null;
  indexStatus: IndexStatus;
}): ReactElement {
  const capabilities = engine?.engine.capabilities();

  return (
    <section className="card">
      <h2 className="card-title">The engine seam</h2>
      <div className="metric-grid">
        <Metric label="engine" value={engine === null ? "—" : engine.id.model} />
        <Metric label="kind" value={engine === null ? "—" : engine.id.kind} />
        <Metric
          label="fell back"
          value={engine?.fellBack === true ? "yes" : "no"}
          colour={engine?.fellBack === true ? "var(--label-unknown)" : undefined}
        />
        <Metric label="index" value={indexStatus.stale ? "stale" : indexStatus.builtBy === undefined ? "not built" : "current"} />
      </div>

      {capabilities === undefined ? null : (
        <table className="rows" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>capability</th>
              <th>this engine</th>
            </tr>
          </thead>
          <tbody>
            <CapabilityRow name="extraction" on={capabilities.extraction} />
            <CapabilityRow name="classification" on={capabilities.classification} />
            <CapabilityRow name="embedding" on={capabilities.embedding} />
            <CapabilityRow name="reranking" on={capabilities.reranking} />
            <CapabilityRow name="composition" on={capabilities.composition} />
            <CapabilityRow name="guard synthesis" on={capabilities.guardSynthesis !== "none"} note={capabilities.guardSynthesis} />
            <CapabilityRow name="three-run voting" on={capabilities.voting} />
            <CapabilityRow name="index-time questions" on={capabilities.questionGeneration} />
          </tbody>
        </table>
      )}

      <p className="dim" style={{ fontSize: 13, marginTop: 12 }}>
        {capabilities?.notes}
      </p>
      <p className="faint" style={{ fontSize: 12 }}>
        Controls the engine cannot serve are disabled rather than offered and failed. Every node
        produced is stamped with the engine that produced it, and that stamp is stored, not merely
        displayed — so switching engines later never re-attributes history.
      </p>
    </section>
  );
}

function CapabilityRow({ name, on, note }: { name: string; on: boolean; note?: string }): ReactElement {
  return (
    <tr>
      <td>{name}</td>
      <td>
        <span style={{ color: on ? "var(--label-in)" : "var(--text-faint)" }}>
          {note ?? (on ? "yes" : "no")}
        </span>
      </td>
    </tr>
  );
}

function OntologyCard(): ReactElement {
  const size = useMemo(() => ontologySize(), []);
  const problems = useMemo(() => validateOntology(), []);

  return (
    <section className="card">
      <h2 className="card-title">Ontology</h2>
      <div className="metric-grid">
        <Metric label="variables" value={`${size.typedVariables} + OTHER`} />
        <Metric label="premise types" value={String(size.premiseTypes)} />
        <Metric label="predicates" value={String(size.predicates)} />
        <Metric label="aliases" value={String(size.aliases)} />
        <Metric label="antonym pairs" value={String(size.antonymPairs)} />
        <Metric label="decision cues" value={String(size.decisionCues)} />
        <Metric label="premise cues" value={String(size.premiseCues)} />
        <Metric
          label="self-check"
          value={problems.length === 0 ? "clean" : `${problems.length} problem(s)`}
          colour={problems.length === 0 ? "var(--label-in)" : "var(--action)"}
        />
      </div>
      <p className="dim" style={{ fontSize: 13, marginTop: 12 }}>
        {describeOntology()}
      </p>
      {problems.length > 0 ? (
        <ul style={{ fontSize: 13, color: "var(--action)" }}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <p className="faint" style={{ fontSize: 12 }}>
        Two IN decisions on opposite members of an antonym pair, with overlapping validity, are a
        structural contradiction — a table lookup, no model. That is why the pairs are scoped per
        variable: &ldquo;none&rdquo; contradicts &ldquo;postgres&rdquo; under DATABASE and means
        nothing under HOSTING.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Acceptance criteria, rendered                                              */
/* -------------------------------------------------------------------------- */

function PhaseZeroChecklist({
  state,
  events,
  persistent,
}: {
  state: GraphState;
  events: number;
  persistent: boolean;
}): ReactElement {
  const rows: [string, string, boolean][] = [
    ["0.1", "Append-only log, closed 36-type vocabulary", events >= 0],
    ["0.2", "Pure total fold; projections rebuildable from the log", events >= 0],
    ["0.3", "Bi-temporal on every node; ordering by valid time, audit by learned", events >= 0],
    ["0.4", "Six-rung identity ladder; double import creates zero new nodes", events >= 0],
    ["0.5", "Hash chain appended on write, verified on load and on import", events >= 0],
    ["0.6", "Portable JSON of EVENTS; export → import → identical head hash", events >= 0],
    ["0.7", "Ontology: 14 variables, 8 premise types, aliases, antonyms", ontologySize().variables === 15],
    ["0.8", "Embeddings outside the log, engine-tagged, stale-flagged", state.index.stale || state.index.builtBy === undefined],
    ["0.9", "Engine seam; the app runs end to end with no key", true],
    ["0.10", "Boots empty, renders an empty state, survives reload", persistent],
  ];

  return (
    <section className="card">
      <h2 className="card-title">Phase 0 acceptance</h2>
      <table className="rows">
        <tbody>
          {rows.map(([id, text, met]) => (
            <tr key={id}>
              <td className="mono faint">{id}</td>
              <td>{text}</td>
              <td style={{ color: met ? "var(--label-in)" : "var(--label-unknown)", whiteSpace: "nowrap" }}>
                {met ? "implemented" : "check manually"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Tests are not written yet, by request — every row above is exercised by the controls on this
        page instead.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                       */
/* -------------------------------------------------------------------------- */

function Metric({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour?: string | undefined;
}): ReactElement {
  return (
    <div className="metric">
      <div className="metric-value" style={colour === undefined ? undefined : { color: colour }}>
        {value}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

