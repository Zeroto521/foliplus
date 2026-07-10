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
        assert "LeafletRenderer" in html
        assert "exportManager" in html
        assert "ctrl-fold" in html
        assert "STORAGE_KEY" in html
        assert "_saveBounds" in html
        assert "_loadSavedBounds" in html
        assert "export-crop-actions" in html

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

    def test_crop_features(self, base_map: folium.Map):
        """Verify crop box structures: handles, center, toggle behavior."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "export-crop-handle" in html
        assert "export-crop-center" in html
        assert "export-crop-box" in html
        assert "export-crop-overlay" in html
        assert "showCropBox" in html
        assert "lockCropBox" in html
        assert "unlockCropBox" in html
        assert "removeCropBox" in html
        assert "8-way" in html or "tl" in html

    def test_hooks_and_events(self, base_map: folium.Map):
        """Key event and lifecycle hooks are present."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "bindOutsideCollapse" in html
        assert "getBoundingClientRect" in html
        assert "containerPointToLatLng" in html
        assert "Object.assign" in html

    def test_create_fold_shared(self, base_map: folium.Map):
        """Uses shared createFoldControl helper from runtime."""
        ExportControl().add_to(base_map)
        html = render(base_map)
        assert "createFoldControl" in html
        assert "ctrl-fold" in html
