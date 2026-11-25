#!/usr/bin/env python3
"""Gate: every control's Python test directory follows the two-level layout.

The standard (AGENTS.md, "Python Tests" -> "Control test layout") is one shape
for all eight controls under test/python/control/<Name>/, enforced as eight
assertions:

0. The first level of a grouped control is closed: once a control has any group
   directory, its own directory may only hold __init__.py, helper*.py,
   conftest.py and private-module mirror tests (test__<module>.py). Everything
   else lives in a group, so a reader never has to guess whether a file belongs
   to "the control" or "a feature".
1. Python modules may only play one of four roles, at any level: __init__.py,
   helper*.py (shared fixtures; helper_browser.py for Playwright-only
   scaffolding), conftest.py (control- or group-level pytest configuration) and
   test_*.py. Non-Python files are data, not layout debt: the tracked JSON
   baseline read by the paint-parity helper is a fixture, not a module, and a
   gate that demanded it be renamed would be churn.
2. The control directory and every subdirectory carry __init__.py. That file is
   what makes dotted imports (and duplicate basenames across groups) safe under
   pytest's default prepend import mode.
3. Nesting stops at two levels: control/<Name>/<group>/test_*.py. A group of a
   group is a violation.
4. A control that is still a single test_<Name>.py may stay that way only while
   its whole suite is <= 800 code lines; past that it splits by dimension.
5. Once a control has split into dimension files, no test_*.py exceeds 700 code
   lines (the single-file shape has its own 800-line cap under rule 4). Rule 4
   owns that shape: a 750-line single test_<Name>.py passes, and an 801-line one
   reports single-file-too-large only, never a second file-too-large.
6. A subdirectory is a feature group, so it must hold at least 3 test files
   directly; fewer means the tests belong in the parent directory.
7. A group's name names a production directory: it must match a directory name
   under foliplus/js/control/<Name>/ or foliplus/control/<Name>/ (private
   packages included). A group called "rendering" or "panel" that no production
   module owns is indistinguishable from an invented bucket, so it is a
   violation. shell/ is the one exception: shell, entry and quickstart tests
   assert the control as a whole and no production subdirectory owns them. The
   rule is only judged when the production control exists (a fake tree in a
   unit test has no production counterpart).

code lines = non-blank lines that do not start with '#'; docstrings count, the
same metric script/check/module_size_check.py uses for shipped modules.

Violations are grandfathered in ALLOWLIST: every entry names the rule, the
temporary reason and the card that owns the split. The gate fails on a *new*
violation AND on a *stale* entry, so the allowlist can only drain. It is empty
now that the 2026-11 LayerControl split landed; keep it empty.

Usage (called by pre-commit, or directly from the repo root):
    python script/check/python_test_layout.py

Exit 1 lists every unexempted violation and every stale exemption.
"""

from __future__ import annotations

import fnmatch
import sys
from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
CONTROL_TESTS = _REPO_ROOT / "test" / "python" / "control"

# The documented thresholds. They do not move to fit the code.
MAX_FILE_CODE_LINES = 700
SINGLE_FILE_MAX_CODE_LINES = 800
MAX_GROUP_DEPTH = 2  # control/<Name>/ = 1, control/<Name>/<group>/ = 2


@dataclass(frozen=True)
class Violation:
    """One layout breach: the rule, the offending path and a readable detail."""

    rule: str
    path: Path
    detail: str


@dataclass(frozen=True)
class Exemption:
    """A grandfathered violation: why it is tolerated and which card removes it."""

    rule: str
    path: str  # repo-relative POSIX path
    reason: str
    card: str


# Temporary exemptions while the layout migration drains. Every entry must be
# removed by the split card it names; the gate fails on an entry that no longer
# matches a violation so this list cannot silently rot.
ALLOWLIST: tuple[Exemption, ...] = ()


def code_lines(path: Path) -> int:
    """Count the file's code lines: non-blank, not a '#' comment.

    Docstring lines count as code: they are the prose a reader navigates, and
    the documented criterion counts them.
    """
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        count += 1
    return count


