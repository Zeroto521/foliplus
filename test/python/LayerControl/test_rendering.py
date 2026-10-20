"""Rendering-level tests for foliplus.LayerControl (no browser)."""

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
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "rotate(180deg)" in css

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
        assert sum(1 for d in ctrl._config["data"] if d["group"] == "base") >= 3
        assert sum(1 for d in ctrl._config["data"] if d["group"] != "base") == 0

    def test_base_and_overlay_in_template(self):
        """Both base_layers and overlays appear in the JS template."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Markers", overlay=True, show=True).add_to(m)
        html = render(m)

        # JS data should contain both with correct group values
        assert '"group": "base"' in html
        assert '"group": "overlay"' in html

    def test_is_base_class_on_base_items(self):
        """Only base map items get the data-layer-type attribute."""
        m = folium.Map()
        LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        html = render(m)

        # The row's data-layer-type is the layer's group field, verbatim.
        assert '"data-layer-type": layerInfo.group' in html

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

    def test_annotation_locale_keys(self):
        """Style-panel locale keys exist in both en and zh.

        The container (``style_*``) and the annotation-only dimension
        (``style_label_field`` / ``_no_data``) stay component-scoped.
        ``test_locale.py`` covers the cross-table key set.
        """
        root = Path(__file__).resolve().parent.parent.parent.parent
        required = {
            "style_layer",
            "style_layer_tooltip",
            "style_label_field",
            "style_label_field_auto",
            "style_label_no_data",
            "style_reset",
        }
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
        assert "this.layers[idx].group" not in html

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
        css = read_css("foliplus/css/LayerControl/index.css")
        assert '"drag check label count icon more"' in css

    def test_layer_item_grid_column_classes_rendered(self, base_map: folium.Map):
        """All 6 grid-column CSS classes appear in the rendered output."""
        html = render_control(LayerControl())
        assert "foliplus-drag-cell" in html
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
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "foliplus-layer-more-btn" in css
        assert "grid-area: more" in css

    def test_drag_cell_grid_area(self):
        """Drag cell is placed in the 'drag' grid area."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "grid-area: drag" in css

    def test_count_column_5_char_cap(self):
        """Count column is 38px wide, sized for up to ~5 tabular-nums characters."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "38px" in css

    def test_type_icon_col_size_anchored_to_checkbox(self):
        """type-icon-col is 16px (space-xl) to anchor to the checkbox square."""
        css = read_css("foliplus/css/LayerControl/index.css")
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
        layer_css = read_css("foliplus/css/LayerControl/index.css")
        # Named dimension vars are defined once in token.css
        assert "--foliplus-count-track-width: 38px" in token_css
        assert "--foliplus-more-btn-width: 7px" in token_css
        # grid track references the named vars (not literals)
        idx = token_css.find("--foliplus-grid-layer-cols:")
        assert idx != -1
        track = token_css[idx : token_css.index(";", idx)]
        assert "var(--foliplus-more-btn-width)" in track
        assert "var(--foliplus-count-track-width)" in track
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
        css = read_css("foliplus/css/LayerControl/index.css")
        # Fold toggle button SVG
        assert "foliplus-layer-fold-btn:hover svg" in html
        assert "foliplus-layer-fold-btn:active" in html

        # ── The unified Row-cursor recipe, read from the source CSS ──
        # The :is() selector only exists before PostCSS flattens nesting, so it
        # cannot be found in the built bundle. Anchor the brace scan at the
        # opening brace of the :is() rule (NOT the parent's — the nearest
        # preceding `{` belongs to the sibling &.foliplus-active rule), then count depth
        # to isolate exactly this rule's body without leaking into siblings.
        mark = "is(:hover, .foliplus-is-focused-row)"
        # The recipe's :is() rule sits INSIDE the compound selector that opens
        # with `.foliplus-layer-item,` — anchor there so css.find() does not
        # match the fold-btn's own `:not(...):is(...)` rule earlier in the file.
        compound = css.find(".foliplus-layer-item,")
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
        assert ".foliplus-layer-item.foliplus-active .foliplus-type-icon-col" in html
        act_type = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "layer-item.foliplus-active .foliplus-type-icon-col"
            in html[max(0, i - 60) : i + 60]
        ]
        assert any("color: var(--foliplus-text-primary)" in b for b in act_type), (
            "type icon on active row must be black, not accent"
        )
        assert not any(
            "color: var(--foliplus-accent-primary)" in b for b in act_type
        ), "type icon must never tint accent"
        # Regression guard: no scale transform may be reintroduced on the icon
        assert "foliplus-layer-item:hover .foliplus-type-icon-col svg" not in html

        # ── More (⋮) menu icon: identity wakes gray → black on hover/keyboard
        # focus, matching the LayerControl type-icon language (NOT accent) — the
        # main text goes black → red via the unified dropdown hover (css/common/menu.css),
        # so "icon black + text red" reads like every other dropdown. ──
        more_icon = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "more-menu li svg" in html[max(0, i - 60) : i + 60]
        ]
        assert any("color: var(--foliplus-text-muted)" in b for b in more_icon), (
            "more-menu icon must be muted at rest"
        )
        more_icon_hover = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "more-menu li:not([disabled]):hover svg" in html[max(0, i - 60) : i + 60]
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
            "count must not brighten on hover (annotation, not a control)"
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
        css = read_css("foliplus/css/LayerControl/index.css")
        # left border and fold-btn turn accent when folded — both expected
        assert "foliplus-layer-folded" in css
        assert "border-left-color: var(--foliplus-accent-primary)" in css
        # label must NOT be colored accent when folded (label stays text-primary)
        assert "foliplus-layer-folded .foliplus-layer-sep-label" not in css, (
            "folded label must not override color (label stays text-primary)"
        )

    def test_toggle_all_grid_uses_named_slots_for_three_items(self):
        """Toggle-all row names only drag/check/label slots; divider is
        anonymous (dual-declaration trap removed)."""
        css = read_css("foliplus/css/LayerControl/index.css")
        # The toggle-all container's template-areas carries exactly the
        # three named slots (drag/check/label) plus three anonymous dots.
        lines = [l.strip() for l in css.splitlines() if "grid-template-areas" in l]
        toggle_all_areas = [
            l for l in lines if ". . ." in l and "count icon more" not in l
        ]
        assert len(toggle_all_areas) == 1, (
            f"expected exactly one toggle-all template-areas line, got {toggle_all_areas}"
        )
        assert "drag check label . . ." in toggle_all_areas[0]
        # No template-areas line references 'divider' as a named area —
        # the dual-declaration coupling (container slot + item grid-area)
        # only ever applied to divider and is now avoided.
        assert not any("divider" in l for l in lines)

    def test_toggle_all_divider_uses_explicit_column_range(self):
        """Divider is placed by grid-column: 4 / -1 (explicit range), not
        grid-area or grid-column: span — so it never overflows to a new row
        when anonymous slots change count."""
        css = read_css("foliplus/css/LayerControl/index.css")
        # Find the .foliplus-section-divider rule nested under toggle-all.
        idx = css.find(".foliplus-section-divider {")
        assert idx != -1, "no .foliplus-section-divider { rule found"
        block = css[idx : css.index("}", idx) + 1]
        assert "grid-column: 4 / -1" in block
        assert "grid-area" not in block, (
            "divider must not be positioned by grid-area (the dual-declaration trap)"
        )
        assert "grid-column: span" not in block, (
            "divider must not use span (overflowed to next row on 6-col track)"
        )

    def test_toggle_all_divider_column_range_bounded_by_track(self):
        """Divider's grid-column: 4 / -1 stays inside the 6-col track:
        start (4) = label slot + 1; end (-1) = last column. So the range
        never overflows past the last track, which would push the divider
        to a new row."""
        token_css = read_css("foliplus/css/common/token.css")
        layer_css = read_css("foliplus/css/LayerControl/index.css")
        # The shared track defines exactly 6 columns:
        #   drag(16) check(16) label(1fr) count(38) icon(16) more(7)
        idx = token_css.find("--foliplus-grid-layer-cols:")
        assert idx != -1
        track = token_css[idx : token_css.index(";", idx)]
        # Count the track's space tokens — each column is one term separated
        # by whitespace; the track is built from 6 named/space tokens.
        col_terms = [
            t.rstrip(":;")
            for t in track.split()
            if t.rstrip(":;") not in ("", "--foliplus-grid-layer-cols")
        ]
        assert len(col_terms) == 6, (
            f"expected 6-col track, got {len(col_terms)}: {col_terms}"
        )
        # Divider rule must sit in the toggle-all container (so 4 / -1 is
        # evaluated against the same 6-col track).
        ta_idx = layer_css.find(".foliplus-layer-sep.foliplus-layer-toggle-all {")
        assert ta_idx != -1
        ta_block = layer_css[ta_idx : layer_css.index("}", ta_idx) + 1]
        assert "var(--foliplus-grid-layer-cols)" in ta_block
        div_idx = layer_css[ta_idx:].find(".foliplus-section-divider {")
        assert div_idx != -1, "divider rule not inside toggle-all container"
        div_block = layer_css[
            ta_idx : ta_idx + layer_css[ta_idx:].index("}", div_idx) + 1
        ]
        assert "grid-column: 4 / -1" in div_block, (
            "divider must start at col 4 (after label slot 3) and end at -1 (col 6)"
        )

    def test_toggle_all_align_self_center_removed(self):
        """Divider no longer declares a redundant align-self: center — the
        row already aligns items to center via align-items: center."""
        css = read_css("foliplus/css/LayerControl/index.css")
        idx = css.find(".foliplus-section-divider {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "align-self" not in block

    def test_toggle_all_label_semibold_primary(self):
        """Section header label is semibold and text-primary so it reads as a real header."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "foliplus-layer-toggle-all .foliplus-layer-sep-label" in css
        assert "font-weight: var(--foliplus-font-weight-semibold)" in css
        assert "color: var(--foliplus-text-primary)" in css

    def test_toggle_all_hover_shares_row_cursor_recipe(self):
        """Toggle-all row joins the shared Row-cursor recipe: hover uses
        accent-primary (not accent-light) and the fold row cannot drift into a
        private hover style anymore."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert ".foliplus-layer-sep.foliplus-layer-toggle-all" in css
        assert "is(:hover, .foliplus-is-focused-row)" in css
        assert "is(:hover, :focus-visible, .foliplus-is-focused-row)" not in css
        assert "border-left-color: var(--foliplus-accent-primary)" in css
        # The old fold-row-only hover used a softer border than the data rows.
        assert "border-left-color: var(--foliplus-accent-light)" not in css

    def test_open_overlay_lifts_owner_row_above_sibling_wake(self):
        """While a row overlay is open the owner row is lifted to the floating
        index, so no sibling hover wake can paint over the menu or a row
        panel. A fixed overlay z-index is not enough: opening a menu focuses
        its first item, so the focusin delegate marks the OWNER row
        `.foliplus-is-focused-row`; the recipe then gives the owner a z-index
        1 stacking context that confines the overlay, and a later lit
        sibling paints over it (measured in the browser). Lifting the owner
        carries the overlay with it and settles every stacking combination.
        Sibling rows keep their normal hover wake; that is their own state
        display."""
        css = read_css("foliplus/css/LayerControl/index.css")
        overlay_list = ".foliplus-layer-more-menu.open, .foliplus-row-panel"
        assert f"&:has({overlay_list})" in css, (
            "the lift must key on the more-menu AND the row-panel shell"
        )
        assert ".foliplus-layer-item:has(" in css, (
            "the owner row (the row containing the open overlay) is raised"
        )
        assert "z-index: var(--foliplus-z-index-floating)" in css
        # The ⋮ dropdown anchors flush to its row — the shared shell adds a 2px
        # margin-top that would open a sliver of list under the cursor path;
        # T266 declares the whole margin (not just margin-top) so a host
        # framework's bare `ol,ul` margin reset cannot leak a bottom gap.
        assert "margin: 0" in css

    def test_folded_fold_btn_turns_accent(self):
        """Fold button color becomes accent-primary when row is folded."""
        css = read_css("foliplus/css/LayerControl/index.css")
        # Find the rule that targets fold-btn itself (not fold-btn svg)
        # by searching for the closing of the selector without "svg" on the same segment
        match = re.search(
            r"foliplus-layer-folded\s+\.foliplus-layer-fold-btn\s*\{([^}]*)\}",
            css,
        )
        assert match, "folded fold-btn rule not found"
        assert "var(--foliplus-accent-primary)" in match.group(1)

    def test_section_divider_fades_when_folded(self):
        """Section divider fades to opacity 0 when the group is folded."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "foliplus-section-divider" in css
        assert "opacity: 0" in css

    def test_form_label_right_aligned_no_section_heading(self):
        """Row labels are right-aligned; the shared section heading is gone.

        Both rules lived in form.css — the heading because HeatmapControl and
        the style panel shared it, the label because all three panels share one
        label column. Panels are now a flat row list, so only the label rule
        survives, and it must keep the right alignment the attributes panel's
        flex twin mirrors in attr.css.
        """
        css = read_css("foliplus/css/common/form.css")
        assert ".foliplus-section-heading" not in css
        label = _rule(css, ".foliplus-form-label {")
        assert "text-align: right" in label
        assert "padding-right: var(--foliplus-space-xs)" in label

    def test_wa_slider_skin_css(self):
        """The wa-slider skin reads all geometry from foliplus tokens."""
        css = read_css("foliplus/css/common/wa.css")
        tokens = read_css("foliplus/css/common/token.css")
        # The skin declares the wa-slider's host-level CSS variables from tokens.
        assert "--track-size: var(--foliplus-slider-rail-height)" in css
        assert "--thumb-width: var(--foliplus-slider-thumb-hit)" in css
        assert "--marker-width: var(--foliplus-slider-dot-size)" in css
        # Part-based skin rules for the track, thumb, indicator, and tooltip.
        for part in ("track", "thumb", "indicator", "tooltip__tooltip"):
            assert f"::part({part})" in css
        # The bridge from --wa-* to --foliplus-* tokens is in token.css.
        assert "--wa-form-control-activated-color" in tokens
        assert "--wa-color-neutral-fill-normal" in tokens
        assert "--wa-color-surface-default" in tokens
        assert "--wa-focus-ring" in tokens

    def test_rows_declare_no_slider_geometry(self):
        """The rows may only state their own coverage, never geometry.

        The guard against the duplication coming back: a row that redeclares a
        rail height or a thumb is one that can drift from the component. Read
        raw — `read_css` expands `@import`, so through it every row "contains"
        token.css. The dots reference `--foliplus-slider-rail-height` to
        align on the rail — that is a read, not a redeclaration, so it is
        exempt.
        """
        root = Path(__file__).resolve().parents[3]
        for rel in (
            "foliplus/css/common/form.css",
            "foliplus/css/LayerControl/style.css",
        ):
            raw = (root / rel).read_text(encoding="utf-8")
            assert "::-webkit-slider-thumb" not in raw, rel
            assert "::-moz-range-thumb" not in raw, rel

    def test_zoom_range_row_css(self):
        """The row adds no styling of its own.

        Coverage is a readout, not a recoloring: the dots' rings carry it (gray
        where the range does not reach), so the rail stays accent and the text
        stays ink whatever the map's zoom is. The row keeps its hook class and
        the tooltip, nothing else.
        """
        css = read_css("foliplus/css/LayerControl/style.css")
        assert ".foliplus-style-zoom-range-row" in css
        assert "--foliplus-slider-thumb-ring" not in css
        assert "foliplus-zoom-range-out-of-range .foliplus-slider-fill" not in css
        assert ".foliplus-style-zoom-range-current-value" in css
        # The label-hidden rule lives here (not in common/slider.css): the
        # current-value label is the only thing that needs it, and only the
        # zoom-range row produces it.
        label_hidden = _rule(css, ".foliplus-slider-label-hidden {")
        assert "visibility: hidden" in label_hidden

    def test_style_panel_locale_keys_present(self):
        """Opacity key is injected into the LayerControl bundle."""
        html = render_control(LayerControl())
        assert "LayerControl.style_opacity" in html

    def test_fold_btn_hover_color(self):
        """Fold button hover shows accent color (no bg/radius on fold-btn itself)."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "&:hover" in css
        assert "color: var(--foliplus-accent-primary)" in css

    def test_more_btn_press_scales(self):
        """Row more-button answers :active with the button-family press scale.

        Instant (transition stays none) so a list rebuild cannot flash a
        mid-scale frame.
        """
        css = read_css("foliplus/css/LayerControl/menu.css")
        idx = css.find(".foliplus-layer-more-btn")
        assert idx != -1
        block = css[idx : css.index(".foliplus-layer-item:hover", idx)]
        assert "&:active" in block
        assert "scale(var(--foliplus-scale-press))" in block

    def test_layer_row_press_uses_soft_wash(self):
        """Layer rows answer :active with the soft accent wash, no scale.

        Same vocabulary as the Heatmap scheme picker's persistent selection.
        Large rows do not scale; deliberately no transition (rows rebuild on
        every list render). Base basemap rows stay quiet. Declared after the
        hover recipe so the press wash wins on equal specificity while the
        button is down.

        The :not(:has(...)) carve-out keeps the wash scoped to real row
        interaction: the row panel and the ⋮ menu are appended inside the
        row, and CSS :active matches the pressed element plus every
        ancestor, so a press on any panel/menu control would otherwise
        light the owner row.
        """
        css = read_css("foliplus/css/LayerControl/row.css")
        flat = re.sub(r"\s+", " ", css)
        # The press wash is the row's own :active — not a panel or menu press.
        assert "background: var(--foliplus-accent-soft-bg)" in flat
        assert re.search(r":not\(\s*:has\(\.foliplus-row-panel :active", flat), (
            "row :active wash must carve out row-internal overlays"
        )
        # Locate the press-wash rule block (the :active selector that owns
        # accent-soft-bg), not the first occurrence of the token anywhere.
        m = re.search(
            r":not\(\s*:has\(\.foliplus-row-panel :active[^}]*?accent-soft-bg[^}]*?\}",
            flat,
        )
        assert m, "press-wash rule not found"
        assert "scale" not in m.group(0)
        assert "transition" not in m.group(0)

    def test_fold_btn_hover_bidirectional_preview(self):
        """Fold button shows bidirectional preview across hover and the arrow/Tab cursor.

        Keyed on :is(:hover, .foliplus-is-focused-row) so the fold icon wakes up
        identically to the Row-cursor recipe. Tab focus is not a CSS trigger —
        the focusin delegate maps it onto the same JS class.
        """
        css = read_css("foliplus/css/LayerControl/index.css")
        wake = "is(:hover, .foliplus-is-focused-row)"
        # Expanded row interaction: black → red (preview folded)
        assert "foliplus-layer-toggle-all:not(.foliplus-layer-folded):is(" in css
        assert wake in css
        assert "color: var(--foliplus-accent-primary)" in css
        # Folded row interaction: red → black (preview expanded)
        assert "foliplus-layer-toggle-all.foliplus-layer-folded:is(" in css
        assert "color: var(--foliplus-text-primary)" in css

    def test_fold_btn_background_transition(self):
        """Fold button transitions color and transform (background removed — no bg to transition)."""
        css = read_css("foliplus/css/LayerControl/index.css")
        # Find the base fold-btn rule (not the folded or hover variants)
        idx = css.find(".foliplus-layer-fold-btn {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        # Find the transition property value (between "transition:" and the next property)
        t_idx = block.find("transition:")
        assert t_idx != -1, "transition property not found"
        t_end = block.find("\n  }", t_idx)
        trans_val = block[t_idx:t_end]
        assert "background var(--foliplus-transition-fast)" not in trans_val
        assert "color var(--foliplus-transition-fast)" in trans_val
        assert "transform var(--foliplus-transition-fast)" in trans_val

    def test_fold_btn_svg_fill_none(self):
        """fold-btn svg rule includes fill:none so chevrons render as outlines."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "svg {" in css
        assert "fill: none" in css

    def test_drag_handle_block_and_size(self):
        """drag-handle is a block sized to the checkbox so its dot grip centers
        with the other row glyphs; no bold stroke (dots match MORE at 3px)."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert ".drag-handle" in css
        assert "display: block" in css
        assert "width: var(--foliplus-space-xl)" in css
        assert "height: var(--foliplus-space-xl)" in css

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        html = render_control(LayerControl())
        assert "type-icon-col" in html

    # ── Drag-over animation tests ──

    def test_drag_pulse_css_keyframes(self):
        """CSS defines drag-pulse keyframes with variable-driven values."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "@keyframes foliplus-drag-pulse" in css
        assert "var(--foliplus-drag-border-from" in css
        assert "var(--foliplus-drag-border-to" in css
        assert "var(--foliplus-drag-shadow-from" in css
        assert "var(--foliplus-drag-shadow-to" in css

    def test_drag_over_css_variables(self):
        """Drag-over drop indicators use CSS custom properties for all parameters."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "--foliplus-drag-border-width" in css
        assert "--foliplus-drag-top-shadow" in css
        assert "--foliplus-drag-bottom-shadow" in css
        assert "--foliplus-drag-pulse-count" in css
        assert "--foliplus-motion-slow" in css

    def test_focus_glow_reads_motion_quick(self):
        """The focus-pane glow entrance reads its duration from the motion
        ladder."""
        css = read_css("foliplus/css/LayerControl/index.css")
        assert "animation: foliplus-focus-glow-in var(--foliplus-motion-quick)" in css

    # ── Indeterminate checkbox (partial selection) styles ──

    def test_indeterminate_css_style_present(self):
        """:indeterminate CSS style exists for partial selection state."""
        # Only LayerControl renders this checkbox (CONST.CLASSES.CHECKBOX), so
        # the component is not shared and the rule stays in its own stylesheet.
        css = read_css("foliplus/css/LayerControl/index.css")
        assert ":indeterminate" in css
        assert ":indeterminate::after" in css
        # Should use a dash/minus icon (not a checkmark)
        assert "x1='6' y1='12' x2='18' y2='12'" in css

    def test_no_rebuild_flash_transitions_on_rebuilt_elements(self):
        """renderInitialList() destroys and re-creates every panel element on a
        fold click. Any element whose rebuild changes a transitioned property
        MUST NOT transition that property — otherwise it animates from its
        initial state to the target state, producing a flash:

          - checkbox: bg var(--foliplus-input-bg) -> var(--foliplus-accent-primary);
                      border var(--foliplus-input-border) -> var(--foliplus-accent-primary)
          - layer item (.foliplus-active): bg var(--foliplus-surface) -> var(--foliplus-accent-light)
          - toggle-all row: same mechanism if its bg ever changes on rebuild

        Transitions are kept only on properties that do not change on rebuild
        (box-shadow) or where the element survives the rebuild (hover,
        drag-over, :focus-visible)."""
        by_source = [
            (
                "foliplus/css/LayerControl/index.css",
                [
                    (
                        'input[type="checkbox"]',
                        ["background-color", "border-color"],
                        ["box-shadow"],
                    ),
                    (
                        ".foliplus-layer-sep.foliplus-layer-toggle-all",
                        ["background-color", "border-color"],
                        [],
                    ),
                    (
                        ".foliplus-layer-item",
                        ["background-color", "border-color"],
                        [],
                    ),
                    (
                        ".foliplus-layer-more-btn",
                        ["color"],
                        [],
                    ),
                ],
            ),
        ]
        for css_path, targets in by_source:
            css = read_css(css_path)
            for sel, must_not, may in targets:
                self._assert_no_bg_transition(css, sel, must_not, may)

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

    def test_focus_hide_rule_excludes_active_basemap(self):
        """The focus-mode hide rule keeps the active basemap visible via a dedicated tag.

        The rule ``.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane):not(.foliplus-focus-basemap)``
        excludes both the focused layer's pane (``.foliplus-focus-pane``) and
        the active basemap pane (``.foliplus-focus-basemap``, topmost base
        layer that is effectiveShown). Without the active-basemap exclusion,
        the basemap pane is hidden along with the other layers, and the map
        container's grey background shows through. A separate ``opacity`` rule
        dims the active basemap toward the map container's background color so
        it reads as a faint backdrop behind the focused layer.
        """
        css = read_css("foliplus/css/LayerControl/index.css")
        # The rule spans multiple lines in source; check the two :not()
        # exclusions appear together on the same rule (matched by the
        # `visibility: hidden` body).
        marker = ".foliplus-focus-pane):not(.foliplus-focus-basemap)"
        assert marker in css, (
            "the focus-mode hide rule must exclude both the focused layer's "
            f"pane and the active basemap pane: {marker}"
        )
        # The body of the rule must still apply visibility:hidden — the
        # exclusion is an :not(), not a property flip.
        rule_body = _rule(css, marker)
        assert "visibility: hidden" in rule_body, (
            "the focus-mode hide rule must still set visibility: hidden on "
            f"the panes it matches: {rule_body}"
        )
        # The active basemap must be dimmed via `opacity` — the pane blends toward
        # the map container's background color, so the basemap reads as a faint
        # backdrop. Assert on the property name and the token reference rather
        # than the exact value: the specific strength is a tuning dial.
        dim_marker = ".foliplus-is-focus-mode .foliplus-focus-basemap"
        assert dim_marker in css, (
            f"the focus-mode dim rule must target the active basemap via {dim_marker}"
        )
        dim_body = _rule(css, dim_marker)
        assert "opacity" in dim_body, (
            f"the active basemap must be dimmed with `opacity`: {dim_body}"
        )
        assert "var(--foliplus-alpha-30)" in dim_body, (
            "the active basemap dim rule must reference the shared alpha scale "
            f"--foliplus-alpha-30: {dim_body}"
        )
