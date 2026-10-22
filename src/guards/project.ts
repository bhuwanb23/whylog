/**
 * The virtual project — 4.3.
 *
 * Phase 4 · sub-phase 4.3
 * Plan: plan/phase-4-executable-guards.md §4.3
 * Docs: docs/04-executable-decision-guards.md §5.1
 *
 * ---------------------------------------------------------------------------
 * GUARDS HAVE TO RUN SOMEWHERE, AND HERE THERE IS NO SHELL
 *
 * The app runs in a browser, inside a sandboxed preview, with no filesystem access and no
 * network. A guard system that needed those would not be demonstrable at all.
 *
 * So the user pastes what their project looks like — a `package.json`, a file listing from
 * `tree` / `git ls-files` / `find . -type f`, and optionally file contents — and the
 * interpreter evaluates real logic against that real data in memory.
 *
 * **This is the designed default and not a compromise.** It is real evaluation: the same
 * predicate, the same evidence string, the same pass/fail the exported CI runner produces. The
 * only thing missing is automatic file discovery, which is a repo-connection concern (v2), not
 * a correctness concern.
 *
 * ---------------------------------------------------------------------------
 * ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE
 *
 * The rule that makes this honest. Paste a `package.json` and nothing else, and:
 *
 *   dependency guards   EVALUATE — the manifest is exactly the data they need
 *   path guards         SKIP    — there is no listing, so "no files match" is unknowable
 *   string guards       SKIP    — there are no contents
 *
 * A skip is never a pass. If a `path_glob_absent` guard PASSED against an empty listing it
 * would report success for a codebase it never saw, and the compliance score would be a
 * measurement of how little the user pasted. `GuardRunReport.nothingCheckable` exists so a run
 * that could check nothing cannot be mistaken for a clean run.
 *
 * ---------------------------------------------------------------------------
 * UNPARSEABLE LINES ARE KEPT, NOT DROPPED
 *
 * A parse that silently ignores a line produces a project missing a file, and a missing file
 * makes `path_glob_exists` fail for a reason that has nothing to do with the codebase. So every
 * line that could not be interpreted is reported back. A truncated listing is a real hazard for
 * this whole approach and the user is entitled to see its extent.
 * ---------------------------------------------------------------------------
 */

import { nowISO } from "@/lib/format";
import { isGlob } from "@/lib/glob";
import type { ISODateString } from "@/types/common";
import type { VirtualProject, VirtualProjectSource } from "@/types/guards";
import type { ProjectParseReport } from "./types";

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export interface ProjectInput {
  /** A whole `package.json`, or just its dependencies object. */
  readonly manifest?: string;
  /** `tree`, `git ls-files`, or `find . -type f` output. */
  readonly listing?: string;
  /** File contents, in any of the shapes `parseFileContents` accepts. */
  readonly contents?: string;
  readonly source?: VirtualProjectSource;
}

/**
 * Build the virtual project.
 *
 * Never throws. Malformed JSON, a listing in an unrecognised shape and empty input are all
 * ordinary outcomes that get reported rather than raised: a guard panel that crashes on a bad
 * paste is a panel nobody pastes into twice.
 */
