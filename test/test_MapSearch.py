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
