/**
 * The Ask view — 3.10.
 *
 * Phase 3 · sub-phase 3.10
 * Plan: plan/phase-3-retrieval.md §3.10
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS VIEW HAS TO SHOW, AND WHY EACH PART IS NOT OPTIONAL
 *
 *   the verdict banner        GROUNDED / PARTIAL / INSUFFICIENT_EVIDENCE, before the prose.
 *                             Epistemic status first, because a reader who meets the answer
 *                             before its status will have already believed it.
 *   the claims, marked        which sentences rest on a citation and which were inferred.
 *                             PARTIAL is meaningless unless the reader can see WHICH part.
 *   groundedness              the number, and the arithmetic behind it (n of m claims).
 *   the citations, expanded   premises WITH LIVE LABELS, excluded conditions, rejected
 *                             alternatives, guards, provenance. This is the differentiator:
 *                             a source link is what everyone shows; the `given` is what only
 *                             WhyLog has.
 *   the run trace             every search, why it ran, what came back, and why it stopped.
 *   the pre-emption           "you already rejected this, here's why, and here's whether that
 *                             reason still holds" — shown ABOVE the answer when the reason
 *                             has expired, because that is the case the user most needs.
 *   how it was produced       the reranker's five weights, the contract, the thresholds, the
 *                             classifier's rules. The weights MUST be inspectable: a ranking
 *                             nobody can read is a ranking nobody can argue with.
 *
 * ---------------------------------------------------------------------------
 * KEYLESS, AND IT SAYS SO
 *
 * Everything here works with no API key. The local engine composes from templates and the
 * answer carries that disclosure, because a flat answer must not be mistaken for a flat
 * question. Which levels ran is shown too: with no embeddings, L1 and L2 drop out and L3/L4/L5
 * carry the run, and a user who cannot see that cannot tell a thin answer from a thin log.
 *
 * ---------------------------------------------------------------------------
 * COLOUR ENCODES EPISTEMIC STATUS, NEVER SEVERITY
 *
 * The house rule from Phase 0. INSUFFICIENT_EVIDENCE is not rendered as an error: it is a
 * complete, honest answer, and painting it red would train the user to read refusal as
 * failure — after which they would stop trusting refusals, which is the opposite of what the
 * evidence contract is for. Red is reserved for "an action is available".
 * ---------------------------------------------------------------------------
 */

