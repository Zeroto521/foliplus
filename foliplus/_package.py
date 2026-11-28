"""Resolve the running foliplus version, with the source-tree fallback.

One resolution point for the package version: ``foliplus.__version__`` and the
CONFIG diagnostic envelope (``BaseControl._config_block``) both read
``version`` from here. The generated ``_version.py`` is the primary source; an
editable/source checkout without it falls back to installed metadata, and an
uninstalled source tree reports ``"unknown"`` — the same fallback chain the
package already used, now with a single implementation instead of a copy.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _dist_version

try:
    from ._version import __version__ as version
except ImportError:  # source tree without the generated _version.py
    try:
        version = _dist_version("foliplus")
    except PackageNotFoundError:
        version = "unknown"

__all__ = ["version"]
