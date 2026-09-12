"""Tests for foliplus.BaseControl — the Python ↔ JS bridge layer.

Boundary rule: this file only verifies the PY↔JS bridge — shared CSS/JS assets
injection, locale table injection, shared-resource deduplication, and the
escaping of model data serialized into the inline ``<script>`` tags. JS
function presence and internal logic are covered by test/js/ unit tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import folium
import pytest
from conftest import (
    assert_config_block,
    read_css_dir,
    render,
    render_control,
    resolve_js_unicode,
)


class TestBaseControlPython:
    """Python-side API tests for BaseControl internals."""

    def test_export_fields_defaults_to_empty(self):
        from foliplus.BaseControl import BaseControl

        assert BaseControl._export_fields == ()

    def test_extra_config_defaults_to_empty(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        assert ctrl._extra_config() == {}

    def test_build_config_includes_shared_keys(self):
        from foliplus.BaseControl import BaseControl

        assert_config_block(
            BaseControl(), {"name": "BaseControl", "position": "topleft"}
        )

    def test_invalid_position_raises(self):
        """An unknown position is rejected instead of silently falling back."""
        from foliplus.BaseControl import BaseControl

        with pytest.raises(ValueError, match="position must be one of"):
            BaseControl(position="center")

    def test_every_position_is_accepted(self):
        from foliplus.BaseControl import BaseControl

        for position in ("topleft", "topright", "bottomleft", "bottomright"):
            assert BaseControl(position=position).position == position

    def test_build_config_caches_on_self_config(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        config = ctrl._build_config()
        assert ctrl._config is config

    def test_build_config_missing_export_field_raises(self):
        """If _export_fields names an attribute that doesn't exist, _build_config raises."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _export_fields = ("nonexistent",)

        ctrl = BadControl()
        with pytest.raises(ValueError, match=r"nonexistent"):
            ctrl._build_config()

    def test_build_config_missing_export_field_names_control(self):
        """The error message names the declaring control and the offending field."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _export_fields = ("typo",)

        ctrl = BadControl()
        with pytest.raises(ValueError) as exc:
            ctrl._build_config()
        assert "BadControl" in str(exc.value)
        assert "'typo'" in str(exc.value)

    def test_build_config_missing_export_field_fails_fast(self):
        """Only the first missing field is reported; validation stops there."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _export_fields = ("alpha", "beta")

        ctrl = BadControl()
        with pytest.raises(ValueError) as exc:
            ctrl._build_config()
        assert "'alpha'" in str(exc.value)
        assert "'beta'" not in str(exc.value)

    def test_build_config_allows_none_value_export_field(self):
        """An exported field may legitimately be None (e.g. ExportControl.background)."""
        from foliplus.BaseControl import BaseControl

        class NullControl(BaseControl):
            _export_fields = ("nullable",)

            def __init__(self):
                super().__init__()
                self.nullable = None

        assert_config_block(NullControl(), {"nullable": None})

    def test_build_config_field_set_in_subclass_init(self):
        """Validation passes when _export_fields fields are set after super().__init__."""
        from foliplus.BaseControl import BaseControl

        class LateControl(BaseControl):
            _export_fields = ("late_value",)

            def __init__(self):
                super().__init__()
                self.late_value = 42

        assert_config_block(LateControl(), {"late_value": 42})

    def test_config_block_includes_locale_tables(self, base_map: folium.Map):
        from foliplus import SearchControl

        html = render_control(SearchControl(locale="en"))
        assert '"locale_code": "en"' in html
        assert '"locale_tables"' in html

    def test_config_block_does_not_pollute_config_cache(self):
        """_config_block copies _build_config before adding locale overlay."""
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        _ = ctrl._config_block
        assert "locale_tables" not in ctrl._config
        assert "locale_code" not in ctrl._config

    def test_export_fields_are_serialized_in_config(self):
        from foliplus import FullscreenControl

        assert_config_block(
            FullscreenControl(hide_self=False, hide_others=True),
            {"hide_self": False, "hide_others": True},
        )

    def test_extra_config_merged_into_build_config(self):
        import folium

        from foliplus import LayerControl

        m = folium.Map()
        ctrl = LayerControl()
        m.add_child(ctrl)
        config = ctrl._build_config()
        assert "data" in config
        assert isinstance(config["data"], list)

    def test_export_fields_shared_keys_extra_config_merge_order(self):
        """_build_config merge order: shared keys → export fields → extra_config.
        Later wins on conflicts."""
        from foliplus.BaseControl import BaseControl

        class OverrideControl(BaseControl):
            _export_fields = ("position",)

            def __init__(self):
                super().__init__(position="topleft")
                self.position = "overridden_by_export"

            def _extra_config(self):
                return {"position": "overridden_by_extra"}

        assert_config_block(OverrideControl(), {"position": "overridden_by_extra"})

    def test_default_locale_code_empty(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        assert ctrl._locale_code == ""

    def test_config_block_parses(self):
        """_config_block returns valid JSON with expected keys."""
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        parsed = json.loads(ctrl._config_block)
        assert parsed["name"] == "BaseControl"
        assert parsed["position"] == "topleft"
        assert "locale_tables" in parsed
        assert "locale_code" in parsed


class TestBaseControlRendering:
    """Rendering tests for shared assets and the merged stylesheet."""

    def test_includes_common_css(self, base_map: folium.Map):
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "--ctrl-bg" in html

    # ── BaseControl Python API ──

    def test_render_preserves_config(self, base_map: folium.Map):
        """After rendering, _config is still accessible and contains expected keys."""
        from foliplus import SearchControl

        ctrl = SearchControl(mode="coord", zoom=15)
        ctrl.add_to(base_map)
        render(base_map)
        assert ctrl._config["name"] == "SearchControl"
        assert ctrl._config["mode"] == "coord"
        assert ctrl._config["zoom"] == 15

    def test_render_multiple_controls_has_unique_configs(self, base_map: folium.Map):
        """Each control has its own _config cache after rendering."""
        from foliplus import FullscreenControl, SearchControl

        sc = SearchControl(mode="addr", zoom=10)
        fc = FullscreenControl(hide_self=False)
        sc.add_to(base_map)
        fc.add_to(base_map)
        render(base_map)
        assert sc._config["mode"] == "addr"
        assert fc._config["hide_self"] is False

    def test_includes_runtime_js(self, base_map: folium.Map):
        from foliplus import SearchControl

        html = render_control(SearchControl())
        # Locale tables are bundled once per map into window.foliplus._TABLES
        assert '"locale.name": "English"' in html
        assert '"locale.name": "中文"' in html

    def test_all_locale_tables_injected(self, base_map: folium.Map):
        """All locale tables are injected into HTML by BaseControl.py."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert '"locale.code":"en"' in html or '"locale.code": "en"' in html
        assert '"locale.code":"zh"' in html or '"locale.code": "zh"' in html

    def test_shared_assets_deduplicated(self, base_map: folium.Map):
        """Shared assets (runtime.js, the merged stylesheet, locale tables) are injected only once per map."""
        from foliplus import HeatmapControl, LayerControl, SearchControl

        SearchControl().add_to(base_map)
        LayerControl().add_to(base_map)
        HeatmapControl().add_to(base_map)

        html = render(base_map)
        # Shared locale tables table definition is injected exactly once
        assert html.count("window.foliplus._TABLES = {") == 1
        # Common CSS root custom properties definition is injected exactly once
        assert html.count("--ctrl-bg:") == 1

    # ── shared stylesheet design tokens ──

    def test_z_index_floating_css_variable(self, base_map: folium.Map):
        """--z-index-floating CSS custom property is defined in the shared stylesheet."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "--z-index-floating" in html
        assert "9990" in html

    def test_z_index_ladder_tokens(self, base_map: folium.Map):
        """The z-index ladder is fully tokenized in token.css (no magic numbers in components)."""
        css = read_css_dir("foliplus/css/common", "token.css")
        assert "--z-index-floating" in css
        assert "--z-index-hint" in css
        assert "--z-index-fullscreen" in css
        assert "--z-index-top" in css

    def test_ctrl_fold_classes(self, base_map: folium.Map):
        """ctrl-fold is a common pattern for expand/collapse panels."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "ctrl-fold" in html
        assert "collapsed" in html
        assert "expanded" in html

    def test_panel_structure_classes(self, base_map: folium.Map):
        """Shared panel scaffolding classes are present."""
        from foliplus import HeatmapControl

        html = render_control(HeatmapControl())
        assert "foliplus-panel" in html
        assert "foliplus-panel-header" in html
        assert "foliplus-panel-content" in html

    def test_button_focus_visible_rule(self, base_map: folium.Map):
        """The shared stylesheet includes a :focus-visible rule for all buttons."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert ":focus-visible" in html
        assert "foliplus-toggle-btn" in html

    def test_button_disabled_rule(self, base_map: folium.Map):
        """The shared stylesheet includes a :disabled rule for all buttons."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert ":disabled" in html
        assert "pointer-events: none" in html

    def test_panel_max_height_variable(self, base_map: folium.Map):
        """The shared stylesheet defines --panel-max-height."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "--panel-max-height" in html
        assert "panel-max-height" in html

    def test_unified_button_hover_border_radius(self, base_map: folium.Map):
        """Unified button hover rule includes border-radius."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "border-radius: var(--radius-sm)" in html

    def test_collapsed_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.collapsed uses --shadow-ctrl-strong (shared shadow for all collapsed controls)."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "shadow-ctrl-strong" in html
        # The shadow rule is in the shared stylesheet, not in component CSS
        assert "ctrl-fold.collapsed" in html

    def test_expanded_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.expanded uses --panel-shadow (shared shadow for all expanded controls)."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "panel-shadow" in html
        assert "ctrl-fold.expanded" in html


# ---------------------------------------------------------------------------
# Inline script escaping: both script emission sites (the per-control CONF line
# and the once-per-map _TABLES line) funnel through _safe_json, which is pinned
# directly here rather than re-derived through a full map render.
# Escaped forms are spelled with chr() so they survive shell heredoc mangling,
# and the two U+2028/U+2029 literals are always built from chr() rather than
# typed — a heredoc drops those code points.
# ---------------------------------------------------------------------------

# Closes the enclosing script tag and starts a new executable one.
PAYLOAD = "</script><script>window.__pwn=1</script>"

# How htmlsafe_json_dumps rewrites a script-closing tag: two backslash escapes.
ESCAPED = chr(92) + "u003c/script" + chr(92) + "u003e"

# JS line terminators: valid JSON, but written bare they would end the
# enclosing statement instead of staying inside the string.
LS = chr(0x2028)
PS = chr(0x2029)
LINE_TERMINATORS = f"A{LS}B{PS}C"
LS_ESCAPED = chr(92) + "u2028"
PS_ESCAPED = chr(92) + "u2029"


def _render_layer_map(layer_name: str) -> str:
    """Render a single-feature-group map with a foliplus LayerControl."""
    from foliplus import LayerControl

    m = folium.Map()
    folium.FeatureGroup(name=layer_name).add_to(m)
    LayerControl().add_to(m)
    return m.get_root().render()


class TestSafeJson:
    """The single serialization choke point behind both script tags."""

    def test_escapes_all_four_html_sensitive_characters(self):
        """<, >, &, ' are rewritten; none may reach the script tag raw."""
        from foliplus.BaseControl import _safe_json

        out = _safe_json({"n": "</script> & 'quoted'"})

        assert "<" not in out and ">" not in out
        assert "&" not in out and "'" not in out
        assert out == '{"n": "\\u003c/script\\u003e \\u0026 \\u0027quoted\\u0027"}'

    def test_escalines_line_terminators(self):
        """U+2028/U+2029 are emitted as \\uXXXX escapes, never literally."""
        from foliplus.BaseControl import _safe_json

        out = _safe_json({"n": LINE_TERMINATORS})

        assert LS not in out and PS not in out
        assert LS_ESCAPED in out and PS_ESCAPED in out
        # Escaping must be a spelling change only — the value is intact.
        assert json.loads(out) == {"n": LINE_TERMINATORS}

    def test_keeps_ascii_off_for_cjk(self):
        """CJK stays literal — ensure_ascii=False is deliberate, not incidental."""
        from foliplus.BaseControl import _safe_json

        out = _safe_json({"n": "中文图层"})

        assert "中文图层" in out
        assert "u4e2d" not in out

    def test_no_terminator_injection_on_clean_input(self):
        """The replace pass must not manufacture escapes for values that had none."""
        from foliplus.BaseControl import _safe_json

        out = _safe_json({"n": "plain text 中文 & <tag>"})

        assert "u2028" not in out and "u2029" not in out
        assert json.loads(out) == {"n": "plain text 中文 & <tag>"}

    def test_round_trips_every_json_type(self):
        """Numbers, booleans, None, lists and nesting survive the escaping."""
        from foliplus.BaseControl import _safe_json

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
        from foliplus.BaseControl import _safe_json

        assert type(_safe_json({"a": 1})) is str


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
        """The escaped filename recovers once the browser decodes the CONF line."""
        from foliplus import ExportControl

        m = folium.Map()
        ctrl = ExportControl(filename=PAYLOAD)
        m.add_child(ctrl)
        html = m.get_root().render()

        assert PAYLOAD not in html
        marker = "const CONF = "
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

    def test_tables_terminators_escaped(self):
        """The _TABLES line takes the U+2028 pass too — same choke point as CONF."""
        import tempfile

        from foliplus import locale
        from foliplus.locale import _load_tables

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
                from foliplus.BaseControl import _build_shared_header

                _build_shared_header.cache_clear()
                header = _build_shared_header()
                _build_shared_header.cache_clear()
            finally:
                locale._LOCALE_DIR = original_dir
                _load_tables.cache_clear()
                from foliplus.BaseControl import _build_shared_header

                _build_shared_header.cache_clear()

        assert LS not in header and PS not in header
        blob = header.split("window.foliplus._TABLES = ", 1)[1].split(";", 1)[0]
        assert json.loads(blob)["en"]["locale.name"] == LINE_TERMINATORS


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
