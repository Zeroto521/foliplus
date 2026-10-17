"""Persistence tests for foliplus.MeasureControl."""

from __future__ import annotations

import json

from conftest import _js, use_page

from .helper import _make_page


class TestMeasurePersistBrowser:
    def test_save_measurements_stores_to_localStorage(self, browser, tmp_path):
        """saveMeasurements() writes measurements to localStorage."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_marker_measurement"))
            data = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            assert data is not None, "localStorage should contain saved measurements"

            parsed = json.loads(data)
            assert len(parsed["items"]) == 1
            assert parsed["items"][0]["type"] == "marker"
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_clears_measurements_and_storage(self, browser, tmp_path):
        """clearAll() empties measurements array and persists to localStorage."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_then_clear_measurements"))
            data = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            parsed = json.loads(data) if data else []
            assert len(parsed["items"]) == 0, "clearAll should empty localStorage"
            assert not errors, f"JS errors: {errors}"

    def test_map_unload_keeps_measurements(self, browser, tmp_path):
        """Regression: map unload must NOT wipe persisted measurements.

        unload previously called clearAll(), which wrote an empty array back to
        localStorage — a data-loss risk on page refresh. It must only clear
        transient UI state and keep the persisted measurements.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_then_unload"))
            data = page.evaluate(_js("MeasureControl/read_localStorage_measurements"))
            parsed = json.loads(data) if data else []
            assert len(parsed["items"]) == 1, (
                "unload should keep persisted measurements"
            )
            assert not errors, f"JS errors: {errors}"

    def test_restore_distance_from_storage(self, browser, tmp_path):
        """restoreDistance restores a distance measurement from localStorage without ReferenceError."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_distance_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 1, f"expected 1 restored distance, got {count}"
            registered = page.evaluate(_js("MeasureControl/read_layers_registered"))
            assert registered, "Layer should be registered after restoring distance"
            assert not errors, f"JS errors: {errors}"

    def test_load_measurements_corrupted_json(self, browser, tmp_path):
        """Corrupted localStorage JSON falls back to an empty array (no crash)."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            # Write corrupted JSON
            page.evaluate(_js("MeasureControl/seed_corrupt_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate(_js("MeasureControl/read_measurements_length"))
            assert count == 0, f"expected 0 measurements, got {count}"
            assert not errors, f"JS errors: {errors}"
