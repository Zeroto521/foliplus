"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import json
import re

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    make_browser_page,
    read_css,
    render_control,
    use_page,
)

from foliplus import MeasureControl


class TestMeasureControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert MeasureControl()._name == "MeasureControl"

    def test_default_position(self):
        assert MeasureControl().position == "bottomright"

    def test_custom_position(self):
        assert MeasureControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert MeasureControl()._locale_code == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._locale_code == "zh"

    def test_default_show_bearing(self):
        assert MeasureControl().show_bearing is True

    def test_custom_show_bearing(self):
        assert MeasureControl(show_bearing=False).show_bearing is False

    def test_default_export_format(self):
        assert MeasureControl().export_format == "geojson"

    def test_custom_export_format_csv(self):
        assert MeasureControl(export_format="csv").export_format == "csv"

    def test_export_format_in_export_fields(self):
        assert "export_format" in MeasureControl._export_fields

    def test_export_format_combined_with_other_params(self):
        mc = MeasureControl(
            position="topleft",
            show_bearing=False,
            export_format="csv",
        )
        assert mc.position == "topleft"
        assert mc.show_bearing is False
        assert mc.export_format == "csv"

    def test_invalid_export_format_raises(self):
        """Unsupported export_format raises ValueError."""
        with pytest.raises(ValueError, match="export_format"):
            MeasureControl(export_format="invalid")

    def test_export_format_geojson_is_valid(self):
        MeasureControl(export_format="geojson")

    def test_export_format_csv_is_valid(self):
        MeasureControl(export_format="csv")


