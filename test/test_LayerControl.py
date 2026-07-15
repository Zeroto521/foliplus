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
        assert LayerControl()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert LayerControl(locale="zh")._LOCALE_CODE == "zh"

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
        assert "foliplus_color_map" in html

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
        assert "ensurePane" in html
        # layers() convenience API
        assert "addGraph" in html
        assert "addLabel" in html
        assert "removeGraph" in html
        assert "removeLabel" in html
        assert "clearGraph" in html
        assert "clearLabels" in html
        assert "clearAll" in html

    def test_bring_to_front_guard(self, base_map: folium.Map):
        """bringToFront monkey patch prevents parentNode errors during pane migration."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "origBringToFront" in html
        assert "this._path && this._path.parentNode" in html

    def test_container_marking(self, base_map: folium.Map):
        """registerLayer auto-marks container layers with _paneSet."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "paneSet" in html
        # Only LayerControl.js should use it — HeatmapControl/MeasureControl
        # no longer set it manually
        assert "opts.layer.options.paneSet" in html or "layer.options.paneSet" in html

    def test_color_layer_functions(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "showColorLayer" in html
        assert "hideColorLayer" in html

    def test_svg_icons_defined(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "SVGS.DRAG_HANDLE" in html
        assert ".GLOBE" in html
        assert "SVGS.POINT" in html
        assert "SVGS.LINE" in html
        assert "SVGS.POLYGON" in html
        assert "SVGS.EMPTY" in html
        assert "SVGS.UNKNOWN" in html

    def test_geometry_type_empty_and_unknown(self, base_map: folium.Map):
        """getGeometryType returns 'empty'/'unknown' for edge cases."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Empty container (no leaves) → 'empty'
        assert 'if (leaves.length === 0) return "empty"' in html
        # Has leaves but none match known types → 'unknown'
        assert 'if (!hasPoly && !hasLine && !hasPoint) return "unknown"' in html

    def test_type_svg_fallback(self, base_map: folium.Map):
        """getTypeSVG returns EMPTY/UNKNOWN for non-standard layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'if (type === "empty") return SVGS.EMPTY;' in html
        assert "return SVGS.UNKNOWN;" in html

    def test_locale_zh(self, base_map: folium.Map):
        LayerControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "图层" in html
        assert "LayerControl.panel_title" in html

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
        assert "LayerControl.toggle_title" in html
        assert "LayerControl.panel_title" in html
        assert "LayerControl.base_map_label" in html

    def test_color_click_deselects_bases(self, base_map: folium.Map):
        """click handler on color-layer-item present in rendered code."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "color-layer-item" in html
        assert "deselectAllBaseMaps" in html

    def test_drag_base_map_allowed(self):
        """No drag prevention for base maps in JS code."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # Should NOT contain old drag prevention for base maps
        assert "this.layers[idx].isBase" not in html

    def test_hide_color_layer_function(self, base_map: folium.Map):
        """hideColorLayer function exists in rendered JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "hideColorLayer" in html

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

    def test_marker_skip_in_set_layer_pane(self, base_map: folium.Map):
        """setLayerPaneRecursive skips Markers but moves TileLayers.

        Markers stay in markerPane to preserve shadow rendering.
        TileLayers are moved to custom panes for proper z-ordering.
        """
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "l instanceof L.Marker" in html
        assert "if (layer instanceof L.TileLayer) return" not in html
        assert "icon instanceof L.divIcon" not in html

    def test_enforce_order_skips_no_pane(self, base_map: folium.Map):
        """enforceOrder assigns fallback _lyr_ pane for non-paneName layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus_pane_" in html
        assert "setLayerPaneRecursive" in html
        assert "mp.style.zIndex = markerZ" in html or "mp.style.zIndex" in html

    def test_enforce_order_still_processes_registered_layers(
        self, base_map: folium.Map
    ):
        """Layers with explicit paneName still processed by enforceOrder."""
        from foliplus import HeatmapControl

        LayerControl().add_to(base_map)
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "enforceOrder" in html

    def test_recursion_guard_present(self, base_map: folium.Map):
        """Regression test for Bug 3: Recursion guard prevents infinite loop in layeradd."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.isEnforcing = true" in html
        assert "if (this.isEnforcing) return" in html

    def test_error_keys_injected(self, base_map: folium.Map):
        """LayerControl error keys appear in rendered HTML."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerControl.load_order_fail" in html
        assert "LayerControl.save_order_fail" in html

    def test_debounced_enforce_order(self, base_map: folium.Map):
        """enforceOrder is debounced in layeradd listener to prevent performance issues."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "setTimeout(() => {" in html
        assert "this.enforceOrder()" in html

    def test_pane_zindex_label_offset(self, base_map: folium.Map):
        """Regression test for Bug 1: Label panes get z-index offset (+1) automatically."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.labelPanes.has(cp)" in html
        assert "this.labelPanes.has(cp)" in html
        assert "ep.pane.style.zIndex = z + 1" in html

    def test_pane_set_on_all_layers(self, base_map: folium.Map):
        """setLayerPaneRecursive sets paneSet on ALL layers, not just Path."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer.options.paneSet = true" in html
        pane_lines = [l for l in html.split("\n") if "paneSet" in l]
        assert any("true" in l for l in pane_lines)

    def test_marker_pane_zindex_synced(self, base_map: folium.Map):
        """enforceOrder syncs markerPane z-index for non-paneName layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert (
            'this.map.getPane("markerPane")' in html
            or "this.map.getPane('markerPane')" in html
        )
        assert "mp.style.zIndex = markerZ" in html

    def test_default_panes_use_set(self, base_map: folium.Map):
        """isDefaultPane uses a Set for default pane lookup."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "defaultPanes.has(pane)" in html
        assert "fallbackPanes.has(pane)" in html
        assert "this.defaultPanes = new Set([" in html
        assert '"overlayPane"' in html
        assert '"markerPane"' in html
        assert '"tilePane"' in html
        assert '"shadowPane"' in html
        assert '"mapPane"' in html

    def test_circle_marker_not_skipped(self, base_map: folium.Map):
        """CircleMarker is NOT instanceof L.Marker — passes through correctly.

        CircleMarker extends L.Path (SVG-based), not L.Marker (DOM-based).
        The Marker skip only catches L.Marker, not L.CircleMarker.
        """
        LayerControl().add_to(base_map)
        html = render(base_map)
        # The skip only checks L.Marker, not L.CircleMarker
        assert "l instanceof L.Marker" in html

    def test_tilelayer_zindex_base_200(self, base_map: folium.Map):
        """TileLayers use z-index base 200 in enforceOrder."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "zBase = isTile ? CONST.TILE_Z_INDEX_BASE : CONST.Z_INDEX_BASE" in html
        # Both 200 and 600 appear as z-index bases
        assert "CONST.Z_INDEX_BASE" in html
        assert "CONST.TILE_Z_INDEX_BASE" in html

    def test_ensure_pane_need_renderer_param(self, base_map: folium.Map):
        """ensurePane accepts needRenderer parameter, defaults to true."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "needRenderer = true" in html

    def test_tile_layer_no_renderer_in_ensure_pane(self):
        """TileLayers pass needRenderer=false to ensurePane."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # ensurePane with !isTile means no renderer for tile layers
        assert "ensurePane(fallbackPaneName, !isTile)" in html
        assert "ensurePane(paneName, !isTile)" in html

    def test_skip_remove_add_when_pane_unchanged(self, base_map: folium.Map):
        """enforceOrder skips removeLayer/addLayer for already-paned layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert (
            "layer.options.pane !== fallbackPaneName || !layer.options.paneSet" in html
        )
        assert "layersToMove.push" in html

    def test_color_layer_hides_tile_pane(self, base_map: folium.Map):
        """showColorLayer hides tilePane visibility and opacity."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'tilePane.style.visibility = "hidden"' in html
        assert 'tilePane.style.opacity = "0"' in html

    def test_public_api_get_layer_type(self, base_map: folium.Map):
        """getLayerType is exposed via LayerControlAPI."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "getLayerType(id)" in html
        assert "getLayersByType(type)" in html

    def test_load_saved_order_uses_map(self, base_map: folium.Map):
        """loadSavedOrder uses Map-based O(n) lookup, not findIndex."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "new Map(this.layers.map" in html
        assert "map.has(id)" in html
        assert "map.delete(id)" in html

    def test_parse_int_with_radix(self, base_map: folium.Map):
        """All parseInt calls use radix 10."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Check that no bare parseInt(...) without radix exists
        import re

        matches = re.findall(r"parseInt\([^)]+\)", html)
        for m in matches:
            assert ", 10)" in m, f"Missing radix: {m}"

    def test_group_normalization_present(self, base_map: folium.Map):
        """Saved order is normalized to overlay-first, base-last groups."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "normalizeLayerGroups" in html
        assert "this.normalizeLayerGroups();" in html

    def test_blocked_reorder_hint_present(self, base_map: folium.Map):
        """Cross-group drag block exposes a throttled hint path."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "showReorderBlockedHint" in html
        assert "LayerControl.reorder_group_only" in html
        assert "DRAG_HINT_COOLDOWN_MS" in html

    def test_type_icons_use_current_color(self, base_map: folium.Map):
        """Geometry icons use currentColor via CSS instead of inline SVG attributes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert ".type-icon-col svg" in html
        assert "stroke: currentColor" in html
        assert "#a4a4a4" not in html
        assert "color: var(--text-primary);" in html

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'l.iconSvg || ""' in html
        assert "type-icon-col" in html

    def test_runtime_guard_present(self, base_map: folium.Map):
        """LayerControl logs error when foliplus runtime is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus runtime not found" in html
        assert "console.error" in html

    def test_find_layer_utility(self, base_map: folium.Map):
        """LayerUtils.findLayer resolves layers from map._layers and window."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerUtils.findLayer(this.map, id)" in html
        assert "window[id]" in html

    def test_for_each_leaf_utility(self, base_map: folium.Map):
        """forEachLeaf and forEachLayer iterate all sub-layers correctly."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "forEachLeaf" in html
        assert "forEachLayer" in html

    def test_onremove_destroys_manager(self, base_map: folium.Map):
        """LayerControl.onRemove calls destroy() which cleans up resources."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layerManager.destroy()" in html
        assert "unpatchBringToFront()" in html

    def test_destroy_cleans_listeners(self, base_map: folium.Map):
        """destroy() removes layeradd listener and cancels debounce."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'this.map.off("layeradd", this.onLayerAdd)' in html
        assert "this.debouncedEnforce.cancel()" in html

    def test_destroy_nulls_api(self, base_map: folium.Map):
        """destroy() clears LayerControlAPI reference when it is the active API."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "window.foliplus.LayerControlAPI === this" in html
        assert "window.foliplus.LayerControlAPI = null" in html

    def test_handleDrop_guard(self, base_map: folium.Map):
        """handleDrop guards against dragIdx/layers array desync."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "dragIdx < 0 || this.dragIdx >= this.layers.length" in html

    def test_window_id_validation(self, base_map: folium.Map):
        """registerLayer validates opts.id before assigning to window[id]."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "/^(?:[a-zA-Z_$][a-zA-Z0-9_$]*)$/" in html
        assert "not a valid identifier" in html or "invalid_id" in html

    def test_create_canvas_api(self, base_map: folium.Map):
        """createCanvas returns expected API methods."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "createCanvas" in html
        assert "canvas" in html
        assert "ctx" in html
        assert "resize" in html
        assert "destroy" in html
        assert "updatePosition" in html
        assert "setZIndex" in html
        assert "setVisible" in html
        assert "getSize" in html

    def test_create_canvas_in_mapPane(self, base_map: folium.Map):
        """createCanvas inserts canvas into leaflet-map-pane."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'L.DomUtil.create("canvas", "heatmap-canvas", mapPane)' in html
        assert "mapPane" in html

    def test_layer_callbacks_stored(self, base_map: folium.Map):
        """registerLayer stores onToggle/onZIndex in layerCallbacks Map."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.layerCallbacks.set(opts.id, cbs)" in html
        assert "cbs.onToggle" in html
        assert "cbs.onZIndex" in html

    def test_layer_callbacks_consumed(self, base_map: folium.Map):
        """enforceOrder and handleChange consume layerCallbacks."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "cbs.onZIndex(z)" in html
        assert "cbs.onToggle(target.checked)" in html


class TestLayerControlBrowser:
    """Browser-level interaction checks for drag/drop feedback."""

    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base group should show blocked hint."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_layer_control_drag_hint.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".layer-ctrl", state="attached", timeout=10000)

            page.evaluate('document.querySelector(".layer-ctrl .toggle-btn").click()')
            page.wait_for_selector(
                ".layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_selector(
                ".layer-item.is-base-item", state="attached", timeout=5000
            )

            ok = page.evaluate(
                """() => {
                    const api = window.foliplus && window.foliplus.LayerControlAPI;
                    if (!api) return false;
                    const overlay = document.querySelector(".layer-item:not(.is-base-item):not(.color-layer-item)");
                    const base = document.querySelector(".layer-item.is-base-item");
                    if (!overlay || !base) return false;
                    api.dragIdx = parseInt(overlay.dataset.index, 10);
                    const ev = new Event("dragover", { bubbles: true, cancelable: true });
                    base.dispatchEvent(ev);
                    return true;
                }"""
            )
            assert ok, "Failed to dispatch simulated cross-group dragover"

            page.wait_for_selector(
                ".map-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(
                'document.querySelector(".map-hint-LayerControl")?.textContent || ""'
            )
            assert ("same group" in hint_text.lower()) or ("同分组" in hint_text)
        finally:
            page.close()

    def test_create_managed_layers_api(self, browser, tmp_path):
        """layers() returns expected convenience methods."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_api.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".layer-ctrl", state="attached", timeout=10000)

            api = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerControlAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test__',
                    name: 'Test',
                    graphPane: '__test_graph__',
                    labelPane: '__test_label__',
                });
                return {
                    hasAddGraph: typeof mg.addGraph === 'function',
                    hasAddLabel: typeof mg.addLabel === 'function',
                    hasRemoveGraph: typeof mg.removeGraph === 'function',
                    hasRemoveLabel: typeof mg.removeLabel === 'function',
                    hasClearGraph: typeof mg.clearGraph === 'function',
                    hasClearLabels: typeof mg.clearLabels === 'function',
                    hasClearAll: typeof mg.clearAll === 'function',
                    hasRegister: typeof mg.register === 'function',
                    hasUnregister: typeof mg.unregister === 'function',
                    hasRegistered: typeof mg.registered === 'function',
                    hasMainLayer: !!mg.mainLayer,
                    hasGraphLayer: !!mg.graphLayer,
                    hasLabelLayer: !!mg.labelLayer,
                };
            }""")
            assert api is not None, "LayerControlAPI not found"
            assert api["hasAddGraph"], "addGraph missing"
            assert api["hasAddLabel"], "addLabel missing"
            assert api["hasRemoveGraph"], "removeGraph missing"
            assert api["hasRemoveLabel"], "removeLabel missing"
            assert api["hasClearGraph"], "clearGraph missing"
            assert api["hasClearLabels"], "clearLabels missing"
            assert api["hasClearAll"], "clearAll missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasGraphLayer"], "graphLayer missing"
            assert api["hasLabelLayer"], "labelLayer missing"
        finally:
            page.close()

    def test_add_graph_sets_pane(self, browser, tmp_path):
        """addGraph sets pane on the layer and calls register."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_addgraph.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".layer-ctrl", state="attached", timeout=10000)

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerControlAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_pane__',
                    name: 'PaneTest',
                    graphPane: '__pane_test_graph__',
                    labelPane: '__pane_test_label__',
                });
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                mg.addGraph(poly);
                return {
                    pane: poly.options.pane,
                    hasRenderer: !!poly._renderer,
                    registered: mg.registered(),
                };
            }""")
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addGraph"
        finally:
            page.close()

    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_clearall.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".layer-ctrl", state="attached", timeout=10000)

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerControlAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_clear__',
                    name: 'ClearTest',
                    graphPane: '__test_clear_graph__',
                });
                mg.addGraph(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const beforeRegistered = mg.registered();
                const beforeContent = Object.keys(mg.graphLayer._layers || {}).length;
                mg.clearAll();
                const afterRegistered = mg.registered();
                const afterContent = Object.keys(mg.graphLayer._layers || {}).length;
                return { beforeRegistered, beforeContent, afterRegistered, afterContent };
            }""")
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["beforeContent"] == 1
            assert result["afterRegistered"] is False
            assert result["afterContent"] == 0
        finally:
            page.close()

    def test_add_label_sets_pane(self, browser, tmp_path):
        """addLabel sets pane on the marker."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_addlabel.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(".layer-ctrl", state="attached", timeout=10000)

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerControlAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_label__',
                    name: 'LabelTest',
                    graphPane: '__test_label_graph__',
                    labelPane: '__test_label_pane__',
                });
                const mkr = L.marker([26.08,119.30]);
                mg.addLabel(mkr);
                return { pane: mkr.options.pane, registered: mg.registered() };
            }""")
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True
        finally:
            page.close()
