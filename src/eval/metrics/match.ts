/**
 * Label-to-node alignment — the step that decides what every extraction metric means.
 *
 * Phase 7 · sub-phase 7.2
 *
 * ---------------------------------------------------------------------------
 * THE MATCHER IS THE METHODOLOGY
 *
 * Precision and recall are only as honest as the rule that decides whether an extracted node IS the
 * labelled one. A lenient rule inflates recall; a strict rule inflates the miss count; either can be
 * tuned until the number looks good, which is why the rule is written down here, in one place, at a
 * fixed threshold, and quoted in every metric's honest note.
 *
 * The rule: two character spans must OVERLAP by at least one character, inside the same transcript.
 * Overlap, not containment, because an extractor that finds the decision but quotes a wider clause
 * has still found the decision. One character, not a ratio, because a ratio threshold is a second
 * tuning knob and this file is trying to have none.
 *
 * Greedy by descending overlap, each side used at most once. Greedy is not optimal — the Hungarian
 * algorithm would maximise total overlap — but greedy is deterministic, explainable in one sentence,
 * and on spans that rarely compete the two agree. Optimality bought at the cost of explainability is
 * a bad trade in a benchmark whose whole purpose is to be checkable.
 *
 * ---------------------------------------------------------------------------
 * A VARIABLE MISMATCH IS REPORTED, NOT ABSORBED
 *
 * When the spans overlap but the variables disagree, that is not a miss and not a hit: the system
 * found the right sentence and understood it as the wrong kind of decision. Folding it into either
 * count hides the most diagnosable failure the extractor has, so it gets its own counter and its own
 * line in the report.
 * ---------------------------------------------------------------------------
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface AlignedPair<TLabel, TNode> {
  readonly label: TLabel;
  readonly node: TNode;
  readonly overlap: number;
}

export interface Alignment<TLabel, TNode> {
  readonly pairs: readonly AlignedPair<TLabel, TNode>[];
  readonly missed: readonly TLabel[];
  readonly spurious: readonly TNode[];
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

export function overlapOf(a: Span, b: Span): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? end - start : 0;
}

/**
 * Align two sets greedily by descending overlap.
 *
 * `eligible` decides whether a pair may be aligned at all — it is where the same-transcript
 * requirement lives, and where a metric can add a stricter condition without this file knowing about
 * decisions or premises.
 */
export function align<TLabel, TNode>(
  labels: readonly TLabel[],
  nodes: readonly TNode[],
  labelSpan: (label: TLabel) => Span,
  nodeSpan: (node: TNode) => Span,
  eligible: (label: TLabel, node: TNode) => boolean,
): Alignment<TLabel, TNode> {
  const candidates: { li: number; ni: number; overlap: number }[] = [];

  for (let li = 0; li < labels.length; li += 1) {
    const label = labels[li];
    if (label === undefined) continue;

    for (let ni = 0; ni < nodes.length; ni += 1) {
      const node = nodes[ni];
      if (node === undefined) continue;
      if (!eligible(label, node)) continue;

      const overlap = overlapOf(labelSpan(label), nodeSpan(node));
      if (overlap > 0) candidates.push({ li, ni, overlap });
    }
  }

  /* Descending overlap, then by index, so ties resolve the same way on every run. Without the index
   * tiebreak the order of equal-overlap pairs depends on the sort implementation, and a benchmark
   * whose numbers move between runs is not a benchmark. */
  candidates.sort((a, b) => b.overlap - a.overlap || a.li - b.li || a.ni - b.ni);

  const usedLabels = new Set<number>();
  const usedNodes = new Set<number>();
  const pairs: AlignedPair<TLabel, TNode>[] = [];

  for (const candidate of candidates) {
    if (usedLabels.has(candidate.li) || usedNodes.has(candidate.ni)) continue;
    usedLabels.add(candidate.li);
    usedNodes.add(candidate.ni);

    const label = labels[candidate.li];
    const node = nodes[candidate.ni];
    if (label === undefined || node === undefined) continue;
    pairs.push({ label, node, overlap: candidate.overlap });
  }

  return {
    pairs,
    missed: labels.filter((_, index) => !usedLabels.has(index)),
    spurious: nodes.filter((_, index) => !usedNodes.has(index)),
    truePositives: pairs.length,
    falsePositives: nodes.length - pairs.length,
    falseNegatives: labels.length - pairs.length,
  };
}

/** The matcher's rule, as a sentence. Quoted verbatim in every extraction metric's honest note so a
 *  reader of the report knows which rule produced the number without opening this file. */
export const MATCH_RULE =
  "spans must overlap by at least one character within the same transcript; aligned greedily by descending overlap, each side used once";
