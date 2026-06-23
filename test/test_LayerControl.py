"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import folium

from foliplus import LayerControl


class TestLayerControl:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "enhanced-layer-ctrl" in html

    def test_color_layer_item(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "color-layer-item" in html
        assert "color-layer-input" in html
        assert "__color_map__" in html

    def test_color_layer_default_value(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "#cccccc" in html

    def test_separator_label(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer-separator-container" in html
        assert "separator-label" in html

    def test_public_api(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "registerLayer" in html
        assert "unregisterLayer" in html
        assert "getLayersByType" in html

    def test_color_layer_functions(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "_showColorLayer" in html
        assert "_hideColorLayer" in html

    def test_svg_icons_defined(self, base_map: folium.Map):
        from conftest import render
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "SVGS.DRAG_HANDLE" in html
        assert "SVGS.GLOBE" in html
        assert "SVGS.POINT" in html
        assert "SVGS.LINE" in html
        assert "SVGS.POLYGON" in html
