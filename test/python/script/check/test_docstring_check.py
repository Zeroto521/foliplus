"""Tests for ``script/check/docstring_check.py`` — control docstring reST gate.

The docs were silently dropping Notes-section grid tables when a single
misaligned row made docutils report ``ERROR/3 Malformed table``; RTD drops
the table without surfacing the error. This gate parses each shipped
control class docstring with docutils and fails on any ERROR/3, so the
markup regression cannot land silently.

The guard asserts no real ERROR/3 (``Malformed table``, ``Title underline too
short``). ``Unexpected section title`` is excluded: a standalone docutils parse
reports it for every control docstring's section heading (Sphinx renders those
fine), and its severity is docutils-version-dependent (SEVERE/4 in 0.21, ERROR/3
in 0.22+), so it must not gate the build.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "docstring_check.py"

_spec = importlib.util.spec_from_file_location("docstring_check", SCRIPT)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)  # type: ignore[union-attr]

pytest.importorskip("docutils")


_CLEAN_TABLE = """\
Summary line.

+-------+--------+
| Key   | Value  |
+=======+========+
| fill  | red    |
| label | layer  |
+-------+--------+
"""
_MALFORMED_TABLE = """\
Summary line.

+-------+--------+
| Key   | Value  |
+=======+========+
| fill  | red    |
| label | layer |
+-------+--------+
"""


class TestExtractClassDocstring:
    def test_extracts_class_docstring(self):
        source = 'class Foo:\n    """Doc body."""\n'
        assert mod.extract_class_docstring(source, "Foo") == "Doc body."

    def test_absent_docstring_returns_empty(self):
        assert mod.extract_class_docstring("class Foo:\n    pass\n", "Foo") == ""

    def test_wrong_class_returns_empty(self):
        source = 'class Foo:\n    """Doc body."""\n'
        assert mod.extract_class_docstring(source, "Bar") == ""


class TestFindErrors:
    def test_clean_table_has_no_error(self):
        assert mod.find_errors(mod._docutils_messages(_CLEAN_TABLE)) == []

    def test_malformed_table_is_error(self):
        errors = mod.find_errors(mod._docutils_messages(_MALFORMED_TABLE))
        assert any("Malformed table" in msg for _level, msg in errors)

    def test_sphinx_role_does_not_error(self):
        # :class:`X` must not surface as an Unknown-role ERROR/3.
        messages = mod._docutils_messages("Uses :class:`Foo` and :meth:`Bar.baz`.\n")
        assert not any("Unknown interpreted text role" in msg for _l, msg in messages)

    def test_unexpected_section_title_artifact_is_excluded(self):
        # The standalone-parse "Unexpected section title" artifact is version-
        # dependent (SEVERE/4 in docutils 0.21, ERROR/3 in 0.22+) and fires for
        # every control docstring's section heading, so it must never gate.
        artifact = [(3, "<string>:27: (ERROR/3) Unexpected section title.")]
        assert mod.find_errors(artifact) == []
        # A real error is still caught alongside the artifact.
        mixed = artifact + [(3, "<string>:30: (ERROR/3) Malformed table.")]
        errors = mod.find_errors(mixed)
        assert any("Malformed table" in msg for _l, msg in errors)
        assert not any("Unexpected section title" in msg for _l, msg in errors)


class TestGuard:
    def test_all_control_docstrings_are_clean(self):
        """Every shipped control docstring must parse with no ERROR/3."""
        results = mod.scan_control_docstrings(REPO_ROOT)
        assert set(results) == set(mod.CONTROL_CLASSES)
        for name, messages in results.items():
            errors = mod.find_errors(messages)
            assert not errors, f"{name} has ERROR/3: {errors}"

    def test_main_returns_zero_when_clean(self):
        """The CLI gate exits 0 on the shipped, clean docstrings."""
        assert mod.main() == 0
