/**
 * Settings — 6.8.
 *
 * Phase 6 · sub-phase 6.8
 * Plan: plan/phase-6-presentation.md §6.8
 *
 * ---------------------------------------------------------------------------
 * NEVER LET THE UI IMPLY A CAPABILITY IT DOES NOT HAVE
 *
 * Three things this view has to be honest about:
 *
 *   THE KEY. Stored in `localStorage` only. Never in an event, never in an export, never in the log.
 *   The field is write-only — the stored key is never read back into the input, only a hint of its
 *   shape is shown, so a screenshot or a screen-share cannot leak it.
 *
 *   THE FALLBACK. Selecting an LLM provider with no key runs the LOCAL engine and says so. Not
 *   silently: `fallbackNotice` is rendered as a warning, because a user who asked for GPT and got a
 *   hashing vectoriser deserves to know which one produced their decisions.
 *
 *   THE STALE INDEX. Switching engines invalidates the embeddings, because cosine similarity across
 *   two embedding spaces is meaningless — a 0.9 between a vector from one space and a vector from
 *   another is a number with no interpretation. Semantic retrieval is disabled until a rebuild, and
 *   this view is where the rebuild is triggered.
 * ---------------------------------------------------------------------------
 */

import type { ProviderId } from "@/ai/config";
import { DEFAULT_MODELS, PROVIDERS } from "@/ai/config";
import { describeTaxonomy } from "@/guards";
import { MAX_SEARCHES } from "@/retrieval/evidence-contract";
import { useAsk } from "@/store/ask";
import { useTuning } from "@/store/settings";
import { DEFAULT_CASCADE_DEPTH_CAP } from "@/store/settings";
import { useWhyLog } from "@/store/whylog";
import { TAU_HIGH, TAU_LOW } from "@/substrate/identity";
import { DEFAULT_SEVERITY } from "@/types/guards";
import type { GuardKind } from "@/types/guards";
import { type ReactElement, useState } from "react";

