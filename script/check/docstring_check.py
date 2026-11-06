#!/usr/bin/env python3
"""Gate: shipped control class docstrings must parse as clean reST.

The docs were silently dropping Notes-section grid tables because a single
misaligned row made docutils report ``ERROR/3 Malformed table. Right border
not aligned or missing`` -- RTD drops the table without surfacing the error.
This gate parses control class docstrings with docutils and fails on any real
ERROR/3, so a grid-table markup regression cannot land silently.

Only real ERROR/3 (e.g. ``Malformed table``, ``Title underline too short``) is
a failure. ``Unexpected section title`` is excluded: a standalone docutils
parse reports it for every control docstring's section heading that follows a
bullet list (Sphinx renders those fine), and its severity is docutils-
version-dependent (SEVERE/4 in 0.21, ERROR/3 in 0.22+), so it cannot be a
reliable failure signal.

docutils also silently accepts a table header separator that mixes ``=`` and
``-`` border characters (e.g. ``+===+---+`` in a grid table, ``=== ---`` in a simple
table) without reporting ERROR/3, so the gate additionally scans the separator
rows for inconsistent border chars (``find_table_border_issues``).

Usage (called by pre-commit with the changed files, or directly):
    python script/check/docstring_check.py [FILE ...]

With ``FILE`` arguments (pre-commit ``pass_filenames: true``) only the control
classes whose source file is listed are checked; with no arguments every
shipped control docstring is checked. Failures report the docstring-relative
line of the offending markup.
"""

from __future__ import annotations

import ast
import io
import re
import sys
import textwrap
from pathlib import Path

# ── Module constants ───────────────────────────────────────────────────
# Each shipped control class and its source file. BaseControl is the shared
# base; the rest are the public controls. Order is the API-docs order.
CONTROL_CLASSES: dict[str, str] = {
    "BaseControl": "foliplus/BaseControl.py",
    "LayerControl": "foliplus/control/LayerControl/control.py",
    "FullscreenControl": "foliplus/control/FullscreenControl.py",
    "ScaleControl": "foliplus/control/ScaleControl.py",
    "LocateControl": "foliplus/control/LocateControl.py",
    "HeatmapControl": "foliplus/control/HeatmapControl/control.py",
    "MeasureControl": "foliplus/control/MeasureControl.py",
    "SearchControl": "foliplus/control/SearchControl.py",
    "ExportControl": "foliplus/control/ExportControl.py",
}

# Sphinx roles the docstrings use as cross-references. docutils alone does
# not know them and would report ``Unknown interpreted text role`` (ERROR/3),
# so they are registered as generic inline roles before parsing.
_SPHINX_ROLES = ("class", "meth", "mod", "attr", "func", "exc", "data", "obj", "ref")

# ``Unexpected section title`` is a standalone-parse artifact, not a markup
# bug: docutils reports it when a section heading follows a bullet list (which
# every control docstring does after its summary), and its severity is
# docutils-version-dependent (SEVERE/4 in 0.21, ERROR/3 in 0.22+). Sphinx
# renders those headings fine, so it must not gate the build. This is the
# single artifact filter -- keep it as one constant.
_ARTIFACT_MESSAGES = ("Unexpected section title",)

# A docutils system message prefixes its text with ``<source>:<line>: ``; strip
# that so failures report the docstring-relative line separately.
_MESSAGE_PREFIX = re.compile(r"^<[^>]+>:\d+: ")


