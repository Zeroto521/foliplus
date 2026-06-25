"""Tests for foliplus.MapSearch."""

from __future__ import annotations

import folium

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


class TestMapSearchRendering:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "map-search" in html

    def test_custom_zoom_and_position(self, base_map: folium.Map):
        from conftest import render

        MapSearch(zoom=16, position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "map-search" in html
        assert "16" in html

    def test_contains_css(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert ".map-search" in html

    def test_contains_search_mode_button(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "search-mode-btn" in html

    def test_contains_nominatim_url(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "nominatim.openstreetmap.org/search" in html

    def test_contains_create_location_marker(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.createLocationMarker" in html

    def test_addr_search_uses_fromWgs84(self, base_map: folium.Map):
        from conftest import render

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.fromWgs84" in html

    def test_locale_zh(self, base_map: folium.Map):
        from conftest import render

        MapSearch(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图搜索" in html
        assert '"zh"' in html
