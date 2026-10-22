#!/usr/bin/env python3
"""
Structural sanity check for the WhyLog source tree.

Run without installing anything:

    python3 scripts/check_structure.py
    npm run check:structure

What it verifies — the three things that are cheap to get wrong and expensive to
discover later:

  1. Every "@/..." and relative import resolves to a file that exists. A typo'd
     import path is a build failure, and with ~320 planned files it is the most
     likely single mistake in the tree.

  2. Brackets balance once comments, strings, template literals (including ${}
     nesting) and regex literals are stripped. An unbalanced file usually means a
     heredoc or a paste truncated it.

  3. The closed event vocabulary in src/types/events.ts and the runtime list in
     src/substrate/event-validation.ts contain the same types. They are duplicated
     on purpose — one is a type, one is a runtime set — and a drift between them
     means an event can be constructed but never appended, or appended but never
     folded.

Deliberately NOT a typechecker. `npm run typecheck` is the real gate; this is the
one that works in an environment with no node_modules.
"""

from __future__ import annotations

import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
EXTENSIONS = (".ts", ".tsx")


# -------------------------------------------------------------------------- #
# Source stripping
# -------------------------------------------------------------------------- #


def strip_noise(src: str) -> str:
    """Blank out comments, strings, template literals and regex literals."""
    out: list[str] = []
    i, n = 0, len(src)
    prev = ""  # last significant emitted char, used to spot a regex literal

    def emit(ch: str) -> None:
        nonlocal prev
        out.append(ch)
        if not ch.isspace():
            prev = ch

    while i < n:
        two = src[i : i + 2]
        c = src[i]

        if two == "//":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue

        if two == "/*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append("  ")
            continue

        if c == "`":
            depth = 0
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "`" and depth == 0:
                    i += 1
                    break
                if src[i : i + 2] == "${":
                    depth += 1
                    out.append("  ")
                    i += 2
                    continue
                if src[i] == "}" and depth > 0:
                    depth -= 1
                    out.append(" ")
                    i += 1
                    continue
                out.append(" ")
                i += 1
            emit(" ")
            continue

        if c in "\"'":
            quote = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                if src[i] == "\n":
                    break
                i += 1
            emit(" ")
            continue

        if c == "/" and (prev in "=([,!&|?:;{}+" or prev == ""):
            j = i + 1
            in_class = False
            closed = False
            while j < n:
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    closed = True
                    j += 1
                    break
                elif ch == "\n":
                    break
                j += 1
            if closed:
                while j < n and src[j].isalpha():
                    j += 1
                emit(" ")
                i = j
                continue

        emit(c)
        i += 1

    return "".join(out)


# -------------------------------------------------------------------------- #
# Checks
# -------------------------------------------------------------------------- #

IMPORT_FROM = re.compile(r"""from\s+["']([^"']+)["']""")
IMPORT_SIDE = re.compile(r"""^\s*import\s+["']([^"']+)["']""", re.M)
QUOTED = re.compile(r'''"([A-Za-z]+)"''')
EVENT_UNION = re.compile(r"export type EventType =([\s\S]*?);\n")

RESOLVABLE_SUFFIXES = (".ts", ".tsx", ".d.ts", ".css", ".json")


def rel(path: pathlib.Path) -> str:
    """Repo-relative path, always with forward slashes.

    `as_posix()` matters: `str(relative_to(...))` yields backslashes on Windows,
    so every allowlist comparison below silently stopped matching and the
    checker reported allowed files as violations.
    """
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def resolve(spec: str, origin: pathlib.Path) -> pathlib.Path | None:
    """Map an import specifier to a filesystem path, or None for a package."""
    if spec.startswith("@/"):
        target = SRC / spec[2:]
    elif spec.startswith("."):
        target = (origin.parent / spec).resolve()
    else:
        return None  # bare package specifier — node_modules resolves it

    candidates = [target.with_suffix(s) for s in RESOLVABLE_SUFFIXES]
    if target.suffix:
        candidates.insert(0, target)
    candidates += [target / "index.ts", target / "index.tsx"]

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return target


def check_imports(files: list[pathlib.Path]) -> list[str]:
    problems: list[str] = []
    for path in files:
        src = path.read_text(encoding="utf-8")
        specs = {m.group(1) for m in IMPORT_FROM.finditer(src)}
        specs |= {m.group(1) for m in IMPORT_SIDE.finditer(src)}
        for spec in sorted(specs):
            target = resolve(spec, path)
            if target is None:
                continue
            if not target.exists():
                problems.append(rel(path) + ": unresolved import '" + spec + "' -> " + rel(target))
    return problems


