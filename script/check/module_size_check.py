#!/usr/bin/env python3
"""Gate: every control module stays at or under the 300-code-line threshold.

Every module under `foliplus/control` is capped at 300 code lines. The package
structure alone used to hide the same growth
inside one module: `LayerControl/_fill_author.py` reached 457 code lines and
`LayerControl/control.py` 345 while a listing still showed a tidy package. This
gate counts code lines per FILE instead, so "the package exists" can never
stand in for "the file is navigable".

code lines = non-blank lines that do not start with `#`. Docstrings count
because they are prose a reader navigates.

Usage (called by pre-commit with the changed files, or directly):
    python script/check/module_size_check.py [FILE ...]

With no FILE arguments every module under `foliplus/` is checked; with FILE
arguments only those files are checked (pre-commit passes the changed paths).
Exit 1 lists every offender with its count.
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = _REPO_ROOT / "foliplus"

# The documented threshold. It does not move to fit the code.
LIMIT = 300


def code_lines(path: Path) -> int:
    """Count the file's code lines: non-blank, not a `#` comment.

    Docstring lines count as code: they are the prose a reader navigates, and
    the documented criterion counts them. A `#` comment is navigation aid, not
    logic, so it does not count.
    """
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        count += 1
    return count


def oversized(paths: list[Path]) -> list[tuple[Path, int]]:
    """The files over LIMIT, with their counts, in path order."""
    return [(path, count) for path in paths if (count := code_lines(path)) > LIMIT]


def _display(path: Path) -> Path:
    """The path as repo-relative when it lives in the repo, else as given."""
    try:
        return path.resolve().relative_to(_REPO_ROOT)
    except ValueError:
        return path


def main() -> int:
    """Check the requested modules (or every package module) and report."""
    args = sys.argv[1:]
    paths = (
        [Path(arg) for arg in args]
        if args
        else sorted(PACKAGE_ROOT.rglob("*.py"))
    )
    bad = oversized(paths)
    for path, count in bad:
        print(f"{_display(path)}: {count} code lines (limit {LIMIT}); split the module")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
