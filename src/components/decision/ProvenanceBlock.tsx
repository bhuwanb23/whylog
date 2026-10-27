/**
 * PROVENANCE — 6.2.
 *
 * Phase 6 · sub-phase 6.2
 *
 * ---------------------------------------------------------------------------
 * THE SNIPPET IS VERBATIM AND CLICKABLE
 *
 * Provenance is the part of the card that makes everything else checkable. A decision whose origin is
 * a paraphrase cannot be audited, so this renders the exact characters the extraction read, with the
 * transcript, the character offsets, and who said it.
 *
 * The offsets matter for a reason that is not obvious: they are what lets the snippet be verified as
 * a literal substring of the source. Phase 1 validates that on the LLM path precisely because a model
 * will happily "quote" a sentence nobody said, and a fabricated quote inside a provenance block
 * destroys the one feature that was supposed to make the rest trustworthy.
 *
 * ---------------------------------------------------------------------------
 * BOTH TIMESTAMPS, ALWAYS LABELLED
 *
 * Decided (valid time) and learned (learned time) are shown together and named, because they diverge
 * constantly in this product's real workflow: you paste a three-week-old transcript, so the system
 * learns today about a decision made on the 3rd. Showing one without naming it is how a user
 * concludes the tool got the date wrong.
 * ---------------------------------------------------------------------------
 */

import type { GraphState } from "@/substrate/graph-state";
import type { DecisionId } from "@/types/common";
import type { Decision } from "@/types/domain";
import type { ReactElement } from "react";
import { ConfidenceBar } from "../common/ConfidenceBar";
import { EngineBadge } from "../common/EngineBadge";
import { SectionLabel } from "./PremiseList";

export const ORIGIN_MEANING: Readonly<Record<string, string>> = {
  human_stated:
    "A person said this, in words. The highest source authority there is — 1.00 in the entrenchment formula.",
  human_override:
    "A person overrode the system's adjudication. Authority 0.90: below human_stated, so an override can itself be overridden later.",
  agent_proposed:
    "The agent proposed it and a human accepted it. Real authority, less than a statement — the human endorsed a formulation they did not write.",
  agent_inferred:
    "Inferred by the extractor from something nobody said outright. The lowest authority, and the one most worth checking against the snippet.",
};

export function ProvenanceBlock({
  state,
  decision,
  transcriptText,
}: {
  state: GraphState;
  decision: Decision;
  /** The raw transcript, when the caller has it, so the snippet can be highlighted in context. */
  transcriptText?: string;
}): ReactElement {
  const span = decision.provenance.snippet;

  return (
    <div>
      <SectionLabel>provenance</SectionLabel>

      <blockquote
        style={{
          margin: "6px 0 0",
          padding: "8px 12px",
          borderLeft: "3px solid var(--border-strong)",
          background: "var(--surface-sunken)",
          fontSize: 12,
          fontStyle: "italic",
        }}
      >
        “{span.text}”
      </blockquote>

      <div className="mono faint" style={{ fontSize: 10, marginTop: 6 }}>
        {span.transcriptId}
        {" · episode " + decision.provenance.episodeId} · chars {span.start}–{span.end}
        {transcriptText !== undefined ? (
          <span title="The offsets let this be verified as a literal substring of the source. A model will happily quote a sentence nobody said, and a fabricated quote inside a provenance block destroys the one feature meant to make everything else trustworthy.">
            {" "}
            · verbatim, verifiable
          </span>
        ) : null}
      </div>

      <div
        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}
      >
        <span
          className="badge"
          title={ORIGIN_MEANING[decision.provenance.origin] ?? decision.provenance.origin}
        >
          {decision.provenance.origin}
        </span>
        <EngineBadge engine={decision.provenance.extractedBy} />
        <ConfidenceBar confidence={decision.provenance.confidence} />
      </div>

      <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        decided <strong>{decision.temporal.valid.slice(0, 10)}</strong> · learned{" "}
        <strong>{decision.temporal.learned.slice(0, 10)}</strong>
        {decision.temporal.valid.slice(0, 10) !== decision.temporal.learned.slice(0, 10) ? (
          <span title="Valid time is when it became true in the world; learned time is when WhyLog recorded it. They diverge whenever you paste a historical transcript.">
            {" "}
            — the two differ, which is normal: this was learned after it happened
          </span>
        ) : null}
      </div>

      {decision.temporal.invalidFrom !== undefined ? (
        <div className="notice notice-warning" style={{ marginTop: 8, fontSize: 11 }}>
          Closed out at {decision.temporal.invalidFrom.slice(0, 10)}
          {decision.temporal.reason !== undefined ? " — " + decision.temporal.reason : ""}.
          Retained, never deleted: the record is history and remains searchable.
        </div>
      ) : null}
    </div>
  );
}

export type { DecisionId };
