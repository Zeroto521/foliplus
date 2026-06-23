"""Tests for foliplus.ScaleControl."""

from __future__ import annotations

import folium

from foliplus import ScaleControl


class TestScaleControl:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "custom-scale-wrap" in html

    def test_metric_imperial(self, base_map: folium.Map):
        from conftest import render
        ScaleControl(metric=True, imperial=True).add_to(base_map)
        html = render(base_map)
        assert "true" in html.lower()

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
