"""Polygon-mode tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


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
