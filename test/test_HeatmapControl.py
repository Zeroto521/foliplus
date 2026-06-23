"""Tests for foliplus.HeatmapControl."""

from __future__ import annotations

import folium

from foliplus import HeatmapControl


class TestHeatmapControl:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap-ctrl" in html

    def test_custom_color_scheme(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(color_scheme="Reds").add_to(base_map)
        html = render(base_map)
        assert "Reds" in html

    def test_custom_method(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(method="quantile").add_to(base_map)
        html = render(base_map)
        assert "quantile" in html

    def test_custom_agg(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(agg="sum").add_to(base_map)
        html = render(base_map)
        assert "sum" in html

    def test_custom_n_classes(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(n_classes=4).add_to(base_map)
        html = render(base_map)
        assert "4" in html

    def test_contains_h3_dependency(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "h3-js@4" in html

    def test_contains_ss_dependency(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "simple-statistics" in html

    def test_contains_chroma_dependency(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "chroma-js" in html

    def test_custom_schemes(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(schemes=["Reds", "Blues"]).add_to(base_map)
        html = render(base_map)
        assert "Reds" in html
        assert "Blues" in html

    def test_custom_style(self, base_map: folium.Map):
        from conftest import render
        HeatmapControl(
            style={"border_weight": 2.0, "label_show": False}
        ).add_to(base_map)
        html = render(base_map)
        assert "2.0" in html or "2" in html
        assert "false" in html.lower()
