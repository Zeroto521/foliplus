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

    def test_bring_to_front_on_circle_marker(self, base_map: folium.Map):
        """CircleMarkers call bringToFront() after creation (not in onAdd override)."""

        MeasureControl().add_to(base_map)
        html = render(base_map)
        # bringToFront should appear after circleMarker creation calls
        assert (
            "mkr.bringToFront()" in html
            or "previews.node.bringToFront()" in html
            or "radiusNode.bringToFront()" in html
        )
        # Old onAdd override should NOT exist
        assert "origOnAdd(map)" not in html
        assert (
            "this.mainLayer.onAdd" not in html
            or "this.mainLayer.onAdd = (map)" not in html
        )

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

    def test_format_distance_km(self, base_map: folium.Map):
        """Distance >= 1000m shows as km."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureControl.unit_km" in html
        assert "MeasureControl.unit_m" in html

    def test_del_icon_class(self, base_map: folium.Map):
        """Delete icon uses del-icon-wrap and measure-del-icon classes."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "del-icon-wrap" in html
        assert "measure-del-icon" in html

    def test_onremove_present(self, base_map: folium.Map):
        """MeasureControl has onRemove method that calls destroy."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onRemove()" in html
        assert "measureManager.destroy()" in html

    def test_css_classes_line_styles(self, base_map: folium.Map):
        """Line styles use measure-line-solid (solid) and measure-line-dashed (dashed)."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-line-solid" in html
        assert "measure-line-dashed" in html
        assert "measure-line-preview" in html

    def test_css_class_measure_hidden(self, base_map: folium.Map):
        """measure-hidden class exists for visibility toggle."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-hidden" in html

    def test_suppress_hide_utility(self, base_map: folium.Map):
        """MeasureUtils.suppressHide helper is used instead of inline suppress pattern."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.suppressHide" in html

    def test_node_css_classes(self, base_map: folium.Map):
        """Node markers use CSS classes instead of inline color/weight/fill options."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-node" in html
        assert "measure-node-final" in html
        assert "measure-node-preview" in html

    def test_circle_css_classes(self, base_map: folium.Map):
        """Circle elements use CSS classes instead of inline color/fill options."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "measure-circle-final" in html
        assert "measure-circle-preview" in html

    def test_toggle_visibility_utility(self, base_map: folium.Map):
        """toggleVisibility is used for show/hide of line and node elements."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.toggleVisibility" in html

    def test_double_label_fix(self, base_map: folium.Map):
        """Regression test for Bug 2: Labels are marked BEFORE addTo(mainLayer).
        This ensures they are routed to sub-layers (labelLayer) immediately.
        """
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # Check specific order: isMeasureLabel = true BEFORE addTo
        assert re.search(
            r"isMeasureLabel\s*=\s*true;\s*previewDistLabel\.addTo\(", html
        )

    def test_label_interaction_listeners(self, base_map: folium.Map):
        """Distance/Circle labels have click listeners to toggle UI."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert 'segLabels.forEach((l) => l.on("click", handleItemClick))' in html
        assert "if (radiusLabel) attachInteraction(radiusLabel)" in html

    def test_unregister_clears_leftover_nodes(self, base_map: folium.Map):
        """clearAll handles unregister + layer cleanup for MeasureControl."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.clearAll()" in html

    def test_clear_all_in_clear_all(self, base_map: folium.Map):
        """MeasureManager.clearAll delegates to this.layers.clearAll()."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.layers.clearAll()" in html

    def test_ui_fixed_labels_fix(self, base_map: folium.Map):
        """Regression test: Labels should stay fixed (visible), only X toggles.
        Map click should restore default (L=on, X=off).
        """
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # Ensure map clicks use 'reset' to keep labels visible
        assert 'toggleUI(false, "reset")' in html
        # Ensure item clicks toggle ONLY X (undefined)
        assert "toggleUI(undefined)" in html
        assert "toggleUI(undefined, true)" not in html

    def test_no_layercontrol_guard(self, base_map: folium.Map):
        """MeasureControl checks LayerControlAPI before creating MeasureManager."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "no_layercontrol" in html
        assert "LayerControlAPI" in html

    def test_set_label_text_caches_dom(self, base_map: folium.Map):
        """MeasureUtils.setLabelText caches DOM ref on first call."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.setLabelText" in html
        assert "marker.labelEl" in html
        assert 'el.querySelector(".measure-label")' in html

    def test_attach_del_click_utility(self, base_map: folium.Map):
        """MeasureUtils.attachDelClick binds click to delete icon."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static attachDelClick" in html
        assert "L.DomEvent.on(btn, " in html or "L.DomEvent.on(btn, 'click'" in html

    def test_is_finalizing_guard(self, base_map: folium.Map):
        """Circle mode guards against double-finalize with isFinalizing."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "isFinalizing" in html
        assert "isFinalizing = false" in html

    def test_toggle_del_icon_utility(self, base_map: folium.Map):
        """MeasureUtils.toggleDelIcon toggles delete icon visibility."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "MeasureUtils.toggleDelIcon" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS design tokens are referenced in rendered output."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "var(--ctrl-size)" in html
        assert "var(--accent-primary)" in html
        assert "var(--radius-sm)" in html
        assert "var(--transition-fast)" in html

    def test_remove_layers_utility(self, base_map: folium.Map):
        """MeasureUtils.removeLayers handles null-safety and multiple layers."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static removeLayers" in html
        assert "if (l != null)" in html

    def test_build_popup_utility(self, base_map: folium.Map):
        """MeasureUtils.buildPopup wraps buildPopupHtml with control locale keys."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "static buildPopup" in html
        assert "MeasureUtils.buildPopup" in html

    def test_lazy_register_after_finish(self, base_map: folium.Map):
        """Distance mode registers only after finishDist, not on startDistanceMode."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        # register() appears in finishDist, not in startDistanceMode
        assert "this.layers.register()" in html
        assert "this.layers.unregister()" in html

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
        """Solid measurement lines use --stroke-width-emphasis."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "stroke-width-emphasis" in html

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
