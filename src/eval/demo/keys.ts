/**
 * The storage keys WhyLog owns.
 *
 * Phase 7 · sub-phase 7.5
 *
 * ---------------------------------------------------------------------------
 * DECLARED ONCE, CHECKED AGAINST THE CODE THAT USES THEM
 *
 * Three things need this list and they must not drift: the demo reset (clears them all), the persistence
 * layer (reads and writes them) and the keyless verification (asserts the demo touched only these).
 *
 * A reset that clears a key nothing uses is harmless. A reset that MISSES a key the persistence layer
 * does use leaves the next demo starting from the previous one's graph — and the presenter discovers it
 * three beats in, with an audience watching and no way to explain it.
 *
 * The list below was taken from the string literals actually present in `substrate/persistence.ts`,
 * `store/*` and `ai/config.ts`, not from memory. `verify.ts` re-derives it from the same sources at run
 * time and fails if the two disagree, so a new key added in a later phase cannot silently escape the
 * reset.
 * ---------------------------------------------------------------------------
 */

export const STORAGE_KEYS: readonly string[] = [
  /** The event log. The authoritative store — everything else is a rebuildable projection. */
  "whylog:v1",
  /** The retrieval index: BM25 postings, vectors, generated questions. Rebuildable from the log. */
  "whylog:index:v1",
  /** Engine configuration, including whether an API key is present. Cleared so a demo never starts
   *  with someone's key loaded — keyless verification is a requirement, not a preference. */
  "whylog:config:v1",
  /** The pending review queue. Cleared so the demo does not open on someone else's unreviewed imports. */
  "whylog:review:v1",
  /** Guard lifecycle state: which proposals were accepted, suppressed or deleted. */
  "whylog:guards:v1",
  /** Tuning settings, including cascade depth. Cleared so the demo runs at production defaults rather
   *  than at whatever the last rehearsal left behind — a capped cascade that hides over-retraction is a
   *  demo that cannot be trusted to show the real behaviour. */
  "whylog:settings:v1",
  /** The integrity marker the persistence layer writes alongside the log. Clearing the log without it
   *  would leave a marker claiming a chain that is no longer there. */
  "whylog:integrity",
];

export const LOG_KEY = "whylog:v1";
export const INDEX_KEY = "whylog:index:v1";
export const CONFIG_KEY = "whylog:config:v1";
export const REVIEW_KEY = "whylog:review:v1";
export const GUARDS_KEY = "whylog:guards:v1";
export const SETTINGS_KEY = "whylog:settings:v1";
export const INTEGRITY_KEY = "whylog:integrity";

/** Keys that hold a rebuildable projection rather than authoritative state. A reset can skip these and
 *  still be correct, though it does not: clearing them forces a rebuild, which is slower by a second and
 *  proves the rebuild path works on stage rather than in theory. */
export const DERIVED_KEYS: readonly string[] = [INDEX_KEY, REVIEW_KEY];

/** The genesis hash the persistence layer writes into an empty log. Listed here because it is a
 *  `whylog:`-prefixed literal in the source that is NOT a storage key — it is a hash constant — and a
 *  reset that tried to clear it would be clearing nothing while appearing thorough. */
export const NOT_A_STORAGE_KEY: readonly string[] = [
  "whylog:genesis:00000000000000000000000000000000",
  "whylog:",
];
