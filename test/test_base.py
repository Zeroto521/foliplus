"""Tests for foliplus.base — BaseControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import MapSearch


class TestBaseControlRendering:
    def test_includes_shared_css(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "--ctrl-bg" in html

    def test_includes_shared_js(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "_LOCALE" in html
