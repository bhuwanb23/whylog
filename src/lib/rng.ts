/**
 * Deterministic pseudo-random numbers.
 *
 * Used by the premise-lattice force layout (Phase 6.6) and by the evaluation
 * harness (Phase 7), both of which must reproduce exactly.
 *
 * `Math.random()` is banned in src/ outside this module: a layout that jitters
 * differently on every render cannot be screenshotted for a pitch, and an
 * evaluation that samples differently on every run cannot be reported.
 */

/** mulberry32 — small, fast, well-distributed, seedable. */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T | undefined;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        const swap = out[j];
        if (tmp !== undefined && swap !== undefined) {
          out[i] = swap;
          out[j] = tmp;
        }
      }
      return out;
    },
  };
}

/** Seed from a string, so a fixture name produces a stable layout. */
export function seedFromString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The layout seed used by the premise lattice. Fixed, so the graph is stable
 *  across renders and screenshots. */
export const LATTICE_SEED = 0x5eed1a7e;
