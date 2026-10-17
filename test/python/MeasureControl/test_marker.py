"""Marker-mode tests for foliplus.MeasureControl."""

from __future__ import annotations

import json

from conftest import _js, use_page

from .helper import _make_page


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