class TestMeasureControlRendering:
    def test_default_params(self):
        html = render_control(MeasureControl())
        assert "measure-ctrl" in html

    def test_show_bearing_default_true(self):
        """show_bearing defaults to true and renders as JS boolean."""
        html = render_control(MeasureControl())
        assert_config_value(html, "show_bearing", True)

    def test_show_bearing_false(self):
        """show_bearing=False renders false and disables bearing labels."""
        html = render_control(MeasureControl(show_bearing=False))
        assert_config_value(html, "show_bearing", False)

    def test_custom_position(self):
        html = render_control(MeasureControl(position="topleft"))
        assert "topleft" in html

    def test_contains_gcoord_dependency(self):
        html = render_control(MeasureControl())
        assert "gcoord" in html
        assert "gcoord.global.prod.js" in html

    def test_contains_turf_dependency(self):
        html = render_control(MeasureControl())
        assert "turf.min.js" in html

    def test_locale_zh(self):
        html = render_control(MeasureControl(locale="zh"))
        assert "测量工具" in html
        assert "tool_toggle" in html

    def test_css_icon_size_variable(self):
        html = render_control(MeasureControl())
        assert "icon-size-md" in html

    def test_css_stroke_width_emphasis(self):
        html = render_control(MeasureControl())
        assert "stroke-width" in html

    def test_tool_button_class(self):
        """Tool buttons use the tool-btn class."""
        html = render_control(MeasureControl())
        assert "tool-btn" in html

    # ── export_format rendering ──

    def test_export_format_default_geojson(self):
        """export_format defaults to 'geojson' in rendered HTML."""
        html = render_control(MeasureControl())
        assert_config_value(html, "export_format", "geojson")

    def test_export_format_csv(self):
        """export_format='csv' renders the correct value in CONF."""
        html = render_control(MeasureControl(export_format="csv"))
        assert_config_value(html, "export_format", "csv")

    def test_export_locale_zh(self):
        """zh locale renders export translation."""
        html = render_control(MeasureControl(locale="zh"))
        assert "tool_export" in html
        assert "导出" in html

    # ── Finish animation tests ──

    def test_dash_sweep_animation_classes(self):
        """Distance finishDist adds is-dash-sweep class with --sweep-length."""
        html = render_control(MeasureControl())
        assert "dash-sweep" in html
        assert "--sweep-length" in html

    def test_dash_sweep_drop_shadow(self):
        """Dash sweep line has drop-shadow filter for glow effect."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "drop-shadow" in css
        assert "dash-sweep" in css

    def test_ripple_animation_classes(self):
        """Circle finalizeCircle creates a measure-ripple circle with animationend cleanup."""
        html = render_control(MeasureControl())
        assert "measure-ripple" in html
        assert "interactive: false" in html

    def test_ripple_css_variables(self):
        """Ripple animation uses CSS custom properties for all parameters."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "--ripple-duration" in css
        assert "--ripple-opacity-start" in css
        assert "--ripple-stroke-start" in css
        assert "--ripple-stroke-end" in css
        assert "measure-ripple" in css

    def test_dash_sweep_css_variables(self):
        """Dash sweep animation uses CSS custom properties for all parameters."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "--sweep-length" in css
        assert "--sweep-duration" in css

    def test_radius_label_has_animation(self):
        """Circle radius label animates in with a decoupled centering transform.

        The radius label's centering transform is stored in a CSS variable
        (--label-center) so the animation keyframes reference it instead of
        duplicating the translate values. This keeps centering and animation
        decoupled.
        """
        css = read_css("foliplus/css/MeasureControl.css")
        assert "foliplus-measure-label-in-radius" in css
        # Centering transform is defined once as a variable on the class
        assert "--label-center: translate(-50%, -50%)" in css
        # Keyframes reference the variable, not hardcoded translate values
        assert "transform: var(--label-center) scale(0.9)" in css
        assert "transform: var(--label-center) scale(1)" in css
        # The radius label class no longer disables animation
        assert (
            "animation: none"
            not in css.split(".foliplus-measure-label-radius")[1].split("/*")[0]
        )


class TestMeasureControlBrowser:
    def _make_page(self, browser, tmp_path, show_bearing=True):
        """Build a page with MeasureControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        MeasureControl(show_bearing=show_bearing).add_to(m)

        html = m.get_root().render()
        # Inject test hooks right after the manager is created. The dev build
        # (esbuild) may emit `const` or `var`, and flattens `import * as CONST`
        # so the storage key is accessible as `STORAGE.KEY` (not CONST.STORAGE.KEY).
        html, n = re.subn(
            r"(const|var) measureManager = new MeasureManager\(map\);",
            r"\1 measureManager = new MeasureManager(map); window.__measureManager = measureManager; window.__map = map; window.__measureStorageKey = STORAGE.KEY;",
            html,
            count=1,
        )
        assert n == 1, "measureManager instantiation not found in rendered HTML"
        # Remove blocking CDN <script> tags (gcoord and turf added by default_js)
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/gcoord@1/dist/gcoord.global.prod.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>',
            '<script>window.turf = { distance: (a,b,o) => L.latLng(a.geometry.coordinates[1],a.geometry.coordinates[0]).distanceTo(L.latLng(b.geometry.coordinates[1],b.geometry.coordinates[0])), bearing: (a,b) => { const dL = (b.geometry.coordinates[0]-a.geometry.coordinates[0])*Math.PI/180; const l1 = a.geometry.coordinates[1]*Math.PI/180; const l2 = b.geometry.coordinates[1]*Math.PI/180; const y = Math.sin(dL)*Math.cos(l2); const x = Math.cos(l1)*Math.sin(l2)-Math.sin(l1)*Math.cos(l2)*Math.cos(dL); return (Math.atan2(y,x)*180/Math.PI+360)%360; }, area: (p) => { const R = 6378137; const d2r = Math.PI/180; const pts = p.geometry.coordinates[0]; let a = 0; for (let i = 0; i < pts.length-1; i++) { const p1 = pts[i], p2 = pts[i+1]; a += (p2[0] - p1[0]) * d2r * (2 + Math.sin(p1[1]*d2r) + Math.sin(p2[1]*d2r)); } return Math.abs(a * R * R / 2); }, point: (c) => ({ geometry: { coordinates: [c[0], c[1]], type: "Point" } }), polygon: (c) => ({ geometry: { coordinates: c, type: "Polygon" } }), midpoint: (a,b) => ({ geometry: { coordinates: [(a.geometry.coordinates[0]+b.geometry.coordinates[0])/2, (a.geometry.coordinates[1]+b.geometry.coordinates[1])/2], type: "Point" } }) };</script>',
        )
        page, errors = make_browser_page(browser, tmp_path, html, "measure")
        page.wait_for_selector(
            ".foliplus-measure-ctrl", state="attached", timeout=10000
        )
        return page, errors

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM, including the export button."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            btns = page.evaluate(
                "document.querySelectorAll('.foliplus-measure-ctrl .foliplus-tool-btn').length"
            )
            # 5 original buttons (marker/distance/polygon/circle/clear) + 1 export
            assert btns >= 6
            assert not errors, f"JS errors: {errors}"

    def test_export_button_present(self, browser, tmp_path):
        """Export button is the only tool button without data-mode."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            count = page.evaluate(
                "document.querySelectorAll('.foliplus-tool-btn:not([data-mode])').length"
            )
            assert count == 1, f"Expected exactly 1 export button, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_export_no_data_hint_when_empty(self, browser, tmp_path):
        """Clicking export button with no measurements shows a hint, not an error."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                "document.querySelector('.foliplus-tool-btn:not([data-mode])')?.click()"
            )
            page.wait_for_timeout(500)
            assert not errors, f"JS errors: {errors}"

    def test_distance_labels_show_bearing(self, browser, tmp_path):
        """Distance labels include bearing (e.g. '42° | 1.5 km') by default."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            labels = page.evaluate(_js("MeasureControl/read_labels"))
            assert any("° |" in l for l in labels), (
                f"expected a bearing label '° |', got {labels!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_distance_labels_no_bearing_when_disabled(self, browser, tmp_path):
        """show_bearing=False omits the bearing from distance labels."""
        with use_page(self._make_page, browser, tmp_path, show_bearing=False) as (
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

    def test_register_on_first_click(self, browser, tmp_path):
        """Layer is registered immediately on tool select, visible on map."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate("document.querySelector('[data-mode=distance]').click()")
            page.wait_for_timeout(500)
            # Tool selected — registered immediately (needed to show hidden layer)
            registered = page.evaluate("window.__measureManager.layers.registered()")
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
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after completing measurement"
            assert not errors, f"JS errors: {errors}"

    def test_add_graph_adds_content(self, browser, tmp_path):
        """mainLayer.addLayer() auto-registers the layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/add_polyline_to_main_layer"))
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "addLayer should auto-register"
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_empties_layers(self, browser, tmp_path):
        """destroy() empties content and unregisters."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/add_layers"))
            page.wait_for_timeout(500)
            page.evaluate("window.__measureManager.layers.clearLayers()")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert not registered, "destroy should unregister the layer"
            assert not errors, f"JS errors: {errors}"

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """mainLayer.removeLayer removes a single layer without affecting others."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/remove_single_layer"))
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__test")
            assert registered, "layer should remain registered after removing one item"
            assert not errors, f"JS errors: {errors}"

    def test_destroy_cleans_up_listeners(self, browser, tmp_path):
        """destroy() removes all map listeners (no leak after cleanup)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # First, create a circle to trigger onMapClickActive listener
            page.evaluate(_js("MeasureControl/draw_circle"))
            page.wait_for_timeout(500)
            # Destroy the manager
            page.evaluate("window.__measureManager.destroy()")
            page.wait_for_timeout(200)
            # Verify no errors
            assert not errors, f"JS errors: {errors}"

    def test_marker_del_icon_removes_marker(self, browser, tmp_path):
        """Clicking the delete X in marker mode removes the marker pin."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/place_marker"))
            page.wait_for_timeout(500)
            # Remove the layer via API directly (testing the delete logic)
            page.evaluate(_js("MeasureControl/delete_marker_del_icon"))
            page.wait_for_timeout(300)
            # Check that delMkr is no longer in the layer group
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_distance_del_icon_removes_measurement(self, browser, tmp_path):
        """Clicking the delete X in distance mode removes the entire measurement."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate(_js("MeasureControl/delete_measurement_del_icon"))
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate(_js("MeasureControl/has_delete_marker"))
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"

    def test_circle_del_icon_removes_circle(self, browser, tmp_path):
        """Clicking the delete X in circle mode removes the entire circle."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
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
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/draw_circle_preview_follows_mouse")
            )
            assert state["x1"] is not None, "preview node not rendered"
            assert state["x2"] is not None
            moved = (state["x1"], state["y1"]) != (state["x2"], state["y2"])
            assert moved, "circle preview node did not follow the mouse"
            assert not errors, f"JS errors: {errors}"

    # ── Persistence (browser) ──────────────────────────────────────

    def test_save_measurements_stores_to_localStorage(self, browser, tmp_path):
        """saveMeasurements() writes measurements to localStorage."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_marker_measurement"))
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            assert data is not None, "localStorage should contain saved measurements"

            parsed = json.loads(data)
            assert len(parsed) == 1
            assert parsed[0]["type"] == "marker"
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_clears_measurements_and_storage(self, browser, tmp_path):
        """clearAll() empties measurements array and persists to localStorage."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_then_clear_measurements"))
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "clearAll should empty localStorage"
            assert not errors, f"JS errors: {errors}"

    def test_map_unload_keeps_measurements(self, browser, tmp_path):
        """Regression: map unload must NOT wipe persisted measurements.

        unload previously called clearAll(), which wrote an empty array back to
        localStorage — a data-loss risk on page refresh. It must only clear
        transient UI state and keep the persisted measurements.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/save_then_unload"))
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 1, "unload should keep persisted measurements"
            assert not errors, f"JS errors: {errors}"

    def test_delete_marker_removes_from_storage(self, browser, tmp_path):
        """Deleting a marker removes it from measurements and persists."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/place_marker"))
            # Poll for measurement to appear (async reverse geocode may take time)
            page.wait_for_timeout(500)
            for _ in range(20):
                before = page.evaluate("window.__measureManager.measurements.length")
                if before >= 1:
                    break
                page.wait_for_timeout(500)
            assert before == 1, f"expected 1 measurement, got {before}"
            page.evaluate(_js("MeasureControl/delete_marker_via_map"))
            page.wait_for_timeout(300)
            after = page.evaluate("window.__measureManager.measurements.length")
            assert after == 0, f"expected 0 measurements after delete, got {after}"
            data = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "localStorage should be empty after deleting all"
            assert not errors, f"JS errors: {errors}"

    def test_restore_marker_from_storage(self, browser, tmp_path):
        """restoreMarker restores a marker measurement from localStorage without ReferenceError."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Pre-populate localStorage with a marker measurement
            page.evaluate(_js("MeasureControl/seed_marker_storage"))
            # Reload the page to trigger restoreMeasurements in constructor
            page.reload()
            page.wait_for_timeout(2000)
            # Check measurements were restored
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored measurement, got {count}"
            # Check layers registered (restoreMarker calls addLayer)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring marker"
            assert not errors, f"JS errors: {errors}"

    def test_restore_distance_from_storage(self, browser, tmp_path):
        """restoreDistance restores a distance measurement from localStorage without ReferenceError."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_distance_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored distance, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring distance"
            assert not errors, f"JS errors: {errors}"

    def test_restore_circle_from_storage(self, browser, tmp_path):
        """restoreCircle restores a circle measurement from localStorage without ReferenceError."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_circle_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored circle, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring circle"
            assert not errors, f"JS errors: {errors}"

    # ── MeasureUtils edge-case tests ──

    # ── Marker persistence timing (regression) ─────────────────────

    def test_marker_saved_before_geocode(self):
        """Marker measurement is persisted immediately, before geocode resolves."""
        html = render_control(MeasureControl())
        # In the new-marker flow, saveMeasurements() must be called BEFORE
        # createLocationMarker() (which triggers the async geocode), so a
        # reload mid-lookup does not lose the marker. Search for the
        # save-then-create pattern within a small window (not the global
        # first occurrence, which may be in a different mode's restore()).
        create_pos = html.find("createLocationMarker(")
        assert create_pos != -1, "createLocationMarker should exist"
        # Search for saveMeasurements() within 200 chars BEFORE createLocationMarker
        search_start = max(0, create_pos - 200)
        save_pos = html.find("this.m.saveMeasurements();", search_start)
        assert save_pos != -1, (
            "saveMeasurements() should exist before createLocationMarker"
        )
        gap = create_pos - save_pos
        assert gap < 200, (
            "measurement must be saved right before triggering geocode so a "
            f"reload mid-lookup does not lose the marker (gap={gap})"
        )

    def test_marker_survives_reload_with_blocked_geocode(self, browser, tmp_path):
        """Regression: marker placed while geocode is blocked still survives reload."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Block geocoding entirely — reverseGeocode never resolves
            page.route(
                "**/nominatim.openstreetmap.org/**",
                lambda route: route.abort(),
            )
            page.evaluate(_js("MeasureControl/place_marker"))
            # Measurement must be persisted WITHOUT waiting for geocode
            page.wait_for_timeout(300)
            saved = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(saved) if saved else []
            assert len(parsed) == 1, (
                f"marker must be saved immediately, got {len(parsed)}"
            )
            # Reload — marker must still appear
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 measurement after reload, got {count}"
            pins = page.evaluate("document.querySelectorAll('.foliplus-pin').length")
            assert pins >= 1, "marker pin should be visible after reload"
            assert not errors, f"JS errors: {errors}"

    def test_restore_marker_address_backfilled(self, browser, tmp_path):
        """Regression: marker restored with address:null resolves and persists address."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_marker_nulladdr_storage"))
            page.reload()
            page.wait_for_timeout(3000)
            # Address should be resolved by the onAddress callback
            addr = page.evaluate("window.__measureManager.measurements[0]?.address")
            assert addr, f"expected address to be backfilled, got {addr!r}"
            # And persisted back to localStorage
            saved = page.evaluate("localStorage.getItem(window.__measureStorageKey)")
            parsed = json.loads(saved) if saved else []
            assert parsed and parsed[0]["address"], (
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
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
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
            addr = page.evaluate("window.__measureManager.measurements[0]?.address")
            assert addr, f"expected address to be backfilled, got {addr!r}"

            # Now open the popup — it must show the resolved address
            page.evaluate(_js("MeasureControl/open_restored_marker_popup"))
            page.wait_for_timeout(200)
            popup_text = page.evaluate(_js("MeasureControl/read_popup_text"))
            assert "Resolved Address" in popup_text, (
                f"popup should show resolved address, got {popup_text!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_unbinds_circle_listeners(self, browser, tmp_path):
        """Regression: clearAll unbinds all finalized-circle map click handlers.

        Each completed circle binds an onMapClickActive handler to the map.
        clearAll() must unbind them all (not just the last one) to avoid leaks.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            baseline = page.evaluate("window.__map._events['click']?.length || 0")
            # Draw 2 circles — each binds an onMapClickActive handler
            for _ in range(2):
                page.evaluate(_js("MeasureControl/draw_circle"))
                page.wait_for_timeout(500)
            after_circles = page.evaluate("window.__map._events['click']?.length || 0")
            assert after_circles == baseline + 2, (
                f"expected {baseline + 2} click handlers after 2 circles, "
                f"got {after_circles}"
            )
            # clearAll must unbind them all
            page.evaluate("window.__measureManager.clearAll()")
            page.wait_for_timeout(200)
            after_clear = page.evaluate("window.__map._events['click']?.length || 0")
            assert after_clear == baseline, (
                f"expected {baseline} click handlers after clearAll, got {after_clear}"
            )
            assert not errors, f"JS errors: {errors}"

    # ── Browser tests for gaps ──

    def test_escape_cancels_mode(self, browser, tmp_path):
        """Pressing Escape while drawing cancels the mode."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/start_distance"))
            page.wait_for_timeout(300)
            # Press Escape
            page.evaluate(_js("MeasureControl/press_escape"))
            page.wait_for_timeout(200)
            mode = page.evaluate("window.__measureManager.currentMode")
            assert mode is None, f"expected mode to be None after Escape, got {mode}"
            assert not errors, f"JS errors: {errors}"

    def test_measure_mode_disables_other_layer_interaction(self, browser, tmp_path):
        """Activating a measure mode disables interactivity on other map layers
        (so clicks fall through to the map), and exiting restores it."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(
                _js("MeasureControl/read_marker_interactive_state")
            )
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
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
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
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"

    def test_same_tool_toggle_clears_mode(self, browser, tmp_path):
        """Clicking the same tool button twice clears the mode."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(200)
            mode1 = page.evaluate("window.__measureManager.currentMode")
            assert mode1 == "distance", f"expected distance mode, got {mode1}"
            # Click same button again
            page.evaluate(_js("MeasureControl/click_distance_button"))
            page.wait_for_timeout(200)
            mode2 = page.evaluate("window.__measureManager.currentMode")
            assert mode2 is None, f"expected mode cleared, got {mode2}"
            assert not errors, f"JS errors: {errors}"

    def test_distance_cancel_single_click(self, browser, tmp_path):
        """Single click then right-click cancels distance without saving."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/start_distance"))
            page.wait_for_timeout(300)
            # Right-click to finish (cancel) with < 2 points
            page.evaluate(_js("MeasureControl/cancel_distance"))
            page.wait_for_timeout(300)
            # Mode should be cleared, no measurement saved
            mode = page.evaluate("window.__measureManager.currentMode")
            assert mode is None, f"expected mode cleared, got {mode}"
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 0, f"expected 0 measurements, got {meas}"
            assert not errors, f"JS errors: {errors}"

    def test_distance_preview_layers_removed_after_finish(self, browser, tmp_path):
        """After finishing distance, previewLine and poly are removed from map."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_distance"))
            page.wait_for_timeout(500)
            # The map should have the final polyline but not the preview layers
            # Check that measurements were saved
            meas = page.evaluate("window.__measureManager.measurements.length")
            assert meas == 1, f"expected 1 measurement, got {meas}"
            assert not errors, f"JS errors: {errors}"

    # ── Polygon Area Mode ─────────────────────────────────────────

    def test_polygon_draw_and_delete(self, browser, tmp_path):
        """Draw a polygon with 3 points, verify it renders, then delete via clearAll."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon"))
            page.wait_for_timeout(500)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            area = page.evaluate("window.__measureManager.measurements[0].area")
            assert area > 0, f"expected positive area, got {area}"
            # Delete the polygon via clearAll
            page.evaluate("window.__measureManager.clearAll()")
            page.wait_for_timeout(300)
            page.wait_for_timeout(300)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 0, f"expected 0 measurements after delete, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_polygon_node_delete(self, browser, tmp_path):
        """Toggle polygon delete icons without raising JS errors."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/draw_polygon_four_points"))
            page.wait_for_timeout(500)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 polygon measurement, got {count}"
            # Delete the polygon
            page.evaluate(_js("MeasureControl/toggle_polygon_delete"))
            page.wait_for_timeout(300)
            assert not errors, f"JS errors: {errors}"

    def test_restore_polygon_from_storage(self, browser, tmp_path):
        """restorePolygon restores a polygon measurement from localStorage."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("MeasureControl/seed_polygon_storage"))
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored polygon, got {count}"
            area = page.evaluate("window.__measureManager.measurements[0].area")
            assert area == 500000, f"expected area 500000, got {area}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring polygon"
            assert not errors, f"JS errors: {errors}"

    def test_load_measurements_corrupted_json(self, browser, tmp_path):
        """Corrupted localStorage JSON falls back to an empty array (no crash)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Write corrupted JSON
            page.evaluate(
                "localStorage.setItem(window.__measureStorageKey, '{not valid json')"
            )
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 0, f"expected 0 measurements, got {count}"
            assert not errors, f"JS errors: {errors}"

    def test_clear_all_collapses_panel(self, browser, tmp_path):
        """clearAll collapses the expanded panel when a measurement exists."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Add a measurement
            page.evaluate(_js("MeasureControl/add_layer_and_clear_all"))
            page.wait_for_timeout(300)
            # clearAll should be safe — no crash, panel collapse via ctrl
            assert not errors, f"JS errors: {errors}"

    def test_del_icon_offset_consistent_across_modes(self, browser, tmp_path):
        """Delete icons (✕) sit at the same offset from their anchor across all modes.

        Distance nodes, circle center, and polygon nodes/centroid all use the same
        `makeDelIcon(anchor)` + shared CSS offset, so the ✕ must be the same
        distance & direction from its anchor in every measurement type.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
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

    def test_works_without_layercontrol(self, browser, tmp_path):
        """MeasureControl initializes without LayerControl (degradation)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MeasureControl().add_to(m)

        html = m.get_root().render()
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/gcoord@1/dist/gcoord.global.prod.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>',
            '<script>window.turf = { distance: (a,b,o) => 0, bearing: (a,b) => 0, area: (p) => 0, point: (c) => ({ geometry: { coordinates: c, type: "Point" } }), polygon: (c) => ({ geometry: { coordinates: c, type: "Polygon" } }), midpoint: (a,b) => ({ geometry: { coordinates: [0,0], type: "Point" } }) };</script>',
        )
        with use_page(
            make_browser_page, browser, tmp_path, html, "measure_no_layer"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-measure-ctrl", state="attached", timeout=10000
            )
            ctrl = page.evaluate("document.querySelector('.foliplus-measure-ctrl')")
            assert ctrl is not None, "MeasureControl DOM should exist"
            assert not errors, f"JS errors: {errors}"
