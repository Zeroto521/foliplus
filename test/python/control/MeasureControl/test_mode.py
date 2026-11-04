"""Per-mode browser tests for foliplus.MeasureControl.

One module per drawing mode would repeat the same page fixture four times; the
four modes share the manager, the preview affordance (a cursor node painted
above the live geometry) and the restore path, so they are pinned together.
"""

from __future__ import annotations

import json

from conftest import _js, use_page

from .helper import _make_page


class TestMeasureCircleBrowser:
    def test_circle_del_icon_removes_circle(self, browser, tmp_path):
        """Clicking the delete X in circle mode removes the entire circle."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_circle"))
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate(_js("MeasureControl/delete_measurement_del_icon"))
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_node_follows_mouse(self, browser, tmp_path):
        """Regression: the circle preview node must follow the mouse while drawing.

        Previously the node was only positioned at creation and stayed pinned
        at that spot on the map during the preview.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/draw_circle_preview_follows_mouse")
            )
            assert state["x1"] is not None, "preview node not rendered"
            assert state["x2"] is not None
            moved = (state["x1"], state["y1"]) != (state["x2"], state["y2"])
            assert moved, f"circle preview node did not follow the mouse: {state}"
            s = state["stack"]
            # 3-pane layout: nodes live in the node pane, geometry in the
            # graph pane. Paint order is guaranteed by pane z-index, not
            # SVG sibling order.
            assert s["nodePane"] == "node", f"radius node not in node pane: {s}"
            assert s["centerPane"] == "node", f"center node not in node pane: {s}"
            assert s["node"] > s["circle"], f"node pane z below graph pane: {s}"
            assert s["center"] > s["circle"], (
                f"node pane z below graph pane (center): {s}"
            )
            # After a third move the pane z-index ordering must hold.
            s3 = state["stackAfterThirdMove"]
            assert s3["node"] > s3["circle"], (
                f"node pane z dropped below graph after repeated moves: {s3}"
            )
            assert s3["center"] > s3["circle"], (
                f"center pane z dropped below graph after repeated moves: {s3}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_label_in_label_pane(self, browser, tmp_path):
        """The circle preview radius label must land in the label pane.

        `PreviewMode.addPreview` used to forward no pane name, so the label
        silently defaulted to the graph pane alongside the circle fill, the
        radius line and both nodes. There the label competes for SVG paint
        order with the geometry, so at a short radius the dots cover it.
        Distance and polygon always routed their preview labels through
        CONST.PANES.LABEL, which is why only circle mode showed this.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_timeout(300)
            state = page.evaluate(_js("MeasureControl/circle_preview_label_pane"))
            panes = {p["name"]: int(p["z"]) for p in state["allPanes"]}
            # 3-pane layout: graph (k=0), node (k=1), label (k=2)
            assert panes.get("graph") == 600, f"graph pane z wrong: {state}"
            assert panes.get("label") == 602, (
                f"label pane z wrong (expected graph+2): {state}"
            )
            for phase in ("near", "far"):
                assert "foliplus-measure-label-pane" in state[phase]["pane"], (
                    f"circle preview label is in {state[phase]['pane']} at {phase} radius"
                )
                assert int(state[phase]["z"]) == panes["label"], (
                    f"label pane z={state[phase]['z']} not {panes['label']}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_circle_preview_label_reattached_every_frame(self, browser, tmp_path):
        """While the circle preview is live the radius label chip stays the
        last marker child of the label pane.

        The label was moved in place with `setLatLng`, which keeps the sibling
        position from creation time. Once a finalized circle's label had
        entered the pane after the preview started, the preview chip stayed
        ahead of it and was painted under — the moving preview label visually
        disappeared below the earlier measurement's label.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("MeasureControl/circle_preview_label_reattached"))
            # The planted chip plus the preview chip should both be present.
            assert state["frames"], "no preview frames captured"
            assert all(f["total"] == 2 for f in state["frames"]), (
                f"expected planted + preview label: {state['frames']}"
            )
            assert state["alwaysLast"], (
                f"preview label was not the last label-pane child on every frame: {state['frames']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_restore_circle_from_storage(self, browser, tmp_path):
        """restoreCircle restores a circle measurement from localStorage without ReferenceError."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_circle_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 restored circle, got {count}"
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after restoring circle"
            assert not errors, f"JS errors: {errors}"


class TestMeasureDistanceBrowser:
    def test_distance_labels_show_bearing(self, browser, tmp_path):
        """Distance labels include bearing (e.g. '42° | 1.5 km') by default."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            labels = page.evaluate(_js("MeasureControl/read_labels"))
            assert any("° |" in l for l in labels), (
                f"expected a bearing label '° |', got {labels!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_distance_labels_no_bearing_when_disabled(self, browser, tmp_path):
        """show_bearing=False omits the bearing from distance labels."""
        with use_page(_make_page, browser, tmp_path, show_bearing=False) as (
            page,
            errors,
        ):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            labels = page.evaluate(_js("MeasureControl/read_labels"))
            assert all("° |" not in l for l in labels), (
                f"no bearing expected when disabled, got {labels!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_distance_del_icon_removes_measurement(self, browser, tmp_path):
        """Clicking the delete X in distance mode removes the entire measurement."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate(_js("MeasureControl/delete_measurement_del_icon"))
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_distance_preview_cursor_node_follows_mouse(self, browser, tmp_path):
        """Distance preview shows a cursor dot that follows the mouse, paints
        above the preview line, and is removed when the measurement finishes.

        Mirrors the circle mode's radius-endpoint node so all three preview
        shapes share one cursor affordance. The dot is created lazily on the
        first move — entering the mode with no points placed shows nothing.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/draw_distance_preview_cursor_node")
            )
            assert state["idle"], "cursor node floated with no points placed"
            assert state["x1"] is not None, "cursor node not rendered"
            assert state["x2"] is not None
            moved = (state["x1"], state["y1"]) != (state["x2"], state["y2"])
            assert moved, f"distance cursor node did not follow the mouse: {state}"
            s = state["stack"]
            # The node must come after both preview paths in DOM order, which is
            # Leaflet SVG paint order (later siblings paint above).
            assert s["node"] > s["preview"], f"node below preview line: {s}"
            assert s["node"] > s["dashed"], f"node below dashed line: {s}"
            # After a third move the recreated node must still be above both
            # lines — the old in-place `setLatLng` path let the live line
            # climb over it (regression: PR #252).
            s2 = state["stackAfterThirdMove"]
            assert s2["node"] > s2["preview"], (
                f"node climbed below preview line after repeated moves: {s2}"
            )
            assert s2["node"] > s2["dashed"], (
                f"node climbed below dashed line after repeated moves: {s2}"
            )
            assert state["removedAfterFinish"], "cursor node not removed on finish"
            assert not errors, f"JS errors: {errors}"

    def test_distance_cancel_single_click(self, browser, tmp_path):
        """Single click then right-click cancels distance without saving."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/start_distance"))
            page.wait_for_timeout(300)
            # Right-click to finish (cancel) with < 2 points
            page.evaluate(_js("MeasureControl/cancel_distance"))
            page.wait_for_timeout(300)
            # Mode should be cleared, no measurement saved
            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode cleared, got {mode}"
            meas = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"

    def test_distance_preview_layers_removed_after_finish(self, browser, tmp_path):
        """After finishing distance, previewLine and poly are removed from map."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            # The map should have the final polyline but not the preview layers
            # Check that measurements were saved
            meas = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert meas == 1, f"expected 1 measurement, got {meas}"
            assert not errors, f"JS errors: {errors}"


class TestMeasureMarkerBrowser:
    def test_marker_del_icon_removes_marker(self, browser, tmp_path):
        """Clicking the delete X in marker mode removes the marker pin."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/place_marker"))
            page.wait_for_timeout(500)
            # Remove the layer via API directly (testing the delete logic)
            page.evaluate(_js("MeasureControl/delete_marker_del_icon"))
            page.wait_for_timeout(300)
            # Check that delMkr is no longer in the layer group
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_marker_survives_reload_with_blocked_geocode(self, browser, tmp_path):
        """Regression: marker placed while geocode is blocked still survives reload."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Block geocoding entirely — reverseGeocode never resolves
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.abort(),
            )
            page.evaluate(_js("MeasureControl/place_marker"))
            # Measurement must be persisted WITHOUT waiting for geocode
            page.wait_for_timeout(300)
            saved = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            parsed = json.loads(saved) if saved else []
            assert len(parsed["items"]) == 1, (
                f"marker must be saved immediately, got {len(parsed['items'])}"
            )
            # Reload — marker must still appear
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 measurement after reload, got {count}"
            pins = page.evaluate(_js("MeasureControl/read_pin_count"))
            assert pins >= 1, "marker pin should be visible after reload"
            assert not errors, f"JS errors: {errors}"

    def test_restore_marker_address_backfilled(self, browser, tmp_path):
        """Regression: marker restored with address:null resolves and persists address."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Intercept Nominatim so the reverse geocode resolves deterministically
            # with a known address instead of hitting the network (CORS-blocked in
            # headless, flaky on slow CI networks).
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"display_name":"Resolved Address, Test City"}',
                ),
            )
            page.evaluate(_js("MeasureControl/seed_marker_nulladdr_storage"))
            page.reload()
            page.wait_for_timeout(3000)
            # Address should be resolved by the onAddress callback
            addr = page.evaluate(_js("MeasureControl/read_measurements_address"))
            assert addr, f"expected address to be backfilled, got {addr!r}"
            # And persisted back to localStorage
            saved = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            parsed = json.loads(saved) if saved else []
            assert parsed and parsed["items"][0]["address"], (
                "address should be persisted after restore"
            )
            assert not errors, f"JS errors: {errors}"

    def test_restored_marker_popup_shows_resolved_address(self, browser, tmp_path):
        """Regression: restored marker popup shows the resolved address even when
        the popup is opened after geocoding completes.

        createLocationMarker only updates popup content while it is open, so a
        restored marker whose address resolves while the popup is closed would
        otherwise show the loading placeholder on first open.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Intercept Nominatim so geocode resolves deterministically with a
            # known address. The marker is restored with address:null; geocode
            # completes while the popup is closed.
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"display_name":"Resolved Address, Test City"}',
                ),
            )
            # Restore a marker with address:null
            page.evaluate(_js("MeasureControl/seed_marker_popup_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            # Geocode resolved while popup is closed — address backfilled
            addr = page.evaluate(_js("MeasureControl/read_measurements_address"))
            assert addr, f"expected address to be backfilled, got {addr!r}"

            # Now open the popup — it must show the resolved address
            page.evaluate(_js("MeasureControl/open_restored_marker_popup"))
            page.wait_for_timeout(200)
            popup_text = page.evaluate(_js("MeasureControl/read_popup_text"))
            assert "Resolved Address" in popup_text, (
                f"popup should show resolved address, got {popup_text!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_restore_marker_from_storage(self, browser, tmp_path):
        """restoreMarker restores a marker measurement from localStorage without ReferenceError."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Pre-populate localStorage with a marker measurement
            page.evaluate(_js("MeasureControl/seed_marker_storage"))
            # Reload the page to trigger restoreMeasurements in constructor
            page.reload()
            page.wait_for_timeout(2000)
            # Check measurements were restored
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 restored measurement, got {count}"
            # Check layers registered (restoreMarker calls addLayer)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after restoring marker"
            assert not errors, f"JS errors: {errors}"

    def test_delete_marker_removes_from_storage(self, browser, tmp_path):
        """Deleting a marker removes it from measurements and persists."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/place_marker"))
            # Poll for measurement to appear (async reverse geocode may take time)
            page.wait_for_timeout(500)
            for _ in range(20):
                before = page.evaluate(_js("MeasureControl/read_measurements_length"))
                if before >= 1:
                    break
                page.wait_for_timeout(500)
            assert before == 1, f"expected 1 measurement, got {before}"
            page.evaluate(_js("MeasureControl/delete_marker_via_map"))
            page.wait_for_timeout(300)
            after = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert after == 0, f"expected 0 measurements after delete, got {after}"
            data = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            parsed = json.loads(data) if data else []
            assert len(parsed["items"]) == 0, (
                "localStorage should be empty after deleting all"
            )
            assert not errors, f"JS errors: {errors}"


class TestMeasurePolygonBrowser:
    def test_polygon_preview_cursor_node_follows_mouse(self, browser, tmp_path):
        """Polygon preview shows a cursor dot that follows the mouse, paints
        above the preview polygon, and is removed when the measurement ends.

        Mirrors the circle mode's radius-endpoint node so all three preview
        shapes share one cursor affordance. The dot is created lazily on the
        first move — entering the mode with no points placed shows nothing.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/draw_polygon_preview_cursor_node")
            )
            assert state["idle"], "cursor node floated with no points placed"
            assert state["created"], "cursor node not rendered on the first move"
            moved = (state["x1"], state["y1"]) != (state["x2"], state["y2"])
            assert moved, f"polygon cursor node did not follow the mouse: {state}"
            # Recreated each frame, so there must be exactly one dot at all
            # times — the old path's DOM node identity is not a valid check.
            assert state["dotsAfterTwo"] == 1, (
                f"expected exactly one cursor dot after two moves, "
                f"got {state['dotsAfterTwo']}"
            )
            assert state["dotsAfterThree"] == 1, (
                f"expected exactly one cursor dot after three moves, "
                f"got {state['dotsAfterThree']}"
            )
            s = state["stack"]
            # The node must come after both preview paths and the fill in DOM
            # order, which is Leaflet SVG paint order (later siblings paint above).
            assert s["node"] > s["preview"], f"node below preview outline: {s}"
            assert s["node"] > s["dashed"], f"node below dashed path: {s}"
            assert s["node"] > s["fill"], f"node below the shape fill: {s}"
            # After a third move, the recreated node must still be above the
            # fill — the old in-place `setLatLng` path let the fill climb over
            # it because `setLatLngs` re-sorts the SVG root but `setLatLng`
            # does not (regression: PR #252).
            s2 = state["stackAfterThirdMove"]
            assert s2["node"] > s2["fill"], (
                f"node climbed below the shape fill after repeated moves: {s2}"
            )
            assert s2["node"] > s2["preview"], (
                f"node climbed below preview outline after repeated moves: {s2}"
            )
            assert state["removedAfterFinish"], "cursor node not removed on finish"
            assert not errors, f"JS errors: {errors}"

    def test_polygon_draw_and_delete(self, browser, tmp_path):
        """Draw a polygon with 3 points, verify it renders, then delete via clearAll."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon"))
            page.wait_for_timeout(500)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            area = page.evaluate(_js("MeasureControl/read_measurements_area"))
            assert area > 0, f"expected positive area, got {area}"
            # Delete the polygon via clearAll
            page.evaluate(_js("MeasureControl/clear_all"))
            page.wait_for_timeout(300)
            page.wait_for_timeout(300)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 0, f"expected 0 measurements after delete, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_polygon_centroid_dot_above_fill(self, browser, tmp_path):
        """The centroid dot must be visible (not covered by the fill).

        Regression: when the dot was a div-icon marker in the graph pane it
        competed with the SVG renderer's container z-index. After a zoom,
        sortLayers reassigns each marker's z-index to its screen Y, which can
        drop the dot below the SVG container and let the semi-transparent fill
        paint over the dot.

        Fix: the dot is now an SVG CircleMarker (same renderer as the fill),
        so DOM order within the SVG guarantees the dot paints above the fill.
        This test verifies the fill is NOT the topmost element at the dot's
        center.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon_four_points"))
            page.wait_for_timeout(500)

            info = page.evaluate(_js("MeasureControl/read_polygon_centroid_probe"))
            assert not info.get("error"), f"probe error: {info.get('error')}"
            assert not errors, f"JS errors: {errors}"
            assert info["dotIsPath"], "centroid dot should be an SVG path"
            assert info["dotPane"] == "node", f"dot not in node pane: {info}"
            assert info["fillPane"] == "graph", f"fill not in graph pane: {info}"
            assert info["dotAboveFill"], f"node pane z below graph pane: {info}"

            # After zoom, sortLayers re-sorts by Y. Since the dot is an SVG
            # path (not a div-icon marker), it's unaffected by z-index re-sort.
            page.evaluate(_js("MeasureControl/set_zoom"), 13)
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/set_zoom"), 11)
            page.wait_for_timeout(500)

            info2 = page.evaluate(_js("MeasureControl/read_polygon_centroid_probe"))
            assert not info2.get("error"), (
                f"post-zoom probe error: {info2.get('error')}"
            )
            assert info2["dotAboveFill"], "after zoom: node pane z below graph pane"

    def test_polygon_centroid_label_above_dot(self, browser, tmp_path):
        """The centroid area chip must paint above the centroid dot.

        Regression for "centroid dot covers the area chip (z-order)": the label pane paints
        above the node pane (graph < node < label), so the centroid chip always
        sits over the centroid dot by pane z-index. Without this guarantee the
        dot could visually consume the chip, hiding the area readout on top of
        a filled polygon.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon_four_points"))
            page.wait_for_timeout(500)

            info = page.evaluate(_js("MeasureControl/read_centroid_z_order"))
            assert not info.get("error"), f"probe error: {info}"
            assert not errors, f"JS errors: {errors}"
            assert info["labelAboveDot"], (
                f"centroid label pane must be above the node pane, got {info}"
            )
            assert info["dotAboveFill"], (
                f"centroid dot must still paint above the fill: {info}"
            )

    def test_polygon_node_delete(self, browser, tmp_path):
        """Toggle polygon delete icons without raising JS errors."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon_four_points"))
            page.wait_for_timeout(500)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            # Delete the polygon
            page.evaluate(_js("MeasureControl/toggle_polygon_delete"))
            page.wait_for_timeout(300)
            assert not errors, f"JS errors: {errors}"

    def test_restore_polygon_from_storage(self, browser, tmp_path):
        """restorePolygon restores a polygon measurement from localStorage."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_polygon_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 restored polygon, got {count}"
            area = page.evaluate(_js("MeasureControl/read_measurements_area"))
            assert area == 500000, f"expected area 500000, got {area}"
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after restoring polygon"
            assert not errors, f"JS errors: {errors}"
