/**
 * Result type for fallible operations.
 *
 * Used at every boundary where failure is EXPECTED rather than exceptional:
 * parsing a pasted package.json, validating an imported log, resolving an
 * entity, evaluating a guard, checking a hash chain.
 *
 * Throwing at these boundaries loses the reason, and the reason is the product ΓÇö
 * a guard failure without its evidence string cannot become a revision proposal.
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T, E = string>(value: T): Result<T, E> => ({ ok: true, value });
export const err = <T, E = string>(error: E): Result<T, E> => ({ ok: false, error });

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function unwrap<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  }
  return result.value;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Collect results, failing fast on the first error. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** Collect results, partitioning successes from failures. Used by the extraction
 *  review queue, where a partially-successful batch is the normal case. */
export function partition<T, E>(
  results: readonly Result<T, E>[],
): { values: T[]; errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return { values, errors };
}

/** A Result carrying a structured error rather than a string. */
export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly detail?: unknown;
}

export const failure = (code: string, message: string, detail?: unknown): Failure => ({
  code,
  message,
  ...(detail === undefined ? {} : { detail }),
});
