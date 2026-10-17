"""Model data must never break out of the inline CONFIG script."""

from __future__ import annotations

import json

import folium
from conftest import resolve_js_unicode

from .helper import ESCAPED, LINE_TERMINATORS, LS, LS_ESCAPED, PAYLOAD, PS, PS_ESCAPED


def _render_layer_map(layer_name: str) -> str:
    """Render a single-feature-group map with a foliplus LayerControl."""
    from foliplus import LayerControl

    m = folium.Map()
    folium.FeatureGroup(name=layer_name).add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


class TestConfBlockEscaping:
    """Model data must never be able to break out of the inline CONFIG script."""

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
        """The escaped CONFIG line parses back to the original config value."""
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
        marker = "const CONFIG = "
        start = html.index(marker)
        end = html.index("};", start) + 1
        got = json.loads(html[start + len(marker) : end])
        # Layer ids are random per instance, so compare names only.
        assert [d["name"] for d in got["data"]] == [d["name"] for d in expected]

    def test_line_terminators_are_escaped_in_config_block(self):
        """A layer name carrying U+2028 must reach the page as \\u2028, not bare."""
        from foliplus import LayerControl

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
        from foliplus import ExportControl

        ctrl = ExportControl(filename=PAYLOAD)
        ctrl._build_config()

        block = ctrl._config_block
        assert PAYLOAD not in block
        assert json.loads(block)["filename"] == PAYLOAD

    def test_export_filename_round_trips_through_html(self):
        """The escaped filename recovers once the browser decodes the CONFIG line."""
        from foliplus import ExportControl

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
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        block = ctrl._config_block
        assert type(block) is str
        assert json.loads(block)["name"] == "BaseControl"
