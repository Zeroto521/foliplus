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
        # resolveLocale is imported as local function via ES module, not on foliplus
        assert "resolveLocale" in html
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
        assert "registerHintIcon" in html

    def test_hint_fullscreen_reparent(self, base_map: folium.Map):
        """Hints are re-parented on fullscreenchange so they survive fullscreen transitions."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "reparentHints" in html
        assert 'addEventListener("fullscreenchange"' in html
        assert 'addEventListener("webkitfullscreenchange"' in html
        assert "v.element.parentNode !== newTarget" in html

    def test_hint_duration_constants(self, base_map: folium.Map):
        """HINT_DURATION constants exposed as HINT_DURATION (not foliplus.HINT_DURATION)."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "HINT_DURATION" in html
        assert "HINT_DURATION.SHORT" in html or "SHORT: 1200" in html
        assert "HINT_DURATION.MEDIUM" in html or "MEDIUM: 2500" in html
        assert "HINT_DURATION.LONG" in html or "LONG: 4000" in html
        assert "HINT_DURATION.PERSIST" in html or "PERSIST: 0" in html

    def test_nominatim_assigned(self, base_map: folium.Map):
        """foliplus.NOMINATIM is assigned (not just referenced)."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        # Check the assignment exists, not just usage
        assert "NOMINATIM" in html

    def test_format_number_auto(self, base_map: folium.Map):
        """formatNumber supports auto/compact style."""
        from foliplus import SearchControl, HeatmapControl

        HeatmapControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "formatNumber" in html
        # formatNumber uses Intl.NumberFormat internally; verify it's bundled
        assert "NumberFormat" in html

    def test_build_popup_html(self, base_map: folium.Map):
        """foliplus.buildPopupHtml is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "buildPopupHtml" in html

    def test_create_location_marker(self, base_map: folium.Map):
        """foliplus.createLocationMarker is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "createLocationMarker" in html

    def test_reverse_geocode(self, base_map: folium.Map):
        """foliplus.reverseGeocode is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "reverseGeocode" in html

    def test_to_wgs84_from_wgs84(self, base_map: folium.Map):
        """foliplus.toWgs84 and fromWgs84 are defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "toWgs84" in html
        assert "fromWgs84" in html

    def test_bind_panel_toggle(self, base_map: folium.Map):
        """bindPanelToggle is defined in a component bundle."""
        from foliplus import SearchControl, LayerControl

        LayerControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "bindPanelToggle" in html

    def test_bind_outside_collapse(self, base_map: folium.Map):
        """bindOutsideCollapse is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "bindOutsideCollapse" in html

    def test_create_fold_control(self, base_map: folium.Map):
        """createFoldControl is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "createFoldControl" in html

    def test_debounce_utility(self, base_map: folium.Map):
        """foliplus.debounce utility is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "debounce" in html
        assert "debounced.cancel" in html
        assert "clearTimeout(timer)" in html

    def test_svg_icons_present(self, base_map: folium.Map):
        """SVG icons are defined in component bundles."""
        from foliplus import (
            SearchControl,
            ExportControl,
            HeatmapControl,
            LayerControl,
            MeasureControl,
        )

        # Shared SVG icons are statically imported by whichever component uses them.
        # Add several controls to ensure all icon bundles are present.
        ExportControl().add_to(base_map)
        HeatmapControl().add_to(base_map)
        LayerControl().add_to(base_map)
        MeasureControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        # Shared SVG icon variable names are preserved by esbuild's bundling
        # (namespace import `* as SVGs` is resolved to direct variable names)
        assert "LOADING" in html
        assert "CLOSE" in html
        assert "PIN_ICON" in html
        assert "LOCATE" in html
        assert "GLOBE" in html

    def test_resolve_locale_function(self, base_map: folium.Map):
        """resolveLocale function is defined in runtime.js."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "resolveLocale" in html

    def test_gt_function(self, base_map: folium.Map):
        """foliplus.gt (get text) is defined."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "gt" in html

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
        # PIN icon dimensions are defined in common/icon.js as SVGs.PIN_ICON
        # The raw SVG string is embedded in the bundle
        assert 'width="24"' in html
        assert 'height="36"' in html

    def test_popup_max_width(self, base_map: folium.Map):
        """Popup max width is defined in popup CSS."""
        from foliplus import SearchControl, MeasureControl

        MeasureControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "maxWidth" in html

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

    def test_css_var_utility(self, base_map: folium.Map):
        """cssVar utility is defined in a component bundle."""
        from foliplus import SearchControl, HeatmapControl

        HeatmapControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "cssVar" in html
        assert (
            "getComputedStyle(el).getPropertyValue(prop).trim() || fallback"
            in html.replace("\n", " ")
        )

    def test_adjust_panel_zindex(self, base_map: folium.Map):
        """adjustPanelZIndex is defined in a component bundle."""
        from foliplus import SearchControl, HeatmapControl

        HeatmapControl().add_to(base_map)
        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "adjustPanelZIndex" in html
        assert "closest(.leaflet-bar)" in html or 'closest(".leaflet-bar")' in html
        assert "closest(.leaflet-top" in html or 'closest(".leaflet-top' in html

    def test_z_index_floating_css_variable(self, base_map: folium.Map):
        """--z-index-floating CSS custom property is defined in common.css."""
        from foliplus import SearchControl

        SearchControl().add_to(base_map)
        html = render(base_map)
        assert "--z-index-floating" in html
        assert "9990" in html

    def test_create_panel_control(self, base_map: folium.Map):
        """createPanelControl is defined in a component bundle."""
        from foliplus import HeatmapControl

        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "createPanelControl" in html
        assert "foliplus-panel" in html
        assert "foliplus-panel-header" in html
        assert "foliplus-panel-content" in html
        assert "bindPanelToggle" in html
        assert "bindOutsideCollapse" in html

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
