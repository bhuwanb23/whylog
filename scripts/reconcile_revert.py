#!/usr/bin/env python3
"""
Reconcile a reverted tree with the verified fixes.

WHY THIS EXISTS
---------------
The tree is rewritten periodically from a stale snapshot, and each rewrite
deletes the fixes that were verified in earlier phases. A plain restore does
not work, because the newer work was BUILT ON the reverted tree: restoring the
old snapshot wholesale throws the new work away, and keeping the reverted tree
throws the fixes away.

HOW THE TWO ARE SEPARATED
-------------------------
A revert is detectable by BLOB IDENTITY. A reverted file's content is
byte-identical to the content it had at some earlier commit, so that earlier
commit is the merge base for that file:

    base   = the content the revert restored   (an earlier commit's blob)
    ours   = the content with the fix          (the verified snapshot)
    theirs = the content as it is now          (the reverted snapshot)

Where the fix and the newer work touch different lines, a three-way merge
keeps both. Where they overlap, the merge reports a conflict and the file is
left for a human.

Usage:
    python scripts/reconcile_revert.py --good <ref> [--theirs <ref>] [--dry-run]
"""

from __future__ import annotations

import argparse
import collections
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORK = ROOT / ".reconcile"
SUFFIXES = {".ts", ".tsx", ".py", ".mjs", ".cjs", ".js", ".json", ".md", ".css", ".yml", ".yaml"}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True
    ).stdout


def blob_of(ref: str, path: str) -> str | None:
    out = git("rev-parse", "--verify", "-q", f"{ref}:{path}").strip()
    return out or None


def show(ref: str, path: str) -> bytes:
    return subprocess.run(
        ["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True
    ).stdout


def commits_touching(path: str) -> list[str]:
    return git("log", "--format=%H", "--all", "--", path).split()


def tracked_files(ref: str) -> list[str]:
    return [
        p
        for p in git("ls-tree", "-r", "--name-only", ref).split()
        if pathlib.PurePosixPath(p).suffix in SUFFIXES
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--good", required=True, help="the verified snapshot to restore")
    parser.add_argument("--theirs", default="HEAD", help="the tree as it is now")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    good, theirs = args.good, args.theirs

    WORK.mkdir(parents=True, exist_ok=True)
    base_file = WORK / "base"
    ours_file = WORK / "ours"
    theirs_file = WORK / "theirs"

    merged = 0
    unchanged = 0
    conflicts: list[str] = []
    no_base: list[str] = []

    for path in tracked_files(theirs):
        ours_blob = blob_of(good, path)
        theirs_blob = blob_of(theirs, path)
        if theirs_blob is None:
            continue
        if ours_blob == theirs_blob:
            unchanged += 1
            continue
        if ours_blob is None:
            # New in the newer tree: keep it.
            continue

        # The merge base is the most recent commit that already carried the
        # content the revert restored.
        base_commit = None
        for commit in commits_touching(path):
            if blob_of(commit, path) == theirs_blob:
                base_commit = commit
                break

        if base_commit is None:
            # The content was never committed: the revert reconstructed it. There
            # is no common ancestor to merge against, so ours wins outright and
            # the file is reported for review.
            no_base.append(path)
            base_file.write_bytes(show(good, path))
        else:
            base_file.write_bytes(show(base_commit, path))

        ours_file.write_bytes(show(good, path))
        theirs_file.write_bytes(show(theirs, path))

        result = subprocess.run(
            ["git", "merge-file", "-p", "--diff3", str(ours_file), str(base_file), str(theirs_file)],
            cwd=ROOT,
            capture_output=True,
        )
        if result.returncode > 1:
            conflicts.append(path)
            continue
        if result.returncode == 1:
            conflicts.append(path)
        if not args.dry_run:
            (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
            (ROOT / path).write_bytes(result.stdout)
        merged += 1

    print(f"good={good}  theirs={theirs}")
    print(f"  files reconciled : {merged}")
    print(f"  already identical: {unchanged}")
    print(f"  conflicts        : {len(conflicts)}")
    print(f"  no merge base    : {len(no_base)}")
    for path in conflicts:
        print(f"    CONFLICT {path}")
    for path in no_base:
        print(f"    NO-BASE   {path}")
    if args.dry_run:
        print("\n(dry run; nothing written)")
    return 1 if conflicts else 0


if __name__ == "__main__":
    raise SystemExit(main())
