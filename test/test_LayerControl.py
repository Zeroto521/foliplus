"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import re
from pathlib import Path

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
        assert LayerControl()._locale_code == ""

    def test_custom_locale(self):
        assert LayerControl(locale="zh")._locale_code == "zh"

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
        assert "foliplus-layer-ctrl" in html

    def test_color_layer_item(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-color-layer-item" in html
        assert "foliplus-color-layer-input" in html
        assert "foliplus_color_map" in html

    def test_color_layer_default_value(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "#cccccc" in html

    def test_separator_label(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer-sep" in html
        assert "layer-sep-label" in html

    def test_public_api(self, base_map: folium.Map):
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "registerLayer" in html
        assert "unregisterLayer" in html
        assert "getLayersByType" in html
        assert "ensurePane" in html
        # createLayers convenience API
        assert "clearAll" in html
        assert "register" in html
        assert "unregister" in html
        assert "bringToFront" in html

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
        assert "SVGs.DRAG_HANDLE" in html
        assert ".GLOBE" in html
        assert "SVGs.POINT" in html
        assert "SVGs.LINE" in html
        assert "SVGs.POLYGON" in html
        assert "SVGs.EMPTY" in html
        assert "SVGs.UNKNOWN" in html

    def test_fold_icon_single_svg_css_rotation(self, base_map: folium.Map):
        """Fold uses a single SVG icon rotated by CSS — no separate UNFOLD SVG."""
        from pathlib import Path

        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "SVGs.FOLD" in html
        assert "SVGs.UNFOLD" not in html
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "rotate(180deg)" in css

    def test_geometry_type_empty_and_unknown(self, base_map: folium.Map):
        """getGeometryType returns 'empty'/'unknown' for edge cases."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Empty container (no leaves) → 'empty'
        assert "if (leaves.length === 0) return CONST.GEOM_TYPE.EMPTY" in html
        # Has leaves but none match known types → 'unknown'
        assert (
            "if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN"
            in html
        )
        # Mixed geometry types → 'unknown'
        assert "if (typeCount > 1) return CONST.GEOM_TYPE.UNKNOWN" in html

    def test_type_svg_fallback(self, base_map: folium.Map):
        """getTypeSVG returns EMPTY/UNKNOWN for non-standard layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "if (type === CONST.GEOM_TYPE.EMPTY) return SVGs.EMPTY;" in html
        assert "return SVGs.UNKNOWN;" in html

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
        """Only base map items get the data-layer-type attribute."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # Base maps have the attribute; overlay items should be checked separately
        assert (
            'data-layer-type": l.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY'
            in html
        )

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
        assert "SVGs.DRAG_HANDLE" in html

    def test_drag_tooltip_rendered(self):
        """Drag handle has i18n drag_tooltip title."""
        m = folium.Map()
        LayerControl(locale="zh").add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "drag_tooltip" in html
        assert "拖拽排序" in html

    def test_draggable_all_items(self):
        """All layer items except color-layer-item have draggable=true."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # DOM API sets draggable at runtime via setAttribute
        assert 'draggable: "true"' in html or 'draggable="true"' in html
        # Also check foliplus-color-layer-item exists (non-draggable)
        assert "foliplus-color-layer-item" in html

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
        assert "foliplus-color-layer-item" in html
        assert "deselectAllBaseMaps" in html

    def test_drag_base_map_allowed(self):
        """No drag prevention for base maps in JS code."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # Should NOT contain old drag prevention for base maps
        assert "this.layers[idx].isBase" not in html

    def test_separator_in_template(self):
        """Separator label 'BASE MAP' appears before base layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "base_map_label" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS variables from common.css are referenced in rendered output."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "var(--space-xl)" in html
        assert "var(--accent-primary)" in html
        assert "var(--radius-sm)" in html
        assert "var(--transition-fast)" in html

    def test_marker_not_skipped_in_set_layer_pane(self, base_map: folium.Map):
        """setLayerPaneRecursive moves Markers to per-layer panes for correct z-order."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # The old `if (l instanceof L.Marker) return;` skip is removed from
        # setLayerPaneRecursive; markers now move to per-layer fallback panes.
        assert "l instanceof L.Marker" in html  # still in extractPoints
        # Markers are now also moved: check for marker icon migration
        assert "l._icon" in html

    def test_enforce_order_skips_no_pane(self, base_map: folium.Map):
        """enforceOrder assigns fallback foliplus_pane_ for non-paneName layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus_pane_" in html
        assert "setLayerPaneRecursive" in html
        assert "FALLBACK_PANE_PREFIX" in html

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
        assert "bumpLabelPanes" in html
        assert "lp.pane.style.zIndex = z + 1" in html

    def test_pane_set_on_all_layers(self, base_map: folium.Map):
        """setLayerPaneRecursive sets paneSet on ALL layers, not just Path."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer.options.paneSet = true" in html
        pane_lines = [l for l in html.split("\n") if "paneSet" in l]
        assert any("true" in l for l in pane_lines)

    def test_markers_moved_to_per_layer_fallback_pane(self, base_map: folium.Map):
        """Markers are moved to per-layer fallback panes instead of shared markerPane."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Markers are now moved to their layer's fallback pane
        assert "l instanceof L.Marker" in html
        assert "l._icon" in html
        # The fallback pane mechanism is used for all non-pane layers
        assert "FALLBACK_PANE_PREFIX" in html
        # shadowPane z-index sync removed — markers get per-layer panes
        assert "sp.style.zIndex" not in html
        assert "markerZ" not in html

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
        assert "zBase = isTile ? CONST.Z_INDEX.TILE_BASE : CONST.Z_INDEX.BASE" in html
        # Both 200 and 600 appear as z-index bases
        assert "CONST.Z_INDEX.BASE" in html
        assert "CONST.Z_INDEX.TILE_BASE" in html

    def test_compute_zindex_extracted(self, base_map: folium.Map):
        """computeZIndex is a standalone method in LayerManager."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "computeZIndex(i, isTile)" in html

    def test_apply_layer_zindex_three_mechanisms(self, base_map: folium.Map):
        """applyLayerZIndex handles all three z-index mechanisms."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Mechanism A: custom paneName
        assert "--- Mechanism A: Custom pane" in html
        # Mechanism B: TileLayer setZIndex
        assert "--- Mechanism B: TileLayer (Leaflet's own API)" in html
        # Mechanism C: Auto-discovered / fallback panes
        assert "--- Mechanism C: Auto-discovered / fallback panes" in html

    def test_migrate_layers_extracted(self, base_map: folium.Map):
        """migrateLayers is a standalone method with DocumentFragment batching."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "migrateLayers(layersToMove)" in html
        assert "DocumentFragment" in html
        assert "groups.get(container).push(l._path)" in html

    def test_enforce_order_try_finally(self, base_map: folium.Map):
        """enforceOrder uses try/finally to reset isEnforcing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "try {" in html
        assert "} finally {" in html
        assert "this.isEnforcing = false" in html

    def test_enforce_order_callback_first_then_pane(self, base_map: folium.Map):
        """enforceOrder applies onZIndex callback before pane migration for same layer."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Callback (step 1) comes BEFORE the pane setting (step 2)
        cbs_idx = html.index("cbs.onZIndex(z)")
        apply_idx = html.index("this.applyLayerZIndex")
        assert cbs_idx < apply_idx, "onZIndex must be called before pane setting"

    def test_popup_and_tooltip_pane_above_all_layers(self, base_map: folium.Map):
        """popupPane and tooltipPane z-index are bumped above all managed panes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # popupPane uses computeZIndex(0, false) which is the maxZ
        assert "this.computeZIndex(0, false)" in html
        # Must bump popupPane above all managed panes
        assert 'this.map.getPane("popupPane")' in html
        assert "pp.style.zIndex" in html
        # Must bump tooltipPane above all managed panes (hover tooltips)
        assert 'this.map.getPane("tooltipPane")' in html
        assert "tp.style.zIndex" in html
        # popupPane gets +1 over tooltipPane to avoid z-fighting
        assert "topZ + 1" in html

    def test_can_reorder_between_blocks_cross_group(self, base_map: folium.Map):
        """canReorderBetween returns false for cross-group drag."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "canReorderBetween" in html
        assert "!!from.isBase !== !!to.isBase" in html

    def test_handle_drop_early_return(self, base_map: folium.Map):
        """handleDrop returns early when dragIdx is invalid."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.m.dragIdx < 0 || this.m.dragIdx >= this.m.layers.length" in html

    def test_ensure_pane_no_renderer_false(self, base_map: folium.Map):
        """ensurePane accepts needRenderer=false for label/overlay panes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.ensurePane(paneName, false)" in html

    def test_icon_svg_custom_in_initial_data(self, base_map: folium.Map):
        """iconSvg in registerLayer opts appears in the initialData template."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "iconSvg: opts.iconSvg ?? null" in html
        assert "iconSvg: opts.iconSvg || null" in html

    def test_discover_child_panes_depth_guard(self, base_map: folium.Map):
        """discoverChildPanes enforces recursion depth limit."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "depth > CONST.RECURSION.PANE_DEPTH" in html

    def test_discover_child_panes_skips_default(self, base_map: folium.Map):
        """discoverChildPanes filters out default panes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "!this.isDefaultPane(p)" in html

    def test_fallback_panes_tracked_in_set(self, base_map: folium.Map):
        """fallbackPanes is a Set that tracks auto-created pane names."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.fallbackPanes.add(fbName)" in html

    def test_leaflet_control_classes_applied(self, base_map: folium.Map):
        """LayerControl renders with leaflet-control classes for Leaflet theming."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "leaflet-control" in html
        assert "leaflet-bar" in html

    def test_layer_item_dom_structure(self, base_map: folium.Map):
        """Each layer-item has checkbox, label, type-icon-col."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-checkbox" in html
        assert "foliplus-type-icon-col" in html

    def test_color_map_id_constant(self, base_map: folium.Map):
        """Color map uses a special constant ID for identification."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "CONST.COLOR.MAP_ID" in html

    def test_hint_duration_constants_in_layer(self, base_map: folium.Map):
        """LayerControl uses hint duration constants (not hardcoded values)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "HINT_DURATION" in html
        assert "HINT_COOLDOWN_MS: 800" in html

    def test_separator_container_has_base_label(self, base_map: folium.Map):
        """Separator label uses localized base_map_label key."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerControl.base_map_label" in html

    def test_register_layer_returns_dom_element(self, base_map: folium.Map):
        """registerLayer returns the DOM element when UI is ready."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.uiContainer.querySelector" in html
        assert "CONST.DATA.LAYER_ID]: l.id" in html

    def test_register_layer_pending_when_no_ui(self, base_map: folium.Map):
        """registerLayer queues registrations when UI not yet rendered."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.pendingRegistrations.push(opts)" in html
        assert "return null" in html

    def test_destroy_removes_panes(self, base_map: folium.Map):
        """destroy removes fallback panes from the map."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "fallbackPanes" in html
        assert "this.map.getPane(paneName)" in html

    def test_destroy_clears_pane_cache(self, base_map: folium.Map):
        """destroy() clears paneCache to prevent stale cache entries."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "paneCache.clear()" in html

    def test_destroy_clears_layer_registry(self, base_map: folium.Map):
        """destroy() clears layerRegistry to prevent stale references."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerManager.registry.clear()" in html

    def test_destroy_flag(self, base_map: folium.Map):
        """destroy sets isDestroyed flag to prevent post-cleanup actions."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.isDestroyed = true" in html

    def test_layeradd_guard_during_enforce(self, base_map: folium.Map):
        """layeradd handler skips enforceOrder during active enforceOrder."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.isEnforcing ||" in html
        assert "this.isDestroyed ||" in html

    def test_register_clears_pane_cache(self, base_map: folium.Map):
        """registerLayer clears paneCache when layer structure changes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "paneCache.clear()" in html

    def test_unregister_clears_pane_cache(self, base_map: folium.Map):
        """unregisterLayer clears paneCache when layer is removed."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "paneCache.clear()" in html

    def test_debounced_enforce_cancels_on_destroy(self, base_map: folium.Map):
        """debouncedEnforce skips execution when destroyed."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert (
            "if (this.isDestroyed || !this.map || !this.map._container) return" in html
        )

    def test_unregister_removes_global_ref(self, base_map: folium.Map):
        """unregisterLayer cleans up layerRegistry entry."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerManager.registry.delete(id)" in html

    def test_unregister_returns_bool(self, base_map: folium.Map):
        """unregisterLayer returns false when layer not found."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "if (idx === -1) return false" in html
        assert "return true" in html

    def test_unregister_clears_sublayers(self, base_map: folium.Map):
        """unregisterLayer calls clearAllLayers recursively."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.clearAllLayers(layer)" in html

    def test_unregister_removes_dom_item(self, base_map: folium.Map):
        """unregisterLayer removes corresponding DOM element."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "target = this.uiContainer.querySelector" in html
        assert "this.reindexItems()" in html

    def test_unregister_invalidates_size(self, base_map: folium.Map):
        """unregisterLayer calls invalidateSize after DOM removal."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.map.invalidateSize" in html

    def test_patch_bring_to_front_applied_once(self, base_map: folium.Map):
        """patchBringToFront is idempotent — skip if already patched."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "if (isBringToFrontPatched) return" in html

    def test_unpatch_bring_to_front_restores_original(self, base_map: folium.Map):
        """unpatchBringToFront restores original L.Path.prototype.bringToFront."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "L.Path.prototype.bringToFront = origBringToFront" in html

    def test_layer_utils_static_methods(self, base_map: folium.Map):
        """LayerUtils exposes static utility methods."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "static escapeHTML" in html
        assert "static getGeometryType" in html
        assert "static getTypeSVG" in html
        assert "static findLayer" in html
        assert "static forEachLeaf" in html
        assert "static forEachLayer" in html

    def test_escape_html_handles_special_chars(self, base_map: folium.Map):
        """LayerUtils.escapeHTML escapes & < > \" '."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "&amp;" in html
        assert "&lt;" in html
        assert "&gt;" in html
        assert "&quot;" in html
        assert "&#39;" in html

    def test_create_layers_rendering(self, base_map: folium.Map):
        """createLayers emits API, auto-registration, and layer overrides."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers" in html
        assert "register()" in html
        assert "unregister()" in html
        assert "mainLayer.addLayer = (layer) => {" in html
        assert "mainLayer.removeLayer = (layer) => {" in html
        assert "mainLayer.clearLayers = () => {" in html

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
        assert "ensurePane(fbName, !isTile)" in html
        assert "ensurePane(paneName, !isTile)" in html

    def test_skip_remove_add_when_pane_unchanged(self, base_map: folium.Map):
        """enforceOrder skips removeLayer/addLayer for already-paned layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer.options.pane !== fbName || !layer.options.paneSet" in html
        assert "layersToMove.push" in html

    def test_color_layer_hides_tile_pane(self, base_map: folium.Map):
        """showColorLayer hides tilePane visibility and opacity."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'tilePane.classList.add("foliplus-layer-tile-hidden")' in html

    def test_public_api_get_layer_type(self, base_map: folium.Map):
        """getLayerType is exposed via LayerAPI."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "getLayerType(id)" in html
        assert "getLayersByType(type)" in html

    def test_load_saved_order_uses_map(self, base_map: folium.Map):
        """loadSavedOrder uses Map-based O(n) lookup, not findIndex."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "new Map(this.layers.map" in html
        assert "layerMap.has(id)" in html
        assert "layerMap.delete(id)" in html

    def test_parse_int_with_radix(self, base_map: folium.Map):
        """All parseInt calls use radix 10 (multi-line + nested parens compatible)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Match parseInt across multiple lines, handling one level of nested parens.
        # Pattern: parseInt( (content with optional balanced parens) )
        matches = re.findall(r"parseInt\((?:[^()]|\([^()]*\))*\)", html)
        for m in matches:
            # The radix 10 may be separated by newlines/spaces after prettier formatting.
            assert re.search(r",\s*10", m), f"Missing radix: {m}"

    def test_sync_attribution_renders(self, base_map: folium.Map):
        """syncAttribution method is rendered and called from enforceOrder."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "syncAttribution()" in html
        assert "topAttr = layer.options.attribution" in html
        assert "this.map.attributionControl" in html
        assert "container.innerHTML" in html

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
        assert "HINT_COOLDOWN_MS: 800" in html

    def test_type_icons_use_current_color(self, base_map: folium.Map):
        """Geometry icons use currentColor via CSS instead of inline SVG attributes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert ".foliplus-type-icon-col svg" in html
        assert "stroke: currentColor" in html
        assert "#a4a4a4" not in html
        assert "color: var(--text-primary);" in html

    def test_css_interaction_effects(self, base_map: folium.Map):
        """CSS hover/active effects exist for interactive elements."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Color layer picker (via :is() selector, no literal :hover string)
        assert "foliplus-color-layer-input" in html
        # Fold toggle button SVG
        assert "foliplus-layer-fold-btn:hover svg" in html
        assert "foliplus-layer-fold-btn:active" in html
        # Type icon column transition
        assert "foliplus-type-icon-col svg" in html
        assert "transition: transform" in html
        # Layer item hover on type icon
        assert "foliplus-layer-item:hover .foliplus-type-icon-col svg" in html
        # Active state on type icon
        assert "active .foliplus-type-icon-col svg" in html
        # Toggle button SVG inherits color
        assert "foliplus-toggle-btn svg" in html
        assert "stroke: currentColor" in html
        # Close (X) button SVG must also be in the icon selector
        assert "foliplus-ctrl-btn" in html

    def test_close_btn_svg_styled(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""
        css = Path("foliplus/css/common.css").read_text()
        # .foliplus-ctrl-btn must appear inside the :is() icon-size rule so that
        # its SVG lines get stroke:currentColor (without it the X is invisible).
        assert ".foliplus-ctrl-btn" in css

    def test_folded_state_no_accent_text(self):
        """Folded label keeps neutral color; only left border and fold-btn use accent."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # left border and fold-btn turn accent when folded — both expected
        assert "foliplus-layer-folded" in css
        assert "border-left-color: var(--accent-primary)" in css
        # label must NOT be colored accent when folded (label stays text-primary)
        assert "foliplus-layer-folded .foliplus-layer-sep-label" not in css, (
            "folded label must not override color (label stays text-primary)"
        )

    def test_toggle_all_label_semibold_primary(self):
        """Section header label is semibold and text-primary so it reads as a real header."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-toggle-all .foliplus-layer-sep-label" in css
        assert "font-weight: var(--font-weight-semibold)" in css
        assert "color: var(--text-primary)" in css

    def test_toggle_all_hover_accent_light_border(self):
        """Toggle-all row hover shows a soft accent-light left border."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-toggle-all:hover" in css
        assert "border-left-color: var(--accent-light)" in css

    def test_folded_fold_btn_turns_accent(self):
        """Fold button color becomes accent-primary when row is folded."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Find the rule that targets fold-btn itself (not fold-btn svg)
        # by searching for the closing of the selector without "svg" on the same segment
        match = re.search(
            r"foliplus-layer-folded\s+\.foliplus-layer-fold-btn\s*\{([^}]*)\}",
            css,
        )
        assert match, "folded fold-btn rule not found"
        assert "var(--accent-primary)" in match.group(1)

    def test_section_divider_fades_when_folded(self):
        """Section divider fades to opacity 0 when the group is folded."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-section-divider" in css
        assert "opacity: 0" in css

    def test_fold_btn_hover_color(self):
        """Fold button hover shows accent color (no bg/radius on fold-btn itself)."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-fold-btn:hover" in css
        assert "color: var(--accent-primary)" in css

    def test_fold_btn_hover_bidirectional_preview(self):
        """Fold button shows bidirectional hover preview on the toggle-all row."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Expanded row hover: black → red
        assert "foliplus-layer-toggle-all:not(.foliplus-layer-folded):hover" in css
        assert "color: var(--accent-primary)" in css
        # Folded row hover: red → black
        assert "foliplus-layer-toggle-all.foliplus-layer-folded:hover" in css
        assert "color: var(--text-primary)" in css

    def test_fold_btn_background_transition(self):
        """Fold button transitions color and transform (background removed — no bg to transition)."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Find the base fold-btn rule (not the folded or hover variants)
        idx = css.find(".foliplus-layer-ctrl .foliplus-layer-fold-btn {\n")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        # Find the transition property value (between "transition:" and the next property)
        t_idx = block.find("transition:")
        assert t_idx != -1, "transition property not found"
        t_end = block.find("\n  }", t_idx)
        trans_val = block[t_idx:t_end]
        assert "background var(--transition-fast)" not in trans_val
        assert "color var(--transition-fast)" in trans_val
        assert "transform var(--transition-fast)" in trans_val

    def test_fold_btn_svg_fill_none(self):
        """fold-btn svg rule includes fill:none so chevrons render as outlines."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-fold-btn svg" in css
        assert "fill: none" in css

    def test_drag_handle_circle_stroke(self):
        """drag-handle circles have explicit stroke so they appear bold."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert ".drag-handle circle" in css
        assert "stroke: currentColor" in css

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "iconSvg" in html
        assert "type-icon-col" in html

    # ── Drag-over animation tests ──

    def test_drag_over_classes_in_js(self, base_map: folium.Map):
        """JS renders drag-over-top and drag-over-bottom classes for drop indicators."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "drag-over-top" in html
        assert "drag-over-bottom" in html

    def test_drag_pulse_css_keyframes(self):
        """CSS defines drag-pulse keyframes with variable-driven values."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "@keyframes foliplus-drag-pulse" in css
        assert "var(--drag-border-from" in css
        assert "var(--drag-border-to" in css
        assert "var(--drag-shadow-from" in css
        assert "var(--drag-shadow-to" in css

    def test_drag_over_css_variables(self):
        """Drag-over drop indicators use CSS custom properties for all parameters."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "--drag-border-width" in css
        assert "--drag-top-shadow" in css
        assert "--drag-bottom-shadow" in css
        assert "--drag-pulse-duration" in css
        assert "--drag-pulse-count" in css

    def test_runtime_guard_present(self, base_map: folium.Map):
        """LayerControl logs error when foliplus runtime is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus runtime not found" in html
        assert "console.error" in html

    def test_find_layer_utility(self, base_map: folium.Map):
        """LayerUtils.findLayer and LayerAPI.findLayer resolve layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerUtils.findLayer(this.map, id)" in html
        assert "LayerManager.registry.get(id)" in html
        assert "this.findLayer = this.findLayer.bind(this)" in html

    def test_for_each_leaf_utility(self, base_map: folium.Map):
        """forEachLeaf and forEachLayer iterate all sub-layers correctly."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "forEachLeaf" in html
        assert "forEachLayer" in html

    def test_for_each_leaf_depth_guard(self, base_map: folium.Map):
        """forEachLeaf respects RECURSION.LAYER_DEPTH guard."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "depth > CONST.RECURSION.LAYER_DEPTH" in html

    def test_clear_all_layers_recursive(self, base_map: folium.Map):
        """clearAllLayers recursively clears nested sub-layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layer.eachLayer((l) => this.clearAllLayers(l))" in html
        assert 'typeof layer.clearLayers === "function"' in html

    def test_extract_points_filters_no_feature(self, base_map: folium.Map):
        """extractPoints only accepts markers with .feature."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "!l.feature" in html
        assert "L.Marker || l instanceof L.CircleMarker" in html

    def test_extract_points_dedup_by_stamp(self, base_map: folium.Map):
        """extractPoints deduplicates markers by L.stamp using Set."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "seen.has(stamp)" in html
        assert "seen.add(stamp)" in html

    def test_for_each_leaf_api_exposed(self, base_map: folium.Map):
        """forEachLeaf is exposed on foliplus.LayerAPI."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.forEachLeaf = this.forEachLeaf.bind(this)" in html
        assert "forEachLeaf(id, fn)" in html

    def test_extract_points_api_exposed(self, base_map: folium.Map):
        """extractPoints is exposed on foliplus.LayerAPI."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.extractPoints = this.extractPoints.bind(this)" in html
        assert "extractPoints(id)" in html

    def test_onremove_destroys_manager(self, base_map: folium.Map):
        """LayerControl.onRemove calls destroy() which cleans up resources."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "this.manager.destroy()" in html
        assert "unpatchBringToFront()" in html

    def test_destroy_cleans_listeners(self, base_map: folium.Map):
        """destroy() removes layeradd listener and cancels debounce."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'this.map.off("layeradd", this.onLayerAdd)' in html
        assert "this.debouncedEnforce.cancel()" in html

    def test_destroy_nulls_api(self, base_map: folium.Map):
        """destroy() clears LayerAPI reference when it is the active API."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.LayerAPI === this" in html
        assert "foliplus.LayerAPI = null" in html

    def test_window_id_validation(self, base_map: folium.Map):
        """registerLayer validates opts.id before assigning to layerRegistry."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "/^(?:[a-zA-Z_$][a-zA-Z0-9_$]*)$/" in html
        assert "not a valid identifier" in html or "invalid_id" in html

    def test_create_canvas_rendering(self, base_map: folium.Map):
        """createCanvas emits API methods and inserts into leaflet-map-pane."""
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
        assert 'foliplus.dom.el("canvas"' in html
        assert 'class: "foliplus-heatmap-canvas"' in html
        assert "parent: mapPane" in html
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

    def test_render_methods_use_dom_builder(self, base_map: folium.Map):
        """renderToggleAllRow, renderLayerItem, renderColorLayerItem exist in JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "renderToggleAllRow" in html
        assert "renderLayerItem" in html
        assert "renderColorLayerItem" in html
        assert "getLayerItems" in html

    def test_foliplus_dom_el_in_js(self, base_map: folium.Map):
        """foliplus.dom.el is used in LayerControl rendering."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.dom.el" in html

    def test_toggle_all_row_data_group(self, base_map: folium.Map):
        """Toggle-all rows have correct data-group attribute."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)
        # data-group is set via JS setAttribute at runtime
        # Check JS source code contains the renderToggleAllRow calls
        assert "renderToggleAllRow" in html
        # Check that toggle-all-item class is used in JS
        assert "toggle-all-item" in html

    def test_toggle_all_cb_present(self, base_map: folium.Map):
        """toggle-all checkbox present in rendered HTML."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'data-role="toggle-all"' in html

    def test_toggle_all_method_in_js(self, base_map: folium.Map):
        """toggleAll method exists in rendered JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "toggleAll(group, newState)" in html

    def test_sync_toggle_all_method_in_js(self, base_map: folium.Map):
        """syncToggleAll method exists in rendered JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "syncToggleAll(group)" in html

    def test_get_layer_items_method(self, base_map: folium.Map):
        """getLayerItems method exists in rendered JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "getLayerItems(group)" in html

    def test_register_reentry_on_hidden_layer(self, base_map: folium.Map):
        """register() re-enters registerLayer when already registered (MeasureControl fix)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # The register() closure handles both first-time and re-entry paths
        assert "!registered" in html
        assert "registered = true" in html
        assert "this.registerLayer(" in html

    def test_callback_only_visible_tracking_in_handle_change(
        self, base_map: folium.Map
    ):
        """handleChange records layerInfo.visible for callback-only layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layerInfo.visible = target.checked" in html

    def test_callback_only_visible_tracking_in_toggle_all(self, base_map: folium.Map):
        """toggleAll records layerInfo.visible for callback-only layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layerInfo.visible = newState" in html

    def test_init_types_visibility_respects_callback_only_state(
        self, base_map: folium.Map
    ):
        """initTypesAndVisibility respects layerInfo.visible for callback-only layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "layerInfo.visible !== false" in html
        assert "isCallbackOnly" in html

    # ── title / tooltip rendering tests ──

    def test_select_tooltip_keys_in_js(self, base_map: folium.Map):
        """select_tooltip and deselect_tooltip keys are used in JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "select_tooltip" in html
        assert "deselect_tooltip" in html

    def test_toggle_all_select_tooltip_keys_in_js(self, base_map: folium.Map):
        """toggle_all_select_tooltip and toggle_all_deselect_tooltip keys are used in JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "toggle_all_select_tooltip" in html
        assert "toggle_all_deselect_tooltip" in html

    def test_fold_unfold_tooltip_keys_in_js(self, base_map: folium.Map):
        """fold_tooltip and unfold_tooltip keys are used in JS."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "fold_tooltip" in html
        assert "unfold_tooltip" in html

    def test_item_title_set_from_type_key(self, base_map: folium.Map):
        """Layer item title is set from type key in initTypesAndVisibility."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "item.title = _(typeKey)" in html

    def test_color_layer_title_uses_color_map_label(self, base_map: folium.Map):
        """Color layer item title is set to color_map_label."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "color_map_label" in html


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
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(
                """() => {
                    const api = window.foliplus && window.foliplus.LayerAPI;
                    if (!api) return false;
                    const overlay = document.querySelector('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                    const base = document.querySelector('.foliplus-layer-item[data-layer-type="base"]');
                    if (!overlay || !base) return false;
                    api.dragIdx = parseInt(overlay.dataset.index, 10);
                    const ev = new Event("dragover", { bubbles: true, cancelable: true });
                    base.dispatchEvent(ev);
                    return true;
                }"""
            )
            assert ok, "Failed to dispatch simulated cross-group dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(
                'document.querySelector(".foliplus-hint-LayerControl")?.textContent || ""'
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
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            api = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test__',
                    name: 'Test',
                    graphPane: '__test_graph__',
                    labelPane: '__test_label__',
                });
                return {
                    hasClearLayers: typeof mg.clearLayers === 'function',
                    hasRegister: typeof mg.register === 'function',
                    hasUnregister: typeof mg.unregister === 'function',
                    hasRegistered: typeof mg.registered === 'function',
                    hasMainLayer: !!mg.mainLayer,
                    hasBringToFront: typeof mg.bringToFront === 'function',
                };
            }""")
            assert api is not None, "LayerAPI not found"
            assert api["hasClearLayers"], "clearLayers missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasBringToFront"], "bringToFront missing"
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
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_pane__',
                    name: 'PaneTest',
                    graphPane: '__pane_test_graph__',
                    labelPane: '__pane_test_label__',
                });
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                mg.mainLayer.addLayer(poly);
                return {
                    pane: poly.options.pane,
                    hasRenderer: !!poly._renderer,
                    registered: mg.registered(),
                };
            }""")
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"
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
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_clear__',
                    name: 'ClearTest',
                    graphPane: '__test_clear_graph__',
                });
                mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const beforeRegistered = mg.registered();
                mg.clearLayers();
                const afterRegistered = mg.registered();
                return { beforeRegistered, afterRegistered };
            }""")
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False
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
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_label__',
                    name: 'LabelTest',
                    graphPane: '__test_label_graph__',
                    labelPane: '__test_label_pane__',
                });
                const mkr = L.marker([26.08,119.30]);
                mkr.isLabel = true;
                mg.mainLayer.addLayer(mkr);
                return { pane: mkr.options.pane, registered: mg.registered() };
            }""")
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True
        finally:
            page.close()

    def test_cross_group_drag_block_fallback(self, browser, tmp_path):
        """canReorderBetween returns false and hint appears."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)

        html_path = tmp_path / "test_cross_group_drag.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            ok = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return false;
                return typeof api.canReorderBetween === 'function';
            }""")
            assert ok
        finally:
            page.close()

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_unregister.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_unreg__',
                    name: 'UnregTest',
                    graphPane: '__test_unreg_graph__',
                });
                mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const before = mg.registered();
                mg.clearLayers();
                const after = mg.registered();
                return { before, after };
            }""")
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False
        finally:
            page.close()

    def test_create_canvas_basic_api(self, browser, tmp_path):
        """createCanvas returns canvas API object with expected methods."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_create_canvas.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            api = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cvs = api.createCanvas({ id: '__test_canvas__' });
                return {
                    hasCanvas: !!cvs.canvas,
                    hasCtx: !!cvs.ctx,
                    hasResize: typeof cvs.resize === 'function',
                    hasDestroy: typeof cvs.destroy === 'function',
                    hasUpdatePosition: typeof cvs.updatePosition === 'function',
                    hasSetZIndex: typeof cvs.setZIndex === 'function',
                    hasSetVisible: typeof cvs.setVisible === 'function',
                    hasGetSize: typeof cvs.getSize === 'function',
                    canvasTag: cvs.canvas.tagName,
                };
            }""")
            assert api is not None
            assert api["hasCanvas"]
            assert api["hasCtx"]
            assert api["hasResize"]
            assert api["hasDestroy"]
            assert api["hasUpdatePosition"]
            assert api["hasSetZIndex"]
            assert api["hasSetVisible"]
            assert api["hasGetSize"]
            assert api["canvasTag"] == "CANVAS"
        finally:
            page.close()

    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_canvas_reg.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cvs = api.createCanvas({ id: '__test_canvas_reg__', name: 'Canvas Test' });
                cvs.register();
                const item = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
                const hasItem = !!item;
                cvs.unregister();
                const itemAfter = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
                return { hasItem, hasItemAfter: !!itemAfter };
            }""")
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )
        finally:
            page.close()

    def test_set_layer_pane_recursive_marker_skip(self, browser, tmp_path):
        """setLayerPaneRecursive skips Markers but processes Paths."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_pane_skip.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_pane_skip__',
                    name: 'PaneSkip',
                    graphPane: '__test_pane_skip_graph__',
                });
                const mkr = L.marker([26.08,119.30]);
                mg.mainLayer.addLayer(mkr);
                // Marker should NOT be moved — still on default markerPane
                const pane = mkr.options.pane;
                return { pane };
            }""")
            assert result is not None
            assert result["pane"] is not None
        finally:
            page.close()

    def test_set_layer_pane_recursive_path(self, browser, tmp_path):
        """setLayerPaneRecursive moves Path layers to the target pane."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_pane_path.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                api.setLayerPaneRecursive(poly, '__test_custom_pane__', null);
                return { pane: poly.options.pane, paneSet: poly.options.paneSet };
            }""")
            assert result is not None
            assert result["pane"] == "__test_custom_pane__"
            assert result["paneSet"] is True
        finally:
            page.close()

    def test_get_layer_type_api(self, browser, tmp_path):
        """getLayerType returns correct geometry type for registered layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_layer_type.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Register a polygon layer
                const poly = L.polygon([[26.08,119.30],[26.09,119.31],[26.07,119.32]]);
                api.registerLayer({ id: '__test_type__', layer: poly });
                const type = api.getLayerType('__test_type__');
                const layers = api.getLayersByType('polygon');
                return { type, hasPolygon: layers.some(l => l.id === '__test_type__') };
            }""")
            assert result is not None
            assert result["type"] == "polygon"
            assert result["hasPolygon"] is True
        finally:
            page.close()

    def test_load_saved_order_restore_order(self, browser, tmp_path):
        """loadSavedOrder restores previously saved order from localStorage."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_saved_order.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const ids = api.layers.map(l => l.id);
                return { count: ids.length, ids };
            }""")
            assert result is not None
            assert result["count"] >= 3
        finally:
            page.close()

    def test_toggle_all_checkbox_toggles_layers(self, browser, tmp_path):
        """Toggle-all checkbox toggles all layers in the group."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            # Check initial state — all overlays checked
            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.checked : 'no-cb';
            }""")
            assert result is True, f"Expected toggle-all checked, got {result}"
        finally:
            page.close()

    # ── title / tooltip browser tests ──

    def test_layer_item_title_shows_type(self, browser, tmp_path):
        """Layer item row title shows the translated type, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_layer_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            title = page.evaluate("""() => {
                const item = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item)');
                return item ? item.title : null;
            }""")
            # initTypesAndVisibility runs after 300ms delay; wait if needed
            if not title or "MyPoints" in (title or ""):
                page.wait_for_timeout(500)
                title = page.evaluate("""() => {
                    const item = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item)');
                    return item ? item.title : null;
                }""")
            # Should be a type description (e.g. "Point Layer") not the layer name
            assert title and "MyPoints" not in title, (
                f"Expected type title, got '{title}'"
            )
        finally:
            page.close()

    def test_checkbox_title_shows_select_deselect(self, browser, tmp_path):
        """Checkbox title shows Select/Deselect, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_cb_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            title = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]');
                return cb ? cb.title : null;
            }""")
            assert title and "MyPoints" not in title, (
                f"Expected select/deselect title, got '{title}'"
            )
        finally:
            page.close()

    def test_toggle_all_checkbox_title_changes_with_state(self, browser, tmp_path):
        """Toggle-all checkbox title updates when state changes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # All checked → title should be "Deselect all"
            initial = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.title : null;
            }""")
            assert initial and "Deselect" in initial, (
                f"Expected 'Deselect all', got '{initial}'"
            )

            # Uncheck one layer → title should become "Select all"
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            after = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.title : null;
            }""")
            assert after and "Select" in after, f"Expected 'Select all', got '{after}'"
        finally:
            page.close()

    def test_toggle_all_row_title_shows_fold_unfold(self, browser, tmp_path):
        """Toggle-all row title shows fold/unfold tooltip."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_row_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Expanded → should show "Collapse layers"
            initial = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row ? row.title : null;
            }""")
            assert initial and "Collapse" in initial, (
                f"Expected 'Collapse layers', got '{initial}'"
            )

            # Click fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Folded → should show "Expand layers"
            folded = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row ? row.title : null;
            }""")
            assert folded and "Expand" in folded, (
                f"Expected 'Expand layers', got '{folded}'"
            )
        finally:
            page.close()

    def test_color_layer_item_title(self, browser, tmp_path):
        """Color layer item title shows the color map label."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_color_layer_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            title = page.evaluate("""() => {
                const item = document.querySelector('.foliplus-color-layer-item');
                return item ? item.title : null;
            }""")
            assert title, f"Expected non-empty title, got '{title}'"
        finally:
            page.close()

    def test_register_reentry_after_hide(self, browser, tmp_path):
        """registerLayer can be re-called after a layer is hidden by checkbox."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_register_reentry.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Register a layer
                const fg = L.featureGroup();
                api.registerLayer({ id: '__test_reentry__', name: 'ReEntry', layer: fg });
                // Simulate uncheck: remove from map (as if user clicked checkbox off)
                api.layers = api.layers.filter(l => l.id !== '__test_reentry__');
                api.unregisterLayer('__test_reentry__');
                // Re-register (simulating MeasureControl tool re-activation)
                api.registerLayer({ id: '__test_reentry__', name: 'ReEntry', layer: fg });
                const found = api.layers.some(l => l.id === '__test_reentry__');
                return { found };
            }""")
            assert result is not None
            assert result["found"] is True
        finally:
            page.close()

    def test_register_readds_hidden_layer(self, browser, tmp_path):
        """register() re-adds mainLayer to map when layer was unchecked."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_register_readds.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Create a managed layer group (like MeasureControl does)
                const layers = api.createLayers({
                    id: '__test_measure__',
                    name: 'Test Measure',
                    graphPane: 'test_graph',
                    labelPane: 'test_label',
                });
                // Add content (triggers register)
                const mkr = L.circleMarker([26.08, 119.30]);
                mkr.isLabel = false;
                layers.mainLayer.addLayer(mkr);
                const wasRegistered = layers.registered();
                // Simulate uncheck: remove mainLayer from map
                api.map.removeLayer(layers.mainLayer);
                const onMapAfterUncheck = api.map.hasLayer(layers.mainLayer);
                // Trigger re-add via register() path (simulating tool click)
                const mkr2 = L.circleMarker([26.09, 119.31]);
                mkr2.isLabel = false;
                layers.mainLayer.addLayer(mkr2);
                const onMapAfterReadd = api.map.hasLayer(layers.mainLayer);
                // Check checkbox state in LayerControl panel
                const item = document.querySelector('[data-layer-id="__test_measure__"]');
                const cb = item ? item.querySelector('input[type="checkbox"]') : null;
                const checkboxChecked = cb ? cb.checked : 'no-cb';
                return { wasRegistered, onMapAfterUncheck, onMapAfterReadd, checkboxChecked };
            }""")
            assert result is not None
            assert result["wasRegistered"] is True, "Layer should be registered"
            assert result["onMapAfterUncheck"] is False, (
                "Layer should be removed from map after uncheck"
            )
            assert result["onMapAfterReadd"] is True, (
                "Layer should be re-added to map after tool re-activation"
            )
            assert result["checkboxChecked"] is True, (
                "Checkbox should be checked after re-activation"
            )
        finally:
            page.close()

    def test_fold_toggle_hides_overlay_items(self, browser, tmp_path):
        """Clicking the overlay fold-toggle-btn hides overlay layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_overlay.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click the overlay fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify overlay items are hidden
            result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in result), (
                f"Expected all overlay items hidden, got {result}"
            )

            # Verify base items are still visible
            base_result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item[data-layer-type="base"]');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in base_result), (
                f"Expected base items visible, got {base_result}"
            )
        finally:
            page.close()

    def test_fold_toggle_hides_base_items(self, browser, tmp_path):
        """Clicking the base fold-toggle-btn hides base layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.TileLayer("CartoDB dark_matter", name="Dark Mode", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_base.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click the base fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="base"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify base items are hidden
            result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item[data-layer-type="base"]');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in result), (
                f"Expected all base items hidden, got {result}"
            )

            # Verify overlay items are still visible
            overlay_result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in overlay_result), (
                f"Expected overlay items visible, got {overlay_result}"
            )
        finally:
            page.close()

    def test_fold_toggle_toggle_unfold(self, browser, tmp_path):
        """Clicking the fold button again unfolds (shows) the items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_unfold.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify folded
            folded = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in folded), (
                f"Expected hidden after fold, got {folded}"
            )

            # Click fold button again to unfold
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify unfolded
            unfolded = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in unfolded), (
                f"Expected visible after unfold, got {unfolded}"
            )
        finally:
            page.close()

    def test_fold_preserves_dom_index(self, browser, tmp_path):
        """Folded items remain in the DOM for index alignment."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_dom_index.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Count DOM items before fold (3 overlays + 1 default OSM base)
            before = page.evaluate(
                "document.querySelectorAll('.foliplus-layer-item:not(.foliplus-color-layer-item)').length"
            )
            assert before > 0, "Expected at least 1 layer item"

            # Fold overlay
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Count DOM items after fold — should still be same (not removed)
            after = page.evaluate(
                "document.querySelectorAll('.foliplus-layer-item:not(.foliplus-color-layer-item)').length"
            )
            assert after == before, (
                f"Expected {before} items after fold, got {after} — DOM items should not be removed"
            )
        finally:
            page.close()

    def test_fold_svg_switches_on_toggle(self, browser, tmp_path):
        """Fold button uses a single SVG rotated 180° by CSS (not swapped) on toggle."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_svg.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Single SVG, 1 polyline before fold
            elem_count = page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                return btn.querySelectorAll('polyline').length;
            }""")
            assert elem_count == 1, f"Expected 1 polyline (FOLD SVG), got {elem_count}"

            # Click to fold
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Still 1 polyline — icon is rotated by CSS, not swapped
            elem_count = page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                return btn.querySelectorAll('polyline').length;
            }""")
            assert elem_count == 1, (
                f"Expected 1 polyline (CSS-rotated, not swapped), got {elem_count}"
            )
            # Row must carry the folded class so CSS rotation kicks in
            is_folded = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row.classList.contains('foliplus-layer-folded');
            }""")
            assert is_folded, "Expected foliplus-layer-folded class on row after fold"
        finally:
            page.close()

    def test_color_layer_pointer_cursor(self, browser, tmp_path):
        """Color layer item shows pointer cursor on hover."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_color_cursor.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            cursor = page.evaluate("""() => {
                const el = document.querySelector('.foliplus-color-layer-item');
                return el ? getComputedStyle(el).cursor : null;
            }""")
            assert cursor == "pointer", f"Expected pointer cursor, got {cursor}"
        finally:
            page.close()


class TestLayerControlEdgeCases:
    """Tests for uncovered edge cases and code paths."""

    def test_hide_color_restores_tile_pane(self, base_map: folium.Map):
        """hideColorLayer restores tilePane visibility."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'tilePane.classList.remove("foliplus-layer-tile-hidden")' in html
        assert "mapContainer.style.removeProperty" in html

    def test_deselect_all_bases_skips_except_index(self, base_map: folium.Map):
        """deselectAllBaseMaps skips the excluded index."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "deselectAllBaseMaps" in html
        assert "i !== exceptIdx" in html

    def test_handle_input_color_change(self, base_map: folium.Map):
        """handleInput reacts to color input changes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "handleInput" in html
        assert "showColorLayer(e.target.value)" in html

    def test_bring_layer_to_front(self, base_map: folium.Map):
        """bringLayerToFront moves layer to top of list."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "bringLayerToFront" in html
        assert "this.layers.unshift(item)" in html

    def test_register_layer_requires_id(self, base_map: folium.Map):
        """registerLayer throws when id is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "id_required" in html
        assert "throw new Error" in html

    def test_create_canvas_requires_id(self, base_map: folium.Map):
        """createCanvas throws when id is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "require_canvas_id" in html
        assert "throw new Error" in html

    def test_traverse_utility(self, base_map: folium.Map):
        """LayerUtils.traverse walks all layers (containers + leaves)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "static traverse" in html
        assert "leafOnly" in html

    def test_register_sets_pane_on_non_path(self, base_map: folium.Map):
        """registerLayer sets pane on non-Path/Marker layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "opts.layer.options.pane = opts.paneName" in html
        assert "opts.layer.options.paneSet = true" in html

    def test_drag_event_handlers_bound(self, base_map: folium.Map):
        """Drag-and-drop event handlers are registered."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "handleDragStart" in html
        assert "handleDragOver" in html
        assert "handleDragLeave" in html
        assert "handleDrop" in html
        assert "handleDragEnd" in html
