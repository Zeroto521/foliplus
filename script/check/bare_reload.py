#!/usr/bin/env python3
"""Gate: browser tests must not call a bare ``.reload()``.

A bare ``page.reload()`` uses Playwright's default ``wait_until="load"``,
which waits for the full load event. Under CI or full-suite contention the
browser main thread is starved and the load event can be delayed past the 45 s
navigation timeout, turning a healthy test into a flake. The initial
navigation (``make_browser_page``) and the sibling SearchControl reloads all
use ``wait_until="domcontentloaded"``; a reload must match them. The page
under test carries only inline scripts (the CDN tags are stubbed), so
``domcontentloaded`` is sufficient for the assertions that follow.

This gate scans ``test/python/**/*.py`` and reports each violation as
``file:line``. Two forms are rejected:

1. A bare ``.reload()`` call (any receiver, not just ``page``) with no
   arguments — the receiver could be a bound alias, so the check is not
   restricted to a ``page`` variable name.
2. An alias assignment ``x = ... .reload`` (the method is bound to a
   variable and called later, bypassing form 1's literal scan).

Deliberately simple: the browser tests use a small Python subset, so a full
lexer is not needed. Dynamic indirection such as ``getattr(page,
"reload")`` is NOT detected — a documented limitation, not a supported
form.

Usage (called by pre-commit with ``pass_filenames: false``):
    python script/check/bare_reload.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
TEST_PY = REPO_ROOT / "test" / "python"

# Bare reload: `.reload()` with no arguments, any receiver.
_BARE_RELOAD = re.compile(r"\.reload\(\s*\)")
# Alias assignment: `x = ... .reload` (method bound to a variable, no call).
_RELOAD_ALIAS = re.compile(r"(?<![=<>!:])\s*=\s*[^=\n]*\.reload\b(?!\s*\()")


def _strip_comments_and_strings(source: str) -> str:
    """Remove line comments, block comments and string literals.

    Preserves the line structure (every newline is emitted) so reported line
    numbers still map to the original file. Handles single-quoted,
    double-quoted and triple-quoted strings, plus # line comments and
    /* */ block comments. Deliberately simple: the browser tests use a small
    Python subset, so a full lexer is not needed.
    """
    out: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if ch == "\n":
            out.append("\n")
            i += 1
            continue
        # Line comment: skip to end of line.
        if ch == "#":
            i += 1
            while i < n and source[i] != "\n":
                i += 1
            continue
        # Block comment: skip to closing */.
        if ch == "/" and nxt == "*":
            i += 2
            while i < n and not (
                source[i] == "*" and i + 1 < n and source[i + 1] == "/"
            ):
                if source[i] == "\n":
                    out.append("\n")
                i += 1
            if i < n:
                i += 2  # consume closing */
            continue
        # Triple-quoted string.
        if (ch == '"' or ch == "'") and nxt == ch and i + 2 < n and source[i + 2] == ch:
            quote = ch * 3
            i += 3
            while i < n and not (source.startswith(quote, i)):
                if source[i] == "\n":
                    out.append("\n")
                i += 1
            if i < n:
                i += 3
            continue
        # Single- or double-quoted string.
        if ch == '"' or ch == "'":
            quote = ch
            i += 1
            while i < n:
                if source[i] == "\\":
                    i += 2
                    continue
                if source[i] == "\n":
                    out.append("\n")
                    i += 1
                    continue
                if source[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _find_bare_reloads(source: str) -> list[int]:
    """Return 1-based line numbers of bare ``.reload()`` call sites."""
    stripped = _strip_comments_and_strings(source)
    return [
        i + 1
        for i, line in enumerate(stripped.split("\n"))
        if _BARE_RELOAD.search(line)
    ]


def _find_reload_aliases(source: str) -> list[int]:
    """Return 1-based line numbers of ``x = ... .reload`` alias assignments."""
    stripped = _strip_comments_and_strings(source)
    return [
        i + 1
        for i, line in enumerate(stripped.split("\n"))
        if _RELOAD_ALIAS.search(line)
    ]


def main() -> int:
    """Scan ``test/python/**/*.py`` and report bare reloads / aliases.

    Returns 0 when clean, 1 when at least one violation is found.
    """
    if not TEST_PY.is_dir():
        print(f"bare_reload: {TEST_PY} not found; nothing to scan", file=sys.stderr)
        return 0

    violations: list[tuple[str, str, int]] = []  # (relpath, kind, line)
    for path in sorted(TEST_PY.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        rel = path.relative_to(REPO_ROOT).as_posix()
        for line in _find_bare_reloads(source):
            violations.append((rel, "bare .reload()", line))
        for line in _find_reload_aliases(source):
            violations.append((rel, "reload alias assignment", line))

    if not violations:
        return 0

    for rel, kind, line in sorted(violations):
        print(
            f"{rel}:{line}: {kind} — pass wait_until='domcontentloaded' "
            "instead of relying on the default wait_until='load'",
            file=sys.stderr,
        )
    print(
        f"\n{len(violations)} bare reload / alias violation(s) in test/python. "
        "A reload must use wait_until='domcontentloaded' to match the "
        "initial navigation.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
