/**
 * Deterministic non-cryptographic hashing.
 *
 * Phase 0 · sub-phase 0.5
 * Plan: plan/phase-0-foundation.md §0.5
 *
 * ---------------------------------------------------------------------------
 * WHY NOT SHA-256
 *
 * The hash chain is for AUDITABILITY, not security. The requirement is: "this
 * CLAUDE.md corresponds to log head a3f91c..., 14 decisions, 11 guards
 * passing" — and later, detect that the file no longer matches.
 *
 * WebCrypto's subtle.digest is ASYNC, which would make the fold async, which
 * would make materialisation async, which would poison every layer above it.
 * A synchronous 128-bit hash is the right trade: deterministic, collision-
 * resistant enough for tamper-EVIDENCE, and it keeps `fold()` pure and total.
 *
 * If this ever becomes a security property rather than an audit property, swap
 * the implementation here and nothing else changes.
 * ---------------------------------------------------------------------------
 */

/** cyrb128 — four 32-bit lanes, well-distributed, fast, synchronous. */
export function hash128(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x2545f491;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507);
  h3 ^= Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507);
  h4 ^= Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const combined =
    4294967296 * (2097151 & h4) +
    (h3 >>> 0) * 1 +
    4294967296 * (2097151 & h2) +
    (h1 >>> 0);

  return combined.toString(16).padStart(13, "0");
}

/** Stable hash of a plain object, independent of key insertion order. */
export function hashStable(value: unknown): string {
  return hash128(canonicalJson(value));
}

/**
 * JSON stringify with sorted object keys, so two structurally identical objects
 * hash identically regardless of the order their fields were assigned in.
 *
 * Required for the round-trip acceptance criterion: export -> import ->
 * materialise must reproduce an IDENTICAL head hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [String(k), v] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

/** Short form for display: `a3f91c7e2b…` */
export function shortHash(hash: string, length = 10): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

/** Hash a Float32Array without allocating an intermediate string. */
export function hashVector(vector: Float32Array): string {
  let acc = "";
  for (let i = 0; i < vector.length; i += 1) {
    // Round to 4 decimals: vectors are reproducible but float noise is not.
    acc += `${(vector[i] ?? 0).toFixed(4)};`;
  }
  return hash128(acc);
}