export function buildProject(input: ProjectInput): ProjectParseReport {
  const notices: string[] = [];
  const unparsed: string[] = [];

  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};

  if (input.manifest !== undefined && input.manifest.trim().length > 0) {
    const parsed = parseManifest(input.manifest);
    dependencies = parsed.dependencies;
    devDependencies = parsed.devDependencies;
    notices.push(...parsed.notices);
    unparsed.push(...parsed.unparsed);
  } else {
    notices.push("No package.json was pasted, so dependency guards cannot run.");
  }

  let filePaths: readonly string[] = [];
  if (input.listing !== undefined && input.listing.trim().length > 0) {
    const parsed = parseFileListing(input.listing);
    filePaths = parsed.paths;
    notices.push(...parsed.notices);
    unparsed.push(...parsed.unparsed);
  } else {
    notices.push(
      "No file listing was pasted, so path guards will SKIP rather than pass. Paste the output of `git ls-files`, `find . -type f` or `tree`.",
    );
  }

  let fileContents: Record<string, string> = {};
  if (input.contents !== undefined && input.contents.trim().length > 0) {
    const parsed = parseFileContents(input.contents);
    fileContents = parsed.contents;
    notices.push(...parsed.notices);
    unparsed.push(...parsed.unparsed);
  } else {
    notices.push("No file contents were pasted, so string guards will SKIP rather than pass.");
  }

  /* Paths named in the contents are also paths in the project. A user who pastes contents but
   * no listing still has a listing, implicitly, and ignoring it would skip the path guards for
   * no reason. */
  const implied = Object.keys(fileContents).filter((path) => !filePaths.includes(path));
  if (implied.length > 0 && filePaths.length === 0) {
    filePaths = implied;
    notices.push(
      `No listing was pasted, so the ${implied.length} file(s) named in the contents are used as the listing. Path guards can run; a file you did not paste is still absent from them.`,
    );
  } else if (implied.length > 0) {
    filePaths = [...filePaths, ...implied];
  }

  const project: VirtualProject = {
    dependencies,
    devDependencies,
    filePaths,
    fileContents,
    sourcedFrom: input.source ?? defaultSource(input),
    loadedAt: nowISO() as ISODateString,
  };

  return {
    project,
    dependenciesParsed: Object.keys(dependencies).length,
    devDependenciesParsed: Object.keys(devDependencies).length,
    filesParsed: filePaths.length,
    contentsParsed: Object.keys(fileContents).length,
    unparsed,
    notices,
  };
}

function defaultSource(input: ProjectInput): VirtualProjectSource {
  if (input.manifest !== undefined && input.manifest.trim().length > 0)
    return { kind: "pasted-manifest" };
  if (input.listing !== undefined && input.listing.trim().length > 0)
    return { kind: "pasted-file-listing" };
  return { kind: "pasted-manifest" };
}

/* -------------------------------------------------------------------------- */
/* package.json                                                               */
/* -------------------------------------------------------------------------- */

interface ManifestParse {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly notices: readonly string[];
  readonly unparsed: readonly string[];
}

/**
 * Parse a manifest.
 *
 * Accepts a whole `package.json` OR just the fragment a user is likely to paste — a
 * dependencies object on its own, or loose `"name": "version"` lines. The loose form is
 * supported because someone answering "does my project have pg in it?" pastes the bit they
 * were looking at, not the whole file, and rejecting that paste would make the dependency
 * guards — the two most reliable kinds in the taxonomy — unusable in the demo.
 */
export function parseManifest(raw: string): ManifestParse {
  const notices: string[] = [];
  const unparsed: string[] = [];

  const trimmed = raw.trim();

  /* ---- try it as JSON first ---- */
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;

      /* A bare dependencies object rather than a whole manifest: every value is a string. */
      if (record["dependencies"] === undefined && record["devDependencies"] === undefined) {
        const loose = asVersionMap(record);
        if (loose !== null) {
          return {
            dependencies: loose,
            devDependencies: {},
            notices: [
              "Parsed as a bare dependency map (no `dependencies` wrapper), so all of it is treated as runtime dependencies.",
            ],
            unparsed,
          };
        }
      }

      return {
        dependencies: asVersionMap(record["dependencies"]) ?? {},
        devDependencies: asVersionMap(record["devDependencies"]) ?? {},
        notices,
        unparsed,
      };
    }
    notices.push(
      "The pasted manifest parsed as JSON but not as an object, so no dependencies were read.",
    );
  } catch {
    /* Not JSON — fall through to the line-based parse. This is the common case and not an
     * error: the notices below say what was recovered. */
  }

  /* ---- fall back to `"name": "version"` lines ---- */
  const dependencies: Record<string, string> = {};
  let section: "dependencies" | "devDependencies" | null = null;
  let count = 0;

  for (const line of trimmed.split("\n")) {
    const text = line.trim();
    if (text.length === 0) continue;

    if (/^"?devDependencies"?\s*:/.test(text)) {
      section = "devDependencies";
      continue;
    }
    if (/^"?dependencies"?\s*:/.test(text)) {
      section = "dependencies";
      continue;
    }

    const match = /^"?(@?[^"\s:]+)"?\s*:\s*"([^"]*)"/.exec(text);
    if (match === null) {
      /* Only report lines that look like they were MEANT to be dependencies. Braces, commas
       * and unrelated prose are not worth flagging, and flagging them would bury the one line
       * that actually matters. */
      if (text.includes(":") && !/^[{}[\],]+$/.test(text)) unparsed.push(text);
      continue;
    }

    const name = match[1];
    const version = match[2];
    if (name === undefined || version === undefined) continue;

    dependencies[name] = version;
    count += 1;
  }

  if (count === 0) {
    notices.push(
      'The pasted manifest was not JSON and contained no recognisable `"name": "version"` lines, so no dependencies were read.',
    );
  } else {
    notices.push(
      `The pasted manifest was not valid JSON. Recovered ${count} dependency line(s) by pattern${section === "devDependencies" ? "; the last section seen was devDependencies, but without valid JSON the split cannot be trusted, so all of them are treated as runtime dependencies." : "."}`,
    );
  }

  return { dependencies, devDependencies: {}, notices, unparsed };
}

