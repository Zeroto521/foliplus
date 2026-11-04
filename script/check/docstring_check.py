#!/usr/bin/env python3
"""Gate: shipped control class docstrings must parse as clean reST.

The docs were silently dropping Notes-section grid tables because a single
misaligned row made docutils report ``ERROR/3 Malformed table. Right border
not aligned or missing`` -- RTD drops the table without surfacing the error.
This gate parses every shipped control class docstring with docutils and
fails on any ERROR/3, so a grid-table markup regression cannot land silently.

Only real ERROR/3 (e.g. ``Malformed table``, ``Title underline too short``) is a
failure. ``Unexpected section title`` is excluded: a standalone docutils parse
reports it for every control docstring's section heading that follows a bullet
list (Sphinx renders those fine), and its severity is docutils-version-dependent
(SEVERE/4 in 0.21, ERROR/3 in 0.22+), so it cannot be a reliable failure signal.

Usage:
    python script/check/docstring_check.py
"""

from __future__ import annotations

import ast
import io
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
    "HeatmapControl": "foliplus/control/HeatmapControl.py",
    "MeasureControl": "foliplus/control/MeasureControl.py",
    "SearchControl": "foliplus/control/SearchControl.py",
    "ExportControl": "foliplus/control/ExportControl.py",
}

# Sphinx roles the docstrings use as cross-references. docutils alone does
# not know them and would report ``Unknown interpreted text role`` (ERROR/3),
# so they are registered as generic inline roles before parsing.
_SPHINX_ROLES = ("class", "meth", "mod", "attr", "func", "exc", "data", "obj", "ref")


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


def _docutils_messages(docstring: str) -> list[tuple[int, str]]:
    """Parse a docstring and return (level, first-line) per system message."""
    from docutils.core import publish_doctree

    _register_sphinx_roles()
    buf = io.StringIO()
    tree = publish_doctree(
        docstring,
        settings_overrides={"report_level": 1, "halt_level": 5, "warning_stream": buf},
    )
    messages: list[tuple[int, str]] = []
    for node in tree.findall():
        if node.tagname == "system_message":
            level = int(node["level"])
            first = node.astext().split("\n")[0]
            messages.append((level, first))
    return messages


def scan_control_docstrings(repo_root: Path) -> dict[str, list[tuple[int, str]]]:
    """Parse each control class docstring; return {control: [(level, msg)]}."""
    result = {}
    for class_name, rel_path in CONTROL_CLASSES.items():
        source_path = repo_root / rel_path
        docstring = extract_class_docstring(source_path.read_text(encoding="utf-8"), class_name)
        result[class_name] = _docutils_messages(docstring)
    return result


# ``Unexpected section title`` is a standalone-parse artifact, not a markup
# bug: docutils reports it when a section heading follows a bullet list (which
# every control docstring does after its summary), and its severity is
# docutils-version-dependent (SEVERE/4 in 0.21, ERROR/3 in 0.22+). Sphinx
# renders those headings fine, so it must not gate the build.
_ARTIFACT_MESSAGES = ("Unexpected section title",)


def find_errors(messages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Keep real ERROR (level 3) messages -- the failure signal.

    ``Unexpected section title`` is excluded: it is a standalone-parse artifact
    (see ``_ARTIFACT_MESSAGES``), not a markup bug.
    """
    return [
        (level, msg)
        for level, msg in messages
        if level == 3 and not any(a in msg for a in _ARTIFACT_MESSAGES)
    ]


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    results = scan_control_docstrings(repo_root)
    failures = []
    for class_name, messages in results.items():
        for level, msg in find_errors(messages):
            failures.append(f"  {class_name}: {msg}")
    if failures:
        print("docstring_check: ERROR/3 found in control docstrings:");
        print("\n".join(failures));
        return 1
    print(f"docstring_check: {len(results)} control docstrings clean (no ERROR/3)");
    return 0


if __name__ == "__main__":
    sys.exit(main())