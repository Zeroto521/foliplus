"""Tests for foliplus.BaseControl — BaseControl."""

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
        assert "foliplus.resolveLocale(" in html
        # Locale tables are bundled once per map into window.foliplus._TABLES
        assert '"locale.name": "English"' in html
        assert '"locale.name": "中文"' in html

    def test_hint_system(self, base_map: folium.Map):
        """Hint system functions are present in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.showHint" in html
        assert "foliplus.hideHint" in html
        assert "foliplus.registerHintIcon" in html

    def test_hint_duration_constants(self, base_map: folium.Map):
        """HINT_DURATION constants exposed as foliplus.HINT_DURATION."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.HINT_DURATION" in html
        assert "HINT.SHORT" in html
        assert "HINT.MEDIUM" in html
        assert "HINT.LONG" in html
        assert "HINT.PERSIST" in html

    def test_nominatim_assigned(self, base_map: folium.Map):
        """foliplus.NOMINATIM is assigned (not just referenced)."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        # Check the assignment exists, not just usage
        assert "foliplus.NOMINATIM = {" in html

    def test_format_number_auto(self, base_map: folium.Map):
        """foliplus.formatNumber supports auto/compact style."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.formatNumber" in html
        assert "Intl.NumberFormat" in html
        assert "compactDisplay" in html

    def test_build_popup_html(self, base_map: folium.Map):
        """foliplus.buildPopupHtml is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.buildPopupHtml" in html

    def test_create_location_marker(self, base_map: folium.Map):
        """foliplus.createLocationMarker is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createLocationMarker" in html

    def test_reverse_geocode(self, base_map: folium.Map):
        """foliplus.reverseGeocode is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.reverseGeocode" in html

    def test_to_wgs84_from_wgs84(self, base_map: folium.Map):
        """foliplus.toWgs84 and fromWgs84 are defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.toWgs84" in html
        assert "foliplus.fromWgs84" in html

    def test_bind_panel_toggle(self, base_map: folium.Map):
        """bindPanelToggle is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.bindPanelToggle" in html

    def test_bind_outside_collapse(self, base_map: folium.Map):
        """bindOutsideCollapse is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.bindOutsideCollapse" in html

    def test_create_fold_control(self, base_map: folium.Map):
        """createFoldControl is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createFoldControl" in html

    def test_debounce_utility(self, base_map: folium.Map):
        """foliplus.debounce utility is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.debounce" in html
        assert "debounced.cancel" in html
        assert "clearTimeout(timer)" in html

    def test_svg_icons_present(self, base_map: folium.Map):
        """All SVG icons are defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.SVGs.LOADING" in html or "SVGs.LOADING" in html
        assert "foliplus.SVGs.CLOSE" in html or "SVGs.CLOSE" in html
        assert "foliplus.SVGs.PIN_ICON" in html or "SVGs.PIN_ICON" in html
        assert "foliplus.SVGs.LOCATE" in html or "SVGs.LOCATE" in html
        assert "foliplus.SVGs.GLOBE" in html or "SVGs.GLOBE" in html

    def test_resolve_locale_function(self, base_map: folium.Map):
        """resolveLocale function is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.resolveLocale" in html

    def test_gt_function(self, base_map: folium.Map):
        """foliplus.gt (get text) is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.gt" in html

    def test_ctrl_fold_classes(self, base_map: folium.Map):
        """ctrl-fold is a common pattern for expand/collapse panels."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "ctrl-fold" in html
        assert "collapsed" in html
        assert "expanded" in html

    def test_pin_icon_dimensions(self, base_map: folium.Map):
        """PIN icon dimensions are defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "SIZE: [24, 36]" in html
        assert "ANCHOR: [12, 36]" in html
        assert "POPUP_ANCHOR: [0, -36]" in html

    def test_popup_max_width(self, base_map: folium.Map):
        """Popup max width is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "MAX_WIDTH: 300" in html

    def test_gcoord_detection_helpers(self, base_map: folium.Map):
        """Coordinate detection helpers exist."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "isBaiduCRS" in html
        assert "isDomesticMap" in html

    def test_geo_cache_and_throttle(self, base_map: folium.Map):
        """Reverse geocode has cache and throttle logic."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "geoCache" in html
        assert "THROTTLE_MS" in html

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
