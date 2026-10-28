"""The ``_TABLES`` line in ``<head>`` must take the same escaping path.

The poisoned shared table is staged in a temp dir so the checked-in
``common.en.json`` is never touched (parallel runs would race on it).
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from foliplus import locale
from foliplus.BaseControl import _build_shared_header
from foliplus.locale import _load_component_tables, _load_tables

from .helper import (
    ESCAPED,
    LINE_TERMINATORS,
    LS,
    PAYLOAD,
    PS,
)


def _clear_caches() -> None:
    """Drop every cache that keys off the locale directory."""
    _load_tables.cache_clear()
    _load_component_tables.cache_clear()
    _build_shared_header.cache_clear()


@contextmanager
def _staged_locale_dir(staged: Path) -> Iterator[None]:
    """Point the locale loader at *staged* for one build, then restore.

    Every cache that keys off ``_LOCALE_DIR`` is dropped on both edges. The
    component-table cache is the trap: ``_build_shared_header`` embeds
    ``_load_component_tables()``, the staged dir holds no component files, so a
    build here would cache ``{}`` for the rest of the process. A later render in
    the same xdist worker then ships ``_COMPONENT_TABLES = {}`` and loses every
    translation — the parallel-only ``locale_zh`` / ``locale_en`` reds.
    Clearing ``_load_tables`` alone does not cover it: that is another cache.
    """
    original = locale._LOCALE_DIR
    locale._LOCALE_DIR = staged
    _clear_caches()
    try:
        yield
    finally:
        locale._LOCALE_DIR = original
        _clear_caches()


class TestSharedHeaderEscaping:
    """The ``_TABLES`` line in ``<head>`` must take the same escaping path."""

    @staticmethod
    def _header_with_payload() -> str:
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp)
            (staged / "common.en.json").write_text(
                json.dumps({"locale.code": "en", "locale.name": PAYLOAD}),
                encoding="utf-8",
            )
            (staged / "common.zh.json").write_text(
                json.dumps({"locale.code": "zh", "locale.name": "中文"}),
                encoding="utf-8",
            )
            with _staged_locale_dir(staged):
                return _build_shared_header()

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
            staged = Path(tmp)
            (staged / "common.en.json").write_text(
                json.dumps({"locale.code": "en", "locale.name": LINE_TERMINATORS}),
                encoding="utf-8",
            )
            with _staged_locale_dir(staged):
                header = _build_shared_header()

        assert LS not in header and PS not in header
        blob = header.split("window.foliplus._TABLES = ", 1)[1].split(";", 1)[0]
        assert json.loads(blob)["en"]["locale.name"] == LINE_TERMINATORS


class TestLocaleCacheLeak:
    """A staged header build must not poison the process-wide table cache."""

    def test_component_tables_cache_holds_the_real_tables_after_a_build(self):
        """``_load_component_tables`` must still describe the shipped files.

        Regression for the parallel-only locale reds: the staged dir has no
        component JSON, so a build that left its ``{}`` in the ``@cache`` would
        make every later render in this worker ship ``_COMPONENT_TABLES = {}``.
        Asserting on the cache rather than on a rendered page keeps the check
        inside this file's blast radius.
        """
        TestSharedHeaderEscaping._header_with_payload()

        tables = _load_component_tables()
        assert "MeasureControl" in tables
        assert "zh" in tables["MeasureControl"]
