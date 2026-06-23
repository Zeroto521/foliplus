"""Tests for foliplus.base — BaseControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import MapSearch
from foliplus.locale import ZH


class TestBaseControl:
    def test_default_position(self):
        ctrl = MapSearch()
        assert ctrl.position == "topleft"

    def test_custom_position(self):
        ctrl = MapSearch(position="bottomright")
        assert ctrl.position == "bottomright"

    def test_default_locale(self):
        ctrl = MapSearch()
        assert ctrl.locale.code == "en"

    def test_custom_locale(self):
        ctrl = MapSearch(locale=ZH)
        assert ctrl.locale.code == "zh"

    def test_class_name_set(self):
        ctrl = MapSearch()
        assert ctrl._name == "MapSearch"


class TestBaseControlRendering:
    def test_includes_shared_css(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "--ctrl-bg" in html

    def test_includes_shared_js(self, base_map: folium.Map):
        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "_LOCALE" in html
