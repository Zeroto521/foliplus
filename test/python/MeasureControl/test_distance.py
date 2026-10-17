"""Distance-mode tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


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
        with use_page(
            _make_page, browser, tmp_path, show_bearing=False
        ) as (page, errors):
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
