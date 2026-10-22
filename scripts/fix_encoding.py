#!/usr/bin/env python3
"""
Repair CP437 mojibake in text files.

WHAT HAPPENED
-------------
UTF-8 source was written through a CP437 (DOS OEM) console. Every UTF-8 byte
became one CP437 character, so an em-dash (U+2014, bytes E2 80 94) turned into
the three characters "—". The files stayed valid UTF-8, so nothing complained,
and the damage was invisible until a STRING COMPARISON failed.

WHY IT MATTERED
----------------
The derived-premise marker is `"— excluded by"`. The premise text was produced
in one file (mojibake) and matched in another (correct), so `isDerivedPremise`
never matched, every derived exclusion was CONFIRMED, and gate (c)'s OUT-list
half never fired. A silent encoding bug had disabled a correctness mechanism.

THE REPAIR
----------
The inverse of the corruption: take the CP437 bytes back, decode them as UTF-8.
It is applied per byte-run, and only where the result is valid UTF-8. A file
whose ASCII skeleton changes is REJECTED and left alone, because that would
mean real content moved rather than a character being re-encoded.

Usage:
    python scripts/fix_encoding.py            # dry run: report what would change
    python scripts/fix_encoding.py --apply    # write the repairs
    python scripts/fix_encoding.py --root DIR # operate on another tree
"""

from __future__ import annotations

import collections
import pathlib
import sys

SUFFIXES = {".ts", ".tsx", ".py", ".mjs", ".cjs", ".md", ".json", ".html", ".css"}
SKIP_DIRS = {"node_modules", ".git", "dist", "coverage", ".next"}


def repair(text: str) -> str:
    """Undo a CP437 round-trip on the byte runs that are recoverable."""
    out: list[str] = []
    buf = bytearray()

    def flush() -> None:
        nonlocal buf
        while buf:
            try:
                out.append(buf.decode("utf-8"))
                buf.clear()
                return
            except UnicodeDecodeError as err:
                if err.reason == "unexpected end of data":
                    # Incomplete trailing sequence: hold it for the next character.
                    return
                if err.start == 0:
                    # Not a UTF-8 lead byte: keep the byte as it was.
                    out.append(bytes([buf[0]]).decode("cp437", errors="replace"))
                    del buf[0]
                    continue
                out.append(buf[: err.start].decode("utf-8"))
                del buf[: err.start]
                return

    for ch in text:
        try:
            buf += ch.encode("cp437")
        except UnicodeEncodeError:
            flush()
            out.append(ch)
            continue
        flush()
    flush()
    return "".join(out)


def skeleton(text: str) -> str:
    """The ASCII-only content. A repair must not change this."""
    return "".join(c for c in text if ord(c) < 128)


def main() -> int:
    apply = "--apply" in sys.argv
    root = pathlib.Path.cwd()
    if "--root" in sys.argv:
        root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1])

    targets = [
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix in SUFFIXES
        and not any(part in SKIP_DIRS for part in p.parts)
    ]

    table: collections.Counter[str] = collections.Counter()
    changed: list[pathlib.Path] = []
    rejected: list[pathlib.Path] = []

    for path in targets:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            print(f"SKIP (not valid utf-8): {path}")
            continue
        fixed = repair(text)
        if fixed == text:
            continue
        if skeleton(fixed) != skeleton(text):
            rejected.append(path)
            continue
        changed.append(path)
        for a, b in zip(text, fixed):
            if a != b:
                table[b] += 1

    print(f"files needing repair: {len(changed)}")
    print(f"files rejected (ASCII skeleton changed): {len(rejected)}")
    for path in rejected:
        print(f"  REJECTED {path}")
    if table:
        print("characters restored:")
        for ch, count in table.most_common(20):
            print(f"  U+{ord(ch):04X}  x{count}")

    if not apply:
        print("\n(dry run; pass --apply to write)")
        return 0

    for path in changed:
        text = path.read_bytes().decode("utf-8")
        path.write_text(repair(text), encoding="utf-8", newline="")
    print(f"\nrepaired {len(changed)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
