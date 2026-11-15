"""Tests for ``script/check/bare_reload.py`` — bare ``.reload()`` gate.

The gate scans ``test/python/**/*.py`` and forbids two forms:

1. A bare ``.reload()`` with no arguments (any receiver, not just ``page``).
2. An alias assignment ``x = ... .reload`` (the method bound to a variable).

Both are fragile: a bare ``.reload()`` uses Playwright's default
``wait_until="load"``, which under CI or full-suite contention can be
delayed past the 45 s navigation timeout and flake. The initial navigation
(``make_browser_page``) already uses ``wait_until="domcontentloaded"``;
a reload must match it.

The script is loaded via ``runpy`` (mirroring ``test_dead_barrel_export.py``)
so ``main()`` and the CLI path are genuinely executed. Coverage is driven
by ``main()`` over temporary trees plus direct calls to the scan helpers.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "bare_reload.py"

_mod = runpy.run_path(str(SCRIPT))


def _make(tmp_path: Path, rel: str, content: str = "") -> Path:
    f = tmp_path / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    return f


def _run_main(tmp_path: Path, monkeypatch) -> int:
    """Run ``main()`` with ``TEST_PY`` pointed at a temporary tree."""
    monkeypatch.setitem(_mod["main"].__globals__, "TEST_PY", tmp_path)
    monkeypatch.setattr(sys, "argv", ["bare_reload.py"])
    return _mod["main"]()


class TestScanHelpers:
    def test_bare_reload_any_receiver(self):
        """A bare ``.reload()`` is caught on any receiver, not just ``page``."""
        src = "obj.reload()\npage.reload()\n"
        assert _mod["_find_bare_reloads"](src) == [1, 2]

    def test_reload_with_wait_until_not_flagged(self):
        """A reload with an explicit ``wait_until`` is not a violation."""
        src = 'page.reload(wait_until="domcontentloaded")\n'
        assert _mod["_find_bare_reloads"](src) == []

    def test_reload_alias_detected(self):
        """``x = ... .reload`` (method bound to a variable) is a violation."""
        src = "r = page.reload\n"
        assert _mod["_find_reload_aliases"](src) == [1]

    def test_reload_alias_not_on_comparison(self):
        """``==`` and ``!=`` comparisons must not be flagged as aliases."""
        src = "if a == obj.reload: pass\nif b != obj.reload: pass\n"
        assert _mod["_find_reload_aliases"](src) == []

    def test_strip_removes_comment_and_string_reloads(self):
        """A reload inside a comment or string must not count."""
        src = '# obj.reload()\n"""\nobj.reload()\n"""\nobj.reload()\n'
        assert _mod["_find_bare_reloads"](src) == [5]

    def test_strip_preserves_line_structure_across_strings(self):
        """Stripping a multi-line string must not collapse line numbers."""
        src = 'x = "a\nobj.reload()\nb"\nobj.reload()\n'
        assert _mod["_find_bare_reloads"](src) == [4]

    def test_strip_preserves_line_numbers_across_comment(self):
        """A comment must not shift the reported line of a following reload."""
        src = "# first comment\n# second\nobj.reload()\n"
        assert _mod["_find_bare_reloads"](src) == [3]


def test_block_comment_ignored():
    """A reload inside a /* */ block comment must not count."""
    src = "x = 1  # a\n/*\nobj.reload()\n*/\nobj.reload()\n"
    assert _mod["_find_bare_reloads"](src) == [5]


def test_single_quote_string_with_newline_and_escape():
    """A single-quoted string spanning newlines with an escape is handled."""
    src = "s = 'a\\nobj.reload()\nb'\nobj.reload()\n"
    assert _mod["_find_bare_reloads"](src) == [3]


class TestMain:
    def test_main_returns_zero_on_clean_tree(self, tmp_path, monkeypatch):
        """``main()`` returns 0 when no file has a bare reload or alias."""
        _make(
            tmp_path,
            "test/python/control/MeasureControl/test_mode.py",
            'page.reload(wait_until="domcontentloaded")\n',
        )
        assert _run_main(tmp_path, monkeypatch) == 0

    def test_main_reports_bare_reload_line(self, tmp_path, monkeypatch, capsys):
        """``main()`` returns 1 and reports file:line for a bare reload."""
        _make(
            tmp_path,
            "test/python/control/MeasureControl/test_mode.py",
            "page.reload()\n",
        )
        assert _run_main(tmp_path, monkeypatch) == 1
        err = capsys.readouterr().err
        assert "test_mode.py:1" in err
        assert "bare .reload()" in err

    def test_main_reports_alias(self, tmp_path, monkeypatch, capsys):
        """``main()`` returns 1 and reports an alias assignment."""
        _make(
            tmp_path,
            "test/python/control/HeatmapControl/test_persist.py",
            "r = page.reload\n",
        )
        assert _run_main(tmp_path, monkeypatch) == 1
        err = capsys.readouterr().err
        assert "test_persist.py:1" in err
        assert "alias" in err


    def test_main_reports_outside_repo_path(self, tmp_path, monkeypatch, capsys):
        """A path outside REPO_ROOT is reported raw (contract must not crash)."""
        _make(tmp_path, "test/python/control/MeasureControl/test_mode.py",
              "page.reload()\n")
        monkeypatch.setitem(_mod["main"].__globals__, "TEST_PY", tmp_path)
        monkeypatch.setitem(_mod["main"].__globals__, "REPO_ROOT",
                            tmp_path.parent / "elsewhere")
        monkeypatch.setattr(sys, "argv", ["bare_reload.py"])
        assert _mod["main"]() == 1
        err = capsys.readouterr().err
        assert str(tmp_path / "test/python/control/MeasureControl/test_mode.py") in err
        assert "bare .reload()" in err

    def test_main_skips_missing_dir(self, tmp_path, monkeypatch, capsys):
        """``main()`` returns 0 when the scan directory does not exist."""
        missing = tmp_path / "does-not-exist"
        monkeypatch.setitem(_mod["main"].__globals__, "TEST_PY", missing)
        monkeypatch.setattr(sys, "argv", ["bare_reload.py"])
        assert _mod["main"]() == 0
        assert "not found" in capsys.readouterr().err


class TestRepoInvariant:
    def test_no_bare_reload_in_repo(self):
        """The real repository must be clean (no bare reload / alias)."""
        assert _mod["main"]() == 0
