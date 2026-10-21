/**
 * Glob matching for guard scoping and `applies_to`.
 *
 * Phase 4 · sub-phase 4.3, Phase 5 · sub-phase 5.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 *
 * Supports the subset that actually appears in decision records:
 *   *        any run of characters except "/"
 *   **       any run of characters including "/"
 *   ?        exactly one character except "/"
 *   {a,b}    alternation
 *   [abc]    character class
 *
 * Compiled to a RegExp once and cached — a guard set is evaluated against every
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
 * hits "pgp", "pgsql-tools" and any passing comment — which is how a guard
 * learns to cry wolf. See plan/phase-4 §4.3 and docs/04 §8.
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