export function SettingsView(): ReactElement {
  const whylog = useWhyLog();
  const tuning = useTuning();
  const ask = useAsk();
  const settings = whylog.settings;

  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.config.model);
  const [note, setNote] = useState<string | null>(null);

  const apply = (run: () => { ok: boolean; error?: string }, message: string): void => {
    const outcome = run();
    setNote(outcome.ok ? message : (outcome.error ?? "That change could not be applied."));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {note !== null ? <div className="notice notice-info">{note}</div> : null}

      {/* ---------------- engine ---------------- */}
      <section className="card">
        <h2 className="card-title">Engine</h2>

        <p className="dim" style={{ margin: "0 0 12px", fontSize: 12 }}>
          The local engine is the <strong>default, not a fallback</strong>. Extraction,
          classification, embedding and composition all work with no key and no network. What an LLM
          buys is fluency, cross-decision synthesis, three-run voting and a listwise reranker — not
          correctness. Every gate, the cascade, entrenchment and adjudication are deterministic and
          engine-independent.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="faint" style={{ fontSize: 11 }}>
            provider
            <select
              value={settings.config.provider}
              onChange={(event) => {
                const provider = event.target.value as ProviderId;
                setModel(DEFAULT_MODELS[provider]);
                apply(() => settings.setProvider(provider), "Provider set to " + provider + ".");
              }}
              style={{ display: "block", fontSize: 12, marginTop: 3 }}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <label className="faint" style={{ fontSize: 11 }}>
            model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => {
                if (model !== settings.config.model) {
                  apply(() => settings.setModel(model), "Model set to " + model + ".");
                }
              }}
              style={{ display: "block", fontSize: 12, marginTop: 3, width: 200 }}
            />
          </label>
        </div>

        <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Currently running:{" "}
          <span className="mono">
            {whylog.engineId.kind}
            {whylog.engineId.model.length > 0 ? " · " + whylog.engineId.model : ""}
          </span>
          . Every node is stamped with the engine that produced it, so a decision extracted months
          ago by a different engine still reports its origin honestly.
        </div>

        {settings.fallbackNotice !== null ? (
          <div className="notice notice-warning" style={{ marginTop: 10, fontSize: 12 }}>
            {settings.fallbackNotice}
          </div>
        ) : null}
      </section>

      {/* ---------------- the key ---------------- */}
      <section className="card">
        <h2 className="card-title">API key</h2>

        <div className="notice notice-info" style={{ marginBottom: 10, fontSize: 12 }}>
          Stored in <span className="mono">localStorage</span> under{" "}
          <span className="mono">whylog:config:v1</span>, in this browser only. It is{" "}
          <strong>
            never written to an event, never included in an export, and never sent anywhere except
            the provider you selected
          </strong>
          . The field below is write-only: the stored key is never read back into it, so a
          screenshot cannot leak it.
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              settings.keyHint ?? "paste a key, or leave empty to stay on the local engine"
            }
            style={{ flex: 1, minWidth: 240, fontSize: 12 }}
            autoComplete="off"
          />
          <button
            type="button"
            className="badge"
            disabled={key.trim().length === 0}
            onClick={() => {
              apply(
                () => settings.setApiKey(key),
                "Key stored locally. Refresh the engine to use it.",
              );
              setKey("");
              whylog.refreshEngine();
            }}
          >
            Save key
          </button>
          <button
            type="button"
            className="badge"
            disabled={!settings.hasKey}
            onClick={() => {
              apply(
                () => settings.clearKey(),
                "Key forgotten. The local engine takes over; nothing else changes.",
              );
              whylog.refreshEngine();
            }}
          >
            Forget key
          </button>
        </div>

        <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          {settings.hasKey
            ? "A key is stored (" + (settings.keyHint ?? "hint unavailable") + ")."
            : "No key stored — everything runs locally."}
        </div>
      </section>

      {/* ---------------- reasoning tuning ---------------- */}
      <section className="card">
        <h2 className="card-title">Reasoning tuning</h2>

        <p className="dim" style={{ margin: "0 0 12px", fontSize: 12 }}>
          Persisted under <span className="mono">whylog:settings:v1</span>. These are reasoning
          settings, not engine settings, so they are stored apart from the config — a confidence
          threshold has no business being serialised next to an API key hint.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <NumberSetting
            label="Cascade depth cap"
            value={tuning.cascadeDepthCap}
            min={1}
            max={12}
            onChange={tuning.setCascadeDepthCap}
            note={
              "How many hops the cascade may follow. It only ever follows SHARED-PREMISE edges, never topical similarity. Default " +
              DEFAULT_CASCADE_DEPTH_CAP +
              ". Lowering it makes the cascade more conservative — it will stop earlier and report what it did not reach, rather than guess."
            }
          />

          <NumberSetting
            label="Identity threshold — high (τ high)"
            value={tuning.tauHigh}
            min={0.5}
            max={1}
            step={0.01}
            onChange={(value) => tuning.setThresholds(value, tuning.tauLow)}
            note={
              "Above this, two premises are the SAME node and merge automatically. Default " +
              TAU_HIGH +
              " (the local engine uses 0.86, because its vectoriser is weaker)."
            }
          />

          <NumberSetting
            label="Identity threshold — low (τ low)"
            value={tuning.tauLow}
            min={0}
            max={0.99}
            step={0.01}
            onChange={(value) => tuning.setThresholds(tuning.tauHigh, value)}
            note={
              "Below this, they are different nodes. Between the two, the match is AMBIGUOUS and is surfaced for human confirmation rather than guessed — a wrong premise resolution produces a confident, spectacular and entirely wrong cascade. Default " +
              TAU_LOW +
              "."
            }
          />

          <NumberSetting
            label="Max searches per question"
            value={tuning.maxSearchSteps}
            min={1}
            max={MAX_SEARCHES}
            onChange={tuning.setMaxSearchSteps}
            note={
              "Hard-capped at " +
              MAX_SEARCHES +
              " by the evidence contract, and this can only LOWER it. The bound is not a performance optimisation: an unbounded search turns 'I could not find it' into 'I have not looked hard enough yet', and a system that can always look again never has to say it does not know."
            }
          />

          <button
            type="button"
            className="badge faint"
            onClick={tuning.reset}
            style={{ alignSelf: "flex-start" }}
          >
            reset tuning to defaults
          </button>
        </div>
      </section>

      {/* ---------------- index ---------------- */}
      <section className="card">
        <h2 className="card-title">
          Semantic index
          {whylog.state.index.stale ? (
            <span className="badge" style={{ marginLeft: 8, color: "var(--mode-stale)" }}>
              STALE
            </span>
          ) : null}
        </h2>

        {whylog.state.index.stale ? (
          <div className="notice notice-warning" style={{ marginBottom: 10, fontSize: 12 }}>
            The stored vectors came from a different embedding space, so{" "}
            <strong>semantic retrieval is disabled until you rebuild</strong>. Cosine similarity
            across two embedding spaces is meaningless — a 0.9 between a vector from one and a
            vector from the other is a number with no interpretation. Lexical, structural and
            premise retrieval still work: they are pure functions of the log and need no vectors.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="badge"
            disabled={ask.status === "building"}
            onClick={() => void ask.buildTheIndex()}
          >
            {ask.status === "building" ? "Building…" : "Rebuild index"}
          </button>
          <button
            type="button"
            className="badge"
            disabled={ask.status === "building"}
            onClick={() => void ask.buildTheIndex({ skipDense: true })}
          >
            Rebuild without embeddings
          </button>
        </div>

        <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Rebuilding embeds only the decisions whose text hash changed, so it is cheap after the
          first run. "Without embeddings" builds L3, L4 and L5 only — the keyless path, which is
          what makes the whole system usable with no key at all.
        </div>

        {ask.buildError !== null ? (
          <div className="notice notice-error" style={{ marginTop: 10, fontSize: 12 }}>
            {ask.buildError}
          </div>
        ) : null}
      </section>

      {/* ---------------- guard severity defaults ---------------- */}
      <section className="card">
        <h2 className="card-title">Guard severity defaults</h2>

        <p className="dim" style={{ margin: "0 0 10px", fontSize: 12 }}>
          What a newly synthesised guard of each kind defaults to. Read-only here on purpose: the
          policy is a property of the kind, not of the user. A string guard is easier to match by
          accident than a dependency entry is, so string guards are{" "}
          <span className="mono">warning</span> and dependency guards are{" "}
          <span className="mono">blocking</span> — and letting that be configured per install would
          mean two projects disagreeing about what a failure means. Per-guard severity IS editable,
          on the Guards tab.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {(Object.keys(DEFAULT_SEVERITY) as GuardKind[]).map((kind) => (
              <tr key={kind} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="mono" style={{ padding: "4px 6px" }}>
                  {kind}
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <span
                    className="badge"
                    style={{
                      color:
                        DEFAULT_SEVERITY[kind] === "blocking"
                          ? "var(--edge-conflict)"
                          : "var(--label-unknown)",
                    }}
                  >
                    {DEFAULT_SEVERITY[kind]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="card-title">The eight guard kinds</h2>
        <pre className="mono dim" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11 }}>
          {describeTaxonomy()}
        </pre>
      </section>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  note: string;
}): ReactElement {
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 12, minWidth: 210 }}>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ flex: 1, maxWidth: 260 }}
          aria-label={label}
        />
        <span className="mono" style={{ fontSize: 12, minWidth: 48 }}>
          {value}
        </span>
      </div>
      <div className="dim" style={{ fontSize: 11, marginTop: 3, maxWidth: 720 }}>
        {note}
      </div>
    </div>
  );
}
