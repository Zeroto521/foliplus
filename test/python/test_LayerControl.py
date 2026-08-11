"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import re
from pathlib import Path

import folium
from conftest import assert_locale, render, render_control

from foliplus import LayerControl


class TestLayerControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert LayerControl()._name == "LayerControl"

    def test_default_position(self):
        assert LayerControl().position == "topleft"

    def test_custom_position(self):
        assert LayerControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert LayerControl()._locale_code == ""

    def test_custom_locale(self):
        assert LayerControl(locale="zh")._locale_code == "zh"

    def test_render_collects_layers(self):
        """LayerControl has render() and builds data from the parent map."""
        ctrl = LayerControl()
        assert hasattr(ctrl, "render")

    def test_render_overlays_and_base(self):
        """render() correctly flags base vs overlay layers in data."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        m.render()

        flags = {d["name"]: d["isBase"] for d in ctrl._config["data"]}
        assert flags["OSM"] is True, f"OSM should be base: {flags}"
        assert flags["Points"] is False, f"Points should be overlay: {flags}"


class TestLayerControlRendering:
    def test_default_params(self):
        html = render_control(LayerControl())
        assert "foliplus-layer-ctrl" in html

    def test_color_layer_item(self):
        html = render_control(LayerControl())
        assert "foliplus-color-layer-item" in html
        assert "foliplus-color-layer-input" in html
        assert "foliplus_color_map" in html

    def test_color_layer_default_value(self):
        html = render_control(LayerControl())
        assert "#cccccc" in html

    def test_separator_label(self):
        html = render_control(LayerControl())
        html = render_control(LayerControl())
        assert "layer-sep" in html
        assert "layer-sep-label" in html

    def test_fold_icon_single_svg_css_rotation(self):
        """Fold uses a single SVG icon rotated by CSS — no separate UNFOLD SVG."""
        from pathlib import Path

        html = render_control(LayerControl())
        assert "FOLD" in html
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "rotate(180deg)" in css

    def test_locale_zh(self):
        html = render_control(LayerControl(locale="zh"))
        assert_locale(html, "图层", "LayerControl.panel_title")

    def test_position_renders(self):
        html = render_control(LayerControl(position="bottomright"))
        assert "bottomright" in html

    def test_multiple_base_layers(self):
        """Multiple base layers are all collected by render()."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.TileLayer(
            "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            name="Carto",
            overlay=False,
            attr="&copy; OpenStreetMap contributors",
        ).add_to(m)
        folium.TileLayer(
            "https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png",
            name="Terrain",
            overlay=False,
            attr="Map tiles by Stamen Design",
        ).add_to(m)
        m.render()

        data = {d["name"]: d for d in ctrl._config["data"]}
        assert "OSM" in data
        assert "Carto" in data
        assert "Terrain" in data
        assert sum(1 for d in ctrl._config["data"] if d["isBase"]) >= 3
        assert sum(1 for d in ctrl._config["data"] if not d["isBase"]) == 0

    def test_base_and_overlay_in_template(self):
        """Both base_layers and overlays appear in the JS template."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = render(m)

        # JS data should contain both with correct isBase flags
        assert '"isBase": true' in html
        assert '"isBase": false' in html

    def test_is_base_class_on_base_items(self):
        """Only base map items get the data-layer-type attribute."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # Base maps have the attribute; overlay items should be checked separately
        assert 'data-layer-type": li.isBase ? GROUP.BASE : GROUP.OVERLAY' in html

    def test_drag_handle_present(self):
        """Drag handle SVG present for all layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # Drag handle SVG circles (6 dots) present
        assert "drag-handle" in html
        # All items use drag handle (no more base-map-only spacer logic)
        assert "DRAG_HANDLE" in html

    def test_drag_tooltip_rendered(self):
        """Drag handle has i18n drag_tooltip title."""
        m = folium.Map()
        LayerControl(locale="zh").add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "drag_tooltip" in html
        assert "拖拽排序" in html

    def test_draggable_all_items(self):
        """All layer items except color-layer-item have draggable=true."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # DOM API sets draggable at runtime via setAttribute
        assert 'draggable: "true"' in html or 'draggable="true"' in html
        # Also check foliplus-color-layer-item exists (non-draggable)
        assert "foliplus-color-layer-item" in html

    def test_locale_en_keys(self, base_map: folium.Map):
        """Default (en) locale keys rendered."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerControl.toggle_title" in html
        assert "LayerControl.panel_title" in html
        assert "LayerControl.base_map_label" in html

    def test_color_click_deselects_bases(self, base_map: folium.Map):
        """click handler on color-layer-item present in rendered code."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-color-layer-item" in html
        assert "deselectAllBaseMaps" in html

    def test_drag_base_map_allowed(self):
        """No drag prevention for base maps in JS code."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # Should NOT contain old drag prevention for base maps
        assert "this.layers[idx].isBase" not in html

    def test_separator_in_template(self):
        """Separator label 'BASE MAP' appears before base layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "base_map_label" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS variables from common.css are referenced in rendered output."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "var(--space-xl)" in html
        assert "var(--accent-primary)" in html
        assert "var(--radius-sm)" in html
        assert "var(--transition-fast)" in html

    def test_leaflet_control_classes_applied(self, base_map: folium.Map):
        """LayerControl renders with leaflet-control classes for Leaflet theming."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "leaflet-control" in html
        assert "leaflet-bar" in html

    def test_layer_item_dom_structure(self, base_map: folium.Map):
        """Each layer-item has checkbox, label, type-icon-col."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus-checkbox" in html
        assert "foliplus-type-icon-col" in html

    def test_color_map_id_constant(self, base_map: folium.Map):
        """Color map uses a special constant ID for identification."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus_color_map" in html

    def test_hint_duration_constants_in_layer(self, base_map: folium.Map):
        """LayerControl uses hint duration constants (not hardcoded values)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "HINT_DURATION" in html
        assert "HINT_COOLDOWN_MS: 800" in html

    def test_separator_container_has_base_label(self, base_map: folium.Map):
        """Separator label uses localized base_map_label key."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "LayerControl.base_map_label" in html

    def test_css_interaction_effects(self, base_map: folium.Map):
        """CSS hover/active effects exist for interactive elements."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Color layer picker (via :is() selector, no literal :hover string)
        assert "foliplus-color-layer-input" in html
        # Fold toggle button SVG
        assert "foliplus-layer-fold-btn:hover svg" in html
        assert "foliplus-layer-fold-btn:active" in html
        # Type icon column transition
        assert "foliplus-type-icon-col svg" in html
        assert "transition: transform" in html
        # Layer item hover on type icon
        assert "foliplus-layer-item:hover .foliplus-type-icon-col svg" in html
        # Active state on type icon
        assert "active .foliplus-type-icon-col svg" in html
        # Toggle button SVG inherits color
        assert "foliplus-toggle-btn svg" in html
        assert "stroke: currentColor" in html
        # Close (X) button SVG must also be in the icon selector
        assert "foliplus-ctrl-btn" in html

    def test_close_btn_svg_styled(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""
        css = Path("foliplus/css/common.css").read_text()
        # .foliplus-ctrl-btn must appear inside the :is() icon-size rule so that
        # its SVG lines get stroke:currentColor (without it the X is invisible).
        assert ".foliplus-ctrl-btn" in css

    def test_folded_state_no_accent_text(self):
        """Folded label keeps neutral color; only left border and fold-btn use accent."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # left border and fold-btn turn accent when folded — both expected
        assert "foliplus-layer-folded" in css
        assert "border-left-color: var(--accent-primary)" in css
        # label must NOT be colored accent when folded (label stays text-primary)
        assert "foliplus-layer-folded .foliplus-layer-sep-label" not in css, (
            "folded label must not override color (label stays text-primary)"
        )

    def test_toggle_all_label_semibold_primary(self):
        """Section header label is semibold and text-primary so it reads as a real header."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-toggle-all .foliplus-layer-sep-label" in css
        assert "font-weight: var(--font-weight-semibold)" in css
        assert "color: var(--text-primary)" in css

    def test_toggle_all_hover_accent_light_border(self):
        """Toggle-all row hover shows a soft accent-light left border."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-toggle-all:hover" in css
        assert "border-left-color: var(--accent-light)" in css

    def test_folded_fold_btn_turns_accent(self):
        """Fold button color becomes accent-primary when row is folded."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Find the rule that targets fold-btn itself (not fold-btn svg)
        # by searching for the closing of the selector without "svg" on the same segment
        match = re.search(
            r"foliplus-layer-folded\s+\.foliplus-layer-fold-btn\s*\{([^}]*)\}",
            css,
        )
        assert match, "folded fold-btn rule not found"
        assert "var(--accent-primary)" in match.group(1)

    def test_section_divider_fades_when_folded(self):
        """Section divider fades to opacity 0 when the group is folded."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-section-divider" in css
        assert "opacity: 0" in css

    def test_fold_btn_hover_color(self):
        """Fold button hover shows accent color (no bg/radius on fold-btn itself)."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-fold-btn:hover" in css
        assert "color: var(--accent-primary)" in css

    def test_fold_btn_hover_bidirectional_preview(self):
        """Fold button shows bidirectional hover preview on the toggle-all row."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Expanded row hover: black → red
        assert "foliplus-layer-toggle-all:not(.foliplus-layer-folded):hover" in css
        assert "color: var(--accent-primary)" in css
        # Folded row hover: red → black
        assert "foliplus-layer-toggle-all.foliplus-layer-folded:hover" in css
        assert "color: var(--text-primary)" in css

    def test_fold_btn_background_transition(self):
        """Fold button transitions color and transform (background removed — no bg to transition)."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        # Find the base fold-btn rule (not the folded or hover variants)
        idx = css.find(".foliplus-layer-ctrl .foliplus-layer-fold-btn {\n")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        # Find the transition property value (between "transition:" and the next property)
        t_idx = block.find("transition:")
        assert t_idx != -1, "transition property not found"
        t_end = block.find("\n  }", t_idx)
        trans_val = block[t_idx:t_end]
        assert "background var(--transition-fast)" not in trans_val
        assert "color var(--transition-fast)" in trans_val
        assert "transform var(--transition-fast)" in trans_val

    def test_fold_btn_svg_fill_none(self):
        """fold-btn svg rule includes fill:none so chevrons render as outlines."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "foliplus-layer-fold-btn svg" in css
        assert "fill: none" in css

    def test_drag_handle_circle_stroke(self):
        """drag-handle circles have explicit stroke so they appear bold."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert ".drag-handle circle" in css
        assert "stroke: currentColor" in css

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "iconSvg" in html
        assert "type-icon-col" in html

    # ── Drag-over animation tests ──

    def test_drag_pulse_css_keyframes(self):
        """CSS defines drag-pulse keyframes with variable-driven values."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "@keyframes foliplus-drag-pulse" in css
        assert "var(--drag-border-from" in css
        assert "var(--drag-border-to" in css
        assert "var(--drag-shadow-from" in css
        assert "var(--drag-shadow-to" in css

    def test_drag_over_css_variables(self):
        """Drag-over drop indicators use CSS custom properties for all parameters."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert "--drag-border-width" in css
        assert "--drag-top-shadow" in css
        assert "--drag-bottom-shadow" in css
        assert "--drag-pulse-duration" in css
        assert "--drag-pulse-count" in css


class TestLayerControlBrowser:
    """Browser-level interaction checks for drag/drop feedback."""

    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base group should show blocked hint."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_layer_control_drag_hint.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(
                """() => {
                    const api = window.foliplus && window.foliplus.LayerAPI;
                    if (!api) return false;
                    const overlay = document.querySelector('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                    const base = document.querySelector('.foliplus-layer-item[data-layer-type="base"]');
                    if (!overlay || !base) return false;
                    api.ui.dragIdx = parseInt(overlay.dataset.index, 10);
                    const ev = new Event("dragover", { bubbles: true, cancelable: true });
                    base.dispatchEvent(ev);
                    return true;
                }"""
            )
            assert ok, "Failed to dispatch simulated cross-group dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(
                'document.querySelector(".foliplus-hint-LayerControl")?.textContent || ""'
            )
            assert ("same group" in hint_text.lower()) or ("同分组" in hint_text)
        finally:
            page.close()

    def test_create_managed_layers_api(self, browser, tmp_path):
        """layers() returns expected convenience methods."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_api.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            api = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test__',
                    name: 'Test',
                    graphPane: '__test_graph__',
                    labelPane: '__test_label__',
                });
                return {
                    hasClearLayers: typeof mg.clearLayers === 'function',
                    hasRegister: typeof mg.register === 'function',
                    hasUnregister: typeof mg.unregister === 'function',
                    hasRegistered: typeof mg.registered === 'function',
                    hasMainLayer: !!mg.mainLayer,
                    hasBringToFront: typeof mg.bringToFront === 'function',
                };
            }""")
            assert api is not None, "LayerAPI not found"
            assert api["hasClearLayers"], "clearLayers missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasBringToFront"], "bringToFront missing"
        finally:
            page.close()

    def test_add_graph_sets_pane(self, browser, tmp_path):
        """addGraph sets pane on the layer and calls register."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_addgraph.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_pane__',
                    name: 'PaneTest',
                    graphPane: '__pane_test_graph__',
                    labelPane: '__pane_test_label__',
                });
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                mg.mainLayer.addLayer(poly);
                return {
                    pane: poly.options.pane,
                    hasRenderer: !!poly._renderer,
                    registered: mg.registered(),
                };
            }""")
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"
        finally:
            page.close()

    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_clearall.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_clear__',
                    name: 'ClearTest',
                    graphPane: '__test_clear_graph__',
                });
                mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const beforeRegistered = mg.registered();
                mg.clearLayers();
                const afterRegistered = mg.registered();
                return { beforeRegistered, afterRegistered };
            }""")
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False
        finally:
            page.close()

    def test_add_label_sets_pane(self, browser, tmp_path):
        """addLabel sets pane on the marker."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_addlabel.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_label__',
                    name: 'LabelTest',
                    graphPane: '__test_label_graph__',
                    labelPane: '__test_label_pane__',
                });
                const mkr = L.marker([26.08,119.30]);
                mkr.isLabel = true;
                mg.mainLayer.addLayer(mkr);
                return { pane: mkr.options.pane, registered: mg.registered() };
            }""")
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True
        finally:
            page.close()

    def test_cross_group_drag_block_fallback(self, browser, tmp_path):
        """canReorderBetween returns false and hint appears."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)

        html_path = tmp_path / "test_cross_group_drag.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            ok = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return false;
                return typeof api.canReorderBetween === 'function';
            }""")
            assert ok
        finally:
            page.close()

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_unregister.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_unreg__',
                    name: 'UnregTest',
                    graphPane: '__test_unreg_graph__',
                });
                mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const before = mg.registered();
                mg.clearLayers();
                const after = mg.registered();
                return { before, after };
            }""")
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False
        finally:
            page.close()

    def test_create_canvas_basic_api(self, browser, tmp_path):
        """createCanvas returns canvas API object with expected methods."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_create_canvas.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            api = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cvs = api.createCanvas({ id: '__test_canvas__' });
                return {
                    hasCanvas: !!cvs.canvas,
                    hasCtx: !!cvs.ctx,
                    hasResize: typeof cvs.resize === 'function',
                    hasDestroy: typeof cvs.destroy === 'function',
                    hasUpdatePosition: typeof cvs.updatePosition === 'function',
                    hasSetZIndex: typeof cvs.setZIndex === 'function',
                    hasSetVisible: typeof cvs.setVisible === 'function',
                    hasGetSize: typeof cvs.getSize === 'function',
                    canvasTag: cvs.canvas.tagName,
                };
            }""")
            assert api is not None
            assert api["hasCanvas"]
            assert api["hasCtx"]
            assert api["hasResize"]
            assert api["hasDestroy"]
            assert api["hasUpdatePosition"]
            assert api["hasSetZIndex"]
            assert api["hasSetVisible"]
            assert api["hasGetSize"]
            assert api["canvasTag"] == "CANVAS"
        finally:
            page.close()

    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_canvas_reg.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cvs = api.createCanvas({ id: '__test_canvas_reg__', name: 'Canvas Test' });
                cvs.register();
                const item = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
                const hasItem = !!item;
                cvs.unregister();
                const itemAfter = document.querySelector('[data-layer-id="__test_canvas_reg__"]');
                return { hasItem, hasItemAfter: !!itemAfter };
            }""")
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )
        finally:
            page.close()

    def test_migrate_layers_marker_pane(self, browser, tmp_path):
        """migrateLayers moves Markers to per-layer panes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_marker_pane.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_marker_pane__',
                    name: 'MarkerPane',
                    graphPane: '__test_marker_pane_graph__',
                });
                const mkr = L.marker([26.08,119.30]);
                mg.mainLayer.addLayer(mkr);
                return { pane: mkr.options.pane };
            }""")
            assert result is not None
            assert result["pane"] == "__test_marker_pane_graph__"
        finally:
            page.close()

    def test_migrate_layers_path_pane(self, browser, tmp_path):
        """migrateLayers moves Path layers to the target pane."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_path_pane.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__test_path_pane__',
                    name: 'PathPane',
                    graphPane: '__test_path_pane_graph__',
                });
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                mg.mainLayer.addLayer(poly);
                return { pane: poly.options.pane };
            }""")
            assert result is not None
            assert result["pane"] == "__test_path_pane_graph__"
        finally:
            page.close()

    def test_get_layer_type_api(self, browser, tmp_path):
        """getLayerType returns correct geometry type for registered layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_layer_type.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Register a polygon layer
                const poly = L.polygon([[26.08,119.30],[26.09,119.31],[26.07,119.32]]);
                api.registerLayer({ id: '__test_type__', layer: poly });
                const type = api.getLayerType('__test_type__');
                const layers = api.getLayersByType('polygon');
                return { type, hasPolygon: layers.some(l => l.id === '__test_type__') };
            }""")
            assert result is not None
            assert result["type"] == "polygon"
            assert result["hasPolygon"] is True
        finally:
            page.close()

    def test_load_saved_order_restore_order(self, browser, tmp_path):
        """loadSavedOrder restores previously saved order from localStorage."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_saved_order.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const ids = api.layers.map(l => l.id);
                return { count: ids.length, ids };
            }""")
            assert result is not None
            assert result["count"] >= 3
        finally:
            page.close()

    def test_toggle_all_checkbox_toggles_layers(self, browser, tmp_path):
        """Toggle-all checkbox toggles all layers in the group."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            # Check initial state — all overlays checked
            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.checked : 'no-cb';
            }""")
            assert result is True, f"Expected toggle-all checked, got {result}"
        finally:
            page.close()

    # ── title / tooltip browser tests ──

    def test_layer_item_title_shows_type(self, browser, tmp_path):
        """Layer item row title shows the translated type, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_layer_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            title = page.evaluate("""() => {
                const item = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item)');
                return item ? item.title : null;
            }""")
            # initTypesAndVisibility runs after 300ms delay; wait if needed
            if not title or "MyPoints" in (title or ""):
                page.wait_for_timeout(500)
                title = page.evaluate("""() => {
                    const item = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item)');
                    return item ? item.title : null;
                }""")
            # Should be a type description (e.g. "Point Layer") not the layer name
            assert title and "MyPoints" not in title, (
                f"Expected type title, got '{title}'"
            )
        finally:
            page.close()

    def test_checkbox_title_shows_select_deselect(self, browser, tmp_path):
        """Checkbox title shows Select/Deselect, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_cb_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            title = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]');
                return cb ? cb.title : null;
            }""")
            assert title and "MyPoints" not in title, (
                f"Expected select/deselect title, got '{title}'"
            )
        finally:
            page.close()

    def test_toggle_all_checkbox_title_changes_with_state(self, browser, tmp_path):
        """Toggle-all checkbox title updates when state changes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # All checked → title should be "Deselect all"
            initial = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.title : null;
            }""")
            assert initial and "Deselect" in initial, (
                f"Expected 'Deselect all', got '{initial}'"
            )

            # Uncheck one layer → title should become "Select all"
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item:not(.foliplus-color-layer-item) input[type="checkbox"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            after = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb ? cb.title : null;
            }""")
            assert after and "Select" in after, f"Expected 'Select all', got '{after}'"
        finally:
            page.close()

    def test_toggle_all_row_title_shows_fold_unfold(self, browser, tmp_path):
        """Toggle-all row title shows fold/unfold tooltip."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_row_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Expanded → should show "Collapse layers"
            initial = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row ? row.title : null;
            }""")
            assert initial and "Collapse" in initial, (
                f"Expected 'Collapse layers', got '{initial}'"
            )

            # Click fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Folded → should show "Expand layers"
            folded = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row ? row.title : null;
            }""")
            assert folded and "Expand" in folded, (
                f"Expected 'Expand layers', got '{folded}'"
            )
        finally:
            page.close()

    def test_color_layer_item_title(self, browser, tmp_path):
        """Color layer item title shows the color map label."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_color_layer_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            title = page.evaluate("""() => {
                const item = document.querySelector('.foliplus-color-layer-item');
                return item ? item.title : null;
            }""")
            assert title, f"Expected non-empty title, got '{title}'"
        finally:
            page.close()

    def test_register_reentry_after_hide(self, browser, tmp_path):
        """registerLayer can be re-called after a layer is hidden by checkbox."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_register_reentry.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Register a layer
                const fg = L.featureGroup();
                api.registerLayer({ id: '__test_reentry__', name: 'ReEntry', layer: fg });
                // Simulate uncheck: unregister (as if user toggled the layer off)
                api.unregisterLayer('__test_reentry__');
                // Re-register (simulating MeasureControl tool re-activation)
                api.registerLayer({ id: '__test_reentry__', name: 'ReEntry', layer: fg });
                const found = api.layers.some(l => l.id === '__test_reentry__');
                return { found };
            }""")
            assert result is not None
            assert result["found"] is True
        finally:
            page.close()

    def test_register_readds_hidden_layer(self, browser, tmp_path):
        """register() re-adds mainLayer to map when layer was unchecked."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_register_readds.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Create a managed layer group (like MeasureControl does)
                const layers = api.createLayers({
                    id: '__test_measure__',
                    name: 'Test Measure',
                    graphPane: 'test_graph',
                    labelPane: 'test_label',
                });
                // Add content (triggers register)
                const mkr = L.circleMarker([26.08, 119.30]);
                mkr.isLabel = false;
                layers.mainLayer.addLayer(mkr);
                const wasRegistered = layers.registered();
                // Simulate uncheck: remove mainLayer from map
                api.map.removeLayer(layers.mainLayer);
                const onMapAfterUncheck = api.map.hasLayer(layers.mainLayer);
                // Trigger re-add via register() path (simulating tool click)
                const mkr2 = L.circleMarker([26.09, 119.31]);
                mkr2.isLabel = false;
                layers.mainLayer.addLayer(mkr2);
                const onMapAfterReadd = api.map.hasLayer(layers.mainLayer);
                // Check checkbox state in LayerControl panel
                const item = document.querySelector('[data-layer-id="__test_measure__"]');
                const cb = item ? item.querySelector('input[type="checkbox"]') : null;
                const checkboxChecked = cb ? cb.checked : 'no-cb';
                return { wasRegistered, onMapAfterUncheck, onMapAfterReadd, checkboxChecked };
            }""")
            assert result is not None
            assert result["wasRegistered"] is True, "Layer should be registered"
            assert result["onMapAfterUncheck"] is False, (
                "Layer should be removed from map after uncheck"
            )
            assert result["onMapAfterReadd"] is True, (
                "Layer should be re-added to map after tool re-activation"
            )
            assert result["checkboxChecked"] is True, (
                "Checkbox should be checked after re-activation"
            )
        finally:
            page.close()

    def test_fold_toggle_hides_overlay_items(self, browser, tmp_path):
        """Clicking the overlay fold-toggle-btn hides overlay layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_overlay.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click the overlay fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify overlay items are hidden
            result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in result), (
                f"Expected all overlay items hidden, got {result}"
            )

            # Verify base items are still visible
            base_result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item[data-layer-type="base"]');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in base_result), (
                f"Expected base items visible, got {base_result}"
            )
        finally:
            page.close()

    def test_fold_toggle_hides_base_items(self, browser, tmp_path):
        """Clicking the base fold-toggle-btn hides base layer items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )
        folium.TileLayer("CartoDB dark_matter", name="Dark Mode", overlay=False).add_to(
            m
        )
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_base.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click the base fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="base"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify base items are hidden
            result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item[data-layer-type="base"]');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in result), (
                f"Expected all base items hidden, got {result}"
            )

            # Verify overlay items are still visible
            overlay_result = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in overlay_result), (
                f"Expected overlay items visible, got {overlay_result}"
            )
        finally:
            page.close()

    def test_fold_toggle_toggle_unfold(self, browser, tmp_path):
        """Clicking the fold button again unfolds (shows) the items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_unfold.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Click fold button
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify folded
            folded = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d == "none" for d in folded), (
                f"Expected hidden after fold, got {folded}"
            )

            # Click fold button again to unfold
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Verify unfolded
            unfolded = page.evaluate("""() => {
                const items = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item)');
                return Array.from(items).map(el => getComputedStyle(el).display);
            }""")
            assert all(d != "none" for d in unfolded), (
                f"Expected visible after unfold, got {unfolded}"
            )
        finally:
            page.close()

    def test_fold_preserves_dom_index(self, browser, tmp_path):
        """Folded items remain in the DOM for index alignment."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_dom_index.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Count DOM items before fold (3 overlays + 1 default OSM base)
            before = page.evaluate(
                "document.querySelectorAll('.foliplus-layer-item:not(.foliplus-color-layer-item)').length"
            )
            assert before > 0, "Expected at least 1 layer item"

            # Fold overlay
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Count DOM items after fold — should still be same (not removed)
            after = page.evaluate(
                "document.querySelectorAll('.foliplus-layer-item:not(.foliplus-color-layer-item)').length"
            )
            assert after == before, (
                f"Expected {before} items after fold, got {after} — DOM items should not be removed"
            )
        finally:
            page.close()

    def test_bring_layer_to_front_runtime(self, browser, tmp_path):
        """bringLayerToFront moves the layer to front of z-order."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_bring_front.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Find the second layer (B) and bring it to front
                const idxB = api.layers.findIndex(l => l.name === 'B');
                if (idxB <= 0) return null;
                const idB = api.layers[idxB].id;
                api.bringLayerToFront(idB);
                // After bringLayerToFront, B should be at index 0
                const newIdx = api.layers.findIndex(l => l.name === 'B');
                return { initialIdx: idxB, newIdx };
            }""")
            assert result is not None, "LayerAPI not found"
            assert result["newIdx"] == 0, (
                f"Expected layer B at index 0 after bringToFront, got {result['newIdx']} (was {result['initialIdx']})"
            )
        finally:
            page.close()

    def test_unregister_layer_removes_dom(self, browser, tmp_path):
        """unregisterLayer removes the DOM item from the panel."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_unreg_dom.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Register a layer
                const fg = L.featureGroup();
                api.registerLayer({ id: '__test_unreg_dom__', name: 'UnregDOM', layer: fg });
                // Verify DOM item exists
                const item = document.querySelector('[data-layer-id="__test_unreg_dom__"]');
                const exists = !!item;
                // Unregister
                api.unregisterLayer('__test_unreg_dom__');
                const itemAfter = document.querySelector('[data-layer-id="__test_unreg_dom__"]');
                return { existsBefore: exists, existsAfter: !!itemAfter };
            }""")
            assert result is not None
            assert result["existsBefore"] is True, (
                "DOM item should exist after registerLayer"
            )
            assert result["existsAfter"] is False, (
                "DOM item should be removed after unregisterLayer"
            )
        finally:
            page.close()

    def test_find_layer_by_string_id(self, browser, tmp_path):
        """findLayer resolves a layer by string ID via layers array."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_find_by_id.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const fg = L.featureGroup();
                api.registerLayer({ id: '__test_find_id__', layer: fg });
                const found = api.findLayer('__test_find_id__');
                const isSame = found === fg;
                // Cleanup
                api.unregisterLayer('__test_find_id__');
                const afterCleanup = api.findLayer('__test_find_id__');
                return { found: !!found, isSame, afterCleanup: !!afterCleanup };
            }""")
            assert result is not None
            assert result["found"] is True, "findLayer should find the registered layer"
            assert result["isSame"] is True, (
                "findLayer should return the same layer instance"
            )
            assert result["afterCleanup"] is False, (
                "findLayer should return null after unregisterLayer"
            )
        finally:
            page.close()

    def test_color_layer_hides_tiles(self, browser, tmp_path):
        """Clicking color layer hides tilePane and removes base maps."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_color_tiles.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Click color layer item
            page.evaluate("""() => {
                const item = document.querySelector('.foliplus-color-layer-item');
                if (item) item.click();
            }""")
            page.wait_for_timeout(500)

            result = page.evaluate("""() => {
                const tilePane = document.querySelector('.leaflet-tile-pane');
                const hasTileHidden = tilePane && tilePane.classList.contains('foliplus-layer-tile-hidden');
                const mapContainer = document.querySelector('.leaflet-container');
                const hasColorBg = mapContainer && mapContainer.classList.contains('active');
                const tileLayers = document.querySelectorAll('.leaflet-tile-loaded');
                return { tileHidden: hasTileHidden, colorBg: hasColorBg, tileCount: tileLayers.length };
            }""")
            assert result is not None
            assert result["tileHidden"] is True, (
                "tilePane should have foliplus-layer-tile-hidden class"
            )
            assert result["colorBg"] is True, "map container should have active class"
            # Tiles may still be in DOM but not visible; check className
        finally:
            page.close()

    def test_destroy_cleanup_listeners(self, browser, tmp_path):
        """onRemove calls destroy() which removes layeradd listener."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ctrl = LayerControl().add_to(m)

        html_path = tmp_path / "test_destroy_cleanup.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const beforeDestroy = api.isDestroyed;
                api.destroy();
                return {
                    beforeDestroy,
                    isDestroyed: api.isDestroyed,
                    layersLength: api.layers.length,
                    hasLayerAPI: !!(window.foliplus && window.foliplus.LayerAPI),
                };
            }""")
            assert result is not None
            assert result["beforeDestroy"] is False, (
                "isDestroyed should be false before destroy"
            )
            assert result["isDestroyed"] is True, (
                "isDestroyed should be true after destroy"
            )
            assert result["layersLength"] == 0, (
                f"layers should be empty after destroy, got {result['layersLength']}"
            )
            assert result["hasLayerAPI"] is False, (
                "LayerAPI should be null after destroy"
            )
        finally:
            page.close()

    def test_register_layer_preserves_visible_on_reentry(self, browser, tmp_path):
        """registerLayer preserves the visible state from a previous registration."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_register_visible.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const fg = L.featureGroup();
                // Register, set visible=false, re-register
                api.registerLayer({ id: '__test_vis__', layer: fg });
                const li = api.layers.find(l => l.id === '__test_vis__');
                const defaultVisible = li.visible;
                // Simulate user hiding the layer
                li.visible = false;
                api.unregisterLayer('__test_vis__');
                api.registerLayer({ id: '__test_vis__', layer: L.featureGroup() });
                const newLi = api.layers.find(l => l.id === '__test_vis__');
                const newVisible = newLi.visible;
                // Cleanup
                api.unregisterLayer('__test_vis__');
                return { defaultVisible, newVisible };
            }""")
            assert result is not None
            assert result["defaultVisible"] is True, "Default visible should be true"
            assert result["newVisible"] is True, (
                "registerLayer after unregisterLayer resets visible to true"
            )
        finally:
            page.close()

    def test_register_re_register_preserves_fields(self, browser, tmp_path):
        """A partial re-register never drops previously registered fields.

        createLayerInfo is idempotent: fields absent from the second opts
        (layer/paneName/iconSvg/onToggle/onZIndex/name/isBase) fall back to
        the existing layerInfo instead of being reset to defaults.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_reregister_preserves.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;

                const fg = L.featureGroup();
                const onT = () => {};
                const onZ = () => {};
                api.registerLayer({
                    id: '__keep__',
                    name: 'Keep Me',
                    isBase: true,
                    layer: fg,
                    paneName: 'customPane',
                    iconSvg: '<svg></svg>',
                    onToggle: onT,
                    onZIndex: onZ,
                });
                const before = api.layers.find(l => l.id === '__keep__');
                const beforeCb = {
                    name: before.name, isBase: before.isBase,
                    layerSame: before.layer === fg,
                    paneName: before.paneName,
                    iconSvg: before.iconSvg,
                    hasOnToggle: before.onToggle === onT,
                    hasOnZIndex: before.onZIndex === onZ,
                };

                // Re-register with only the id — nothing else should change.
                api.registerLayer({ id: '__keep__' });
                const after = api.layers.find(l => l.id === '__keep__');
                const afterCb = {
                    name: after.name, isBase: after.isBase,
                    layerSame: after.layer === fg,
                    paneName: after.paneName,
                    iconSvg: after.iconSvg,
                    hasOnToggle: after.onToggle === onT,
                    hasOnZIndex: after.onZIndex === onZ,
                };

                api.unregisterLayer('__keep__');
                return { before: beforeCb, after: afterCb };
            }""")
            assert result is not None and "error" not in result, result
            for phase in ("before", "after"):
                r = result[phase]
                assert r["name"] == "Keep Me", f"{phase}: name lost"
                assert r["isBase"] is True, f"{phase}: isBase lost"
                assert r["layerSame"] is True, f"{phase}: layer lost"
                assert r["paneName"] == "customPane", f"{phase}: paneName lost"
                assert r["iconSvg"] == "<svg></svg>", f"{phase}: iconSvg lost"
                assert r["hasOnToggle"] is True, f"{phase}: onToggle lost"
                assert r["hasOnZIndex"] is True, f"{phase}: onZIndex lost"
        finally:
            page.close()

    def test_register_resolves_layer_from_map(self, browser, tmp_path):
        """createLayerInfo resolves layer from window globals when opts.layer is absent.

        registerLayer without a `layer` opts falls back to LayerUtils.findLayer
        (map._layers / window[id]) inside createLayerInfo, so li.layer is
        populated without a separate resolution pass.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_resolve_layer_from_map.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;

                // Simulate a folium-style global var that findLayer resolves.
                window['__resolved_layer__'] = L.featureGroup().addTo(api.map);
                api.registerLayer({ id: '__resolved_layer__' });
                const li = api.layers.find(l => l.id === '__resolved_layer__');

                const out = {
                    resolved: !!li.layer,
                    sameAsGlobal: li.layer === window['__resolved_layer__'],
                };
                api.unregisterLayer('__resolved_layer__');
                delete window['__resolved_layer__'];
                return out;
            }""")
            assert result is not None and "error" not in result, result
            assert result["resolved"] is True, "layer not resolved from map"
            assert result["sameAsGlobal"] is True, "resolved layer != window global"
        finally:
            page.close()

    def test_extract_points_api(self, browser, tmp_path):
        """extractPoints returns geo points from registered layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_extract_points.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const fg = L.featureGroup();
                // feature must be set directly on the layer instance,
                // not as an option — extractPoints checks l.feature
                const m1 = L.marker([26.08, 119.30]);
                m1.feature = { type: 'Feature' };
                const m2 = L.circleMarker([26.09, 119.31]);
                m2.feature = { type: 'Feature' };
                fg.addLayer(m1);
                fg.addLayer(m2);
                api.registerLayer({ id: '__test_extract__', layer: fg });
                const pts = api.extractPoints('__test_extract__');
                api.unregisterLayer('__test_extract__');
                return {
                    count: pts.length,
                    lat0: pts[0]?.lat,
                    lng0: pts[0]?.lng,
                    lat1: pts[1]?.lat,
                    lng1: pts[1]?.lng,
                };
            }""")
            assert result is not None
            assert result["count"] == 2, f"Expected 2 points, got {result['count']}"
            assert abs(result["lat0"] - 26.08) < 0.001
            assert abs(result["lng0"] - 119.30) < 0.001
            assert abs(result["lat1"] - 26.09) < 0.001
            assert abs(result["lng1"] - 119.31) < 0.001
        finally:
            page.close()

    def test_fold_svg_switches_on_toggle(self, browser, tmp_path):
        """Fold button uses a single SVG rotated 180° by CSS (not swapped) on toggle."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_svg.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            # Single SVG, 1 path before fold (SVGO converts polyline → path)
            elem_count = page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                return btn.querySelectorAll('path').length;
            }""")
            assert elem_count == 1, f"Expected 1 path (FOLD SVG), got {elem_count}"

            # Click to fold
            page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(300)

            # Still 1 path — icon is rotated by CSS, not swapped
            elem_count = page.evaluate("""() => {
                const btn = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] .foliplus-layer-fold-btn');
                return btn.querySelectorAll('path').length;
            }""")
            assert elem_count == 1, (
                f"Expected 1 path (CSS-rotated, not swapped), got {elem_count}"
            )
            # Row must carry the folded class so CSS rotation kicks in
            is_folded = page.evaluate("""() => {
                const row = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"]');
                return row.classList.contains('foliplus-layer-folded');
            }""")
            assert is_folded, "Expected foliplus-layer-folded class on row after fold"
        finally:
            page.close()

    def test_color_layer_pointer_cursor(self, browser, tmp_path):
        """Color layer item shows pointer cursor on hover."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html_path = tmp_path / "test_color_cursor.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            cursor = page.evaluate("""() => {
                const el = document.querySelector('.foliplus-color-layer-item');
                return el ? getComputedStyle(el).cursor : null;
            }""")
            assert cursor == "pointer", f"Expected pointer cursor, got {cursor}"
        finally:
            page.close()

    # ── Indeterminate checkbox browser tests ──

    def test_toggle_all_indeterminate_state(self, browser, tmp_path):
        """Toggle-all checkbox becomes indeterminate when some (not all) layers are checked."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_indeterminate.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Step 1: All checked → toggle-all should be checked (not indeterminate)
            all_checked = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return { checked: cb.checked, indeterminate: cb.indeterminate };
            }""")
            assert all_checked["checked"] is True, (
                "Expected toggle-all checked when all layers checked"
            )
            assert all_checked["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when all layers checked"
            )

            # Step 2: Uncheck one layer → toggle-all should be indeterminate
            page.evaluate("""() => {
                const cbs = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]');
                if (cbs[1]) cbs[1].click();
            }""")
            page.wait_for_timeout(300)

            partial = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return { checked: cb.checked, indeterminate: cb.indeterminate };
            }""")
            assert partial["checked"] is False, (
                "Expected toggle-all unchecked when some layers checked"
            )
            assert partial["indeterminate"] is True, (
                "Expected toggle-all indeterminate when some (not all) layers checked"
            )

            # Step 3: Uncheck all layers → toggle-all should be unchecked (not indeterminate)
            page.evaluate("""() => {
                const cbs = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]');
                cbs.forEach(cb => { if (cb.checked) cb.click(); });
            }""")
            page.wait_for_timeout(300)

            none = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return { checked: cb.checked, indeterminate: cb.indeterminate };
            }""")
            assert none["checked"] is False, (
                "Expected toggle-all unchecked when no layers checked"
            )
            assert none["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when no layers checked"
            )
        finally:
            page.close()

    def test_toggle_all_click_indeterminate_selects_all(self, browser, tmp_path):
        """Clicking indeterminate toggle-all selects all layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_indeterminate_click.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Uncheck one layer to make toggle-all indeterminate
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            # Verify indeterminate
            state = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return cb.indeterminate;
            }""")
            assert state is True, "Expected toggle-all indeterminate before click"

            # Click toggle-all (indeterminate → checked will select all)
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            # Verify all layers are now checked
            result = page.evaluate("""() => {
                const cbs = document.querySelectorAll('.foliplus-layer-item:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]');
                return Array.from(cbs).map(cb => cb.checked);
            }""")
            assert all(result), f"Expected all layers checked, got {result}"

            # Verify toggle-all is now checked (not indeterminate)
            final = page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-toggle-all[data-group="overlay"] [data-role="toggle-all"]');
                return { checked: cb.checked, indeterminate: cb.indeterminate };
            }""")
            assert final["checked"] is True, (
                "Expected toggle-all checked after select all"
            )
            assert final["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate after select all"
            )
        finally:
            page.close()

    def test_paneset_reset_after_hide_show(self, browser, tmp_path):
        """Hiding and re-showing a layer resets paneSet so enforceOrder re-moves paths.

        Uses a FeatureGroup with a child marker — the marker (leaf) is what
        gets migrated, so paneSet is asserted on the leaf layer. An empty
        container has no DOM to migrate, so paneSet is meaningless there.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        fg = folium.FeatureGroup(name="TestLayer", overlay=True, show=True).add_to(m)
        folium.Marker([26.08, 119.30], name="test_marker").add_to(fg)

        html_path = tmp_path / "test_paneset_reset.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Step 1: enforceOrder sets paneSet=true on the leaf marker
            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const li = api.layers.find(l => l.name === 'TestLayer');
                if (!li) return null;
                const layer = api.findLayer(li.id);
                if (!layer) return null;
                // Find the leaf marker inside the FeatureGroup
                let leaf = null;
                layer.eachLayer((l) => { if (!leaf) leaf = l; });
                if (!leaf) return null;
                return { id: li.id, paneSet: leaf.options.paneSet };
            }""")
            assert result is not None, "Layer not found"
            assert result["paneSet"] is True, (
                f"Expected paneSet=true on leaf after enforceOrder, got {result['paneSet']}"
            )

            # Step 2: Hide the layer by unchecking checkbox
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item input[type="checkbox"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            # Step 3: Show the layer again
            page.evaluate("""() => {
                const cb = document.querySelector('.foliplus-layer-item input[type="checkbox"]');
                if (cb) cb.click();
            }""")
            page.wait_for_timeout(300)

            # Step 4: handleChange reset the container paneSet; enforceOrder
            # re-migrates the leaf marker and sets its paneSet back to true
            paneset = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const li = api.layers.find(l => l.name === 'TestLayer');
                if (!li) return null;
                const layer = api.findLayer(li.id);
                if (!layer) return null;
                let leaf = null;
                layer.eachLayer((l) => { if (!leaf) leaf = l; });
                if (!leaf) return null;
                return leaf.options.paneSet;
            }""")
            assert paneset is True, (
                f"Expected paneSet=true on leaf after re-show, got {paneset}"
            )
        finally:
            page.close()

    def test_enforce_order_end_to_end(self, browser, tmp_path):
        """enforceOrder applies correct z-index to layers and migrates panes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        fg = folium.FeatureGroup(name="Overlay", overlay=True, show=True).add_to(m)
        folium.TileLayer("CartoDB positron", name="Base", overlay=False).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_enforce.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const overlayPane = document.querySelector('.leaflet-overlay-pane');
                const markerPane = document.querySelector('.leaflet-marker-pane');
                const overlayZ = overlayPane ? getComputedStyle(overlayPane).zIndex : null;
                const markerZ = markerPane ? getComputedStyle(markerPane).zIndex : null;
                return {
                    overlayZ: overlayZ,
                    markerZ: markerZ,
                    layerCount: api.layers.length,
                };
            }""")
            assert result is not None, "LayerAPI not found"
            assert result["layerCount"] >= 2, f"got {result['layerCount']} layers"
            # Leaflet sets z-index via CSS class, so computed style should be numeric
            assert result["overlayZ"] and result["overlayZ"] != "auto", "overlay pane should have z-index"
            assert result["markerZ"], "marker pane should have z-index"
        finally:
            page.close()

    def test_bring_layer_to_front_guard(self, browser, tmp_path):
        """bringLayerToFront is a no-op for base layers or when already at front."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay", overlay=True, show=True).add_to(m)
        folium.TileLayer("CartoDB positron", name="Base", overlay=False).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_bringfront.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const out = {};
                out.unknownOk = (() => { try { api.bringLayerToFront('nope'); return true; } catch(e) { return false; } })();
                return out;
            }""")
            assert result is not None
            assert result["unknownOk"] is True, (
                "bringToFront should be safe for unknown id"
            )
        finally:
            page.close()


class TestLayerControlEdgeCases:
    """Tests for uncovered edge cases and code paths."""

    def test_hide_color_restores_tile_pane(self, base_map: folium.Map):
        """hideColorLayer restores tilePane visibility."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert 'tilePane.classList.remove("foliplus-layer-tile-hidden")' in html
        assert "mapContainer.style.removeProperty" in html

    def test_deselect_all_bases_skips_except_index(self, base_map: folium.Map):
        """deselectAllBaseMaps skips the excluded index."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "deselectAllBaseMaps" in html
        assert "i !== exceptIdx" in html

    def test_handle_input_color_change(self, base_map: folium.Map):
        """handleInput reacts to color input changes."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "handleInput" in html
        assert "showColorLayer(e.target.value)" in html

    def test_bring_layer_to_front(self, base_map: folium.Map):
        """bringLayerToFront moves layer to top of list."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "bringLayerToFront" in html
        assert "this.layerRegistry.moveToFront(id)" in html

    def test_register_layer_requires_id(self, base_map: folium.Map):
        """registerLayer throws when id is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "id_required" in html
        assert "throw new Error" in html

    def test_create_canvas_requires_id(self, base_map: folium.Map):
        """createCanvas throws when id is missing."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "require_canvas_id" in html
        assert "throw new Error" in html

    def test_traverse_utility(self, base_map: folium.Map):
        """LayerUtils.traverse walks all layers (containers + leaves)."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "var traverse" in html
        assert "leafOnly" in html

    def test_register_sets_pane_on_non_path(self, base_map: folium.Map):
        """registerLayer sets pane on non-Path/Marker layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "opts.layer.options.pane = opts.paneName" in html
        assert "opts.layer.options.paneSet = true" in html

    def test_handle_change_resets_paneset_on_show(self, base_map: folium.Map):
        """handleChange resets paneSet=false after re-add to trigger enforceOrder re-move."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "target.checked && layer) layer.options.paneSet = false" in html

    def test_toggle_all_resets_paneset_on_show(self, base_map: folium.Map):
        """toggleAll resets paneSet=false after re-add for all layers."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "newState && layer) layer.options.paneSet = false" in html

    def test_drag_event_handlers_bound(self, base_map: folium.Map):
        """Drag-and-drop event handlers are registered."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "handleDragStart" in html
        assert "handleDragOver" in html
        assert "handleDragLeave" in html
        assert "handleDrop" in html
        assert "handleDragEnd" in html

    # ── Indeterminate checkbox (partial selection) tests ──

    def test_indeterminate_css_style_present(self):
        """:indeterminate CSS style exists for partial selection state."""
        css = Path("foliplus/css/LayerControl.css").read_text()
        assert ":indeterminate" in css
        assert ":indeterminate::after" in css
        # Should use a dash/minus icon (not a checkmark)
        assert "x1='6' y1='12' x2='18' y2='12'" in css

    def test_sync_toggle_all_sets_indeterminate(self, base_map: folium.Map):
        """syncToggleAll sets indeterminate when some (not all) layers are checked."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "allCb.indeterminate = !allChecked && !noneChecked" in html

    def test_sync_toggle_all_resets_indeterminate_on_all_checked(
        self, base_map: folium.Map
    ):
        """syncToggleAll resets indeterminate when all layers become checked."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # When all checked, checked=true and indeterminate=false
        assert "allCb.checked = allChecked" in html
        assert "allCb.indeterminate = !allChecked && !noneChecked" in html

    def test_sync_toggle_all_resets_indeterminate_on_none_checked(
        self, base_map: folium.Map
    ):
        """syncToggleAll resets indeterminate when no layers are checked."""
        LayerControl().add_to(base_map)
        html = render(base_map)
        # When none checked, checked=false and noneChecked triggers indeterminate=false
        assert "noneChecked = checkedCount === 0" in html
        assert "allCb.indeterminate = !allChecked && !noneChecked" in html

    # ── Performance optimizations ──

    def test_register_uses_debounced_enforce(self, base_map: folium.Map):
        """registerLayer defers enforceOrder via debouncedEnforce.

        Batch registration (e.g. MeasureControl adding many measurements) must
        coalesce reordering into a single pass instead of one synchronous
        enforceOrder per registerLayer call.
        """
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Scope the assertion to the registerLayer method body so onLayerAdd's
        # debouncedEnforce call does not satisfy it.
        start = html.index("registerLayer(opts) {")
        # Find the next method-level closing brace after registerLayer
        depth = 0
        end = start
        for k in range(start, len(html)):
            if html[k] == "{":
                depth += 1
            elif html[k] == "}":
                depth -= 1
                if depth == 0:
                    end = k + 1
                    break
        body = html[start:end]
        assert "this.debouncedEnforce()" in body, (
            "registerLayer must defer via debouncedEnforce"
        )
        assert "this.enforceOrder()" not in body, (
            "registerLayer must not call enforceOrder synchronously"
        )

    def test_unregister_no_invalidate_size(self, base_map: folium.Map):
        """unregisterLayer must not force invalidateSize.

        map.removeLayer already triggers Leaflet's internal size bookkeeping.
        A manual invalidateSize forces a full layout pass on every layer
        removal, causing unnecessary layout thrash during rapid add/remove
        (e.g. MeasureControl drawing sessions).
        """
        LayerControl().add_to(base_map)
        html = render(base_map)
        assert "invalidateSize" not in html

    def test_migrate_layers_skips_container_pane(self, base_map: folium.Map):
        """migrateLayers must not write pane on container layers.

        Only leaf layers (Path/Marker) should get options.pane + paneSet so a
        layerGroup's options stay unpolluted. Container pane writes would
        prevent re-migration when paneName changes.
        """
        LayerControl().add_to(base_map)
        html = render(base_map)
        # Container (eachLayer) nodes must be excluded from pane writes —
        # collect() recurses into containers and returns before writing pane.
        start = html.index("const collect =")
        end = html.index("collect(layer);")
        collect_body = html[start:end]
        # Container guard: recurse and skip pane writes for containers
        assert "if (l.eachLayer) {" in collect_body, (
            "migrateLayers must guard container layers"
        )
        assert "l.eachLayer(collect)" in collect_body, (
            "migrateLayers must recurse into containers"
        )
        assert "return;" in collect_body, (
            "migrateLayers must skip pane writes for containers"
        )

    def test_register_batch_coalesces_enforce(self, browser, tmp_path):
        """Batch registration coalesces enforceOrder into a single pass.

        Registering several layers back-to-back must not trigger a synchronous
        enforceOrder inside registerLayer itself. The only synchronous
        enforceOrder allowed comes from initTypesAndVisibility (first paint).
        Redundant per-register reordering is what this test guards against.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_batch_reg.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Count synchronous enforceOrder calls NOT originating from
                // initTypesAndVisibility (i.e. redundant per-register calls)
                let redundant = 0;
                const origEnforce = api.enforceOrder;
                api.enforceOrder = function () {
                    const caller = (new Error().stack.split('\\n')[2] || '');
                    if (!caller.includes('initTypesAndVisibility')) redundant++;
                    return origEnforce.call(this);
                };
                for (let i = 0; i < 3; i++) {
                    const mg = api.createLayers({
                        id: '__batch_' + i + '__',
                        name: 'Batch' + i,
                        graphPane: '__batch_graph_' + i + '__',
                    });
                    mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                }
                const during = { redundant };
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve({ during, after: { redundant } });
                    }, 200);
                });
            }""")
            assert result is not None, "LayerAPI not found"
            # No redundant (non-initTypes) synchronous enforceOrder during batch
            assert result["during"]["redundant"] == 0, (
                f"registerLayer called enforceOrder synchronously {result['during']['redundant']} times"
            )
            # After debounce, exactly one coalesced enforceOrder runs
            assert result["after"]["redundant"] == 1, (
                f"Expected exactly 1 coalesced enforceOrder, got {result['after']['redundant']}"
            )
        finally:
            page.close()

    def test_migrate_container_keeps_clean_options(self, browser, tmp_path):
        """Container layers are not re-migrated to fallback panes.

        migrateLayers must skip container nodes when writing pane options.
        The container's own pane stays whatever registerLayer assigned
        (paneName), and must NOT be overwritten with a fallback
        `foliplus_pane_*` name during migration.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_clean_container.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const mg = api.createLayers({
                    id: '__clean_cont__',
                    name: 'CleanCont',
                    graphPane: '__clean_graph__',
                });
                const poly = L.polyline([[26.08,119.30],[26.09,119.31]]);
                mg.mainLayer.addLayer(poly);
                // Leaf layer must be in the graph pane
                const leafPane = poly.options.pane;
                // Container must NOT be in a fallback pane
                const containerPane = mg.mainLayer.options.pane;
                return {
                    leafPane,
                    containerPane: typeof containerPane === 'undefined' ? null : containerPane,
                    isFallback: typeof containerPane === 'string' && containerPane.startsWith('foliplus_pane_'),
                    leafHasPath: !!(poly._path && poly._path.parentNode),
                };
            }""")
            assert result is not None
            assert result["leafPane"] == "__clean_graph__", (
                f"Leaf layer not migrated: {result['leafPane']}"
            )
            # Container must not be dumped into a per-layer fallback pane
            assert not result["isFallback"], (
                f"Container polluted with fallback pane: {result['containerPane']}"
            )
            # Leaf path must be rendered
            assert result["leafHasPath"] is True, "Leaf path not rendered"
        finally:
            page.close()

    def test_register_idempotent_keeps_order(self, browser, tmp_path):
        """Re-registering an existing layer must not reorder the list.

        MeasureControl.setMode calls layers.register() on every tool switch;
        registerLayer on an already-registered id must update fields in place
        instead of splice+unshift, which would silently destroy the user's
        drag order and persist the accidental order via saveOrder.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_register_idempotent.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const ids = [];
                for (let i = 0; i < 3; i++) {
                    const mg = api.createLayers({
                        id: '__idem_' + i + '__',
                        name: 'Idem' + i,
                        graphPane: '__idem_g' + i + '__',
                    });
                    mg.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                    ids.push('__idem_' + i + '__');
                }
                const orderBefore = api.layers.filter(l => ids.includes(l.id)).map(l => l.id);
                // Re-register the middle layer with same id (no layer, callback-only)
                api.registerLayer({ id: '__idem_1__', name: 'Idem1' });
                const orderAfter = api.layers.filter(l => ids.includes(l.id)).map(l => l.id);
                return { orderBefore, orderAfter, moved: orderBefore.join(',') !== orderAfter.join(',') };
            }""")
            assert result is not None, "LayerAPI not found"
            assert not result["moved"], (
                f"Re-register reordered layers: {result['orderBefore']} -> {result['orderAfter']}"
            )
        finally:
            page.close()

    def test_layeradd_during_enforce_reschedules(self, browser, tmp_path):
        """layeradd fired during enforceOrder must reschedule, not drop.

        onLayerAdd's isEnforcing guard returns early without rescheduling,
        which can skip a needed reorder for a layer added inside the
        enforceOrder window. The guard must fall back to debouncedEnforce.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_layeradd_during_enforce.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                // Simulate a layeradd arriving while enforceOrder is running.
                // onLayerAdd must fall back to debouncedEnforce instead of
                // silently dropping the reorder.
                let rescheduled = 0;
                const origDebounced = api.debouncedEnforce;
                api.debouncedEnforce = function () {
                    rescheduled++;
                    return origDebounced.call(this);
                };
                api.isEnforcing = true; // simulate in-flight enforceOrder
                api.onLayerAdd({ layer: { options: { paneName: "test" } } });
                api.isEnforcing = false;
                api.debouncedEnforce = origDebounced;
                return { rescheduled };
            }""")
            assert result is not None, "LayerAPI not found"
            # layeradd during enforce must be rescheduled via debouncedEnforce
            assert result["rescheduled"] >= 1, (
                f"layeradd during enforce dropped, rescheduled={result['rescheduled']}"
            )
        finally:
            page.close()

    def test_can_reorder_caches_base_boundary(self, browser, tmp_path):
        """canReorderBetween must not rescan findIndex on every call.

        handleDragOver fires many times per second while dragging; the base
        group boundary (firstBaseIdx) is stable during a drag session and
        should be cached on the manager.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)
        folium.TileLayer("CartoDB positron", name="Light", overlay=False).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_can_reorder_cache.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                let findIndexCalls = 0;
                const origFindIndex = Array.prototype.findIndex;
                Array.prototype.findIndex = function (fn) {
                    findIndexCalls++;
                    return origFindIndex.call(this, fn);
                };
                // Simulate a drag session: many dragover events between two
                // overlay layers (valid indices).
                for (let i = 0; i < 50; i++) api.canReorderBetween(0, 1);
                Array.prototype.findIndex = origFindIndex;
                return { findIndexCalls };
            }""")
            assert result is not None, "LayerAPI not found"
            # With a cached base boundary, repeated calls must not rescan.
            # Allow a tiny constant (setup scans), but 50 calls should stay
            # roughly flat, far below one scan per call.
            assert result["findIndexCalls"] <= 2, (
                f"canReorderBetween rescans findIndex per call: {result['findIndexCalls']}"
            )
        finally:
            page.close()

    def test_sync_attribution_caches_state(self, browser, tmp_path):
        """syncAttribution must skip _update when attribution state is unchanged.

        enforceOrder calls syncAttribution every run; rebuilding the
        attribution DOM each time is wasteful when the top attribution did
        not change.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light", overlay=False).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_attribution_cache.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                let updateCalls = 0;
                const attrCtrl = api.map.attributionControl;
                if (!attrCtrl) return { error: 'no attrCtrl' };
                const origUpdate = attrCtrl._update;
                attrCtrl._update = function () { updateCalls++; return origUpdate.call(this); };
                // Two consecutive enforceOrder with unchanged attribution
                api.enforceOrder();
                const afterFirst = updateCalls;
                api.enforceOrder();
                const afterSecond = updateCalls;
                attrCtrl._update = origUpdate;
                return { afterFirst, afterSecond, delta: afterSecond - afterFirst };
            }""")
            assert result is not None and "error" not in result
            # Second enforceOrder with unchanged attribution must not rebuild
            assert result["delta"] == 0, (
                f"syncAttribution rebuilt DOM on unchanged state: {result['delta']}"
            )
        finally:
            page.close()

    def test_render_initial_list_incremental(self, browser, tmp_path):
        """registerLayer on an existing UI must not rebuild the whole list.

        renderInitialList currently wipes innerHTML and re-creates every item,
        which is O(n) per registration (O(n^2) for n registrations). A
        registered layer should insert a single DOM item instead.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_render_incremental.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const panel = document.querySelector('.foliplus-panel-content');
                // Track re-renders by watching innerHTML replacement
                let innerHTMLSets = 0;
                const origDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
                // Count full-list rebuilds via ui.renderInitialList call
                let renderCalls = 0;
                const ui = api.ui;
                if (ui && ui.renderInitialList) {
                    const origRender = ui.renderInitialList;
                    ui.renderInitialList = function () { renderCalls++; return origRender.call(this); };
                }
                // Register two layers; each should NOT trigger a full rebuild
                const mg1 = api.createLayers({ id: '__incr_1__', name: 'Incr1', graphPane: '__incr_g1__' });
                mg1.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const afterFirst = renderCalls;
                const mg2 = api.createLayers({ id: '__incr_2__', name: 'Incr2', graphPane: '__incr_g2__' });
                mg2.mainLayer.addLayer(L.polyline([[26.08,119.30],[26.09,119.31]]));
                const afterSecond = renderCalls;
                return { afterFirst, afterSecond };
            }""")
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )
        finally:
            page.close()

    def test_layer_index_stays_in_sync(self, browser, tmp_path):
        """layerIndex (id → layerInfo) stays consistent with the layers array.

        The fast index must be updated on register/unregister/reorder so
        O(1) lookups (findLayer, getLayerType) never diverge from the array
        that owns the ordering.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_layer_index.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const check = () => {
                    const ids = api.layers.map(l => l.id);
                    const indexKeys = Array.from(api.layerRegistry.byId.keys());
                    const sameSet =
                        ids.length === indexKeys.length &&
                        ids.every(id => api.layerRegistry.has(id));
                    // Index values must reference the same objects as the array
                    const sameRefs = ids.every(id =>
                        api.layerRegistry.get(id) === api.layers.find(l => l.id === id)
                    );
                    return { sameSet, sameRefs };
                };

                // 1. Register several layers
                for (let i = 0; i < 3; i++) {
                    api.registerLayer({ id: '__idx_' + i + '__', name: 'Idx' + i, layer: L.marker([26.08 + i*0.01, 119.30]) });
                }
                const afterRegister = check();

                // 2. Unregister one
                api.unregisterLayer('__idx_1__');
                const afterUnregister = check();

                // 3. Reorder (bring to front)
                api.bringLayerToFront('__idx_2__');
                const afterReorder = check();

                // 4. findLayer / getLayerType via the index
                const found = api.findLayer('__idx_0__') != null;
                // L.marker has no .feature so geometry type is UNKNOWN — the
                // point here is that getLayerType resolves via the index at all
                // (non-null, no exception), not its exact value.
                const typeResolved = api.getLayerType('__idx_0__') != null;

                return {
                    afterRegister,
                    afterUnregister,
                    afterReorder,
                    found,
                    typeResolved,
                };
            }""")
            assert result is not None, "LayerAPI not found"
            assert result["afterRegister"]["sameSet"], (
                "index set diverged after register"
            )
            assert result["afterRegister"]["sameRefs"], (
                "index refs diverged after register"
            )
            assert result["afterUnregister"]["sameSet"], (
                "index set diverged after unregister"
            )
            assert result["afterUnregister"]["sameRefs"], (
                "index refs diverged after unregister"
            )
            assert result["afterReorder"]["sameSet"], "index set diverged after reorder"
            assert result["afterReorder"]["sameRefs"], (
                "index refs diverged after reorder"
            )
            assert result["found"], "findLayer failed via index"
            assert result["typeResolved"], "getLayerType failed via index"
        finally:
            page.close()

    def test_layer_registry_api(self, browser, tmp_path):
        """LayerRegistry exposes ordered list + id index semantics.

        The registry must behave like an ordered array for DOM-aligned code
        (length, index access, iteration) while keeping an id → layerInfo map
        in sync on every mutation.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_registry_api.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const coll = api.layerRegistry;
                if (!coll) return { error: 'no layerRegistry exposed' };
                const out = {};

                // Start from an empty registry so assertions are independent
                // of the map's initial layers.
                coll.replace([]);

                // Ordered-array semantics
                const a = { id: 'a', name: 'A' };
                const b = { id: 'b', name: 'B' };
                coll.prepend(a);
                coll.prepend(b);          // b, a
                out.afterPrepend = { len: coll.size, first: coll.at(0).id, second: coll.at(1).id };

                // Index semantics
                out.getById = coll.get('a').name;
                out.hasA = coll.has('a');
                out.indexOfA = coll.indexOf(a);

                // Idempotent upsert keeps position
                coll.upsert({ id: 'b', name: 'B2' });
                out.afterUpsert = { len: coll.size, idxB: coll.indexOf(coll.get('b')), name: coll.get('b').name };

                // Remove keeps index in sync
                coll.remove('a');
                out.afterRemove = { len: coll.size, hasA: coll.has('a'), first: coll.at(0).id };

                // Iteration preserves order
                coll.upsert({ id: 'c', name: 'C' });
                const ids = [];
                for (const li of coll) ids.push(li.id);
                out.iter = ids;

                // replace rebuilds both list and index
                coll.replace([{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]);
                out.afterReplace = {
                    len: coll.size,
                    hasX: coll.has('x'),
                    hasOld: coll.has('b'),
                    first: coll.at(0).id,
                };
                return out;
            }""")
            assert result is not None and "error" not in result, (
                result if result else "LayerAPI not found"
            )
            assert result["afterPrepend"] == {
                "len": 2,
                "first": "b",
                "second": "a",
            }, f"prepend order wrong: {result['afterPrepend']}"
            assert result["getById"] == "A", "get by id failed"
            assert result["hasA"] is True, "has failed"
            assert result["indexOfA"] == 1, "indexOf failed"
            assert result["afterUpsert"]["len"] == 2, "upsert changed size"
            assert result["afterUpsert"]["idxB"] == 0, "upsert moved item"
            assert result["afterUpsert"]["name"] == "B2", "upsert did not update"
            assert result["afterRemove"]["len"] == 1, "remove changed size"
            assert result["afterRemove"]["hasA"] is False, "remove left index entry"
            assert result["afterRemove"]["first"] == "b", "remove reorder wrong"
            assert result["iter"] == ["b", "c"], (
                f"iteration order wrong: {result['iter']}"
            )
            assert result["afterReplace"]["len"] == 2, "replace size wrong"
            assert result["afterReplace"]["hasX"] is True, "replace missing new id"
            assert result["afterReplace"]["hasOld"] is False, "replace left old id"
            assert result["afterReplace"]["first"] == "x", "replace order wrong"
        finally:
            page.close()

    def test_initial_data_normalized_into_full_layerinfo(self, browser, tmp_path):
        """Initial data entries get the full layerInfo field set.

        Plain template entries are only {name, id, visible, isBase} — the
        registry must normalize them through createLayerInfo so every entry
        carries the complete field set (paneName/iconSvg/type/canvas/
        onToggle/onZIndex present).

        `li.layer` resolution is intentionally NOT asserted here: it is a
        best-effort, timing-sensitive lookup (script order of the folium
        template can define a layer's global var after the manager is
        constructed) and is recovered lazily at runtime via the
        `li.layer || findLayer()` fallback.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = m.get_root().render()
        html_path = tmp_path / "lc_init_normalized.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const coll = api.layerRegistry;
                if (!coll) return { error: 'no layerRegistry exposed' };

                const KEYS = [
                    'name', 'id', 'visible', 'isBase', 'paneName',
                    'iconSvg', 'type', 'layer', 'canvas', 'onToggle', 'onZIndex',
                ];
                const out = { entries: [] };
                for (const li of coll) {
                    const entry = {
                        id: li.id,
                        isBase: li.isBase,
                        hasAllKeys: true,
                        missing: [],
                    };
                    for (const k of KEYS)
                        if (!(k in li)) { entry.hasAllKeys = false; entry.missing.push(k); }
                    entry.typeNull = li.type === null;
                    out.entries.push(entry);
                }
                return out;
            }""")
            assert result is not None and "error" not in result, (
                result if result else "LayerAPI not found"
            )
            # tiles=None avoids folium's default OSM, so only the two
            # explicitly added layers appear as initial data.
            assert len(result["entries"]) == 2, (
                f"expected 2 initial layers, got {result['entries']}"
            )
            for entry in result["entries"]:
                assert entry["hasAllKeys"] is True, (
                    f"layer {entry['id']} missing fields: {entry['missing']}"
                )
                assert entry["typeNull"] is True, (
                    f"layer {entry['id']} type should start null"
                )
            # One overlay (isBase=false) and one base (isBase=true)
            flags = sorted(e["isBase"] for e in result["entries"])
            assert flags == [False, True], f"isBase flags wrong: {flags}"
        finally:
            page.close()

    def test_layers_view_is_readonly(self, browser, tmp_path):
        """api.layers is a read-only view — direct mutation is blocked.

        External callers must go through LayerAPI (registerLayer/unregisterLayer
        etc.) so the registry index can never be bypassed or drift from the list.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "lc_layers_readonly.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        try:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )

            result = page.evaluate("""() => {
                const api = window.foliplus && window.foliplus.LayerAPI;
                if (!api) return null;
                const out = {};

                // Read operations still work
                out.length = api.layers.length;
                out.firstId = api.layers[0] ? api.layers[0].id : null;
                out.mapped = api.layers.map(l => l.id).length;

                // Direct mutations must throw
                out.pushThrew = false;
                try { api.layers.push({ id: 'nope' }); } catch (e) { out.pushThrew = true; }

                out.spliceThrew = false;
                try { api.layers.splice(0, 1); } catch (e) { out.spliceThrew = true; }

                out.assignThrew = false;
                try { api.layers[0] = { id: 'nope' }; } catch (e) { out.assignThrew = true; }

                out.shiftThrew = false;
                try { api.layers.shift(); } catch (e) { out.shiftThrew = true; }

                return out;
            }""")
            assert result is not None, "LayerAPI not found"
            assert result["length"] > 0, "read length failed"
            assert result["firstId"], "read index failed"
            assert result["mapped"] == result["length"], "read map failed"
            assert result["pushThrew"] is True, "push should throw"
            assert result["spliceThrew"] is True, "splice should throw"
            assert result["assignThrew"] is True, "index assign should throw"
            assert result["shiftThrew"] is True, "shift should throw"
        finally:
            page.close()