# Groups whose production counterpart does not exist, with the reason.
GROUP_NAME_EXCEPTIONS: dict[str, str] = {
    "shell": "shell/entry/quickstart tests assert the control as a whole",
}

_JS_CONTROL_DIR = _REPO_ROOT / "foliplus" / "js" / "control"
_PY_CONTROL_DIR = _REPO_ROOT / "foliplus" / "control"


def is_allowed_name(name: str) -> bool:
    """Whether a Python module filename plays one of the four allowed roles."""
    return (
        name == "__init__.py"
        or name == "conftest.py"
        or fnmatch.fnmatch(name, "helper*.py")
        or fnmatch.fnmatch(name, "test_*.py")
    )


def production_dirs(control_name: str) -> set[str] | None:
    """Production directory names for one control, or None when it has none.

    The group a test lives in names the production directory whose behaviour it
    asserts. Both stacks are scanned: TypeScript components split into ui/
    subpackages and Python controls split into private packages, so a group may
    mirror either. None means the control has no production tree here (a fake
    tree in a unit test), so the mirror rule cannot be judged and is skipped
    rather than guessed.
    """
    roots = [
        base
        for base in (_JS_CONTROL_DIR / control_name, _PY_CONTROL_DIR / control_name)
        if base.is_dir()
    ]
    if not roots:
        return None
    names: set[str] = set()
    for base in roots:
        for path in base.rglob("*"):
            if path.is_dir() and "__pycache__" not in path.parts:
                names.add(path.name)
    return names


def is_mirror_test(name: str) -> bool:
    """Whether a first-level test module mirrors one private production module."""
    return name.startswith("test__") and name.endswith(".py")


def control_dirs(root: Path) -> list[Path]:
    """The per-control test directories, in path order."""
    return sorted(
        d for d in root.iterdir() if d.is_dir() and not d.name.startswith((".", "_"))
    )


def test_files(root: Path) -> list[Path]:
    """Every test_*.py under one control directory, in path order."""
    return sorted(
        path for path in root.rglob("test_*.py") if "__pycache__" not in path.parts
    )


def _children(directory: Path) -> list[Path]:
    """Visible children of a directory: skip caches and dot-files."""
    return sorted(
        child
        for child in directory.iterdir()
        if child.name != "__pycache__" and not child.name.startswith(".")
    )


