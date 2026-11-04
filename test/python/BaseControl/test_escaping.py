"""Both script-emission sites must take the same escaping path.

The inline ``CONFIG`` block (built through ``_safe_json``) and the ``_TABLES``
line in ``<head>`` both splice model data into a ``<script>`` tag, so both must
spell ``<``, ``>``, ``&``, ``'`` and the JS line terminators as ``\\uXXXX``.
The same injection payloads are pinned against both sites; folium's own
escaping of the same layer name is kept as the target-behavior baseline.

The poisoned shared table is staged in a temp dir so the checked-in
``common.en.json`` is never touched (parallel runs would race on it).
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import folium
from conftest import resolve_js_unicode

from foliplus import ExportControl, LayerControl, locale
from foliplus.BaseControl import BaseControl, _build_shared_header, _safe_json
from foliplus.locale import _load_component_tables, _load_tables

from .helper import (
    ESCAPED,
    LINE_TERMINATORS,
    LS,
    LS_ESCAPED,
    PAYLOAD,
    PS,
    PS_ESCAPED,
)


class TestSafeJson:
    """The single serialization choke point behind both script tags."""

    def test_escapes_all_four_html_sensitive_characters(self):
        """<, >, &, ' are rewritten; none may reach the script tag raw."""
        out = _safe_json({"n": "</script> & 'quoted'"})

        assert "<" not in out and ">" not in out
        assert "&" not in out and "'" not in out
        assert out == '{"n": "\\u003c/script\\u003e \\u0026 \\u0027quoted\\u0027"}'

    def test_escalines_line_terminators(self):
        """U+2028/U+2029 are emitted as \\uXXXX escapes, never literally."""
        out = _safe_json({"n": LINE_TERMINATORS})

        assert LS not in out and PS not in out
        assert LS_ESCAPED in out and PS_ESCAPED in out
        # Escaping must be a spelling change only — the value is intact.
        assert json.loads(out) == {"n": LINE_TERMINATORS}

    def test_keeps_ascii_off_for_cjk(self):
        """CJK stays literal — ensure_ascii=False is deliberate, not incidental."""
        out = _safe_json({"n": "中文图层"})

        assert "中文图层" in out
        assert "u4e2d" not in out

    def test_no_terminator_injection_on_clean_input(self):
        """The replace pass must not manufacture escapes for values that had none."""
        out = _safe_json({"n": "plain text 中文 & <tag>"})

        assert "u2028" not in out and "u2029" not in out
        assert json.loads(out) == {"n": "plain text 中文 & <tag>"}

    def test_round_trips_every_json_type(self):
        """Numbers, booleans, None, lists and nesting survive the escaping."""
        value = {
            "s": "</script>",
            "i": 42,
            "f": 0.5,
            "t": True,
            "f2": False,
            "n": None,
            "l": ["</script>", LS],
            "d": {"nested": {"deep": [1, 2, 3]}},
        }
        assert json.loads(_safe_json(value)) == value

    def test_returns_plain_str(self):
        """The template interpolates this into ``| safe`` — it must be a str."""
        assert type(_safe_json({"a": 1})) is str


def _render_layer_map(layer_name: str) -> str:
    """Render a single-feature-group map with a foliplus LayerControl."""
    m = folium.Map()
    folium.FeatureGroup(name=layer_name).add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


