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
        assert "createManagedGroup" in html

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
        """MeasureControl has onRemove method that calls clearAll."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "onRemove()" in html
        assert "measureManager.clearAll()" in html

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
        # Check specific order: _isMeasureLabel = true BEFORE addTo
        assert re.search(
            r"_isMeasureLabel\s*=\s*true;\s*previewDistLabel\.addTo\(", html
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
        assert "this.mg.clearAll()" in html

    def test_clear_all_in_clear_all(self, base_map: folium.Map):
        """MeasureManager.clearAll delegates to this.mg.clearAll()."""
        MeasureControl().add_to(base_map)
        html = render(base_map)
        assert "this.mg.clearAll()" in html

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


class TestMeasureControlBrowser:
    """Browser-based tests for MeasureControl."""

    def _make_page(self, browser, tmp_path):
        """Build a page with MeasureControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        MeasureControl().add_to(m)

        html = m.get_root().render()
        html = html.replace(
            "const measureManager = new MeasureManager(map);",
            "const measureManager = new MeasureManager(map); window.__measureManager = measureManager;",
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
        """First tool click registers the layer (no content-guard issue)."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("document.querySelector('[data-mode=distance]').click()")
            page.wait_for_timeout(1000)
            registered = page.evaluate("window.__measureManager.mg.registered()")
            assert registered, "Layer should be registered after first tool click"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_add_graph_adds_content(self, browser, tmp_path):
        """addGraph() adds a path to graphLayer."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            page.evaluate("""() => {
                const mm = window.__measureManager;
                mm.mg.addGraph(L.polyline([[26.08,119.30],[26.09,119.31]]));
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate(
                "Object.keys(window.__measureManager.mg.graphLayer._layers || {}).length"
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
                mm.mg.addGraph(L.polyline([[26.08,119.30],[26.09,119.31]]));
                mm.mg.addGraph(L.circleMarker([26.08,119.30]));
            }""")
            page.wait_for_timeout(500)
            page.evaluate("window.__measureManager.mg.clearAll()")
            page.wait_for_timeout(500)
            count = page.evaluate(
                "Object.keys(window.__measureManager.mg.graphLayer._layers || {}).length"
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
                mm.mg.addGraph(p1);
                mm.mg.addGraph(p2);
                mm.mg.removeGraph(p1);
                const layers = mm.mg.graphLayer._layers || {};
                window.__test = Object.keys(layers).length;
            }""")
            page.wait_for_timeout(500)
            count = page.evaluate("window.__test")
            assert count == 1, f"expected 1 layer remaining, got {count}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