def _relative(path: Path) -> str:
    """The path as repo-relative POSIX when inside the repo, else as given."""
    try:
        return path.resolve().relative_to(_REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _size_violations(control: Path) -> list[Violation]:
    """Rule 4 for the single-file shape, rule 5 once the control has split."""
    tests = test_files(control)
    if len(tests) == 1:
        total = code_lines(tests[0])
        if total > SINGLE_FILE_MAX_CODE_LINES:
            return [
                Violation(
                    "single-file-too-large",
                    tests[0],
                    f"only test file but the suite is {total} code lines "
                    f"(limit {SINGLE_FILE_MAX_CODE_LINES}); split by dimension",
                )
            ]
        return []
    violations: list[Violation] = []
    for test in tests:
        count = code_lines(test)
        if count > MAX_FILE_CODE_LINES:
            violations.append(
                Violation(
                    "file-too-large",
                    test,
                    f"{count} code lines (limit {MAX_FILE_CODE_LINES}); "
                    "split by dimension",
                )
            )
    return violations


def _scan(
    directory: Path,
    depth: int,
    violations: list[Violation],
    production: set[str] | None = None,
) -> None:
    """Check one directory's names, __init__.py, group size and recurse."""
    if not (directory / "__init__.py").is_file():
        violations.append(
            Violation(
                "missing-init",
                directory / "__init__.py",
                f"{_relative(directory)}/ has no __init__.py",
            )
        )
    if depth >= 2:
        tests = [
            child
            for child in _children(directory)
            if child.is_file() and child.name.startswith("test_")
        ]
        if len(tests) < 3:
            violations.append(
                Violation(
                    "too-few-tests",
                    directory,
                    f"group holds {len(tests)} test file(s); a feature group needs >= 3",
                )
            )
    for child in _children(directory):
        if child.is_dir():
            if depth + 1 > MAX_GROUP_DEPTH:
                violations.append(
                    Violation(
                        "too-deep",
                        child,
                        f"depth {depth + 1} exceeds the two-level layout "
                        "(control/<Name>/<group>/test_*.py)",
                    )
                )
                continue
            if depth + 1 == MAX_GROUP_DEPTH and production is not None:
                if (
                    child.name not in production
                    and child.name not in GROUP_NAME_EXCEPTIONS
                ):
                    violations.append(
                        Violation(
                            "group-not-in-production",
                            child,
                            f"group {child.name!r} mirrors no production directory "
                            f"under foliplus/js/control/ or foliplus/control/ "
                            f"(or a GROUP_NAME_EXCEPTIONS entry)",
                        )
                    )
            _scan(child, depth + 1, violations, production)
            continue
        if not child.is_file() or child.suffix != ".py":
            continue
        if not is_allowed_name(child.name):
            violations.append(
                Violation(
                    "unexpected-file",
                    child,
                    f"{child.name} is not __init__.py, helper*.py or test_*.py",
                )
            )


def _grouped(control: Path) -> bool:
    """Whether the control has at least one group directory."""
    return any(child.is_dir() for child in _children(control))


def _first_level_violations(control: Path) -> list[Violation]:
    """Rule 0: a grouped control's own directory only holds mirrors and helpers."""
    if not _grouped(control):
        return []
    violations: list[Violation] = []
    for child in _children(control):
        if not child.is_file() or child.suffix != ".py":
            continue
        if child.name.startswith("test_") and not is_mirror_test(child.name):
            violations.append(
                Violation(
                    "first-level-not-mirror",
                    child,
                    f"{child.name} sits at the first level of a grouped control; "
                    "only private-module mirrors (test__<module>.py) stay here",
                )
            )
    return violations


def collect(root: Path) -> list[Violation]:
    """Every layout violation under one control-test root, in path order."""
    violations: list[Violation] = []
    for control in control_dirs(root):
        _scan(control, 1, violations, production_dirs(control.name))
        violations.extend(_first_level_violations(control))
        violations.extend(_size_violations(control))
    return sorted(violations, key=lambda v: (_relative(v.path), v.rule))


def _key(rule: str, path: str) -> tuple[str, str]:
    return (rule, path)


def unexempted(
    violations: list[Violation], allowlist: tuple[Exemption, ...] = ALLOWLIST
) -> list[Violation]:
    """The violations no exemption covers."""
    allowed = {_key(e.rule, e.path) for e in allowlist}
    return [v for v in violations if _key(v.rule, _relative(v.path)) not in allowed]


def stale(
    violations: list[Violation], allowlist: tuple[Exemption, ...] = ALLOWLIST
) -> list[Exemption]:
    """Exemptions that no longer match a violation (the migration must drain)."""
    live = {_key(v.rule, _relative(v.path)) for v in violations}
    return [e for e in allowlist if _key(e.rule, e.path) not in live]


def main() -> int:
    """Check the control test tree and report unexempted + stale entries."""
    violations = collect(CONTROL_TESTS)
    unexempted_violations = unexempted(violations, ALLOWLIST)
    stale_exemptions = stale(violations, ALLOWLIST)
    for violation in unexempted_violations:
        print(f"{_relative(violation.path)}: [{violation.rule}] {violation.detail}")
    for exemption in stale_exemptions:
        print(
            f"{exemption.path}: stale exemption [{exemption.rule}] "
            f"({exemption.card}) - remove it, the violation is gone"
        )
    if unexempted_violations or stale_exemptions:
        print(
            f"python test layout: {len(unexempted_violations)} violation(s), "
            f"{len(stale_exemptions)} stale exemption(s)"
        )
        return 1
    print("python test layout: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
