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
        assert MapSearch().locale.code == "en"

    def test_custom_locale(self):
        assert MapSearch(locale="zh").locale.code == "zh"

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

    def test_contains_search_mode_button(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "search-mode-btn" in html

    def test_contains_nominatim_url(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "nominatim.openstreetmap.org/search" in html

    def test_contains_create_location_marker(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createLocationMarker" in html

    def test_addr_search_uses_fromWgs84(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.fromWgs84" in html

    def test_locale_zh(self, base_map: folium.Map):
        MapSearch(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图搜索" in html
        assert '"zh"' in html

    def test_default_mode_coord_in_template(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "'coord'" in html

    def test_mode_addr_in_template(self, base_map: folium.Map):
        MapSearch(mode="addr").add_to(base_map)
        html = render(base_map)
        assert "'addr'" in html

    def test_mode_coord_in_template(self, base_map: folium.Map):
        MapSearch(mode="coord").add_to(base_map)
        html = render(base_map)
        assert "'coord'" in html


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
