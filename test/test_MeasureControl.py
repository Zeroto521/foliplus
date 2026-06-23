"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import folium

from foliplus import MeasureControl
from foliplus.locale import ZH


class TestMeasureControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert MeasureControl()._name == "MeasureControl"

    def test_default_position(self):
        assert MeasureControl().position == "bottomright"

    def test_custom_position(self):
        assert MeasureControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert MeasureControl().locale.code == "en"

    def test_custom_locale(self):
        assert MeasureControl(locale=ZH).locale.code == "zh"


class TestMeasureControlRendering:
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

    def test_locale_zh(self, base_map: folium.Map):
        from conftest import render
        MeasureControl(locale=ZH).add_to(base_map)
        html = render(base_map)
        assert "量算工具" in html
        assert "measure.tool_toggle" in html
