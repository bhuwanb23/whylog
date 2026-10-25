/**
 * Graph builders.
 *
 * Every graph in this suite is produced by the real pipeline — seal drafts through `appendBatch`,
 * then `fold`. Nothing here hand-assembles a `GraphState`, because a hand-built state can satisfy an
 * invariant the fold would never produce, and a test that passes against it is testing a fiction.
 */
import { fold } from "@/substrate/materialize";
import type { GraphState } from "@/substrate/graph-state";
import type { AnyEvent, EventType, NewEvent } from "@/types/events";
import {
  LOCAL_ENGINE,
  alternativeId,
  decisionId,
  justificationId,
  nextAt,
  premiseId,
  sealAll,
  transcriptId,
  transcriptImported,
  premiseAsserted,
  premiseConfirmed,
  decisionProposed,
  justificationAttached,
  type Sealed,
} from "./events";

export interface Built {
  readonly state: GraphState;
  readonly sealed: Sealed;
  readonly events: readonly AnyEvent[];
}

export function buildGraph(drafts: readonly NewEvent<EventType>[]): Built {
  const sealed = sealAll(drafts);
  return {
    state: fold(sealed.events, { engine: LOCAL_ENGINE, now: nextAt() }),
    sealed,
    events: sealed.events,
  };
}

/** The marker `premise-linker.ts` writes and `isDerivedPremise` reads. An OUT-list entry is a
 *  premise that was INFERRED from another rather than quoted, and this is how the graph says so. */
export const DERIVED_MARKER = "— excluded by";

export interface SqliteGraph extends Built {
  readonly t1: ReturnType<typeof transcriptId>;
  readonly singleUser: ReturnType<typeof premiseId>;
  readonly concurrentWriters: ReturnType<typeof premiseId>;
  readonly scope: ReturnType<typeof premiseId>;
  readonly sqlite: ReturnType<typeof decisionId>;
  readonly migration: ReturnType<typeof decisionId>;
  readonly pooling: ReturnType<typeof decisionId>;
  readonly justSqlite: ReturnType<typeof justificationId>;
  readonly justMigration: ReturnType<typeof justificationId>;
  readonly justPooling: ReturnType<typeof justificationId>;
}

/**
 * The canonical non-monotonic fixture — the shape the whole project exists for.
 *
 *   p1 scale.single_user            (quoted, IN)
 *   p2 scale.concurrent_writers     (DERIVED from p1, OUT)   ← makes the graph non-monotonic
 *   p3 scope.hackathon              (quoted, IN)
 *
 *   WLD-0001 DATABASE → sqlite          rests on p1, excludes p2
 *   WLD-0002 DATABASE → migration-tools rests on p3          ← shares nothing with p1: a SURVIVOR
 *   WLD-0003 STORAGE  → pooling         rests on p1, excludes p2
 *
 * Falsifying p1 must flip WLD-0001 and WLD-0003 and must NOT touch WLD-0002. A cascade that
 * retracts the survivor is the demo-killer `plan/OVERVIEW.md` calls over-retraction, and a cascade
 * that stops early is under-retraction — this one fixture distinguishes both.
 */
export function sqliteGraph(): SqliteGraph {
  const t1 = transcriptId(1);
  const singleUser = premiseId(1);
  const concurrentWriters = premiseId(2);
  const scope = premiseId(3);
  const sqlite = decisionId(1);
  const migration = decisionId(2);
  const pooling = decisionId(3);
  const justSqlite = justificationId(1);
  const justMigration = justificationId(2);
  const justPooling = justificationId(3);

  const built = buildGraph([
    transcriptImported(t1, "We are going with SQLite because it is single-user."),
    premiseAsserted({
      id: singleUser,
      transcript: t1,
      type: "scale",
      predicate: "scale.single_user",
      text: "the app has a single user",
      value: true,
    }),
    premiseAsserted({
      id: concurrentWriters,
      transcript: t1,
      type: "scale",
      predicate: "scale.concurrent_writers",
      /* Derived, not quoted — the marker is what puts this premise in an OUT-list. */
      text: `more than one writer at a time ${DERIVED_MARKER} "the app has a single user"`,
      value: false,
    }),
    premiseAsserted({
      id: scope,
      transcript: t1,
      type: "requirement",
      predicate: "requirement.must",
      text: "this only has to survive the hackathon",
    }),
    decisionProposed({ id: sqlite, transcript: t1, variable: "DATABASE", value: "sqlite", statement: "going with SQLite, not Postgres" }),
    decisionProposed({ id: migration, transcript: t1, variable: "DATABASE", value: "migration-tools", statement: "skip migration tooling for now" }),
    decisionProposed({ id: pooling, transcript: t1, variable: "STORAGE", value: "connection-pooling", statement: "no connection pooling" }),
    /* The human confirms the two QUOTED premises. The derived one is deliberately left
     * unconfirmed: an OUT-list clause is broken by its premise becoming IN, and confirming an
     * exclusion would invalidate the justification at birth. Confirming nothing at all would leave
     * every premise UNKNOWN, which makes every decision OUT for the wrong reason and tests nothing. */
    premiseConfirmed(singleUser),
    premiseConfirmed(scope),
    justificationAttached(justSqlite, sqlite, [singleUser], [concurrentWriters]),
    justificationAttached(justMigration, migration, [scope], []),
    justificationAttached(justPooling, pooling, [singleUser], [concurrentWriters]),
  ]);

  return {
    ...built,
    t1,
    singleUser,
    concurrentWriters,
    scope,
    sqlite,
    migration,
    pooling,
    justSqlite,
    justMigration,
    justPooling,
  };
}

export { alternativeId, decisionId, justificationId, premiseId, transcriptId, LOCAL_ENGINE };
