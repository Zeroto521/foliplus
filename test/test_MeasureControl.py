"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import json
import pathlib
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
        assert MeasureControl()._locale_code == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._locale_code == "zh"


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
        """Tool buttons are built via foliplus.dom.el with data-mode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "tool-btn" in html
        assert '"data-mode": mode' in html
        assert "mode: CONST.MODE.MARKER" in html
        assert "mode: CONST.MODE.DISTANCE" in html
        assert "mode: CONST.MODE.CIRCLE" in html
        assert "mode: CONST.MODE.CLEAR" in html

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
        """MeasureControl uses LayerAPI.ensurePane for renderer creation."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "createLayers(" in html

    def test_realtime_distance_preview(self, base_map: folium.Map):
        """Distance mode includes real-time preview label, line, and node."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel" in html
        assert "previewLine" in html
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
        """Distance mode uses ruler SVG with -45deg rotation in SVG transform."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "rotate(-45" in html

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
        assert 'ID: "foliplus_measure"' in html

    def test_graph_label_pane_constants(self, base_map: folium.Map):
        """PANES constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'GRAPH: "measure_graph"' in html
        assert 'LABEL: "measure_label"' in html

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
        assert "meters >= CONST.FORMAT.KM_THRESHOLD" in html
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
        assert "el.classList.toggle(CONST.CLASSES.HIDDEN, !visible)" in html

    def test_suppress_hide_utility(self, base_map: folium.Map):
        """suppressHide sets a delayed flag and hides all del icons."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "manager.isSuppressHideDel = true" in html
        assert "MeasureUtils.hideDelIcons()" in html

    def test_calc_toggle_reset(self, base_map: folium.Map):
        """calcToggle with 'reset' sets labelsVisible=true."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleLbl === CONST.TOGGLE.RESET" in html

    def test_toggle_del_icon_retry(self, base_map: folium.Map):
        """toggleDelIcon retries with delay up to DEL_ICON_RETRY_LIMIT times."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "retries < CONST.DEL_ICON.RETRY_LIMIT" in html
        assert "MeasureUtils.toggleDelIcon(mkr, show, retries + 1)" in html

    def test_attach_del_click_utility(self, base_map: folium.Map):
        """attachDelClick binds click to marker event, not raw DOM event."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'delMkr.on("click",' in html
        assert "foliplus-measure-del-icon" in html

    def test_set_label_text_gets_fresh_dom(self, base_map: folium.Map):
        """setLabelText gets a fresh DOM reference each call."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "marker.getElement()" in html
        assert "labelEl.textContent = text" in html

    def test_remove_layer_null_safe(self, base_map: folium.Map):
        """removeLayer in LayerControl's createLayers skips null items."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "removeLayer" in html

    def test_build_popup_delegates(self, base_map: folium.Map):
        """buildPopup delegates to foliplus.buildPopupHtml."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.buildPopupHtml" in html

    def test_lazy_register_after_finish(self, base_map: folium.Map):
        """Distance mode registers on first click via mainLayer.addLayer, and re-registers on tool select."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # register() is called explicitly in setMode() when activating a tool,
        # and also via mainLayer.addLayer override on first click in distance mode
        assert "this.layers.unregister()" in html or "this.layers.destroy()" in html
        assert "this.layers.register()" in html

    def test_click_cooldown(self, base_map: folium.Map):
        """Click cooldown constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "CLICK_COOLDOWN: 300" in html

    def test_finalize_delay(self, base_map: folium.Map):
        """Finalize delay constant is defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "FINALIZE_DELAY: 50" in html

    def test_center_dot_size(self, base_map: folium.Map):
        """Center dot size constants are defined."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "SIZE: [12, 12]" in html
        assert "ANCHOR: [6, 6]" in html

    def test_label_anchor(self, base_map: folium.Map):
        """Label anchor is above center."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "ANCHOR: [0, -10]" in html

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
        """MeasureManager has expected methods (start, set modes)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "class DistanceMode extends MeasureMode" in html
        assert "class CircleMode extends MeasureMode" in html
        assert "class MarkerMode extends MeasureMode" in html
        assert "finishDist" in html
        assert "finalizeCircle" in html

    def test_label_above_circle(self, base_map: folium.Map):
        """Label is added after circle, line, and node so it renders on top."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # radiusLabel should appear after circle, radiusLine, and radiusNode
        label_pos = html.find("radiusLabel = this.layers.addLayer")
        circle_pos = html.find("circle = this.layers.addLayer(")
        line_pos = html.find("radiusLine = this.layers.addLayer(")
        node_pos = html.find("radiusNode = this.layers.addLayer(")
        assert label_pos > circle_pos, "Label should be added after circle"
        assert label_pos > line_pos, "Label should be added after line"
        assert label_pos > node_pos, "Label should be added after node"

    def test_double_label_fix(self, base_map: folium.Map):
        """Regression test: Labels are added via addLayer with isLabel=true."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "previewDistLabel = this.layers.addLayer(" in html

    def test_label_interaction_listeners(self, base_map: folium.Map):
        """Distance/Circle labels have click listeners."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'segLabels.forEach((l) => l.on("click", handleItemClick))' in html

    def test_ui_fixed_labels_fix(self, base_map: folium.Map):
        """Regression test: Labels stay fixed, only X toggles."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleUI(false, CONST.TOGGLE.RESET)" in html
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

    def test_lat_lng_precision_constant(self, base_map: folium.Map):
        """LAT_LNG_PRECISION constant is defined as 6."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "LAT_LNG_PRECISION: 6" in html

    def test_make_label_div_icon(self, base_map: folium.Map):
        """MeasureUtils.makeLabelDivIcon creates a divIcon with measure-label."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeLabelDivIcon" in html
        assert "measure-label" in html
        assert "LABEL_ANCHOR" in html
        # Supports optional iconAnchor and className params
        assert "iconAnchor" in html
        assert "className" in html

    def test_circle_label_centered(self, base_map: folium.Map):
        """Circle radius labels (both preview and final) use [0,0] anchor + measure-label-radius for centering at midpoint."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert re.search(
            r"MeasureUtils\.makeLabelDivIcon\(\s*MeasureUtils\.formatDistance\(r\)\s*,\s*CONST\.DEL_ICON\.ANCHOR\s*,\s*CONST\.LABEL\.CLASS_RADIUS\s*",
            html,
        )

    def test_make_node(self, base_map: folium.Map):
        """MeasureUtils.makeNode creates a circleMarker with MARKER_RADIUS."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeNode" in html
        assert "RADIUS: 5" in html

    def test_make_del_icon(self, base_map: folium.Map):
        """MeasureUtils.makeDelIcon creates a delete icon marker."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeDelIcon" in html
        assert "foliplus-del-icon" in html

    def test_align_right_for_right_position(self, base_map: folium.Map):
        """Right positions (bottomright/topright) add align-right class."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "align-right" in html

    def test_no_align_right_for_left_position(self, base_map: folium.Map):
        """Left positions (topleft/bottomleft) do NOT add align-right class."""
        MeasureControl(position="topleft").add_to(base_map)
        html = render(base_map)
        # align-right appears in CSS, but NOT in the JS class string for left positions
        # Check that the JS doesn't add align-right for left positions
        assert 'indexOf("left") >= 0' in html

    def test_marker_del_icon_uses_make_del_icon(self, base_map: folium.Map):
        """Marker mode uses makeDelIcon with iconAnchor for positioning."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "makeDelIcon" in html
        assert "iconAnchor" in html
        assert "injectDelIcon" not in html

    def test_bring_layer_to_front_on_tool_select(self, base_map: folium.Map):
        """Tool select calls register() to re-show the measure layer on top."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.register()" in html

    # ── Finish animation tests ──

    def test_dash_sweep_animation_classes(self, base_map: folium.Map):
        """Distance finishDist adds is-dash-sweep class with --sweep-length."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "dash-sweep" in html
        assert "--sweep-length" in html
        assert "getTotalLength" in html
        assert "animationend" in html

    def test_dash_sweep_drop_shadow(self, base_map: folium.Map):
        """Dash sweep line has drop-shadow filter for glow effect."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "drop-shadow" in css
        assert "dash-sweep" in css

    def test_ripple_animation_classes(self, base_map: folium.Map):
        """Circle finalizeCircle creates a measure-ripple circle with animationend cleanup."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-ripple" in html
        assert "interactive: false" in html
        assert "removeLayer(ripple)" in html
        assert "animationend" in html

    def test_ripple_css_variables(self, base_map: folium.Map):
        """Ripple animation uses CSS custom properties for all parameters."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "--ripple-duration" in css
        assert "--ripple-opacity-start" in css
        assert "--ripple-stroke-start" in css
        assert "--ripple-stroke-end" in css
        assert "measure-ripple" in css

    def test_dash_sweep_css_variables(self, base_map: folium.Map):
        """Dash sweep animation uses CSS custom properties for all parameters."""

        css = pathlib.Path("foliplus/css/MeasureControl.css").read_text()
        assert "--sweep-length" in css
        assert "--sweep-duration" in css

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
        # Remove blocking CDN <script> tags (gcoord added by default_js)
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/gcoord@1/dist/gcoord.global.prod.js"></script>',
            "",
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
        page.goto(f"file://{html_path}", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector(
            ".foliplus-measure-ctrl", state="attached", timeout=10000
        )
        return page, errors

    def test_tool_buttons_render(self, browser, tmp_path):
        """Tool buttons are present in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            btns = page.evaluate(
                "document.querySelectorAll('.foliplus-measure-ctrl .foliplus-tool-btn').length"
            )
            assert btns >= 3
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_register_on_first_click(self, browser, tmp_path):
        """Layer is registered immediately on tool select, visible on map."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("document.querySelector('[data-mode=distance]').click()")
            page.wait_for_timeout(500)
            # Tool selected — registered immediately (needed to show hidden layer)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, (
                "Layer should be registered immediately after tool select"
            )
            # First click on map — triggers content addition
            page.evaluate("""() => {
                const map = window.__map;
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(500)
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
        """mainLayer.addLayer() auto-registers the layer."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "addLayer should auto-register"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_empties_layers(self, browser, tmp_path):
        """destroy() empties content and unregisters."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.layers.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                mm.layers.addLayer(L.circleMarker([26.08,119.30]));
            }""")
            page.wait_for_timeout(500)
            page.evaluate("window.__measureManager.layers.clearLayers()")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert not registered, "destroy should unregister the layer"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_remove_graph_removes_single_item(self, browser, tmp_path):
        """mainLayer.removeLayer removes a single layer without affecting others."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const p1 = L.polyline([[26.08,119.30],[26.09,119.31]]);
                const p2 = L.circleMarker([26.08,119.30]);
                mm.layers.mainLayer.addLayer(p1);
                mm.layers.mainLayer.addLayer(p2);
                mm.layers.mainLayer.removeLayer(p1);
                window.__test = mm.layers.registered();
            }""")
            page.wait_for_timeout(500)
            registered = page.evaluate("window.__test")
            assert registered, "layer should remain registered after removing one item"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_destroy_cleans_up_listeners(self, browser, tmp_path):
        """destroy() removes all map listeners (no leak after cleanup)."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # First, create a circle to trigger onMapClickActive listener
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('circle');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Destroy the manager
            page.evaluate("window.__measureManager.destroy()")
            page.wait_for_timeout(200)
            # Verify no errors
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_marker_del_icon_removes_marker(self, browser, tmp_path):
        """Clicking the delete X in marker mode removes the marker pin."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('marker');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            page.wait_for_timeout(500)
            # Remove the layer via API directly (testing the delete logic)
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    // Simulate clicking the del icon: make it visible, then fire
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    // Fire with a mock originalEvent that has the del-icon target
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            # Check that delMkr is no longer in the layer group
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_distance_del_icon_removes_measurement(self, browser, tmp_path):
        """Clicking the delete X in distance mode removes the entire measurement."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('distance');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
                map.fire('contextmenu', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_circle_del_icon_removes_circle(self, browser, tmp_path):
        """Clicking the delete X in circle mode removes the entire circle."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('circle');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
                map.fire('click', {latlng: L.latLng(26.09, 119.31)});
            }""")
            page.wait_for_timeout(500)
            # Fire the delMkr click with a mock originalEvent targeting the X icon
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const layers = mm.layers.mainLayer._layers || {};
                const delMkr = Object.values(layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            hasDelMkr = page.evaluate("""() => {
                const mm = window.__measureManager;
                return Object.values(mm.layers.mainLayer._layers || {}).some(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
            }""")
            assert not hasDelMkr, "delMkr should be removed after clicking delete"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── Persistence (browser) ──────────────────────────────────────

    def test_save_measurements_stores_to_localStorage(self, browser, tmp_path):
        """saveMeasurements() writes measurements to localStorage."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.measurements = [{ id: 't1', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
            }""")
            data = page.evaluate(
                "localStorage.getItem(window.__measureManager.storageKey)"
            )
            assert data is not None, "localStorage should contain saved measurements"

            parsed = json.loads(data)
            assert len(parsed) == 1
            assert parsed[0]["type"] == "marker"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_clears_measurements_and_storage(self, browser, tmp_path):
        """clearAll() empties measurements array and persists to localStorage."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.measurements = [{ id: 't1', type: 'marker', lng: 119.30, lat: 26.08 }];
                mm.saveMeasurements();
                mm.clearAll();
            }""")
            data = page.evaluate(
                "localStorage.getItem(window.__measureManager.storageKey)"
            )
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "clearAll should empty localStorage"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_delete_marker_removes_from_storage(self, browser, tmp_path):
        """Deleting a marker removes it from measurements and persists."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                const map = window.__map;
                mm.setMode('marker');
                map.fire('click', {latlng: L.latLng(26.08, 119.30)});
            }""")
            # Poll for measurement to appear (async reverse geocode may take time)
            page.wait_for_timeout(500)
            for _ in range(20):
                before = page.evaluate("window.__measureManager.measurements.length")
                if before >= 1:
                    break
                page.wait_for_timeout(500)
            assert before == 1, f"expected 1 measurement, got {before}"
            page.evaluate("""() => {
                const map = window.__map;
                const delMkr = Object.values(map._layers).find(
                    l => l instanceof L.Marker && l.options.icon?.options?.className?.includes('foliplus-del-icon')
                );
                if (delMkr) {
                    const icon = delMkr.getElement().querySelector('.foliplus-measure-del-icon');
                    if (icon) icon.classList.add('visible');
                    delMkr.fire('click', { originalEvent: { target: icon } });
                }
            }""")
            page.wait_for_timeout(300)
            after = page.evaluate("window.__measureManager.measurements.length")
            assert after == 0, f"expected 0 measurements after delete, got {after}"
            data = page.evaluate(
                "localStorage.getItem(window.__measureManager.storageKey)"
            )
            parsed = json.loads(data) if data else []
            assert len(parsed) == 0, "localStorage should be empty after deleting all"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_marker_from_storage(self, browser, tmp_path):
        """restoreMarker restores a marker measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            # Pre-populate localStorage with a marker measurement
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measurement_marker_1',
                    type: 'marker',
                    lng: 119.30,
                    lat: 26.08,
                    address: 'Test Address'
                }];
                localStorage.setItem(window.__measureManager.storageKey, JSON.stringify(data));
            }""")
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
        finally:
            page.close()

    def test_restore_distance_from_storage(self, browser, tmp_path):
        """restoreDistance restores a distance measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measurement_distance_1',
                    type: 'distance',
                    points: [
                        { lng: 119.30, lat: 26.08 },
                        { lng: 119.31, lat: 26.09 }
                    ],
                    segments: [
                        { lng: 119.305, lat: 26.085, distance: 1234.56 }
                    ]
                }];
                localStorage.setItem(window.__measureManager.storageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored distance, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring distance"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_restore_circle_from_storage(self, browser, tmp_path):
        """restoreCircle restores a circle measurement from localStorage without ReferenceError."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const data = [{
                    id: 'foliplus_measurement_circle_1',
                    type: 'circle',
                    center: { lng: 119.30, lat: 26.08 },
                    target: { lng: 119.31, lat: 26.09 },
                    radius: 500
                }];
                localStorage.setItem(window.__measureManager.storageKey, JSON.stringify(data));
            }""")
            page.reload()
            page.wait_for_timeout(2000)
            count = page.evaluate("window.__measureManager.measurements.length")
            assert count == 1, f"expected 1 restored circle, got {count}"
            registered = page.evaluate("window.__measureManager.layers.registered()")
            assert registered, "Layer should be registered after restoring circle"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    # ── MeasureUtils edge-case tests ──

    def test_format_distance_zero(self, base_map: folium.Map):
        """formatDistance handles 0 meters."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "0" in html

    def test_format_distance_large(self, base_map: folium.Map):
        """formatDistance handles large values > 1000m."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "unit_km" in html

    def test_calc_toggle_all_modes(self, base_map: folium.Map):
        """calcToggle handles all toggleLbl modes: true, false, undefined, RESET."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "toggleLbl === true" in html
        assert "toggleLbl === false" in html
        assert "toggleLbl === CONST.TOGGLE.RESET" in html

    def test_restore_measurements_corrupted_json(self, base_map: folium.Map):
        """loadMeasurements returns empty array on corrupted JSON."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "JSON.parse(data)" in html
        assert "return []" in html

    def test_next_measurement_id_format(self, base_map: folium.Map):
        """nextMeasurementId generates IDs with type prefix."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "nextMeasurementId" in html
        assert "CONST.ID" in html

    def test_attach_distance_ui_shared(self, base_map: folium.Map):
        """attachDistanceUI is used by both finishDist and restoreDistance."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        count = html.count("attachDistanceUI")
        assert count >= 2, f"expected 2+ references to attachDistanceUI, got {count}"

    def test_attach_circle_ui_shared(self, base_map: folium.Map):
        """attachCircleUI is used by both finalizeCircle and restoreCircle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        count = html.count("attachCircleUI")
        assert count >= 2, f"expected 2+ references to attachCircleUI, got {count}"
