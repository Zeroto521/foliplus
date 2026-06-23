"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import LayerControl
from foliplus.locale import ZH


class TestLayerControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert LayerControl()._name == "LayerControl"

    def test_default_position(self):
        assert LayerControl().position == "topleft"

    def test_custom_position(self):
        assert LayerControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert LayerControl().locale.code == "en"

    def test_custom_locale(self):
        assert LayerControl(locale=ZH).locale.code == "zh"

    def test_inherits_draggable(self):
        """LayerControl inherits draggable from FoliumLayerControl."""
        ctrl = LayerControl()
        assert hasattr(ctrl, "draggable")
        assert ctrl.draggable is False


class TestLayerControlRendering:
    def test_default_params(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "enhanced-layer-ctrl" in html

    def test_color_layer_item(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "color-layer-item" in html
        assert "color-layer-input" in html
        assert "__color_map__" in html

    def test_color_layer_default_value(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "#cccccc" in html

    def test_separator_label(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer-separator-container" in html
        assert "separator-label" in html

    def test_public_api(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "registerLayer" in html
        assert "unregisterLayer" in html
        assert "getLayersByType" in html

    def test_color_layer_functions(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "_showColorLayer" in html
        assert "_hideColorLayer" in html

    def test_svg_icons_defined(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "SVGS.DRAG_HANDLE" in html
        assert "SVGS.GLOBE" in html
        assert "SVGS.POINT" in html
        assert "SVGS.LINE" in html
        assert "SVGS.POLYGON" in html

    def test_locale_zh(self, base_map: folium.Map):
        LayerControl(locale=ZH).add_to(base_map)
        html = render(base_map)
        assert "图层" in html
        assert "layer.panel_title" in html

    def test_position_renders(self, base_map: folium.Map):
        LayerControl(position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "bottomright" in html
