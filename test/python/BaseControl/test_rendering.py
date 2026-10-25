"""Rendering tests for BaseControl — shared assets, stylesheet tokens, panel CSS."""

from __future__ import annotations

from pathlib import Path

import folium
from conftest import (
    read_css,
    read_css_dir,
    render,
    render_control,
)

from foliplus import FullscreenControl, HeatmapControl, LayerControl, SearchControl


class TestBaseControlRendering:
    """Rendering tests for shared assets and the merged stylesheet."""

    def test_includes_common_css(self, base_map: folium.Map):
        html = render_control(SearchControl())
        assert "--foliplus-ctrl-bg" in html

    # ── BaseControl Python API ──

    def test_render_preserves_config(self, base_map: folium.Map):
        """After rendering, _config is still accessible and contains expected keys."""
        ctrl = SearchControl(mode="coord", zoom=15)
        ctrl.add_to(base_map)
        render(base_map)
        assert ctrl._config["name"] == "SearchControl"
        assert ctrl._config["mode"] == "coord"
        assert ctrl._config["zoom"] == 15

    def test_render_multiple_controls_has_unique_configs(self, base_map: folium.Map):
        """Each control has its own _config cache after rendering."""
        sc = SearchControl(mode="addr", zoom=10)
        fc = FullscreenControl(hide_self=False)
        sc.add_to(base_map)
        fc.add_to(base_map)
        render(base_map)
        assert sc._config["mode"] == "addr"
        assert fc._config["hide_self"] is False

    def test_includes_runtime_js(self, base_map: folium.Map):
        html = render_control(SearchControl())
        # Locale tables are bundled once per map into window.foliplus._TABLES
        assert '"locale.name": "English"' in html
        assert '"locale.name": "中文"' in html

    def test_all_locale_tables_injected(self, base_map: folium.Map):
        """All locale tables are injected into HTML by BaseControl.py."""
        html = render_control(SearchControl())
        assert '"locale.code":"en"' in html or '"locale.code": "en"' in html
        assert '"locale.code":"zh"' in html or '"locale.code": "zh"' in html

    def test_component_tables_injected(self, base_map: folium.Map):
        """Per-component locale tables are injected in the shared header."""
        html = render_control(SearchControl())
        assert "window.foliplus._COMPONENT_TABLES" in html

    def test_shared_assets_deduplicated(self, base_map: folium.Map):
        """Shared assets (runtime.js, the merged stylesheet, locale tables) are injected only once per map."""
        SearchControl().add_to(base_map)
        LayerControl().add_to(base_map)
        HeatmapControl().add_to(base_map)

        html = render(base_map)
        # Shared locale tables table definition is injected exactly once
        assert html.count("window.foliplus._TABLES = {") == 1
        assert html.count("window.foliplus._COMPONENT_TABLES = {") == 1
        # Common CSS root custom properties definition is injected exactly once
        assert html.count("--foliplus-ctrl-bg:") == 1

    # ── shared stylesheet design tokens ──

    def test_z_index_floating_css_variable(self, base_map: folium.Map):
        """--foliplus-z-index-floating CSS custom property is defined in the shared stylesheet."""
        html = render_control(SearchControl())
        assert "--foliplus-z-index-floating" in html
        assert "9990" in html

    def test_z_index_ladder_tokens(self):
        """The z-index ladder is fully tokenized in token.css (no magic numbers in components)."""
        css = read_css_dir("foliplus/css/common", "token.css")
        assert "--foliplus-z-index-floating" in css
        assert "--foliplus-z-index-hint" in css
        assert "--foliplus-z-index-fullscreen" in css
        assert "--foliplus-z-index-top" in css

    def test_z_policy_table_landing(self):
        """The three-family z policy table has a single landing in token.css."""
        css = read_css_dir("foliplus/css/common", "token.css")
        # One section names all three vocabularies and their ownership.
        assert "layer z" in css
        assert "control z" in css
        assert "export z" in css
        assert "Ownership" in css
        assert "Ladder" in css

    def test_z_policy_export_scale_row_is_in_export_ladder(self):
        """The policy table's export-scale row is 9490 (export-base - 10), not 850.

        The old 850 collided with the layer-z band; the row moves with
        the value so the table stays the single source of stacking intent.
        """
        css = read_css_dir("foliplus/css/common", "token.css")
        assert "--foliplus-export-scale-z" in css
        assert "9490" in css
        # The old layer-band value must not survive as the documented row.
        assert "850        export z" not in css

    def test_z_policy_export_header_pointer(self):
        """ExportControl.css points at the policy table instead of re-laddering."""
        css = read_css("foliplus/css/ExportControl.css")
        assert "token.css" in css
        # Cross-system hint/fullscreen narration no longer lives here.
        assert "JS-managed by runtime.js" not in css

    def test_motion_ladder_tokens(self):
        """The motion ladder is tokenized in token.css. `quick` is the entrance
        tier; fast/normal/slow carry the per-component --*-duration values over.
        No value moves."""
        tokens = read_css_dir("foliplus/css/common", "token.css")
        assert "--foliplus-motion-quick: 0.2s" in tokens
        assert "--foliplus-motion-fast: 0.5s" in tokens
        assert "--foliplus-motion-normal: 0.7s" in tokens
        assert "--foliplus-motion-slow: 0.8s" in tokens

    def test_hint_entrance_reads_motion_quick(self):
        """The hint entrance reads its duration from the motion ladder instead
        of carrying a bare 0.2s."""
        css = read_css_dir("foliplus/css/common", "hint.css")
        assert "animation: foliplus-hint-in var(--foliplus-motion-quick)" in css

    def test_ctrl_fold_classes(self, base_map: folium.Map):
        """ctrl-fold is a common pattern for expand/collapse panels."""
        html = render_control(SearchControl())
        assert "ctrl-fold" in html
        assert "collapsed" in html
        assert "expanded" in html

    def test_panel_structure_classes(self, base_map: folium.Map):
        """Shared panel scaffolding classes are present."""
        html = render_control(HeatmapControl())
        assert "foliplus-panel" in html
        assert "foliplus-panel-header" in html
        assert "foliplus-panel-content" in html

    def test_button_focus_visible_rule(self, base_map: folium.Map):
        """The shared stylesheet includes a :focus-visible rule for all buttons."""
        html = render_control(SearchControl())
        assert ":focus-visible" in html
        assert "foliplus-toggle-btn" in html

    def test_button_disabled_rule(self, base_map: folium.Map):
        """The shared stylesheet includes a :disabled rule for all buttons."""
        html = render_control(SearchControl())
        assert ":disabled" in html
        assert "pointer-events: none" in html

    def test_panel_max_height_variable(self, base_map: folium.Map):
        """The shared stylesheet defines --foliplus-panel-max-height."""
        html = render_control(SearchControl())
        assert "--foliplus-panel-max-height" in html
        assert "panel-max-height" in html

    def test_unified_button_hover_border_radius(self, base_map: folium.Map):
        """Unified button hover rule includes border-radius."""
        html = render_control(SearchControl())
        assert "border-radius: var(--foliplus-radius-sm)" in html

    def test_panel_btn_full_width_text_centered(self):
        """`.foliplus-panel-btn` stays full-width; its label is centered on both axes.

        Shared recipe for Reset (LayerControl style) and Clear (Heatmap) —
        button.css keeps the two from drifting. The button itself still
        stretches (`flex: 1`) with no extra margin (the footer row's padding is
        the only inset); the text inside is centered vertically and
        horizontally. Box model / alignment only; hover, active, focus, and
        colors live in the same rule and are deliberately not asserted here.
        """
        css = read_css_dir("foliplus/css/common", "button.css")
        idx = css.find(".foliplus-panel-btn {")
        assert idx != -1, "shared panel-btn recipe missing from button.css"
        block = css[idx : css.index("}", idx) + 1]
        # Still stretches across the footer row, no extra offset.
        assert "flex: 1" in block
        assert "margin" not in block
        # Label text centered on both axes inside the button (flex centering).
        assert "display: flex" in block
        assert "align-items: center" in block
        assert "justify-content: center" in block
        # Rejected: the content-width shrink reading of "centered".
        assert "align-self: center" not in block
        assert "flex: 0 0 auto" not in block
        assert "min-width: 120px" not in block

    def test_panel_btn_shared_by_reset_and_clear(self):
        """Reset (LayerControl) and Clear (Heatmap) both ride `.foliplus-panel-btn`.

        button.css: the two cannot drift. The shared class is the hook that
        applies the one centered-text recipe to both.
        """
        html = render_control(HeatmapControl())
        assert "foliplus-panel-btn foliplus-heatmap-btn-clear" in html

        frame = Path("foliplus/js/LayerControl/ui/style/frame.ts").read_text(
            encoding="utf-8"
        )
        assert 'class: "foliplus-panel-btn foliplus-style-reset-btn"' in frame

    def test_collapsed_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.foliplus-is-collapsed uses --foliplus-shadow-ctrl-strong (shared shadow for all collapsed controls)."""
        html = render_control(SearchControl())
        assert "shadow-ctrl-strong" in html
        # The shadow rule is in the shared stylesheet, not in component CSS
        assert "ctrl-fold.foliplus-is-collapsed" in html

    def test_expanded_shadow_shared(self, base_map: folium.Map):
        """foliplus-ctrl-fold.foliplus-is-expanded uses --foliplus-panel-shadow (shared shadow for all expanded controls)."""
        html = render_control(SearchControl())
        assert "panel-shadow" in html
        assert "ctrl-fold.foliplus-is-expanded" in html

    def test_form_select_joins_input_hover_list(self):
        """`.foliplus-form-select` rides the shared input hover/focus recipe.

        The shared `:is(...)` list in input.css covers `.foliplus-heatmap-ctrl
        select` and the bare form-select class used by LayerControl annotation
        / label panels. Same hover language as color/number.
        """
        css = read_css_dir("foliplus/css/common", "input.css")
        idx = css.find(":is(")
        assert idx != -1
        # The hover/focus list must name the bare shared class.
        block = css[idx : css.index(":is(:hover", idx)]
        assert ".foliplus-form-select" in block

    def test_toggle_switch_press_scales_knob(self):
        """Toggle knob drops to the button-family press scale on :active.

        Checked keeps its translateX so the knob stays on the "on" side while
        it shrinks.
        """
        css = read_css_dir("foliplus/css/common", "form.css")
        assert "input:active + .foliplus-toggle-slider::before" in css
        assert "input:checked:active + .foliplus-toggle-slider::before" in css
        assert "scale(var(--foliplus-scale-press))" in css
        # The checked-press leg must keep the on-side offset.
        assert (
            "translateX(var(--foliplus-size-20)) scale(var(--foliplus-scale-press))"
            in css
        )

    def test_menu_item_press_uses_soft_wash(self):
        """Dropdown/list items answer :active with the soft accent wash.

        Same vocabulary as the Heatmap scheme picker's persistent selection
        (`--foliplus-accent-soft-bg`). Disabled entries never answer; search
        results keep record ink on press.
        """
        css = read_css_dir("foliplus/css/common", "menu.css")
        assert "):not([disabled]):active" in css
        assert "background: var(--foliplus-accent-soft-bg)" in css
        # Search result is a record: text stays text-primary on press too.
        assert ".foliplus-search-result-item:not([disabled]):active" in css
        assert "color: var(--foliplus-text-primary)" in css
        # Disabled menu entries keep their muted non-answer.
        assert ".foliplus-layer-more-menu li[disabled]:active" in css

    def test_layer_more_menu_focus_ring_uses_shared_tokens(self):
        """Layer overflow menu items take the shared focus-ring + fast transition."""
        css = read_css_dir("foliplus/css/LayerControl", "menu.css")
        idx = css.find(".foliplus-layer-more-menu li:focus-visible")
        assert idx != -1
        block = css[idx : css.index("}", idx)]
        assert "var(--foliplus-focus-ring)" in block
        assert "box-shadow var(--foliplus-transition-fast)" in block
