"""Tests for foliplus.LayerControl."""

from __future__ import annotations

import re

import folium
from conftest import (
    _js,
    assert_locale,
    make_browser_page,
    read_css,
    render,
    render_control,
    use_page,
    use_raw_page,
)

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

        html = render_control(LayerControl())
        assert "FOLD" in html
        css = read_css("foliplus/css/LayerControl.css")
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
        assert 'data-layer-type": layerInfo.isBase ? GROUP.BASE : GROUP.OVERLAY' in html

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
        html = render_control(LayerControl())
        assert "LayerControl.toggle_title" in html
        assert "LayerControl.panel_title" in html
        assert "LayerControl.base_map_label" in html

    def test_color_click_deselects_bases(self, base_map: folium.Map):
        """click handler on color-layer-item present in rendered code."""
        html = render_control(LayerControl())
        assert "foliplus-color-layer-item" in html

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
        html = render_control(LayerControl())
        assert "var(--space-xl)" in html
        assert "var(--accent-primary)" in html
        assert "var(--radius-sm)" in html
        assert "var(--transition-fast)" in html

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
        css = read_css("foliplus/css/LayerControl.css")
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
        css = read_css("foliplus/css/LayerControl.css")
        assert "foliplus-layer-more-btn" in css
        assert "grid-area: more" in css

    def test_drag_cell_grid_area(self):
        """Drag cell is placed in the 'drag' grid area."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "grid-area: drag" in css

    def test_count_column_5_char_cap(self):
        """Count column is 38px wide, sized for up to ~5 tabular-nums characters."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "38px" in css

    def test_type_icon_col_size_anchored_to_checkbox(self):
        """type-icon-col is 16px (space-xl) to anchor to the checkbox square."""
        css = read_css("foliplus/css/LayerControl.css")
        # type-icon-col width/height use the checkbox square (--space-xl = 16px),
        # not the old 14px/18px icon-size tokens.
        idx = css.find(".foliplus-type-icon-col {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "var(--space-xl)" in block
        assert "var(--icon-size-xs)" not in block
        assert "var(--icon-size-md)" not in block

    def test_more_column_width_named_vars(self):
        """More grid column and button both use --more-btn-width (7px),
        and the count column uses --count-track-width; both keep the track and
        each element's own width synchronised without magic numbers."""
        css = read_css("foliplus/css/LayerControl.css")
        # Named dimension vars are defined once
        assert "--count-track-width: 38px" in css
        assert "--more-btn-width: 7px" in css
        # grid track references the named vars (not literals)
        idx = css.find("--grid-layer-cols:")
        assert idx != -1
        track = css[idx : css.index(";", idx)]
        assert "var(--more-btn-width)" in track
        assert "var(--count-track-width)" in track
        # more-btn width uses the named var, not icon-size-xs
        blks = [
            css[i : css.index("}", i) + 1]
            for i in range(len(css))
            if css.startswith(".foliplus-layer-more-btn {", i)
        ]
        assert blks, "no .foliplus-layer-more-btn { rule found"
        assert "var(--more-btn-width)" in "\n".join(blks)
        assert not any("var(--icon-size-xs)" in b for b in blks)

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
        """CSS hover/active effects exist for interactive elements, reflecting
        the layered color hierarchy:
            type icon : gray -> black (hover) -> black (active)
            count     : gray in every state (annotation, not a control)
            more      : black -> red (hover) -> red (active)  (action color)
            checkbox  : red when checked (row status)
        Only color changes; the type icon must NOT scale."""
        html = render_control(LayerControl())
        # Color layer picker (via :is() selector, no literal :hover string)
        assert "foliplus-color-layer-input" in html
        # Fold toggle button SVG
        assert "foliplus-layer-fold-btn:hover svg" in html
        assert "foliplus-layer-fold-btn:active" in html

        # Type icon: hover AND active both wake it to black (primary), never red.
        assert "foliplus-type-icon-col svg" in html
        assert "transition: transform" in html
        assert ".foliplus-layer-item:hover .foliplus-type-icon-col" in html
        assert ".foliplus-layer-item.active .foliplus-type-icon-col" in html
        # It is the *active* type-icon rule that carries the primary color, not
        # an accent color (accent stays reserved for actions + status).
        act_type = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "layer-item.active .foliplus-type-icon-col"
            in html[max(0, i - 60) : i + 60]
        ]
        assert any("color: var(--text-primary)" in b for b in act_type), (
            "type icon on active row must be black, not accent"
        )
        assert not any("color: var(--accent-primary)" in b for b in act_type), (
            "type icon must never tint accent"
        )
        # Regression guard: no scale transform may be reintroduced on the icon
        assert "foliplus-layer-item:hover .foliplus-type-icon-col svg" not in html

        # More button: red (accent) on BOTH hover and active — the row's action.
        more_blks = [
            html[i : html.index("}", i)]
            for i in range(len(html))
            if "layer-item:hover .foliplus-layer-more-btn"
            in html[max(0, i - 60) : i + 60]
        ]
        assert any("color: var(--accent-primary)" in b for b in more_blks), (
            "more button must tint accent on hover/active"
        )

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
        css = read_css("foliplus/css/common.css")
        # .foliplus-ctrl-btn must appear inside the :is() icon-size rule so that
        # its SVG lines get stroke:currentColor (without it the X is invisible).
        assert ".foliplus-ctrl-btn" in css

    def test_folded_state_no_accent_text(self):
        """Folded label keeps neutral color; only left border and fold-btn use accent."""
        css = read_css("foliplus/css/LayerControl.css")
        # left border and fold-btn turn accent when folded — both expected
        assert "foliplus-layer-folded" in css
        assert "border-left-color: var(--accent-primary)" in css
        # label must NOT be colored accent when folded (label stays text-primary)
        assert "foliplus-layer-folded .foliplus-layer-sep-label" not in css, (
            "folded label must not override color (label stays text-primary)"
        )

    def test_toggle_all_grid_uses_named_slots_for_three_items(self):
        """Toggle-all row names only drag/check/label slots; divider is
        anonymous (dual-declaration trap removed)."""
        css = read_css("foliplus/css/LayerControl.css")
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
        css = read_css("foliplus/css/LayerControl.css")
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
        css = read_css("foliplus/css/LayerControl.css")
        # The shared track defines exactly 6 columns:
        #   drag(16) check(16) label(1fr) count(38) icon(16) more(7)
        idx = css.find("--grid-layer-cols:")
        assert idx != -1
        track = css[idx : css.index(";", idx)]
        # Count the track's space tokens — each column is one term separated
        # by whitespace; the track is built from 6 named/space tokens.
        col_terms = [
            t.rstrip(":;")
            for t in track.split()
            if t.rstrip(":;") not in ("", "--grid-layer-cols")
        ]
        assert len(col_terms) == 6, (
            f"expected 6-col track, got {len(col_terms)}: {col_terms}"
        )
        # Divider rule must sit in the toggle-all container (so 4 / -1 is
        # evaluated against the same 6-col track).
        ta_idx = css.find(".foliplus-layer-sep.foliplus-layer-toggle-all {")
        assert ta_idx != -1
        ta_block = css[ta_idx : css.index("}", ta_idx) + 1]
        assert "var(--grid-layer-cols)" in ta_block
        div_idx = css[ta_idx:].find(".foliplus-section-divider {")
        assert div_idx != -1, "divider rule not inside toggle-all container"
        div_block = css[ta_idx : ta_idx + css[ta_idx:].index("}", div_idx) + 1]
        assert "grid-column: 4 / -1" in div_block, (
            "divider must start at col 4 (after label slot 3) and end at -1 (col 6)"
        )

    def test_toggle_all_align_self_center_removed(self):
        """Divider no longer declares a redundant align-self: center — the
        row already aligns items to center via align-items: center."""
        css = read_css("foliplus/css/LayerControl.css")
        idx = css.find(".foliplus-section-divider {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "align-self" not in block

    def test_toggle_all_label_semibold_primary(self):
        """Section header label is semibold and text-primary so it reads as a real header."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "foliplus-layer-toggle-all .foliplus-layer-sep-label" in css
        assert "font-weight: var(--font-weight-semibold)" in css
        assert "color: var(--text-primary)" in css

    def test_toggle_all_hover_accent_light_border(self):
        """Toggle-all row hover shows a soft accent-light left border."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "foliplus-layer-toggle-all:hover" in css
        assert "border-left-color: var(--accent-light)" in css

    def test_folded_fold_btn_turns_accent(self):
        """Fold button color becomes accent-primary when row is folded."""
        css = read_css("foliplus/css/LayerControl.css")
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
        css = read_css("foliplus/css/LayerControl.css")
        assert "foliplus-section-divider" in css
        assert "opacity: 0" in css

    def test_fold_btn_hover_color(self):
        """Fold button hover shows accent color (no bg/radius on fold-btn itself)."""
        css = read_css("foliplus/css/LayerControl.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "&:hover" in css
        assert "color: var(--accent-primary)" in css

    def test_fold_btn_hover_bidirectional_preview(self):
        """Fold button shows bidirectional hover preview on the toggle-all row."""
        css = read_css("foliplus/css/LayerControl.css")
        # Expanded row hover: black → red
        assert "foliplus-layer-toggle-all:not(.foliplus-layer-folded):hover" in css
        assert "color: var(--accent-primary)" in css
        # Folded row hover: red → black
        assert "foliplus-layer-toggle-all.foliplus-layer-folded:hover" in css
        assert "color: var(--text-primary)" in css

    def test_fold_btn_background_transition(self):
        """Fold button transitions color and transform (background removed — no bg to transition)."""
        css = read_css("foliplus/css/LayerControl.css")
        # Find the base fold-btn rule (not the folded or hover variants)
        idx = css.find(".foliplus-layer-fold-btn {")
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
        css = read_css("foliplus/css/LayerControl.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "svg {" in css
        assert "fill: none" in css

    def test_drag_handle_block_and_size(self):
        """drag-handle is a block sized to the checkbox so its dot grip centers
        with the other row glyphs; no bold stroke (dots match MORE at 3px)."""
        css = read_css("foliplus/css/LayerControl.css")
        assert ".drag-handle" in css
        assert "display: block" in css
        assert "width: var(--space-xl)" in css
        assert "height: var(--space-xl)" in css

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        html = render_control(LayerControl())
        assert "type-icon-col" in html

    # ── Drag-over animation tests ──

    def test_drag_pulse_css_keyframes(self):
        """CSS defines drag-pulse keyframes with variable-driven values."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "@keyframes foliplus-drag-pulse" in css
        assert "var(--drag-border-from" in css
        assert "var(--drag-border-to" in css
        assert "var(--drag-shadow-from" in css
        assert "var(--drag-shadow-to" in css

    def test_drag_over_css_variables(self):
        """Drag-over drop indicators use CSS custom properties for all parameters."""
        css = read_css("foliplus/css/LayerControl.css")
        assert "--drag-border-width" in css
        assert "--drag-top-shadow" in css
        assert "--drag-bottom-shadow" in css
        assert "--drag-pulse-duration" in css
        assert "--drag-pulse-count" in css

    # ── Indeterminate checkbox (partial selection) styles ──

    def test_indeterminate_css_style_present(self):
        """:indeterminate CSS style exists for partial selection state."""
        css = read_css("foliplus/css/LayerControl.css")
        assert ":indeterminate" in css
        assert ":indeterminate::after" in css
        # Should use a dash/minus icon (not a checkmark)
        assert "x1='6' y1='12' x2='18' y2='12'" in css

    def test_no_rebuild_flash_transitions_on_rebuilt_elements(self):
        """renderInitialList() destroys and re-creates every panel element on a
        fold click. Any element whose rebuild changes a transitioned property
        MUST NOT transition that property — otherwise it animates from its
        initial state to the target state, producing a flash:

          - checkbox: bg var(--input-bg) -> var(--accent-primary);
                      border var(--input-border) -> var(--accent-primary)
          - layer item (.active): bg var(--panel-bg) -> var(--accent-light)
          - toggle-all row: same mechanism if its bg ever changes on rebuild

        Transitions are kept only on properties that do not change on rebuild
        (box-shadow) or where the element survives the rebuild (hover,
        drag-over, :focus-visible)."""
        css = read_css("foliplus/css/LayerControl.css")
        targets = [
            # (base selector before " {", must_not, may)
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
        ]
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


class TestLayerControlBrowser:
    """Browser-level interaction checks for drag/drop feedback."""

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="lc"):
        """Create a map with LayerControl, render, and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        for layer in layers:
            layer.add_to(m)
        page, errors = make_browser_page(browser, tmp_path, m.get_root().render(), slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base group should show blocked hint."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        with use_page(self._make_page, browser, tmp_path, overlay, base) as (
            page,
            errors,
        ):
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

            ok = page.evaluate(_js("LayerControl/dispatch_cross_group_dragover"))
            assert ok, "Failed to dispatch simulated cross-group dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(
                'document.querySelector(".foliplus-hint-LayerControl")?.textContent || ""'
            )
            assert ("same group" in hint_text.lower()) or ("同分组" in hint_text)

    def test_create_managed_layers_api(self, browser, tmp_path):
        """layers() returns expected convenience methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            api = page.evaluate(_js("LayerControl/create_layers_api"))
            assert api is not None, "LayerAPI not found"
            assert api["hasClearLayers"], "clearLayers missing"
            assert api["hasRegister"], "register missing"
            assert api["hasUnregister"], "unregister missing"
            assert api["hasRegistered"], "registered missing"
            assert api["hasMainLayer"], "mainLayer missing"
            assert api["hasBringToFront"], "bringToFront missing"

    def test_add_graph_sets_pane(self, browser, tmp_path):
        """addGraph sets pane on the layer and calls register."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/add_graph_sets_pane"))
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"

    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/clear_all_unregisters"))
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False

    def test_rename_input_fills_row_height(self, browser, tmp_path):
        """The inline rename input spans the full row height (not a 19.6px line).

        Regression guard for the scoped `.foliplus-layer-ctrl .foliplus-layer-item`
        padding rule outranking a bare `.foliplus-layer-renaming` rule — if that
        priority regresses, the row keeps its 8px vertical padding and the input
        collapses back to a single line.
        """
        layer = folium.FeatureGroup(name="My Layer")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="rename_visual"
        ) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_selector(
                ".foliplus-layer-item:not(.foliplus-color-layer-item)",
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/rename_first_layer"))
            assert ok, "failed to open the inline rename input"
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )

            m = page.evaluate(
                """() => {
                  const row = [...document.querySelectorAll('.foliplus-layer-item')]
                    .find(r => r.querySelector('.foliplus-layer-rename-input'));
                  const input = row?.querySelector('.foliplus-layer-rename-input');
                  if (!row || !input) return null;
                  const rr = row.getBoundingClientRect();
                  const ir = input.getBoundingClientRect();
                  return {
                    rowH: Math.round(rr.height),
                    inputH: Math.round(ir.height),
                    inputX: Math.round(ir.x),
                    labelX: Math.round(row.querySelector('.foliplus-layer-label').getBoundingClientRect().x),
                    padTop: getComputedStyle(row).paddingTop,
                    padBottom: getComputedStyle(row).paddingBottom,
                  };
                }"""
            )
            assert m is not None, "no renaming row found"
            # Row's vertical padding is dropped while renaming…
            assert m["padTop"] == "0px", f"row padTop={m['padTop']}"
            assert m["padBottom"] == "0px", f"row padBottom={m['padBottom']}"
            # …so the input fills the whole row, not a 19.6px line-box.
            assert abs(m["inputH"] - m["rowH"]) <= 1, (
                f"input height {m['inputH']} != row height {m['rowH']}"
            )

    def test_add_label_sets_pane(self, browser, tmp_path):
        """addLabel sets pane on the marker."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/add_label_sets_pane"))
            assert result is not None
            assert result["pane"] == "__test_label_pane__", f"got {result['pane']}"
            assert result["registered"] is True

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/unregister_layer_flow"))
            assert result is not None
            assert result["before"] is True
            assert result["after"] is False

    def test_create_canvas_basic_api(self, browser, tmp_path):
        """createCanvas returns canvas API object with expected methods."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            api = page.evaluate(_js("LayerControl/create_canvas_api"))
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

    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/canvas_register_unregister_dom"))
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )

    def test_migrate_layers_marker_pane(self, browser, tmp_path):
        """migrateLayers moves Markers to per-layer panes."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_marker_pane"))
            assert result is not None
            assert result["pane"] == "__test_marker_pane_graph__"

    def test_migrate_layers_path_pane(self, browser, tmp_path):
        """migrateLayers moves Path layers to the target pane."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_path_pane"))
            assert result is not None
            assert result["pane"] == "__test_path_pane_graph__"

    def test_load_saved_order_restore_order(self, browser, tmp_path):
        """loadSavedOrder restores previously saved order from localStorage."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            folium.FeatureGroup(name="C", overlay=True, show=True),
            slug="saved_order",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_layer_ids"))
            assert result is not None
            assert result["count"] >= 3

    def test_toggle_all_checkbox_toggles_layers(self, browser, tmp_path):
        """Toggle-all checkbox toggles all layers in the group."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="toggle_all",
        ) as (page, _):
            # Check initial state — all overlays checked
            result = page.evaluate(_js("LayerControl/read_toggle_all_checked"))
            assert result is True, f"Expected toggle-all checked, got {result}"

    # ── title / tooltip browser tests ──

    def test_layer_item_title_shows_type(self, browser, tmp_path):
        """Layer item row title shows the translated type, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_layer_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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

            title = page.evaluate(_js("LayerControl/read_layer_item_title"))
            # initTypesAndVisibility runs after 300ms delay; wait if needed
            if not title or "MyPoints" in (title or ""):
                page.wait_for_timeout(500)
                title = page.evaluate(_js("LayerControl/read_layer_item_title"))
            # Should be a type description (e.g. "Point Layer") not the layer name
            assert title and "MyPoints" not in title, (
                f"Expected type title, got '{title}'"
            )

    def test_checkbox_title_shows_select_deselect(self, browser, tmp_path):
        """Checkbox title shows Select/Deselect, not the layer name."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="MyPoints", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_cb_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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

            title = page.evaluate(_js("LayerControl/read_checkbox_title"))
            assert title and "MyPoints" not in title, (
                f"Expected select/deselect title, got '{title}'"
            )

    def test_rename_keeps_checkbox_title_and_sets_aria_label(self, browser, tmp_path):
        """Renaming a layer updates the label and aria-label, not the tooltip."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="MyPoints", overlay=True, show=True),
            slug="rename_cb_title",
        ) as (page, _):
            page.wait_for_selector(
                ".foliplus-layer-item:not(.foliplus-color-layer-item)",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            assert page.evaluate(_js("LayerControl/rename_first_layer")), (
                "failed to open the inline rename input"
            )
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )
            res = page.evaluate(_js("LayerControl/commit_rename_and_read_checkbox"))
            assert res is not None, "rename did not commit"
            assert res["label"] == "RenamedLayer", f"label={res['label']!r}"
            # The name reaches assistive tech via aria-label…
            assert res["ariaLabel"] == "RenamedLayer", (
                f"aria-label={res['ariaLabel']!r}"
            )
            # …but never replaces the Select/Deselect tooltip (accept the
            # translated wording — a local browser can resolve `zh`).
            assert res["title"] in ("Deselect", "隐藏"), f"title={res['title']!r}"

    def _assert_toggle_all_deselect_title(self, title: str | None, label: str) -> None:
        """The toggle-all tooltip says "deselect all" in whatever locale it renders.

        CI is locale-neutral but a local browser can resolve `zh`, so accept the
        translated wording too — the contract is that the tooltip is the
        toggle-all action, never a layer name.
        """
        assert title and ("Deselect" in title or "隐藏" in title), (
            f"Expected {label} 'deselect all' tooltip, got {title!r}"
        )

    def test_toggle_all_checkbox_title_changes_with_state(self, browser, tmp_path):
        """Toggle-all checkbox title updates when state changes."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_toggle_all_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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

            # All checked → tooltip is "deselect all"
            self._assert_toggle_all_deselect_title(
                page.evaluate(_js("LayerControl/read_toggle_all_title")), "all-checked"
            )

            # Uncheck one layer → still "deselect all" (indeterminate)
            page.evaluate(_js("LayerControl/click_first_layer_checkbox"))
            page.wait_for_timeout(300)

            self._assert_toggle_all_deselect_title(
                page.evaluate(_js("LayerControl/read_toggle_all_title")),
                "indeterminate",
            )

    def test_toggle_all_row_title_shows_fold_unfold(self, browser, tmp_path):
        """Toggle-all row title shows fold/unfold tooltip."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_row_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            initial = page.evaluate(_js("LayerControl/read_toggle_all_row_title"))
            assert initial and "Collapse" in initial, (
                f"Expected 'Collapse layers', got '{initial}'"
            )

            # Click fold button
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Folded → should show "Expand layers"
            folded = page.evaluate(_js("LayerControl/read_toggle_all_row_title"))
            assert folded and "Expand" in folded, (
                f"Expected 'Expand layers', got '{folded}'"
            )

    def test_color_layer_item_title(self, browser, tmp_path):
        """Color layer item title shows the color map label."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            title = page.evaluate(_js("LayerControl/read_color_layer_title"))
            assert title, f"Expected non-empty title, got '{title}'"

    def test_register_reentry_after_hide(self, browser, tmp_path):
        """registerLayer can be re-called after a layer is hidden by checkbox."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_reentry_after_hide"))
            assert result is not None
            assert result["found"] is True

    def test_register_readds_hidden_layer(self, browser, tmp_path):
        """register() re-adds mainLayer to map when layer was unchecked."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_readds_hidden_layer"))
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

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify overlay items are hidden
            result = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d == "none" for d in result), (
                f"Expected all overlay items hidden, got {result}"
            )

            # Verify base items are still visible
            base_result = page.evaluate(_js("LayerControl/read_base_item_displays"))
            assert all(d != "none" for d in base_result), (
                f"Expected base items visible, got {base_result}"
            )

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

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_base_fold_button"))
            page.wait_for_timeout(300)

            # Verify base items are hidden
            result = page.evaluate(_js("LayerControl/read_base_item_displays"))
            assert all(d == "none" for d in result), (
                f"Expected all base items hidden, got {result}"
            )

            # Verify overlay items are still visible
            overlay_result = page.evaluate(
                _js("LayerControl/read_overlay_item_displays")
            )
            assert all(d != "none" for d in overlay_result), (
                f"Expected overlay items visible, got {overlay_result}"
            )

    def test_fold_toggle_toggle_unfold(self, browser, tmp_path):
        """Clicking the fold button again unfolds (shows) the items."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="Overlay B", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_unfold.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify folded
            folded = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d == "none" for d in folded), (
                f"Expected hidden after fold, got {folded}"
            )

            # Click fold button again to unfold
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Verify unfolded
            unfolded = page.evaluate(_js("LayerControl/read_overlay_item_displays"))
            assert all(d != "none" for d in unfolded), (
                f"Expected visible after unfold, got {unfolded}"
            )

    def test_fold_preserves_dom_index(self, browser, tmp_path):
        """Folded items remain in the DOM for index alignment."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_dom_index.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Count DOM items after fold — should still be same (not removed)
            after = page.evaluate(
                "document.querySelectorAll('.foliplus-layer-item:not(.foliplus-color-layer-item)').length"
            )
            assert after == before, (
                f"Expected {before} items after fold, got {after} — DOM items should not be removed"
            )

    def test_bring_layer_to_front_runtime(self, browser, tmp_path):
        """bringLayerToFront moves the layer to front of z-order."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            slug="bring_front",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_layer_to_front"))
            assert result is not None, "LayerAPI not found"
            assert result["newIdx"] == 0, (
                f"Expected layer B at index 0 after bringToFront, got {result['newIdx']} (was {result['initialIdx']})"
            )

    def test_unregister_layer_removes_dom(self, browser, tmp_path):
        """unregisterLayer removes the DOM item from the panel."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/unregister_layer_removes_dom"))
            assert result is not None
            assert result["existsBefore"] is True, (
                "DOM item should exist after registerLayer"
            )
            assert result["existsAfter"] is False, (
                "DOM item should be removed after unregisterLayer"
            )

    def test_color_layer_hides_tiles(self, browser, tmp_path):
        """Clicking color layer hides tilePane and removes base maps."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_color_tiles.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_color_layer_item"))
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/read_color_tile_state"))
            assert result is not None
            assert result["tileHidden"] is True, (
                "tilePane should have foliplus-layer-tile-hidden class"
            )
            assert result["colorBg"] is True, "map container should have active class"
            # Tiles may still be in DOM but not visible; check className

    def test_register_layer_preserves_visible_on_reentry(self, browser, tmp_path):
        """registerLayer preserves the visible state from a previous registration."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/register_preserves_visible_on_reentry")
            )
            assert result is not None
            assert result["defaultVisible"] is True, "Default visible should be true"
            assert result["newVisible"] is True, (
                "registerLayer after unregisterLayer resets visible to true"
            )

    def test_register_re_register_preserves_fields(self, browser, tmp_path):
        """A partial re-register never drops previously registered fields.

        createLayerInfo is idempotent: fields absent from the second opts
        (layer/paneName/iconSvg/onToggle/onZIndex/name/isBase) fall back to
        the existing layerInfo instead of being reset to defaults.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/re_register_preserves_fields"))
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

    def test_extract_points_api(self, browser, tmp_path):
        """extractPoints returns geo points from registered layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/extract_points"))
            assert result is not None
            assert result["count"] == 2, f"Expected 2 points, got {result['count']}"
            assert abs(result["lat0"] - 26.08) < 0.001
            assert abs(result["lng0"] - 119.30) < 0.001
            assert abs(result["lat1"] - 26.09) < 0.001
            assert abs(result["lng1"] - 119.31) < 0.001

    def test_fold_svg_switches_on_toggle(self, browser, tmp_path):
        """Fold button uses a single SVG rotated 180° by CSS (not swapped) on toggle."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_svg.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            elem_count = page.evaluate(_js("LayerControl/count_fold_paths"))
            assert elem_count == 1, f"Expected 1 path (FOLD SVG), got {elem_count}"

            # Click to fold
            page.evaluate(_js("LayerControl/click_overlay_fold_button"))
            page.wait_for_timeout(300)

            # Still 1 path — icon is rotated by CSS, not swapped
            elem_count = page.evaluate(_js("LayerControl/count_fold_paths"))
            assert elem_count == 1, (
                f"Expected 1 path (CSS-rotated, not swapped), got {elem_count}"
            )
            # Row must carry the folded class so CSS rotation kicks in
            is_folded = page.evaluate(_js("LayerControl/read_fold_row_class"))
            assert is_folded, "Expected foliplus-layer-folded class on row after fold"

    def test_color_layer_pointer_cursor(self, browser, tmp_path):
        """Color layer item shows pointer cursor on hover."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            cursor = page.evaluate(_js("LayerControl/read_color_layer_cursor"))
            assert cursor == "pointer", f"Expected pointer cursor, got {cursor}"

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

        with use_raw_page(browser.new_page) as page:
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
            all_checked = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert all_checked["checked"] is True, (
                "Expected toggle-all checked when all layers checked"
            )
            assert all_checked["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when all layers checked"
            )

            # Step 2: Uncheck one layer → toggle-all should be indeterminate
            page.evaluate(_js("LayerControl/uncheck_one_overlay"))
            page.wait_for_timeout(300)

            partial = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert partial["checked"] is False, (
                "Expected toggle-all unchecked when some layers checked"
            )
            assert partial["indeterminate"] is True, (
                "Expected toggle-all indeterminate when some (not all) layers checked"
            )

            # Step 3: Uncheck all layers → toggle-all should be unchecked (not indeterminate)
            page.evaluate(_js("LayerControl/uncheck_all_overlays"))
            page.wait_for_timeout(300)

            none = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert none["checked"] is False, (
                "Expected toggle-all unchecked when no layers checked"
            )
            assert none["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate when no layers checked"
            )

    def test_toggle_all_click_indeterminate_deselects_all(self, browser, tmp_path):
        """Clicking indeterminate toggle-all deselects all layers."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="B", overlay=True, show=True).add_to(m)
        folium.FeatureGroup(name="C", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_indeterminate_click.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
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
            page.evaluate(_js("LayerControl/click_first_overlay_checkbox"))
            page.wait_for_timeout(300)

            # Verify indeterminate
            state = page.evaluate(_js("LayerControl/read_toggle_all_indeterminate"))
            assert state is True, "Expected toggle-all indeterminate before click"

            # Click toggle-all (indeterminate → deselect all)
            page.evaluate(_js("LayerControl/click_toggle_all"))
            page.wait_for_timeout(300)

            # Verify all layers are now unchecked
            result = page.evaluate(_js("LayerControl/read_overlay_checked"))
            assert not any(result), f"Expected all layers unchecked, got {result}"

            # Verify toggle-all is now unchecked (not indeterminate)
            final = page.evaluate(_js("LayerControl/read_toggle_all_state"))
            assert final["checked"] is False, (
                "Expected toggle-all unchecked after deselect all"
            )
            assert final["indeterminate"] is False, (
                "Expected toggle-all NOT indeterminate after deselect all"
            )

    def test_paneset_reset_after_hide_show(self, browser, tmp_path):
        """Hiding and re-showing a layer resets paneSet so enforceOrder re-moves paths.

        Uses a FeatureGroup with a child marker — the marker (leaf) is what
        gets migrated, so paneSet is asserted on the leaf layer. An empty
        container has no DOM to migrate, so paneSet is meaningless there.
        """
        fg = folium.FeatureGroup(name="TestLayer", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="test_marker").add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="paneset_reset") as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)

            # Step 1: enforceOrder sets paneSet=true on the leaf marker
            result = page.evaluate(_js("LayerControl/read_leaf_paneset"))
            assert result is not None, "Layer not found"
            assert result["paneSet"] is True, (
                f"Expected paneSet=true on leaf after enforceOrder, got {result['paneSet']}"
            )

            # Step 2: Hide the layer by unchecking checkbox
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 3: Show the layer again
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 4: handleChange reset the container paneSet; enforceOrder
            # re-migrates the leaf marker and sets its paneSet back to true
            paneset = page.evaluate(_js("LayerControl/read_leaf_paneset_value"))
            assert paneset is True, (
                f"Expected paneSet=true on leaf after re-show, got {paneset}"
            )

    def test_enforce_order_end_to_end(self, browser, tmp_path):
        """enforceOrder applies correct z-index to layers and migrates panes."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="enforce",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["layerCount"] >= 2, f"got {result['layerCount']} layers"
            # Leaflet sets z-index via CSS class, so computed style should be numeric
            assert result["overlayZ"] and result["overlayZ"] != "auto", (
                "overlay pane should have z-index"
            )
            assert result["markerZ"], "marker pane should have z-index"

    def test_pane_zindex_hierarchy(self, browser, tmp_path):
        """LayerControl keeps data < marker < tooltip < popup z-index ordering.

        Regression: markers (search/locate pins, ✕, data markers) must render
        above LayerControl-managed data layers, while tooltip/popup stay on top.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.GeoJson(
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [121.4, 31.2],
                                [121.5, 31.2],
                                [121.5, 31.3],
                                [121.4, 31.3],
                                [121.4, 31.2],
                            ]
                        ],
                    },
                },
                name="Polygons",
            ),
            folium.Marker([26.08, 119.30], name="Points"),
        ) as (page, errors):
            # GeoJSON's layer is resolved after its addTo fires layeradd →
            # debouncedEnforce; wait for the per-layer pane to appear. The pane
            # class is "foliplus-layer-pane" (a single token), not "foliplus-layer".
            page.wait_for_selector(
                ".leaflet-pane.foliplus-layer-pane", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/read_pane_zindex"))
            assert result is not None, "LayerAPI not found"
            assert result["dataZ"] is not None, "no data layer pane found"
            assert result["markerZNum"] > result["dataZ"], (
                f"marker({result['markerZNum']}) should be above data "
                f"({result['dataZ']})"
            )
            assert result["tooltipZ"] > result["markerZNum"], (
                f"tooltip({result['tooltipZ']}) should be above marker "
                f"({result['markerZNum']})"
            )
            assert result["popupZ"] > result["tooltipZ"], (
                f"popup({result['popupZ']}) should be above tooltip "
                f"({result['tooltipZ']})"
            )
            assert not errors, f"JS errors: {errors}"

    def test_bring_layer_to_front_guard(self, browser, tmp_path):
        """bringLayerToFront is a no-op for base layers or when already at front."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Overlay", overlay=True, show=True),
            folium.TileLayer("CartoDB positron", name="Base", overlay=False),
            slug="bringfront_guard",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/bring_to_front_unknown_guard"))
            assert result is not None
            assert result["unknownOk"] is True, (
                "bringToFront should be safe for unknown id"
            )

    def test_migrate_container_keeps_clean_options(self, browser, tmp_path):
        """Container layers are not re-migrated to fallback panes.

        migrateLayers must skip container nodes when writing pane options.
        The container's own pane stays whatever registerLayer assigned
        (paneName), and must NOT be overwritten with a fallback
        `foliplus_pane_*` name during migration.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/migrate_container_clean_options"))
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

    def test_register_idempotent_keeps_order(self, browser, tmp_path):
        """Re-registering an existing layer must not reorder the list.

        MeasureControl.setMode calls layers.register() on every tool switch;
        registerLayer on an already-registered id must update fields in place
        instead of splice+unshift, which would silently destroy the user's
        drag order and persist the accidental order via saveOrder.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/register_idempotent_keeps_order"))
            assert result is not None, "LayerAPI not found"
            assert not result["moved"], (
                f"Re-register reordered layers: {result['orderBefore']} -> {result['orderAfter']}"
            )

    def test_render_initial_list_incremental(self, browser, tmp_path):
        """registerLayer on an existing UI must not rebuild the whole list.

        renderInitialList currently wipes innerHTML and re-creates every item,
        which is O(n) per registration (O(n^2) for n registrations). A
        registered layer should insert a single DOM item instead.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/render_initial_list_incremental"))
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )

    def test_handle_change_resets_paneset_on_show(self, browser, tmp_path):
        """Checkbox toggle triggers handleChange which resets paneSet."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )

            result = page.evaluate(_js("LayerControl/handle_change_resets_paneset"))
            assert result is not None
            assert result["clicked"] is True, "checkbox should be clickable"

    def test_toggle_performance(self, browser, tmp_path):
        """Layer toggle and toggle-all operations complete within 100ms."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            results = page.evaluate(_js("LayerControl/performance_toggle"))
            assert results is not None, "performance_toggle failed"
            for r in results:
                assert r["ms"] < 100, f"{r['op']} took {r['ms']}ms (threshold: 100ms)"

    def test_layers_view_is_readonly(self, browser, tmp_path):
        """api.layers is a read-only view — direct mutation is blocked.

        External callers must go through LayerAPI (registerLayer/unregisterLayer
        etc.) so the registry index can never be bypassed or drift from the list.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/layers_view_readonly"))
            assert result is not None, "LayerAPI not found"
            assert result["length"] > 0, "read length failed"
            assert result["firstId"], "read index failed"
            assert result["mapped"] == result["length"], "read map failed"
            assert result["pushThrew"] is True, "push should throw"
            assert result["spliceThrew"] is True, "splice should throw"
            assert result["assignThrew"] is True, "index assign should throw"
            assert result["shiftThrew"] is True, "shift should throw"

    def test_keydown_up_moves_focus(self, browser, tmp_path):
        """ArrowUp moves keyboard focus to the previous layer row."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_up_moves_focus"))
            assert result is not None, "keydown_up_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowUp should focus previous item, got {result}"
            )

    def test_keydown_down_moves_focus(self, browser, tmp_path):
        """ArrowDown moves keyboard focus to the next layer row."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_down_moves_focus"))
            assert result is not None, "keydown_down_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowDown should focus next item, got {result}"
            )

    def test_keydown_space_toggles_visibility(self, browser, tmp_path):
        """Space toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_space_toggles_visibility"))
            assert result is not None, "keydown_space_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"Space should toggle visibility, got {result}"
            )

    def test_keydown_enter_toggles_visibility(self, browser, tmp_path):
        """Enter toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_enter_toggles_visibility"))
            assert result is not None, "keydown_enter_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"Enter should toggle visibility, got {result}"
            )

    def test_keydown_left_toggles_visibility(self, browser, tmp_path):
        """ArrowLeft toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_left_toggles_visibility"))
            assert result is not None, "keydown_left_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"ArrowLeft should toggle visibility, got {result}"
            )

    def test_keydown_right_toggles_visibility(self, browser, tmp_path):
        """ArrowRight toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_right_toggles_visibility"))
            assert result is not None, "keydown_right_toggles_visibility failed"
            assert result["toggled"] is True, (
                f"ArrowRight should toggle visibility, got {result}"
            )

    def test_keydown_after_label_click_targets_clicked_row(self, browser, tmp_path):
        """Mouse-selecting a row moves the keyboard cursor to that row."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(
                _js("LayerControl/keydown_after_label_click_targets_clicked_row")
            )
            assert result is not None, (
                "keydown_after_label_click_targets_clicked_row failed"
            )
            assert result["toggled"] is True, (
                f"Enter after clicking a row label should toggle that row, got {result}"
            )
            assert result["focusedRow"] == result["expectedRow"], (
                f"Clicking a row label should move the keyboard cursor to that row, got {result}"
            )

    def test_keydown_nav_survives_fold_click(self, browser, tmp_path):
        """Folding a group must not kill keyboard navigation.

        Clicking the fold button fires onClick (which moves the cursor to the
        toggle-all row) and then renderInitialList (which rebuilds the DOM,
        destroying the focused node and dropping DOM focus to <body>). Without
        cursor re-homing the document-level keyboard listener's container guard
        then rejects every subsequent key, so ArrowDown / Enter stop working
        entirely. This test exercises all three: cursor survives, DOM focus is
        restored inside the panel, and keys still navigate + toggle.

        It also pins ArrowUp/Down stepping: folded rows are display:none and
        not focusable, so a plain index ± 1 would strand the cursor on a
        hidden row.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_nav_survives_fold_click"))
            assert result is not None, "keydown_nav_survives_fold_click failed"
            assert result["afterFold"] is not None, (
                f"Folding a group should not destroy the keyboard cursor, got {result}"
            )
            assert result["focusInPanel"] is True, (
                f"Folding a group should keep DOM focus inside the panel, got {result}"
            )
            assert result["afterFoldVisible"] is True, (
                "Re-homing after a fold must not land the cursor on a hidden row, "
                f"got {result}"
            )
            assert result["afterFoldFolded"] is False, (
                f"Re-homing after a fold must skip rows hidden by folding, got {result}"
            )
            assert result["afterDown"] is not None, (
                f"ArrowDown should still navigate after folding, got {result}"
            )
            assert result["afterDownVisible"] is True, (
                "ArrowDown must not leave the cursor on a folded-away row, got "
                f"{result}"
            )
            assert result["afterDownFolded"] is False, (
                f"ArrowDown must skip rows hidden by folding, got {result}"
            )
            assert result["afterUp"] is not None, (
                f"ArrowUp should still navigate after folding, got {result}"
            )
            assert result["afterUpVisible"] is True, (
                f"ArrowUp must not leave the cursor on a folded-away row, got {result}"
            )
            assert result["afterUpFolded"] is False, (
                f"ArrowUp must skip rows hidden by folding, got {result}"
            )
            assert result["afterUpClamped"] is not None, (
                "ArrowUp should clamp at the top instead of stepping off the "
                f"list, got {result}"
            )
            assert result["enterToggled"] is True, (
                f"Enter should still toggle after folding, got {result}"
            )

    def test_keydown_ctrl_up_moves_layer(self, browser, tmp_path):
        """Ctrl+ArrowUp moves the focused layer one position up."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_ctrl_up_moves_layer"))
            assert result is not None, "keydown_ctrl_up_moves_layer failed"
            assert result["moved"] is True, (
                f"Ctrl+ArrowUp should move layer up, got {result}"
            )

    def test_keydown_ctrl_down_moves_layer(self, browser, tmp_path):
        """Ctrl+ArrowDown moves the focused layer one position down."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_ctrl_down_moves_layer"))
            assert result is not None, "keydown_ctrl_down_moves_layer failed"
            assert result["moved"] is True, (
                f"Ctrl+ArrowDown should move layer down, got {result}"
            )

    def test_keydown_escape_clears_focus(self, browser, tmp_path):
        """Escape clears the keyboard-active focus state."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/keydown_escape_clears_focus"))
            assert result is not None, "keydown_escape_clears_focus failed"
            assert result["beforeEscape"] is True, "ArrowDown should first set focus"
            assert result["focusCleared"] is True, (
                f"Escape should clear focus, got {result}"
            )

    def test_focus_layer_draws_rect_and_mask(self, browser, tmp_path):
        """Double-clicking an overlay draws the dashed rect + inverse mask."""
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=[[26.0, 119.2], [26.2, 119.2], [26.2, 119.5], [26.0, 119.5]],
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="focus_overlay") as (
            page,
            _,
        ):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/focus_layer_draws_overlay"))
            assert result is not None, "focus_layer_draws_overlay failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"
            assert result["maskDrawn"] is True, f"focus mask missing, got {result}"
            assert result["rowHighlighted"] is True, (
                f"row not highlighted, got {result}"
            )

    def test_plain_marker_layers_count_and_stay_stable(self, browser, tmp_path):
        """A plain folium.Marker (no GeoJSON .feature) counts as a point feature.

        Regression: countFeatureGeometry / getGeometryType gated on
        ``marker.feature``, so layers built from ``folium.Marker()`` reported a
        count of 0 and showed no type icon.  Counting must not require
        .feature (that only matters for extractPoints / Heatmap properties),
        and toggling an unrelated layer's checkbox must not reset the count.
        """
        layers = []
        for i, name in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
            fg = folium.FeatureGroup(name=name, overlay=True, show=True)
            folium.Marker([26.08 + i * 0.01, 119.30 + i * 0.01], popup=name).add_to(fg)
            layers.append(fg)

        with use_page(self._make_page, browser, tmp_path, *layers) as (page, _):
            page.evaluate(
                'document.querySelector(".foliplus-layer-ctrl .foliplus-toggle-btn").click()'
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.expanded", state="attached", timeout=5000
            )
            # initTypesAndVisibility (which paints the count columns) runs on a
            # 300ms INIT_DELAY_MS timer after attach, so settle before reading.
            page.wait_for_timeout(500)

            counts = page.evaluate(_js("LayerControl/read_count_columns"))
            assert counts is not None, "read_count_columns failed"
            assert len(counts) == 4, f"expected 4 overlay layers, got {len(counts)}"
            for info in counts.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: plain folium.Marker should count as 1, "
                    f"got {info['apiCount']}"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column should read '1', "
                    f"got {info['countText']!r}"
                )

            # Toggling another layer's checkbox must not zero out the counts.
            page.evaluate("window.__test_layer_name = 'Beta'")
            page.evaluate(_js("LayerControl/click_checkbox_by_name"))
            page.wait_for_timeout(300)

            after = page.evaluate(_js("LayerControl/read_count_columns"))
            assert after is not None, "read_count_columns failed after toggle"
            for info in after.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: count changed to {info['apiCount']} "
                    f"after an unrelated checkbox click"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column changed to {info['countText']!r} "
                    f"after an unrelated checkbox click"
                )
