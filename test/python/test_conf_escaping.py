"""Regression tests for escaping model data inside inline ``<script>`` tags.

``BaseControl`` serializes config dicts and locale tables directly into
classic ``<script>`` tags. JSON does not escape ``<``, so any model-supplied
string (a layer name, an export filename, ...) containing ``</script>`` would
close the script tag and let the remainder execute as script. These tests pin
the escaping on both injection sites:

* :attr:`BaseControl._config_block` — the per-control ``const CONF = {...}`` line.
* ``_build_shared_header()`` — the ``window.foliplus._TABLES = {...}`` line
  injected once per map into ``<head>``.

The escape form of the angle brackets is spelled with :func:`chr` so it
survives any shell heredoc mangling.
"""

from __future__ import annotations

import json
from pathlib import Path

import folium
from conftest import resolve_js_unicode

# Closes the enclosing script tag and starts a new executable one.
PAYLOAD = "</script><script>window.__pwn=1</script>"

# How htmlsafe_json_dumps rewrites a script-closing tag: two backslash escapes.
ESCAPED = chr(92) + "u003c/script" + chr(92) + "u003e"


def _render_layer_map(layer_name: str) -> str:
    """Render a single-feature-group map with a foliplus LayerControl."""
    from foliplus import LayerControl

    m = folium.Map()
    folium.FeatureGroup(name=layer_name).add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


class TestConfBlockEscaping:
    """Model data must never be able to break out of the inline CONF script."""

    def test_config_block_escapes_script_closing_tag(self):
        """A layer name containing </script> is escaped, not emitted raw."""
        from foliplus import LayerControl

        m = folium.Map()
        ctrl = LayerControl()
        m.add_child(ctrl)
        folium.FeatureGroup(name=PAYLOAD).add_to(m)

        ctrl._build_config()
        assert PAYLOAD not in ctrl._config_block
        assert ESCAPED in ctrl._config_block

    def test_layer_name_round_trips_after_escaping(self):
        """Escaping must be a JSON-level transform, not data loss."""
        from foliplus import LayerControl

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
        """The escaped CONF line parses back to the original config value."""
        from foliplus import LayerControl

        m = folium.Map()
        ctrl = LayerControl()
        folium.FeatureGroup(name=PAYLOAD).add_to(m)
        m.add_child(ctrl)
        ctrl._build_config()
        expected = json.loads(ctrl._config_block)["data"]

        html = resolve_js_unicode(_render_layer_map(PAYLOAD))
        # The payload itself contains ';', so the statement is bounded by the '}'
        # that closes the outermost JSON object, not the first ';' overall.
        marker = "const CONF = "
        start = html.index(marker)
        end = html.index("};", start) + 1
        got = json.loads(html[start + len(marker) : end])
        # Layer ids are random per instance, so compare names only.
        assert [d["name"] for d in got["data"]] == [d["name"] for d in expected]

    def test_line_terminators_round_trip(self):
        """U+2028/U+2029 are invalid inside a JS string literal; they must survive."""
        from foliplus import LayerControl

        name = "A B C"
        m = folium.Map()
        ctrl = LayerControl()
        folium.FeatureGroup(name=name).add_to(m)
        m.add_child(ctrl)

        ctrl._build_config()
        names = [d["name"] for d in json.loads(ctrl._config_block)["data"]]
        assert name in names

    def test_config_block_stays_plain_str(self):
        """_config_block must remain a str for the ``| safe`` template injection."""
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        block = ctrl._config_block
        assert type(block) is str
        assert json.loads(block)["name"] == "BaseControl"


class TestSharedHeaderEscaping:
    """The ``_TABLES`` line in ``<head>`` must take the same escaping path.

    The poisoned shared table is staged in a temp dir so the checked-in
    ``common.en.json`` is never touched (parallel runs would race on it).
    """

    @staticmethod
    def _header_with_payload():
        import tempfile

        from foliplus import locale
        from foliplus.locale import _load_tables

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
                from foliplus.BaseControl import _build_shared_header

                _build_shared_header.cache_clear()
                header = _build_shared_header()
                _build_shared_header.cache_clear()
            finally:
                locale._LOCALE_DIR = original_dir
                _load_tables.cache_clear()
                from foliplus.BaseControl import _build_shared_header

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

