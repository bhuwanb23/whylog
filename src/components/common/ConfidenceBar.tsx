/**
 * Confidence, drawn as a bar — 6.0.
 *
 * Phase 6 · the visual language
 *
 * "Confidence is drawn as a bar, never as a colour." A low-confidence extraction is not RED; it is
 * SHORT. Colour is reserved for epistemic status, so using it for confidence would mean two
 * different meanings on the same channel — and the review UI is built around rejecting low
 * confidence fast, which a bar communicates at a glance in a way a shade of amber does not.
 */

import { confidenceTier, confidenceWidth } from "@/theme";
import type { ReactElement } from "react";

export function ConfidenceBar({
  confidence,
  showTier = true,
}: {
  confidence: number;
  showTier?: boolean;
}): ReactElement {
  const tier = confidenceTier(confidence);

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      title={`${(confidence * 100).toFixed(0)}% confidence — ${tier.label} tier: ${tier.action}`}
    >
      <span
        style={{
          display: "inline-block",
          width: 44,
          height: 5,
          background: "var(--surface-sunken)",
          border: "1px solid var(--border)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            width: confidenceWidth(confidence),
            height: "100%",
            /* One neutral colour for all confidences. The LENGTH is the information; a gradient
             * here would reintroduce colour-as-meaning through the back door. */
            background: "var(--text-dim)",
          }}
        />
      </span>
      <span className="mono faint" style={{ fontSize: 10 }}>
        {confidence.toFixed(2)}
        {showTier ? ` · ${tier.label}` : ""}
      </span>
    </span>
  );
}
