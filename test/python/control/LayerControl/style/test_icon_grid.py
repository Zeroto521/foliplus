"""Split of test_icon.py: TestIconBrowser part 2."""

from __future__ import annotations

import json

from pathlib import Path

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

from ..helper_browser import LayerControlBrowserBase

class TestIconBrowser(LayerControlBrowserBase):
    @staticmethod
    def _icon_marker_layer() -> folium.GeoJson:
        """A marker layer with one categorical field across eight points.

        The icon dimension owns the marker icon axis; the eight distinct
        category values are what the derived symbol mapping walks (one symbol
        per category, capped by the legend budget constant).
        """
        return folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "icon_markers_8")),
            name="Icon markers",
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
    def test_style_icon_dimension_swaps_marker_dom_class(self, browser, tmp_path):
        """The icon row drives real markers: one whole-layer glyph swap.

        The vitest layer proves setIcon receives the derived icon descriptor;
        this crosses into the real Leaflet runtime to prove the marker's DOM
        element actually carries `.foliplus-marker-glyph` for every marker on
        the layer after one grid pick, that the derived chassis (className /
        backgroundImage / backgroundPosition / iconSize) is pixel-identical to
        the author baseline, and that Reset drops it back to the author icon.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._icon_marker_layer(),
            slug="style_icon_dimension",
        ) as (page, errors):
            self._open_style_ramp(page)
            before = page.evaluate(_js("LayerControl/icon_dimension_probe"), [])
            assert before["panel"] and before["iconRow"], before
            assert all(not icon["hasGlyph"] for icon in before["icons"]), (
                f"markers already carry a glyph before the write: {before}"
            )

            # P3-22: a wrong FA glyph name renders as a 0-width tofu. Open the
            # grid and assert every glyph cell's icon paints at a real width.
            grid = page.evaluate(
                _js("LayerControl/icon_dimension_probe"), ["@readGrid"]
            )
            assert grid["gridOpen"], f"grid did not open: {grid}"
            assert grid["cellCount"] == 40, f"expected 40 glyph cells: {grid}"
            bad = [w for w in grid["widths"] if w["width"] <= 0]
            assert not bad, f"glyph cells render at zero width (tofu): {bad}"

            written = page.evaluate(
                _js("LayerControl/icon_dimension_probe"), ["map-pin"]
            )
            # Task #932 step 1: a plain L.Icon.Default author (this fixture)
            # takes the dedicated divIcon branch — the marker DOM carries the
            # foliplus-marker-default class + the glyph shell, and Leaflet's
            # default 25x41 / [12,41] anchor is pinned. The old
            # derivedMatchesAuthor contract (chassis pixel-identical to the
            # author's <img>) does NOT hold here — Default is replaced by a
            # DivIcon by design.
            assert "foliplus-marker-default" in written["derived"]["cls"].split(), (
                f"default branch did not set foliplus-marker-default: {written}"
            )
            assert (
                written["derived"]["inner"]
                and "foliplus-marker-glyph"
                in written["derived"]["inner"]["cls"].split()
            ), f"default branch lost the glyph inner shell: {written}"
            assert written["derived"]["iconSize"] == [25, 41], (
                f"default branch did not pin the 25x41 size: {written}"
            )
            # Leaflet offsets the icon element from the anchor: a [12,41]
            # anchor on a 25x41 icon shifts the element -12px / -41px. The
            # glyph must sit on the point, not below it (the pre-932 偏下 bug).
            assert written["derived"]["anchor"] == {
                "left": "-12px",
                "top": "-41px",
            }, f"default branch did not pin the [12,41] anchor: {written}"
            assert written["icons"], "no marker icons read"
            assert all(icon["hasGlyph"] for icon in written["icons"]), (
                f"not every marker carries the glyph after the write: {written}"
            )
            # All markers share the SAME whole-layer glyph: one FontAwesome
            # element class set, no inline SVG payload anywhere.
            classes = {icon["glyphClass"] for icon in written["icons"]}
            assert len(classes) == 1, f"glyph class is not uniform: {written}"
            glyph_class = next(iter(classes))
            assert "fa-solid" in glyph_class, f"not a FA glyph: {written}"
            assert "foliplus-marker-glyph" in glyph_class, written

            reset = page.evaluate(
                _js("LayerControl/icon_dimension_probe"), [None, True]
            )
            assert reset["derivedMatchesAuthor"], (
                f"Reset did not restore the author icon pixel-identical: {reset}"
            )
            # After Reset the marker is the author's real <img> again — a
            # plain L.Icon.Default author has no inner <i> to carry, so the
            # colour contract only applies when the author supplied one.
            if reset["innerKeepsAuthor"] is not None:
                assert reset["innerKeepsAuthor"], (
                    f"Reset lost the author inner <i> class/colour: {reset}"
                )
            assert all(not icon["hasGlyph"] for icon in reset["icons"]), (
                f"Reset did not restore the author icon: {reset}"
            )
    def test_icon_grid_owns_keyboard_while_open(self, browser, tmp_path):
        """The open glyph grid owns DOM focus and the keyboard.

        The reported regression: with the grid open, an arrow / Space / Enter
        pressed while focus was still on the trigger or a slider thumb bubbled
        to the document-level dispatcher and toggled the layer row behind the
        popup. The real fix is focus — the grid takes focus on open — with the
        key claim as the dispatcher guard. Three scenarios, driven with the
        real browser keyboard:
          (a) focus on the trigger, Enter opens → focus lands in the grid,
              ArrowRight only moves the grid cursor (layer visibility and the
              slider value are untouched);
          (b) focus on the opacity slider thumb (the user's reproduction) →
              open → arrows only move the grid, slider value unchanged;
          (c) Enter/Space on a cell commits the glyph and closes the grid
              without toggling the layer; Escape closes and returns focus to
              the trigger.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._icon_marker_layer(),
            slug="icon_grid_keyboard",
        ) as (page, errors):
            self._open_style_ramp(page)
            setup = page.evaluate(_js("LayerControl/icon_grid_keyboard_state"), "setup")
            assert setup and setup.get("ok"), setup

            def state():
                return page.evaluate(
                    _js("LayerControl/icon_grid_keyboard_state"), "state"
                )

            def focus_trigger():
                return page.evaluate(
                    _js("LayerControl/icon_grid_keyboard_state"), "focusTrigger"
                )

            def focus_slider():
                return page.evaluate(
                    _js("LayerControl/icon_grid_keyboard_state"), "focusSlider"
                )

            def open_grid():
                return page.evaluate(
                    _js("LayerControl/icon_grid_keyboard_state"), "openGrid"
                )

            def focus_first_cell():
                return page.evaluate(
                    _js("LayerControl/icon_grid_keyboard_state"), "focusFirstCell"
                )

            # (a) focus on the trigger → Enter opens the grid → focus enters it.
            focus_trigger()
            page.keyboard.press("Enter")
            page.wait_for_timeout(80)
            opened = state()
            assert opened["gridOpen"] is True, opened
            assert opened["focusInGrid"] is True, (
                f"focus did not enter the grid on open: {opened}"
            )
            assert opened["layerChecked"] is True, opened

            # ArrowRight only moves the grid cursor; layer + slider untouched.
            before_value = state()["sliderValue"]
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(80)
            moved = state()
            assert moved["focusInGrid"] is True, moved
            assert moved["layerChecked"] is True, moved
            assert moved["sliderValue"] == before_value, moved

            # Focus-ring contract: a grid cell shows the shared ring, not the
            # browser default outline (outline-style must be none and the ring's
            # box-shadow must be present).
            focus_first_cell()
            page.wait_for_timeout(80)
            ring = state()["focusStyle"]
            assert ring is not None, "no focused cell to read focus style from"
            assert ring["outlineStyle"] == "none", ring
            assert ring["boxShadow"] and ring["boxShadow"] != "none", ring
            # The ring's color must be the focus token (resolved accent).
            assert ring["focusColor"], ring

            # Escape closes + returns focus to the trigger.
            page.keyboard.press("Escape")
            page.wait_for_timeout(80)
            closed = state()
            assert closed["gridOpen"] is False, closed
            assert closed["focusOnTrigger"] is True, closed

            # (b) focus on the opacity slider thumb (the user's reproduction) →
            # open → arrows only move the grid, slider value unchanged.
            focus_slider()
            open_grid()
            page.wait_for_timeout(80)
            from_slider = state()
            assert from_slider["gridOpen"] is True, from_slider
            assert from_slider["focusInGrid"] is True, from_slider
            slider_before = state()["sliderValue"]
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(80)
            after = state()
            assert after["focusInGrid"] is True, after
            assert after["sliderValue"] == slider_before, after
            assert after["layerChecked"] is True, after

            # (c) Enter on a cell commits + closes; layer visibility unchanged.
            page.keyboard.press("Enter")
            page.wait_for_timeout(80)
            committed = state()
            assert committed["gridOpen"] is False, committed
            assert committed["layerChecked"] is True, committed
            assert committed["focusOnTrigger"] is True, committed

            assert not errors, f"JS errors: {errors}"
            assert not errors, errors
    def test_icon_grid_focus_ring_screenshot(self, browser, tmp_path):
        """Capture the glyph grid cell focus ring for the before/after evidence.

        Only runs when FOLIPLUS_SHOT_DIR is set (the CI never sets it): opens
        the grid, focuses a cell, and writes a clipped screenshot of the cell
        plus its computed outline/box-shadow so the before (browser default
        black outline) and after (shared focus ring) can be compared.
        """
        import os

        shot_dir = os.environ.get("FOLIPLUS_SHOT_DIR")
        if not shot_dir:
            pytest.skip("FOLIPLUS_SHOT_DIR not set")
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._icon_marker_layer(),
            slug="icon_grid_focusring",
        ) as (page, errors):
            self._open_style_ramp(page)
            setup = page.evaluate(_js("LayerControl/icon_grid_keyboard_state"), "setup")
            assert setup and setup.get("ok"), setup
            page.evaluate(_js("LayerControl/icon_grid_keyboard_state"), "focusTrigger")
            page.keyboard.press("Enter")
            page.wait_for_timeout(80)
            rect = page.evaluate(
                _js("LayerControl/icon_grid_keyboard_state"), "cellRect"
            )
            assert rect and rect.get("ok"), rect
            out = Path(shot_dir) / "icon-grid-focusring.png"
            page.screenshot(
                path=str(out),
                clip={
                    "x": max(0, rect["x"] - 16),
                    "y": max(0, rect["y"] - 16),
                    "width": rect["width"] + 32,
                    "height": rect["height"] + 32,
                },
            )
            assert rect["outlineStyle"] == "none", rect
            assert rect["boxShadow"] and rect["boxShadow"] != "none", rect
            print(f"wrote {out}")
            assert not errors, f"JS errors: {errors}"
    def test_icon_row_input_width_and_ellipsis(self, browser, tmp_path):
        """The icon trigger fills the control column and a long glyph name
        ellipsizes instead of overflowing the row (single-icon row detail)."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._icon_marker_layer(),
            slug="icon_row_width",
        ) as (page, errors):
            self._open_style_ramp(page)
            setup = page.evaluate(_js("LayerControl/icon_grid_keyboard_state"), "setup")
            assert setup and setup.get("ok"), setup
            metrics = page.evaluate(
                _js("LayerControl/icon_grid_keyboard_state"), "rowMetrics"
            )
            assert metrics and metrics.get("ok"), metrics
            # The trigger spans the shared control column, so the icon row
            # lines up with every other style/heatmap input row.
            assert metrics["triggerFillsControl"], metrics
            assert not metrics["nameOverflows"], metrics
            assert not errors, f"JS errors: {errors}"
