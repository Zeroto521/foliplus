"""Guard: browser tests must never call bare ``page.reload()``.

A bare ``page.reload()`` uses Playwright's default ``wait_until="load"``, which
waits for the full load event. Under CI or full-suite contention the browser
main thread is starved and the load event can be delayed past the 45 s
navigation timeout, turning a healthy test into a flake. The initial
navigation (``make_browser_page``) and the sibling SearchControl reloads all
use ``wait_until="domcontentloaded"``; a reload must match them. The page
under test carries only inline scripts (the CDN tags are stubbed), so
``domcontentloaded`` is sufficient for the assertions that follow.

This guard scans ``test/python/**/*.py`` for the bare form and reports each
hit as ``file:line``. It is deliberately a source check, not a runtime one:
the failure mode is a 45 s navigation timeout that only shows under load, so
a runtime test would need the exact contention to reproduce it.
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
TEST_PY = REPO_ROOT / "test" / "python"

# Matches page.reload() with no arguments.
_BARE_RELOAD = re.compile(r"page\.reload\(\s*\)")


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
    """Return 1-based line numbers of bare ``page.reload()`` call sites."""
    stripped = _strip_comments_and_strings(source)
    return [
        i + 1
        for i, line in enumerate(stripped.split("\n"))
        if _BARE_RELOAD.search(line)
    ]


def test_no_bare_page_reload():
    """No browser test may call ``page.reload()`` without ``wait_until``."""
    hits: list[tuple[str, int]] = []
    for path in TEST_PY.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        for line in _find_bare_reloads(source):
            hits.append((path.relative_to(REPO_ROOT).as_posix(), line))
    assert not hits, (
        'bare page.reload() found (use wait_until="domcontentloaded"): '
        + ", ".join(f"{p}:{n}" for p, n in hits)
    )


def test_strip_removes_comment_and_string_reloads():
    """A reload inside a comment or string must not count."""
    source = (
        "# page.reload()\n"
        '"""\n'
        "page.reload()\n"
        '"""\n'
        'page.reload(wait_until="domcontentloaded")\n'
        "page.reload()\n"
    )
    assert _find_bare_reloads(source) == [6]


def test_strip_preserves_line_structure():
    """Stripping must not collapse line numbers for multi-line strings."""
    source = 'x = "a\npage.reload()\nb"\npage.reload()\n'
    assert _find_bare_reloads(source) == [4]
