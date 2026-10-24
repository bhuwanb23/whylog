# Judge Q&A

Rehearsed, not read. Each answer is under twenty seconds aloud and ends on the number or the mechanism,
never on an adjective.

Source: `docs/07` §5, extended with the questions Phase 7 makes answerable.

---

### "Isn't this just ai-memory with extra steps?"

It is ai-memory plus a truth-maintenance layer, and the layer is the point. `ai-memory` stores what you
decided. This stores what the decision is true *given* — as shared premise nodes with an OUT-list — so when
an assumption stops holding, the decisions resting on it go unsound without anyone mentioning them.

Concretely: gates (a) and (c), backtracking, the cascade, entrenchment and adjudication are all
**deterministic and engine-independent**. The whole of G2 runs keyless. That is not a wrapper.

---

### "agentmemory does retrieval better — R@5 95.2%."

Different task. It retrieves conversation turns the query usually near-copies. This retrieves decisions,
where the query is a question about rationale: *"why did we avoid Postgres?"* and *"Use SQLite; single-user,
no deploy infra"* share one word.

We cite their number in our own comparator table rather than hiding it, and we say it is not comparable.
Retrieval is not our claim anyway — the evidence contract on top of it is.

---

### "Kantara already found 396 contradictory pairs."

Over the Linux kernel, from commits, and they are **counts**, not recall over a planted denominator —
nothing was planted. Also: Kantara detects and never revises, has no premises, and its M1/M2 diagnostics are
the part we implement and measure.

Pairwise contradiction is our **control**. It is planted in the corpus as the case that must work so
everything else means something, not as the achievement.

---

### "Your corpus is twelve transcripts."

Correct, and the plan said thirty. That is a shortfall, not a design choice, and it is the first entry in
`LIMITATIONS.md`.

The consequence is stated rather than hidden: every rate has a denominator small enough that one label moves
it several points, so the suite supports claims about *mechanisms firing on named cases*, not about *rates in
production*. Coverage of every planted case is complete. Sample size is not.

---

### "You wrote your own ground truth."

Yes. That is limitation §2 and it is the largest methodological weakness in the work — no amount of
additional code fixes it.

Two partial mitigations: labels are **verbatim quotes** the loader resolves to character offsets and
**rejects** if they are not literal substrings (50 of 50 resolve), so a third party can check every label
against the transcript in seconds. And the matcher's rule is fixed in one place, quoted in every honest note,
with no tunable threshold.

Verifiable and unbiased are different properties. We have the first and we say we lack the second.

---

### "Has any of this actually been run?"

No. Nothing has been executed — no installs, no builds, no commands. `LIMITATIONS.md` §10 says so, and
`EVALUATION.md` contains **no numbers** for the same reason.

What exists is the suite: 13 metrics, 11 ablation toggles with thresholds committed before any run, all 24
documented failure modes registered against a mechanical check or a written argument, and a keyless demo kit
that verifies its own script. One command turns design into evidence: `npm run eval:report`.

We would rather hand you an empty metrics card with the command that fills it than a full one we invented.

---

### "What's the guard precision?"

**n = 0. Not measured.** A guard needs a repository state to fail against and a transcript corpus contains
none, so there is no denominator.

Four properties that *are* testable are reported in its place and labelled as such: synthesis rate,
determinism share, skips-counted-as-passes (must be 0), guards auto-accepted without a human (must be 0,
invariant I4). A fixture repository would close this and is the highest-value roadmap item.

---

### "Why not just use an LLM to spot contradictions?"

Because a cosine similarity of 0.87 is not a contradiction, and a system that treats it as one produces the
false positives that get tools uninstalled. Invariant I3: **retrieval proposes, a classifier disposes.**
Similarity selects candidates and is then discarded.

The LLM path does add gate (b) recall and better proposal phrasing. It is not load-bearing for correctness —
which is a stronger claim than "works with GPT-4", and the one the ablation actually tests.

---

### "Doesn't the cascade over-retract?"

That is the first of four demo-killers and the failure we measure hardest. Survivor preservation is its own
metric, separate from cascade correctness, and correctness is a **strict conjunction**: flip the right nodes
*and* spare the survivors, or score zero. Partial credit would hide exactly the failure that matters.

The `L3-shared-premise` plant is built to distinguish them — three decisions on deliberately different
support, so one falsification has three different correct outcomes. A cascade that flips the one resting on
`scope` alone is following edges instead of justifications.

---

### "Single-user only?"

Yes. `localStorage`, seven keys, no server, no sync. Two developers have two logs and neither sees the
other's premises — which means **the product does not currently work for the team case it is most useful
in**. That is limitation §7 and it is the most uncomfortable one we have.

Export/import via `substrate/portability.ts` is the interim path. Real multi-user needs a merge model for
concurrent event logs; an append-only hash-chained log has a well-defined one (merge by learned time,
re-seal) that is not built.

---

### "Why should I believe the entrenchment weights?"

You shouldn't, on their own — and neither do we. The ablation switch `entrenchment` removes Hansson ordering
entirely and predicts a rise in the false-positive rate, because without requiring the newcomer to outrank
every contradictor, low-confidence restatements supersede settled decisions.

What we can defend is the **EE3 cap**: entrenchment is capped at the minimum over the decision's own
premises, so a long-lived decision resting on one weak assumption cannot become unretractable. And
`implementation_cost` is a measurement from guard status, not a constant — a constant in a weighted sum is a
bias with extra steps.

The weights themselves are calibration work, and the honest note says so.

---

### "What's the roadmap?"

MCP server · **live capture by *consuming* agentmemory rather than competing with it** · ATMS multi-context
reasoning · repository connection (which ends the virtual-project limitation and unlocks guard precision) ·
**DecisionMemEval published as a standalone benchmark**.

The last one matters most: three of our thirteen metrics have no published comparator because no public
corpus exercises them. Publishing the corpus is worth more than publishing the tool.
