"""Split of test_rendering.py: TestLayerControlRendering part 2."""

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

    def test_role_divider_lives_in_the_label_column_flex_cell(self):
        """The role divider is not a grid item: it sits inside .foliplus-role-head,
        one flex cell in the label column, so it starts at the name's edge and
        takes the rest of the column. As a second grid item in the same column
        it overlapped the name (measured left 68 against a name spanning 56-98)."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        head_idx = css.find(".foliplus-role-head {")
        assert head_idx != -1, "no .foliplus-role-head rule"
        head = css[head_idx : css.index("}", head_idx) + 1]
        assert "grid-column: 3" in head, "the head owns the label column"
        assert "display: flex" in head
        div_idx = css.find(".foliplus-role-head .foliplus-role-divider {")
        assert div_idx != -1, "no role-divider rule inside the head"
        div = css[div_idx : css.index("}", div_idx) + 1]
        assert "flex: 1" in div, "the divider takes the rest of the column"
        assert "margin: 0" in div, (
            "the shared divider's panel inset must be cancelled inside the head"
        )
        # The pre-folder rule that placed a divider by grid-column is gone: the
        # role row owns count/icon/more now, so nothing spans 4 / -1.
        assert "grid-column: 4 / -1" not in css

    def test_role_divider_cannot_overflow_the_track(self):
        """The divider is a flex child of the label cell, not a grid item, so it
        cannot be pushed to an implicit row when the anonymous slot count
        changes — the failure mode the old grid-column: 4 / -1 rule guarded
        against by hand."""
        token_css = read_css("foliplus/css/common/token.css")
        layer_css = read_css("foliplus/css/control/LayerControl/index.css")
        # The shared track still defines the row's columns; the head is one cell.
        idx = token_css.find("--foliplus-grid-layer-cols:")
        assert idx != -1
        track = token_css[idx : token_css.index(";", idx)]
        body = track.split(":", 1)[1]
        col_terms: list[str] = []
        depth = 0
        current = ""
        for ch in body:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch.isspace() and depth == 0:
                if current:
                    col_terms.append(current)
                    current = ""
                continue
            current += ch
        if current:
            col_terms.append(current)
        assert len(col_terms) == 6, (
            f"expected 6-col track, got {len(col_terms)}: {col_terms}"
        )
        # The 4th column is the bounded count track, not a single fixed width.
        assert "minmax(" in col_terms[3] and "count-track" in col_terms[3], (
            f"count column must be a bounded minmax track, got {col_terms[3]!r}"
        )
        # The toggle-all row still uses that track.
        ta_idx = layer_css.find(".foliplus-layer-sep.foliplus-layer-toggle-all {")
        assert ta_idx != -1
        ta_block = layer_css[ta_idx : layer_css.index("}", ta_idx) + 1]
        assert "var(--foliplus-grid-layer-cols)" in ta_block
        # The divider is placed by flex, never by the grid.
        head_idx = layer_css.find(".foliplus-role-head {")
        assert head_idx != -1
        head = layer_css[head_idx : layer_css.index("}", head_idx) + 1]
        assert "min-width: 0" in head, "the flex cell must be allowed to shrink"
        div_idx = layer_css.find(".foliplus-role-head .foliplus-role-divider {")
        assert div_idx != -1
        div = layer_css[div_idx : layer_css.index("}", div_idx) + 1]
        assert "min-width: 0" in div
        assert "grid-column" not in div and "grid-area" not in div, (
            "the divider must not be placed on the grid at all"
        )

    def test_toggle_all_align_self_center_removed(self):
        """Divider no longer declares a redundant align-self: center — the
        row already aligns items to center via align-items: center."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        idx = css.find(".foliplus-section-divider {")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "align-self" not in block

    def test_toggle_all_label_semibold_primary(self):
        """Section header label is semibold and text-primary so it reads as a real header."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "foliplus-layer-toggle-all .foliplus-layer-sep-label" in css
        assert "font-weight: var(--foliplus-font-weight-semibold)" in css
        assert "color: var(--foliplus-text-primary)" in css

    def test_toggle_all_hover_shares_row_cursor_recipe(self):
        """Toggle-all row joins the shared Row-cursor recipe: hover uses
        accent-primary (not accent-light) and the fold row cannot drift into a
        private hover style anymore."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        # The recipe's :is() leads with the panel-hover carve-out. Pin the
        # exact (whitespace-stripped) recipe shape — the old bare
        # "is(:hover, .foliplus-is-focused-row)" now matches the base-row quiet
        # rule (which keeps the old :is form) and would not point at the recipe.
        # Whitespace-stripped: a Prettier/PostCSS reflow of the compound
        # selector (newlines, or a space after `is(` / before `)`) must
        # not break the shape match below. The spacey form (e.g. `is( :hover`) is a
        # whitespace artifact and not part of the selector's meaning.
        flat = re.sub(r"\s+", "", css)
        recipe_mark = (
            "is(:hover:where(:not(:has(.foliplus-row-panel:hover))),"
            ".foliplus-is-focused-row)"
        )
        assert recipe_mark in flat, "Row-cursor recipe shape not found"
        # The toggle-all row joins the SAME compound selector that carries this
        # recipe (the &:is() parent), so it cannot drift into a private hover.
        recipe_at = flat.index(recipe_mark)
        group_start = flat.rfind(".foliplus-row,", 0, recipe_at)
        assert group_start != -1, "Row-cursor compound selector not found"
        group_end = flat.index("{", group_start)
        group = flat[group_start:group_end]
        assert ".foliplus-layer-sep.foliplus-layer-toggle-all" in group, (
            "toggle-all row must share the Row-cursor recipe's selector group"
        )
        # The role header joins by the row identity class: it is deliberately
        # NOT a .foliplus-layer-item, so the recipe selector is the identity,
        # and every row kind carries it.
        assert "is(:hover,:focus-visible,.foliplus-is-focused-row)" not in flat
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
        css = read_css("foliplus/css/control/LayerControl/index.css")
        overlay_list = ".foliplus-layer-more-menu.open, .foliplus-row-panel"
        assert f".foliplus-row:has({overlay_list})" in css, (
            "the lift must key on the more-menu AND the row-panel shell"
        )
        # The role row joins by the row identity class (it is deliberately not
        # a .foliplus-layer-item), so one leg covers every row kind.
        assert "z-index: var(--foliplus-z-index-floating)" in css
        # The ⋮ dropdown anchors flush to its row — the shared shell adds a 2px
        # margin-top that would open a sliver of list under the cursor path;
        # The shell declares the whole margin (not just margin-top) so a host
        # framework's bare `ol,ul` margin reset cannot leak a bottom gap.
        assert "margin: 0" in css

    def test_folded_fold_btn_turns_accent(self):
        """Fold button color becomes accent-primary when row is folded.

        The folded paint is shared by every row kind that can fold (folder row,
        role header), so it lives in the shared row-cell block instead of a
        per-row-kind rule.
        """
        css = read_css("foliplus/css/control/LayerControl/index.css")
        idx = css.find("&.foliplus-layer-folded {")
        assert idx != -1, "shared folded rule not found"
        block = css[idx : css.index("\n    }", idx)]
        assert ".foliplus-layer-fold-btn" in block
        assert "var(--foliplus-accent-primary)" in block

    def test_section_divider_fades_when_folded(self):
        """Section divider fades to opacity 0 when the role is folded."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
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

    def test_slider_component_css(self):
        """One shared slider primitive carries the whole geometry.

        The rail, fill, marks, thumbs, numbers and the value bubble live in
        common/slider.css; a row adds only its own hook class. The geometry is
        expressed against one track box — the rail, the marks layer and the
        thumbs all anchor to its centre line — so dots and thumbs line up by
        construction instead of by a pixel compensation token.
        """
        css = read_css("foliplus/css/common/slider.css")
        tokens = read_css("foliplus/css/common/token.css")
        for name in (
            ".foliplus-slider {",
            ".foliplus-slider-track",
            ".foliplus-slider-rail",
            ".foliplus-slider-fill",
            ".foliplus-slider-marks",
            ".foliplus-slider-dot",
            ".foliplus-slider-thumb",
            ".foliplus-slider-values",
            ".foliplus-slider-bubble",
        ):
            assert name in css, name
        for token in (
            "--foliplus-slider-rail-height",
            "--foliplus-slider-thumb-size",
            "--foliplus-slider-dot-size",
            "--foliplus-slider-thumb-ring",
        ):
            assert token in tokens, token
        # Geometry comes from the shared tokens, never from literal sizes.
        assert (
            "var(--foliplus-slider-rail-height) + 2 * var(--foliplus-border-thin)"
            in css
        )
        assert "width: var(--foliplus-slider-thumb-size)" in css
        assert "width: var(--foliplus-slider-dot-size)" in css
        assert "var(--foliplus-slider-rail-pattern)" in css
        # The uncovered span is a checkerboard, not a flat tint.
        assert "repeating-conic-gradient" in tokens
        # Alignment is structural: one track box, three layers on its centre
        # line. The retired implementation needed a pixel offset token; its
        # absence is the invariant.
        assert "--foliplus-slider-thumb-offset" not in css
        for selector in (
            ".foliplus-slider-rail {",
            ".foliplus-slider-marks {",
            ".foliplus-slider-thumb {",
        ):
            block = _rule(css, selector)
            assert "top: 50%" in block, selector
        # The painted thumb is still a white core + ring clipped to its content
        # box, but it is a real element now, not a native pseudo-element.
        thumb = _rule(css, ".foliplus-slider-thumb {")
        assert "background-clip: content-box" in thumb
        assert "translate(-50%, -50%)" in thumb
        # The bubble is portaled to <body>: fixed positioning and the floating
        # z-index are what keep a panel's overflow from clipping it.
        bubble = _rule(css, ".foliplus-slider-bubble {")
        assert "position: fixed" in bubble
        assert "z-index: var(--foliplus-z-index-hint)" in bubble
        # Disabled is a primitive state, not a component special case.
        assert ".foliplus-slider.is-disabled" in css
        # The end numbers are a width-adaptive pair: a label that fits on
        # its half is centred on the dot it names (anchored a half thumb in
        # from the row edge, shifted back half its own width); a label too
        # wide to fit centred switches to the clamp state (class is-clamp),
        # which returns it to the flex row and clips its text toward the
        # inside. The row spans the control's width (no half-thumb inset) and
        # stays position: relative so the drag-time readout keeps it as its
        # containing block.
        values = _rule(css, ".foliplus-slider-values {")
        assert "display: flex" in values
        assert "justify-content: space-between" in values
        assert "position: relative" in values
        assert "margin" not in values
        span = _rule(css, ".foliplus-slider-values > span {")
        assert "position: static" in span
        assert "overflow: hidden" in span
        assert "text-overflow: ellipsis" in span
        assert "white-space: nowrap" in span
        # The dot-centred default: absolute, anchored a half thumb in from the
        # row edge, shifted back half the label's own width so its centre sits
        # on the parked dot.
        min_rule = _rule(css, ".foliplus-slider-value-min:not(.is-clamp) {")
        max_rule = _rule(css, ".foliplus-slider-value-max:not(.is-clamp) {")
        assert "position: absolute" in min_rule
        assert "position: absolute" in max_rule
        assert "inset-inline-start" in min_rule
        assert "inset-inline-end" in max_rule
        assert "translateX(-50%)" in min_rule
        assert "translateX(50%)" in max_rule
        # The clamp state returns the label to the flex row and clips inward.
        min_clamp = _rule(css, ".foliplus-slider-value-min.is-clamp {")
        max_clamp = _rule(css, ".foliplus-slider-value-max.is-clamp {")
        assert "flex: 0 1 auto" in min_clamp
        assert "flex: 0 1 auto" in max_clamp
        assert "text-align: start" in min_clamp
        assert "text-align: end" in max_clamp
        # RTL mirrors the dot-centre anchors explicitly (the transform flips).
        assert ":dir(rtl) .foliplus-slider-value-min" in css
        assert ":dir(rtl) .foliplus-slider-value-max" in css
        current = _rule(
            css, ".foliplus-slider-values > span.foliplus-slider-value-current {"
        )
        assert "position: absolute" in current
        assert "top: 0" in current
        assert "translateX(-50%)" in current
        # States: parked is small, held and focused grow.
        assert "scale(1.1)" in css
        assert "scale(1.15)" in css

    def test_rows_declare_no_slider_geometry(self):
        """The rows may only state their own coverage, never geometry.

        The guard against the duplication coming back: a row that redeclares a
        rail height or a thumb is one that can drift from the component. Read
        raw — `read_css` expands `@import`, so through it every row "contains"
        token.css.
        """
        root = Path(__file__).resolve().parents[5]
        for rel in (
            "foliplus/css/common/form.css",
            "foliplus/css/control/LayerControl/style.css",
        ):
            raw = (root / rel).read_text(encoding="utf-8")
            assert "::-webkit-slider-thumb" not in raw, rel
            assert "::-moz-range-thumb" not in raw, rel
            assert "--foliplus-slider-rail-height" not in raw, rel

    def test_zoom_range_row_css(self):
        """The row adds only its own coverage cue.

        Out of range dims the selected span (the fill) and nothing else: the
        thumbs, rail and numbers stay crisp so the control still reads as
        operable, and the current-level number keeps the primitive's class. The
        row keeps its hook class and the tooltip, nothing else.
        """
        css = read_css("foliplus/css/control/LayerControl/style.css")
        assert ".foliplus-style-zoom-range-row" in css
        assert "--foliplus-slider-thumb-ring" not in css
        assert "foliplus-zoom-range-out-of-range .foliplus-slider-fill" not in css
        assert ".foliplus-slider-value-current" in css

    def test_style_panel_locale_keys_present(self):
        """Opacity key is injected into the LayerControl bundle."""
        html = render_control(LayerControl())
        assert "LayerControl.style_opacity" in html

    def test_fold_btn_hover_color(self):
        """Fold button hover shows accent color (no bg/radius on fold-btn itself)."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "&:hover" in css
        assert "color: var(--foliplus-accent-primary)" in css

    def test_more_btn_press_scales(self):
        """Row more-button answers :active with the button-family press scale.

        Instant (transition stays none) so a list rebuild cannot flash a
        mid-scale frame.
        """
        css = read_css("foliplus/css/control/LayerControl/menu.css")
        idx = css.find(".foliplus-layer-more-btn")
        assert idx != -1
        # The block ends at the Row-cursor recipe's own hover selector — the
        # row identity class now that the role header joins by it.
        block = css[idx : css.index(".foliplus-row:hover", idx)]
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
        css = read_css("foliplus/css/control/LayerControl/row.css")
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

    def test_fold_btn_has_no_transient_colour_preview(self):
        """The fold chevron has no hover/focus colour preview.

        It used to flip accent on hover/focus and back to text-primary while
        folded — the inverse of a folder row, and a transient accent the user
        reported as "变红". The chevron colour is the row's persistent state
        only: accent while folded, text-primary otherwise, from the shared
        row-cell block.
        """
        css = read_css("foliplus/css/control/LayerControl/index.css")
        flat = re.sub(r"\s+", "", css)
        assert ".foliplus-layer-toggle-all:not(.foliplus-layer-folded)" not in flat
        assert (
            ".foliplus-layer-toggle-all.foliplus-layer-folded:is(:hover,"
            ".foliplus-is-focused-row)" not in flat
        )
        # The folded accent is the shared rule, not a toggle-all-only one.
        idx = css.find("&.foliplus-layer-folded {")
        assert idx != -1, "shared folded rule not found"
        block = css[idx : css.index("\n    }", idx)]
        assert "color: var(--foliplus-accent-primary)" in block

    def test_fold_btn_background_transition(self):
        """Fold button transitions color and transform (background removed — no bg to transition)."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
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
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert ".foliplus-layer-fold-btn" in css
        assert "svg {" in css
        assert "fill: none" in css

    def test_drag_handle_block_and_size(self):
        """drag-handle is a block sized to the checkbox so its dot grip centers
        with the other row glyphs; no bold stroke (dots match MORE at 3px)."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert ".drag-handle" in css
        assert "display: block" in css
        assert "width: var(--foliplus-space-xl)" in css
        assert "height: var(--foliplus-space-xl)" in css

    def test_icon_svg_in_render_list(self, base_map: folium.Map):
        """Custom iconSvg is rendered in type-icon-col during initial render."""
        html = render_control(LayerControl())
        assert "type-icon-col" in html

    def test_drag_pulse_css_keyframes(self):
        """CSS defines drag-pulse keyframes with variable-driven values."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "@keyframes foliplus-drag-pulse" in css
        assert "var(--foliplus-drag-border-from" in css
        assert "var(--foliplus-drag-border-to" in css
        assert "var(--foliplus-drag-shadow-from" in css
        assert "var(--foliplus-drag-shadow-to" in css

    def test_drag_over_css_variables(self):
        """Drag-over drop indicators use CSS custom properties for all parameters."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "--foliplus-drag-border-width" in css
        assert "--foliplus-drag-gap-line" in css
        assert "--foliplus-drag-gap-inset-top" in css
        assert "--foliplus-drag-gap-inset-bottom" in css
        assert "--foliplus-motion-slow" in css
        # One pulse per gesture: pickup and the gap line share the count.
        tokens = read_css("foliplus/css/common/token.css")
        assert "--foliplus-drag-pulse-count: 1" in tokens
        # The commit beat the drop acknowledgement holds for.
        assert "--foliplus-drag-commit" in tokens

    def test_drag_indicator_css_is_one_row_attribute(self):
        """The drag indicator is ONE row attribute with one value per state.

        The old vocabulary was four independent classes, which allowed two
        indicators on one row at once (a layer over a folder row's edge drew a
        solid border, the pulse and a dashed outline together). A single
        attribute with exactly one value makes that unrepresentable.
        """
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert '[data-foliplus-drop="source"]' in css
        assert '[data-foliplus-drop="before"]' in css
        assert '[data-foliplus-drop="after"]' in css
        assert '[data-foliplus-drop="join"]' in css
        assert '[data-foliplus-drop="refuse"]' in css
        # The pulse marks the INSERTION GAP: before/after draw it on the row
        # edge the layer lands against, so up-drag and down-drag agree.
        # The stylesheet is nested: the edge pseudo-elements live inside the
        # before/after state blocks.
        assert "&::before {" in css
        assert "&::after {" in css
        assert "animation: foliplus-drag-pulse" in css
        assert "@keyframes foliplus-drag-join-pulse" in css
        # The row on the FAR side of the gap sinks, so the gap reads as a slot
        # being pushed open; the dent is a companion of the gap state, not a
        # state of its own.
        assert '[data-foliplus-push="top"]' in css
        assert '[data-foliplus-push="bottom"]' in css
        assert "box-shadow: var(--foliplus-drag-gap-inset-top)" in css
        assert "box-shadow: var(--foliplus-drag-gap-inset-bottom)" in css
        # The dragged block's members are hidden for the gesture only.
        assert "[data-foliplus-drag-folded]" in css
        assert "display: none" in css
        # The old edge indicator (a border on the row itself) is gone.
        assert "border-top: var(--foliplus-drag-border-width) solid" not in css
        assert "border-bottom: var(--foliplus-drag-border-width) solid" not in css
        # A refused target is a different answer, not a weaker accept: it has
        # its own desaturated colour instead of the accent the gap line uses.
        assert "var(--foliplus-drag-refuse)" in css
        tokens = read_css("foliplus/css/common/token.css")
        assert "--foliplus-drag-refuse:" in tokens
        # The four-class vocabulary is gone, not merely unused.
        assert "foliplus-layer-drag-over-top" not in css
        assert "foliplus-layer-drag-over-bottom" not in css
        assert "foliplus-layer-drag-over-into" not in css
        assert "foliplus-layer-drag-over-blocked" not in css
        assert "foliplus-layer-dragging" not in css

    def test_focus_glow_reads_motion_quick(self):
        """The focus-pane glow entrance reads its duration from the motion
        ladder."""
        css = read_css("foliplus/css/control/LayerControl/index.css")
        assert "animation: foliplus-focus-glow-in var(--foliplus-motion-quick)" in css

    def test_indeterminate_css_style_present(self):
        """:indeterminate CSS style exists for partial selection state."""
        # Only LayerControl renders this checkbox (CONST.CLASSES.CHECKBOX), so
        # the component is not shared and the rule stays in its own stylesheet.
        css = read_css("foliplus/css/control/LayerControl/index.css")
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
                "foliplus/css/control/LayerControl/index.css",
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
        css = read_css("foliplus/css/control/LayerControl/index.css")
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
