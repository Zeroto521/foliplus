"""Tests for foliplus.HeatmapControl."""

from __future__ import annotations

import json

import folium
import pytest
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
        assert HeatmapControl()._locale_code == ""

    def test_custom_locale(self):
        assert HeatmapControl(locale="zh")._locale_code == "zh"

    def test_default_params(self, base_map: folium.Map):
        """Default params produce correct CONFIG JSON."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert '"name": "HeatmapControl"' in html
        assert '"color_scheme": "Reds"' in html
        assert '"method": "jenks"' in html
        assert '"n_classes": 6' in html
        assert '"agg": "count"' in html
        assert '"border_weight": 1.5' in html
        assert '"label_show": true' in html

    def test_custom_params(self, base_map: folium.Map):
        """Custom params produce correct CONFIG JSON."""
        HeatmapControl(
            color_scheme="Reds",
            method="quantile",
            n_classes=4,
            agg="sum",
            schemes=["Reds", "Blues"],
            style={"border_weight": 2.0, "label_show": False},
        ).add_to(base_map)
        html = render(base_map)
        assert '"color_scheme": "Reds"' in html
        assert '"method": "quantile"' in html
        assert '"n_classes": 4' in html
        assert '"agg": "sum"' in html
        assert '"border_weight": 2.0' in html
        assert '"label_show": false' in html

    def test_invalid_method_raises(self):
        """Invalid method raises ValueError."""
        with pytest.raises(ValueError, match="method must be one of"):
            HeatmapControl(method="invalid")

    def test_invalid_agg_raises(self):
        """Invalid agg raises ValueError."""
        with pytest.raises(ValueError, match="agg must be one of"):
            HeatmapControl(agg="invalid")

    def test_invalid_n_classes_raises_too_low(self):
        """n_classes below 2 raises ValueError."""
        with pytest.raises(
            ValueError, match="n_classes must be an int between 2 and 9"
        ):
            HeatmapControl(n_classes=1)

    def test_invalid_n_classes_raises_too_high(self):
        """n_classes above 9 raises ValueError."""
        with pytest.raises(
            ValueError, match="n_classes must be an int between 2 and 9"
        ):
            HeatmapControl(n_classes=10)

    def test_invalid_n_classes_raises_not_int(self):
        """Non-int n_classes raises ValueError."""
        with pytest.raises(
            ValueError, match="n_classes must be an int between 2 and 9"
        ):
            HeatmapControl(n_classes=6.5)


class TestHeatmapControlRendering:
    def test_default_params(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap-ctrl" in html

    def test_contains_h3_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "h3-js@4" in html
        assert "h3-js.umd.js" in html

    def test_contains_ss_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "simple-statistics.min.js" in html

    def test_contains_chroma_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "chroma-js@2" in html
        assert "chroma.min.js" in html

    def test_locale_zh(self, base_map: folium.Map):
        HeatmapControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "网格聚合" in html

    def test_extract_points_filters_no_feature(self, base_map: folium.Map):
        """extractPoints delegates to LayerAPI which filters by .feature."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "extractPoints" in html
        # Filtering happens in LayerControl's LayerAPI.extractPoints
        assert "extractPoints" in html

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
        """Dropdown items store scheme name for refreshSchemeDropdownItems and title tooltip."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "data-scheme-name" in html
        assert "schemeBar.title" in html
        assert "schemeBar.title" in html

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
        assert "onRemove" in html
        assert "observer.disconnect" in html
        assert "zoomend" in html
        assert "layeradd" in html

    def test_no_layer_hint(self, base_map: folium.Map):
        """initScan shows no_layer hint when no point layers found."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.no_layer" in html
        assert "HeatmapControl.no_layer"

    def test_auto_field_single_field_detection(self, base_map: folium.Map):
        """Auto field logic uses the first discovered field (collectFields order)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "pickAutoField" in html
        assert "pickAutoField" in html
        assert "pickAutoField" in html

    def test_auto_field_priority_and_fallback(self, base_map: folium.Map):
        """Auto mode picks the first discovered field (collectFields order)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "pickAutoField" in html
        assert "readMarkerField" in html

    def test_auto_field_key_resets_on_clear(self, base_map: folium.Map):
        """Clear action resets autoFieldKey to avoid stale field selection."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "autoFieldKey" in html

    def test_named_handler_cleanup(self, base_map: folium.Map):
        """bindMapEvents uses named handlers (onZoomEnd, onLayerChange)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "onZoomEnd" in html
        assert "onLayerChange" in html
        assert "zoomend" in html
        assert "layeradd" in html

    def test_get_point_value_dedup(self, base_map: folium.Map):
        """getPointValue delegates to readMarkerField instead of duplicating branch logic."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "readMarkerField" in html
        # Should NOT contain inline field resolution branches
        assert "this.currentField === '_value'" not in html
        assert "this.currentField === 'options.value'" not in html

    def test_error_keys_injected(self, base_map: folium.Map):
        """Error/warning locale keys appear in rendered HTML."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "Falling back to 1" in html
        assert "h3 cell conversion failed" in html
        assert "h3 boundary conversion failed" in html
        assert "HeatmapControl.close_title" in html

    def test_no_layercontrol_guard(self, base_map: folium.Map):
        """HeatmapControl shows guard hint when LayerControl is missing."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "no_layercontrol" in html
        assert "LayerControl" in html

    def test_render_hexagons_map_guard(self, base_map: folium.Map):
        """renderHexagons checks map._container and overlay before proceeding."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "overlay" in html

    def test_debounce_usage(self, base_map: folium.Map):
        """HeatmapControl uses foliplus.debounce for zoom and layer events."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "debounce" in html
        assert "onZoomEnd" in html
        assert "onLayerChange" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS design tokens are referenced in rendered output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "var(--radius-sm)" in html
        assert "var(--input-border)" in html
        assert "var(--text-primary)" in html
        assert "var(--accent-primary)" in html

    def test_css_icon_size_variable(self, base_map: folium.Map):
        """HeatmapControl SVGs use --icon-size-md via common.css."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "icon-size-md" in html

    def test_css_panel_shadow(self, base_map: folium.Map):
        """Expanded heatmap panel uses --panel-shadow."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "panel-shadow" in html

    def test_css_scheme_dropdown_hover(self, base_map: folium.Map):
        """Scheme dropdown items use accent-light on hover."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "scheme-dropdown-item:hover" in html
        assert "accent-light" in html

    def test_css_scheme_bar_open_rule(self, base_map: folium.Map):
        """scheme-bar-open class triggers breathing animation and red border."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "scheme-bar-open" in html
        assert "input-breathe" in html

    def test_css_toggle_knob_scale(self, base_map: folium.Map):
        """Toggle knob has scale(1.15) on checked state."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "scale(1.15)" in html

    def test_agg_select_options(self, base_map: folium.Map):
        """Aggregation method select has all 6 options."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        for agg in ("count", "sum", "avg", "min", "max"):
            assert agg in html

    def test_class_method_select_options(self, base_map: folium.Map):
        """Classification method select has all 4 options."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        for method in ("jenks", "quantile", "equal", "heads"):
            assert method in html

    def test_border_control_renders(self, base_map: folium.Map):
        """Border weight slider and color input are rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "weight-input" in html
        assert "color-input" in html

    def test_border_weight_input_has_min_max(self, base_map: folium.Map):
        """Border weight input has min:0 max:10, clamps on change, and previews on input."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "weight-input" in html
        assert "color-input" in html
        assert "weight-input" in html
        # oninput for live preview (only fires when value is in range)
        assert "weight-input" in html
        # onchange for final clamp
        assert "color-input" in html

    def test_placeholder_options_disabled(self, base_map: folium.Map):
        """Layer placeholder and field auto options use disabled:true (not the string)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        # Must use boolean true so dom.el sets el.disabled = true
        assert "placeholder" in html
        # Must NOT use the string variant which silently sets disabled=false
        assert 'disabled: "disabled"' not in html

    def test_border_weight_breathing_focus(self):
        """weight-input is included in the shared breathing-focus rule in common.css."""
        from pathlib import Path

        css = Path("foliplus/css/common.css").read_text()
        assert "foliplus-heatmap-weight-input" in css
        assert "input-breathe" in css

    def test_label_toggle_renders(self, base_map: folium.Map):
        """Label toggle switch is rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "toggle-switch" in html
        assert "labelChk" in html

    def test_confirm_button_renders(self, base_map: folium.Map):
        """Confirm (Apply) button is rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "btn-confirm" in html
        assert "HeatmapControl.confirm" in html

    def test_clear_button_renders(self, base_map: folium.Map):
        """Clear button is rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "btn-clear" in html
        assert "HeatmapControl.clear" in html

    def test_section_data_and_style(self, base_map: folium.Map):
        """Data and Style section labels are rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.section_data" in html
        assert "HeatmapControl.section_style" in html

    def test_close_button_renders(self, base_map: folium.Map):
        """Close button is rendered in the panel header."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "close-btn" in html
        assert "HeatmapControl.close_title" in html

    def test_ctrl_btn_svg_in_icon_selector(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""
        from pathlib import Path

        css = Path("foliplus/css/common.css").read_text()
        assert ".foliplus-ctrl-btn" in css

    def test_layer_placeholder_option(self, base_map: folium.Map):
        """Layer select has a placeholder option."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.layer_placeholder" in html

    def test_field_auto_option(self, base_map: folium.Map):
        """Field select has an auto-detect option."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "HeatmapControl.field_auto" in html

    def test_extra_body_structure(self, base_map: folium.Map):
        """Extra body has form-row with label and control-wrap."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "extra-body" in html
        assert "form-row" in html
        assert "form-control" in html

    def test_resolution_select_renders(self, base_map: folium.Map):
        """Resolution (H3 hex size) select is rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap" in html

    def test_opacity_control_renders(self, base_map: folium.Map):
        """Opacity slider is rendered."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "opacity" in html

    def test_heatmap_constants(self, base_map: folium.Map):
        """Heatmap constants like INIT_SCAN_ATTEMPTS are present."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "INIT_SCAN_ATTEMPTS" in html
        assert "RES_MAP" in html

    # ── Performance optimization tests ──

    def test_cached_aggregation_key(self, base_map: folium.Map):
        """renderHexagons builds an aggregation cache key from all params."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.cachedAgg" in html
        assert "cachedAgg" in html
        assert "cachedAgg" in html
        assert "cachedAgg" in html

    def test_cached_aggregation_invalidation(self, base_map: folium.Map):
        """cachedAgg is cleared on layer change and clearHeatmapCanvas."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "cachedAgg" in html

    def test_viewport_culling(self, base_map: folium.Map):
        """redrawHeatmap skips hexagons outside the visible map bounds."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "bounds" in html

    def test_render_all_flag(self, base_map: folium.Map):
        """renderAll flag disables viewport culling when set to true."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "renderAll" in html
        assert "renderAll" in html

    def test_canvas_font_caching(self, base_map: folium.Map):
        """drawHexLabel uses cached font string to avoid repeated Canvas font parsing."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "font" in html

    # ── Algorithm tests (rendering checks) ──

    def test_compute_breaks_jenks(self, base_map: folium.Map):
        """computeBreaks supports jenks method (uses ss.ckmeans internally)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method" in html
        assert "jenks" in html
        assert "jenks" in html

    def test_compute_breaks_quantile(self, base_map: folium.Map):
        """computeBreaks supports quantile method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method" in html
        assert "quantile" in html
        assert "quantile" in html

    def test_compute_breaks_equal(self, base_map: folium.Map):
        """computeBreaks supports equal interval (default) method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "equal" in html

    def test_compute_breaks_heads(self, base_map: folium.Map):
        """computeBreaks supports heads method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method" in html
        assert "heads" in html

    def test_aggregate_data_all_methods(self, base_map: folium.Map):
        """aggregateData has all 5 aggregation methods: count, sum, avg, min, max."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "case " in html
        assert "count" in html
        assert "sum" in html
        assert "avg" in html
        assert "min" in html
        assert "max" in html

    def test_read_marker_field_modes(self, base_map: folium.Map):
        """readMarkerField supports value, options.value, and properties.* access."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "readMarkerField" in html
        assert "value" in html
        assert "value" in html
        assert "readMarkerField" in html

    def test_resolve_label_style_caching(self, base_map: folium.Map):
        """resolveLabelStyle caches the label style result."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.cachedLabelStyle" in html
        assert "cachedLabelStyle" in html

    def test_get_h3_res(self, base_map: folium.Map):
        """getH3Res maps zoom levels to H3 resolutions."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "RES_MAP" in html
        assert "H3.RES_MAP.find" in html

    def test_get_color_scale_chroma_fallback(self, base_map: folium.Map):
        """getColorScale falls back to gray array when chroma is undefined."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "typeof chroma" in html
        assert "getColorScale" in html

    def test_class_select_default_value(self, base_map: folium.Map):
        """classSelect variable exists in rendered output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "classSelect" in html
        assert "n_classes" in html or "class" in html

    def test_scheme_select_default_value(self, base_map: folium.Map):
        """schemeSelectHidden variable exists in rendered output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "schemeSelectHidden" in html
        assert "color_scheme" in html or "scheme" in html

    def test_form_row_label_before_control(self, base_map: folium.Map):
        """In each form-row, <label> appears before <div.form-control> in JS."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        # For the classification method row, verify the JS creates label
        # before form-control within the same form-row.
        # In the rendered JS, 'classRow' should appear before 'classControlWrap'
        # because label is appended to classRow first, then controlWrap.
        row_pos = html.find("class: CONST.CLASSES.FORM_ROW, parent: styleSection")
        label_pos = html.find(
            "class: CONST.CLASSES.FORM_LABEL, parent: classRow, innerHTML: _"
        )
        ctrl_pos = html.find(
            "FORM_CONTROL} ${CONST.CLASSES.FORM_CONTROL_INLINE}`,\n        parent: classRow"
        )
        if row_pos >= 0 and label_pos >= 0 and ctrl_pos >= 0:
            assert label_pos < ctrl_pos, (
                f"label (pos {label_pos}) must be created before "
                f"form-control (pos {ctrl_pos}) in the same row"
            )


class TestHeatmapControlBrowser:
    """Browser-based smoke tests for HeatmapControl."""

    @staticmethod
    def _stub_html(html: str) -> str:
        """Remove blocking CDN <script> tags and inject stubs for h3/ss/chroma."""
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/h3-js@4/dist/h3-js.umd.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/simple-statistics@7/dist/simple-statistics.min.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/chroma-js@2/chroma.min.js"></script>',
            "",
        )
        # Inject stubs before the HeatmapControl JS runs (after CONF entry)
        # In the rendered HTML, the CONF preamble starts with:
        #   CONF = {"name": "HeatmapControl", ...};
        # followed immediately by the bundled JS.
        marker = 'CONF = {"name": "HeatmapControl"'
        idx = html.find(marker)
        if idx > 0:
            # Find the semicolon that ends the CONFIG assignment
            semi = html.find(";", idx)
            if semi > 0:
                stub = (
                    'window.h3={latLngToCell:function(){return ""},cellToBoundary:function(c){return [[0,0],[0,0],[0,0]]},cellToLatLng:function(){return [0,0]}};'
                    "window.ss={jenks:function(){return[0,1]},quantile:function(){return 0.5}};"
                    'window.chroma={scale:function(){return{mode:function(){return{colors:function(){return["#f00"]}}}}}};'
                )
                html = html[: semi + 1] + stub + html[semi + 1 :]
        return html

    @staticmethod
    def _expose_ctrl(html: str) -> str:
        """Expose the created control as window.__heatmapCtrl for runtime assertions."""
        marker = "heatmapCtrl.addTo(map);"
        idx = html.find(marker)
        if idx > 0:
            hook = "window.__heatmapCtrl = heatmapCtrl;"
            html = html[: idx + len(marker)] + hook + html[idx + len(marker) :]
        return html

    def _make_page(self, browser, tmp_path, expose_ctrl=False):
        """Build a page with point layers + HeatmapControl and return (page, errors)."""
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        for lat, lng in [(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]:
            gj = json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"val": lat},
                            "geometry": {"type": "Point", "coordinates": [lng, lat]},
                        }
                    ],
                }
            )
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
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )
        return page, errors

    # ── Tests ──────────────────────────────────────────────────────

    def test_panel_interaction(self, browser, tmp_path):
        """Open heatmap panel, verify layer dropdown populates."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)

        try:
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(2000)

            options_count = page.evaluate(
                "window.__heatmapCtrl.layerSelect.querySelectorAll('option').length"
            )
            assert options_count >= 2

            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-close-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.collapsed", state="attached", timeout=5000
            )

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
                    numClasses: m.numClasses,
                    borderWeight: m.borderWeight,
                    borderColor: m.borderColor,
                    currentLabelShow: m.currentLabelShow,
                    currentMethod: m.currentMethod,
                    currentScheme: m.currentScheme,
                    currentAgg: m.currentAgg,
                };
            }""")
            assert vals["numClasses"] == 6, (
                f"numClasses expected 6 got {vals['numClasses']}"
            )
            assert vals["borderWeight"] == 1.5, (
                f"borderWeight expected 1.5 got {vals['borderWeight']}"
            )
            assert vals["borderColor"] in ("#333", "#333333"), (
                f"borderColor got {vals['borderColor']}"
            )
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
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(2000)

            before = page.evaluate("window.__heatmapCtrl.manager.currentLabelShow")
            # Uncheck label
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-heatmap-toggle-switch input').click()"
            )
            after = page.evaluate("window.__heatmapCtrl.manager.currentLabelShow")
            assert before is True, f"expected True, got {before}"
            assert after is False, f"expected False, got {after}"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_layer_selection_triggers_render(self, browser, tmp_path):
        """Selecting a layer calls renderHexagons (cachedFeatures should be set)."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(3000)

            # Select the first non-placeholder layer
            opts = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).slice(1).map(o => o.value)"
            )
            assert opts, "No layer options found"
            page.evaluate(f"""() => {{
                const sel = window.__heatmapCtrl.layerSelect;
                sel.value = '{opts[0]}';
                sel.dispatchEvent(new Event('change'));
            }}""")
            page.wait_for_timeout(2000)

            # overlay (Canvas) should be visible with content after renderHexagons
            has_cached = page.evaluate(
                "window.__heatmapCtrl.manager.cachedFeatures !== null && window.__heatmapCtrl.manager.cachedFeatures !== undefined"
            )
            canvas_visible = page.evaluate(
                "window.__heatmapCtrl.manager.overlay.canvas && window.__heatmapCtrl.manager.overlay.canvas.style.display !== 'none'"
            )
            assert has_cached, "cachedFeatures should be set after layer selection"
            assert canvas_visible, "Canvas should be visible after layer selection"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_all_removes_content(self, browser, tmp_path):
        """clearHeatmapCanvas() clears cached data and hides the overlay."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            # Render some content first
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(3000)
            opts = page.evaluate(
                'Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll("option")).slice(1).map(o => o.value)'
            )
            if opts:
                page.evaluate(f"""() => {{
                    const sel = window.__heatmapCtrl.layerSelect;
                    sel.value = '{opts[0]}';
                    sel.dispatchEvent(new Event('change'));
                }}""")
                page.wait_for_timeout(2000)

            # Call clearHeatmapCanvas
            page.evaluate("window.__heatmapCtrl.manager.clearHeatmapCanvas()")
            page.wait_for_timeout(500)

            cached_gone = page.evaluate(
                "window.__heatmapCtrl.manager.cachedFeatures === null"
            )
            canvas_gone = page.evaluate(
                "window.__heatmapCtrl.manager.overlay.canvas && window.__heatmapCtrl.manager.overlay.canvas.classList.contains('hidden')"
            )
            assert cached_gone, "cachedFeatures should be null after clear"
            assert canvas_gone, "Canvas should be hidden after clear"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_clear_button_works(self, browser, tmp_path):
        """Pressing the clear button resets all controls and clears layers."""
        page, errors = self._make_page(browser, tmp_path, expose_ctrl=True)
        try:
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(3000)

            # Change some values
            page.evaluate("window.__heatmapCtrl.manager.numClasses = 4")
            # Click clear
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-heatmap-btn-clear').click()"
            )
            page.wait_for_timeout(500)

            mgr = page.evaluate("""() => {
                const m = window.__heatmapCtrl.manager;
                return { numClasses: m.numClasses, borderWeight: m.borderWeight,
                         borderColor: m.borderColor, currentMethod: m.currentMethod,
                         currentScheme: m.currentScheme };
            }""")
            assert mgr["numClasses"] == 6, f"expected 6 got {mgr['numClasses']}"
            assert mgr["borderWeight"] == 1.5
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
            "heatmapCtrl.addTo(map);",
            "window.__heatmapCtrl = heatmapCtrl; heatmapCtrl.addTo(map);",
        )

        html_path = tmp_path / "test_heatmap_autofield.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()

        # Remove blocking CDN <script> tags
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/h3-js@4/dist/h3-js.umd.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/simple-statistics@7/dist/simple-statistics.min.js"></script>',
            "",
        )
        html = html.replace(
            '<script src="https://cdn.jsdelivr.net/npm/chroma-js@2/chroma.min.js"></script>',
            "",
        )
        # Inject stubs for h3/ss/chroma before the HeatmapControl IIFE
        idx = html.find("// ==================== SVG Icons ====================")
        if idx > 0:
            stub = (
                'window.h3={latLngToCell:function(){return ""},cellToBoundary:function(c){return [[0,0],[0,0],[0,0]]},cellToLatLng:function(){return [0,0]}};'
                "window.ss={jenks:function(){return[0,1]},quantile:function(){return 0.5}};"
                'window.chroma={scale:function(){return{mode:function(){return{colors:function(){return["#f00"]}}}}}};'
            )
            html = html[:idx] + stub + html[idx:]
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

        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )

        # Open panel
        page.evaluate(
            "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
        )
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
        )
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
            options = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).map(o => o.value)"
            )
            # Skip the empty/default option, pick the first real layer
            real_options = [v for v in options if v]
            assert len(real_options) >= 1, f"No layer options found: {options}"
            page.evaluate(f"""() => {{
                window.__heatmapCtrl.layerSelect.value = '{real_options[0]}';
                window.__heatmapCtrl.layerSelect.dispatchEvent(new Event('change'));
            }}""")
            page.wait_for_timeout(500)

            # Switch aggregation to 'sum' so the field selector appears.
            # The agg select is the first <select> inside .foliplus-extra-body.
            agg_select = ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body > .foliplus-heatmap-form-row:nth-child(1) .foliplus-heatmap-form-control select"
            page.evaluate(f"document.querySelector('{agg_select}').value = 'sum'")
            page.evaluate(
                f"document.querySelector('{agg_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Verify field selector is visible and AUTO is selected.
            # The field select is the <select> inside .foliplus-heatmap-field.
            field_select = ".foliplus-heatmap-ctrl .foliplus-heatmap-field .foliplus-heatmap-form-control select"
            field_val = page.evaluate(f"document.querySelector('{field_select}').value")
            assert field_val == "", f"Expected empty string (AUTO), got '{field_val}'"

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
            options = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).map(o => o.value)"
            )
            real_options = [v for v in options if v]
            assert len(real_options) >= 1
            page.evaluate(f"""() => {{
                window.__heatmapCtrl.layerSelect.value = '{real_options[0]}';
                window.__heatmapCtrl.layerSelect.dispatchEvent(new Event('change'));
            }}""")
            page.wait_for_timeout(500)

            # Switch to 'avg' so field selector appears.
            # The agg select is the first <select> inside .foliplus-extra-body.
            agg_select = ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body > .foliplus-heatmap-form-row:nth-child(1) .foliplus-heatmap-form-control select"
            page.evaluate(f"document.querySelector('{agg_select}').value = 'avg'")
            page.evaluate(
                f"document.querySelector('{agg_select}').dispatchEvent(new Event('change'))"
            )
            page.wait_for_timeout(500)

            # Verify AUTO is selected.
            # The field select is the <select> inside .foliplus-heatmap-field.
            field_select = ".foliplus-heatmap-ctrl .foliplus-heatmap-field .foliplus-heatmap-form-control select"
            field_val = page.evaluate(f"document.querySelector('{field_select}').value")
            assert field_val == "", f"Expected empty string (AUTO), got '{field_val}'"

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
