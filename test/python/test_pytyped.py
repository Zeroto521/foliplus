"""PEP 561 packaging contract: the type marker must exist and reach the wheel.

``py.typed`` is a source-tree marker; a package that ships types without it is
silently skipped by downstream mypy/pyright. These tests pin the two halves of
that contract: the marker file exists, and the build explicitly packages it
(``include-package-data = false`` means nothing reaches the wheel unless it is
listed in ``[tool.setuptools.package-data]``).
"""

from __future__ import annotations

from pathlib import Path

from foliplus import __path__

_REPO_ROOT = Path(__path__[0]).parent


def test_py_typed_marker_exists_and_is_empty():
    marker = _REPO_ROOT / "foliplus" / "py.typed"
    assert marker.is_file(), "foliplus/py.typed must exist (PEP 561)"
    assert marker.read_bytes() == b""


def test_py_typed_is_listed_in_package_data():
    pyproject = (_REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert '"py.typed"' in pyproject, (
        "py.typed must be listed in [tool.setuptools.package-data] so the "
        "include-package-data = false build still ships it"
    )
