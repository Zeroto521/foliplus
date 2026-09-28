"""PEP 561 packaging contract: the type marker must exist and reach the wheel.

``py.typed`` is a source-tree marker; a package that ships types without it is
silently skipped by downstream mypy/pyright. These tests pin the two halves of
that contract: the marker file exists, and the build explicitly packages it
(``include-package-data = false`` means nothing reaches the wheel unless it is
listed in ``[tool.setuptools.package-data]``).
"""

from __future__ import annotations

import glob
import tarfile
import zipfile
from pathlib import Path

import pytest

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


def _member_names(path: str) -> list[str]:
    if path.endswith(".whl"):
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
    else:
        with tarfile.open(path) as archive:
            names = archive.getnames()
    return [n.replace("\\", "/") for n in names]


def _has_py_typed(path: str) -> bool:
    return any(
        parts[-1] == "py.typed" and "foliplus" in parts
        for parts in (n.split("/") for n in _member_names(path))
    )


def test_wheel_ships_py_typed():
    wheels = glob.glob(str(Path.cwd() / "dist" / "*.whl"))
    if not wheels:
        pytest.skip("no wheel built — run `make build-python` first")
    assert _has_py_typed(wheels[0]), f"{wheels[0]} is missing foliplus/py.typed"


def test_sdist_ships_py_typed():
    sdists = glob.glob(str(Path.cwd() / "dist" / "*.tar.gz"))
    if not sdists:
        pytest.skip("no sdist built — run `make build-python` first")
    assert _has_py_typed(sdists[0]), f"{sdists[0]} is missing foliplus/py.typed"
