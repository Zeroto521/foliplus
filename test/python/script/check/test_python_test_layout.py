"""Tests for script/check/python_test_layout.py - the test-layout gate.

The gate exists because the control test tree grew one flat pile per control:
LayerControl/test_style.py is 3219 code lines, helpers are named like tests, and
three single-file controls have no __init__.py. It enforces the eight documented
assertions (closed first level for a grouped control, file roles, __init__.py at
every level, depth 2, single-file shape <= 800, dimension file <= 700, group
>= 3 test files, group name mirrors a production directory), and grandfathers
the current tree in an allowlist that must drain to zero.

Coverage target: every rule branch plus the allowlist filter/stale logic and the
CLI entry point. collect is driven from tmp_path trees; main reads the
module-global CONTROL_TESTS / ALLOWLIST, which the tests swap through runpy
globals so a fake tree can prove the gate turns red.
"""

from __future__ import annotations

import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
SCRIPT = REPO_ROOT / "script" / "check" / "python_test_layout.py"


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


def _write(path: Path, text: str = "x = 1\n") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _lines(count: int) -> str:
    return "x = 1\n" * count


def _control(root: Path, name: str = "Demo", *, init: bool = True) -> Path:
    control = root / name
    control.mkdir(parents=True, exist_ok=True)
    if init:
        _write(control / "__init__.py", "")
    return control


def _group(control: Path, name: str, test_count: int, *, init: bool = True) -> Path:
    group = control / name
    group.mkdir(parents=True, exist_ok=True)
    if init:
        _write(group / "__init__.py", "")
    for index in range(test_count):
        _write(group / f"test_{index}.py", "x = 1\n")
    return group


def _rules(violations: list) -> list[str]:
    return sorted(violation.rule for violation in violations)


def _patch_global(monkeypatch, name: str, value) -> None:
    """Patch main's own globals: runpy returns a copy of the namespace."""
    monkeypatch.setitem(mod.main.__globals__, name, value)


def test_code_lines_counts_docstrings_and_skips_blank_and_comment(tmp_path):
    source = tmp_path / "sample.py"
    source.write_text(
        '"""Module docstring.\n\nsecond line"""\n\n# a comment\nvalue = 1\n\n'
    )

    # docstring: 2 non-blank lines; code: 1; the blank docstring line, the
    # comment and the surrounding blanks do not count.
    assert mod.code_lines(source) == 3


def test_the_thresholds_are_the_documented_ones():
    assert mod.MAX_FILE_CODE_LINES == 700
    assert mod.SINGLE_FILE_MAX_CODE_LINES == 800
    assert mod.MAX_GROUP_DEPTH == 2


def test_is_allowed_name_accepts_the_four_roles_and_nothing_else():
    assert mod.is_allowed_name("__init__.py")
    assert mod.is_allowed_name("conftest.py")
    assert mod.is_allowed_name("helper.py")
    assert mod.is_allowed_name("helper_browser.py")
    assert mod.is_allowed_name("test_style.py")
    assert not mod.is_allowed_name("paint_parity.py")
    assert not mod.is_allowed_name("_browser_base.py")
    assert not mod.is_allowed_name("test_style.pyc")


def test_production_dirs_returns_none_for_a_control_without_a_production_tree():
    assert mod.production_dirs("NoSuchControl") is None


def test_production_dirs_lists_the_production_subdirectories_of_a_real_control():
    names = mod.production_dirs("LayerControl")
    assert names is not None
    assert {"style", "listPanel", "overlayPanel", "focus", "label"} <= names
    assert "shell" not in names


def test_control_dirs_skips_private_dot_directories_and_files(tmp_path):
    _control(tmp_path, "Demo")
    (tmp_path / "_private").mkdir()
    (tmp_path / ".hidden").mkdir()
    _write(tmp_path / "README.md", "")

    assert [path.name for path in mod.control_dirs(tmp_path)] == ["Demo"]


def test_a_clean_control_has_no_violations(tmp_path):
    control = _control(tmp_path)
    _write(control / "helper.py", "")
    _write(control / "conftest.py", "")
    _write(control / "test__demo.py", "x = 1\n")
    _group(control, "style", 3)

    assert mod.collect(tmp_path) == []


def test_pycache_and_json_fixtures_are_not_layout_debt(tmp_path):
    control = _control(tmp_path)
    _write(control / "test_demo.py", "x = 1\n")
    _write(control / "paint-dimension.baseline.json", "{}\n")
    _write(control / "__pycache__" / "test_ghost.py", "x = 1\n")

    assert mod.collect(tmp_path) == []
    assert [path.name for path in mod.test_files(control)] == ["test_demo.py"]


def test_a_python_module_outside_the_three_roles_is_flagged(tmp_path):
    control = _control(tmp_path)
    _write(control / "test_demo.py", "x = 1\n")
    stray = _write(control / "paint_parity.py", "")

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["unexpected-file"]
    assert violations[0].path == stray
    assert "paint_parity.py" in violations[0].detail


def test_a_control_directory_without_init_is_flagged(tmp_path):
    control = _control(tmp_path, init=False)
    _write(control / "test_demo.py", "x = 1\n")

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["missing-init"]
    assert violations[0].path == control / "__init__.py"
    assert "Demo" in violations[0].detail


def test_a_group_directory_without_init_is_flagged(tmp_path):
    control = _control(tmp_path)
    _write(control / "test__demo.py", "x = 1\n")
    _group(control, "style", 3, init=False)

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["missing-init"]
    assert violations[0].path == control / "style" / "__init__.py"


def test_a_group_with_fewer_than_three_tests_is_flagged(tmp_path):
    control = _control(tmp_path)
    _write(control / "test__demo.py", "x = 1\n")
    _group(control, "style", 2)

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["too-few-tests"]
    assert violations[0].path == control / "style"
    assert "2 test file(s)" in violations[0].detail


