"""Tests for foliplus.ScaleControl."""

from __future__ import annotations

import folium

from foliplus import ScaleControl
from foliplus.locale import ZH


class TestScaleControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ScaleControl()._name == "ScaleControl"

    def test_default_position(self):
        assert ScaleControl().position == "bottomleft"

    def test_custom_position(self):
        assert ScaleControl(position="topright").position == "topright"

    def test_default_locale(self):
        assert ScaleControl().locale.code == "en"

    def test_custom_locale(self):
        assert ScaleControl(locale=ZH).locale.code == "zh"

    def test_default_metric_imperial(self):
        ctrl = ScaleControl()
        assert ctrl.metric is True
        assert ctrl.imperial is False
        assert ctrl.show_zoom is True

    def test_custom_metric_imperial(self):
        ctrl = ScaleControl(metric=False, imperial=True, show_zoom=False)
        assert ctrl.metric is False
        assert ctrl.imperial is True
        assert ctrl.show_zoom is False


class TestScaleControlRendering:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "custom-scale-wrap" in html

    def test_metric_imperial_both(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(metric=True, imperial=True).add_to(base_map)
        html = render(base_map)
        assert "metric" in html.lower() and "imperial" in html.lower()

    def test_metric_only(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(metric=True, imperial=False).add_to(base_map)
        html = render(base_map)
        assert "metric" in html.lower()
        assert "imperial" in html.lower()

    def test_imperial_only(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(metric=False, imperial=True).add_to(base_map)
        html = render(base_map)
        assert "imperial" in html.lower()

    def test_show_zoom(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(show_zoom=True).add_to(base_map)
        html = render(base_map)
        assert "scale-zoom-label" in html
        assert "zoomend" in html

    def test_hide_zoom(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(show_zoom=False).add_to(base_map)
        html = render(base_map)
        assert "const zoomLabel" not in html
        assert "zoomend" not in html

    def test_locale_zh(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(locale=ZH).add_to(base_map)
        html = render(base_map)
        assert "地图层级" in html
        assert "scale.zoom_label" in html