def extract_class_docstring(source: str, class_name: str) -> str:
    """Return the dedented class docstring, or "" if absent."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            doc = ast.get_docstring(node, clean=False)
            if doc:
                return textwrap.dedent(doc)
    return ""


def _register_sphinx_roles() -> None:
    from docutils import nodes
    from docutils.parsers.rst.roles import register_canonical_role

    def generic_role(name, rawtext, text, lineno, inliner, options=None, content=None):
        return [nodes.literal(rawtext, text, classes=["xref"])], []

    for role in _SPHINX_ROLES:
        try:
            register_canonical_role(role, generic_role)
        except Exception:
            # already registered by a prior call in this interpreter
            pass


def _docutils_messages(docstring: str) -> list[tuple[int, int, str]]:
    """Parse a docstring and return (level, docstring-line, text) per message."""
    from docutils.core import publish_doctree

    _register_sphinx_roles()
    buf = io.StringIO()
    tree = publish_doctree(
        docstring,
        settings_overrides={"report_level": 1, "halt_level": 5, "warning_stream": buf},
    )
    messages: list[tuple[int, int, str]] = []
    for node in tree.findall():
        if node.tagname == "system_message":
            level = int(node["level"])
            line = int(node.get("line") or 0)
            first = node.astext().split("\n")[0]
            first = _MESSAGE_PREFIX.sub("", first)
            messages.append((level, line, first))
    return messages


def _normalize_path(path: str | Path) -> str:
    """Return a forward-slash POSIX-style path from any input path style.

    pre-commit passes changed files as OS-specific paths; on Windows a source
    path may arrive with ``\\`` separators while ``CONTROL_CLASSES`` uses ``/``.
    Normalizing both sides to ``/`` makes the match host-independent.
    """
    return str(path).replace("\\", "/")


def _controls_to_check(only_files: list[Path] | None) -> dict[str, Path]:
    """Return {class: source_path} for the controls to scan.

    With ``only_files`` (pre-commit changed files) restrict to the control
    classes whose source is listed; otherwise check every shipped control.
    """
    if not only_files:
        return {name: Path(src) for name, src in CONTROL_CLASSES.items()}
    wanted = {_normalize_path(f) for f in only_files}
    return {
        name: Path(src)
        for name, src in CONTROL_CLASSES.items()
        if _normalize_path(src) in wanted
    }


def scan_control_docstrings(
    repo_root: Path, only_files: list[Path] | None = None
) -> dict[str, list[tuple[int, int, str]]]:
    """Parse each selected control docstring; return {control: messages}."""
    result = {}
    for class_name, rel_path in _controls_to_check(only_files).items():
        source_path = repo_root / rel_path
        try:
            source = source_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            result[class_name] = [(3, 0, f"source file not found: {rel_path}")]
            continue
        docstring = extract_class_docstring(source, class_name)
        result[class_name] = _docutils_messages(docstring)
    return result


def find_errors(messages: list[tuple[int, int, str]]) -> list[tuple[int, int, str]]:
    """Keep real ERROR (level 3) messages -- the failure signal.

    ``Unexpected section title`` is excluded: it is a standalone-parse artifact
    (see ``_ARTIFACT_MESSAGES``), not a markup bug.
    """
    return [
        (level, line, msg)
        for level, line, msg in messages
        if level == 3 and not any(a in msg for a in _ARTIFACT_MESSAGES)
    ]


def find_table_border_issues(docstring: str) -> list[tuple[int, str]]:
    """Return (docstring-line, description) for table separators mixing border chars.

    docutils silently accepts a table header separator that mixes ``=`` and ``-``
    border characters (e.g. ``+===+---+`` in a grid table, ``=== ---`` in a simple
    table) instead of reporting ERROR/3, so the docutils parse in
    ``_docutils_messages`` cannot catch it. This is an independent structural scan
    of the separator rows.

    A single ``=`` or ``-`` run is a section underline, not a table separator, so
    it is left alone. Indented lines inside a ``::`` literal block and ``>>>`` doctest
    blocks are skipped: a code example may legally show a ``+---+---+``-looking
    line, which is not a table in the rendered docstring.
    """
    issues: list[tuple[int, str]] = []
    in_doctest = False
    in_literal = False
    for idx, line in enumerate(docstring.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            # A blank line ends a doctest block; it may sit inside a literal
            # block (blank lines are allowed between indented code lines), so
            # in_literal is kept.
            in_doctest = False
            continue
        if stripped.startswith(">>>"):
            in_doctest = True
            continue
        if in_doctest:
            # Doctest output follows the prompt at the same indent; skip it.
            continue
        if stripped.endswith("::"):
            # A line ending with '::' introduces a literal block; the following
            # indented lines are a code example, not docstring markup.
            in_literal = True
            continue
        if in_literal:
            # Indented lines after '::' stay in the literal block; a non-indented
            # line (or the blank line above) ends it.
            if line != stripped:
                continue
            in_literal = False
        # A separator row may keep its source indent (extract_class_docstring
        # returns the docstring undedented when its first line is not indented),
        # so the checks below use the stripped line.
        if stripped.startswith("+"):
            # Grid-table border row: border characters between '+' markers must be
            # consistent (all '-' or all '='), e.g. "+===+---+" is malformed.
            segments = [seg for seg in stripped.split("+") if seg]
            chars = {seg[0] for seg in segments if seg}
            if len(chars) > 1:
                issues.append(
                    (
                        idx,
                        f"grid table separator mixes border chars ({''.join(sorted(chars))})",
                    )
                )
            continue
        if re.fullmatch(r"(?:[=\-]+\s+)+[=\-]+", stripped):
            # Simple-table separator row: >= 2 runs of '=' or '-' separated by
            # whitespace (a single run is a section underline). The runs must be
            # consistent, e.g. "=== ---" mixes chars and is malformed.
            runs = re.findall(r"[=\-]+", stripped)
            chars = {run[0] for run in runs}
            if len(chars) > 1:
                issues.append(
                    (
                        idx,
                        f"simple table separator mixes border chars ({''.join(sorted(chars))})",
                    )
                )
    return issues


def scan_table_border_issues(
    repo_root: Path, only_files: list[Path] | None = None
) -> dict[str, list[tuple[int, str]]]:
    """Scan each selected control docstring for mixed-border table separators.

    Returns ``{control: [(docstring-line, description), ...]}``. Selection and
    file-reading mirror ``scan_control_docstrings`` so both checks see the same
    set of controls.
    """
    result: dict[str, list[tuple[int, str]]] = {}
    for class_name, rel_path in _controls_to_check(only_files).items():
        source_path = repo_root / rel_path
        try:
            source = source_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            continue  # already reported as an ERROR/3 by scan_control_docstrings
        docstring = extract_class_docstring(source, class_name)
        issues = find_table_border_issues(docstring)
        if issues:
            result[class_name] = issues
    return result


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    args = list(sys.argv[1:] if argv is None else argv)
    only_files = [Path(a) for a in args if not a.startswith("-")] or None
    results = scan_control_docstrings(repo_root, only_files)
    table_issues = scan_table_border_issues(repo_root, only_files)
    if not results and not table_issues:
        print("docstring_check: no control files to check")
        return 0
    failures = []
    for class_name, messages in results.items():
        for _level, line, msg in find_errors(messages):
            failures.append(f"  {class_name}: docstring line {line}: {msg}")
    for class_name, issues in table_issues.items():
        for line, desc in issues:
            failures.append(f"  {class_name}: docstring line {line}: {desc}")
    if failures:
        print("docstring_check: found docstring markup problems:")
        print("\n".join(failures))
        return 1
    print(f"docstring_check: {len(results)} control docstrings clean (no ERROR/3)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
