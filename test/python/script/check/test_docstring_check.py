"""Tests for ``script/check/docstring_check.py`` -- control docstring reST gate.

The docs were silently dropping Notes-section grid tables when a single
misaligned row made docutils report ``ERROR/3 Malformed table``; RTD drops
the table without surfacing the error. This gate parses each selected
control class docstring with docutils and fails on any real ERROR/3, so the
markup regression cannot land silently.

The gate asserts no real ERROR/3 (``Malformed table``, ``Title underline too
short``). ``Unexpected section title`` is excluded: a standalone docutils
parse reports it for every control docstring's section heading (Sphinx renders
those fine), and its severity is docutils-version-dependent (SEVERE/4 in 0.21,
ERROR/3 in 0.22+), so it must not gate the build.
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


class TestControlsToCheck:
    def test_no_files_returns_all(self):
        controls = mod._controls_to_check(None)
        assert set(controls) == set(mod.CONTROL_CLASSES)

    def test_empty_files_returns_all(self):
        assert set(mod._controls_to_check([])) == set(mod.CONTROL_CLASSES)

    @pytest.mark.parametrize(
        "path",
        [
            "foliplus/control/LayerControl/control.py",  # POSIX forward slash
            "foliplus\\control\\LayerControl\\control.py",  # Windows backslash
        ],
    )
    def test_matches_control_path_across_styles(self, path):
        """A control source must match whether pre-commit passes / or \\ (host-dependent)."""
        assert set(mod._controls_to_check([Path(path)])) == {"LayerControl"}

    def test_non_control_file_returns_empty(self):
        # A declaration module is not a control source -> no control class matches.
        assert mod._controls_to_check([Path("foliplus/_declaration.py")]) == {}
        # A control-package __init__ re-exports the class but is not its source file.
        assert (
            mod._controls_to_check([Path("foliplus/control/LayerControl/__init__.py")])
            == {}
        )


class TestFindErrors:
    def test_clean_table_has_no_error(self):
        assert mod.find_errors(mod._docutils_messages(_CLEAN_TABLE)) == []

    def test_malformed_table_is_error_with_line(self):
        errors = mod.find_errors(mod._docutils_messages(_MALFORMED_TABLE))
        assert any("Malformed table" in msg for _l, _line, msg in errors)
        assert any(line > 0 for _l, line, _msg in errors)

    def test_sphinx_role_does_not_error(self):
        # :class:`X` must not surface as an Unknown-role ERROR/3.
        messages = mod._docutils_messages("Uses :class:`Foo` and :meth:`Bar.baz`.\n")
        assert not any(
            "Unknown interpreted text role" in msg for _l, _line, msg in messages
        )

    def test_role_registration_exception_is_swallowed(self, monkeypatch):
        # The role registration is defensive: a register failure must not crash
        # the gate (roles are re-registered across repeated calls).
        import docutils.parsers.rst.roles as roles_mod

        def boom(*args, **kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr(roles_mod, "register_canonical_role", boom)
        mod._register_sphinx_roles()  # must not raise

    def test_artifact_is_excluded(self):
        artifact = [(3, 27, "Unexpected section title.")]
        assert mod.find_errors(artifact) == []

    def test_artifact_and_real_error(self):
        mixed = [(3, 27, "Unexpected section title."), (3, 30, "Malformed table.")]
        errors = mod.find_errors(mixed)
        assert any("Malformed table" in msg for _l, _line, msg in errors)
        assert not any("Unexpected section title" in msg for _l, _line, msg in errors)

    def test_non_error_level_excluded(self):
        assert mod.find_errors([(4, 3, "Unexpected section title.")]) == []

    def test_message_prefix_stripped(self):
        # docutils prefixes "<string>:N: "; the gate strips it so the line is
        # reported separately and the message text stays clean.
        errors = mod.find_errors(mod._docutils_messages(_MALFORMED_TABLE))
        assert all("<string>" not in msg for _l, _line, msg in errors)


class TestScan:
    def test_all_control_docstrings_are_clean(self):
        """Every shipped control docstring must parse with no ERROR/3."""
        results = mod.scan_control_docstrings(REPO_ROOT)
        assert set(results) == set(mod.CONTROL_CLASSES)
        for name, messages in results.items():
            assert not mod.find_errors(messages), f"{name} has ERROR/3"

    def test_layercontrol_has_expected_tables(self):
        """LayerControl's docstring has 7 grid tables and 0 non-artifact ERROR/3.

        #869 (merged into main) restored the two Notes-section tables that the
        docs were silently dropping; this pins that state. A regression that
        drops a table again surfaces as a table-count mismatch or an ERROR/3.
        A later docs change added the fill-resolution table that follows the
        fill declaration keys.
        """
        source = (
            REPO_ROOT / "foliplus" / "control" / "LayerControl" / "control.py"
        ).read_text(encoding="utf-8")
        docstring = mod.extract_class_docstring(source, "LayerControl")
        from docutils.core import publish_doctree

        tree = publish_doctree(docstring)
        table_count = sum(1 for n in tree.findall() if n.tagname == "table")
        assert table_count == 7, f"expected 7 tables, got {table_count}"
        assert mod.find_errors(mod._docutils_messages(docstring)) == []

    def test_restricts_to_only_files(self):
        results = mod.scan_control_docstrings(
            REPO_ROOT, [Path("foliplus/control/LayerControl/control.py")]
        )
        assert set(results) == {"LayerControl"}

    def test_missing_source_reports_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            mod, "CONTROL_CLASSES", {"Ghost": "foliplus/control/Ghost.py"}
        )
        results = mod.scan_control_docstrings(tmp_path)
        errors = mod.find_errors(results["Ghost"])
        assert any("source file not found" in msg for _l, _line, msg in errors)


class TestFindTableBorderIssues:
    """P2-a: a table header separator that mixes ``=`` and ``-`` border chars.

    docutils silently accepts it (no ERROR/3), so the docutils parse alone cannot
    catch it; ``find_table_border_issues`` scans the separator rows structurally.
    """

    def test_clean_grid_table_has_no_issue(self):
        assert mod.find_table_border_issues(_CLEAN_TABLE) == []

    def test_mixed_grid_header_separator_is_flagged(self):
        doc = "Summary.\n\n+===+---+\n| A | B |\n+---+---+\n"
        issues = mod.find_table_border_issues(doc)
        assert any("mixes border chars" in desc for _line, desc in issues)

    def test_mixed_simple_header_separator_is_flagged(self):
        doc = "Summary.\n\n=== ---\nA    B\n--- ---\n"
        issues = mod.find_table_border_issues(doc)
        assert any("mixes border chars" in desc for _line, desc in issues)

    def test_valid_simple_table_has_no_issue(self):
        doc = "Summary.\n\n=== ===\nA    B\n--- ---\n"
        assert mod.find_table_border_issues(doc) == []

    def test_section_underline_is_not_a_separator(self):
        # A single '=' or '-' run under a title is a section underline, not a
        # table separator, so it is never a border-consistency failure.
        assert mod.find_table_border_issues("Title\n=====\n") == []
        assert mod.find_table_border_issues("Title\n-----\n") == []

    def test_literal_block_and_doctest_lines_are_skipped(self):
        # A '::' literal block or a '>>>' doctest may legally show a +---+---+
        # line; neither is a table in the rendered docstring, so it must not be
        # reported as a mixed-border table.
        doc = "Summary.\n\n::\n\n    +===+---+\n\n>>> foo\n+===+---+\n"
        assert mod.find_table_border_issues(doc) == []

    def test_scan_reports_only_offending_controls(self, tmp_path, monkeypatch):
        monkeypatch.setattr(mod, "CONTROL_CLASSES", {"Bad": "foliplus/control/Bad.py"})
        (tmp_path / "foliplus" / "control").mkdir(parents=True)
        (tmp_path / "foliplus" / "control" / "Bad.py").write_text(
            'class Bad:\n    """S.\n\n    +===+---+\n    | A | B |\n    +---+---+\n    """\n',
            encoding="utf-8",
        )
        results = mod.scan_table_border_issues(tmp_path)
        assert "Bad" in results and results["Bad"]


class TestControlClassesComplete:
    def test_control_classes_cover_every_shipped_control(self):
        """A newly added control source must be registered in CONTROL_CLASSES.

        A control grows into a directory package once it passes ~300 lines
        (``foliplus/control/<Name>/`` with ``__init__.py`` + ``control.py``), and a new
        small control lands as ``foliplus/control/<Name>.py``. The gate would silently skip
        any of these if CONTROL_CLASSES were not kept in sync, so this pins the
        actual shipped set to the registered set.
        """
        control_dir = REPO_ROOT / "foliplus" / "control"
        actual = {"foliplus/BaseControl.py"}
        for py in sorted(control_dir.glob("*.py")):
            if py.name != "__init__.py":
                actual.add(f"foliplus/control/{py.name}")
        for pkg in sorted(control_dir.iterdir()):
            if pkg.is_dir() and (pkg / "control.py").exists():
                actual.add(f"foliplus/control/{pkg.name}/control.py")
        assert actual == set(mod.CONTROL_CLASSES.values())


class TestMain:
    def test_clean_returns_zero(self):
        assert mod.main([]) == 0

    def test_file_arg_filters(self, capsys):
        assert mod.main(["foliplus/control/LayerControl/control.py"]) == 0
        assert "1 control docstrings clean" in capsys.readouterr().out

    def test_non_control_file_noop(self, capsys):
        assert mod.main(["foliplus/control/__init__.py"]) == 0
        assert "no control files to check" in capsys.readouterr().out

    def test_failure_returns_one(self, monkeypatch, capsys):
        monkeypatch.setattr(
            mod,
            "scan_control_docstrings",
            lambda repo, only_files=None: {"Foo": [(3, 5, "Malformed table.")]},
        )
        assert mod.main([]) == 1
        out = capsys.readouterr().out
        assert "Foo: docstring line 5: Malformed table." in out
