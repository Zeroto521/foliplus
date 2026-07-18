"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import re

import folium
from conftest import render

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
        assert MeasureControl()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._LOCALE_CODE == "zh"


class TestMeasureControlRendering:
    def test_default_params(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ctrl" in html

    def test_custom_position(self, base_map: folium.Map):
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "topleft" in html

    def test_contains_gcoord_dependency(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "gcoord" in html
        assert "gcoord.global.prod.js" in html

    def test_contains_tool_buttons(self, base_map: folium.Map):
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert "data-mode" in html

    def test_locale_zh(self, base_map: folium.Map):
        MeasureControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "量算工具" in html
        assert "MeasureControl.tool_toggle" in html

    def test_remove_layer_routes_to_sublayer(self, base_map: folium.Map):
        """removeLayer is overridden to route to sub-layer (three-layer architecture)."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "removeLayer" in html

    def test_pane_setting_via_ensure_pane(self, base_map: folium.Map):
        """MeasureControl uses LayerControlAPI.ensurePane for renderer creation."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers(" in html

    def test_realtime_distance_preview(self, base_map: folium.Map):
        """Distance mode includes real-time preview label (previewDistLabel)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel" in html
        assert "onDistMove" in html
        assert "MeasureUtils.formatDistance(showDist)" in html

    def test_create_layers_api_used(self, base_map: folium.Map):
        """MeasureControl uses createLayers with graphPane/labelPane."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers" in html
        assert "graphPane" in html
        assert "labelPane" in html

    def test_css_icon_size_variable(self, base_map: folium.Map):
        """MeasureControl SVGs use --icon-size-md via common.css."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "icon-size-md" in html

    def test_css_stroke_width_emphasis(self, base_map: folium.Map):
        """Solid measurement lines use stroke-width in CSS."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # CSS variable is defined in MeasureControl.css, not in JS
        assert "stroke-width" in html

    def test_tool_buttons_data_mode(self, base_map: folium.Map):
        """Tool buttons have data-mode attribute."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "data-mode" in html

    def test_hint_duration_persist(self, base_map: folium.Map):
        """MeasureControl hints use PERSIST duration (hints stay until mode change)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "HINT_DURATION.PERSIST" in html

    def test_marker_icon_svg_structure(self, base_map: folium.Map):
        """Marker mode uses crosshair SVG."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "crosshair" in html

    def test_distance_icon_svg_structure(self, base_map: folium.Map):
        """Distance mode uses ruler SVG."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "ruler-icon" in html

    def test_circle_icon_svg_structure(self, base_map: folium.Map):
        """Circle mode uses concentric circles SVG."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "cx=" in html

    def test_trash_icon_svg(self, base_map: folium.Map):
        """Trash icon SVG is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "TRASH" in html

    def test_measure_id_constant(self, base_map: folium.Map):
        """MEASURE_ID constant is used for layer registration."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'MEASURE_ID: "foliplus_measure"' in html

    def test_graph_label_pane_constants(self, base_map: folium.Map):
        """GRAPH_PANE and LABEL_PANE constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'GRAPH_PANE: "measure_graph"' in html
        assert 'LABEL_PANE: "measure_label"' in html

    def test_stop_event_utility(self, base_map: folium.Map):
        """MeasureUtils.stopEvent stops propagation and default."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static stopEvent" in html
        assert "d?.stopPropagation?.()" in html
        assert "d?.preventDefault?.()" in html

    def test_format_distance_km_and_m(self, base_map: folium.Map):
        """formatDistance splits at 1000m threshold."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "meters >= 1000" in html
        assert "MeasureControl.unit_km" in html
        assert "MeasureControl.unit_m" in html

    def test_distance_calculation(self, base_map: folium.Map):
        """MeasureUtils.distance delegates to Leaflet's distanceTo."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2))" in html

    def test_toggle_visibility_utility(self, base_map: folium.Map):
        """toggleVisibility uses measure-hidden class."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'el.classList.toggle("measure-hidden", !visible)' in html

    def test_suppress_hide_utility(self, base_map: folium.Map):
        """suppressHide sets a delayed flag and hides all del icons."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "manager.suppressHideDel = true" in html
        assert "MeasureUtils.hideAllDelIcons()" in html

    def test_calc_toggle_reset(self, base_map: folium.Map):
        """calcToggle with 'reset' sets labelsVisible=true."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'toggleLbl === "reset"' in html

    def test_apply_toggle_del_icon_retry(self, base_map: folium.Map):
        """applyToggle retries del icon toggle with recursion."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.toggleDelIcon(mkr, show, retries)" in html

    def test_toggle_del_icon_retry_with_limit(self, base_map: folium.Map):
        """toggleDelIcon retries up to DEL_ICON_RETRY_LIMIT times."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "retries < CONST.DEL_ICON_RETRY_LIMIT" in html

    def test_attach_del_click_utility(self, base_map: folium.Map):
        """attachDelClick binds click to del icon with retry."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'L.DomEvent.on(btn, "click"' in html

    def test_set_label_text_caches_dom(self, base_map: folium.Map):
        """setLabelText caches labelEl reference on first call."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker.labelEl" in html

    def test_remove_layers_null_safe(self, base_map: folium.Map):
        """removeLayers skips null layers."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "if (l != null)" in html

    def test_build_popup_delegates(self, base_map: folium.Map):
        """buildPopup delegates to foliplus.buildPopupHtml."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "window.foliplus.buildPopupHtml" in html

    def test_lazy_register_after_finish(self, base_map: folium.Map):
        """Distance mode registers only after finishDist, not on startDistanceMode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # register() appears in finishDist, not in startDistanceMode
        assert "this.layers.register()" in html
        assert "this.layers.unregister()" in html

    def test_click_cooldown(self, base_map: folium.Map):
        """Click cooldown constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CLICK_COOLDOWN_MS: 300" in html

    def test_finalize_delay(self, base_map: folium.Map):
        """Finalize delay constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "FINALIZE_DELAY_MS: 50" in html

    def test_center_dot_size(self, base_map: folium.Map):
        """Center dot size constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CENTER_DOT_SIZE: [12, 12]" in html
        assert "CENTER_DOT_ANCHOR: [6, 6]" in html

    def test_label_anchor(self, base_map: folium.Map):
        """Label anchor is above center."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "LABEL_ANCHOR: [0, -10]" in html

    def test_is_finalizing_guard(self, base_map: folium.Map):
        """Circle mode guards against double-finalize with isFinalizing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "isFinalizing" in html
        assert "isFinalizing = false" in html

    def test_measure_manager_constructor(self, base_map: folium.Map):
        """MeasureManager constructor accepts map instance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "constructor(mapInstance)" in html

    def test_measure_manager_methods(self, base_map: folium.Map):
        """MeasureManager has expected methods."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "startDistanceMode" in html
        assert "startCircleMode" in html
        assert "bindMarkerMode" in html

    def test_distance_mode_flow(self, base_map: folium.Map):
        """Distance mode has start, onMove, finish flow."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onDistMove" in html
        assert "finishDist" in html

    def test_circle_mode_flow(self, base_map: folium.Map):
        """Circle mode is accessible via startCircleMode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "startCircleMode" in html

    def test_circle_radius_node(self, base_map: folium.Map):
        """Circle radius node gets bringToFront."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "radiusNode.bringToFront()" in html

    def test_double_label_fix(self, base_map: folium.Map):
        """Regression test: Labels are marked BEFORE addTo(mainLayer)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert re.search(
            r"isMeasureLabel\s*=\s*true;\s*previewDistLabel\.addTo\(", html
        )

    def test_label_interaction_listeners(self, base_map: folium.Map):
        """Distance/Circle labels have click listeners."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'segLabels.forEach((l) => l.on("click", handleItemClick))' in html

    def test_ui_fixed_labels_fix(self, base_map: folium.Map):
        """Regression test: Labels stay fixed, only X toggles."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'toggleUI(false, "reset")' in html
        assert "toggleUI(undefined)" in html

    def test_measure_tool_toggle(self, base_map: folium.Map):
        """Tool toggle uses MeasureControl.tool_toggle locale key."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.tool_toggle" in html

    def test_hint_messages(self, base_map: folium.Map):
        """Hint messages for all modes are present."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.hint_marker" in html
        assert "MeasureControl.hint_dist_start" in html
        assert "MeasureControl.hint_circle_start" in html
        assert "MeasureControl.hint_circle_radius" in html

    def test_all_three_tool_modes(self, base_map: folium.Map):
        """All three tool modes have data-mode attributes."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'data-mode="marker"' in html
        assert 'data-mode="distance"' in html
        assert 'data-mode="circle"' in html

    def test_clear_all_tool(self, base_map: folium.Map):
        """Clear all tool has data-mode=clear."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'data-mode="clear"' in html

    def test_preview_segments_shown_while_drawing(self, base_map: folium.Map):
        """Preview segments and labels are created during distance drawing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel" in html
        assert "previewLine" in html
        assert "previews.node" in html

    def test_preview_circle_while_drawing(self, base_map: folium.Map):
        """Preview circle and label are created during circle drawing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previews.circle" in html
        assert "previews.center" in html
        assert "previews.label" in html

    def test_origin_label_on_distance(self, base_map: folium.Map):
        """Origin label shows 'Start' text."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.dist_origin" in html

    def test_bring_to_front_on_circle_marker(self, base_map: folium.Map):
        """CircleMarkers call bringToFront() after creation."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "mkr.bringToFront()" in html or "previews.node.bringToFront()" in html

    def test_no_old_onadd_override(self, base_map: folium.Map):
        """Old onAdd override should not exist."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "origOnAdd(map)" not in html

    def test_pane_setting_via_ensure_pane(self, base_map: folium.Map):
        """MeasureControl uses ensurePane for renderer creation."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers(" in html

    def _make_page(self, browser, tmp_path):
        """Build a page with MeasureControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        MeasureControl().add_to(m)

        html = m.get_root().render()
        html = html.replace(
            "const measureManager = new MeasureManager(map);",
            "const measureManager = new MeasureManager(map); window.__measureManager = measureManager; window.__map = map;",
        )
        html_path = tmp_path / "measure_browser.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        errors = []
        page.on(
            "console",
            lambda msg: (
                errors.append(msg.text)
                if msg.type == "error"
                and not msg.text.startswith("Failed to load resource")
                else None
            ),
        )
        page.goto(f"file://{html_path}", wait_until="domcontentloaded")
        page.wait_for_selector(".measure-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            btns = page.evaluate(
                "document.querySelectorAll('.measure-ctrl .tool-btn').length"
            )
            assert btns >= 3
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_register_on_first_tool_click(self, browser, tmp_path):
        """Layer not registered on tool select; only after completing measurement."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("document.querySelector('[data-mode=distance]').click()")
            page.wait_for_timeout(500)
            # Tool selected — layer should NOT be registered yet
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert not registered, "Layer should NOT be registered before first click"
            # First click — still drawing, should NOT be registered
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert not registered, (
                "Layer should NOT be registered after first click (still drawing)"
            )
            # Second click + right-click to finish
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after completing measurement"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_add_graph_adds_content(self, browser, tmp_path):
        """addGraph() adds a path to graphLayer."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.addGraph(L.polyline([[26.08,119.30],[26.09,119.31]]));
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate(
                "Object.keys(window.__measureManager.layers.graphLayer._layers || {}).length"
            )
            assert count == 1
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_empties_layers(self, browser, tmp_path):
        """clearAll() empties graphLayer and labelLayer."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.addGraph(L.polyline([[26.08,119.30],[26.09,119.31]]));
                mm.layers.addGraph(L.circleMarker([26.08,119.30]));
            }""")
            page.wait_for_timeout(500)
            page.evaluate("window.__measureManager.layers.clearAll()")
            page.wait_for_timeout(500)
            count = page.evaluate(
                "Object.keys(window.__measureManager.layers.graphLayer._layers || {}).length"
            )
            assert count == 0, f"expected 0 got {count}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """removeGraph removes a single layer without affecting others."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const p1 = L.polyline([[26.08,119.30],[26.09,119.31]]);
                const p2 = L.circleMarker([26.08,119.30]);
                mm.layers.addGraph(p1);
                mm.layers.addGraph(p2);
                mm.layers.removeGraph(p1);
                const layers = mm.layers.graphLayer._layers || {};
                window.__test = Object.keys(layers).length;
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate("window.__test")
            assert count == 1, f"expected 1 layer remaining, got {count}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
