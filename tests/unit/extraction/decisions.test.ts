import { DECISION_CUES } from "@/ontology/data/decision-cues";
/**
 * Decision recovery — the four bugs that made precision collapse.
 *
 * Each `describe` here is a regression test for something that type-checked, ran without error, and
 * silently produced the wrong graph. They are written against hand-made transcripts rather than the
 * eval corpus so a failure names the mechanism instead of moving a benchmark number.
 */
import { describe, expect, it } from "vitest";
import { extract, pairs } from "../../helpers/extraction";

describe("rationale markers are episode boundaries, not decisions", () => {
  it("flags exactly the five that introduce a WHY or a CONDITION", () => {
    const rationaleOnly = DECISION_CUES.filter((cue) => cue.rationaleOnly === true)
      .map((cue) => cue.phrase)
      .sort();
    expect(rationaleOnly).toEqual(["as long as", "because", "in order to", "since", "so that"]);
  });

  it("keeps them in the table, because segmentEpisodes reads it for boundaries", () => {
    for (const phrase of ["because", "since", "so that", "in order to", "as long as"]) {
      expect(DECISION_CUES.some((cue) => cue.phrase === phrase)).toBe(true);
    }
  });

  it("does not mint a decision from a rationale clause", async () => {
    /* One real decision, three rationale clauses. Before the fix this produced a second candidate
     * from "because", with a different span and often a different variable — so one true decision
     * scored as one false negative AND one false positive. */
    const { decisions } = await extract(
      [
        "Human: how should we store things?",
        "Agent: we decided to use SQLite because it needs no server.",
        "Agent: since this is a hackathon, that is fine.",
        "Agent: we can add Postgres later in order to scale.",
      ].join("\n"),
    );

    const sqlite = decisions.filter((d) => d.value.toLowerCase().includes("sqlite"));
    expect(sqlite.length).toBe(1);
    /* The rationale cue itself must not mint a decision: no candidate may quote "because" or "since"
     * as the start of its statement. */
    for (const decision of decisions) {
      expect(decision.statement.toLowerCase()).not.toMatch(
        /^(because|since|so that|in order to)\b/,
      );
    }
  });

  it.fails("KNOWN GAP: a weak cue still adopts a value from elsewhere in the episode", async () => {
    /* Documented with `it.fails` on purpose. Marking the five rationale cues stopped THEM from
     * minting decisions, but a different weak cue in the same sentence still fires, and `pickValue`
     * hands it "hackathon" from the surrounding episode — producing `DATABASE → "hackathon"` with the
     * snippet `"fine."`. The value has no mapping to any variable, so `resolveVariable` falls back to
     * the episode's topic and slots it as DATABASE.
     *
     * The principled fix is to refuse a value that is not a known value for the variable the CONTEXT
     * chose: when the value itself carries no variable evidence, the topic alone is not enough to
     * mint a node. That is a recall/precision trade worth making deliberately rather than inside a
     * test-writing pass, so this test is pinned red — it will start FAILING the moment the gap is
     * closed, which is the reminder to delete it. */
    const { decisions } = await extract(
      [
        "Human: how should we store things?",
        "Agent: we decided to use SQLite because it needs no server.",
        "Agent: since this is a hackathon, that is fine.",
      ].join("\n"),
    );
    for (const decision of decisions) {
      expect(decision.value.toLowerCase()).not.toContain("hackathon");
    }
  });
});

describe("a value must be a value, not an ordinary word", () => {
  it("does not mint a decision whose value is a bare word", async () => {
    /* "it's the thing we need" used to become AUTH → "thing": the phrase fast-path accepted a
     * `bare` value on score alone, while the fallback ten lines below rejected bare values as
     * "a failed extraction, not a low-confidence one". */
    const { decisions } = await extract(
      ["Human: what about auth?", "Agent: it's the thing we need for now."].join("\n"),
    );
    for (const decision of decisions) {
      expect(["thing", "things", "something", "stuff", "one", "lot"]).not.toContain(
        decision.value.toLowerCase(),
      );
    }
  });

  it("still recovers a real technology named after a copula", async () => {
    const { decisions } = await extract(
      ["Human: which database?", "Agent: it's SQLite for this one."].join("\n"),
    );
    expect(decisions.some((d) => d.value.toLowerCase().includes("sqlite"))).toBe(true);
  });
});

