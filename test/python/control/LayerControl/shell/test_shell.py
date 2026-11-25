"""Split of test_rendering.py: TestLayerControlRendering part 1."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    heatmap_ready,
    make_browser_page,
    panel_ready,
    read_css,
    read_css_dir,
    render,
    render_control,
    use_page,
    use_raw_page,
)
from folium import Element

from foliplus import HeatmapControl, LayerControl


def _rule(css: str, tail: str) -> str:
    """Body of the first rule whose selector ends with *tail*.

    Used to check one declaration without matching the same property in a
    neighboring rule (e.g. `margin-top` in the track rule but not the thumb's).
    """
    start = css.index(tail)
    return css[start : css.index("}", start)]


class TestLayerControlRendering:
    @staticmethod
    def _assert_no_bg_transition(css, selector_fragment, must_not, may):
        """Assert the CSS rule whose *selector_fragment* is the base selector
        (i.e. selector_fragment + whitespace + ``{``) does not transition any
        property in *must_not*.

        Handles both single-line (``transition: x;``) and multi-line
        (``transition:\\n  x,\\n  y;``) transition declarations. Uses a
        brace-depth scanner to correctly locate the matching closing ``}``
        for rules that contain CSS nesting (e.g. ``&:is(...) { ... }``).
        """
        needle = selector_fragment + " {"

        def _block_at(pos):
            """Return the declaration text of the rule block starting at *pos*."""
            brace = pos + len(selector_fragment) + 1
            depth, end = 1, brace
            while end < len(css) and depth > 0:
                ch = css[end]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                end += 1
            return css[brace : end - 1]

        def _transition_of(block):
            """Split *block* into declarations and return the transition value."""
            decls = []
            buf = []
            for ch in block:
                if ch == ";":
                    decls.append("".join(buf).strip())
                    buf.clear()
                elif ch == "/" and buf and buf[-1] == "*":
                    decls.append("".join(buf).strip())
                    buf.clear()
                else:
                    buf.append(ch)
            return next((d for d in decls if d.startswith("transition")), None)

        # A selector may appear in multiple rules (e.g. a `grid-area` shorthand
        # and the full style rule). Prefer the rule that actually declares a
        # transition — that is the one this assertion targets.
        pos = 0
        trans_decl = None
        while True:
            idx = css.find(needle, pos)
            if idx == -1:
                break
            trans_decl = _transition_of(_block_at(idx)) or trans_decl
            pos = idx + 1
        assert trans_decl is not None, (
            f"{selector_fragment} rule has no transition declaration"
        )
        # Transition value is "prop timing, prop timing, ..." — split on
        # commas, then take the first token of each segment (the property).
        transitioned_props = {
            seg.split()[0]
            for seg in trans_decl.split(":", 1)[1].split(",")
            if seg.split()
        }
        for prop in must_not:
            assert prop not in transitioned_props, (
                f"{selector_fragment} must not transition {prop} — "
                "element is destroyed+recreated on list rebuild (fold click)"
            )
        for prop in may:
            assert prop in transitioned_props, (
                f"{selector_fragment} should still transition {prop} — "
                "it is pointer/state-driven, not rebuild-driven"
            )

    def test_default_params(self):
        html = render_control(LayerControl())
        assert "foliplus-layer-ctrl" in html

    def test_color_layer_item(self):
        html = render_control(LayerControl())
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

        html = render_control(LayerControl())
        assert "FOLD" in html
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # The turned pose is the aria-expanded override, reading the angle out
        # of token.css. 180deg would be the old popup-style inversion
        # (up-when-expanded) and is exactly what this rule holds back.
        assert 'foliplus-layer-fold-btn[aria-expanded="true"] svg {' in css
        assert "rotate(var(--foliplus-fold-rot-expanded))" in css
        assert "rotate(180deg)" not in css

    def test_locale_zh(self):
        html = render_control(LayerControl(locale="zh"))
        assert_locale(html, "图层", "LayerControl.panel_title")

    def test_position_renders(self):
        html = render_control(LayerControl(position="bottomright"))
        assert "bottomright" in html

    def test_label_collide_default_true(self):
        """label_collide defaults to true and renders as a JS boolean."""
        html = render_control(LayerControl())
        assert_config_value(html, "label_collide", True)

    def test_label_collide_false(self):
        """label_collide=False renders false and disables collision detection."""
        html = render_control(LayerControl(label_collide=False))
        assert_config_value(html, "label_collide", False)

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
        assert sum(1 for d in ctrl._config["data"] if d["role"] == "base") >= 3
        assert sum(1 for d in ctrl._config["data"] if d["role"] != "base") == 0

    def test_base_and_overlay_in_template(self):
        """Both base_layers and overlays appear in the JS template."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = render(m)

        # JS data should contain both with correct role values
        assert '"role": "base"' in html
        assert '"role": "overlay"' in html

    def test_is_base_class_on_base_items(self):
        """Only base map items get the data-layer-type attribute."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # The row's data-layer-type is the layer's role field, verbatim.
        assert '"data-layer-type": layerInfo.role' in html

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
        """All layer items have draggable=true."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # DOM API sets draggable at runtime via setAttribute
        assert (
            'draggable:"true"' in html
            or 'draggable: "true"' in html
            or 'draggable="true"' in html
        )

    def test_locale_en_keys(self, base_map: folium.Map):
        """Default (en) locale keys rendered."""
        html = render_control(LayerControl())
        assert "LayerControl.toggle_title" in html
        assert "LayerControl.panel_title" in html
        assert "LayerControl.base_map_label" in html

    def test_label_locale_keys(self):
        """Style-panel locale keys exist in both en and zh.

        The container (``style_*``) and the label-only dimension
        (``style_label_field`` / ``_no_data``) stay component-scoped.
        ``test_locale.py`` covers the cross-table key set.

        The retired ``style_label_field_auto`` key (the removed Auto entry in
        the field picker) must stay retired: the picker names a real field, so
        there is no pseudo-option left to translate.
        """
        root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
        required = {
            "style_layer",
            "style_layer_tooltip",
            "style_label_field",
            "style_label_no_data",
            "style_reset",
        }
        retired = "style_label_field_auto"
        for lang in ("en", "zh"):
            data = json.loads(
                (root / "foliplus" / "locale" / f"LayerControl.{lang}.json").read_text(
                    encoding="utf-8"
                )
            )
            keys = {
                k.split(".")[-1] for k in data.keys() if k.startswith("LayerControl.")
            }
            missing = required - keys
            assert not missing, (
                f"LayerControl.{lang} missing style-panel keys: {missing}"
            )
            assert retired not in keys, (
                f"LayerControl.{lang} still carries the removed {retired} key"
            )

    def test_color_click_deselects_bases(self, base_map: folium.Map):
        """Color layer checkbox change handler present in rendered code."""
        html = render_control(LayerControl())
        assert "showSolidBasemap" in html

    def test_drag_base_map_allowed(self):
        """No drag prevention for base maps in JS code."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        # Should NOT contain old drag prevention for base maps
        assert "this.layers[idx].role" not in html

    def test_separator_in_template(self):
        """Separator label 'BASE MAP' appears before base layer items."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        html = render(m)
        assert "base_map_label" in html

    def test_css_variables_used(self, base_map: folium.Map):
        """CSS variables from the shared stylesheet are referenced in rendered output."""
        html = render_control(LayerControl())
        assert "var(--foliplus-space-xl)" in html
        assert "var(--foliplus-accent-primary)" in html
        assert "var(--foliplus-radius-sm)" in html
        assert "var(--foliplus-transition-fast)" in html

    def test_leaflet_control_classes_applied(self, base_map: folium.Map):
        """LayerControl renders with leaflet-control classes for Leaflet theming."""
        html = render_control(LayerControl())
        assert "leaflet-control" in html
        assert "leaflet-bar" in html

    def test_layer_item_dom_structure(self, base_map: folium.Map):
        """Each layer-item has checkbox, label, type-icon-col."""
        html = render_control(LayerControl())
        assert "foliplus-checkbox" in html
        assert "foliplus-type-icon-col" in html

    def test_layer_item_6_column_grid(self, base_map: folium.Map):
        """Layer item uses 6-column grid-template-areas with all six slots."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert '"rail check label count icon more"' in css

    def test_layer_item_grid_column_classes_rendered(self, base_map: folium.Map):
        """All 6 grid-column CSS classes appear in the rendered output."""
        html = render_control(LayerControl())
        assert "foliplus-layer-rail" in html
        assert "foliplus-layer-count" in html
        assert "foliplus-layer-more-btn" in html
        assert "foliplus-type-icon-col" in html
        assert "foliplus-checkbox" in html
        assert "foliplus-layer-label" in html

    def test_more_tooltip_rendered(self, base_map: folium.Map):
        """More button has i18n more_tooltip title/aria-label."""
        html = render_control(LayerControl())
        assert "more_tooltip" in html

    def test_more_button_grid_area(self):
        """More button is placed in the 'more' grid area."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "foliplus-layer-more-btn" in css
        assert "grid-area: more" in css

    def test_drag_cell_grid_area(self):
        """Rail cell is placed in the 'rail' grid area (v3.8: drag-cell renamed)."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "grid-area: rail" in css

    def test_count_column_min_max_and_funnel_token(self):
        """The count column is a min/max track: the funnel token plus the
        widest compact value ("2.5K", "1.2万") must fit at the max width, and
        the min keeps a short value from collapsing the column. The value is
        always compact (formatNumber("auto")), never a full number."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "var(--foliplus-filter-funnel-size)" in css
        token_css = read_css("foliplus/css/common/token.css")
        assert "--foliplus-filter-funnel-size: 12px" in token_css
        assert "--foliplus-count-track-min-width:" in token_css
        assert "--foliplus-count-track-width: 48px" in token_css
        assert "minmax(var(--foliplus-count-track-min-width)" in token_css

    def test_filtered_funnel_is_neutral_with_currentcolor_fill(self):
        """The filtered-row funnel is a state mark, not an action accent.

        It uses --foliplus-text-primary and the SVG's own fill is overridden
        with currentColor: the icon ships a fill, so `color` alone never
        reaches it (and the default black would vanish on a dark theme).
        """
        css = read_css("foliplus/css/control/LayerControl/row.css")
        idx = css.find(".foliplus-layer-count-funnel")
        assert idx != -1
        # The funnel rule lives in the shared row-cell block (":is(.foliplus-
        # layer-item, .foliplus-layer-sep.foliplus-layer-toggle-all)"), nested
        # two levels deep. Slice to the funnel rule's own close (six-space
        # indentation) so the scan cannot leak into the folded rule that
        # follows it in the same block.
        block = css[idx : css.index("\n      }", idx)]
        assert "color: var(--foliplus-text-primary)" in block
        assert "fill: currentColor" in block
        assert "var(--foliplus-accent-primary)" not in block

    def test_type_icon_col_size_anchored_to_checkbox(self):
        """type-icon-col is 16px (space-xl) to anchor to the checkbox square."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # type-icon-col width/height use the checkbox square (--foliplus-space-xl = 16px),
        # not the old 14px/18px icon-size tokens.
        idx = css.find(".foliplus-type-icon-col {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "var(--foliplus-space-xl)" in block
        assert "var(--foliplus-icon-size-xs)" not in block
        assert "var(--foliplus-icon-size-md)" not in block

    def test_more_column_width_named_vars(self):
        """More grid column and button both use --foliplus-more-btn-width (7px),
        and the count column uses --foliplus-count-track-width; both keep the track and
        each element's own width synchronised without magic numbers."""
        token_css = read_css("foliplus/css/common/token.css")
        layer_css = read_css("foliplus/css/control/LayerControl/index.css")
        # Named dimension vars are defined once in token.css
        assert "--foliplus-count-track-width: 48px" in token_css
        assert "--foliplus-more-btn-width: 7px" in token_css
        # grid track references the named vars (not literals)
        idx = token_css.find("--foliplus-grid-layer-cols:")
        assert idx != -1
        track = token_css[idx : token_css.index(";", idx)]
        assert "var(--foliplus-more-btn-width)" in track
        assert "var(--foliplus-count-track-width)" in track
        assert "minmax(var(--foliplus-count-track-min-width)" in track
        # more-btn width uses the named var, not icon-size-xs
        blks = [
            layer_css[i : layer_css.index("}", i) + 1]
            for i in range(len(layer_css))
            if layer_css.startswith(".foliplus-layer-more-btn {", i)
        ]
        assert blks, "no .foliplus-layer-more-btn { rule found"
        assert "var(--foliplus-more-btn-width)" in "\n".join(blks)
        assert not any("var(--foliplus-icon-size-xs)" in b for b in blks)

    def test_color_map_id_constant(self, base_map: folium.Map):
        """Color map uses a special constant ID for identification."""
        html = render_control(LayerControl())
        assert "foliplus_color_map" in html

    def test_hint_duration_constants_in_layer(self, base_map: folium.Map):
        """LayerControl uses hint duration constants (not hardcoded values)."""
        html = render_control(LayerControl())
        assert "HINT_DURATION" in html
        assert "HINT_COOLDOWN_MS: 800" in html

    def test_separator_container_has_base_label(self, base_map: folium.Map):
        """Separator label uses localized base_map_label key."""
        html = render_control(LayerControl())
        assert "LayerControl.base_map_label" in html

    def test_css_interaction_effects(self, base_map: folium.Map):
        """The Row-cursor recipe exists in the source CSS and drives every
        interactive element with one recipe.

        Mouse hover and the JS cursor class (.foliplus-is-focused-row) share a
        single :is() rule, so they cannot drift apart: white surface, left bar
        accent, top/bottom red glow, drag grip, type icon black, more button
        red. White paints whenever the row is the interaction target (hover /
        Tab / arrow); a checked row shows its .foliplus-active wash only at rest.
        :focus-visible is deliberately NOT a CSS trigger — Tab focus is mapped
        onto the class by the focusin delegate. Only color changes; the type
        icon must NOT scale."""
        html = render_control(LayerControl())
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # Fold toggle button: hover and press wake the BUTTON, not its svg -
        # the arrow keeps its own transform on the svg so the wake cannot
        # overwrite which way it points.
        assert "foliplus-layer-fold-btn:hover" in html
        assert "foliplus-layer-fold-btn:active" in html

        # ── The unified Row-cursor recipe, read from the source CSS ──
        # The :is() selector only exists before PostCSS flattens nesting, so it
        # cannot be found in the built bundle. Anchor the brace scan at the
        # opening brace of the :is() rule (NOT the parent's — the nearest
        # preceding `{` belongs to the sibling &.foliplus-active rule), then count depth
        # to isolate exactly this rule's body without leaking into siblings.
        mark = ":hover:where(:not(:has(.foliplus-row-panel:hover)))"
        # The recipe's :is() rule sits INSIDE the compound selector that opens
        # with `.foliplus-layer-item,` — anchor there so css.find() does not
        # match the fold-btn's own `:not(...):is(...)` rule earlier in the file.
        compound = css.find(".foliplus-row,")
        assert compound != -1, "Row-cursor compound selector not found"
        start = css.find(mark, compound)
        assert start != -1, "unified Row-cursor recipe selector not found"
        # :focus-visible is never a recipe trigger — Esc cancel is one class off.
        assert "is(:hover, :focus-visible, .foliplus-is-focused-row)" not in css
        # Both row types join the parent compound selector that carries this
        # :is() rule (also asserted in test_toggle_all_hover_shares_row_cursor_
        # recipe, which checks the exact selector string).
        assert ".foliplus-layer-item" in css
        assert ".foliplus-layer-sep.foliplus-layer-toggle-all" in css
        open_brace = css.index("{", start)
        depth, body = 1, css[open_brace + 1 :]
        out = []
        for ch in body:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            out.append(ch)
        recipe = "".join(out)
        # Normalize whitespace so a Prettier reflow of a long value (e.g. the
        # multi-line box-shadow) cannot break the substring assertions below.
        recipe = re.sub(r"\s+", " ", recipe)
        # The left accent bar is a PERSISTENT checked-status indicator, so the
        # interaction recipe must NOT force it — hover/keyboard/Tab show the
        # glow, and the red left bar stays reserved for .foliplus-active / folded groups.
        assert "border-left-color" not in recipe
        # Rest surface of the compound itself: explicit white, never
        # transparent (a transparent rest and a painted interaction white
        # would disagree about what "white row" means).
        parent_body_start = css.index("{", compound)
        parent_snip = css[parent_body_start : parent_body_start + 400]
        assert "background: var(--foliplus-surface)" in parent_snip, (
            "recipe rows must rest on the explicit white surface"
        )
        assert "background: transparent" not in parent_snip, (
            "recipe rows must not rest on a transparent surface"
        )
        # White surface is painted whenever the row is the interaction target
        # (hover / Tab / arrow share this recipe). Checked rows show the wash
        # only at rest — the cursor paints white on top.
        assert "background: var(--foliplus-surface)" in recipe
        # Bottom glow is outboard; the next row's opaque surface would cover
        # it without a stacking lift on the interaction target.
        assert "position: relative" in recipe
        assert "z-index: 1" in recipe, "cursor recipe must paint the white surface"
        # Interaction white must sit AFTER the .foliplus-active wash in source order so
        # it wins at equal specificity (postcss keeps declaration order).
        active_idx = css.find("&.foliplus-active", compound)
        recipe_idx = css.find(mark, compound)
        assert 0 < active_idx < recipe_idx, (
            "interaction recipe must be declared after .foliplus-active so white "
            "out-ranks the wash"
        )
        # Base basemap / color picker stay quiet: no cursor glow/white.
        assert 'data-layer-type="base"' in css, (
            "base rows must opt out of the cursor recipe"
        )
        # Checked color basemap keeps the wash on hover.
        assert "foliplus-active" in css
        assert "--foliplus-panel-header-hover" not in recipe
        # Top/bottom red glow (blurred box-shadow) is part of the SHARED recipe,
        # not cursor-only, so mouse hover and Tab focus match the arrow-key cursor
        # exactly. A 0 X-offset keeps it vertical (only top/bottom glow, no
        # left/right bleed).
        assert (
            "0 calc(-1 * var(--foliplus-size-2)) var(--foliplus-size-4) var(--foliplus-accent-primary)"
            in recipe
        )
        assert (
            "0 var(--foliplus-size-2) var(--foliplus-size-4) var(--foliplus-accent-primary)"
            in recipe
        )
        assert "color: var(--foliplus-text-primary)" in recipe
        assert "color: var(--foliplus-accent-primary)" in recipe

        # ── Type icon ──
        assert "foliplus-type-icon-col svg" in html
        assert "transition: transform" in html
        # A checked row carries .foliplus-active — a persistent checkbox state, not a
        # cursor — and the cursor-only type-icon tint comes from the recipe.
        # The rule lives in the shared row-cell block, so its selector is the
        # :is() pair (layer row + role header) rather than a bare class.
        assert (
            "\.foliplus-active:is(\.foliplus-row, "
            ".foliplus-layer-sep.foliplus-layer-toggle-all) .foliplus-type-icon-col"
            in html
        )
        # Read the rule body directly from its selector: the shared row-cell
        # block emits one rule for both row kinds, so the selector is the
        # :is() pair and the body is the next {...} after it.
        act_sel = (
            "\.foliplus-active:is(\.foliplus-row, "
            ".foliplus-layer-sep.foliplus-layer-toggle-all) .foliplus-type-icon-col"
        )
        act_idx = html.index(act_sel)
        act_type = html[act_idx : html.index("}", act_idx)]
        assert "color: var(--foliplus-text-primary)" in act_type, (
            "type icon on active row must be black, not accent"
        )
        assert "color: var(--foliplus-accent-primary)" not in act_type, (
            "type icon must never tint accent"
        )
        # Regression guard: no scale transform may be reintroduced on the icon
        assert "foliplus-layer-item:hover .foliplus-type-icon-col svg" not in html

        # ── More (⋮) menu icon: identity wakes gray → black on hover/keyboard
        # focus, matching the LayerControl type-icon language (NOT accent) — the
        # main text goes black → red via the unified dropdown hover (css/common/menu.css),
        # so "icon black + text red" reads like every other dropdown. ──
        more_icon = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "more-menu button svg" in html[max(0, i - 60) : i + 60]
        ]
        assert any("color: var(--foliplus-text-muted)" in b for b in more_icon), (
            "more-menu icon must be muted at rest"
        )
        more_icon_hover = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "more-menu button:not([aria-disabled=true]):hover svg"
            in html[max(0, i - 60) : i + 60]
        ]
        assert any(
            "color: var(--foliplus-text-primary)" in b for b in more_icon_hover
        ), "more-menu icon must wake to black on hover"
        assert not any(
            "color: var(--foliplus-accent-primary)" in b for b in more_icon_hover
        ), "more-menu icon must not tint accent"

        # Count column: stays muted in every state — no hover/active brightening.
        count_hover = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "layer-item:hover .foliplus-layer-count" in html[max(0, i - 60) : i + 60]
        ]
        assert not count_hover, (
            "count must not brighten on hover (label, not a control)"
        )

        # Toggle button SVG inherits color
        assert "foliplus-toggle-btn svg" in html
        assert "stroke: currentColor" in html
        # Close (X) button SVG must also be in the icon selector
        assert "foliplus-ctrl-btn" in html

    def test_close_btn_svg_styled(self):
        """ctrl-btn svg is included in the common icon selector so X lines are visible."""
        css = read_css_dir("foliplus/css/common", "button.css")
        # .foliplus-ctrl-btn must appear inside the :is() icon-size rule so that
        # its SVG lines get stroke:currentColor (without it the X is invisible).
        assert ".foliplus-ctrl-btn" in css

    def test_folded_state_no_accent_text(self):
        """Folded label keeps neutral color; only left border and fold-btn use accent."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # left border and fold-btn turn accent when folded — both expected
        assert "foliplus-layer-folded" in css
        assert "border-left-color: var(--foliplus-accent-primary)" in css
        # label must NOT be colored accent when folded (label stays text-primary)
        assert "foliplus-layer-folded .foliplus-layer-sep-label" not in css, (
            "folded label must not override color (label stays text-primary)"
        )

    def test_toggle_all_grid_uses_named_slots_for_three_items(self):
        """Toggle-all (role) row names rail/check/label/count/icon/more.

        The role row carries count/icon/more, so it uses
        the same six named areas as folder/layer rows. Before that, the row
        had three named slots plus three anonymous dots (the divider was
        positioned by grid-column). The six-area template places count/icon/
        more into distinct columns so they never overlap the divider.
        """
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # The toggle-all (role) row block carries the six named areas.
        idx = css.find(".foliplus-layer-sep.foliplus-layer-toggle-all")
        assert idx != -1, "toggle-all block not found"
        block = css[idx : idx + 700]
        assert '"rail check label count icon more"' in block, (
            "toggle-all template-areas must use the six named slots "
            "(role row carries count/icon/more)"
        )
        # No template-areas line references 'divider' as a named area —
        # the dual-declaration coupling (container slot + item grid-area)
        # only ever applied to divider and is now avoided.
        lines = [l.strip() for l in css.splitlines() if "grid-template-areas" in l]
        assert not any("divider" in l for l in lines)
        # No template-areas line references 'divider' as a named area —
        # the dual-declaration coupling (container slot + item grid-area)
        # only ever applied to divider and is now avoided.
        assert not any("divider" in l for l in lines)
