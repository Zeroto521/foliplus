#!/usr/bin/env python3
"""Detect UTF-8 replacement characters (U+FFFD) in staged files.

U+FFFD (bytes EF BF BD) appears when multi-byte UTF-8 characters
(`→`, `—`, `↔`, Chinese characters, etc.) are corrupted by a
non-UTF-8 encoding round-trip (e.g. PowerShell default CP936 redirect,
editor saved with wrong encoding).

This hook checks every staged text file and fails with file:line
locations if any FFFD is found. FFFD cannot be auto-fixed — the
original character must be restored from the source.

Usage (called by pre-commit, filenames as arguments):
    python script/mojibake_check.py file1 file2 ...
"""

import sys

FFFD = b"\xef\xbf\xbd"


def main() -> int:
    if len(sys.argv) < 2:
        return 0

    failures = 0

    for filepath in sys.argv[1:]:
        try:
            with open(filepath, "rb") as f:
                content = f.read()
        except OSError:
            continue

        lines = content.split(b"\n")
        for lineno, line in enumerate(lines, 1):
            if FFFD in line:
                decoded = line.decode("utf-8", errors="replace")
                print(f"{filepath}:{lineno}: {decoded.rstrip()}")
                failures += 1

    if failures:
        print(
            f"\n{failures} file(s) contain U+FFFD replacement characters.\n"
            "The original characters were corrupted by a non-UTF-8 encoding\n"
            "round-trip. Restore them from the source and save as UTF-8\n"
            "(no BOM). See: https://en.wikipedia.org/wiki/Replacement_character",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