def test_a_group_with_three_tests_passes(tmp_path):
    control = _control(tmp_path)
    _write(control / "test__demo.py", "x = 1\n")
    _group(control, "style", 3)

    assert mod.collect(tmp_path) == []


def test_a_group_named_after_a_production_directory_passes(tmp_path):
    control = _control(tmp_path, "LayerControl")
    _group(control, "style", 3)

    assert mod.collect(tmp_path) == []


def test_shell_is_the_documented_group_name_exception(tmp_path):
    control = _control(tmp_path, "LayerControl")
    _group(control, "shell", 3)

    assert mod.collect(tmp_path) == []
    assert "shell" in mod.GROUP_NAME_EXCEPTIONS


def test_a_group_that_mirrors_no_production_directory_is_flagged(tmp_path):
    control = _control(tmp_path, "LayerControl")
    group = _group(control, "rendering", 3)

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["group-not-in-production"]
    assert violations[0].path == group
    assert "rendering" in violations[0].detail


def test_a_grouped_control_may_not_keep_a_plain_test_module(tmp_path):
    control = _control(tmp_path, "LayerControl")
    stray = _write(control / "test_border.py", "x = 1\n")
    _group(control, "style", 3)

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["first-level-not-mirror"]
    assert violations[0].path == stray


def test_a_group_of_a_group_is_flagged_once_and_not_recursed(tmp_path):
    control = _control(tmp_path)
    _write(control / "test__demo.py", "x = 1\n")
    style = _group(control, "style", 3)
    deep = _write(style / "nested" / "test_deep.py", "x = 1\n").parent
    _write(deep / "paint_parity.py", "")

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["too-deep"]
    assert violations[0].path == deep


def test_a_dimension_file_at_700_passes_and_701_fails(tmp_path):
    control = _control(tmp_path)
    _write(control / "test_demo.py", "x = 1\n")
    at_limit = _write(control / "test_at_limit.py", _lines(700))
    over = _write(control / "test_over.py", _lines(701))

    violations = mod.collect(tmp_path)
    assert _rules(violations) == ["file-too-large"]
    assert violations[0].path == over
    assert "701 code lines" in violations[0].detail
    assert at_limit.exists()


def test_a_single_file_control_at_800_passes_and_801_splits(tmp_path):
    _control(tmp_path)
    _write(tmp_path / "Demo" / "test_demo.py", _lines(800))

    assert mod.collect(tmp_path) == []

    _write(tmp_path / "Demo" / "test_demo.py", _lines(801))
    violations = mod.collect(tmp_path)
    # Rule 4 owns the single-file shape, so rule 5 must not double-report it.
    assert _rules(violations) == ["single-file-too-large"]
    assert "801 code lines" in violations[0].detail


def test_relative_returns_repo_paths_and_leaves_outside_paths_alone(tmp_path):
    assert mod._relative(mod._REPO_ROOT / "test" / "x.py") == "test/x.py"
    outside = mod._REPO_ROOT.parent / "foliplus-outside-x.py"
    assert mod._relative(outside) == outside.as_posix()


def test_unexempted_filters_the_violations_the_allowlist_covers(tmp_path):
    violation = mod.Violation("file-too-large", tmp_path / "a.py", "detail")
    exemption = mod.Exemption(
        "file-too-large", mod._relative(tmp_path / "a.py"), "reason", "card"
    )

    assert mod.unexempted([violation], ()) == [violation]
    assert mod.unexempted([violation], (exemption,)) == []


def test_stale_lists_exemptions_that_no_longer_match(tmp_path):
    violation = mod.Violation("file-too-large", tmp_path / "a.py", "detail")
    live = mod.Exemption(
        "file-too-large", mod._relative(tmp_path / "a.py"), "reason", "card"
    )
    dead = mod.Exemption("missing-init", "ghost/__init__.py", "reason", "card")

    assert mod.stale([violation], (live,)) == []
    assert mod.stale([violation], (live, dead)) == [dead]


def test_main_turns_red_on_a_fake_tree_with_an_unexempted_violation(
    tmp_path, monkeypatch, capsys
):
    control = _control(tmp_path)
    _write(control / "test_demo.py", "x = 1\n")
    _write(control / "paint_parity.py", "")
    _patch_global(monkeypatch, "CONTROL_TESTS", tmp_path)
    _patch_global(monkeypatch, "ALLOWLIST", ())

    assert mod.main() == 1
    out = capsys.readouterr().out
    assert "[unexpected-file]" in out
    assert "paint_parity.py" in out
    assert "1 violation(s), 0 stale exemption(s)" in out


def test_main_turns_red_on_a_stale_exemption(tmp_path, monkeypatch, capsys):
    control = _control(tmp_path)
    _write(control / "test_demo.py", "x = 1\n")
    ghost = mod.Exemption("file-too-large", "ghost.py", "reason", "card")
    _patch_global(monkeypatch, "CONTROL_TESTS", tmp_path)
    _patch_global(monkeypatch, "ALLOWLIST", (ghost,))

    assert mod.main() == 1
    out = capsys.readouterr().out
    assert "stale exemption [file-too-large]" in out
    assert "ghost.py" in out
    assert "0 violation(s), 1 stale exemption(s)" in out


def test_the_allowlist_matches_the_real_tree(capsys):
    """Teeth: every grandfathered entry must still name a live violation."""
    violations = mod.collect(mod.CONTROL_TESTS)
    assert mod.stale(violations) == [], capsys.readouterr().out


def test_the_real_tree_passes(capsys):
    """Teeth: the gate is green on the migrated tree (allowlist drains later)."""
    assert mod.main() == 0, capsys.readouterr().out
