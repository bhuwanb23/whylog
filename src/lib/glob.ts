/**
 * Glob matching for guard scoping and `applies_to`.
 *
 * Phase 4 ┬╖ sub-phase 4.3, Phase 5 ┬╖ sub-phase 5.3
 * Plan: plan/phase-4-executable-guards.md ┬º4.3
 *
 * Supports the subset that actually appears in decision records:
 *   *        any run of characters except "/"
 *   **       any run of characters including "/"
 *   ?        exactly one character except "/"
 *   {a,b}    alternation
 *   [abc]    character class
 *
 * Compiled to a RegExp once and cached ΓÇö a guard set is evaluated against every
 * file in the project, so recompiling per file would dominate the runtime.
 */

const cache = new Map<string, RegExp>();

function escapeLiteral(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Translate a glob into a RegExp source string. */
export function globToRegExpSource(glob: string): string {
  let out = "^";
  let i = 0;

  while (i < glob.length) {
    const ch = glob[i] as string;

    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` should also match zero directories.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    if (ch === "{") {
      const close = glob.indexOf("}", i);
      if (close > i) {
        const options = glob.slice(i + 1, close).split(",");
        out += `(?:${options.map(globToRegExpSource).join("|")})`;
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      const close = glob.indexOf("]", i);
      if (close > i) {
        out += glob.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }

    out += escapeLiteral(ch);
    i += 1;
  }

  return `${out}$`;
}

export function compileGlob(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  const re = new RegExp(globToRegExpSource(glob));
  cache.set(glob, re);
  return re;
}

export function matchesGlob(path: string, glob: string): boolean {
  return compileGlob(glob).test(path);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(path, g));
}

export function filterByGlob(paths: readonly string[], glob: string): readonly string[] {
  const re = compileGlob(glob);
  return paths.filter((p) => re.test(p));
}

/**
 * Word-boundary pattern matching.
 *
 * Default for every `string_*` guard, because a bare substring match on "pg"
 * hits "pgp", "pgsql-tools" and any passing comment ΓÇö which is how a guard
 * learns to cry wolf. See plan/phase-4 ┬º4.3 and docs/04 ┬º8.
 */
export function compilePattern(
  pattern: string,
  options: { wordBoundary?: boolean; caseSensitive?: boolean } = {},
): RegExp {
  const { wordBoundary = true, caseSensitive = false } = options;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = wordBoundary ? `\\b${escaped}\\b` : escaped;
  return new RegExp(source, caseSensitive ? "g" : "gi");
}

/** Returns the first matching line and its 1-based number, or null. The evidence
 *  string quoted into a revision proposal comes from here. */
export function findMatchInText(
  text: string,
  pattern: string,
  options: { wordBoundary?: boolean; caseSensitive?: boolean } = {},
): { line: number; text: string } | null {
  const re = compilePattern(pattern, options);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    re.lastIndex = 0;
    if (re.test(line)) return { line: i + 1, text: line.trim() };
  }
  return null;
}

export function clearGlobCache(): void {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Finding globs in prose                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A path-shaped string that contains at least one wildcard.
 *
 * Deliberately requires a wildcard: `src/db/schema.ts` is a FILE, and `applies_to`
 * is a scope. Recording a file as a scope would make a decision look narrower than
 * it is, and a guard scoped to one file would pass forever while the decision it
 * protects rotted.
 */
const GLOB_IN_TEXT =
  /(?:^|[\s`"'(,])([\w.@/-]*(?:\*\*|\*|\?|\{[\w,.-]+\})[\w.@/*?{},-]*)/g;

/**
 * Every glob mentioned in a stretch of text, de-duplicated, in order of first
 * appearance.
 *
 * Used by Phase 1.3 to fill `appliesTo`, which drives `applies_to` in export
 * (plan/phase-5 ┬º5.3) and guard scoping (plan/phase-4 ┬º4.2).
 */
export function findGlobs(text: string, limit = 12): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(GLOB_IN_TEXT)) {
    const raw = (match[1] ?? "").replace(/[,.;:)]+$/g, "");
    if (raw.length === 0) continue;

    const normalised = raw.replace(/^\/+/, "");
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    found.push(normalised);

    if (found.length >= limit) break;
  }

  return found;
}

/** Is this string a glob rather than a plain path? */
export function isGlob(candidate: string): boolean {
  return /[*?]|\{[\w,.-]+\}/.test(candidate);
}
