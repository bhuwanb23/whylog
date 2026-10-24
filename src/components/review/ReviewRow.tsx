/**
 * One review row — the unit the queue is built from.
 *
 * Phase 1 · sub-phase 1.9
 *
 * ---------------------------------------------------------------------------
 * THE ROW IS WHERE THE 13:1 RATIO IS PAID
 *
 * ARGUS measured 155 false positives against 12 false negatives (docs/05 §4), so a
 * review surface is judged on how fast it lets you say NO. Three properties of this
 * row serve that:
 *
 *   • it renders ONE LINE when collapsed, and low-tier items arrive collapsed
 *   • approve / edit / discard are always visible, never behind a menu
 *   • the decision is recorded the moment the button is pressed — there is no
 *     "pending changes" state to lose track of
 *
 * An item with no verifiable quote says so in a warning rather than rendering an
 * empty box: `snippet-validation.ts` dropped the span because the engine's text was
 * not a literal substring, and a blank quote area reads like a rendering bug.
 * ---------------------------------------------------------------------------
 */

import {
  type ReviewItem,
  TIER_HINTS,
  approve,
  contest,
  describeAction,
  discard,
  edit,
} from "@/extraction";
import { useExtraction } from "@/store/extraction";
import { type ReactElement, useEffect, useState } from "react";
import { TIER_COLOUR } from "./tier-colour";

/* -------------------------------------------------------------------------- */

export function ReviewRow({
  item,
  selected,
  editing,
  onSelect,
  onCloseEdit,
}: {
  readonly item: ReviewItem;
  readonly selected: boolean;
  readonly editing: boolean;
  readonly onSelect: () => void;
  readonly onCloseEdit: () => void;
}): ReactElement {
  const act = useExtraction((s) => s.act);
  const [open, setOpen] = useState(item.expanded);
  const [draft, setDraft] = useState(item.detail);
  const [reason, setReason] = useState("");

  // The tier decides the DEFAULT, not the possibility: a collapsed row can still be
  // opened, and an expanded one can still be collapsed.
  /* biome-ignore lint/correctness/useExhaustiveDependencies: `item.key` is not read in the body
     on purpose. The list re-keys its rows, so the same component instance can be handed a
     DIFFERENT item with the same `expanded` value; without the key in the dependency list the
     effect would not re-run and the row would keep the previous item's open state. */
  useEffect(() => {
    setOpen(item.expanded);
  }, [item.expanded, item.key]);

  const decided = item.action !== null;

  return (
    <article
      className="card"
      style={{
        padding: 0,
        borderLeft: `3px solid ${TIER_COLOUR[item.tier]}`,
        opacity: decided ? 0.6 : 1,
        outline: selected ? `1px solid ${TIER_COLOUR.medium}` : undefined,
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px" }}>
        <button
          type="button"
          className="faint"
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
          style={{ width: 16, padding: 0 }}
        >
          {open ? "−" : "+"}
        </button>

        <span className="badge" title={TIER_HINTS[item.tier]}>
          {item.kind}
        </span>
        <strong style={{ fontSize: 13 }}>{item.title}</strong>

        {item.derived && (
          <span
            className="badge"
            title="Inferred from another premise, not quoted from the transcript"
          >
            derived
          </span>
        )}
        {item.conflictsWith.length > 0 && (
          <span
            className="badge"
            style={{ borderColor: TIER_COLOUR.high }}
            title="Same variable, different value"
          >
            conflicts with {item.conflictsWith.join(", ")}
          </span>
        )}

        <span style={{ flex: 1 }} />

        <span className="mono faint" style={{ fontSize: 11 }}>
          {item.confidence.toFixed(2)}
        </span>
        <span className="faint" style={{ fontSize: 11 }}>
          {item.origin}
        </span>

        {decided ? (
          <span className="badge">{describeAction(item.action)}</span>
        ) : (
          <span style={{ display: "flex", gap: 4 }}>
            <RowButton label="approve" onClick={() => act(item.key, approve(false))} />
            <RowButton
              label="edit"
              onClick={() => {
                setDraft(item.detail);
                setOpen(true);
              }}
            />
            <RowButton
              label="discard"
              onClick={() => act(item.key, discard("discarded in review"))}
            />
          </span>
        )}
      </div>

      {open && (
        <div style={{ padding: "0 14px 12px 40px", display: "grid", gap: 8 }}>
          {editing ? (
            <EditForm
              draft={draft}
              reason={reason}
              onDraft={setDraft}
              onReason={setReason}
              onSave={() => {
                act(item.key, edit({ statement: draft, text: draft }));
                onCloseEdit();
              }}
              onContest={() => {
                act(
                  item.key,
                  contest(reason.trim().length > 0 ? reason.trim() : "parked for later"),
                );
                onCloseEdit();
              }}
              onCancel={onCloseEdit}
            />
          ) : (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>{item.detail}</p>

              {item.quote.length > 0 && (
                <blockquote
                  className="mono"
                  style={{
                    margin: 0,
                    padding: "6px 10px",
                    borderLeft: "2px solid var(--rule, #30363d)",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    color: "var(--faint, #8b949e)",
                  }}
                >
                  {item.quote}
                </blockquote>
              )}
              {item.quote.length === 0 && (
                <p className="notice notice-warning" style={{ fontSize: 12, margin: 0 }}>
                  This item has no verifiable quote. The engine returned text that is not a literal
                  substring of your transcript, so its span was dropped and its confidence cut. The
                  structure may still be right — read it and decide.
                </p>
              )}

              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                {item.resolution}
              </p>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function RowButton({
  label,
  onClick,
}: { readonly label: string; readonly onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="faint"
      style={{ fontSize: 11, padding: "2px 6px" }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function EditForm({
  draft,
  reason,
  onDraft,
  onReason,
  onSave,
  onContest,
  onCancel,
}: {
  readonly draft: string;
  readonly reason: string;
  readonly onDraft: (value: string) => void;
  readonly onReason: (value: string) => void;
  readonly onSave: () => void;
  readonly onContest: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea
        className="mono"
        rows={3}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        aria-label="Edited wording"
        style={{ fontSize: 12, width: "100%" }}
      />
      <input
        className="mono"
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        placeholder="why, if you are contesting rather than editing"
        aria-label="Reason"
        style={{ fontSize: 12, padding: "4px 8px" }}
      />
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        Your wording is recorded at human_override authority (0.9) and the machine's original stays
        on the event, so nothing is lost. Contesting parks the item instead: it is not written and
        not thrown away.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onSave}>
          Save and approve
        </button>
        <button type="button" onClick={onContest}>
          Contest
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="faint" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
