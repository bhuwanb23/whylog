"""Report (and optionally repair) the CP437 mojibake in the source tree.

The corruption: a UTF-8 file was written through a CP437 (DOS OEM) console
decode. Each UTF-8 byte became one CP437 character. The inverse is: take the
CP437 bytes back and decode them as UTF-8.

The report lists every distinct (mojibake, repaired) pair so the repair can be
reviewed before it is applied, and so a legitimate non-ASCII sequence that
merely looks like mojibake can be spotted.
"""

from __future__ import annotations

import collections
import pathlib
import sys

ROOT = pathlib.Path(sys.argv[sys.argv.index("--root") + 1]) if "--root" in sys.argv else pathlib.Path.cwd()


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
                # A valid prefix, then something that cannot continue it. The
                # prefix is UTF-8; if it decodes on its own, emit it as UTF-8,
                # otherwise it was never a UTF-8 sequence and the bytes go back
                # to the characters they came from.
                prefix = bytes(buf[: err.start])
                try:
                    out.append(prefix.decode("utf-8"))
                except UnicodeDecodeError:
                    out.append(prefix.decode("cp437", errors="replace"))
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


def main() -> int:
    apply = "--apply" in sys.argv
    targets: list[pathlib.Path] = []
    for pattern in ("src/**/*", "tests/**/*", "scripts/**/*", "notes/**/*"):
        targets.extend(ROOT.glob(pattern))
    targets = [
        p
        for p in targets
        if p.is_file() and p.suffix in {".ts", ".tsx", ".py", ".mjs", ".md", ".json"}
    ]

    table: collections.Counter[tuple[str, str]] = collections.Counter()
    changed: list[pathlib.Path] = []

    for path in targets:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            print(f"SKIP (not valid utf-8): {path.relative_to(ROOT)}")
            continue
        fixed = repair(text)
        if fixed == text:
            continue
        changed.append(path)
        for a, b in zip(text, fixed):
            if a != b:
                table[(a, b)] += 1

    print(f"files needing repair: {len(changed)}")
    print("distinct character repairs (mojibake -> correct):")
    for (bad, good), count in table.most_common(40):
        print(f"  U+{ord(bad):04X} -> U+{ord(good):04X}   x{count}")

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