/** A record whose values are all strings, i.e. a dependency map. */
function asVersionMap(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;

  const out: Record<string, string> = {};
  let count = 0;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") continue;
    out[key] = entry;
    count += 1;
  }

  return count > 0 ? out : null;
}

/* -------------------------------------------------------------------------- */
/* File listings                                                              */
/* -------------------------------------------------------------------------- */

interface ListingParse {
  readonly paths: readonly string[];
  readonly notices: readonly string[];
  readonly unparsed: readonly string[];
}

/**
 * Parse a file listing.
 *
 * Three shapes, auto-detected per line:
 *
 *   `tree`          box-drawing prefixes and indentation, directories to reconstruct
 *   `git ls-files`  one clean relative path per line
 *   `find -type f`  one path per line, usually with a `./` prefix
 */
export function parseFileListing(raw: string): ListingParse {
  const lines = raw.split("\n");
  const notices: string[] = [];
  const unparsed: string[] = [];

  const looksLikeTree = lines.some((line) => /[├└│─]/.test(line));
  const parsed = looksLikeTree ? parseTree(lines) : parsePlainLines(lines);

  if (parsed.paths.length === 0) {
    notices.push(
      looksLikeTree
        ? "The listing looked like `tree` output but no file paths could be reconstructed from it."
        : "No file paths were recognised in the listing.",
    );
  } else {
    notices.push(
      `Read ${parsed.paths.length} path(s) from ${looksLikeTree ? "`tree`-style" : "plain"} listing.${parsed.directoryCount > 0 ? ` ${parsed.directoryCount} directory node(s) were reconstructed and are not listed as files.` : ""}`,
    );
  }

  unparsed.push(...parsed.unparsed);

  return { paths: parsed.paths, notices, unparsed };
}

interface TreeParse {
  readonly paths: readonly string[];
  readonly unparsed: readonly string[];
  readonly directoryCount: number;
}

/** Reconstruct full paths from `tree` output by tracking indentation depth. */
function parseTree(lines: readonly string[]): TreeParse {
  const out: string[] = [];
  const unparsed: string[] = [];
  /* Stack of directory names by depth. `dirs[d]` is the directory name at depth d. */
  const dirs: string[] = [];
  let directoryCount = 0;

  for (const raw of lines) {
    if (raw.trim().length === 0) continue;

    /* The summary line tree prints at the end. */
    if (/^\s*\d+\s+director/.test(raw)) continue;
    /* The root line, usually "." or a directory name with no prefix. */
    const prefixMatch = /^([\s│├└─]*)/.exec(raw);
    const prefix = prefixMatch?.[1] ?? "";

    if (!/[├└│]/.test(raw) && prefix.trim().length === 0) {
      /* Root of the tree. Depth 0 with no connector — record as the base directory unless it
       * is "." which means "the project root" and contributes no path segment. */
      const root = raw.trim();
      if (root !== "." && root !== "./" && root.length > 0) dirs[0] = root;
      continue;
    }

    const name = raw
      .replace(/[│├└─]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length === 0) continue;

    /* Depth = how many 4-character indent units precede the connector. */
    const depth = Math.max(0, Math.floor(prefix.replace(/[^│ ]/g, "").length / 4));

    const isDir = looksLikeDirectory(name, depth, lines, raw);
    if (isDir) {
      dirs[depth] = name;
      dirs.length = depth + 1;
      directoryCount += 1;
      continue;
    }

    const parents = dirs
      .slice(0, depth)
      .filter((segment) => segment !== undefined && segment !== ".");
    out.push([...parents, name].join("/"));
  }

  return { paths: dedupe(out), unparsed, directoryCount };
}

