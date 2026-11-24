"""Split of test_panel.py by dimension."""

from __future__ import annotations

import json

import re

import time

from pathlib import Path

import folium

import pytest

from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)

from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from .helper import _expand_panel, _geo_mixed, _write_html

from .helper_browser import LayerControlBrowserBase

class TestPanelBrowser(LayerControlBrowserBase):
    def test_remove_readd_restores_layer_api(self, browser, tmp_path):
        """Re-add after removeControl upgrades LayerAPI back to full and re-attaches panel."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/destroy_readd"))
            assert state["afterRemoveStub"] is True
            assert state["afterAddFull"] is True
            assert state["panelAttached"] is True
            panel_ready(page)  # rebuilt panel completes its init pass again
            assert not errors, f"JS errors: {errors}"
    def test_remove_readd_leaves_no_listener_residue(self, browser, tmp_path):
        """N=3 remove → add cycles must not grow map._events listener sum.

        Hard regression gate: baseline round[0] is captured right after the
        initial addControl (harness already ran that in page setup);
        rounds[1] and rounds[2] follow remove → add. Any drift — whether on
        round[0] or in a later round — fails the assertion.

        The gate is what caught the `dismissFocus` → `ensureModes` first-call
        side effect leaking a `map.on('unload', ...)` handler at round[1]
        (fix in foliplus/js/control/LayerControl/ui/focus/index.ts). See the probe comment
        in test/js/browser/LayerControl/probe_listener_residue.js for the
        historical note.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/probe_listener_residue"))
            rounds = state["rounds"]
            assert len(rounds) == 3, f"expected 3 rounds, got {rounds!r}"
            for i, n in enumerate(rounds[1:], start=1):
                assert n == rounds[0], (
                    f"LayerControl: map._events listener sum grew on round {i}: "
                    f"{rounds!r}"
                )
            panel_ready(page)
            assert not errors, f"JS errors: {errors}"
    def test_create_managed_layers_api(self, browser, tmp_path):
        """layers() returns expected convenience methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            api = page.evaluate(_js("LayerControl/create_layers_api"))
            assert api is not None, "LayerAPI not found"
            assert api["hasClearLayers"], "clearLayers missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasBringToFront"], "bringToFront missing"
    def test_add_graph_sets_pane(self, browser, tmp_path):
        """addGraph sets pane on the layer and calls register."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/add_graph_sets_pane"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"
    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/clear_all_unregisters"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False
    def test_geojson_group_pins_children_to_declared_pane(self, browser, tmp_path):
        """A GeoJSON group's child paths render into the declared data pane.

        ``addLayer`` writes ``options.pane`` on the node it is handed, and
        Leaflet ignores a group's pane for its children — each child joins the
        map on its own.  Without the recursive pin the shapes would draw into
        the map's default pane even though every option says otherwise.
        """
        with use_page(self._make_page, browser, tmp_path, slug="geojson_pane") as (
            page,
            errors,
        ):
            result = page.evaluate(
                _js("LayerControl/geojson_group_pins_children_pane"),
                load_geojson("LayerControl", "line_polygon_panes"),
            )
            assert result is not None, "LayerAPI not found"
            assert result["paneExists"], f"declared pane was never created: {result}"
            assert result["groupPane"] == "__geojson_pane__", result
            assert len(result["kids"]) == 2, f"unexpected child count: {result}"
            for kid in result["kids"]:
                assert kid["pane"] == "__geojson_pane__", f"child not pinned: {kid}"
                assert kid["hasRendererOpt"], f"child has no renderer option: {kid}"
                assert kid["hasRenderer"], f"child has no _renderer: {kid}"
                assert kid["isPath"], f"child has no renderer container: {kid}"
                # DOM truth: the SVG container's parent must be the declared pane element.
                assert kid["inDeclaredPane"] is True, (
                    f"child renders outside declared pane "
                    f"(parent: {kid['parentTag']}."
                    f"{kid['parentClass']}): {kid}"
                )
            assert not errors, f"JS errors: {errors}"
    def test_create_canvas_basic_api(self, browser, tmp_path):
        """createCanvas returns canvas API object with expected methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            api = page.evaluate(_js("LayerControl/create_canvas_api"))
            assert api is not None
            assert api["hasCanvas"]
            assert api["hasCtx"]
            assert api["hasResize"]
            assert api["hasDestroy"]
            assert api["hasUpdatePosition"]
            assert api["hasSetVisible"]
            assert api["hasGetSize"]
            assert api["canvasTag"] == "CANVAS"
            assert api["canvasClass"], "canvas should carry foliplus-canvas-layer"
            assert api["parentIsPane"], "canvas should live in a foliplus-layer-pane"
            assert api["paneRegistered"], "canvas pane should be on the map"
    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it.

        Also asserts the pane model: canvas mounts in its own pane, the ordering
        pass prices the pane from the layer stack, and only destroy() drops the
        pane from the map.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/canvas_register_unregister_dom"))
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )
            assert result["inPane"], "canvas pane should have foliplus-layer-pane"
            assert result["canvasParent"], "canvas parent should be the dedicated pane"
            assert result["expectedPaneZ"], "canvas should hold a registry slot"
            assert result["paneZ"] == result["expectedPaneZ"], (
                "the ordering pass should price the canvas pane from the layer stack"
            )
            assert result["registeredPaneName"] == "foliplus-canvas-__test_canvas_reg__"
            assert result["paneAfterUnregister"], (
                "unregister keeps the pane for re-register"
            )
            assert not result["paneAfterDestroy"], "destroy drops the pane"
    def test_migrate_layers_marker_pane(self, browser, tmp_path):
        """pinLateContent moves Markers to per-layer panes."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_marker_pane"),
                {"point": leaflet_points("common", "point_1193_2608")[0]},
            )
            assert result is not None
            assert result["pane"] == "__test_marker_pane_graph__"
    def test_migrate_layers_path_pane(self, browser, tmp_path):
        """pinLateContent moves Path layers to the target pane."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_path_pane"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["pane"] == "__test_path_pane_graph__"
    def test_register_reentry_after_hide(self, browser, tmp_path):
        """registerLayer can be re-called after a layer is hidden by checkbox."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_reentry_after_hide"))
            assert result is not None
            assert result["found"] is True
    def test_register_readds_hidden_layer(self, browser, tmp_path):
        """register() re-adds mainLayer to map when layer was unchecked."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_readds_hidden_layer"))
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
    def test_bring_layer_to_front_runtime(self, browser, tmp_path):
        """bringLayerToFront moves the layer to front of z-order."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="bring_front",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_layer_to_front"))
            assert result is not None, "LayerAPI not found"
            assert result["newIdx"] == 0, (
                f"Expected layer B at index 0 after bringToFront, got {result['newIdx']} (was {result['initialIdx']})"
            )
    def test_unregister_layer_removes_dom(self, browser, tmp_path):
        """unregisterLayer removes the DOM item from the panel."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/unregister_layer_removes_dom"))
            assert result is not None
            assert result["existsBefore"] is True, (
                "DOM item should exist after registerLayer"
            )
            assert result["existsAfter"] is False, (
                "DOM item should be removed after unregisterLayer"
            )
    def test_base_basemap_reorder_repaints_z(self, browser, tmp_path):
        """Every base basemap repaints when its row moves.

        The z ladder is written onto each base layer's own pane
        (synthesized for tile layers, dedicated for the color basemap).
        Reordering two tile basemaps must flip their pane z-indexes AND the
        tiles must actually live in those panes — if they were still in the
        shared .leaflet-tile-pane (z fixed at 200 by Leaflet CSS), the swap
        would change numbers nothing draws on top of.
        """
        tile_a = folium.TileLayer("CartoDB positron", name="Tiles A", overlay=False)
        tile_b = folium.TileLayer("OpenStreetMap", name="Tiles B", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile_a, tile_b) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(600)

            state = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state["ok"] is True, state
            assert len(state["bases"]) >= 2, f"need two base layers, got {state}"

            # Tiles must paint inside each base layer's own pane, not the
            # shared tilePane — otherwise reorder cannot change the stack.
            assert state["sharedTilePaneImages"] == 0, (
                f"tiles still in shared tilePane: {state}"
            )
            for b in state["bases"]:
                if b["id"] == "foliplus_color_map":
                    continue
                assert b["paintsHere"] > 0, (
                    f"tile layer {b['name']} paints nothing in its own pane: {state}"
                )
                assert b["z"] is not None, (
                    f"tile layer {b['name']} has no ladder z: {state}"
                )

            # Swap the last tile above the first; the two tile panes' z must
            # flip with the row order.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "swap-tiles"})
            state2 = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state2["ok"] is True, state2
            zs2 = {b["id"]: b["z"] for b in state2["bases"]}
            moved = [b for b in state2["bases"] if b["id"] != "foliplus_color_map"]
            first_z2 = moved[0]["z"]
            last_z2 = moved[-1]["z"]
            # The tile that moved to the top must now sit above the other.
            assert first_z2 > last_z2, f"reordered tile panes did not flip z: {moved}"
    def test_register_layer_preserves_visible_on_reentry(self, browser, tmp_path):
        """registerLayer preserves the visible state from a previous registration.

        Intent is the single source of truth (#498): a hide recorded through
        setVisible survives unregisterLayer — which is a teardown, not a
        delete — and is replayed on the next registerLayer of the same id.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/register_preserves_visible_on_reentry")
            )
            assert result is not None
            assert result["defaultVisible"] is True, "Default visible should be true"
            assert result["newVisible"] is False, (
                "the hide recorded by setVisible must survive unregister/re-register; "
                f"got {result}"
            )
    def test_canvas_setvisible_emits_layer_change(self, browser, tmp_path):
        """setVisible on a canvas layer emits LAYER_CHANGE, matching native layers.

        Canvas-only surfaces (heatmap / measure / color face) have no Leaflet
        layer to add/remove; their visibility carrier is the canvas element's
        HIDDEN class. The executor's write of that class is the write that
        rides the bus alongside the native branch's map-membership writes —
        without it, subscribers (label, controller) would see canvas
        layers appear/disappear silently. A repeated setVisible that does
        not flip the class must not re-emit.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/create_canvas_visibility_emits"))
            assert result is not None, result
            assert not errors, f"JS errors: {errors}"

            # Registration itself emits one LAYER_CHANGE (layer entered the map).
            # That is a distinct lifecycle event from the setVisible writes we
            # are guarding; the counter is baselined past it.
            assert result["registerEmits"] == 1, result

            # setVisible(false): canvas gains HIDDEN and one LAYER_CHANGE rides
            # the bus — the canvas carrier flip matching native add/remove.
            assert result["hiddenAfterFalse"] is True, result
            assert result["eventsAfterFalse"] == 1, result
            assert result["lastAfterFalse"] == {
                "id": "__test_canvas_vis__",
                "kind": "canvas",
            }, result

            # setVisible(true): class removed and another LAYER_CHANGE.
            assert result["hiddenAfterTrue"] is False, result
            assert result["eventsAfterTrue"] == 2, result
            assert result["lastAfterTrue"] == {
                "id": "__test_canvas_vis__",
                "kind": "canvas",
            }, result

            # Re-hide flips the class again: still one event per flip.
            assert result["eventsAfterSecondFalse"] == 3, result
    def test_register_re_register_preserves_fields(self, browser, tmp_path):
        """A partial re-register never drops previously registered fields.

        createLayerInfo is idempotent: fields absent from the second opts
        (layer/paneName/iconSvg/name/role) fall back to
        the existing layerInfo instead of being reset to defaults.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            # The icon the fixture registers. Degenerate markup is rejected
            # by the sanitizer, so it must be real SVG.
            svg = '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>'
            result = page.evaluate(_js("LayerControl/re_register_preserves_fields"))
            assert result is not None and "error" not in result, result
            for phase in ("before", "after"):
                r = result[phase]
                # `name` never leaves the registry's own values: the initial
                # registration falls back to the id, and the partial one
                # keeps it.
                assert r["name"] in ("Keep Me", "__keep__"), f"{phase}: name lost"
                assert r["role"] == "base", f"{phase}: role lost"
                assert r["layerSame"] is True, f"{phase}: layer lost"
                assert r["paneName"] == "customPane", f"{phase}: paneName lost"
                # The value must be the registered icon, unchanged by the
                # partial re-register.
                assert r["iconSvg"] == svg, f"{phase}: iconSvg lost"
    def test_extract_points_api(self, browser, tmp_path):
        """extractPoints returns geo points from registered layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/extract_points"))
            assert result is not None
            assert result["count"] == 2, f"Expected 2 points, got {result['count']}"
            assert abs(result["lat0"] - 26.08) < 0.001
            assert abs(result["lng0"] - 119.30) < 0.001
            assert abs(result["lat1"] - 26.09) < 0.001
            assert abs(result["lng1"] - 119.31) < 0.001
    def test_paneset_reset_after_hide_show(self, browser, tmp_path):
        """Hiding and re-showing a layer re-pins the leaf marker to its sub-pane.

        Uses a FeatureGroup with a child marker — the marker (leaf) is what
        gets pinned, so the pane value is asserted on the leaf layer. An empty
        container has no DOM to pin, so the assertion is meaningless there.
        """
        fg = folium.FeatureGroup(name="TestLayer", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="test_marker").add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="paneset_reset") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Step 1: enforceOrder pins the leaf marker to the group's sub-pane
            result = page.evaluate(_js("LayerControl/read_leaf_paneset"))
            assert result is not None, "Layer not found"
            assert result["pane"], (
                f"Expected non-empty pane on leaf after enforceOrder, got {result['pane']}"
            )

            # Step 2: Hide the layer by unchecking checkbox
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 3: Show the layer again
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 4: handleChange resets the container pane; enforceOrder
            # re-pins the leaf marker to the group's sub-pane
            paneset = page.evaluate(_js("LayerControl/read_leaf_paneset_value"))
            assert paneset, (
                f"Expected non-empty pane on leaf after re-show, got {paneset}"
            )
    def test_enforce_order_end_to_end(self, browser, tmp_path):
        """enforceOrder applies correct z-index to layers and migrates panes."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="enforce",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["layerCount"] >= 2, f"got {result['layerCount']} layers"
            # Leaflet sets z-index via CSS class, so computed style should be numeric
            assert result["overlayZ"] and result["overlayZ"] != "auto", (
                "overlay pane should have z-index"
            )
            assert result["markerZ"], "marker pane should have z-index"
    def test_pane_zindex_hierarchy(self, browser, tmp_path):
        """LayerControl keeps data < marker < tooltip < popup z-index ordering.

        Regression: markers (search/locate pins, ✕, data markers) must render
        above LayerControl-managed data layers, while tooltip/popup stay on top.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.GeoJson(load_geojson("common", "shanghai_polygon"), name="Polygons"),
            folium.Marker([26.08, 119.30], name="Points"),
        ) as (page, errors):
            # GeoJSON's layer is resolved after its addTo fires layeradd →
            # debouncedEnforce; wait for the per-layer pane to appear. The pane
            # class is "foliplus-layer-pane" (a single token), not "foliplus-layer".
            page.wait_for_selector(
                ".leaflet-pane.foliplus-layer-pane", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["dataZ"] is not None, "no data layer pane found"
            assert result["markerZNum"] > result["dataZ"], (
                f"marker({result['markerZNum']}) should be above data "
                f"({result['dataZ']})"
            )
            assert result["tooltipZ"] > result["markerZNum"], (
                f"tooltip({result['tooltipZ']}) should be above marker "
                f"({result['markerZNum']})"
            )
            assert result["popupZ"] > result["tooltipZ"], (
                f"popup({result['popupZ']}) should be above tooltip "
                f"({result['tooltipZ']})"
            )
            assert not errors, f"JS errors: {errors}"
    def test_bring_layer_to_front_guard(self, browser, tmp_path):
        """bringLayerToFront is a no-op for base layers or when already at front."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="bringfront_guard",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_to_front_unknown_guard"))
            assert result is not None
            assert result["unknownOk"] is True, (
                "bringToFront should be safe for unknown id"
            )
    def test_migrate_container_keeps_clean_options(self, browser, tmp_path):
        """Container layers are not re-migrated to fallback panes.

        pinLateContent must skip container nodes when writing pane options.
        The container's own pane stays whatever registerLayer assigned
        (paneName), and must NOT be overwritten with a fallback
        `foliplus-pane-*` name during migration.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_container_clean_options"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["leafPane"] == "__clean_graph__", (
                f"Leaf layer not migrated: {result['leafPane']}"
            )
            # Container must not be dumped into a per-layer fallback pane
            assert not result["isFallback"], (
                f"Container polluted with fallback pane: {result['containerPane']}"
            )
            # Leaf path must be rendered
            assert result["leafHasPath"] is True, "Leaf path not rendered"
    def test_register_idempotent_keeps_order(self, browser, tmp_path):
        """Re-registering an existing layer must not reorder the list.

        MeasureControl.setMode calls layers.register() on every tool switch;
        registerLayer on an already-registered id must update fields in place
        instead of splice+unshift, which would silently destroy the user's
        drag order and persist the accidental order via saveOrder.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/register_idempotent_keeps_order"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None, "LayerAPI not found"
            assert not result["moved"], (
                f"Re-register reordered layers: {result['orderBefore']} -> {result['orderAfter']}"
            )
    def test_handle_change_resets_paneset_on_show(self, browser, tmp_path):
        """Checkbox toggle triggers handleChange which re-pins layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            result = page.evaluate(_js("LayerControl/handle_change_resets_paneset"))
            assert result is not None
            assert result["clicked"] is True, "checkbox should be clickable"
    def test_hidden_base_does_not_raise_max_zoom(self, browser, tmp_path):
        """A hidden base layer must not raise ``map.getMaxZoom()``.

        foliplus used to write a static union of *all registered*
        layers' native ``options.maxZoom`` into ``map.options.maxZoom``
        on every ``enforceOrder`` pass — including layers the user had
        checked off. Since Leaflet's ``getMaxZoom`` returns
        ``options.maxZoom ?? <max of on-map layers>`,` removing the
        static write lets a hidden base stop raising the ceiling. This
        pins that behavior in a real browser so a future regression
        doesn't quietly come back.
        """
        # Two base layers with distinct native max_zoom values. Both
        # start checked (folium's default for overlay=False). `tiles=None`
        # suppresses folium's own default OSM tile layer, which would
        # otherwise sit on the map outside LayerControl's registry and
        # keep its native 18 in the ceiling regardless of what the user
        # checked off.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="High",
            attr="High",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Low",
            attr="Low",
            overlay=False,
            max_zoom=10,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "hidden_base_maxzoom.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'hidden_base_maxzoom.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            # Both checked: the ceiling is the union of on-map
            # layers' native max_zoom.
            both = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert both["entries"] == {"High": 1}, both
            assert both["zoom"] == 20, both
            # Uncheck "High" — the ceiling must drop to "Low"'s native
            # 10. Before the fix, "High" was still registered and its
            # native max_zoom would have kept the ceiling at 20.
            page.click("input[aria-label='High']")
            page.wait_for_timeout(300)
            low_only = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert low_only["entries"] == {"Low": 1}, low_only
            assert low_only["zoom"] == 10, (
                f"a hidden base must not raise getMaxZoom, got {low_only['zoom']} "
                "(expected 10 from the visible 'Low' layer's native max_zoom): "
                f"{low_only}"
            )
