"""Mode / layer-interaction tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestMeasureModeBrowser:
    def test_register_on_first_click(self, browser, tmp_path):
        """Layer is registered immediately on tool select, visible on map."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(500)
            # Tool selected — registered immediately (needed to show hidden layer)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, (
                "Layer should be registered immediately after tool select"
            )
            # First click on map — triggers content addition
            page.evaluate(_js("MeasureControl/click_map_start_point"))
            page.wait_for_timeout(500)
            # Second click + right-click to finish
            page.evaluate(_js("MeasureControl/click_map_point"))
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/finish_measurement"))
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after completing measurement"
            assert not errors, f"JS errors: {errors}"

    def test_add_graph_adds_content(self, browser, tmp_path):
        """mainLayer.addLayer() auto-registers the layer."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/add_polyline_to_main_layer"))
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "addLayer should auto-register"
            assert not errors, f"JS errors: {errors}"

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """mainLayer.removeLayer removes a single layer without affecting others."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/remove_single_layer"))
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_window_test"))
            assert registered, "layer should remain registered after removing one item"
            assert not errors, f"JS errors: {errors}"

    def test_escape_cancels_mode(self, browser, tmp_path):
        """Pressing Escape while drawing cancels the mode."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/start_distance"))
            page.wait_for_timeout(300)
            # Press Escape
            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(200)
            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            assert not errors, f"JS errors: {errors}"

    def test_measure_mode_disables_other_layer_interaction(self, browser, tmp_path):
        """Activating a measure mode disables interactivity on other map layers
        (so clicks fall through to the map), and exiting restores it."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("MeasureControl/read_marker_interactive_state"))
            assert state["before"] is True, (
                f"marker should start interactive, got {state!r}"
            )
            assert state["during"] is False, (
                f"marker should be non-interactive while measuring, got {state!r}"
            )
            assert state["iconDuring"] is False, (
                f"leaflet-interactive class removed while measuring: {state!r}"
            )
            assert state["after"] is True, (
                f"marker should be interactive again after exit, got {state!r}"
            )
            assert state["iconAfter"] is True, (
                f"leaflet-interactive class restored after exit: {state!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clear_button_empties_everything(self, browser, tmp_path):
        """Clicking the CLEAR tool button removes all measurements and layers."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Add some content
            page.evaluate(_js("MeasureControl/add_layers_and_measurements"))
            page.wait_for_timeout(200)
            # Click CLEAR button
            page.evaluate(_js("MeasureControl/click_clear_button"))
            page.wait_for_timeout(300)
            # All sub-layers should be empty
            subLayersEmpty = page.evaluate(_js("MeasureControl/read_sub_layers_empty"))
            assert subLayersEmpty, "expected all sub-layers to be empty after clear"
            # Measurements should be empty
            meas = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"

    def test_same_tool_toggle_clears_mode(self, browser, tmp_path):
        """Clicking the same tool button twice clears the mode."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(200)
            mode1 = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode1 == "distance", f"expected distance mode, got {mode1}"
            # Click same button again
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(200)
            mode2 = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode2 is None, f"expected mode cleared, got {mode2}"
            assert not errors, f"JS errors: {errors}"
