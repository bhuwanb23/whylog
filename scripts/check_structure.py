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

        # A `/` only opens a regex literal where a VALUE is expected. Two guards:
        #   • `prev` in the operator set — `x = /re/`, `return (/re/)`, `f(/re/)`.
        #   • or the `/` is the FIRST non-whitespace on its line — `return /re/`,
        #     where `prev` is the `n` of `return` and would otherwise be read as a
        #     division. Without this case an apostrophe inside the literal
        #     (`/let'?s/`) is mistaken for a string start and swallows the closing
        #     paren, reporting a phantom imbalance.
        # The "not followed by space or `=`" test is what keeps a real division
        # operator (`a / b`, `x /= 2`) from being mistaken for a regex.
        rest = src[i + 1 : i + 2]
        if (
            c == "/"
            and value_expected(src, i, prev)
            and rest not in ("", " ", "\t", "\n", "=")
        ):
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
                # Blank the whole literal as ONE unit. Emitting it character by
                # character would let an apostrophe inside a regex alternation
                # (`/let'?s/`) be mistaken for the start of a string, which then
                # swallows the closing paren and reports a phantom imbalance.
                out.append(" " * (j - i))
                if not src[i:j].isspace():
                    prev = "/"
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


# Keywords after which a `/` can only open a regex literal, never a division:
# they are followed by a VALUE, not by an operand.
VALUE_KEYWORDS = (
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
)


def value_expected(src: str, i: int, prev: str) -> bool:
    """Is a `/` at index `i` opening a regex literal rather than dividing?"""
    if prev in "=([,!&|?:;{}+" or prev == "":
        return True

    # Walk back over whitespace to the preceding word. `return /re/` has prev `n`,
    # which says "division" unless the whole word is checked.
    j = i - 1
    while j >= 0 and src[j] in " \t\n\r":
        j -= 1
    end = j + 1
    while j >= 0 and (src[j].isalnum() or src[j] == "_"):
        j -= 1
    word = src[j + 1 : end]
    return word in VALUE_KEYWORDS


def rel(path: pathlib.Path) -> str:
    # POSIX separators, always. The allowlists below name files with forward
    # slashes ("src/ai/config.ts"), and on Windows `str(relative_to(...))` gives
    # backslashes — so every allowlist entry silently fails to match and every
    # exempted file gets reported as a violation.
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


# ---------------------------------------------------------------------------
# Named-export resolution
#
# `check_imports` proves a PATH resolves. That is not enough: a module can import
# `{ findGlobs } from "@/lib/glob"` from a file that never declared `findGlobs`, and
# every path in the statement is perfectly valid. This check caught five real
# defects during Phase 1 (`fingerprintOf.premise`, `EngineConfig` from the wrong
# module, `LOCAL_DIMENSIONS` from the wrong module, `CompositionFact.text`,
# `CompositionRequest.instruction`), each of which would otherwise have surfaced as
# a bundler error on the user's machine.
# ---------------------------------------------------------------------------

EXPORT_DECL = re.compile(
    r"export\s+(?:declare\s+)?(?:async\s+)?function\*?\s+(\w+)"
    r"|export\s+(?:const|let|var|class|interface|type|enum)\s+(\w+)"
)
EXPORT_BLOCK = re.compile(r"export\s+(?:type\s+)?\{([^}]*)\}", re.S)
EXPORT_FROM = re.compile(r"export\s*\{([^}]*)\}\s*from\s*\"([^\"]+)\"", re.S)
EXPORT_STAR = re.compile(r"export\s*\*\s*from\s*\"([^\"]+)\"")
IMPORT_BLOCK = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+\"([^\"]+)\"", re.S)


def _strip_comments(src: str) -> str:
    """Drop block comments so prose mentioning `from "@/x"` is not read as an edge."""
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def declared_exports(path: pathlib.Path, seen: set | None = None) -> set:
    """Every name `path` exports, following re-exports transitively."""
    seen = seen if seen is not None else set()
    if path in seen:
        return set()
    seen.add(path)

    src = _strip_comments(path.read_text(encoding="utf-8"))
    names: set = set()

    for match in EXPORT_DECL.finditer(src):
        names.add(match.group(1) or match.group(2))

    for block in EXPORT_BLOCK.findall(src):
        for part in block.split(","):
            part = part.strip()
            if part:
                names.add(part.split(" as ")[-1].replace("type ", "").strip())

    for block, spec in EXPORT_FROM.findall(src):
        target = resolve(spec, path)
        if target is not None and target.exists():
            names |= declared_exports(target, seen)
        for part in block.split(","):
            part = part.strip()
            if part:
                names.add(part.split(" as ")[-1].replace("type ", "").strip())

    for spec in EXPORT_STAR.findall(src):
        target = resolve(spec, path)
        if target is not None and target.exists():
            names |= declared_exports(target, seen)

    return names


