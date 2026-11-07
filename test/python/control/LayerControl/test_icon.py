"""Browser tests for foliplus.LayerControl — icons, titles, cursor/glow."""

from __future__ import annotations

import folium
import pytest
from conftest import (
    _js,
    load_geojson,
    panel_ready,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestIconBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — icons, titles, cursor/glow."""

    def test_icon_svg_payload_never_reaches_dom(self, browser, tmp_path):
        """A hostile iconSvg survives the innerHTML sink as inert markup only.

        ``iconSvg`` is the one piece of third-party-supplied HTML in the layer
        model — callers of ``LayerAPI.registerLayer`` / ``createLayers`` hand it
        in unchecked and it lands in an ``innerHTML`` sink on the type-icon
        column.  The payload carries three independent vectors: an ``onload``
        handler on the svg root, a nested ``<script>``, and an ``<img>``
        smuggled in as a second root (which must not even survive as an
        element).
        """
        with use_page(self._make_page, browser, tmp_path, slug="xss_icon") as (
            page,
            _,
        ):
            result = page.evaluate(_js("LayerControl/icon_svg_sanitized"))
            assert result is not None, "LayerAPI not found"
            assert result["ctrlPresent"], "layer control not mounted"

            assert not any(result["leaked"]), (
                f"executable payload ran: {result['leaked']}"
            )
            assert result["probe"] is not None, "probe row never rendered"
            assert result["probe"]["scripts"] == 0, result["probe"]
            assert result["probe"]["imgs"] == 0, result["probe"]
            assert "onload=" not in result["probe"]["html"], result["probe"]
            assert "<script" not in result["probe"]["html"], result["probe"]
            # The rect is presentation and must survive; the payload must not.
            assert result["probe"]["svgs"] == 1, result["probe"]
            assert "<rect" in result["probe"]["html"], result["probe"]

            # A namespace declaration is structural, not content: it has to
            # survive, otherwise Chromium redeclares the SVG namespace on every
            # element when serialising and a `class` attribute stops matching its
            # CSS rule. This is a real-browser serialisation property — jsdom
            # writes both shapes identically — so the assertion only exists here.
            assert result["spin"] is not None, "spinner row never rendered"
            assert result["spin"]["xmlnsCount"] == 1, result["spin"]
            assert result["spin"]["class"] == "foliplus-spin", result["spin"]
            assert result["spin"]["matches"] is True, result["spin"]

    def test_pane_svg_does_not_capture_the_map(self, browser, tmp_path):
        """The SVG renderer inside a foliplus pane must not swallow the map.

        An inline ``<svg>`` carrying ``pointer-events`` is hit over its whole
        box, not only where it paints.  Every foliplus pane holds one and each
        covers the map, so an SVG left at ``auto`` takes every event meant for
        a layer painted below it — geometry hover/click dies and the cursor
        sticks at the inherited ``grab``.

        ``pointer-events`` on the svg has to stay ``none``; the paths are
        reached through ``.leaflet-interactive`` instead.  Leaflet never sets
        it on the svg for exactly this reason.
        """
        with use_page(self._make_page, browser, tmp_path, slug="pane_svg") as (
            page,
            errors,
        ):
            result = page.evaluate(
                _js("LayerControl/pane_svg_does_not_capture"),
                load_geojson("common", "polygon_fuzhou_box"),
            )
            assert result is not None, "LayerAPI not found"
            assert result["ready"] is True, f"fixture not ready: {result}"

            assert result["svgPointerEvents"] == "none", (
                "the pane's SVG renderer must not be a hit target, or it "
                f"captures the whole map: {result}"
            )
            assert result["panePointerEvents"] == "none", result

            # On the geometry: the path is the target, with the interactive
            # cursor, and its click handler stays live.
            assert result["pathIsInteractive"] is True, result
            assert result["pathPointerEvents"] == "auto", result
            assert result["onHitIsPath"] is True, (
                f"geometry is not the hit target on itself: {result}"
            )
            assert result["onHitCursor"] == "pointer", (
                f"geometry does not show the interactive cursor: {result}"
            )
            assert result["clicked"] is True, (
                f"the feature did not receive the click: {result}"
            )

            # Off the geometry: nothing of the foliplus pane may be the
            # target.  This is the regression — the pane's SVG used to take
            # every point of the map.
            assert result["offHitIsSvg"] is False, (
                f"the pane's SVG swallowed a point off the geometry: {result}"
            )
            assert result["offHitInPane"] is False, (
                f"a foliplus pane swallowed a point off the geometry: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_close_btn_aligns_with_header_icon(self, browser, tmp_path):
        """The panel close button sits on the same vertical axis as the header
        icon (the panel's logo).

        Regression for "close button drifts off the header icon's axis": a drift of
        even 1-2 px reads as the × floating off the header's vertical axis. The
        threshold is 2 px so a subpixel rounding from `getBoundingClientRect`
        does not flake the test, but anything above that is a real visual bug.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/read_close_icon_alignment"))
            assert not result.get("error"), f"probe error: {result}"
            assert not errors, f"JS errors: {errors}"
            assert abs(result["deltaPx"]) <= 2, (
                f"close button is {result['deltaPx']:.2f}px off the header "
                f"icon's vertical center -- threshold 2px, got {result}"
            )

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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            title = page.evaluate(_js("LayerControl/read_checkbox_title"))
            assert title and "MyPoints" not in title, (
                f"Expected select/deselect title, got '{title}'"
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
        # The gate reads the English fold/unfold tooltip, so pin the page locale.
        LayerControl(locale="en").add_to(m)
        folium.FeatureGroup(name="A", overlay=True, show=True).add_to(m)

        html_path = tmp_path / "test_fold_row_title.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            title = page.evaluate(_js("LayerControl/read_color_layer_title"))
            assert title, f"Expected non-empty title, got '{title}'"

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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
        """Color layer item shows move cursor on hover (draggable in base role)."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            cursor = page.evaluate(_js("LayerControl/read_color_layer_cursor"))
            assert cursor == "move", f"Expected move cursor, got {cursor}"

    # ── Indeterminate checkbox browser tests ──

    def test_row_cursor_renders_glow_on_clear_surface(self, browser, tmp_path):
        """The Row-cursor recipe genuinely renders, not just exists in source.

        The shared recipe must produce the arrow-key reference look in the live
        DOM — explicit white surface + red glow — for BOTH the keyboard cursor
        and mouse hover, and leave resting rows untouched. This guards against a
        recipe that parses but never paints (the pytest source assert can't
        catch that).

        `show=False` is NOT a reliable "unchecked" pin: on folium 0.14 those
        overlays still land on the map and the init pass still marks the row
        `.foliplus-active` (wash). Force the checkbox off and measure that live row.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=False)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=False)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            # The row surface is compared against this row's own resting state,
            # which is only meaningful once the init pass has run: rows render
            # checked by default and initLayerItem (on an init timer) decides
            # the checkbox and the .foliplus-active class.
            panel_ready(page)
            # Force a truly unchecked row — do not trust show=False across
            # folium versions (0.14 still checks them).
            page.evaluate(_js("LayerControl/force_first_checkbox_unchecked"))
            # Move the mouse off the panel so a data row reads its resting state.
            page.mouse.move(0, 0)
            page.wait_for_timeout(120)

            rest = page.evaluate(_js("LayerControl/read_row_rest_with_active"))
            assert rest["active"] is False, (
                f"reference row must be unchecked after the forced toggle, got {rest}"
            )
            assert rest["shadow"] == "none", (
                f"resting row must have no glow, got {rest['shadow']}"
            )

            kb = page.evaluate(_js("LayerControl/read_row_cursor_style"))
            assert kb is not None and "error" not in kb, f"cursor snippet failed: {kb}"
            white = self._sample_surface(page)
            assert kb["bg"] == white, (
                f"keyboard cursor must paint the white surface, "
                f"got {kb['bg']} vs token {white}"
            )
            assert rest["bg"] == white, (
                f"unchecked rest row must also be the explicit white surface, "
                f"got {rest['bg']} vs token {white}"
            )
            assert kb["shadow"] != "none", (
                f"keyboard-cursor row must glow, got {kb['shadow']}"
            )
            assert kb["outline"] == "none", (
                f"keyboard-cursor row must suppress the default dark outline, got "
                f"{kb['outline']} (black frame)"
            )

            # Hover a data row and confirm it matches the keyboard cursor exactly.
            page.hover(".foliplus-layer-item")
            page.wait_for_timeout(120)
            hover = page.evaluate(_js("LayerControl/read_row_rest"))
            assert hover["bg"] == kb["bg"], (
                f"hover {hover['bg']} must equal keyboard {kb['bg']}"
            )
            assert hover["shadow"] == kb["shadow"], (
                f"hover glow {hover['shadow']} must equal keyboard {kb['shadow']}"
            )

    def test_row_cursor_turns_row_white_on_hover_tab_and_arrow(self, browser, tmp_path):
        """Hover, Tab and arrow-key cursor all turn the row white.

        The interaction target always paints `var(--foliplus-surface)` — including on
        a checked row, whose `.foliplus-active` wash is only the rest surface. White is
        sampled from the token live, never hardcoded. Dropping the class (what
        Escape does) returns the rest surface. Tab is covered by the focusin
        delegate mapping onto the same JS class the probe applies.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=False)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=False)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/read_row_cursor_surface"))
            assert result is not None and "error" not in result, (
                f"surface snippet failed: {result}"
            )
            white = result["white"]

            # Unchecked: rest and cursor are both the explicit white surface.
            assert result["rest"]["bg"] == white, (
                "unchecked rest must be the explicit white surface, got " + str(result)
            )
            assert result["cursor"]["bg"] == white, (
                "cursor must keep the unchecked row white, got " + str(result)
            )
            assert result["cursor"]["shadow"] != "none", (
                "cursor must still glow, got " + str(result)
            )
            assert result["after"]["bg"] == result["rest"]["bg"], (
                "dropping the cursor class must restore rest, got " + str(result)
            )

            # Checked: rest wash → cursor white → wash returns.
            assert result["checkedRest"]["active"] is True, (
                "reference row should be checked, got " + str(result)
            )
            assert result["checkedRest"]["bg"] != white, (
                "checked rest must show the wash, not the interaction white, got "
                + str(result)
            )
            assert result["checkedCursor"]["bg"] == white, (
                "cursor must also turn a checked row white, got " + str(result)
            )
            assert result["checkedAfter"]["bg"] == result["checkedRest"]["bg"], (
                "dropping the cursor class must restore the checked wash, got "
                + str(result)
            )

            # Real hover on the unchecked row: same white as the JS cursor class.
            page.hover(".foliplus-layer-item:not(.foliplus-active)")
            page.wait_for_timeout(120)
            hover_bg = page.evaluate(_js("LayerControl/read_inactive_row_bg"))
            assert hover_bg == white, (
                f"mouse hover must turn the row white too, got {hover_bg}"
            )

    def test_fold_row_cursor_wakes_glow_and_red_icon(self, browser, tmp_path):
        """A keyboard cursor on the fold (toggle-all) row shows the shared recipe
        (white surface + glow) and wakes the fold icon red, exactly like hover —
        the fold row joins the Row-cursor recipe and cannot drift into its own
        hover style.
        """
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=False)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=False)
        with use_page(self._make_page, browser, tmp_path, overlay1, overlay2) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/read_fold_row_cursor_style"))
            assert result is not None and "error" not in result, (
                f"fold-cursor snippet failed: {result}"
            )
            assert result["isFold"] is True, (
                f"cursor should be on the fold row, got {result}"
            )
            white = self._sample_surface(page)
            assert result["bg"] == white, (
                f"fold row cursor must paint the white surface, got {result['bg']}"
            )
            assert result["shadow"] != "none", (
                f"fold row must glow, got {result['shadow']}"
            )

    def test_focusin_maps_checkbox_to_row_cursor(self, browser, tmp_path):
        """Tab focus is sampled once in focusin and mapped onto the JS row class.

        :focus-visible is not a CSS trigger. Keyboard-modality focus on a child
        control lights the owning row; mouse-modality focus must not. Escape
        then lifts the class with no residual suppress marker.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/focusin_maps_checkbox_to_row_cursor")
            )
            assert result is not None, "focusin_maps_checkbox_to_row_cursor failed"
            assert result["litByKeyboard"] is True, (
                "keyboard-modality focus must light the owning row, got " + str(result)
            )
            assert result["litByMouse"] is False, (
                "mouse-modality focus must not light the row, got " + str(result)
            )
            assert result["suppressLeft"] is False, (
                "the FOCUS_SUPPRESSED mechanism is gone, got " + str(result)
            )

    def test_checkbox_click_lights_row_cursor(self, browser, tmp_path):
        """Click lights the row cursor and keeps it until another row takes over.

        Pointer click is a cursor arrival (white + glow). Repeated clicks stay
        on the same row; clicking another row hands the visual over.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/checkbox_click_lights_cursor"))
            assert result is not None and "error" not in result, (
                f"checkbox click snippet failed: {result}"
            )
            assert result["afterClick"]["focusedClass"] is True, (
                "click must light the row cursor, got " + str(result)
            )
            assert result["afterClick"]["glow"] is True, (
                "click must show the cursor glow, got " + str(result)
            )
            assert result["afterAgain"]["focusedClass"] is True, (
                "repeated clicks must keep the cursor, got " + str(result)
            )
            assert result["handedOver"]["first"]["focusedClass"] is False, (
                "clicking another row must drop the previous cursor, got " + str(result)
            )
            assert result["handedOver"]["second"]["focusedClass"] is True, (
                "the clicked row must carry the cursor, got " + str(result)
            )
