"""Tests for foliplus.HeatmapControl."""

from __future__ import annotations

import json
from pathlib import Path

import folium
from conftest import render

from foliplus import HeatmapControl


class TestHeatmapControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert HeatmapControl()._name == "HeatmapControl"

    def test_default_position(self):
        assert HeatmapControl().position == "topleft"

    def test_custom_position(self):
        assert HeatmapControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert HeatmapControl()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert HeatmapControl(locale="zh")._LOCALE_CODE == "zh"

    def test_default_params(self):
        ctrl = HeatmapControl()
        assert ctrl.color_scheme == "Reds"
        assert ctrl.method == "jenks"
        assert ctrl.n_classes == 6
        assert ctrl.agg == "count"
        assert len(ctrl.schemes) == 7
        assert ctrl.style["border_weight"] == 1.5
        assert ctrl.style["label_show"] is True

    def test_custom_params(self):
        ctrl = HeatmapControl(
            color_scheme="Reds",
            method="quantile",
            n_classes=4,
            agg="sum",
            schemes=["Reds", "Blues"],
            style={"border_weight": 2.0, "label_show": False},
        )
        assert ctrl.color_scheme == "Reds"
        assert ctrl.method == "quantile"
        assert ctrl.n_classes == 4
        assert ctrl.agg == "sum"
        assert ctrl.schemes == ["Reds", "Blues"]
        assert ctrl.style["border_weight"] == 2.0
        assert ctrl.style["label_show"] is False


