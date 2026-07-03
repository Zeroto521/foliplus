"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import ExportControl


class TestExportControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ExportControl()._name == "ExportControl"

    def test_default_position(self):
        assert ExportControl().position == "bottomright"

    def test_custom_position(self):
        assert ExportControl(position="topleft").position == "topleft"

    def test_default_args(self):
        ctrl = ExportControl()
        assert ctrl.filename == "map.png"
        assert ctrl.scale == 2.0
        assert ctrl.background is None
        assert ctrl.timeout == 7500

    def test_custom_args(self):
        ctrl = ExportControl(
            filename="my_map.png",
            scale=3.5,
            background="#ffffff",
            timeout=10000,
        )
        assert ctrl.filename == "my_map.png"
        assert ctrl.scale == 3.5
        assert ctrl.background == "#ffffff"
        assert ctrl.timeout == 10000


class TestExportControlRendering:
    def test_default_params(self, base_map: folium.Map):
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "html2canvas" in html
        assert "exportManager" in html

    def test_custom_params_rendering(self, base_map: folium.Map):
        ExportControl(
            filename="custom.png",
            scale=1.5,
            background="#000000",
            timeout=5000,
        ).add_to(base_map)
        html = render(base_map)
        assert "custom.png" in html
        assert "1.5" in html
        assert "#000000" in html
        assert "5000" in html
