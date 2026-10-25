/**
 * The timeline view — 6.1.
 *
 * Phase 6 · sub-phase 6.1
 * Plan: plan/phase-6-presentation.md §6.1
 *
 * ---------------------------------------------------------------------------
 * ORDERED BY VALID TIME, NEVER BY LEARNED TIME
 *
 * Otherwise a pasted historical transcript appears at the top: you import a three-week-old
 * conversation and every decision in it jumps to "just now", which destroys the one thing a timeline
 * is for. Valid time is when it became true in the world; learned time is when WhyLog heard about it.
 * The timeline shows the first, the audit trail shows the second, and both are labelled wherever they
 * appear.
 *
 * ---------------------------------------------------------------------------
 * SEARCH IS THE PHASE 3 STACK, NOT A STRING MATCH
 *
 * Typing in the search box runs the real retrieval pipeline — five index levels, RRF fusion,
 * reranking — over the query, and the list re-orders by relevance rather than filtering by substring.
 * A decision phrased "we're going with sqlite" is found by searching "database choice" only because
 * the retrieval stack is doing the work; a `includes()` filter would not find it and the box would
 * feel broken.
 *
 * It runs through `retrieveOnly` rather than `ask`, because the timeline wants the ranking and not
 * prose — composing an answer for every keystroke would be slow and would put an answer where a list
 * belongs.
 *
 * ---------------------------------------------------------------------------
 * QUICK LOG GOES THROUGH THE SAME DOOR AS EVERYTHING ELSE
 *
 * §6.1's criterion: a Quick Log entry enters the same `REVISE()` cycle as an extracted one. It calls
 * `assertUserDecision`, which is the same `assertNewInformation` entry point a transcript uses — so a
 * hand-typed decision that contradicts an existing one produces the same gates, the same adjudication
 * and the same proposal as one that arrived by extraction. There is no fast path, and a fast path
 * would be a second reasoning route that nobody exercises.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { DecisionId } from "@/types/common";
import type { DecisionLabel, DecisionVariable } from "@/types/domain";
import type { GraphState } from "@/substrate/graph-state";
import { label as labelGraph, type Labelled, type NodeId } from "@/reasoning/labeller";
import { entrenchmentOf } from "@/reasoning/entrenchment";
import { guardStatusMap } from "@/guards";
import { useWhyLog } from "@/store/whylog";
import { useAsk, retrieveOnly, type RetrievalResult } from "@/store/ask";
import { assertUserDecision } from "@/store/reasoning";
import { VARIABLES } from "@/ontology";
import { DecisionCard } from "@/components/decision";
import { EmptyState, FirstRunState, StatusLegend, TimelineStatusBadge, timelineStatusOf } from "@/components/common";
import type { TimelineStatus } from "@/components/common";

interface Filters {
  variable: DecisionVariable | "all";
  status: TimelineStatus | "all";
  origin: string;
  engine: string;
  from: string;
  to: string;
  transcript: string;
}

const NO_FILTERS: Filters = {
  variable: "all",
  status: "all",
  origin: "all",
  engine: "all",
  from: "",
  to: "",
  transcript: "all",
};

export function TimelineView(): ReactElement {
  const whylog = useWhyLog();
  const ask = useAsk();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RetrievalResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<DecisionId | null>(null);
  const [quickLog, setQuickLog] = useState(false);

  const labels = useMemo(() => labelGraph(whylog.state).labels, [whylog.state]);
  const guards = useMemo(() => guardStatusMap(whylog.state), [whylog.state]);

  /* ---- search-as-you-type over the Phase 3 stack, debounced ---- */
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        const artifacts = await ask.ensureIndex();
        if (artifacts === null) {
          setSearching(false);
          return;
        }
        const outcome = await retrieveOnly(whylog.state, artifacts, trimmed);
        setResults(outcome);
        setSearching(false);
      })();
    }, 260);

    return () => window.clearTimeout(handle);
  }, [query, whylog.state, ask]);

  const rows = useMemo(() => {
    /* Search order wins when there is a search: relevance is the point of running the real
     * retrieval stack, and re-sorting its output by date would discard the ranking. */
    const ordered: DecisionId[] =
      results !== null && results.hits.length > 0
        ? results.hits.map((hit) => hit.decisionId)
        : [...whylog.state.decisions.values()]
            .sort((a, b) => byValidTime(a.temporal.valid, b.temporal.valid, a.id, b.id))
            .map((decision) => decision.id);

    return ordered.filter((id) => matches(whylog.state, labels, id, filters));
  }, [results, whylog.state, labels, filters]);

  if (whylog.state.decisions.size === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Timeline</h2>
        <FirstRunState
          onPaste={() => setQuickLog(true)}
          onDemo={() => setQuickLog(true)}
        />
      </section>
    );
  }

  const selectedDecision = selected === null ? null : whylog.state.decisions.get(selected);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">
          Timeline
          <span className="faint" style={{ marginLeft: 10, fontSize: 11, fontWeight: 400 }}>
            {rows.length} of {whylog.state.decisions.size} decision(s)
          </span>
        </h2>

        <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
          Ordered by <strong>valid time</strong> — when each decision became true in the world, not
          when WhyLog learned about it. Paste a three-week-old transcript and its decisions land where
          they belong rather than at the top.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search — runs the real retrieval stack: five levels, RRF, reranked"
            style={{ flex: 1, minWidth: 240, fontSize: 12 }}
            aria-label="Search decisions"
          />
          {searching ? <span className="faint mono" style={{ fontSize: 11 }}>searching…</span> : null}
          <button type="button" className="badge" onClick={() => setQuickLog((previous) => !previous)}>
            {quickLog ? "close quick log" : "Quick log (N)"}
          </button>
        </div>

        {results !== null ? (
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            Ranked by relevance, not date — that is what running the retrieval stack buys. Levels
            available: {results.levels.join(", ")}
            {results.levelsUnavailable.length > 0 ? " (unavailable: " + results.levelsUnavailable.join(", ") + ")" : ""} ·
            method {results.method} · {results.durationMs} ms.
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <StatusLegend />
        </div>
      </section>

      {quickLog ? <QuickLog onDone={() => setQuickLog(false)} /> : null}

      <section className="card">
        <FilterBar filters={filters} onChange={setFilters} state={whylog.state} />
      </section>

      <section className="card">
        <h2 className="card-title">Decisions</h2>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            what={"The log holds " + whylog.state.decisions.size + " decision(s) and none of them satisfy the current filters or search."}
            action="Clear the filters to see the whole timeline."
            onAction={() => {
              setFilters(NO_FILTERS);
              setQuery("");
            }}
            actionLabel="Clear filters"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {rows.map((id) => (
              <TimelineRow
                key={id}
                decisionId={id}
                labels={labels}
                selected={selected === id}
                onSelect={() => setSelected((previous) => (previous === id ? null : id))}
                rank={results !== null ? rankOf(results, id) : null}
              />
            ))}
          </div>
        )}
      </section>

      {selectedDecision !== undefined && selectedDecision !== null && selected !== null ? (
        <section className="card">
          <h2 className="card-title">Decision card</h2>
          <DecisionCard
            state={whylog.state}
            labels={labels}
            decisionId={selected}
            entrenchment={entrenchmentOf(whylog.state, selected, Date.now(), guards.get(selected))}
            onSelectPremise={() => undefined}
          />
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The row                                                                    */
/* -------------------------------------------------------------------------- */

function TimelineRow({
  decisionId,
  labels,
  selected,
  onSelect,
  rank,
}: {
  decisionId: DecisionId;
  labels: ReadonlyMap<NodeId, Labelled>;
  selected: boolean;
  onSelect: () => void;
  rank: number | null;
}): ReactElement {
  const whylog = useWhyLog();
  const decision = whylog.state.decisions.get(decisionId);

  if (decision === undefined) return <span />;

  const nodeLabel = labels.get(decisionId)?.label ?? decision.label;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderBottom: "1px solid var(--border)",
        background: selected ? "var(--surface-raised)" : "transparent",
        padding: "8px 6px",
        cursor: "pointer",
      }}
    >
      <span className="mono faint" style={{ fontSize: 11, width: 74, flexShrink: 0 }}>
        {decision.temporal.valid.slice(0, 10)}
      </span>

      <span className="mono faint" style={{ fontSize: 10, width: 62, flexShrink: 0 }}>
        {decisionId}
      </span>

      <span style={{ fontSize: 12.5, flex: 1 }}>{decision.statement}</span>

      {rank !== null ? (
        <span className="mono faint" style={{ fontSize: 10 }} title="Relevance rank from the retrieval stack">
          #{rank + 1}
        </span>
      ) : null}

      <span className="mono faint" style={{ fontSize: 10 }}>{decision.variable}</span>

      <TimelineStatusBadge status={timelineStatusOf(nodeLabel, decision.status)} />
    </button>
  );
}

