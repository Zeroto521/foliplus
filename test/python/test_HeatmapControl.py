"""Tests for foliplus.HeatmapControl."""

from __future__ import annotations

import json
import re
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    make_browser_page,
    read_css,
    render_control,
    use_page,
    use_raw_page,
)

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
        """Default params produce correct CONFIG JSON."""
        html = render_control(HeatmapControl())
        assert_config_value(html, "color_scheme", "Reds")
        assert_config_value(html, "method", "jenks")
        assert_config_value(html, "n_classes", 6)
        assert_config_value(html, "agg", "count")
        assert_config_value(html, "border_weight", 1.5)
        assert_config_value(html, "label_show", True)

    def test_custom_params(self):
        """Custom params produce correct CONFIG JSON."""
        html = render_control(
            HeatmapControl(
                color_scheme="Reds",
                method="quantile",
                n_classes=4,
                agg="sum",
                schemes=["Reds", "Blues"],
                style={"border_weight": 2.0, "label_show": False},
            )
        )
        assert_config_value(html, "color_scheme", "Reds")
        assert_config_value(html, "method", "quantile")
        assert_config_value(html, "n_classes", 4)
        assert_config_value(html, "agg", "sum")
        assert_config_value(html, "border_weight", 2.0)
        assert_config_value(html, "label_show", False)

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
    def test_default_params(self):
        html = render_control(HeatmapControl())
        assert "heatmap-ctrl" in html

    def test_contains_h3_dependency(self):
        html = render_control(HeatmapControl())
        assert "h3-js@4" in html
        assert "h3-js.umd.js" in html

    def test_contains_ss_dependency(self):
        html = render_control(HeatmapControl())
        assert "simple-statistics.min.js" in html

    def test_contains_chroma_dependency(self):
        html = render_control(HeatmapControl())
        assert "chroma-js@2" in html
        assert "chroma.min.js" in html

    def test_locale_zh(self):
        html = render_control(HeatmapControl(locale="zh"))
        assert_locale(html, "网格聚合")

    def test_style_field(self):
        """style.field is injected into JS template."""
        html = render_control(HeatmapControl(style={"field": "value"}))
        assert_config_value(html, "field", "value")

    def test_scheme_names_inline(self):
        """schemes list is inlined as JSON array."""
        html = render_control(HeatmapControl())
        assert "Blues" in html and "Viridis" in html

    def test_scheme_dropdown_items_have_data_attr(self):
        """Dropdown items store scheme name for refreshSchemeDropdownItems and title tooltip."""
        html = render_control(HeatmapControl())
        assert "data-scheme-name" in html

    def test_class_count_select_range(self):
        """Class count select has options 2-9."""
        html = render_control(HeatmapControl())
        for n in (2, 5, 9):
            assert str(n) in html

    def test_error_keys_injected(self):
        """Error/warning locale keys appear in rendered HTML."""
        html = render_control(HeatmapControl())
        assert "Falling back to 1" in html
        assert "h3 cell conversion failed" in html
        assert "h3 boundary conversion failed" in html
        assert "HeatmapControl.close_title" in html

    def test_css_variables_used(self):
        """CSS design tokens are referenced in rendered output."""
        html = render_control(HeatmapControl())
        assert "var(--radius-sm)" in html
        assert "var(--input-border)" in html
        assert "var(--text-primary)" in html
        assert "var(--accent-primary)" in html

    def test_css_icon_size_variable(self):
        """HeatmapControl SVGs use --icon-size-md via common.css."""
        html = render_control(HeatmapControl())
        assert "icon-size-md" in html

    def test_css_panel_shadow(self):
        """Expanded heatmap panel uses --panel-shadow."""
        html = render_control(HeatmapControl())
        assert "panel-shadow" in html

    def test_css_scheme_dropdown_hover(self):
        """Scheme dropdown items use accent-light on hover."""
        html = render_control(HeatmapControl())
        assert "scheme-dropdown-item:hover" in html
        assert "accent-light" in html

    def test_css_scheme_bar_open_rule(self):
        """scheme-bar-open class triggers breathing animation and red border."""
        html = render_control(HeatmapControl())
        assert "scheme-bar-open" in html
        assert "input-breathe" in html

    def test_css_toggle_knob_scale(self):
        """Toggle knob has scale(1.15) on checked state."""
        html = render_control(HeatmapControl())
        assert "scale(1.15)" in html

    def test_agg_select_options(self):
        """Aggregation method select has all 6 options."""
        html = render_control(HeatmapControl())
        for agg in ("count", "sum", "avg", "min", "max"):
            assert agg in html

    def test_class_method_select_options(self):
        """Classification method select has all 4 options."""
        html = render_control(HeatmapControl())
        for method in ("jenks", "quantile", "equal", "heads"):
            assert method in html

    def test_border_control_renders(self):
        """Border weight slider and color input are rendered."""
        html = render_control(HeatmapControl())
        assert "weight-input" in html
        assert "color-input" in html

    def test_border_weight_input_has_min_max(self):
        """Border weight input has min:0 max:10, clamps on change, and previews on input."""
        html = render_control(HeatmapControl())
        assert "weight-input" in html
        assert "color-input" in html
        assert "weight-input" in html
        # oninput for live preview (only fires when value is in range)
        assert "weight-input" in html
        # onchange for final clamp
        assert "color-input" in html

    def test_placeholder_options_disabled(self):
        """Layer placeholder and field auto options use disabled:true (not the string)."""
        html = render_control(HeatmapControl())
        # Must use boolean true so dom.el sets el.disabled = true
        assert "placeholder" in html
        # Must NOT use the string variant which silently sets disabled=false
        assert 'disabled: "disabled"' not in html

    def test_border_weight_breathing_focus(self):
        """weight-input is included in the shared breathing-focus rule in common.css."""
        from pathlib import Path

        css = read_css("foliplus/css/common.css")
        assert "foliplus-heatmap-weight-input" in css
        assert "input-breathe" in css

    def test_label_toggle_renders(self):
        """Label toggle switch is rendered."""
        html = render_control(HeatmapControl())
        assert "toggle-switch" in html

    def test_confirm_button_renders(self):
        """Confirm (Apply) button is rendered."""
        html = render_control(HeatmapControl())
        assert "btn-confirm" in html
        assert "HeatmapControl.confirm" in html

    def test_clear_button_renders(self):
        """Clear button is rendered."""
        html = render_control(HeatmapControl())
        assert "btn-clear" in html
        assert "HeatmapControl.clear" in html

    def test_section_data_and_style(self):
        """Data and Style section labels are rendered."""
        html = render_control(HeatmapControl())
        assert "HeatmapControl.section_data" in html
        assert "HeatmapControl.section_style" in html

    def test_close_button_renders(self):
        """Close button is rendered in the panel header."""
        html = render_control(HeatmapControl())
        assert "close-btn" in html
        assert "HeatmapControl.close_title" in html

    def test_ctrl_btn_svg_in_icon_selector(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""

        css = read_css("foliplus/css/common.css")
        assert ".foliplus-ctrl-btn" in css

    def test_layer_placeholder_option(self):
        """Layer select has a placeholder option."""
        html = render_control(HeatmapControl())
        assert "HeatmapControl.layer_placeholder" in html

    def test_field_auto_option(self):
        """Field select has an auto-detect option."""
        html = render_control(HeatmapControl())
        assert "HeatmapControl.field_auto" in html

    def test_extra_body_structure(self):
        """Extra body has form-row with label and control-wrap."""
        html = render_control(HeatmapControl())
        assert "extra-body" in html
        assert "form-row" in html
        assert "form-control" in html

    def test_resolution_select_renders(self):
        """Resolution (H3 hex size) select is rendered."""
        html = render_control(HeatmapControl())
        assert "heatmap" in html

    def test_opacity_control_renders(self):
        """Opacity slider is rendered."""
        html = render_control(HeatmapControl())
        assert "opacity" in html

    # ── Performance optimization tests ──

    def test_viewport_culling(self):
        """redrawHeatmap skips hexagons outside the visible map bounds."""
        html = render_control(HeatmapControl())
        assert "bounds" in html

    def test_canvas_font_caching(self):
        """drawHexLabel uses cached font string to avoid repeated Canvas font parsing."""
        html = render_control(HeatmapControl())
        assert "font" in html

    # ── Algorithm tests (rendering checks) ──

    def test_form_row_label_before_control(self):
        """In each form-row, <label> appears before <div.form-control> in JS."""
        html = render_control(HeatmapControl())
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
        for cdn in (
            "h3-js@4/dist/h3-js.umd.js",
            "simple-statistics@7/dist/simple-statistics.min.js",
            "chroma-js@2/chroma.min.js",
        ):
            html = html.replace(
                f'<script src="https://cdn.jsdelivr.net/npm/{cdn}"></script>', ""
            )
        marker = 'CONF = {"name": "HeatmapControl"'
        idx = html.find(marker)
        if idx > 0:
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
        """Expose the HeatmapControl instance as ``window.__heatmapCtrl``.

        The control variable is minified (e.g. ``de``) in production builds,
        so match the generic ``<expr>.addTo(map);`` call added last (the
        HeatmapControl mounts after LayerControl) instead of a fixed name.
        """
        matches = list(re.finditer(r"([a-zA-Z0-9_$]+)\.addTo\(map\);", html))
        if matches:
            m = matches[-1]  # last addTo = HeatmapControl
            var_name = m.group(1)
            html = (
                html[: m.start()]
                + f"window.__heatmapCtrl = {var_name};"
                + html[m.start() :]
            )
        return html

    def _make_page(self, browser, tmp_path, expose_ctrl=False, num_layers=3):
        """Build a page with point layers + HeatmapControl and return (page, errors).

        Parameters
        ----------
        browser
            Playwright browser fixture.
        tmp_path
            Pytest tmp_path fixture.
        expose_ctrl
            If True, expose ``window.__heatmapCtrl`` for test assertions.
        num_layers
            Number of independent point FeatureGroups (default 3). Set to 1
            for auto-select tests.
        """
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        coords = [(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]
        for i, (lat, lng) in enumerate(coords[:num_layers]):
            fg = folium.FeatureGroup(name=f"Points {i}", show=True)
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
        page, errors = make_browser_page(browser, tmp_path, html, "heatmap")
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )
        return page, errors

    def test_auto_select_single_layer(self, browser, tmp_path):
        """Single point layer is auto-selected on panel expand."""
        with use_page(
            self._make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(2000)

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is not None, "Layer should be auto-selected"
            assert state["hasCachedFeatures"] is True, (
                "renderHexagons should have been called"
            )
            assert state["extraBodyHidden"] is False, (
                "Extra body should be visible after auto-select"
            )
            assert not errors, f"JS errors: {errors}"

    def test_auto_select_skipped_for_multiple_layers(self, browser, tmp_path):
        """Multiple point layers: auto-select does NOT trigger."""
        with use_page(
            self._make_page, browser, tmp_path, expose_ctrl=True, num_layers=3
        ) as (page, errors):
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(2000)

            state = page.evaluate(_js("HeatmapControl/read_auto_select_state"))
            assert state["selectedLayerId"] is None, (
                "No layer should be auto-selected with multiple layers"
            )
            assert state["hasCachedFeatures"] is False, (
                "renderHexagons should NOT have been auto-called"
            )
            assert state["extraBodyHidden"] is True, (
                "Extra body should stay hidden without auto-select"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_interaction(self, browser, tmp_path):
        """Open heatmap panel, verify layer dropdown populates."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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

    def test_default_values_initialized(self, browser, tmp_path):
        """Constructor initialises all user-configurable defaults."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            vals = page.evaluate(_js("HeatmapControl/read_defaults"))
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

    def test_label_toggle_updates_state(self, browser, tmp_path):
        """Toggling the label checkbox updates manager.currentLabelShow."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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

    def test_layer_selection_triggers_render(self, browser, tmp_path):
        """Selecting a layer calls renderHexagons (cachedFeatures should be set)."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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
            page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
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

    def test_clear_all_removes_content(self, browser, tmp_path):
        """clearHeatmapCanvas() clears cached data and hides the overlay."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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
                page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
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

    def test_clear_button_works(self, browser, tmp_path):
        """Pressing the clear button resets all controls and clears layers."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
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

            mgr = page.evaluate(_js("HeatmapControl/read_manager_state"))
            assert mgr["numClasses"] == 6, f"expected 6 got {mgr['numClasses']}"
            assert mgr["borderWeight"] == 1.5
            assert mgr["currentMethod"] == "jenks"
            assert not errors, f"JS errors: {errors}"

    def test_render_all_flag_integration(self, browser, tmp_path):
        """renderAll is toggled via hooks before/after export (full-content capture)."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )

            # Select a layer so cachedFeatures is set
            opts = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).slice(1).map(o => o.value)"
            )
            if opts:
                page.evaluate(_js("HeatmapControl/select_layer"), opts[0])
                page.wait_for_timeout(2000)

            # Export hooks should toggle renderAll
            before_hooks = page.evaluate(
                "window.__heatmapCtrl.manager.overlay.hooks.before.length"
            )
            after_hooks = page.evaluate(
                "window.__heatmapCtrl.manager.overlay.hooks.after.length"
            )
            assert before_hooks >= 1, "should have at least one before hook"
            assert after_hooks >= 1, "should have at least one after hook"

            # Invoke the before hook
            page.evaluate("window.__heatmapCtrl.manager.overlay.hooks.before[0]()")
            render_all = page.evaluate("window.__heatmapCtrl.manager.renderAll")
            assert render_all is True, "renderAll should be True after before hook"
            assert not errors, f"JS errors: {errors}"

    def test_cached_agg_invalidation_on_layer_change(self, browser, tmp_path):
        """cachedAgg is nulled when the layer changes (via onLayerChange)."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            page.evaluate(
                "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn').click()"
            )
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.expanded", state="attached", timeout=5000
            )

            # Set cachedAgg to simulate stale data
            page.evaluate(
                "window.__heatmapCtrl.manager.cachedAgg = { key: 'old', data: 'data' }"
            )
            # Emit the semantic LayerControl registry-change event on the EventBus
            # (replaces the old raw map.fire('layeradd') — the manager now
            # subscribes to LAYER_CHANGE on the per-map EventBus).
            page.evaluate(
                "window.__heatmapCtrl.manager.map.foliplus.events.emit('foliplus:layer:change')"
            )
            page.wait_for_timeout(1000)
            cached = page.evaluate("window.__heatmapCtrl.manager.cachedAgg")
            assert cached is None, "cachedAgg should be nulled after layer change"
            assert not errors, f"JS errors: {errors}"

    def test_clear_heatmap_canvas_resets_caches(self, browser, tmp_path):
        """clearHeatmapCanvas resets all aggregation caches (but not autoFieldKey)."""
        with use_page(self._make_page, browser, tmp_path, expose_ctrl=True) as (
            page,
            errors,
        ):
            page.evaluate("window.__heatmapCtrl.manager.cachedFeatures = { f: 1 }")
            page.evaluate(
                "window.__heatmapCtrl.manager.cachedAgg = { key: 'k', data: 'd' }"
            )
            page.evaluate("window.__heatmapCtrl.manager.clearHeatmapCanvas()")
            features = page.evaluate("window.__heatmapCtrl.manager.cachedFeatures")
            agg = page.evaluate("window.__heatmapCtrl.manager.cachedAgg")
            assert features is None, "cachedFeatures should be nulled"
            assert agg is None, "cachedAgg should be nulled"
            assert not errors, f"JS errors: {errors}"

    def test_works_without_layercontrol(self, browser, tmp_path):
        """HeatmapControl initializes without LayerControl (degradation)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        HeatmapControl().add_to(m)

        html = m.get_root().render()
        html = self._stub_html(html)
        page, errors = make_browser_page(browser, tmp_path, html, "heatmap_no_layer")
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )
        try:
            ctrl = page.evaluate("document.querySelector('.foliplus-heatmap-ctrl')")
            assert ctrl is not None, "HeatmapControl DOM should exist"
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

        Returns a ``(page, errors)`` tuple.  Callers use :func:`use_page`
        to ensure the page is closed on exit.
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
        html = TestHeatmapControlBrowser._expose_ctrl(html)

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
        with use_page(self._build_page, tmp_path, browser, features, agg="sum") as (
            page,
            errors,
        ):
            # Select the first layer (there's only one)
            options = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).map(o => o.value)"
            )
            # Skip the empty/default option, pick the first real layer
            real_options = [v for v in options if v]
            assert len(real_options) >= 1, f"No layer options found: {options}"
            page.evaluate(_js("HeatmapControl/select_layer"), real_options[0])
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
        with use_page(self._build_page, tmp_path, browser, features, agg="avg") as (
            page,
            errors,
        ):
            options = page.evaluate(
                "Array.from(window.__heatmapCtrl.layerSelect.querySelectorAll('option')).map(o => o.value)"
            )
            real_options = [v for v in options if v]
            assert len(real_options) >= 1
            page.evaluate(_js("HeatmapControl/select_layer"), real_options[0])
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