/**
 * Is this tree node a directory?
 *
 * A node is a directory if some later line is indented deeper than it — that is the only
 * reliable signal, because `tree` marks directories by colour, not by punctuation. The
 * extension heuristic is a fallback for the last node in a subtree, which has no deeper line
 * after it.
 */
function looksLikeDirectory(
  name: string,
  depth: number,
  lines: readonly string[],
  current: string,
): boolean {
  const index = lines.indexOf(current);
  if (index >= 0) {
    for (let i = index + 1; i < lines.length; i += 1) {
      const next = lines[i];
      if (next === undefined || next.trim().length === 0) continue;
      if (!/[├└│]/.test(next)) break;

      const nextPrefix = /^([\s│├└─]*)/.exec(next)?.[1] ?? "";
      const nextDepth = Math.max(0, Math.floor(nextPrefix.replace(/[^│ ]/g, "").length / 4));
      if (nextDepth > depth) return true;
      break;
    }
  }

  /* Fallback: no extension and no dot in the last segment. Wrong for extensionless files like
   * `Makefile` and `Dockerfile`, so those are special-cased — a guard that reports a Makefile
   * as a directory silently removes it from the listing. */
  if (EXTENSIONLESS_FILES.has(name.toLowerCase())) return false;
  return !name.includes(".") && !isGlob(name);
}

const EXTENSIONLESS_FILES: ReadonlySet<string> = new Set([
  "makefile",
  "dockerfile",
  "license",
  "readme",
  "procfile",
  "gemfile",
  "rakefile",
  "justfile",
  "brewfile",
  "cargo.lock",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".gitignore",
  ".editorconfig",
  ".nvmrc",
  ".env",
]);

