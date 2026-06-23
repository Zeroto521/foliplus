"""Tests for foliplus.MapSearch."""

from __future__ import annotations

import folium

from foliplus import MapSearch


class TestMapSearch:
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
        assert "SM.createLocationMarker" in html

    def test_addr_search_uses_fromWgs84(self, base_map: folium.Map):
        from conftest import render
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "SM.fromWgs84" in html
