"""Tests for foliplus.ScaleControl."""

from __future__ import annotations

import folium
import pytest
from conftest import render

from foliplus import ScaleControl


class TestScaleControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ScaleControl()._name == "ScaleControl"

    def test_default_position(self):
        assert ScaleControl().position == "bottomleft"

    def test_custom_position(self):
        with pytest.raises(TypeError):
            ScaleControl(position="topright")

    def test_default_locale(self):
        assert ScaleControl()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert ScaleControl(locale="zh")._LOCALE_CODE == "zh"

    def test_default_params(self):
        ctrl = ScaleControl()
        assert ctrl.metric is True
        assert ctrl.show_zoom is True

    def test_custom_params(self):
        ctrl = ScaleControl(metric=False, show_zoom=False)
        assert ctrl.metric is False
        assert ctrl.show_zoom is False


class TestScaleControlRendering:
    def test_default_params(self, base_map: folium.Map):
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "scale-wrap" in html

    def test_metric_default(self, base_map: folium.Map):
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "metric" in html.lower()

    def test_metric_false_still_renders(self, base_map: folium.Map):
        ScaleControl(metric=False).add_to(base_map)
        html = render(base_map)
        assert "leaflet-control-scale" in html

    def test_show_zoom(self, base_map: folium.Map):
        ScaleControl(show_zoom=True).add_to(base_map)
        html = render(base_map)
        assert "scale-zoom-label" in html
        assert "zoomend" in html

    def test_hide_zoom(self, base_map: folium.Map):
        ScaleControl(show_zoom=False).add_to(base_map)
        html = render(base_map)
        assert "const zoomLabel" not in html
        assert "zoomend" not in html

    def test_locale_zh(self, base_map: folium.Map):
        ScaleControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图层级" in html
        assert "ScaleControl.zoom_label" in html

    def test_imperial_false_in_output(self, base_map: folium.Map):
        """Scale control outputs imperial: false."""
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "imperial: false" in html

    def test_metric_false_disables_metric(self, base_map: folium.Map):
        """metric=false correctly passed to Leaflet."""
        ScaleControl(metric=False).add_to(base_map)
        html = render(base_map)
        assert "metric: false" in html
