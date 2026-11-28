"""Tests for the declaration key constants (``foliplus._declaration.key``)."""

from __future__ import annotations

import re
from pathlib import Path

from foliplus import _declaration

_JS_FOLDER_NAME_MAX_RE = re.compile(r"const FOLDER_NAME_MAX = (\d+);")


def test_the_js_reader_uses_the_same_cap() -> None:
    """The JS reader caps a folder name with its own copy of the constant.

    Both stacks decide which names reach the panel, so the value is read from
    the committed ``folderName.ts`` instead of being asserted against a
    literal that would survive a change to either side.
    """
    source = (
        Path(__file__).resolve().parents[3] / "foliplus/js/core/layer/folderName.ts"
    ).read_text(encoding="utf-8")
    match = _JS_FOLDER_NAME_MAX_RE.search(source)
    assert match is not None, "FOLDER_NAME_MAX missing from folderName.ts"
    assert int(match[1]) == _declaration.FOLDER_NAME_MAX