import { NEAREST_RELATED_LIMIT, TOPICALITY_FLOOR } from "@/retrieval/answer";
import { MAX_SEARCHES } from "@/retrieval/evidence-contract";
import { GROUNDED_FLOOR, PARTIAL_FLOOR } from "@/retrieval/groundedness";
import { RERANK_WEIGHTS } from "@/retrieval/rerank";
import { RRF_K } from "@/retrieval/rrf";
import {
  type ExpandedCitationResult,
  describeHowProduced,
  describeIndex,
  describePreemptionCoverage,
  renderExpansion,
  useAsk,
} from "@/store/ask";
import { useWhyLog } from "@/store/whylog";
import { LABEL_BACKGROUND, LABEL_COLOUR, LABEL_MEANING } from "@/theme";
import type { DecisionId } from "@/types/common";
import type { DecisionLabel } from "@/types/domain";
import type { Answer, Claim, GroundednessVerdict, RetrievedHit } from "@/types/retrieval";
import { type ReactElement, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/* Gate G3                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The two questions gate G3 is defined by.
 *
 * G3 passes when the ANSWERABLE one comes back GROUNDED with citations that expand to
 * premises and labels, and the UNANSWERABLE one comes back INSUFFICIENT_EVIDENCE with the
 * nearest related decisions offered and no invented answer. Both halves are required: a
 * system that answers everything passes the first and fails the second, and the second is the
 * one that decides whether the evidence contract is real or decorative.
 *
 * They are rendered as buttons rather than documented in a note, because a gate the user has
 * to reconstruct from the plan is a gate that does not get run.
 */
const G3_QUESTIONS: readonly { question: string; expect: GroundednessVerdict; why: string }[] = [
  {
    question: "Why did we choose SQLite over Postgres?",
    expect: "GROUNDED",
    why: "Answerable from the fixture corpus. Expect GROUNDED, with citations that expand to the premises the decision rests on and their live labels.",
  },
  {
    question: "What did we decide about the payment provider?",
    expect: "INSUFFICIENT_EVIDENCE",
    why: "Not in the corpus. Expect a refusal that says what is missing and offers the nearest related decisions — NOT an invented answer. This half is the one that decides whether the evidence contract is real.",
  },
];

/* -------------------------------------------------------------------------- */
/* The verdict palette                                                        */
/* -------------------------------------------------------------------------- */

const VERDICT_STYLE: Readonly<Record<GroundednessVerdict, { colour: string; meaning: string }>> = {
  GROUNDED: {
    colour: "var(--label-in)",
    meaning: "Every claim points at a decision the log contains and this run retrieved.",
  },
  PARTIAL: {
    colour: "var(--label-unknown)",
    meaning:
      "Some claims are grounded and some were inferred. The inferred ones are marked, because a reader cannot tell which sentence was invented unless the answer says.",
  },
  INSUFFICIENT_EVIDENCE: {
    colour: "var(--label-out)",
    meaning:
      "The log does not support an answer to this. Refusing is a complete answer here, not a failure — the nearest related decisions are offered instead.",
  },
};

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function AskView(): ReactElement {
  const whylog = useWhyLog();
  const ask = useAsk();
  const [draft, setDraft] = useState("");
  const [showHow, setShowHow] = useState(false);

  const busy = ask.status === "asking" || ask.status === "building";
  const answer = ask.answer;

  const logSize = whylog.state.decisions.size;
  const preemptionCoverage = useMemo(
    () => describePreemptionCoverage(whylog.state),
    [whylog.state],
  );

  const submit = (): void => {
    const question = draft.trim();
    if (question.length === 0 || busy) return;
    void ask.ask(question);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <h2 className="card-title">Ask the log</h2>

        <p className="dim" style={{ margin: "0 0 12px" }}>
          Natural-language questions over your decisions, answered under an evidence contract: at
          most {MAX_SEARCHES} searches, every citation checked against what this run retrieved, and
          "insufficient evidence" as a first-class answer. Works with no API key.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            }}
            rows={2}
            placeholder={
              logSize === 0
                ? "The log is empty — paste a transcript on the Foundation tab first."
                : "e.g. why did we choose SQLite?  ·  what did we decide about hosting?  ·  did we ever consider Postgres?"
            }
            disabled={busy}
            style={{ flex: 1, resize: "vertical" }}
          />
          <button
            type="button"
            className="badge"
            onClick={submit}
            disabled={busy || draft.trim().length === 0}
          >
            {ask.status === "asking" ? "Searching…" : "Ask"}
          </button>
        </div>

        <div className="faint" style={{ marginTop: 6, fontSize: 11 }}>
          ⌘/Ctrl + Enter to ask. {logSize} decision(s) in the log.
        </div>

        <div
          style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--edge-soft, #333)" }}
        >
          <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>
            GATE G3 — both halves must pass. Run them in order:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {G3_QUESTIONS.map((entry) => (
              <div
                key={entry.question}
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <button
                  type="button"
                  className="badge"
                  disabled={busy}
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    setDraft(entry.question);
                    void ask.ask(entry.question);
                  }}
                >
                  ask
                </button>
                <div>
                  <div style={{ fontSize: 12 }}>{entry.question}</div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                    expects <span className="mono">{entry.expect}</span> — {entry.why}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {ask.status === "building" ? (
          <div className="notice notice-info" style={{ marginTop: 12 }}>
            Building the index… L3, L4 and L5 are pure functions of the log; L1 and L2 need
            embeddings, which are computed once and reused for every question.
          </div>
        ) : null}

        {ask.error !== null ? (
          <div className="notice notice-error" style={{ marginTop: 12 }}>
            {ask.error}
          </div>
        ) : null}

        {ask.buildError !== null ? (
          <div className="notice notice-warning" style={{ marginTop: 12 }}>
            {ask.buildError}
          </div>
        ) : null}
      </section>

      {answer !== null ? <AnswerPanel answer={answer} /> : null}

      {answer === null && ask.status !== "failed" ? (
        <EmptyState logSize={logSize} coverage={preemptionCoverage} />
      ) : null}

      <section className="card">
        <h2 className="card-title">
          How this was produced
          <button
            type="button"
            className="badge"
            style={{ marginLeft: 8 }}
            onClick={() => setShowHow((previous) => !previous)}
          >
            {showHow ? "hide" : "show"}
          </button>
        </h2>

        {!showHow ? (
          <p className="dim" style={{ margin: 0 }}>
            Five index levels fused by RRF at k = {RRF_K}, then reranked by{" "}
            {Object.entries(RERANK_WEIGHTS)
              .map(([name, weight]) => name + " " + weight)
              .join(" · ")}
            . Every weight, threshold and rule is listed here rather than tuned behind your back.
          </p>
        ) : (
          <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
            {describeHowProduced(ask, null)}
          </pre>
        )}
      </section>

      <IndexCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The answer                                                                 */
/* -------------------------------------------------------------------------- */

function AnswerPanel({ answer }: { answer: Answer }): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<DecisionId>>(new Set());

  const toggle = (id: DecisionId): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <section className="card">
        <VerdictBanner answer={answer} />

        <pre
          className="mono"
          style={{ whiteSpace: "pre-wrap", margin: "12px 0 0", fontSize: 12, lineHeight: 1.6 }}
        >
          {answer.text}
        </pre>

        <div className="faint" style={{ marginTop: 10, fontSize: 11 }}>
          {answer.engine.model.length === 0 ? answer.engine.kind : answer.engine.model} · answered{" "}
          {answer.answeredAt} · {answer.trace.searches.length} of {answer.trace.maxSearches}{" "}
          searches · {answer.retrieved.length} candidates ranked
        </div>
      </section>

      <ClaimsCard
        claims={answer.claims}
        groundedness={answer.groundedness}
        notes={answer.ungroundedNotes}
      />

      <CitationsCard answer={answer} expanded={expanded} toggle={toggle} />

      <TraceCard answer={answer} />

      {answer.nearestRelated !== undefined && answer.nearestRelated.length > 0 ? (
        <NearestRelatedCard hits={answer.nearestRelated} verdict={answer.verdict} />
      ) : null}

      <RankingCard hits={answer.retrieved} />
    </>
  );
}

