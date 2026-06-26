"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import folium

from foliplus import MeasureControl


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
        assert MeasureControl(locale="zh").locale.code == "zh"


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
        assert "gcoord.global.prod.js" in html

    def test_contains_tool_buttons(self, base_map: folium.Map):
        from conftest import render

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert "data-mode" in html

    def test_locale_zh(self, base_map: folium.Map):
        from conftest import render

        MeasureControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "量算工具" in html
        assert "measure.tool_toggle" in html

    def test_bring_to_front_on_circle_marker(self, base_map: folium.Map):
        """CircleMarkers call bringToFront() after creation (not in onAdd override)."""
        from conftest import render

        MeasureControl().add_to(base_map)
        html = render(base_map)
        # bringToFront should appear after circleMarker creation calls
        assert (
            "mkr.bringToFront()" in html
            or "previews.node.bringToFront()" in html
            or "radiusNode.bringToFront()" in html
        )
        # Old onAdd override should NOT exist
        assert "origOnAdd(map)" not in html
        assert (
            "this.layerGroup.onAdd" not in html
            or "this.layerGroup.onAdd = (map)" not in html
        )

    def test_no_remove_layer_override(self, base_map: folium.Map):
        """removeLayer override removed — unregistration handled explicitly."""
        from conftest import render

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layerGroup.removeLayer =" not in html

    def test_pane_setting_via_ensure_pane(self, base_map: folium.Map):
        """MeasureControl uses LayerControlAPI.ensurePane for renderer creation."""
        from conftest import render

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "window.foliplus.LayerControlAPI.ensurePane" in html
