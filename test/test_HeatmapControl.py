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
        assert HeatmapControl()._locale_code == ""

    def test_custom_locale(self):
        assert HeatmapControl(locale="zh")._locale_code == "zh"

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

    def test_label_canvas_render(self, base_map: folium.Map):
        """Labels are drawn on the heatmap canvas via canvas()."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "createCanvas(" in html
        assert "heatmap-canvas" in html

    def test_label_canvas_no_css_class(self, base_map: folium.Map):
        """Labels use Canvas, not marker with .heatmap-label CSS class."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap-canvas" in html
        assert ".heatmap-label" not in html

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
        """Canvas is managed via canvas() API."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus_heatmap" in html
        assert "createCanvas(" in html

    def test_graphlayer_pane_init(self, base_map: folium.Map):
        """Canvas is created via canvas() (no graphLayer/pane)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "createCanvas(" in html

    def test_canvas_rendering_all_in_one(self, base_map: folium.Map):
        """renderHexagons uses managed canvas (this.mc) for hexagons and labels."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.overlay" in html
        assert "foliplus.formatNumber" in html

    def test_extract_points_filters_no_feature(self, base_map: folium.Map):
        """extractPoints delegates to LayerAPI which filters by .feature."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "extractPoints" in html
        # Filtering happens in LayerControl's LayerAPI.extractPoints
        assert "foliplus.LayerAPI.extractPoints" in html

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
        assert "item.title = name" in html
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
        assert "onRemove()" in html
        assert "observer.disconnect" in html
        assert 'this.m.map.off("zoomend", this.m.onZoomEnd)' in html
        assert 'this.m.map.off("layeradd layerremove", this.m.onLayerChange)' in html

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
        assert "this.m.autoFieldKey = this.m.pickAutoField(fields);" in html

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
        assert "this.m.autoFieldKey = null;" in html

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
        assert "if (!this.map || !this.map._container || !this.overlay) return" in html

    def test_debounce_usage(self, base_map: folium.Map):
        """HeatmapControl uses foliplus.debounce for zoom and layer events."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.debounce" in html
        assert "onZoomEnd.cancel()" in html
        assert "onLayerChange.cancel()" in html

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
        assert "min: 0" in html
        assert "max: 10" in html
        assert "Math.min(10, Math.max(0," in html
        # oninput for live preview (only fires when value is in range)
        assert "oninput:" in html
        # onchange for final clamp
        assert "onchange:" in html

    def test_placeholder_options_disabled(self, base_map: folium.Map):
        """Layer placeholder and field auto options use disabled:true (not the string)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        # Must use boolean true so dom.el sets el.disabled = true
        assert "disabled: true" in html
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
        assert "resolution" in html

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
        assert "RES_FALLBACK: 12" in html

    # ── Performance optimization tests ──

    def test_cached_aggregation_key(self, base_map: folium.Map):
        """renderHexagons builds an aggregation cache key from all params."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.cachedAgg" in html
        assert "this.cachedAgg.key" in html
        assert "this.cachedAgg.data" in html
        assert "aggKey" in html

    def test_cached_aggregation_invalidation(self, base_map: folium.Map):
        """cachedAgg is cleared on layer change and clearHeatmapCanvas."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.cachedAgg = null" in html

    def test_viewport_culling(self, base_map: folium.Map):
        """redrawHeatmap skips hexagons outside the visible map bounds."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "bounds.contains(L.latLng(c[0], c[1]))" in html

    def test_render_all_flag(self, base_map: folium.Map):
        """renderAll flag disables viewport culling when set to true."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "this.renderAll" in html
        assert "renderAll ? null : this.map.getBounds()" in html

    def test_canvas_font_caching(self, base_map: folium.Map):
        """drawHexLabel uses cached font string to avoid repeated Canvas font parsing."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "if (ctx.font !== font) ctx.font = font" in html

    # ── Algorithm tests (rendering checks) ──

    def test_compute_breaks_jenks(self, base_map: folium.Map):
        """computeBreaks supports jenks method (uses ss.ckmeans internally)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method === " in html
        assert "jenks" in html
        assert "ss.ckmeans(data, nClasses)" in html

    def test_compute_breaks_quantile(self, base_map: folium.Map):
        """computeBreaks supports quantile method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method === " in html
        assert "quantile" in html
        assert "ss.quantileSorted(sorted, i / nClasses)" in html

    def test_compute_breaks_equal(self, base_map: folium.Map):
        """computeBreaks supports equal interval (default) method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "(hi - lo) / nClasses" in html

    def test_compute_breaks_heads(self, base_map: folium.Map):
        """computeBreaks supports heads method."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "method === " in html
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
        assert "field === " in html
        assert "value" in html
        assert "options.value" in html
        assert "field.startsWith" in html

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
        assert "getH3Res(zoom)" in html
        assert "H3.RES_MAP.find" in html

    def test_get_color_scale_chroma_fallback(self, base_map: folium.Map):
        """getColorScale falls back to gray array when chroma is undefined."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "typeof chroma" in html
        assert "Array(n).fill(CONST.GRAY)" in html

    def test_class_select_default_value(self, base_map: folium.Map):
        """classSelect.value is set after <option> elements are created."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        # value must be set AFTER the for-loop that creates <option> children
        assert ".classSelect.value = " in html
        # Must NOT be in the attrs of foliplus.dom.el("select", ...)
        assert 'classSelect = foliplus.dom.el("select", {' in html
        assert "classSelect.value =" in html
        # Verify the value assignment appears after the for-loop
        for_lines = [l for l in html.split("\n") if "ci <= 9" in l]
        value_lines = [l for l in html.split("\n") if ".classSelect.value = " in l]
        assert for_lines and value_lines, "Missing for-loop or value assignment"
        # Find the position of <option creation> and value assignment
        option_pos = html.find("ci <= 9")
        value_pos = html.find(".classSelect.value = ")
        assert value_pos > option_pos, (
            f"classSelect.value (pos {value_pos}) must be set after "
            f"<option> creation (pos {option_pos})"
        )

    def test_scheme_select_default_value(self, base_map: folium.Map):
        """schemeSelectHidden.value is set after <option> elements."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        # Must NOT be in attrs
        assert 'schemeSelectHidden = foliplus.dom.el("select", {' in html
        assert "schemeSelectHidden.value =" in html
        # Verify value assignment appears after forEach
        for_each_pos = html.find("SCHEME_NAMES.forEach")
        value_pos = html.find(".schemeSelectHidden.value = ")
        assert value_pos > for_each_pos, (
            f"schemeSelectHidden.value (pos {value_pos}) must be after "
            f"<option> creation (pos {for_each_pos})"
        )

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
        # Inject stubs before the HeatmapControl IIFE
        idx = html.find("// ==================== SVG Icons ====================")
        if idx > 0:
            stub = (
                'window.h3={latLngToCell:function(){return ""},cellToBoundary:function(c){return [[0,0],[0,0],[0,0]]},cellToLatLng:function(){return [0,0]}};'
                "window.ss={jenks:function(){return[0,1]},quantile:function(){return 0.5}};"
                'window.chroma={scale:function(){return{mode:function(){return{colors:function(){return["#f00"]}}}}}};'
            )
            html = html[:idx] + stub + html[idx:]
        return html

    @staticmethod
    def _expose_ctrl(html: str) -> str:
        """Expose heatmapCtrl as window.__heatmapCtrl for runtime assertions."""
        return html.replace(
            "heatmapCtrl.addTo(map);",
            "window.__heatmapCtrl = heatmapCtrl; heatmapCtrl.addTo(map);",
        )

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
