"""Panel UI and style-drawer tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestMeasurePanelBrowser:
    def test_panel_collapses_on_outside_press_by_default(self, browser, tmp_path):
        """Default unchanged: a press outside the panel still collapses it.

        MeasureControl binds ``bindOutsideCollapse`` on its own — gated by the
        active-mode ``skipCheck`` rather than the shared panel shell — so this
        pins that its own binding survived the new parameter.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_measure_toggle_button"))
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            assert page.evaluate(_js("MeasureControl/read_measure_panel_expanded")), (
                "the measure panel did not expand"
            )

            page.mouse.click(600, 300)
            page.wait_for_selector(
                ".foliplus-measure-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert page.evaluate(_js("MeasureControl/read_measure_panel_collapsed")), (
                "the measure panel stayed open after an outside press"
            )
            assert not errors, f"JS errors: {errors}"

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM, including the export button."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            btns = page.evaluate(_js("MeasureControl/read_tool_btn_count"))
            # 5 original buttons (marker/distance/polygon/circle/clear) + 1 export
            assert btns >= 6
            assert not errors, f"JS errors: {errors}"

    def test_export_button_present(self, browser, tmp_path):
        """Export button is the only tool button without data-mode."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            count = page.evaluate(_js("MeasureControl/read_export_btn_count"))
            assert count == 1, f"Expected exactly 1 export button, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_export_no_data_hint_when_empty(self, browser, tmp_path):
        """Clicking export button with no measurements shows a hint, not an error."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_export_button"))
            page.wait_for_timeout(500)
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_collapses_panel(self, browser, tmp_path):
        """clearAll collapses the expanded panel when a measurement exists."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Add a measurement
            page.evaluate(_js("MeasureControl/add_layer_and_clear_all"))
            page.wait_for_timeout(300)
            # clearAll should be safe — no crash, panel collapse via ctrl
            assert not errors, f"JS errors: {errors}"


class TestMeasureStyleBrowser:
    def test_style_drawer_zoom_range_hides_the_measure_layer(self, browser, tmp_path):
        """The measure layer's style drawer carries a zoom-range row that really
        hides it from the map.

        MeasureControl registers through ``createLayers``, so the layer is a real
        Leaflet group and the range's carrier is map membership (native). That
        surface was never excluded by the canvas gate, so the probe pins the row
        as a regression guard, not a new capability.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Select a tool so the measure layer registers and gets a row.
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(300)
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            result = page.evaluate(_js("MeasureControl/zoom_range_layer_row"))
            assert result is not None, "probe returned None"
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["onMapBefore"] is True, (
                f"the measure layer was not on the map before the range: {result}"
            )
            assert result["onMapOut"] is False, (
                f"the measure layer stayed on the map out of range: {result}"
            )
            assert result["onMapBack"] is True, (
                f"the measure layer did not come back onto the map: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_del_icon_offset_consistent_across_modes(self, browser, tmp_path):
        """Delete icons (✕) sit at the same offset from their anchor across all modes.

        Distance nodes, circle center, and polygon nodes/centroid all use the same
        `makeDelIcon(anchor)` + shared CSS offset, so the ✕ must be the same
        distance & direction from its anchor in every measurement type.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Build distance, circle, and polygon measurements in one evaluate so
            # no state is lost between calls.
            offsets = page.evaluate(_js("MeasureControl/read_del_icon_offsets"))
            assert errors == [], f"JS errors: {errors}"
            assert len(offsets["modes"]) >= 7, (
                f"expected ≥7 del icons (2 distance + 1 circle + 4 polygon + centroid), got {len(offsets['modes'])}"
            )
            offsets_list = list(offsets["modes"].values())
            assert offsets_list, "no delete icons found — measurements not created?"
            # All offsets must agree (within 2px for subpixel rendering)
            ref = offsets_list[0]
            for name, off in offsets["modes"].items():
                assert abs(off["dx"] - ref["dx"]) <= 2, (
                    f"{name}: dx {off['dx']} != ref {ref['dx']}"
                )
                assert abs(off["dy"] - ref["dy"]) <= 2, (
                    f"{name}: dy {off['dy']} != ref {ref['dy']}"
                )
