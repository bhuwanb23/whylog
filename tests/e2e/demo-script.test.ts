/**
 * Gate G6 — the demo, as an executable script.
 *
 * The script is DATA, not prose: `demo/verify.ts` walks it and reports verified / manual / failed per
 * beat. A script that cannot be checked is a script that gets edited the night before and breaks on
 * stage, which is the failure this test exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { SCRIPT, DEMO_SECONDS, totalSeconds, cuttableBeats, renderScript } from "@/eval/demo/script";
import { buildSeed, resetDemo, RESET_KEYS } from "@/eval/demo/kit";
import { verifyDemo, renderVerification } from "@/eval/demo/verify";

describe("the script is well-formed data", () => {
  it("has the eight beats the pitch promises", () => {
    expect(SCRIPT.length).toBe(8);
  });

  it("fits the time box", () => {
    expect(DEMO_SECONDS).toBe(300);
    expect(totalSeconds(SCRIPT)).toBeLessThanOrEqual(DEMO_SECONDS);
  });

  it("gives every beat one action, one thing to expect, and the line to say", () => {
    /* One action per beat: a beat with two actions is two beats, and a script that cannot be walked
     * one step at a time cannot be recovered from mid-presentation. */
    for (const beat of SCRIPT) {
      expect(beat.action.length).toBeGreaterThan(0);
      expect(beat.expect.length).toBeGreaterThan(0);
      expect(beat.say.length).toBeGreaterThan(0);
      expect(typeof beat.view).toBe("string");
      expect(typeof beat.check).toBe("string");
      expect(beat.seconds).toBeGreaterThan(0);
    }
  });

  it("numbers the beats consecutively from 1", () => {
    expect(SCRIPT.map((beat) => beat.n)).toEqual(SCRIPT.map((_, i) => i + 1));
  });

  it("marks exactly the beats that can be cut under time pressure", () => {
    /* Cuttable means "the demo still lands without it". A beat whose absence breaks the argument is
     * not cuttable, and knowing which is which BEFORE the room runs out of time is the whole point. */
    const cuttable = cuttableBeats(SCRIPT);
    expect(cuttable.length).toBeGreaterThan(0);
    expect(cuttable.length).toBeLessThan(SCRIPT.length);
    for (const beat of cuttable) expect(beat.killer).toBe("none");
  });

  it("renders to prose a presenter can read aloud", () => {
    const text = renderScript(SCRIPT);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("SQLite");
  });
});

describe("the seed is BUILT, never checked in", () => {
  it("builds from the two demo fixtures through the real harness", async () => {
    const seed = await buildSeed();

    /* A checked-in seed goes stale the moment the pipeline changes, and a stale seed demos a system
     * that no longer exists. Building it at load time means the demo always runs the shipping code. */
    expect(seed.state.decisions.size).toBeGreaterThan(0);
    expect(seed.state.premises.size).toBeGreaterThan(0);
  }, 60_000);

  it("contains the SQLite decision the demo is about", async () => {
    const seed = await buildSeed();
    const sqlite = [...seed.state.decisions.values()].find(
      (d) => d.variable === "DATABASE" && /sqlite/i.test(d.value + " " + d.statement),
    );
    expect(sqlite).toBeDefined();
  }, 60_000);

  it("produces justifications, so the graph is non-monotonic and beat 5 has something to show", async () => {
    const seed = await buildSeed();
    expect(seed.state.justifications.size).toBeGreaterThan(0);
    const withOut = [...seed.state.justifications.values()].filter((j) => j.outList.length > 0);
    expect(withOut.length).toBeGreaterThan(0);
  }, 60_000);

  it("proposes guards, so beat 7 has something to show", async () => {
    const seed = await buildSeed();
    expect(seed.state.guards.size).toBeGreaterThan(0);
  }, 60_000);
});

describe("the verifier checks every automatic beat", () => {
  it("reports VERIFIED for the automatic checks and never 'skipped'", async () => {
    const seed = await buildSeed();
    const report = verifyDemo(seed);

    /* Statuses are verified | manual | failed. "Skipped" is deliberately not one of them: a check
     * that did not run is a check that failed, and calling it skipped is how a broken demo reaches
     * the stage. */
    for (const result of report.results) {
      expect(["verified", "manual", "failed"]).toContain(result.status);
      /* Every result carries evidence — a verdict with no evidence is an opinion. */
      expect(result.evidence.length).toBeGreaterThan(0);
      if (result.status === "manual") expect(result.manualStep.length).toBeGreaterThan(0);
    }

    const failed = report.results.filter((r) => r.status === "failed");
    expect(failed.map((r) => `${r.check}: ${r.evidence}`)).toEqual([]);

    expect(report.failed).toBe(0);
    expect(report.verified).toBeGreaterThan(0);
    expect(report.demoable).toBe(true);
    /* Every beat resolved to a check; a beat with no result would be an unverified step on stage. */
    expect(report.byBeat).toHaveLength(SCRIPT.length);
  }, 90_000);

  it("renders a report that tells the presenter what to do by hand", async () => {
    const seed = await buildSeed();
    const text = renderVerification(verifyDemo(seed));
    expect(text).toContain("MANUAL");
    expect(text.length).toBeGreaterThan(200);
  }, 90_000);
});

describe("reset is a WIPE, not an undo", () => {
  it("names every storage key it clears", () => {
    expect(RESET_KEYS.length).toBeGreaterThan(0);
    expect(RESET_KEYS).toContain("whylog:integrity");
  });

  it("clears every key that is set, and reports exactly those", () => {
    const storage = globalThis.localStorage;
    for (const key of RESET_KEYS) storage.setItem(key, "x");

    const result = resetDemo(storage);
    expect(result.cleared.length).toBe(RESET_KEYS.length);
    for (const key of RESET_KEYS) expect(storage.getItem(key)).toBeNull();
    /* Undo would rewrite the hash chain, which contradicts invariant I1 on stage: a log that can
     * un-write an event is not append-only, and the demo's whole credibility rests on it being so. */
    expect(result.available).toBe(true);
  });

  it("reports nothing cleared on an already-empty store, rather than pretending", () => {
    const storage = globalThis.localStorage;
    for (const key of RESET_KEYS) storage.removeItem(key);
    expect(resetDemo(storage).cleared).toHaveLength(0);
  });

  it("survives a null storage, which is what a browser blocking site data gives you", () => {
    const result = resetDemo(null);
    expect(result.available).toBe(false);
    expect(result.cleared).toHaveLength(0);
  });
});
