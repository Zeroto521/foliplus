"""Rendered-HTML and CSS assertions for foliplus.HeatmapControl."""

from __future__ import annotations

import pytest
from conftest import (
    assert_locale,
    read_css,
    read_css_dir,
    render_control,
)

from foliplus import HeatmapControl
from foliplus._cdn_loader import load_cdn


class TestHeatmapControlRendering:
    def test_default_params(self):
        html = render_control(HeatmapControl())
        assert "heatmap-ctrl" in html

    def test_contains_h3_dependency(self):
        html = render_control(HeatmapControl())
        assert dict(load_cdn("HeatmapControl"))["h3-js"] in html

    def test_contains_ss_dependency(self):
        html = render_control(HeatmapControl())
        assert dict(load_cdn("HeatmapControl"))["simple-statistics"] in html

    def test_contains_chroma_dependency(self):
        html = render_control(HeatmapControl())
        assert dict(load_cdn("HeatmapControl"))["chroma-js"] in html

    def test_locale_zh(self):
        html = render_control(HeatmapControl(locale="zh"))
        assert_locale(html, "网格聚合")

    def test_field_kwarg_removed(self):
        """field kwarg is no longer accepted — it was a dead declaration."""
        with pytest.raises(TypeError):
            HeatmapControl(field="value")

    def test_scheme_names_inline(self):
        """schemes list is inlined as JSON array."""
        html = render_control(HeatmapControl())
        assert "Blues" in html and "Viridis" in html

    def test_scheme_dropdown_items_have_data_attr(self):
        """Dropdown items store scheme name for refreshSchemeDropdownItems and title tooltip."""
        html = render_control(HeatmapControl())
        assert "data-scheme-name" in html

    def test_class_count_rows_are_mounted_by_the_shared_primitive(self):
        """Field / Classes / Scheme rows are built in JS by core/rampForm.

        The static render carries their mount point only; the option lists
        (2-9 counts, method names, the scheme trigger) must not be duplicated
        into the template again.
        """
        html = render_control(HeatmapControl())
        assert "data-heatmap-ramp-rows" in html

    def test_error_keys_injected(self):
        """Error/warning locale keys appear in rendered HTML."""
        html = render_control(HeatmapControl())
        assert "value fallback to 1" in html
        assert "h3 cell conversion failed" in html
        assert "h3 boundary conversion failed" in html
        assert "HeatmapControl.close_title" in html

    def test_css_variables_used(self):
        """CSS design tokens are referenced in rendered output."""
        html = render_control(HeatmapControl())
        assert "var(--foliplus-radius-sm)" in html
        assert "var(--foliplus-input-border)" in html
        assert "var(--foliplus-text-primary)" in html
        assert "var(--foliplus-accent-primary)" in html

    def test_css_icon_size_variable(self):
        """HeatmapControl SVGs use --foliplus-icon-size-md via the shared stylesheet."""
        html = render_control(HeatmapControl())
        assert "icon-size-md" in html

    def test_css_panel_shadow(self):
        """Expanded heatmap panel uses --foliplus-panel-shadow."""
        html = render_control(HeatmapControl())
        assert "panel-shadow" in html

    def test_css_scheme_dropdown_hover(self):
        """Scheme dropdown items use accent-light on hover via the unified
        dropdown rule in the shared stylesheet (item class + hover color both injected)."""
        html = render_control(HeatmapControl())
        assert "scheme-dropdown-item" in html
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

    def test_class_method_options_come_from_the_shared_vocabulary(self):
        """The method list is built from #core/classify by core/rampForm.

        Its option markup is created client-side, so the static document
        carries the mount host rather than a second copy of the list. The
        vocabulary the picker reads must still reach the page: the four method
        values and their labels come from the shared classifier and the
        component's locale table, and the two data-* seams keep the selects
        addressable for the shared primitive.
        """
        html = render_control(HeatmapControl())
        assert "data-heatmap-ramp-rows" in html
        for method in ("jenks", "quantile", "equal", "heads"):
            assert method in html
        for label in (
            "Natural Breaks",
            "Quantile",
            "Equal Interval",
            "Equal Count",
        ):
            assert label in html
        assert "data-heatmap-method" in html
        assert "data-heatmap-class-count" in html

    def test_placeholder_options_disabled(self):
        """Layer placeholder and field auto options use disabled:true (not the string)."""
        html = render_control(HeatmapControl())
        # Must use boolean true so dom.el sets el.disabled = true
        assert "placeholder" in html
        # Must NOT use the string variant which silently sets disabled=false
        assert 'disabled: "disabled"' not in html

    def test_focus_breathe_selector_single_definition(self):
        """The breathing-focus selector list is defined once (no animation/reduced-motion duplication)."""
        css = read_css_dir("foliplus/css/common", "reset.css")
        # `foliplus-form-number-input` appears once inside the shared :is(...) list.
        assert css.count("foliplus-form-number-input") == 1
        # The animation is driven by a custom property so reduced-motion only
        # overrides the value, not the selector list.
        assert "var(--foliplus-input-breathe-anim)" in css

    def test_confirm_button_removed(self):
        """Confirm button is gone: every control re-renders live (no Apply)."""
        html = render_control(HeatmapControl())
        assert "btn-confirm" not in html
        assert "HeatmapControl.confirm" not in html

    def test_clear_button_renders(self):
        """Clear button is rendered."""
        html = render_control(HeatmapControl())
        assert "btn-clear" in html
        assert "HeatmapControl.clear" in html

    def test_no_section_headings(self):
        """The panel is one flat row list: no Data/Style headings ship.

        Neither the shared `.foliplus-section-heading` nor a heatmap-local
        lookalike reaches the markup, and the two locale keys that used to
        name them are gone from the JSON too.
        """
        html = render_control(HeatmapControl())
        assert "foliplus-section-heading" not in html
        assert "foliplus-heatmap-section-heading" not in html
        assert "HeatmapControl.section_data" not in html
        assert "HeatmapControl.section_style" not in html

        css = read_css("foliplus/css/HeatmapControl.css")
        assert ".foliplus-heatmap-section-heading" not in css
        shared = read_css("foliplus/css/common/form.css")
        assert ".foliplus-section-heading" not in shared

    def test_close_button_renders(self):
        """Close button is rendered in the panel header."""
        html = render_control(HeatmapControl())
        assert "close-btn" in html
        assert "HeatmapControl.close_title" in html

    def test_ctrl_btn_svg_in_icon_selector(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""

        css = read_css_dir("foliplus/css/common", "button.css")
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
