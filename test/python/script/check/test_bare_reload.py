"""Tests for ``script/check/bare_reload.py`` — bare ``.reload()`` gate.

The gate scans ``test/python/**/*.py`` and forbids two forms:

1. A bare ``.reload()`` with no arguments (any receiver, not just ``page``).
2. An alias assignment ``x = ... .reload`` (the method bound to a variable).

Both are fragile: a bare ``.reload()`` uses Playwright's default
``wait_until="load"``, which under CI or full-suite contention can be
delayed past the 45 s navigation timeout and flake. The initial navigation
(``make_browser_page``) already uses ``wait_until="domcontentloaded"``;
a reload must match it.

Coverage target: the strip helper's comment/string handling, the two form
detectors (including that a ``wait_until`` reload is NOT flagged), line-number
preservation across comments and strings, and the CLI entry point.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "bare_reload.py"

_spec = importlib.util.spec_from_file_location("bare_reload", SCRIPT)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)  # type: ignore[union-attr]


def test_no_bare_reload_in_repo():
    """No browser test file may contain a bare ``.reload()`` or reload alias."""
    assert mod.main() == 0


def test_bare_reload_detected_any_receiver():
    """A bare ``.reload()`` is caught on any receiver, not just ``page``."""
    src = "obj.reload()\npage.reload()\n"
    assert mod._find_bare_reloads(src) == [1, 2]


def test_reload_with_wait_until_not_flagged():
    """A reload with an explicit ``wait_until`` is not a violation."""
    src = 'page.reload(wait_until="domcontentloaded")\n'
    assert mod._find_bare_reloads(src) == []


def test_reload_alias_detected():
    """``x = ... .reload`` (method bound to a variable) is a violation."""
    src = "r = page.reload\n"
    assert mod._find_reload_aliases(src) == [1]


def test_reload_alias_not_on_comparison():
    """``==`` and ``!=`` comparisons must not be flagged as aliases."""
    src = "if a == obj.reload: pass\nif b != obj.reload: pass\n"
    assert mod._find_reload_aliases(src) == []


def test_strip_removes_comment_and_string_reloads():
    """A reload inside a comment or string must not count."""
    src = (
        "# obj.reload()\n"
        '"""\n'
        "obj.reload()\n"
        '"""\n'
        "obj.reload()\n"
    )
    assert mod._find_bare_reloads(src) == [5]


def test_strip_preserves_line_structure_across_strings():
    """Stripping a multi-line string must not collapse line numbers."""
    src = (
        'x = "a\n'
        "obj.reload()\n"
        'b"\n'
        "obj.reload()\n"
    )
    assert mod._find_bare_reloads(src) == [4]


def test_strip_preserves_line_numbers_across_comment():
    """A comment must not shift the reported line of a following reload."""
    src = "# first comment\n# second\nobj.reload()\n"
    assert mod._find_bare_reloads(src) == [3]


def test_main_returns_zero_when_clean(monkeypatch, capsys):
    """``main()`` returns 0 and prints nothing when there is no violation."""
    monkeypatch.setattr(mod, "TEST_PY", HERE / "nonexistent")
    assert mod.main() == 0
    captured = capsys.readouterr()
    assert captured.out == ""
