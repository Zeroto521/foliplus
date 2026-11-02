"""Lifecycle / cleanup tests for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


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
            page.evaluate(_js("MeasureControl/add_layers"))
            page.wait_for_timeout(500)
            page.evaluate(_js("MeasureControl/clear_layers"))
            page.wait_for_timeout(500)
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert not registered, "destroy should unregister the layer"
            assert not errors, f"JS errors: {errors}"
