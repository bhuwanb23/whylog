/**
 * Assertion helpers.
 *
 * Used for INTERNAL invariants — conditions that must hold if the code is
 * correct. Never for user input, which is validated with `Result` instead.
 *
 * The distinction matters: an invariant violation is a BUG and should throw
 * loudly in development. Bad user input is expected and must degrade gracefully.
 */

/**
 * Throws when a switch or if-chain that was meant to be exhaustive falls
 * through. TypeScript narrows `value` to `never` at the call site, so adding a
 * new union member produces a compile error at every switch that forgot it.
 */
export function unreachable(value: never, context?: string): never {
  const detail = context ? ` (${context})` : "";
  throw new Error(`Unreachable branch reached${detail}: ${String(value)}`);
}

/** Assert with a readable message. Stripped from production builds by the
 *  bundler when wrapped in `import.meta.env.DEV`. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violated: ${message}`);
  }
}

/** Non-null assertion that throws rather than silently producing undefined.
 *  Preferred over `!` everywhere — `noUncheckedIndexedAccess` is on, and a
 *  missing map entry is a real bug worth naming. */
export function mustExist<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected a value: ${message}`);
  }
  return value;
}

/** Look up a map entry or throw with the key in the message. */
export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${label}: ${String(key)}`);
  }
  return value;
}

/**
 * Development-only check. Returns the condition so it can be used inline.
 *
 * `import.meta.env.DEV` is a Vite compile-time constant, so the whole branch is
 * dead-code eliminated from a production build — no console access, no `process`
 * reference, and nothing for a bundler to polyfill.
 */
export function devAssert(condition: boolean, message: string): boolean {
  if (!condition && import.meta.env.DEV) {
    console.error(`[whylog] ${message}`);
  }
  return condition;
}
