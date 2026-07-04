"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import folium
from conftest import render

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
        assert MeasureControl()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._LOCALE_CODE == "zh"


class TestMeasureControlRendering:
    def test_default_params(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ctrl" in html

    def test_custom_position(self, base_map: folium.Map):
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "topleft" in html

    def test_contains_gcoord_dependency(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "gcoord" in html
        assert "gcoord.global.prod.js" in html

    def test_contains_tool_buttons(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert "data-mode" in html

    def test_locale_zh(self, base_map: folium.Map):
        MeasureControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "量算工具" in html
        assert "measure.tool_toggle" in html

    def test_bring_to_front_on_circle_marker(self, base_map: folium.Map):
        """CircleMarkers call bringToFront() after creation (not in onAdd override)."""

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

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layerGroup.removeLayer =" not in html

    def test_pane_setting_via_ensure_pane(self, base_map: folium.Map):
        """MeasureControl uses LayerControlAPI.ensurePane for renderer creation."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "window.foliplus.LayerControlAPI.ensurePane" in html

    def test_realtime_distance_preview(self, base_map: folium.Map):
        """Distance mode includes real-time preview label (previewDistLabel)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel" in html
        assert "onDistMove" in html
        assert "MeasureUtils.formatDistance(showDist)" in html

    def test_format_distance_km(self, base_map: folium.Map):
        """Distance >= 1000m shows as km."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure.unit_km" in html
        assert "measure.unit_m" in html

    def test_del_icon_class(self, base_map: folium.Map):
        """Delete icon uses del-icon-wrap and measure-del-icon classes."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "del-icon-wrap" in html
        assert "measure-del-icon" in html

    def test_onremove_present(self, base_map: folium.Map):
        """MeasureControl has onRemove method that calls clearAll."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onRemove()" in html
        assert "measureManager.clearAll()" in html

    def test_css_classes_line_styles(self, base_map: folium.Map):
        """Line styles use measure-line-solid (solid) and measure-line-dashed (dashed)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-line-solid" in html
        assert "measure-line-dashed" in html
        assert "measure-line-preview" in html

    def test_css_class_measure_hidden(self, base_map: folium.Map):
        """measure-hidden class exists for visibility toggle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-hidden" in html

    def test_suppress_hide_utility(self, base_map: folium.Map):
        """MeasureUtils.suppressHide helper is used instead of inline suppress pattern."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.suppressHide" in html

    def test_node_css_classes(self, base_map: folium.Map):
        """Node markers use CSS classes instead of inline color/weight/fill options."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-node" in html
        assert "measure-node-final" in html
        assert "measure-node-preview" in html

    def test_circle_css_classes(self, base_map: folium.Map):
        """Circle elements use CSS classes instead of inline color/fill options."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-circle-final" in html
        assert "measure-circle-preview" in html

    def test_toggle_visibility_utility(self, base_map: folium.Map):
        """toggleVisibility is used for show/hide of line and node elements."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.toggleVisibility" in html
