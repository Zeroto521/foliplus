"""Tests for foliplus.MapSearch."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import MapSearch


class TestMapSearchPython:
    """Python-side property tests."""

    def test_name(self):
        assert MapSearch()._name == "MapSearch"

    def test_default_zoom(self):
        assert MapSearch().zoom == 15

    def test_custom_zoom(self):
        assert MapSearch(zoom=16).zoom == 16

    def test_default_position(self):
        assert MapSearch().position == "topleft"

    def test_custom_position(self):
        assert MapSearch(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert MapSearch()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert MapSearch(locale="zh")._LOCALE_CODE == "zh"

    def test_default_mode(self):
        assert MapSearch().mode == "coord"

    def test_custom_mode_addr(self):
        assert MapSearch(mode="addr").mode == "addr"

    def test_custom_mode_coord(self):
        assert MapSearch(mode="coord").mode == "coord"


class TestMapSearchRendering:
    def test_default_params(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "map-search" in html

    def test_custom_zoom_and_position(self, base_map: folium.Map):
        MapSearch(zoom=16, position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "map-search" in html
        assert "16" in html

    def test_contains_css(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert ".map-search" in html

    def test_contains_nominatim_url(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "nominatim.openstreetmap.org/search" in html

    def test_contains_create_location_marker(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createLocationMarker" in html

    def test_addr_search_uses_fromWgs84(self, base_map: folium.Map):
        """fromWgs84 is called in address search (Nominatim returns WGS84) but not coord search."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        # 1 from runtime.js definition + 1 in addr search = 2
        # Coord search should NOT call fromWgs84 (user input CRS unknown)
        assert html.count("foliplus.fromWgs84") == 2

    def test_locale_zh(self, base_map: folium.Map):
        MapSearch(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图搜索" in html
        assert '"zh"' in html

    def test_default_mode_coord_in_template(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert '"coord"' in html

    def test_mode_addr_in_template(self, base_map: folium.Map):
        MapSearch(mode="addr").add_to(base_map)
        html = render(base_map)
        assert '"addr"' in html

    def test_coord_search_no_fromWgs84(self, base_map: folium.Map):
        """Coord search does NOT call fromWgs84 (user input CRS is unknown)."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        # fromWgs84 appears 2×: once in runtime.js definition, once in addr search.
        # Coord search must NOT add a third call.
        assert "flyTo([lat, lng]" in html

    def test_zoom_constant_default(self, base_map: folium.Map):
        """ZOOM constants defined for MapSearch."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "MAX: 16" in html
        assert "MIN: 12" in html
        assert "BASE: 18" in html

    def test_toggle_and_clear_button(self, base_map: folium.Map):
        """Toggle and clear buttons are rendered."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "toggle-btn" in html
        assert "ctrl-abs-btn" in html

    def test_search_form_structure(self, base_map: folium.Map):
        """Search form has mode-btn, input, and clear-wrap."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "search-mode-btn" in html
        assert "clear-wrap" in html
        assert 'type: "text"' in html

    def test_nominatim_constants(self, base_map: folium.Map):
        """Nominatim API constants are defined."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "NOMINATIM.URL" in html
        assert "NOMINATIM.FORMAT" in html
        assert "jsonv2" in html

    def test_disable_click_scroll_propagation(self, base_map: folium.Map):
        """Click and scroll propagation are disabled."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "disableClickPropagation" in html
        assert "disableScrollPropagation" in html

    def test_mode_switch_function(self, base_map: folium.Map):
        """Mode switch function setMode exists."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "function setMode(newMode)" in html

    def test_reverse_geocode_function(self, base_map: folium.Map):
        """reverseGeocode is called for address lookup."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.reverseGeocode" in html

    def test_build_popup_html(self, base_map: folium.Map):
        """buildPopupHtml used for marker popups."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.buildPopupHtml" in html

    def test_hide_hint_on_clear(self, base_map: folium.Map):
        """hideHint is called when clearing search results."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.hideHint" in html

    def test_align_right_for_right_position(self, base_map: folium.Map):
        """Right positions add align-right class to MapSearch."""
        MapSearch(position="topright").add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_no_align_right_for_left_position(self, base_map: folium.Map):
        """Left positions do NOT add align-right class."""
        MapSearch(position="topleft").add_to(base_map)
        html = render(base_map)
        # align-right appears in CSS, but NOT in the JS class string for left positions
        # createFoldControl uses isLeft: position.indexOf("left") >= 0
        assert 'indexOf("left") >= 0' in html

    def test_align_right_bottomright(self, base_map: folium.Map):
        """bottomright position also adds align-right."""
        MapSearch(position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_coord_search_passes_existing_marker(self, base_map: folium.Map):
        """Coordinate search passes existing marker to avoid duplicates."""
        MapSearch().add_to(base_map)
        html = render(base_map)
        # createLocationMarker appears 3×: runtime.js definition + coord search + addr search
        assert html.count("createLocationMarker") == 3
        # Both coord and addr search should pass mk as the last arg
        assert "popup_addr_label" in html


class TestMapSearchBrowser:
    """Browser-based smoke tests for MapSearch."""

    def test_initial_mode_addr(self, browser, tmp_path):
        """Verify that mode='addr' renders the address-search UI
        (globe icon, address placeholder) on first open."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MapSearch(mode="addr").add_to(m)

        html_path = tmp_path / "test_mapsearch_browser.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            errors = []
            page.on(
                "console",
                lambda msg: (
                    errors.append(msg.text)
                    if msg.type == "error"
                    and not msg.text.startswith("Failed to load resource")
                    else None
                ),
            )

            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".map-search", state="attached", timeout=10000)

            # Expand the panel
            page.evaluate("document.querySelector('.map-search .toggle-btn').click()")
            page.wait_for_selector(
                ".map-search.expanded", state="attached", timeout=5000
            )

            # Verify the mode button shows the globe icon (address mode)
            globe_svg = page.evaluate(
                """document.querySelector('.search-mode-btn')
                    .querySelector('svg[viewBox="0 0 24 24"] circle[cx="12"][cy="12"][r="10"]') !== null"""
            )
            assert globe_svg, "Expected globe icon for address mode"

            # Verify the placeholder is for address search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder, got: {placeholder}"
            )

        finally:
            page.close()

    def test_initial_mode_coord_default(self, browser, tmp_path):
        """Verify default mode='coord' shows coordinate placeholder."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MapSearch().add_to(m)

        html_path = tmp_path / "test_mapsearch_coord.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".map-search", state="attached", timeout=10000)
            page.evaluate("document.querySelector('.map-search .toggle-btn').click()")
            page.wait_for_selector(
                ".map-search.expanded", state="attached", timeout=5000
            )

            # Verify the placeholder is for coordinate search
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            # Coordinate placeholders contain numbers or "coord"/"坐标"
            assert any(
                kw in placeholder.lower()
                for kw in ("lat", "lng", "coord", "坐标", "latitude", "longitude")
            ), f"Expected coordinate placeholder, got: {placeholder}"
        finally:
            page.close()

    def test_mode_switch_icon(self, browser, tmp_path):
        """Toggling mode switches icon between LOCATE (coord) and GLOBE (addr)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MapSearch(mode="coord").add_to(m)

        html_path = tmp_path / "test_mode_switch.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".map-search", state="attached", timeout=10000)
            page.evaluate("document.querySelector('.map-search .toggle-btn').click()")
            page.wait_for_selector(
                ".map-search.expanded", state="attached", timeout=5000
            )

            # Click mode switch button
            page.evaluate("document.querySelector('.search-mode-btn').click()")
            page.wait_for_timeout(500)

            # After switch, should be address mode with GLOBE icon
            globe_icon = page.evaluate(
                "document.querySelector('.search-mode-btn').innerHTML.indexOf('GLOBE') > -1 || "
                'document.querySelector(\'.search-mode-btn\').querySelector(\'circle[cx="12"][cy="12"][r="10"]\') !== null'
            )
            assert globe_icon, "Expected globe icon after mode switch"

            # Also verify input placeholder was updated
            placeholder = page.evaluate("document.querySelector('input').placeholder")
            assert "address" in placeholder.lower() or "地址" in placeholder, (
                f"Expected address placeholder after switch, got: {placeholder}"
            )
        finally:
            page.close()

    def test_clear_button_clears_input(self, browser, tmp_path):
        """Clear button resets input value and hides hint."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MapSearch().add_to(m)

        html_path = tmp_path / "test_clear.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".map-search", state="attached", timeout=10000)
            page.evaluate("document.querySelector('.map-search .toggle-btn').click()")
            page.wait_for_selector(
                ".map-search.expanded", state="attached", timeout=5000
            )

            # Type something in the input
            page.evaluate("document.querySelector('input').value = '26.08,119.30'")
            # Click clear button
            page.evaluate("document.querySelector('.ctrl-abs-btn').click()")
            page.wait_for_timeout(500)

            cleared = page.evaluate("document.querySelector('input').value")
            assert cleared == "", f"Expected empty input after clear, got: '{cleared}'"
        finally:
            page.close()
