"""Tests for foliplus.BaseControl — the Python ↔ JS bridge layer.

Boundary rule: this file only verifies the PY↔JS bridge — shared CSS/JS assets
injection, locale table injection, and shared-resource deduplication. JS
function presence and internal logic are covered by test/js/ unit tests.
"""

from __future__ import annotations

import folium
from conftest import render


class TestBaseControlRendering:
    def test_includes_common_css(self, base_map: folium.Map):
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "--ctrl-bg" in html

    def test_includes_runtime_js(self, base_map: folium.Map):
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        # Locale tables are bundled once per map into window.foliplus._TABLES
        assert '"locale.name": "English"' in html
        assert '"locale.name": "中文"' in html

    def test_all_locale_tables_injected(self, base_map: folium.Map):
        """All locale tables are injected into HTML by BaseControl.py."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
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

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "--z-index-floating" in html
        assert "9990" in html

    def test_ctrl_fold_classes(self, base_map: folium.Map):
        """ctrl-fold is a common pattern for expand/collapse panels."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "ctrl-fold" in html
        assert "collapsed" in html
        assert "expanded" in html

    def test_panel_structure_classes(self, base_map: folium.Map):
        """Shared panel scaffolding classes are present."""
        from foliplus import HeatmapControl

        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-panel" in html
        assert "foliplus-panel-header" in html
        assert "foliplus-panel-content" in html

    def test_button_focus_visible_rule(self, base_map: folium.Map):
        """common.css includes :focus-visible rule for all buttons."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert ":focus-visible" in html
        assert "foliplus-toggle-btn" in html

    def test_button_disabled_rule(self, base_map: folium.Map):
        """common.css includes :disabled rule for all buttons."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert ":disabled" in html
        assert "pointer-events: none" in html

    def test_panel_max_height_variable(self, base_map: folium.Map):
        """common.css defines --panel-max-height."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "--panel-max-height" in html
        assert "panel-max-height" in html

    def test_unified_button_hover_border_radius(self, base_map: folium.Map):
        """Unified button hover rule includes border-radius."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "border-radius: var(--radius-sm)" in html

    def test_collapsed_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.collapsed uses --shadow-ctrl-strong (shared shadow for all collapsed controls)."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "shadow-ctrl-strong" in html
        # The shadow rule is in common.css, not in component CSS
        assert "ctrl-fold.collapsed" in html

    def test_expanded_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.expanded uses --panel-shadow (shared shadow for all expanded controls)."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "panel-shadow" in html
        assert "ctrl-fold.expanded" in html