describe("the strongest mention of a decision wins, not the first", () => {
  it("records the acceptance rather than the earlier proposal", async () => {
    /* The agent floats SQLite early, the human settles it later. Keeping the first mention recorded
     * the PROPOSAL's span, modality and origin authority — so a decision a human accepted was
     * stamped as an agent proposal, which understates source_authority, which feeds entrenchment,
     * which decides what gets retracted. */
    const raw = [
      "Human: what should we use for storage?",
      "Agent: I'd use SQLite if that is alright.",
      "Human: yes, going with SQLite, not Postgres.",
    ].join("\n");

    const { decisions } = await extract(raw);
    const sqlite = decisions.find((d) => d.value.toLowerCase().includes("sqlite"));
    expect(sqlite).toBeDefined();

    /* The surviving candidate must point at the acceptance, which is the later sentence. */
    const acceptance = raw.indexOf("going with SQLite");
    expect(sqlite?.snippet.start).toBeGreaterThanOrEqual(acceptance - 20);
  });

  it("produces exactly one candidate for a value mentioned twice", async () => {
    const { decisions } = await extract(
      ["Human: storage?", "Agent: I'd use SQLite.", "Human: agreed, going with SQLite."].join("\n"),
    );
    expect(decisions.filter((d) => d.value.toLowerCase().includes("sqlite"))).toHaveLength(1);
  });
});

describe("the variable comes from the VALUE, not from the episode's topic", () => {
  it("puts sqlite in DATABASE even when the episode also discusses scope", async () => {
    /* `variableAtCue` accepts a value hint and `resolveVariable` scores the value first — but the
     * recogniser called it with no hint and then used the result to canonicalise the value. Circular,
     * so the topic outvoted the value: "sqlite" landed in SCOPE and "vite" in ARCHITECTURE. A
     * mis-slotted decision costs an FN and an FP at once, because the matcher requires the variable
     * to agree and the identity ladder refuses to merge across slots. */
    const { decisions } = await extract(
      [
        "Human: this is a small hackathon project, what about the database?",
        "Agent: we decided to use SQLite for the database.",
      ].join("\n"),
    );
    const sqlite = decisions.find((d) => d.value.toLowerCase().includes("sqlite"));
    expect(sqlite).toBeDefined();
    expect(sqlite?.variable).toBe("DATABASE");
  });

  it("puts vite in FRAMEWORK", async () => {
    const { decisions } = await extract(
      ["Human: build tooling?", "Agent: let's use Vite, not Next.js."].join("\n"),
    );
    const vite = decisions.find((d) => d.value.toLowerCase().includes("vite"));
    expect(vite).toBeDefined();
    expect(vite?.variable).toBe("FRAMEWORK");
  });
});

describe("every recovered decision carries a snippet that is real text", () => {
  it("quotes a literal substring of the raw input at the span it reports", async () => {
    const raw = [
      "Human: which auth provider?",
      "Agent: we decided to use Clerk for authentication.",
    ].join("\n");
    const extracted = await extract(raw);

    for (const decision of extracted.decisions) {
      const quoted = raw.slice(decision.snippet.start, decision.snippet.end);
      expect(quoted).toBe(decision.snippet.text);
      expect(decision.snippet.text.length).toBeGreaterThan(0);
    }
  });

  it("never reports a span whose value is absent from it", async () => {
    /* The old cue-only fallback emitted snippets like the two characters "it's" while the value came
     * from three sentences away. A snippet that does not contain its own value is not evidence. */
    const { decisions } = await extract(
      ["Human: database?", "Agent: it's a tricky one. Later: we decided to use Postgres."].join(
        "\n",
      ),
    );
    for (const decision of decisions) {
      expect(decision.snippet.text.toLowerCase()).toContain(
        decision.value.toLowerCase().slice(0, 4),
      );
    }
  });
});

describe("the run is deterministic", () => {
  it("produces identical pairs on two runs over the same text", async () => {
    const raw = ["Human: storage?", "Agent: we decided to use SQLite."].join("\n");
    expect(pairs(await extract(raw))).toEqual(pairs(await extract(raw)));
  });
});