def check_balance(files: list[pathlib.Path]) -> list[str]:
    problems: list[str] = []
    pairs = (("{", "}", "braces"), ("(", ")", "parens"), ("[", "]", "brackets"))

    for path in files:
        code = strip_noise(path.read_text(encoding="utf-8"))
        counts = collections.Counter(ch for ch in code if ch in "{}()[]")
        for opener, closer, name in pairs:
            if counts[opener] != counts[closer]:
                problems.append(
                    rel(path)
                    + ": unbalanced "
                    + name
                    + " — "
                    + str(counts[opener])
                    + " open vs "
                    + str(counts[closer])
                    + " close"
                )
    return problems


def check_vocabulary() -> list[str]:
    """The type-level union and the runtime list must agree exactly."""
    types_path = SRC / "types" / "events.ts"
    validation_path = SRC / "substrate" / "event-validation.ts"
    if not types_path.is_file() or not validation_path.is_file():
        return []

    union_match = EVENT_UNION.search(types_path.read_text(encoding="utf-8"))
    if union_match is None:
        return ["src/types/events.ts: could not find the EventType union"]

    declared = set(QUOTED.findall(union_match.group(1)))

    runtime_src = validation_path.read_text(encoding="utf-8")
    marker = "export const EVENT_TYPES"
    if marker not in runtime_src:
        return ["src/substrate/event-validation.ts: could not find EVENT_TYPES"]

    start = runtime_src.index(marker)
    end = runtime_src.index("];", start)
    runtime = set(QUOTED.findall(runtime_src[start:end]))

    problems: list[str] = []
    missing = sorted(declared - runtime)
    unknown = sorted(runtime - declared)

    if missing:
        problems.append(
            "event vocabulary drift: in EventType but NOT in EVENT_TYPES — "
            + ", ".join(missing)
            + " (such an event could be constructed but never appended)"
        )
    if unknown:
        problems.append(
            "event vocabulary drift: in EVENT_TYPES but NOT in EventType — " + ", ".join(unknown)
        )

    count_marker = "export const EVENT_TYPE_COUNT"
    if count_marker in runtime_src and len(declared) != len(runtime):
        problems.append(
            "event vocabulary size: "
            + str(len(declared))
            + " declared in the union, "
            + str(len(runtime))
            + " listed at runtime"
        )
    return problems


def check_forbidden_patterns(files: list[pathlib.Path]) -> list[str]:
    """Two rules that are easy to break and expensive to discover late."""
    problems: list[str] = []

    for path in files:
        src = path.read_text(encoding="utf-8")
        where = rel(path)

        # The API key must never reach the event log or an export. Three modules
        # are allowed to name it: the one that stores it (substrate/persistence),
        # the one that resolves it (ai/config), and the settings slice that proxies
        # between them. Anywhere else it appears next to a payload or an export is
        # a leak.
        allowed = (
            "src/substrate/persistence.ts",
            "src/ai/config.ts",
            "src/store/settings.ts",
        )
        if "apiKey" in src and where not in allowed:
            if "payload" in src or "Export" in src:
                problems.append(where + ": mentions `apiKey` near a payload or export — keys live in localStorage only")

        # Math.random makes layouts and evaluations unreproducible. src/lib/rng.ts
        # is the single sanctioned source.
        if "Math.random" in src and "src/lib/rng.ts" not in where:
            problems.append(where + ": uses Math.random — use src/lib/rng.ts so runs reproduce")

    return problems


def main() -> int:
    files = sorted(p for p in SRC.rglob("*") if p.suffix in EXTENSIONS)
    if not files:
        print("no source files found under src/")
        return 1

    problems = (
        check_imports(files)
        + check_balance(files)
        + check_vocabulary()
        + check_forbidden_patterns(files)
    )

    total_lines = sum(len(p.read_text(encoding="utf-8").splitlines()) for p in files)
    print(str(len(files)) + " source files, " + format(total_lines, ",") + " lines")

    if problems:
        print("")
        print(str(len(problems)) + " problem(s):")
        print("")
        for problem in problems:
            print("  - " + problem)
        return 1

    print("  imports resolve · brackets balance · event vocabulary agrees · no forbidden patterns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
