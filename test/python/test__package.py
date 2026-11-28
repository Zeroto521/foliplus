"""Tests for foliplus._package — the single version resolution point."""

from __future__ import annotations

import foliplus
from foliplus import _package


def test_package_version_is_a_non_empty_string():
    assert isinstance(_package.version, str)
    assert _package.version


def test_init_reexports_the_same_version():
    """foliplus.__version__ must be the helper's value, not a second copy."""
    assert foliplus.__version__ == _package.version
