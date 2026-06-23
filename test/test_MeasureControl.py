"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import folium

from foliplus import MeasureControl


class TestMeasureControl:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ctrl" in html

    def test_custom_position(self, base_map: folium.Map):
        from conftest import render
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "topleft" in html

    def test_contains_gcoord_dependency(self, base_map: folium.Map):
        from conftest import render
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "gcoord" in html

    def test_contains_tool_buttons(self, base_map: folium.Map):
        from conftest import render
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert "data-mode" in html
