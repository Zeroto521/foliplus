"""Tests for foliplus.BaseControl — the Python ↔ JS bridge layer.

Boundary rule: this file only verifies the PY↔JS bridge — shared CSS/JS assets
injection, locale table injection, and shared-resource deduplication. JS
function presence and internal logic are covered by test/js/ unit tests.
"""

from __future__ import annotations

import json

import folium
import pytest
from conftest import assert_config_block, render, render_control


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

    def test_build_config_caches_on_self_config(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        config = ctrl._build_config()
        assert ctrl._config is config

    def test_build_config_missing_export_field_raises(self):
        """If _export_fields names an attribute that doesn't exist, getattr raises."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _export_fields = ("nonexistent",)

        ctrl = BadControl()
        with pytest.raises(AttributeError):
            ctrl._build_config()

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
    """Rendering tests for shared assets and common.css."""

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
        """Shared assets (runtime.js, common.css, locale tables) are injected only once per map."""
        from foliplus import HeatmapControl, LayerControl, SearchControl

        SearchControl().add_to(base_map)
        LayerControl().add_to(base_map)
        HeatmapControl().add_to(base_map)

        html = render(base_map)
        # Shared locale tables table definition is injected exactly once
        assert html.count("window.foliplus._TABLES = {") == 1
        # Common CSS root custom properties definition is injected exactly once
        assert html.count("--ctrl-bg:") == 1

    # ── common.css design tokens ──

    def test_z_index_floating_css_variable(self, base_map: folium.Map):
        """--z-index-floating CSS custom property is defined in common.css."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "--z-index-floating" in html
        assert "9990" in html

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
        """common.css includes :focus-visible rule for all buttons."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert ":focus-visible" in html
        assert "foliplus-toggle-btn" in html

    def test_button_disabled_rule(self, base_map: folium.Map):
        """common.css includes :disabled rule for all buttons."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert ":disabled" in html
        assert "pointer-events: none" in html

    def test_panel_max_height_variable(self, base_map: folium.Map):
        """common.css defines --panel-max-height."""
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
        # The shadow rule is in common.css, not in component CSS
        assert "ctrl-fold.collapsed" in html

    def test_expanded_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.expanded uses --panel-shadow (shared shadow for all expanded controls)."""
        from foliplus import SearchControl

        html = render_control(SearchControl())
        assert "panel-shadow" in html
        assert "ctrl-fold.expanded" in html