function parsePlainLines(lines: readonly string[]): TreeParse {
  const out: string[] = [];
  const unparsed: string[] = [];

  for (const raw of lines) {
    const text = raw.trim();
    if (text.length === 0) continue;

    /* `find` prefixes with ./ ; `ls -R` prints "dir:" headers; `tree` summaries are prose. */
    if (/^\d+\s+director/.test(text)) continue;
    if (text.endsWith(":") && !text.includes("/")) continue;

    const path = text.replace(/^\.\//, "").replace(/^\/+/, "");

    if (!looksLikePath(path)) {
      /* Only flag lines that could plausibly have been paths. Prose in a paste is common —
       * people paste a whole terminal scrollback — and flagging every word of it would bury
       * the one malformed path that matters. */
      if (path.includes("/") || path.includes(".")) unparsed.push(text);
      continue;
    }

    out.push(path);
  }

  return { paths: dedupe(out), unparsed, directoryCount: 0 };
}

/** A path has a separator or an extension, and no whitespace or shell metacharacters. */
function looksLikePath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 400) return false;
  if (/\s/.test(candidate)) return false;
  if (/[*?"<>|]/.test(candidate)) return false;
  if (candidate.includes("/")) return true;
  return candidate.includes(".") && !candidate.startsWith(".");
}

function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

/* -------------------------------------------------------------------------- */
/* File contents                                                              */
/* -------------------------------------------------------------------------- */

interface ContentsParse {
  readonly contents: Record<string, string>;
  readonly notices: readonly string[];
  readonly unparsed: readonly string[];
}

/**
 * Parse pasted file contents.
 *
 * Accepts the shapes people actually paste:
 *
 *   `--- src/db/schema.ts ---`      fenced with dashes
 *   `=== src/db/schema.ts ===`      fenced with equals
 *   `## src/db/schema.ts`           markdown heading
 *   `// src/db/schema.ts`           a comment header, when the path looks like one
 *   `src/db/schema.ts:`             a trailing-colon header, as `grep -n` or `head` prints
 *
 * Anything before the first header is treated as a single unnamed blob and reported, not
 * silently discarded.
 */
export function parseFileContents(raw: string): ContentsParse {
  const lines = raw.split("\n");
  const notices: string[] = [];
  const unparsed: string[] = [];
  const contents: Record<string, string> = {};

  let current: string | null = null;
  let buffer: string[] = [];
  let headers = 0;

  const flush = (): void => {
    if (current === null) return;
    contents[current] = buffer.join("\n");
    buffer = [];
  };

  for (const line of lines) {
    const header = headerOf(line);

    if (header !== null) {
      flush();
      current = header;
      headers += 1;
      continue;
    }

    if (current === null) {
      /* Content before any header. Kept so it can be reported; assigning it to a guessed path
       * would invent a file that does not exist. */
      if (line.trim().length > 0) unparsed.push(line);
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (headers === 0) {
    notices.push(
      "The pasted contents had no recognisable file headers, so nothing was attributed to a path. Separate files with a line like `--- src/db/schema.ts ---`.",
    );
  } else {
    notices.push(`Read contents for ${headers} file(s). String guards can now run against them.`);
  }

  return { contents, notices, unparsed };
}

const HEADER_PATTERNS: readonly RegExp[] = [
  /^[-=]{2,}\s*(.+?)\s*[-=]{2,}$/,
  /^#{1,6}\s+(.+?)\s*#*$/,
  /^\/\/\/?\s*(\S+\.\S+)\s*$/,
  /^\/\*\s*(\S+\.\S+)\s*\*\/$/,
  /^<!--\s*(\S+\.\S+)\s*-->/,
  /^(\S+\.\S+):\s*$/,
];

/** Is this line a file header? Returns the path, or null. */
function headerOf(line: string): string | null {
  const text = line.trim();
  if (text.length === 0 || text.length > 300) return null;

  for (const pattern of HEADER_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) continue;

    const candidate = match[1]?.trim();
    if (candidate === undefined) continue;
    if (!looksLikePath(candidate)) continue;

    /* A header must look like a path AND not like a sentence. `--- this is a note ---` would
     * otherwise become a file called "this is a note", and a phantom path in the listing makes
     * path guards fail against nothing. */
    if (/\s/.test(candidate)) continue;

    return candidate.replace(/^\.\//, "");
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Project queries — what the evaluators actually call                        */
/* -------------------------------------------------------------------------- */

/** Is a package present? `includeDev` decides whether devDependencies count. */
export function findDependency(
  project: VirtualProject,
  name: string,
  includeDev: boolean,
): { version: string; dev: boolean } | null {
  const runtime = project.dependencies[name];
  if (runtime !== undefined) return { version: runtime, dev: false };

  if (includeDev) {
    const dev = project.devDependencies[name];
    if (dev !== undefined) return { version: dev, dev: true };
  }

  return null;
}

/** The exact manifest line for a dependency, quoted verbatim. The evidence string in a
 *  failure comes from here, because evidence without a quote is not evidence. */
export function dependencyEvidenceLine(
  _project: VirtualProject,
  name: string,
  found: { version: string; dev: boolean },
): string {
  const section = found.dev ? "devDependencies" : "dependencies";
  return `"${name}": "${found.version}" found in package.json ${section}`;
}

/** Can path guards run at all? False when no listing was pasted. */
export function hasFileListing(project: VirtualProject): boolean {
  return project.filePaths.length > 0;
}

/** Can string guards run at all? False when no contents were pasted. */
export function hasFileContents(project: VirtualProject): boolean {
  return Object.keys(project.fileContents).length > 0;
}

/** Can dependency guards run at all? */
export function hasManifest(project: VirtualProject): boolean {
  return (
    Object.keys(project.dependencies).length > 0 || Object.keys(project.devDependencies).length > 0
  );
}

export function describeProject(project: VirtualProject): string {
  const deps = Object.keys(project.dependencies).length;
  const dev = Object.keys(project.devDependencies).length;
  const files = project.filePaths.length;
  const contents = Object.keys(project.fileContents).length;

  return [
    `Virtual project · loaded ${project.loadedAt} · source ${project.sourcedFrom.kind}`,
    `  dependencies     ${deps} runtime, ${dev} dev${deps + dev === 0 ? "  — dependency guards will SKIP" : ""}`,
    `  file listing     ${files} path(s)${files === 0 ? "  — path guards will SKIP" : ""}`,
    `  file contents    ${contents} file(s)${contents === 0 ? "  — string guards will SKIP" : ""}`,
    "",
    "A skip is never a pass. Guards whose data was not pasted report SKIP with a reason, so a",
    "run that could check nothing cannot be mistaken for a clean run.",
  ].join("\n");
}