_EXPORT_CACHE: dict = {}


def exports_of(path: pathlib.Path) -> set:
    if path not in _EXPORT_CACHE:
        _EXPORT_CACHE[path] = declared_exports(path)
    return _EXPORT_CACHE[path]


def check_named_imports(files: list[pathlib.Path]) -> list[str]:
    problems: list[str] = []
    for path in files:
        src = _strip_comments(path.read_text(encoding="utf-8"))
        for block, spec in IMPORT_BLOCK.findall(src):
            target = resolve(spec, path)
            if target is None or not target.exists():
                continue
            available = exports_of(target)
            for part in block.split(","):
                name = part.strip().split(" as ")[0].replace("type ", "").strip()
                if not re.match(r"^\w+$", name):
                    continue
                if name not in available:
                    problems.append(
                        rel(path) + ": imports '" + name + "' from '" + spec
                        + "' — " + rel(target) + " does not export it"
                    )
    return problems


def check_named_reexports(files: list[pathlib.Path]) -> list[str]:
    """A barrel may re-export a name its target never declared."""
    problems: list[str] = []
    for path in files:
        src = _strip_comments(path.read_text(encoding="utf-8"))
        for block, spec in EXPORT_FROM.findall(src):
            target = resolve(spec, path)
            if target is None or not target.exists():
                problems.append(rel(path) + ": re-export path '" + spec + "' does not resolve")
                continue
            available = exports_of(target)
            for part in block.split(","):
                name = part.strip().split(" as ")[0].replace("type ", "").strip()
                if not re.match(r"^\w+$", name):
                    continue
                if name not in available:
                    problems.append(
                        rel(path) + ": re-exports '" + name + "' from '" + spec
                        + "' — " + rel(target) + " does not declare it"
                    )
    return problems


# ---------------------------------------------------------------------------
# Import cycles
#
# ESM hoisting makes a cycle WORK, which is why cycles survive review: nothing
# fails until one of the modules grows a top-level initialiser that reads the
# other. `speakers.ts` <-> `speakers-fallback.ts` sat like that for a whole
# sub-phase before it was broken by extracting `lines.ts`.
# ---------------------------------------------------------------------------

_SPEC_LINE = re.compile(
    r"^\s*(?:import|export)\b[^;]*?from\s+\"([^\"]+)\"\s*;?\s*$"
    r"|^\s*import\s+\"([^\"]+)\"\s*;\s*$",
    re.M,
)


def dependency_graph(files: list[pathlib.Path]) -> dict:
    graph: dict = {}
    for path in files:
        src = _strip_comments(path.read_text(encoding="utf-8"))
        deps: set = set()
        for match in _SPEC_LINE.finditer(src):
            spec = match.group(1) or match.group(2)
            target = resolve(spec, path)
            if target is not None and target != path and target.exists():
                deps.add(target)
        graph[path] = deps
    return graph


def check_cycles(files: list[pathlib.Path]) -> list[str]:
    graph = dependency_graph(files)
    WHITE, GREY, BLACK = 0, 1, 2
    colour = dict.fromkeys(graph, WHITE)
    stack: list = []
    found: list = []
    seen_cycles: set = set()

    def visit(node: pathlib.Path) -> None:
        colour[node] = GREY
        stack.append(node)
        for dep in sorted(graph.get(node, ())):
            if colour.get(dep) == GREY:
                cycle = stack[stack.index(dep):] + [dep]
                key = frozenset(cycle)
                if key not in seen_cycles:
                    seen_cycles.add(key)
                    found.append(" -> ".join(rel(p) for p in cycle))
            elif colour.get(dep) == WHITE:
                visit(dep)
        stack.pop()
        colour[node] = BLACK

    old_limit = sys.getrecursionlimit()
    sys.setrecursionlimit(max(old_limit, 10000))
    try:
        for path in sorted(graph):
            if colour[path] == WHITE:
                visit(path)
    finally:
        sys.setrecursionlimit(old_limit)

    return ["import cycle: " + cycle for cycle in found]


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
        + check_named_imports(files)
        + check_named_reexports(files)
        + check_cycles(files)
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

    print("  imports resolve ú named exports exist ú no cycles ú brackets balance")
    print("  event vocabulary agrees ú no forbidden patterns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
