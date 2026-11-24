"""Package-level contract for ``foliplus._declaration``.

The reader families are covered by their own mirror modules (``test_warning``,
``test_zoom_range``, ``test_filter``, ``test_folder``, ``test_paint``,
``test_fill``, ``test_marker``); this module pins the package invariant the
split moved: every declaration module declares its constants before its first
definition, so the public facade can re-export them safely.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from foliplus._declaration import normalise_fill


def _first_definition_line(tree: ast.Module) -> int | None:
    return next(
        (
            node.lineno
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        ),
        None,
    )


def _module_binding_names(node: ast.AST) -> list[str]:
    """Names a module-level node binds, for the placement guard.

    Declaration scope only: top-level ``Assign``/``AnnAssign``/``AugAssign``,
    a bare module-level walrus (an ``Expr`` wrapping a ``NamedExpr``), and
    imports. Function/class bodies are never entered, so their internal
    bindings are invisible to the guard.
    """
    if isinstance(node, ast.AnnAssign):
        return [node.target.id] if isinstance(node.target, ast.Name) else []
    if isinstance(node, ast.Assign):
        return [target.id for target in node.targets if isinstance(target, ast.Name)]
    if isinstance(node, ast.AugAssign):
        return [node.target.id] if isinstance(node.target, ast.Name) else []
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.NamedExpr):
        return [node.value.target.id] if isinstance(node.value.target, ast.Name) else []
    if isinstance(node, ast.Import):
        return [alias.asname or alias.name for alias in node.names]
    if isinstance(node, ast.ImportFrom):
        return [alias.asname or alias.name for alias in node.names]
    return []


def _late_module_bindings(tree: ast.Module) -> list[tuple[str, int]]:
    """Module-level bindings that land after the first definition."""
    first_def = _first_definition_line(tree)
    if first_def is None:
        return []
    return [
        (name, node.lineno)
        for node in tree.body
        if node.lineno > first_def
        for name in _module_binding_names(node)
    ]


@pytest.mark.parametrize(
    "module_path",
    [
        "foliplus/_declaration/warning.py",
        "foliplus/_declaration/filter.py",
        "foliplus/_declaration/paint.py",
        "foliplus/_declaration/marker.py",
        "test/python/_declaration/test__declaration.py",
    ],
)
def test_module_constants_precede_the_first_definition(module_path: str) -> None:
    module = Path(__file__).resolve().parents[3] / module_path
    tree = ast.parse(module.read_text(encoding="utf-8"))
    assert _first_definition_line(tree) is not None, (
        f"{module_path}: no function or class definition"
    )
    late = _late_module_bindings(tree)
    assert not late, (
        f"{module_path}: module bindings after the first definition: {late}"
    )


@pytest.mark.parametrize(
    "source, shape",
    [
        ("X = 1\ndef f():\n    pass\nX += 1\n", "AugAssign"),
        ("def f():\n    pass\n(y := 5)\n", "module-level walrus"),
        (
            "def f():\n    pass\nimport os\nfrom os import path\n",
            "import / import-from",
        ),
    ],
)
def test_guard_catches_late_module_bindings(source: str, shape: str) -> None:
    """Negative fixtures: each late-binding shape must actually be caught.

    A negative fixture that never fires would not exercise the branch it
    claims to cover — the guard would be green regardless of whether the
    branch exists. Each shape here must produce at least one late binding.
    """
    late = _late_module_bindings(ast.parse(source))
    assert late, f"guard missed a late {shape} binding"
