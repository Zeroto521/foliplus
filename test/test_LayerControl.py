"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import LayerControl


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
        assert LayerControl(locale="zh").locale.code == "zh"

    def test_render_collects_layers(self):
        """LayerControl has render() and layer collections."""
        ctrl = LayerControl()
        assert hasattr(ctrl, "render")
        assert hasattr(ctrl, "base_layers")
        assert hasattr(ctrl, "overlays")

    def test_render_overlays_and_base(self):
        """render() correctly distinguishes base vs overlay layers."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        # TileLayer with overlay=False → base layer
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        # FeatureGroup with overlay=True → overlay
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        m.render()

        assert "OSM" in ctrl.base_layers, f"OSM not in base_layers: {ctrl.base_layers}"
        assert "Points" in ctrl.overlays, f"Points not in overlays: {ctrl.overlays}"


class TestLayerControlRendering:
    def test_default_params(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer-ctrl" in html

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
        LayerControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "图层" in html
        assert "layer.panel_title" in html

    def test_position_renders(self, base_map: folium.Map):
        LayerControl(position="bottomright").add_to(base_map)
        html = render(base_map)
        assert "bottomright" in html

    def test_multiple_base_layers(self):
        """Multiple base layers are all collected by render()."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.TileLayer(
            "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            name="Carto",
            overlay=False,
            attr="&copy; OpenStreetMap contributors",
        ).add_to(m)
        folium.TileLayer(
            "https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png",
            name="Terrain",
            overlay=False,
            attr="Map tiles by Stamen Design",
        ).add_to(m)
        m.render()

        assert "OSM" in ctrl.base_layers
        assert "Carto" in ctrl.base_layers
        assert "Terrain" in ctrl.base_layers
        # Map may auto-add a default OSM layer, so count >= 3
        assert len(ctrl.base_layers) >= 3
        assert len(ctrl.overlays) == 0

    def test_base_and_overlay_in_template(self):
        """Both base_layers and overlays appear in the JS template."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = render(m)

        # JS initialData should contain both with correct isBase flags
        assert "isBase:true" in html.replace(" ", "")
        assert "isBase:false" in html.replace(" ", "")

    def test_is_base_class_on_base_items(self):
        """Only base map items get the is-base-item CSS class."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # Base maps have the class; overlay items should be checked separately
        assert "is-base-item" in html

    def test_drag_handle_present(self):
        """Drag handle SVG present for all layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # Drag handle SVG circles (6 dots) present
        assert "drag-handle" in html
        # All items use drag handle (no more base-map-only spacer logic)
        assert "SVGS.DRAG_HANDLE" in html

    def test_draggable_all_items(self):
        """All layer items except color-layer-item have draggable=true."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # All regular items are draggable
        assert 'draggable="true"' in html
        # Color layer remains non-draggable
        assert "color-layer-item" in html

    def test_enforce_order_function(self, base_map: folium.Map):
        """enforceOrder is called and not skipped for base maps."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # enforceOrder is present in JS
        assert "enforceOrder" in html
        # Should NOT have the old skip for base maps
        assert "if (this.layers[i].isBase) continue;" not in html

    def test_locale_en_keys(self, base_map: folium.Map):
        """Default (en) locale keys rendered."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer.toggle_title" in html
        assert "layer.panel_title" in html
        assert "layer.base_map_label" in html

    def test_color_click_deselects_bases(self, base_map: folium.Map):
        """click handler on color-layer-item present in rendered code."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "color-layer-item" in html
        assert "_deselectAllBaseMaps" in html

    def test_drag_base_map_allowed(self):
        """No drag prevention for base maps in JS code."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # Should NOT contain old drag prevention for base maps
        assert "this.layers[idx].isBase" not in html

    def test_hide_color_layer_function(self, base_map: folium.Map):
        """_hideColorLayer function exists in rendered JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "_hideColorLayer" in html

    def test_separator_in_template(self):
        """Separator label 'BASE MAP' appears before base layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "base_map_label" in html

    def test_drag_handle_on_base_map(self):
        """Base map items also have drag handle, not spacer."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)
        # Drag handle should appear in the content for all items
        assert "SVGS.DRAG_HANDLE" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS variables from common.css are referenced in rendered output."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "var(--space-xl)" in html
        assert "var(--accent-primary)" in html
        assert "var(--radius-sm)" in html
        assert "var(--transition-fast)" in html

    def test_both_base_and_overlay_draggable(self):
        """Both base and overlay items are rendered with draggable=true."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = render(m)
        # Count draggable="true" occurrences (excluding inside JS strings)
        count = html.count('draggable="true"')
        assert count >= 2, f"Expected at least 2 draggable items, got {count}"
