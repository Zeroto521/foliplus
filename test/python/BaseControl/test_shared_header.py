"""The ``_TABLES`` line in ``<head>`` must take the same escaping path.

The poisoned shared table is staged in a temp dir so the checked-in
``common.en.json`` is never touched (parallel runs would race on it).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from foliplus import locale
from foliplus.BaseControl import _build_shared_header
from foliplus.locale import _load_tables

from .helper import (
    ESCAPED,
    LINE_TERMINATORS,
    LS,
    PAYLOAD,
    PS,
)


class TestSharedHeaderEscaping:
    """The ``_TABLES`` line in ``<head>`` must take the same escaping path."""

    @staticmethod
    def _header_with_payload():
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "common.en.json").write_text(
                json.dumps({"locale.code": "en", "locale.name": PAYLOAD}),
                encoding="utf-8",
            )
            (tmp / "common.zh.json").write_text(
                json.dumps({"locale.code": "zh", "locale.name": "中文"}),
                encoding="utf-8",
            )
            original_dir = locale._LOCALE_DIR
            locale._LOCALE_DIR = tmp
            try:
                _load_tables.cache_clear()
                _build_shared_header.cache_clear()
                header = _build_shared_header()
                _build_shared_header.cache_clear()
            finally:
                locale._LOCALE_DIR = original_dir
                _load_tables.cache_clear()
                _build_shared_header.cache_clear()
        return header

    def test_tables_payload_escaped(self):
        """A script-closing tag in a locale table is escaped in the <head> bundle."""
        header = self._header_with_payload()

        assert ESCAPED in header
        assert PAYLOAD not in header

    def test_tables_payload_round_trips(self):
        """The escaped ``_TABLES`` value must parse back to the original string."""
        header = self._header_with_payload()

        blob = header.split("window.foliplus._TABLES = ", 1)[1].split(";", 1)[0]
        assert json.loads(blob)["en"]["locale.name"] == PAYLOAD

    def test_tables_terminators_escaped(self):
        """The _TABLES line takes the U+2028 pass too — same choke point as CONFIG."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "common.en.json").write_text(
                json.dumps({"locale.code": "en", "locale.name": LINE_TERMINATORS}),
                encoding="utf-8",
            )
            original_dir = locale._LOCALE_DIR
            locale._LOCALE_DIR = tmp
            try:
                _load_tables.cache_clear()
                _build_shared_header.cache_clear()
                header = _build_shared_header()
                _build_shared_header.cache_clear()
            finally:
                locale._LOCALE_DIR = original_dir
                _load_tables.cache_clear()
                _build_shared_header.cache_clear()

        assert LS not in header and PS not in header
        blob = header.split("window.foliplus._TABLES = ", 1)[1].split(";", 1)[0]
        assert json.loads(blob)["en"]["locale.name"] == LINE_TERMINATORS