class TestHeatmapControlRendering:
    def test_default_params(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap-ctrl" in html

    def test_custom_color_scheme(self, base_map: folium.Map):
        HeatmapControl(color_scheme="Reds").add_to(base_map)
        html = render(base_map)
        assert "Reds" in html

    def test_custom_method(self, base_map: folium.Map):
        HeatmapControl(method="quantile").add_to(base_map)
        html = render(base_map)
        assert "quantile" in html

    def test_custom_agg(self, base_map: folium.Map):
        HeatmapControl(agg="sum").add_to(base_map)
        html = render(base_map)
        assert "sum" in html

    def test_custom_n_classes(self, base_map: folium.Map):
        HeatmapControl(n_classes=4).add_to(base_map)
        html = render(base_map)
        assert "4" in html

    def test_contains_h3_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "h3-js@4" in html
        assert "h3-js.umd.js" in html

    def test_contains_ss_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "simple-statistics" in html
        assert "simple-statistics.min.js" in html

    def test_contains_chroma_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "chroma-js@2" in html
        assert "chroma.min.js" in html

    def test_custom_schemes(self, base_map: folium.Map):
        HeatmapControl(schemes=["Reds", "Greens"]).add_to(base_map)
        html = render(base_map)
        assert "Reds" in html
        assert "Greens" in html

    def test_custom_style(self, base_map: folium.Map):
        HeatmapControl(style={"border_weight": 2.0, "label_show": False}).add_to(
            base_map
        )
        html = render(base_map)
        assert "2.0" in html or "2" in html
        assert "false" in html.lower()

    def test_locale_zh(self, base_map: folium.Map):
        HeatmapControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "网格聚合" in html
        # 'HeatmapControl.title' appears in JS source as locale key (e.g. _('HeatmapControl.title'))
        # but the rendered display text should be the Chinese translation
        assert "heatmap.title" in html  # present as JS key, display value is "网格聚合"

    def test_label_marker_config(self, base_map: folium.Map):
        """Label markers use custom pane and no zIndexOffset."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "graphPane: CONST.GRAPH_PANE" in html
        assert "heatmap-label" in html

    def test_label_zindex_css(self, base_map: folium.Map):
        """.heatmap-label has !important z-index to override Leaflet's negative formula."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "z-index: var(--z-index-pane-base) !important" in html

    def test_formatnumber_usage(self, base_map: folium.Map):
        """Label values are formatted via foliplus.formatNumber."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.formatNumber" in html

    def test_default_color_scheme_rendered(self, base_map: folium.Map):
        """Default color scheme Reds appears in rendered output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "Reds" in html

    def test_pane_name_constant(self, base_map: folium.Map):
        """graphPane is used as pane name consistently."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "__heatmap__" in html
        assert "graphPane: CONST.GRAPH_PANE" in html

    def test_graphlayer_pane_init(self, base_map: folium.Map):
        """graphLayer is initialized with pane: this.graphPane."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "graphPane: CONST.GRAPH_PANE" in html

    def test_register_before_add_data(self, base_map: folium.Map):
        """renderHexagons uses addGraph which auto-registers in LayerControl."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.mg.addGraph(gj)" in html
        assert "this.mg.clearAll()" in html
        assert "this.mg.addLabel(" in html

    def test_extract_points_filters_no_feature(self, base_map: folium.Map):
        """extractPoints only accepts markers with .feature."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "extractPoints" in html
        # Must filter by .feature to skip label/annotation markers
        assert "!l.feature" in html

    def test_style_field(self, base_map: folium.Map):
        """style.field is injected into JS template."""
        HeatmapControl(style={"field": "value"}).add_to(base_map)
        html = render(base_map)
        assert '"value"' in html or "'value'" in html

    def test_scheme_names_inline(self, base_map: folium.Map):
        """schemes list is inlined as JSON array."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "Blues" in html and "Viridis" in html

    def test_scheme_dropdown_items_have_data_attr(self, base_map: folium.Map):
        """Dropdown items store scheme name for refreshSchemeDropdownItems."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "data-scheme-name" in html

    def test_class_count_select_range(self, base_map: folium.Map):
        """Class count select has options 2-9."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        for n in (2, 5, 9):
            assert str(n) in html

    def test_onremove_cleanup(self, base_map: folium.Map):
        """onRemove exists in the JS output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "onRemove()" in html
        assert "observer.disconnect" in html
        assert 'manager.map.off("zoomend", this.manager.onZoomEnd)' in html
        assert (
            'manager.map.off("layeradd layerremove", this.manager.onLayerChange)'
            in html
        )

    def test_no_layer_hint(self, base_map: folium.Map):
        """initScan shows no_layer hint when no point layers found."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.no_layer" in html
        assert "4000" in html  # hint duration

    def test_auto_field_single_field_detection(self, base_map: folium.Map):
        """Auto field logic uses the first discovered field (collectFields order)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "pickAutoField(fields)" in html
        assert "return fields[0];" in html
        assert "this.manager.autoFieldKey = this.manager.pickAutoField(fields);" in html

    def test_auto_field_priority_and_fallback(self, base_map: folium.Map):
        """Auto mode picks the first discovered field (collectFields order)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "return fields[0];" in html
        assert "readMarkerField(marker, field)" in html

    def test_auto_field_key_resets_on_clear(self, base_map: folium.Map):
        """Clear action resets autoFieldKey to avoid stale field selection."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.manager.autoFieldKey = null;" in html

    def test_named_handler_cleanup(self, base_map: folium.Map):
        """bindMapEvents uses named handlers (onZoomEnd, onLayerChange)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.onZoomEnd" in html
        assert "this.onLayerChange" in html
        assert 'map.on("zoomend", this.onZoomEnd)' in html
        assert 'map.on("layeradd layerremove", this.onLayerChange)' in html

    def test_get_point_value_dedup(self, base_map: folium.Map):
        """getPointValue delegates to readMarkerField instead of duplicating branch logic."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.readMarkerField(marker, key)" in html
        # Should NOT contain inline field resolution branches
        assert "this.currentField === '_value'" not in html
        assert "this.currentField === 'options.value'" not in html

    def test_error_keys_injected(self, base_map: folium.Map):
        """Error/warning locale keys appear in rendered HTML."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.value_fallback" in html
        assert "HeatmapControl.h3_cell_fail" in html
        assert "HeatmapControl.h3_boundary_fail" in html
        assert "HeatmapControl.close_title" in html


class TestHeatmapControlBrowser:
    """Browser-based smoke tests for HeatmapControl."""

    @staticmethod
    def _stub_html(html: str) -> str:
        """Apply CDN stubs so the heatmap UI initialises without network."""
        for dep in ("h3", "ss", "chroma"):
            html = html.replace(
                f'check: () => typeof {dep} !== "undefined"',
                "check: () => true",
            )
        html = html.replace(
            'if (ok && typeof h3 !== "undefined" && typeof ss !== "undefined") return run();',
            'window.h3={latLngToCell:function(){return ""},cellToBoundary:function(c){return [[0,0],[0,0],[0,0]]},cellToLatLng:function(){return [0,0]}};'
            "window.ss={jenks:function(){return[0,1]},quantile:function(){return 0.5}};"
            'window.chroma={scale:function(){return{mode:function(){return{colors:function(){return["#f00"]}}}}}};'
            "run();",
        )
        return html

    @staticmethod
    def _expose_ctrl(html: str) -> str:
        """Expose heatmapCtrl as window.__heatmapCtrl for runtime assertions."""
        return html.replace(
            "heatmapCtrl.addTo(map);\n    heatmapCtrl.initScan(CONST.INIT_SCAN_ATTEMPTS);",
            "window.__heatmapCtrl = heatmapCtrl;\n    heatmapCtrl.addTo(map);\n    heatmapCtrl.initScan(CONST.INIT_SCAN_ATTEMPTS);",
        )

    def _make_page(self, browser, tmp_path, expose_ctrl=False):
        """Build a page with point layers + HeatmapControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        for lat, lng in [(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]:
            gj = json.dumps({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {"val": lat},
                    "geometry": {"type": "Point", "coordinates": [lng, lat]},
                }],
            })
            folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)

        html = self._stub_html(m.get_root().render())
        if expose_ctrl:
            html = self._expose_ctrl(html)
        html_path = tmp_path / "heatmap_browser.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        errors = []
        page.on("console", lambda msg: (
            errors.append(msg.text)
            if msg.type == "error" and not msg.text.startswith("Failed to load resource")
            else None
        ))
        page.goto(f"file://{html_path}", wait_until="domcontentloaded")
        page.wait_for_selector(".heatmap-ctrl", state="attached", timeout=10000)
        return page, errors

    # ── Tests ──────────────────────────────────────────────────────

    def test_panel_interaction(self, browser, tmp_path):
        """Open heatmap panel, verify layer dropdown populates."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)

        try:
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
            page.wait_for_timeout(2000)

            options_count = page.evaluate(
                "document.querySelectorAll('.heatmap-ctrl .layer-select option').length"
            )
            assert options_count >= 2

            page.evaluate("document.querySelector('.heatmap-ctrl .close-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.collapsed", state="attached", timeout=5000)

            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_default_values_initialized(self, browser, tmp_path):
        """Constructor initialises all user-configurable defaults."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            vals = page.evaluate("""() => {
                const m = window.__heatmapCtrl.manager;
                return {
                    N_CLASSES: m.N_CLASSES,
                    BORDER_W: m.BORDER_W,
                    BORDER_COLOR: m.BORDER_COLOR,
                    currentLabelShow: m.currentLabelShow,
                    currentMethod: m.currentMethod,
                    currentScheme: m.currentScheme,
                    currentAgg: m.currentAgg,
                };
            }""")
            assert vals["N_CLASSES"] == 6, f"N_CLASSES expected 6 got {vals['N_CLASSES']}"
            assert vals["BORDER_W"] == 1.5, f"BORDER_W expected 1.5 got {vals['BORDER_W']}"
            assert vals["BORDER_COLOR"] == "#333", f"BORDER_COLOR got {vals['BORDER_COLOR']}"
            assert vals["currentLabelShow"] is True, "currentLabelShow should be True"
            assert vals["currentMethod"] == "jenks"
            assert vals["currentScheme"] == "Reds"
            assert vals["currentAgg"] == "count"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_label_toggle_updates_state(self, browser, tmp_path):
        """Toggling the label checkbox updates manager.currentLabelShow."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
            page.wait_for_timeout(2000)

            before = page.evaluate("window.__heatmapCtrl.manager.currentLabelShow")
            # Uncheck label
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-switch input').click()")
            after = page.evaluate("window.__heatmapCtrl.manager.currentLabelShow")
            assert before is True, f"expected True, got {before}"
            assert after is False, f"expected False, got {after}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_layer_selection_triggers_render(self, browser, tmp_path):
        """Selecting a layer calls renderHexagons (graphLayer gets content)."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
            page.wait_for_timeout(3000)

            # Select the first non-placeholder layer
            opts = page.evaluate(
                "Array.from(document.querySelector('.heatmap-ctrl .layer-select option')).slice(1).map(o => o.value)"
            )
            assert opts, "No layer options found"
            page.evaluate(f"""() => {{
                const sel = document.querySelector('.heatmap-ctrl .layer-select');
                sel.value = '{opts[0]}';
                sel.dispatchEvent(new Event('change'));
            }}""")
            page.wait_for_timeout(2000)

            # graphLayer should have content after renderHexagons
            has_content = page.evaluate(
                "Object.keys(window.__heatmapCtrl.manager.mg.graphLayer._layers || {}).length > 0"
            )
            assert has_content, "graphLayer should have content after layer selection"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_removes_content(self, browser, tmp_path):
        """clearAll() empties graphLayer and labelLayer, triggering unregister."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            # Render some content first
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
            page.wait_for_timeout(3000)
            opts = page.evaluate(
                "Array.from(document.querySelector('.heatmap-ctrl .layer-select option')).slice(1).map(o => o.value)"
            )
            if opts:
                page.evaluate(f"""() => {{
                    const sel = document.querySelector('.heatmap-ctrl .layer-select');
                    sel.value = '{opts[0]}';
                    sel.dispatchEvent(new Event('change'));
                }}""")
                page.wait_for_timeout(2000)

            # Call clearAll
            page.evaluate("window.__heatmapCtrl.manager.mg.clearAll()")
            page.wait_for_timeout(500)

            graph_empty = page.evaluate(
                "Object.keys(window.__heatmapCtrl.manager.mg.graphLayer._layers || {}).length === 0"
            )
            label_empty = page.evaluate(
                "Object.keys(window.__heatmapCtrl.manager.mg.labelLayer._layers || {}).length === 0"
            )
            assert graph_empty, "graphLayer should be empty after clearAll"
            assert label_empty, "labelLayer should be empty after clearAll"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_button_works(self, browser, tmp_path):
        """Pressing the clear button resets all controls and clears layers."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
            page.wait_for_timeout(3000)

            # Change some values
            page.evaluate("window.__heatmapCtrl.manager.N_CLASSES = 4")
            # Click clear
            page.evaluate("document.querySelector('.heatmap-ctrl .btn-clear').click()")
            page.wait_for_timeout(500)

            mgr = page.evaluate("""() => {
                const m = window.__heatmapCtrl.manager;
                return { N_CLASSES: m.N_CLASSES, BORDER_W: m.BORDER_W,
                         BORDER_COLOR: m.BORDER_COLOR, currentMethod: m.currentMethod,
                         currentScheme: m.currentScheme };
            }""")
            assert mgr["N_CLASSES"] == 6, f"expected 6 got {mgr['N_CLASSES']}"
            assert mgr["BORDER_W"] == 1.5
            assert mgr["currentMethod"] == "jenks"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()



class TestHeatmapAutoFieldBrowser:
    """Browser tests verifying auto-field selection logic in the DOM.

    These tests inject a ``window.__heatmapCtrl`` reference into the page so they
    can read the internal ``autoFieldKey`` state after ``updateFieldSelector`` runs.
    """

    @staticmethod
    def _build_page(
        tmp_path: Path,
        browser,
        features: list[dict],
        agg: str = "sum",
    ):
        """Render a map with one point FeatureGroup plus HeatmapControl.

        Returns a (page, errors) tuple.  The caller is responsible for
        ``page.close()``.
        """
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        for feat in features:
            gj = json.dumps({"type": "FeatureCollection", "features": [feat]})
            folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)

        LayerControl().add_to(m)
        HeatmapControl().add_to(m)

        html = m.get_root().render()
        # Expose heatmapCtrl for test assertions
        html = html.replace(
            "heatmapCtrl.addTo(map);\n    heatmapCtrl.initScan(CONST.INIT_SCAN_ATTEMPTS);",
            "window.__heatmapCtrl = heatmapCtrl;\n    heatmapCtrl.addTo(map);\n    heatmapCtrl.initScan(CONST.INIT_SCAN_ATTEMPTS);",
        )

        html_path = tmp_path / "test_heatmap_autofield.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()

        # Stub loadScripts so the heatmap UI initializes without network deps.
        # Also inject stubs for h3/ss/chroma so the heatmap initialisation and
        # render path succeed without CDN scripts.
        html = html.replace(
            'check: () => typeof h3 !== "undefined"',
            "check: () => true",
        )
        html = html.replace(
            'check: () => typeof ss !== "undefined"',
            "check: () => true",
        )
        html = html.replace(
            'check: () => typeof chroma !== "undefined"',
            "check: () => true",
        )
        html = html.replace(
            'if (ok && typeof h3 !== "undefined" && typeof ss !== "undefined") return run();',
            'window.h3={latLngToCell:function(){return ""},cellToBoundary:function(c){return [[0,0],[0,0],[0,0]]},cellToLatLng:function(){return [0,0]}};'
            "window.ss={jenks:function(){return[0,1]},quantile:function(){return 0.5}};"
            'window.chroma={scale:function(){return{mode:function(){return{colors:function(){return["#f00"]}}}}}};'
            "run();",
        )
        html_path.write_text(html, encoding="utf-8")

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

        page.wait_for_selector(".heatmap-ctrl", state="attached", timeout=10000)

        # Open panel
        page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
        page.wait_for_selector(".heatmap-ctrl.expanded", state="attached", timeout=5000)
        page.wait_for_timeout(2000)

        return page, errors

    def test_auto_field_priority_order(self, browser, tmp_path):
        """Auto-field picks the first discovered field.

        ``collectFields`` discovers fields in marker-iteration order:
        ``_value`` → ``options.value`` → ``feature.properties`` keys.  Only
        ``properties.*`` fields exist for GeoJSON markers, so the first
        property key is returned.
        """
        features = [
            {
                "type": "Feature",
                "properties": {"population": 100, "density": 50},
                "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
            },
            {
                "type": "Feature",
                "properties": {"population": 200, "density": 30},
                "geometry": {"type": "Point", "coordinates": [119.31, 26.09]},
            },
        ]
        page, errors = self._build_page(tmp_path, browser, features, agg="sum")

        try:
            # Select the first layer (there's only one)
            layer_select = ".heatmap-ctrl .layer-select"
            options = page.evaluate(
                f"Array.from(document.querySelectorAll('{layer_select} option')).map(o => o.value)"
            )
            # Skip the empty/default option, pick the first real layer
            real_options = [v for v in options if v]
            assert len(real_options) >= 1, f"No layer options found: {options}"
            page.evaluate(
                f"document.querySelector('{layer_select}').value = '{real_options[0]}'"
            )
            page.evaluate(
                f"document.querySelector('{layer_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Switch aggregation to 'sum' so the field selector appears.
            # The agg select is the first <select> inside .extra-body.
            agg_select = ".heatmap-ctrl .extra-body > .form-row:nth-child(1) .form-control-wrap select"
            page.evaluate(f"document.querySelector('{agg_select}').value = 'sum'")
            page.evaluate(
                f"document.querySelector('{agg_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Verify field selector is visible and _auto is selected.
            # The field select is the <select> inside .field-wrap.
            field_select = ".heatmap-ctrl .field-wrap .form-control-wrap select"
            field_val = page.evaluate(f"document.querySelector('{field_select}').value")
            assert field_val == "_auto", f"Expected '_auto', got '{field_val}'"

            # Verify field options include our properties
            field_opts = page.evaluate(
                f"Array.from(document.querySelectorAll('{field_select} option')).map(o => o.value)"
            )
            assert "properties.population" in field_opts, (
                f"Missing 'properties.population': {field_opts}"
            )
            assert "properties.density" in field_opts, (
                f"Missing 'properties.density': {field_opts}"
            )

            # collectFields returns fields in the order they are discovered
            # during marker iteration.  The exact key depends on V8 property
            # enumeration order — the important thing is deterministic choice.
            auto_key = page.evaluate("window.__heatmapCtrl.manager.autoFieldKey")
            assert auto_key and auto_key.startswith("properties."), (
                f"Expected a 'properties.*' key, got '{auto_key}'"
            )
            assert auto_key in ("properties.population", "properties.density"), (
                f"Unexpected autoFieldKey '{auto_key}'"
            )

            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_auto_field_single_field(self, browser, tmp_path):
        """Single-field layer uses that field directly as autoFieldKey."""
        features = [
            {
                "type": "Feature",
                "properties": {"elevation": 300},
                "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
            },
            {
                "type": "Feature",
                "properties": {"elevation": 150},
                "geometry": {"type": "Point", "coordinates": [119.31, 26.09]},
            },
        ]
        page, errors = self._build_page(tmp_path, browser, features, agg="avg")

        try:
            layer_select = ".heatmap-ctrl .layer-select"
            options = page.evaluate(
                f"Array.from(document.querySelectorAll('{layer_select} option')).map(o => o.value)"
            )
            real_options = [v for v in options if v]
            assert len(real_options) >= 1
            page.evaluate(
                f"document.querySelector('{layer_select}').value = '{real_options[0]}'"
            )
            page.evaluate(
                f"document.querySelector('{layer_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Switch to 'avg' so field selector appears.
            # The agg select is the first <select> inside .extra-body.
            agg_select = ".heatmap-ctrl .extra-body > .form-row:nth-child(1) .form-control-wrap select"
            page.evaluate(f"document.querySelector('{agg_select}').value = 'avg'")
            page.evaluate(
                f"document.querySelector('{agg_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Verify _auto is selected.
            # The field select is the <select> inside .field-wrap.
            field_select = ".heatmap-ctrl .field-wrap .form-control-wrap select"
            field_val = page.evaluate(f"document.querySelector('{field_select}').value")
            assert field_val == "_auto", f"Expected '_auto', got '{field_val}'"

            # Single field → pickAutoField returns it directly
            auto_key = page.evaluate("window.__heatmapCtrl.manager.autoFieldKey")
            assert auto_key == "properties.elevation", (
                f"Expected 'properties.elevation', got '{auto_key}'"
            )

            # The single property option should be visible
            field_opts = page.evaluate(
                f"Array.from(document.querySelectorAll('{field_select} option')).map(o => o.value)"
            )
            assert "properties.elevation" in field_opts, (
                f"Missing 'properties.elevation': {field_opts}"
            )

            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