function rankOf(results: RetrievalResult, id: DecisionId): number | null {
  const index = results.hits.findIndex((hit) => hit.decisionId === id);
  return index < 0 ? null : index;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

function FilterBar({
  filters,
  onChange,
  state,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  state: GraphState;
}): ReactElement {
  const origins = useMemo(() => {
    const set = new Set<string>(["all"]);
    for (const decision of state.decisions.values()) set.add(decision.provenance.origin);
    return [...set];
  }, [state]);

  const engines = useMemo(() => {
    const set = new Set<string>(["all"]);
    for (const decision of state.decisions.values()) set.add(decision.provenance.extractedBy.kind);
    return [...set];
  }, [state]);

  const transcripts = useMemo(() => {
    const set = new Set<string>(["all"]);
    for (const decision of state.decisions.values()) set.add(decision.provenance.snippet.transcriptId);
    return [...set];
  }, [state]);

  const set = (patch: Partial<Filters>): void => onChange({ ...filters, ...patch });

  return (
    <div>
      <h2 className="card-title">Filters</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
        <Select label="variable" value={filters.variable} onChange={(value) => set({ variable: value as Filters["variable"] })} options={["all", ...VARIABLES]} />
        <Select label="status" value={filters.status} onChange={(value) => set({ status: value as Filters["status"] })} options={["all", "SOUND", "UNSOUND", "UNVERIFIED", "UNFOUNDED", "CONTESTED", "SUPERSEDED"]} />
        <Select label="origin" value={filters.origin} onChange={(value) => set({ origin: value })} options={origins} />
        <Select label="engine" value={filters.engine} onChange={(value) => set({ engine: value })} options={engines} />
        <Select label="transcript" value={filters.transcript} onChange={(value) => set({ transcript: value })} options={transcripts} />

        <label className="faint" style={{ fontSize: 11 }}>
          from <input type="date" value={filters.from} onChange={(event) => set({ from: event.target.value })} style={{ fontSize: 11, marginLeft: 4 }} />
        </label>
        <label className="faint" style={{ fontSize: 11 }}>
          to <input type="date" value={filters.to} onChange={(event) => set({ to: event.target.value })} style={{ fontSize: 11, marginLeft: 4 }} />
        </label>

        <button type="button" className="badge faint" onClick={() => onChange(NO_FILTERS)}>
          reset
        </button>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
}): ReactElement {
  return (
    <label className="faint" style={{ fontSize: 11 }}>
      {label}{" "}
      <select value={value} onChange={(event) => onChange(event.target.value)} style={{ fontSize: 11, marginLeft: 4 }}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function matches(
  state: GraphState,
  labels: ReadonlyMap<NodeId, Labelled>,
  id: DecisionId,
  filters: Filters,
): boolean {
  const decision = state.decisions.get(id);
  if (decision === undefined) return false;

  if (filters.variable !== "all" && decision.variable !== filters.variable) return false;
  if (filters.origin !== "all" && decision.provenance.origin !== filters.origin) return false;
  if (filters.engine !== "all" && decision.provenance.extractedBy.kind !== filters.engine) return false;
  if (filters.transcript !== "all" && decision.provenance.snippet.transcriptId !== filters.transcript) return false;
  if (filters.from.length > 0 && decision.temporal.valid.slice(0, 10) < filters.from) return false;
  if (filters.to.length > 0 && decision.temporal.valid.slice(0, 10) > filters.to) return false;

  if (filters.status !== "all") {
    const nodeLabel = labels.get(id)?.label ?? decision.label;
    if (timelineStatusOf(nodeLabel, decision.status) !== filters.status) return false;
  }

  return true;
}

function byValidTime(validA: string, validB: string, idA: string, idB: string): number {
  /* Descending by valid time — newest first, as a timeline reads. Ties break by id so the order is
   * stable across renders: a list that re-shuffles when nothing changed looks broken. */
  if (validA === validB) return idA < idB ? -1 : idA > idB ? 1 : 0;
  return validA > validB ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Quick log                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A ten-second manual entry for someone mid-flow.
 *
 * It skips EXTRACTION — there is no transcript to read — but not resolution and not revision. The
 * entry goes through `assertUserDecision`, which is the same assertion entry point a transcript uses,
 * so a hand-typed decision that contradicts an existing one produces the same gates, the same
 * adjudication and the same proposal.
 *
 * A reason is mandatory and the function refuses without one, because a hand-entered decision's
 * reason is the only provenance it will ever have: there is no snippet to point at.
 */
function QuickLog({ onDone }: { onDone: () => void }): ReactElement {
  const [variable, setVariable] = useState<DecisionVariable>("OTHER");
  const [value, setValue] = useState("");
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setNote(null);

    const outcome = await assertUserDecision(variable, value.trim(), statement.trim(), reason.trim());

    setBusy(false);

    if (!outcome.ok) {
      setNote(outcome.error);
      return;
    }

    setNote(outcome.value);
    setValue("");
    setStatement("");
    setReason("");
    onDone();
  };

  return (
    <section className="card">
      <h2 className="card-title">Quick log</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        For a decision you just made and do not want to lose. It skips extraction — there is no
        transcript — but it goes through the same <span className="mono">REVISE()</span> cycle as an
        extracted one, so it is checked against what the log already holds.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="faint" style={{ fontSize: 11 }}>
          variable
          <select value={variable} onChange={(event) => setVariable(event.target.value as DecisionVariable)} style={{ display: "block", fontSize: 12, marginTop: 3 }}>
            {VARIABLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="faint" style={{ fontSize: 11 }}>
          value
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="sqlite" style={{ display: "block", fontSize: 12, marginTop: 3 }} />
        </label>
      </div>

      <input
        value={statement}
        onChange={(event) => setStatement(event.target.value)}
        placeholder="Use SQLite, not Postgres"
        style={{ width: "100%", fontSize: 12, marginTop: 8 }}
      />

      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="why — required; this is the only provenance a hand-entered decision will ever have"
        style={{ width: "100%", fontSize: 12, marginTop: 8 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="badge"
          disabled={busy || statement.trim().length === 0 || value.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Running the cycle…" : "Record it"}
        </button>
        <button type="button" className="badge faint" onClick={onDone}>
          cancel
        </button>
      </div>

      {note !== null ? (
        <div className="notice notice-info" style={{ marginTop: 10, fontSize: 12 }}>
          {note}
        </div>
      ) : null}
    </section>
  );
}
