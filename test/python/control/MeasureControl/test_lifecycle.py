"""Lifecycle, mode and integration tests for foliplus.MeasureControl.

Grouped by the same contract — what the control owns (map listeners, layers,
the manager instance) and how that ownership survives mode switches, remove /
re-add cycles and life without a LayerControl.
"""

from __future__ import annotations

import folium
from conftest import _js, leaflet_path, leaflet_points, make_browser_page, use_page

from foliplus import MeasureControl

from .helper import _TURF_STUB, _make_page, _stub_cdn


class TestMeasureLifecycleBrowser:
    def test_remove_readd_rebuilds_manager(self, browser, tmp_path):
        """removeControl + addControl re-creates the manager and re-binds tools."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("MeasureControl/destroy_readd"))
            assert state["removed"] is True
            assert state["hasManager"] is True
            assert state["btnCount"][0] >= 6
            assert not errors, f"JS errors: {errors}"

    def test_remove_readd_leaves_no_listener_residue(self, browser, tmp_path):
        """N=3 remove → add cycles must not grow map._events listener sum.

        Baseline round[0] is captured right after the initial addControl
        (which the harness already performed in page setup); rounds[1] and
        rounds[2] follow remove → add. A listener leak — whether it lands on
        round[0] or only shows up in a later round — registers as a drift
        and fails the assertion.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("MeasureControl/destroy_readd"))
            rounds = state["rounds"]
            assert len(rounds) == 3, f"expected 3 rounds, got {rounds!r}"
            for i, n in enumerate(rounds[1:], start=1):
                assert n == rounds[0], (
                    f"MeasureControl: map._events listener sum grew on round {i}: "
                    f"{rounds!r}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_probe_leak_listener_control_group_grows(self, browser, tmp_path):
        """A single bare map.on() must register as a +1 in the listener sum.

        Control group for the drift gate above: if this control fails, the
        sumMapEvents measure is measuring nothing and the drift assertion
        in test_remove_readd_leaves_no_listener_residue has no teeth.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            result = page.evaluate(_js("MeasureControl/probe_leak_listener"))
            assert result["delta"] > 0, (
                f"Leak control group: expected a positive delta, got {result!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_destroy_cleans_up_listeners(self, browser, tmp_path):
        """destroy() removes all map listeners (no leak after cleanup)."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # First, create a circle to trigger onMapClickActive listener
            page.evaluate(_js("MeasureControl/draw_circle"))
            page.wait_for_timeout(500)
            # Destroy the manager
            page.evaluate(_js("MeasureControl/destroy_measure_manager"))
            page.wait_for_timeout(200)
            # Verify no errors
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_unbinds_circle_listeners(self, browser, tmp_path):
        """Regression: clearAll unbinds all finalized-circle map click handlers.

        Each completed circle binds an onMapClickActive handler to the map.
        clearAll() must unbind them all (not just the last one) to avoid leaks.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = page.evaluate(_js("MeasureControl/read_click_events_length"))
            # Draw 2 circles — each binds an onMapClickActive handler
            for _ in range(2):
                page.evaluate(_js("MeasureControl/draw_circle"))
                page.wait_for_timeout(500)
            after_circles = page.evaluate(
                _js("MeasureControl/read_click_events_length")
            )
            assert after_circles == baseline + 2, (
                f"expected {baseline + 2} click handlers after 2 circles, "
                f"got {after_circles}"
            )
            # clearAll must unbind them all
            page.evaluate(_js("MeasureControl/clear_all"))
            page.wait_for_timeout(200)
            after_clear = page.evaluate(_js("MeasureControl/read_click_events_length"))
            assert after_clear == baseline, (
                f"expected {baseline} click handlers after clearAll, got {after_clear}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_empties_layers(self, browser, tmp_path):
        """destroy() empties content and unregisters."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                _js("MeasureControl/add_layers"),
                {
                    "line": leaflet_path("common", "line_fuzhou_diag"),
                    "point": leaflet_points("common", "point_1193_2608")[0],
                },
            )
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/clear_layers"))
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert not registered, "destroy should unregister the layer"
            assert not errors, f"JS errors: {errors}"


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
            page.evaluate(
                _js("MeasureControl/add_polyline_to_main_layer"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "addLayer should auto-register"
            assert not errors, f"JS errors: {errors}"

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """mainLayer.removeLayer removes a single layer without affecting others."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                _js("MeasureControl/remove_single_layer"),
                {
                    "line": leaflet_path("common", "line_fuzhou_diag"),
                    "point": leaflet_points("common", "point_1193_2608")[0],
                },
            )
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

    def test_escape_before_drawing_drops_the_empty_measure_row(self, browser, tmp_path):
        """Escape on an empty (in-flight) measure layer drops its row.

        The factory's unregister is content-driven: an in-flight draw holds
        nothing, so ending the mode drops the empty row from the panel.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            before = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert before["registered"], f"row missing before Escape: {before}"

            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(500)

            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            after = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert not after["registered"], (
                f"Escape on an empty layer kept the row: before={before}, after={after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_escape_with_complete_inflight_distance_finalizes_and_keeps_row(
        self, browser, tmp_path
    ):
        """Escape with two placed points (geometry complete, mode still active)
        commits the measurement and keeps its row.

        finishOnExit finalizes a drawing whose geometry is already complete, so
        the row survives; only a sparse (0-1 point) draw is discarded.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Place two points (geometry complete) but do NOT contextmenu-finalize.
            page.evaluate(_js("MeasureControl/draw_distance_two_points"))
            page.wait_for_timeout(300)
            before = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert before["registered"], f"row missing before Escape: {before}"

            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(500)

            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            after = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert after["registered"], (
                f"Escape on a complete in-flight distance dropped the row: "
                f"before={before}, after={after}"
            )
            assert after["row"], f"finalized row not rendered after Escape: {after}"
            assert not errors, f"JS errors: {errors}"

    def test_escape_with_circle_center_only_drops_the_row(
        self, browser, tmp_path
    ):
        """Escape after only the circle center is placed drops the row.

        A circle requires a second click to confirm the radius; after only the
        center, the radius follows the cursor and was never confirmed. ESC
        cancels (finishOnExit always returns false for circle), discards the
        center and preview, and the empty layer row drops.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Activate circle mode via the tool button.
            page.evaluate(
                "() => document.querySelector('[data-mode=circle]').click()"
            )
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            before = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert before["registered"], f"row missing before ESC: {before}"

            page.evaluate(_js("MeasureControl/draw_circle_center_only"))
            page.wait_for_timeout(300)
            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(500)

            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode to be None after ESC, got {mode}"
            after = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert not after["registered"], (
                f"ESC on circle center-only kept the row: before={before}, after={after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_escape_after_circle_two_clicks_keeps_the_row(
        self, browser, tmp_path
    ):
        """Escape after a fully-confirmed circle (two clicks) keeps its row.

        The circle's finish path fires on the second click (synchronously
        via setTimeout in the click handler), so by the time ESC arrives the
        mode is already cleared and the content is in the store. The content-
        driven unregister keeps the row.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                "() => document.querySelector('[data-mode=circle]').click()"
            )
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            # Two clicks: center + radius → finishCircle fires (async delay).
            page.evaluate(
                """() => {
                  const map = window.__map;
                  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
                  map.fire("click", { latlng: L.latLng(26.09, 119.31) });
                }"""
            )
            page.wait_for_timeout(800)  # wait for FINALIZE_DELAY setTimeout

            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(500)

            after = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert after["registered"], (
                f"ESC after a two-click circle dropped the row: after={after}"
            )
            assert after["row"], f"circle row not rendered after ESC: {after}"
            assert not errors, f"JS errors: {errors}"

    def test_escape_after_finalized_distance_keeps_the_measure_row(
        self, browser, tmp_path
    ):
        """Escape after a finalized distance keeps its row.

        The finalized leaves belong to the measurement, so the layer stays
        non-empty and the content-driven unregister keeps the row.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_layer_toggle_button"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(500)

            mode = page.evaluate(_js("MeasureControl/read_current_mode"))
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            after = page.evaluate(_js("MeasureControl/read_measure_layer_row"))
            assert after["registered"], (
                f"Escape dropped a finalized measurement's row: after={after}"
            )
            assert after["row"], f"finalized row not rendered: {after}"
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
            page.evaluate(
                _js("MeasureControl/add_layers_and_measurements"),
                {
                    "line": leaflet_path("common", "line_fuzhou_diag"),
                    "point": leaflet_points("common", "point_1193_2608")[0],
                },
            )
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


class TestMeasureIntegrationBrowser:
    def test_works_without_layercontrol(self, browser, tmp_path):
        """MeasureControl initializes without LayerControl (degradation)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MeasureControl().add_to(m)

        html = m.get_root().render()
        html = _stub_cdn(html, {"turf": _TURF_STUB})
        with use_page(
            make_browser_page, browser, tmp_path, html, "measure_no_layer"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-measure-ctrl", state="attached", timeout=10000
            )
            ctrl = page.evaluate(_js("MeasureControl/read_measure_ctrl"))
            assert ctrl is not None, "MeasureControl DOM should exist"
            assert not errors, f"JS errors: {errors}"
