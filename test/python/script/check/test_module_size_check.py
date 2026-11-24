"""Tests for ``script/check/module_size_check.py`` — the module-size gate.

The gate exists because the package layout hid module growth: a package can be
"a directory package" and still hold a 457-code-line module. It counts code
lines per file (non-blank, non-`#`; docstrings count) against the AGENTS.md
300-line limit, and exits 1 listing every offender.

Coverage target: full branch coverage of ``code_lines``, ``oversized``,
``_display`` and the CLI entry point. ``code_lines`` / ``oversized`` are called
with ``tmp_path`` files directly; ``main`` reads ``sys.argv[1:]``.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "module_size_check.py"


class _ModuleView:
    """Attribute access over runpy globals for concise test calls."""

    def __init__(self, namespace: dict):
        self._ns = namespace

    def __getattr__(self, name: str):
        try:
            return self._ns[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


mod = _ModuleView(runpy.run_path(str(SCRIPT)))


def _run(argv: list[str], monkeypatch) -> int:
    monkeypatch.setattr(sys, "argv", ["module_size_check.py", *argv])
    return mod.main()


def test_code_lines_counts_docstrings_and_skips_blank_and_comment(tmp_path):
    source = tmp_path / "sample.py"
    source.write_text(
        '"""Module docstring.\n\nsecond line"""\n\n# a comment\nvalue = 1\n\n'
    )

    # docstring: 2 non-blank lines; code: 1; the blank docstring line, the
    # comment and the surrounding blanks do not count.
    assert mod.code_lines(source) == 3


def test_the_limit_is_300_and_does_not_move():
    assert mod.LIMIT == 300


def test_a_module_at_the_limit_passes_and_one_over_fails(tmp_path, monkeypatch, capsys):
    at_limit = tmp_path / "at_limit.py"
    at_limit.write_text("x = 1\n" * 300)
    over = tmp_path / "over.py"
    over.write_text("x = 1\n" * 301)

    monkeypatch.setattr(sys, "argv", ["module_size_check.py", str(at_limit)])
    assert mod.main() == 0

    monkeypatch.setattr(sys, "argv", ["module_size_check.py", str(over)])
    assert mod.main() == 1
    out = capsys.readouterr().out
    assert "over.py" in out
    assert "301 code lines" in out


def test_oversized_lists_only_the_files_over_the_limit(tmp_path):
    at_limit = tmp_path / "at_limit.py"
    at_limit.write_text("x = 1\n" * 300)
    over = tmp_path / "over.py"
    over.write_text("x = 1\n" * 301)

    assert mod.oversized([at_limit, over]) == [(over, 301)]


def test_every_control_module_is_under_the_limit(monkeypatch, capsys):
    """Repo-wide teeth: the gate fails on the real tree while any module is over."""
    monkeypatch.setattr(sys, "argv", ["module_size_check.py"])

    assert mod.main() == 0, capsys.readouterr().out