class TestConfBlockEscaping:
    """Model data must never be able to break out of the inline CONFIG script."""

    def test_config_block_escapes_script_closing_tag(self):
        """A layer name containing </script> is escaped, not emitted raw."""
        m = folium.Map()
        ctrl = LayerControl()
        m.add_child(ctrl)
        folium.FeatureGroup(name=PAYLOAD).add_to(m)

        ctrl._build_config()
        assert PAYLOAD not in ctrl._config_block
        assert ESCAPED in ctrl._config_block

    def test_layer_name_round_trips_after_escaping(self):
        """Escaping must be a JSON-level transform, not data loss."""
        html = _render_layer_map(PAYLOAD)
        m = folium.Map()
        ctrl = LayerControl()
        folium.FeatureGroup(name=PAYLOAD).add_to(m)
        m.add_child(ctrl)

        ctrl._build_config()
        names = [d["name"] for d in json.loads(ctrl._config_block)["data"]]
        assert PAYLOAD in names
        assert html.count(PAYLOAD) == 0

    def test_rendered_html_carries_only_the_escaped_form(self):
        """The page contains the escaped form and never the raw payload."""
        html = _render_layer_map(PAYLOAD)

        assert ESCAPED in html
        assert PAYLOAD not in html
        # Decoding the escapes recovers the original string — proving the
        # data is intact, only written in a JS-safe spelling.
        assert PAYLOAD in resolve_js_unicode(html)

    def test_conf_line_round_trips_through_rendered_html(self):
        """The escaped CONFIG line parses back to the original config value."""
        m = folium.Map()
        ctrl = LayerControl()
        folium.FeatureGroup(name=PAYLOAD).add_to(m)
        m.add_child(ctrl)
        ctrl._build_config()
        expected = json.loads(ctrl._config_block)["data"]

        html = resolve_js_unicode(_render_layer_map(PAYLOAD))
        # The payload itself contains ';', so the statement is bounded by the '}'
        # that closes the outermost JSON object, not the first ';' overall.
        marker = "const CONFIG = "
        start = html.index(marker)
        end = html.index("};", start) + 1
        got = json.loads(html[start + len(marker) : end])
        # Layer ids are random per instance, so compare names only.
        assert [d["name"] for d in got["data"]] == [d["name"] for d in expected]

    def test_line_terminators_are_escaped_in_config_block(self):
        """A layer name carrying U+2028 must reach the page as \\u2028, not bare."""
        m = folium.Map()
        ctrl = LayerControl()
        folium.FeatureGroup(name=LINE_TERMINATORS).add_to(m)
        m.add_child(ctrl)

        ctrl._build_config()
        block = ctrl._config_block
        assert LS not in block and PS not in block
        assert LS_ESCAPED in block and PS_ESCAPED in block
        names = [d["name"] for d in json.loads(block)["data"]]
        assert LINE_TERMINATORS in names

    def test_export_filename_field_is_escaped(self):
        """The same protection must hold for a plain exported field, not just layer data."""
        ctrl = ExportControl(filename=PAYLOAD)
        ctrl._build_config()

        block = ctrl._config_block
        assert PAYLOAD not in block
        assert json.loads(block)["filename"] == PAYLOAD

    def test_export_filename_round_trips_through_html(self):
        """The escaped filename recovers once the browser decodes the CONFIG line."""
        m = folium.Map()
        ctrl = ExportControl(filename=PAYLOAD)
        m.add_child(ctrl)
        html = m.get_root().render()

        assert PAYLOAD not in html
        marker = "const CONFIG = "
        start = html.index(marker)
        end = html.index("};", start) + 1
        got = json.loads(html[start + len(marker) : end])
        assert got["filename"] == PAYLOAD

    def test_config_block_stays_plain_str(self):
        """_config_block must remain a str for the ``| safe`` template injection."""
        ctrl = BaseControl()
        block = ctrl._config_block
        assert type(block) is str
        assert json.loads(block)["name"] == "BaseControl"


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


class TestFoliumBaseline:
    """Sanity check: folium escapes this same payload, which is the target behavior."""

    def test_folium_escaped_same_layer_name(self):
        m = folium.Map()
        folium.FeatureGroup(name=PAYLOAD).add_to(m)
        folium.LayerControl().add_to(m)

        html = m.get_root().render()
        assert ESCAPED in html
        assert PAYLOAD not in html
        assert PAYLOAD in resolve_js_unicode(html)
