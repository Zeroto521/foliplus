"""Split of test_style.py by dimension."""

from __future__ import annotations

import base64
import copy
import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import HeatmapControl, LayerControl


def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the locale
    table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]


from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestStyleBrowser(LayerControlBrowserBase):
    def test_reset_keeps_style_panel_open_and_focus_inside(self, browser, tmp_path):
        """Reset restores values without dismissing the panel; focus stays inside it.

        Reset disables itself once the layer is back on its declared style, so
        the focus contract is "inside the panel", not "on the (now disabled)
        trigger": a disabled button cannot take focus."""
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(120.0, 30.0))),
            name="Facility Points",
            overlay=True,
            show=True,
            marker=folium.CircleMarker(
                [30.0, 120.0],
                radius=5,
                color="#3388ff",
                weight=2,
                fill=True,
                fill_opacity=0.8,
            ),
        ).add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_reset_keeps_panel.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            # Write a border first: a pristine layer disables Reset, and the
            # no-move / focus assertions need a live trigger.
            opened = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", "#ff0000", 3],
            )
            assert opened.get("panel"), f"the style panel did not open: {opened}"
            # Let the panel's own entrance animation settle; the assertion below
            # is about the Reset refresh, not the opening animation.
            page.wait_for_timeout(250)

            before = page.evaluate(_js("LayerControl/style_reset_frames"), "start")
            clicked = page.evaluate(_js("LayerControl/style_reset_click"))
            assert clicked is True, "the Reset button was not clickable"
            page.wait_for_timeout(200)
            frames = page.evaluate(_js("LayerControl/style_reset_frames"))
            assert before, "the style panel was not measurable before Reset"
            moved = [
                frame
                for frame in frames
                if frame
                and (
                    abs(frame["top"] - before["top"]) > 1
                    or abs(frame["left"] - before["left"]) > 1
                    or abs(frame["height"] - before["height"]) > 1
                    or frame["scrollY"] != before["scrollY"]
                )
            ]
            assert not moved, f"Reset moved the panel on a frame: {frames}"
            state = page.evaluate(_js("LayerControl/style_reset_kept_open"))
            assert state["panelOpen"] is True, (
                f"Reset must keep the style panel open: {state}"
            )
            assert state["resetDisabled"] is True, (
                f"Reset must disable itself once the layer is back on its default: {state}"
            )
            assert state["focusInPanel"] is True, (
                f"Reset must leave focus inside the panel: {state}"
            )

    def test_unit_suffix_sits_inside_the_field_and_hides_on_focus(
        self, browser, tmp_path
    ):
        """The visible unit suffix is drawn inside the number field's own rect.

        Every unit-suffixed field must keep the bare number in its value (no
        unit text leaks into the input), draw the suffix inside the field's
        right padding without overlapping the value, and hide the suffix while
        the field is focused (is-editing) so the unit is never read as part of
        the number. Both unit families must be present on one page: px (border
        width, size radius) and % (fill opacity, icon/marker opacity).
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(120.0, 30.0))),
            name="Facility Points",
            overlay=True,
            show=True,
            marker=folium.CircleMarker(
                [30.0, 120.0],
                radius=5,
                color="#3388ff",
                weight=2,
                fill=True,
                fill_opacity=0.8,
            ),
        ).add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_unit_suffix_geometry.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            result = page.evaluate(
                _js("LayerControl/unit_suffix_geometry"), ["Facility Points"]
            )
            assert result.get("panel"), f"the style panel did not open: {result}"
            assert result["fieldCount"] >= 3, (
                f"expected at least the fill %, size px and border px fields: {result}"
            )
            # Both unit families on one page.
            assert result["hasPx"], f"no px suffix found on the page: {result}"
            assert result["hasPct"], f"no % suffix found on the page: {result}"
            for field in result["fields"]:
                assert field["bareNumber"], (
                    f"the field value is not a bare number (unit leaked in?): {field}"
                )
                assert field["suffixInsideInput"], (
                    f"the suffix must be drawn inside the input's rect: {field}"
                )
                assert field["suffixTopInside"], (
                    f"the suffix must be vertically inside the field: {field}"
                )
                assert field["text"] in ("px", "%"), (
                    f"the suffix text must be the unit symbol: {field}"
                )
            # Every suffixed field right-aligns its value and the digit-to-unit
            # gap is the same constant for every count and unit (the CSS pins
            # the gap, so the unit follows the last digit instead of drifting
            # with the field width — "5 %" and "1.5px" must look identical).
            gaps = [field["digitGap"] for field in result["fields"]]
            assert gaps, f"no suffixed fields to measure: {result}"
            for field in result["fields"]:
                assert field["textAlign"] == "right", (
                    f"a suffixed field must right-align its value: {field}"
                )
                assert field["digitGap"] >= -0.5, (
                    f"the unit must not overlap the value: {field}"
                )
                assert field["digitGap"] <= 3.0, (
                    f"the digit-to-unit gap must be a small fixed value: {field}"
                )
            assert max(gaps) - min(gaps) <= 1.0, (
                f"the digit-to-unit gap must not drift with the value: {gaps}"
            )
            # The same field's gap must not move with how many digits are typed:
            # "5" vs "55.5" vs "100" all land the unit at the same offset (the
            # centered-text bug made the gap depend on the value width).
            drift = result.get("drift")
            assert drift and drift.get("spread") is not None, (
                f"no gap-drift measurement: {result}"
            )
            assert drift["spread"] <= 1.0, (
                f"the gap must not move with the digit count: {drift}"
            )
            focus = result.get("focus")
            assert focus, f"no suffixed field to focus: {result}"
            assert focus["editingOn"] is True, (
                f"focus must add the is-editing state: {focus}"
            )
            assert focus["suffixOpacityOn"] < 0.5, (
                f"the suffix must hide on focus: {focus}"
            )
            assert focus["editingOff"] is False, (
                f"blur must remove the is-editing state: {focus}"
            )
            assert focus["suffixOpacityOff"] > 0.5, (
                f"the suffix must return on blur: {focus}"
            )

    def test_style_panel_scheme_dropdown_clears_the_panel(self, browser, tmp_path):
        """The style panel's scheme dropdown is fully visible and hit-testable.

        The panel is a row panel — fixed-position, pinned under its layer row —
        while the picker's dropdown is portaled to <body>. Both float, so the
        dropdown must outrank the expanded control (its bar/section are lifted
        to floating +1/+9): without that, the panel painted over the open list
        and every item was unclickable, which is what the fill row shipped
        with. The card also has to stay inside the viewport rather than being
        clipped by the layer list's scroll box — the reason the panel is fixed
        in the first place.

        Measured from live rects, no magic numbers: the assert is "the point at
        the widget's center resolves to the widget itself", the same contract
        the row-overlay probes use.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="style_scheme_dd"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )

            result = page.evaluate(_js("LayerControl/style_scheme_dropdown"))
            assert result["ok"], f"scheme row did not open: {result}"
            assert result["panelInViewport"], (
                "the fixed row panel must stay inside the viewport, not be clipped "
                f"by the layer list's scroll box: {result['panelRect']}"
            )
            assert result["triggerInViewport"], (
                f"the scheme trigger is not reachable: {result['triggerRect']}"
            )
            assert result["triggerHitInsidePanel"], (
                "the scheme trigger must be the topmost element at its center"
            )
            assert result["dropdownRect"], "the scheme dropdown did not mount"
            assert result["dropdownInViewport"], (
                f"the dropdown overflows the viewport: {result['dropdownRect']}"
            )
            assert result["dropdownHitInsideDropdown"], (
                "the open dropdown is painted under the style panel: the point at "
                "its center hit "
                f"{result['dropdownHitClass']} (z={result['dropdownZ']})"
            )
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_pick_keeps_the_drawer(self, browser, tmp_path):
        """A real press on the portalled color list keeps the drawer open.

        The list lives on <body>, so the press has to be classified as part of
        the drawer's overlay rather than by the drawer's own subtree. The press
        is what commits the color: the drawer must survive it, the picker must
        close behind it, and the hidden select, the trigger title and the color
        bar must all show the chosen scheme — then the value has to survive a
        close and reopen, which rebuilds the drawer from the layer's own ramp
        state. A pick that tears the drawer down would drop the click entirely
        and leave the old scheme behind; "the drawer is still there" alone does
        not prove the write landed.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_pick",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], f"the ramp mode did not settle: {ready}"
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )

            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"
            assert rows["dropdownParentTag"] == "BODY", (
                "the picker must portal its list to <body>, got "
                f"{rows['dropdownParentTag']}"
            )

            before = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert before["drawerVisible"] and before["dropdownPresent"], before
            target = rows["targetName"]
            assert target and target != before["triggerTitle"], (
                f"the probe picked the scheme already shown ({target}): {rows}"
            )

            page.mouse.click(rows["targetX"], rows["targetY"])
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], (
                f"the color press dismissed the drawer: {state}"
            )
            assert state["hiddenValue"] == target, (
                f"the pick did not commit {target}: {state}"
            )
            assert state["triggerTitle"] == target, (
                f"the trigger still shows {state['triggerTitle']}, expected {target}"
            )
            assert state["barBlockColor"] != before["barBlockColor"], (
                "the color bar was not repainted for the new scheme: "
                f"{before['barBlockColor']} -> {state['barBlockColor']}"
            )
            assert not state["dropdownPresent"], (
                f"the list must close after a pick: {state}"
            )

            # Close and reopen: the drawer renders from the layer's committed
            # ramp state, so only a write that really landed comes back.
            page.click(
                ".foliplus-layer-style-panel .foliplus-panel-header .foliplus-close-btn"
            )
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="detached", timeout=3000
            )
            reopened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert reopened["ok"], f"the drawer did not reopen: {reopened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            settled = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert settled["triggerTitle"] == target, (
                f"the reopened drawer shows {settled['triggerTitle']}, expected "
                f"{target} — the pick did not persist"
            )
            assert settled["hiddenValue"] == target, settled
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_survives_a_scroll(self, browser, tmp_path):
        """Scrolling while the list is open re-pins it and keeps the drawer.

        The drawer scrolls its own content (the card is capped and pinned), and
        the portalled list has to follow the trigger it belongs to. A scroll is
        not a dismissal: both surfaces stay on screen.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_scroll",
        ) as (page, errors):
            self._open_style_ramp(page)
            # The label section makes the card tall enough to scroll inside
            # itself. Expand it before the list opens: the toggle re-renders the
            # drawer, which would rebuild the ramp mode and drop an already-open
            # picker.
            tall = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert tall["ok"], tall
            assert tall["content"]["scrollHeight"] > tall["content"]["clientHeight"], (
                f"the drawer has nothing to scroll: {tall['content']}"
            )

            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )
            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"

            # The live box the wheel must target, measured with the list open.
            before = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert before["ok"], before
            content = before["content"]
            rect = content["rect"]
            # The open list floats over the card, so the wheel has to land on a
            # card point the list does not cover — otherwise the list eats it
            # and the drawer never scrolls.
            dropdown = rows["dropdownRect"]
            corners = [
                (rect["left"] + 24, rect["top"] + 24),
                (rect["right"] - 24, rect["top"] + 24),
                (rect["left"] + 24, rect["bottom"] - 24),
                (rect["right"] - 24, rect["bottom"] - 24),
            ]
            free = [
                (x, y)
                for x, y in corners
                if not (
                    dropdown["left"] <= x <= dropdown["right"]
                    and dropdown["top"] <= y <= dropdown["bottom"]
                )
            ]
            assert free, (
                "the open list covers the whole card, no wheel target left: "
                f"card={rect} list={dropdown}"
            )
            x, y = free[0]
            page.mouse.move(x, y)
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(300)

            after = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert after["content"]["scrollTop"] > 0, (
                f"the wheel over the card did not scroll it: {content}"
            )
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], f"scrolling dismissed the drawer: {state}"
            assert state["dropdownPresent"], (
                f"scrolling must re-pin the portalled list, not close it: {state}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_outside_press_still_dismisses(self, browser, tmp_path):
        """A press outside the drawer and its portalled list still dismisses it.

        Portal awareness must not turn the dismiss into a no-op: the map is
        still outside the overlay, and a press there closes the drawer.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_outside",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )
            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"

            viewport = ready["viewport"]
            page.mouse.click(60, viewport["height"] - 80)

            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert not state["drawerVisible"], (
                f"a press on the map must dismiss the drawer: {state}"
            )
            assert not state["dropdownPresent"], state
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_rehosts_under_fullscreen(self, browser, tmp_path):
        """Fullscreen re-hosts the portalled list; a pick there keeps the drawer.

        The picker moves its list into document.fullscreenElement when it
        exists, so the same press has to stay inside the overlay after the
        re-host. Headless browsers may refuse the Fullscreen API without a user
        gesture — that leg reports why it is skipped instead of failing, and the
        re-host itself is pinned by the jsdom suite.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_fullscreen",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            # A real press opens the list and supplies the user activation
            # requestFullscreen needs.
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )

            full = page.evaluate(_js("LayerControl/style_scheme_portal_fullscreen"))
            if not full.get("ok"):
                pytest.skip(
                    f"headless browser refused fullscreen: {full.get('reason')}"
                )
            assert full["fullscreen"], full
            assert full["rehosted"], (
                f"the portalled list did not move into the fullscreen element: {full}"
            )

            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], rows
            page.mouse.click(rows["targetX"], rows["targetY"])
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], (
                f"a color press under fullscreen dismissed the drawer: {state}"
            )
            assert not errors, f"JS errors: {errors}"
            page.evaluate(_js("LayerControl/exit_fullscreen"))

    @pytest.mark.parametrize("how", ["outside", "escape"])
    def test_style_mode_dropdown_outside_press_dismisses(self, browser, tmp_path, how):
        """Both mode dropdowns (fill and border) close on a dismissal.

        The mode row uses the shared dropdown bridged to a hidden native
        select. #1011 made the overlay registry the single Escape and
        outside-press dispatcher; a mode dropdown that does not register its
        overlay would never dismiss on an outside press or an Escape. This
        pins both consumers (fill and border) register, by both dismissal
        channels — the border row is the one that regressed. The fill row is
        the control: it already registered.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="mode_dropdown_press"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            # Border first: the regression. The mode row opens its dropdown
            # on a click of the trigger; a dismissal must close it.
            border = page.evaluate(
                _js("LayerControl/mode_dropdown_outside_press"),
                {"which": "border", "how": how},
            )
            assert border["ok"], border
            assert border["openAfterClick"], border
            assert border["dismissed"], (
                f"border mode dropdown did not close on {how}: {border}"
            )
            # Fill: control, already registered — must behave the same.
            fill = page.evaluate(
                _js("LayerControl/mode_dropdown_outside_press"),
                {"which": "fill", "how": how},
            )
            assert fill["ok"], fill
            assert fill["openAfterClick"], fill
            assert fill["dismissed"], (
                f"fill mode dropdown did not close on {how}: {fill}"
            )
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("which", ["border", "fill"])
    @pytest.mark.parametrize("how", ["outside", "escape"])
    def test_style_mode_dropdown_overlay_contract(self, browser, tmp_path, which, how):
        """The shared dropdown overlay contract holds on both mode rows.

        Every dropdown surface must register with the overlay registry (the
        single Escape/outside-press dispatcher from #1011). Four behaviours pin
        the contract: opening registers the dropdown above its host panel
        (so an Escape or outside press closes the dropdown first and not the
        panel), and the trigger regains focus after the dismissal. The border
        row is the regression this guards; the fill row is the control.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="dropdown_overlay_contract"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            result = page.evaluate(
                _js("LayerControl/dropdown_overlay_contract"),
                {"which": which, "how": how},
            )
            assert result["ok"], result
            assert result["openAfterClick"], result
            assert result["panelOpenBefore"], result
            assert result["focusedTriggerBefore"], result
            assert result["dismissed"], (
                f"{which} mode dropdown did not close on {how}: {result}"
            )
            assert result["panelStayedOpen"], (
                f"{how} closed the style panel instead of only the dropdown: {result}"
            )
            assert result["focusReturned"], (
                f"{which} trigger did not regain focus after {how}: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_style_panel_opens_downward_and_scrolls_inside(self, browser, tmp_path):
        """The pinned style card opens downward and scrolls its own content.

        A row near the top has plenty of room below, so placement keeps the card
        under it and caps it to the measured strip instead of the old fixed
        400px token. The content's own scrollbar keeps the long panel usable,
        and a wheel over the card must stay inside it instead of chaining to the
        layer list behind.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="row_panel_scroll"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            page.wait_for_timeout(200)

            before = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert before["ok"], before
            assert before["position"] == "fixed", before
            assert before["pinned"] is True, before
            assert before["opensDownward"], (
                f"the pinned card opened above its row: {before}"
            )
            gap = before["panel"]["top"] - before["row"]["bottom"]
            assert 0 < gap <= 8, before
            assert before["content"]["overflowY"] == "auto", before
            assert before["content"]["panelMaxHeight"] != "400px", (
                "placement should write the measured strip, not the token "
                f"default: {before['content']}"
            )
            assert (
                before["content"]["scrollHeight"] > before["content"]["clientHeight"]
            ), f"the long style panel does not need its own scrollbar: {before}"

            rect = before["content"]["rect"]
            page.mouse.move(
                rect["left"] + rect["width"] / 2, rect["top"] + rect["height"] / 2
            )
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(300)

            after = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert after["content"]["scrollTop"] > 0, (
                "the wheel over the card did not scroll its content: "
                f"{before['content']} -> {after['content']}"
            )
            assert after["listScrollTop"] == before["listScrollTop"], (
                "the wheel chained to the layer list instead of the card: "
                f"{before['listScrollTop']} -> {after['listScrollTop']}"
            )
            assert after["opensDownward"], (
                f"the card left its downward placement after scrolling: {after}"
            )
            assert not errors, f"JS errors: {errors}"