function VerdictBanner({ answer }: { answer: Answer }): ReactElement {
  const style = VERDICT_STYLE[answer.verdict];
  const percent = (answer.groundedness * 100).toFixed(0);

  return (
    <div
      style={{
        borderLeft: "3px solid " + style.colour,
        padding: "8px 12px",
        background: "color-mix(in srgb, " + style.colour + " 8%, transparent)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: style.colour }}>{answer.verdict}</strong>
        <span className="mono" style={{ fontSize: 12 }}>
          {answer.claims.length === 0
            ? "no claims made"
            : percent +
              "% grounded · " +
              groundedCount(answer) +
              " of " +
              answer.claims.length +
              " claims"}
        </span>
      </div>
      <div className="dim" style={{ marginTop: 4, fontSize: 12 }}>
        {style.meaning}
      </div>
    </div>
  );
}

function groundedCount(answer: Answer): number {
  return answer.claims.filter((claim) => claim.grounded).length;
}

/* -------------------------------------------------------------------------- */
/* Claims                                                                     */
/* -------------------------------------------------------------------------- */

function ClaimsCard({
  claims,
  groundedness,
  notes,
}: {
  claims: readonly Claim[];
  groundedness: number;
  notes: readonly string[] | undefined;
}): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">Claims · {(groundedness * 100).toFixed(0)}% grounded</h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        groundedness = |claims with ≥1 resolving citation| / |total claims|. ≥{" "}
        {(GROUNDED_FLOOR * 100).toFixed(0)}% is GROUNDED, {(PARTIAL_FLOOR * 100).toFixed(0)}–
        {(GROUNDED_FLOOR * 100).toFixed(0)}% is PARTIAL, below that is INSUFFICIENT_EVIDENCE. A
        claim is grounded only if one of ITS OWN citations resolved in this run.
      </p>

      {claims.length === 0 ? (
        <div className="notice notice-info">
          This answer makes no claims. 0/0 is not treated as perfectly grounded — that would make
          "say nothing" the optimal answer.
        </div>
      ) : (
        <ol
          style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}
        >
          {claims.map((claim, index) => (
            <li key={claim.text.slice(0, 40) + String(index)} style={{ fontSize: 12 }}>
              <span
                className="badge"
                style={{
                  marginRight: 8,
                  color: claim.grounded ? "var(--label-in)" : "var(--label-unknown)",
                }}
                title={
                  claim.grounded
                    ? "At least one of this claim's citations resolved to a decision retrieved in this run."
                    : "None of this claim's citations resolved. Read it as a hypothesis, not as a record."
                }
              >
                {claim.grounded ? "grounded" : "inferred"}
              </span>
              {claim.text}
              {claim.citations.length > 0 ? (
                <span className="mono faint" style={{ marginLeft: 6, fontSize: 11 }}>
                  [{claim.citations.join(", ")}]
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {notes !== undefined && notes.length > 0 ? (
        <div className="notice notice-warning" style={{ marginTop: 12 }}>
          <strong>Why some claims are not grounded</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {notes.map((note) => (
              <li key={note} style={{ fontSize: 12 }}>
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Citations, expanded                                                        */
/* -------------------------------------------------------------------------- */

function CitationsCard({
  answer,
  expanded,
  toggle,
}: {
  answer: Answer;
  expanded: ReadonlySet<DecisionId>;
  toggle: (id: DecisionId) => void;
}): ReactElement {
  const ask = useAsk();
  const byId = useMemo(() => {
    const map = new Map<DecisionId, ExpandedCitationResult>();
    for (const entry of ask.expansions) map.set(entry.decision.id, entry);
    return map;
  }, [ask.expansions]);

  const unresolved = answer.citations.filter((citation) => !citation.resolvedInRun);

  return (
    <section className="card">
      <h2 className="card-title">
        Citations · {answer.citations.length}
        {unresolved.length > 0 ? " · " + unresolved.length + " unresolved" : ""}
      </h2>

      <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
        A citation is valid ONLY if it points to a decision retrieved in THIS run — not merely one
        that exists in the log. Expand any citation to see the argument it stands for: the premises
        it rests on with their live labels, the conditions it excludes, what was rejected and why,
        its guards, and its provenance.
      </p>

      {unresolved.length > 0 ? (
        <div className="notice notice-warning" style={{ marginBottom: 10 }}>
          {unresolved.length} citation(s) point at decisions this run never retrieved:{" "}
          <span className="mono">{unresolved.map((c) => c.decisionId).join(", ")}</span>. They are
          counted as unresolved, not silently dropped and not silently credited.
        </div>
      ) : null}

      {ask.missingCitations.length > 0 ? (
        <div className="notice notice-error" style={{ marginBottom: 10 }}>
          {ask.missingCitations.length} cited decision(s) do not exist in the log at all:{" "}
          <span className="mono">{ask.missingCitations.join(", ")}</span>. This should not happen —
          a citation that resolved in-run must exist.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...byId.values()].map((entry) => (
          <ExpandedCitationRow
            key={entry.decision.id}
            entry={entry}
            open={expanded.has(entry.decision.id)}
            selected={ask.selected === entry.decision.id}
            onToggle={() => toggle(entry.decision.id)}
            onSelect={() => ask.select(entry.decision.id)}
          />
        ))}

        {byId.size === 0 ? (
          <div className="faint" style={{ fontSize: 12 }}>
            No citations to expand.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ExpandedCitationRow({
  entry,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  entry: ExpandedCitationResult;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}): ReactElement {
  return (
    <div
      style={{
        border: "1px solid " + (selected ? "var(--action)" : "var(--edge-soft, #333)"),
        borderRadius: 4,
        padding: "8px 10px",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <LabelPill label={entry.label} />
        <span className="mono" style={{ fontSize: 12 }}>
          {entry.decision.id}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.decision.statement}</span>
        <button type="button" className="badge" style={{ marginLeft: "auto" }} onClick={onToggle}>
          {open ? "collapse" : "expand"}
        </button>
        <button type="button" className="badge" onClick={onSelect}>
          {selected ? "selected" : "select"}
        </button>
      </div>

      <div className="faint" style={{ marginTop: 4, fontSize: 11 }}>
        rests on {entry.restsOn.length} premise(s) · excludes {entry.excludes.length} · rejected{" "}
        {entry.rejected.length} alternative(s) · {entry.guardsPassing} of {entry.guardsTotal}{" "}
        guard(s) passing
        {entry.guardsNeverRun > 0 ? " · " + entry.guardsNeverRun + " never run" : ""}
      </div>

      {entry.restsOn.length === 0 ? (
        <div className="notice notice-warning" style={{ marginTop: 8, fontSize: 12 }}>
          This decision has NO recorded premise. Nothing can falsify it, so the log can report what
          was decided but cannot report whether it still holds — a gap worth filling on the Review
          tab.
        </div>
      ) : null}

      {entry.labelsFromFallback > 0 ? (
        <div className="notice notice-warning" style={{ marginTop: 8, fontSize: 12 }}>
          {entry.labelsFromFallback} premise label(s) came from the stored value because the
          labeller had no entry for them. Treat those labels as possibly stale.
        </div>
      ) : null}

      {open ? (
        <pre
          className="mono"
          style={{
            whiteSpace: "pre-wrap",
            margin: "10px 0 0",
            fontSize: 11,
            lineHeight: 1.55,
            borderTop: "1px solid var(--edge-soft, #333)",
            paddingTop: 8,
          }}
        >
          {renderExpansion(entry)}
        </pre>
      ) : null}
    </div>
  );
}

function LabelPill({ label }: { label: DecisionLabel }): ReactElement {
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
/* The run trace                                                              */
/* -------------------------------------------------------------------------- */

function TraceCard({ answer }: { answer: Answer }): ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <section className="card">
      <h2 className="card-title">
        Run trace · {answer.trace.searches.length} of {answer.trace.maxSearches} searches
        {answer.trace.boundedOut ? " · BUDGET EXHAUSTED" : ""}
        <button
          type="button"
          className="badge"
          style={{ marginLeft: 8 }}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "hide" : "show"}
        </button>
      </h2>

      {answer.trace.boundedOut ? (
        <div className="notice notice-warning" style={{ marginBottom: 10 }}>
          The search budget ran out while the answer was still short of evidence. That is different
          from "searched and found nothing", and the remedy differs: this one needs a narrower
          question, that one needs a fuller log.
        </div>
      ) : null}

      {open ? (
        <>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {answer.trace.searches.map((step, index) => (
              <li key={String(index) + step.query.slice(0, 24)} style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 11 }}>
                  levels {step.levels.join(", ")} · returned {step.returned} · top score{" "}
                  {step.topScore.toFixed(3)}
                </div>
                <div style={{ marginTop: 2 }}>
                  <span className="faint">query: </span>
                  <span className="mono">{step.query}</span>
                </div>
                <div className="dim" style={{ marginTop: 2 }}>
                  {step.why}
                </div>
              </li>
            ))}
          </ol>

          <div
            className="dim"
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid var(--edge-soft, #333)",
              fontSize: 12,
            }}
          >
            <strong>Why the search stopped: </strong>
            {answer.trace.sufficiencyAssessment}
          </div>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Nearest related, on refusal                                                */
/* -------------------------------------------------------------------------- */

function NearestRelatedCard({
  hits,
  verdict,
}: {
  hits: readonly RetrievedHit[];
  verdict: GroundednessVerdict;
}): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">
        {verdict === "INSUFFICIENT_EVIDENCE" ? "Nearest related — NOT an answer" : "Also retrieved"}
      </h2>

      {verdict === "INSUFFICIENT_EVIDENCE" ? (
        <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
          These are the closest decisions the log has. They did not clear the topicality floor of{" "}
          {TOPICALITY_FLOOR}, so they are offered as context and explicitly not composed into an
          answer. Up to {NEAREST_RELATED_LIMIT} are shown.
        </p>
      ) : null}

      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        {hits.map((hit) => (
          <li key={hit.decisionId} style={{ fontSize: 12 }}>
            <span className="mono faint">{hit.decisionId}</span> · {hit.decision.statement}
            <span className="mono faint" style={{ marginLeft: 6, fontSize: 11 }}>
              score {hit.finalScore.toFixed(3)} · matched on {hit.matchedOn.join(", ") || "—"}
              {hit.promoted ? " · promoted" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The ranking                                                                */
/* -------------------------------------------------------------------------- */

function RankingCard({ hits }: { hits: readonly RetrievedHit[] }): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <section className="card">
      <h2 className="card-title">
        Ranking · {hits.length} returned
        <button
          type="button"
          className="badge"
          style={{ marginLeft: 8 }}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "hide" : "show"}
        </button>
      </h2>

      {!open ? (
        <p className="dim" style={{ margin: 0, fontSize: 12 }}>
          Five levels fused by RRF at k = {RRF_K}, then reranked. Promoted hits are held at the
          front and the reranker cannot demote them: an exact structural or premise match is a fact,
          not a rank, and averaging a fact into a statistical consensus is backwards.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr className="faint" style={{ textAlign: "left", fontSize: 11 }}>
              <th style={{ padding: "4px 6px" }}>#</th>
              <th style={{ padding: "4px 6px" }}>decision</th>
              <th style={{ padding: "4px 6px" }}>final</th>
              <th style={{ padding: "4px 6px" }}>RRF</th>
              <th style={{ padding: "4px 6px" }}>rerank</th>
              <th style={{ padding: "4px 6px" }}>matched on</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, index) => (
              <tr key={hit.decisionId} style={{ borderTop: "1px solid var(--edge-soft, #333)" }}>
                <td className="mono faint" style={{ padding: "4px 6px" }}>
                  {index + 1}
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <span className="mono faint">{hit.decisionId}</span> {hit.decision.statement}
                  {hit.promoted ? (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      promoted
                    </span>
                  ) : null}
                </td>
                <td className="mono" style={{ padding: "4px 6px" }}>
                  {hit.finalScore.toFixed(3)}
                </td>
                <td className="mono faint" style={{ padding: "4px 6px" }}>
                  {hit.rrf.toFixed(4)}
                </td>
                <td className="mono faint" style={{ padding: "4px 6px" }}>
                  {hit.rerankScore === undefined ? "—" : hit.rerankScore.toFixed(3)}
                </td>
                <td className="mono faint" style={{ padding: "4px 6px" }}>
                  {hit.matchedOn.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState({ logSize, coverage }: { logSize: number; coverage: string }): ReactElement {
  return (
    <section className="card">
      <h2 className="card-title">Before you ask</h2>

      {logSize === 0 ? (
        <div className="notice notice-info">
          The log is empty. Paste a transcript on the Foundation tab and the decisions in it become
          searchable — extraction runs keyless on the local engine.
        </div>
      ) : (
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">decisions</div>
            <div className="metric-value">{logSize}</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>Rejected-alternative pre-emption</h3>
        <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
          {coverage}
        </pre>
        <p className="dim" style={{ margin: "8px 0 0", fontSize: 12 }}>
          When a question matches something you already REJECTED, the answer leads with the
          rejection, the reason, and whether that reason still holds — catching the mistake before
          the decision instead of after it. This is only possible because alternatives are indexed
          first-class; a tool that stores decisions and not the things it turned down cannot produce
          that sentence at any retrieval quality.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The index                                                                  */
/* -------------------------------------------------------------------------- */

function IndexCard(): ReactElement {
  const ask = useAsk();
  const whylog = useWhyLog();
  const [open, setOpen] = useState(false);

  const stale = ask.artifacts?.stale ?? false;

  return (
    <section className="card">
      <h2 className="card-title">
        Index
        {stale ? (
          <span className="badge" style={{ marginLeft: 8, color: "var(--label-out)" }}>
            STALE
          </span>
        ) : null}
        <button
          type="button"
          className="badge"
          style={{ marginLeft: 8 }}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "hide" : "show"}
        </button>
        <button
          type="button"
          className="badge"
          style={{ marginLeft: 6 }}
          disabled={ask.status === "building" || whylog.engine === null}
          onClick={() => void ask.buildTheIndex()}
        >
          rebuild
        </button>
      </h2>

      {stale ? (
        <div className="notice notice-warning" style={{ marginBottom: 10 }}>
          The embeddings were built by a different engine, or the log has changed since. L3, L4 and
          L5 still work — they are pure functions of the log — but L1 and L2 will return nothing
          until you rebuild. Rebuilding embeds only the decisions whose text changed.
        </div>
      ) : null}

      {open ? (
        <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
          {describeIndex(ask)}
        </pre>
      ) : (
        <p className="dim" style={{ margin: 0, fontSize: 12 }}>
          {ask.artifacts === null
            ? "No index yet. It is built automatically on your first question."
            : "Built by " +
              ask.artifacts.engine +
              " · " +
              ask.artifacts.dimensions +
              " dimensions · " +
              (ask.artifacts.stale ? "stale" : "current") +
              "."}
        </p>
      )}
    </section>
  );
}
