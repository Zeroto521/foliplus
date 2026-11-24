"""Browser tests for the overlay dropdown: outside-press lifetime, drawer nesting, row geometry and touch drag."""

from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)
from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from ..helper import _expand_panel, _geo_mixed, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestPanelBrowser(LayerControlBrowserBase):
    def test_panel_stays_open_on_outside_press_by_default(self, browser, tmp_path):
        """A press on the map does not collapse the panel.

        ``collapse_on_outside`` defaults to ``False``: the panel is a working
        surface read at the same time as the map, and the map's busiest gesture
        is drag-pan / click-select. Hiding a panel the user is actively working
        in because of that gesture is the defect the parameter was added for;
        the header close affordance remains the explicit way to collapse, so
        nothing is lost.

        Replaces the #303 parity guard that asserted the opposite. At the time,
        "LayerControl and HeatmapControl behave the same" was the goal; a panel
        that hides while you work in it turned out to be the bug.

        Events go through Playwright's mouse so the browser does the hit-testing
        and the document-level capture/bubble pair sees real propagation — not a
        ``dispatchEvent`` aimed at the handler.
        """
        layer = folium.FeatureGroup(name="Outside click")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="outside_click"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), "toggle failed"

            page.mouse.click(900, 450)
            page.wait_for_timeout(300)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "a click on the map collapsed the panel; the default is False"
            )

            page.mouse.down()
            page.mouse.move(760, 380, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "a drag-pan on the map collapsed the panel; the default is False"
            )
            assert not errors, f"JS errors: {errors}"

    def test_panel_collapses_on_outside_press_when_enabled(self, browser, tmp_path):
        """``collapse_on_outside=True`` re-enables the implicit trigger.

        Proves the parameter is wired end to end — Python constructor -> CONFIG ->
        shell -> ``bindOutsideCollapse`` — rather than accepted and ignored.
        """
        layer = folium.FeatureGroup(name="Outside click on")
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            layer,
            slug="outside_click_on",
            collapse_on_outside=True,
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)
            assert self._panel_open(page, ".foliplus-layer-ctrl"), "toggle failed"

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=5000,
            )
            assert not self._panel_open(page, ".foliplus-layer-ctrl"), (
                "the panel stayed open after an outside press with "
                "collapse_on_outside=True"
            )
            assert not errors, f"JS errors: {errors}"

    def test_row_panel_still_dismisses_on_outside_press(self, browser, tmp_path):
        """The floating attrs panel still dismisses on an outside press.

        The main panel lost its implicit collapse; the row panels are popups,
        where dismissing on an outside press is their only cancel affordance,
        and they dismiss through their own document-capture ``mousedown``
        handler rather than through the shell. This pins that the shell change
        did not take them down with it.
        """
        layer = folium.FeatureGroup(name="Row panel")
        with use_page(self._make_page, browser, tmp_path, layer, slug="row_panel") as (
            page,
            errors,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            page.mouse.move(5, 400)
            page.evaluate(_js("LayerControl/click_first_overlay_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="attached", timeout=5000
            )

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="detached", timeout=5000
            )
            assert self._panel_open(page, ".foliplus-layer-ctrl"), (
                "the press that dismissed the row panel also collapsed the main panel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_row_overlay_stays_visible_over_lit_siblings(self, browser, tmp_path):
        """Sibling rows keep their hover wake while a row overlay is open —
        that is their own state display and the overlay is the pointer's
        destination, not a modal. The guarantee is the overlay staying
        visible: the owner row is lifted to the floating index (the
        overlay's z-index is confined to the owner's stacking context
        whenever the owner is hovered), so no lit sibling can paint over it.
        Probes both the ⋮ menu and the attrs panel: hovering a sibling
        LIGHTS it, and the point at the overlay's center still resolves to
        the overlay itself."""
        layers = [
            folium.FeatureGroup(name=f"Overlay {i}", overlay=True, show=True)
            for i in range(3)
        ]
        with use_page(self._make_page, browser, tmp_path, *layers) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(5, 400)  # pointer off the panel

            ROW = ".foliplus-layer-item[data-layer-type=overlay]"

            def row_wake(idx):
                # The Row-cursor wake of a sibling row: glow + drag grip.
                # Nothing may suppress it — it is the row's own state display.
                return page.evaluate(_js("LayerControl/row_wake"), [idx, ROW])

            def overlay_topmost(sel):
                # The point at the overlay's center must resolve to the overlay
                # itself — a lit sibling would otherwise paint over it.
                return page.evaluate(_js("LayerControl/overlay_topmost"), sel)

            def open_more_on_first_row():
                page.evaluate(_js("LayerControl/click_first_row_more_btn"), ROW)
                page.wait_for_selector(
                    ".foliplus-layer-more-menu.open", state="attached", timeout=5000
                )

            # ── ⋮ menu open: a hovering sibling wakes, the menu stays topmost ──
            open_more_on_first_row()
            page.hover(":nth-match(" + ROW + ", 2)")
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[ROW + " .foliplus-layer-rail .drag-handle", 1, "1"],
                timeout=2000,
            )
            assert page.is_visible(".foliplus-layer-more-menu.open")
            wake = row_wake(1)
            assert wake["glow"] is True, (
                "a sibling hover must keep its wake under an open overlay, got "
                + str(wake)
            )
            assert overlay_topmost(".foliplus-layer-more-menu") is True, (
                "the open menu must stay above a lit sibling (owner lifted)"
            )

            # The owner anchor: the menu is the row's descendant, so the row
            # that owns it stays lit while the pointer is on the menu.
            page.hover(".foliplus-layer-more-menu.open button")
            page.wait_for_timeout(250)
            assert page.evaluate(_js("LayerControl/read_owner_row_lit")), (
                "the row owning the open menu must stay lit while hovering it"
            )

            # ── attrs panel open: same contract ──
            # Escape closes the menu without collapsing the panel (a click
            # outside the panel would — bindOutsideCollapse).
            page.keyboard.press("Escape")
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="detached", timeout=5000
            )
            page.mouse.move(5, 400)
            open_more_on_first_row()
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="attached", timeout=5000
            )
            # The 280px attrs card fully covers the rows below the owner, so
            # the wake probe uses the toggle-all header above it instead.
            SEP = ".foliplus-layer-sep.foliplus-layer-toggle-all"
            page.hover(SEP)
            page.wait_for_function(
                _js("LayerControl/wait_sep_glow"),
                arg=SEP,
                timeout=2000,
            )
            assert overlay_topmost(".foliplus-layer-attrs-panel") is True, (
                "the open attrs panel must stay above a lit sibling"
            )


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl().add_to(m)
    # A second control on the map gives a real press target outside the layer
    # panel (the "press elsewhere ends the rename" invariant).
    HeatmapControl().add_to(m)
    data = load_geojson("common", "polygons_fuzhou_3offset")
    folium.GeoJson(json.dumps(data), name="Polygon data").add_to(m)
    return make_browser_page(browser, tmp_path, m.get_root().render(), "style_dropdown")


def _open_drawer(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel"))
    assert opened["ok"], opened
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible")


class TestStyleDrawerDropdownBrowser:
    def test_a_press_on_a_row_keeps_both_panels_open(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            trigger = page.evaluate(FIRST_TRIGGER)
            assert trigger, "the drawer has no dropdown row"
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(180)
            opened = page.evaluate(STATE)
            assert opened["openLists"] == 1, opened

            option = page.evaluate(FIRST_OPTION)
            assert option, "the popup has no enabled row"
            page.mouse.click(option["x"], option["y"])
            page.wait_for_timeout(220)
            after = page.evaluate(STATE)
            assert after["openLists"] == 0, after
            assert after["rowPanelExpanded"], (
                "pressing a portalled row collapsed the row panel"
            )
            assert after["drawerVisible"], "pressing a row dismissed the style drawer"
            assert not errors, f"JS errors: {errors}"

    def test_escape_closes_the_popup_only(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            trigger = page.evaluate(FIRST_TRIGGER)
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(180)
            assert page.evaluate(STATE)["openLists"] == 1

            page.keyboard.press("Escape")
            page.wait_for_timeout(220)
            after = page.evaluate(STATE)
            assert after["openLists"] == 0, after
            assert after["drawerVisible"], (
                "Escape closed the drawer, not just the popup"
            )
            assert after["rowPanelExpanded"], after
            assert not errors, f"JS errors: {errors}"

    def test_opening_the_drawer_ends_an_inline_rename(self, browser, tmp_path):
        """Invariant behind the popup claiming Escape on window capture.

        A dropdown is only reachable from the style drawer, and opening the
        drawer ends a live row rename (the input leaves the DOM and focus
        returns to the row). That is why no surface ranked above the popup in
        core/overlayRegistry's ESC_PRIORITY can be open at the same time, so
        claiming Escape on window capture cannot steal a rename cancel.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/rename_first_layer"))
            page.wait_for_timeout(250)
            assert page.evaluate(snippet("LayerControl/has_rename_input")), (
                "the rename input did not open"
            )

            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], opened
            page.wait_for_timeout(250)
            assert page.evaluate(snippet("LayerControl/has_style_panel"))
            assert not page.evaluate(snippet("LayerControl/has_rename_input")), (
                "opening the style drawer left the row rename live; the popup's "
                "window-capture Escape could then steal the rename's cancel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_a_real_press_on_another_panel_ends_the_rename(self, browser, tmp_path):
        """The rename ends before any other surface can take focus.

        The popup claims Escape on window capture, ahead of the document-level
        overlay dispatcher. That is only safe because a live rename cannot
        coexist with a popup: a real pointer press anywhere outside the rename —
        here on the heatmap panel's toggle — ends it first. This test pins the
        second path (the style-drawer path is pinned above).
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached")
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached"
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/rename_first_layer"))
            page.wait_for_timeout(250)
            assert page.evaluate(snippet("LayerControl/has_rename_input")), (
                "the rename input did not open"
            )

            toggle = page.evaluate(snippet("LayerControl/dropdown_heatmap_toggle"))
            page.mouse.click(toggle["x"], toggle["y"])
            page.wait_for_timeout(300)
            assert not page.evaluate(snippet("LayerControl/has_rename_input")), (
                "a real press on another panel left the row rename live; the "
                "popup's window-capture Escape could then steal the rename cancel"
            )
            assert not errors, f"JS errors: {errors}"

    def test_an_outside_press_still_dismisses_the_drawer(self, browser, tmp_path):
        """The portal ownership must not disarm the panel's own dismissal."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _open_drawer(page)
            page.mouse.click(5, 5)
            page.wait_for_timeout(260)
            after = page.evaluate(STATE)
            assert after["drawerVisible"] is False, (
                "an outside press no longer dismisses the style drawer"
            )
            assert not errors, f"JS errors: {errors}"


def _make_geometry_page(browser, tmp_path, locale):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
    for i, feat in enumerate(data["features"]):
        feat["properties"] = {
            "score": 10 + i,
            # A data-driven label wider than the 160px control cell: the
            # open list has to stop at the cell, not grow past the panel.
            "population_density_2020_index": 100 + i,
        }
    folium.GeoJson(json.dumps(data), name="Polygon data").add_to(m)
    LayerControl(locale=locale).add_to(m)
    return make_browser_page(
        browser, tmp_path, m.get_root().render(), f"geometry_{locale}"
    )


def _open_ramp_row(page) -> None:
    _open_drawer(page)
    assert page.evaluate(_TO_RAMP), "the fill row has no mode control"
    page.wait_for_timeout(200)


class TestFillRowGeometryBrowser:
    @pytest.mark.parametrize("locale", ["en", "zh"])
    def test_the_inline_group_fits_the_control_cell(self, browser, tmp_path, locale):
        with use_page(
            lambda b, t: _make_geometry_page(b, t, locale), browser, tmp_path
        ) as (page, errors):
            _open_ramp_row(page)
            got = page.evaluate(_GEOMETRY)
            assert "error" not in got, got
            # The page really rendered this locale before any geometry is read.
            assert got["methodLabel"] == _METHOD_TEXT[locale], got

            # Method + gap + Classes is one cell, not more: the group may not
            # overflow the control column (before the wrapper's min-width: 0 the
            # English row measured 122.6 + 4 + 52 against a 160px cell).
            gap = got["classes"]["left"] - got["method"]["right"]
            assert got["method"]["w"] + gap + got["classes"]["w"] <= (
                got["control"]["w"] + 0.5
            ), got
            assert got["inline"]["w"] <= got["control"]["w"] + 0.5, got
            assert got["classes"]["right"] <= got["control"]["right"] + 0.5, got
            # Nothing spills out of the drawer either.
            assert got["panelScrollX"] == 0, got

            # The row is fixed width, so the closed control shortens the label —
            # but it must be an ellipsis (with the full name on the tooltip and
            # the accessible name), never a hard clip and never an overflow.
            if locale == "en":
                assert got["ellipsized"] is True, got
            else:
                assert got["ellipsized"] is False, got
            assert got["title"], got
            assert got["ariaLabel"], got

    @pytest.mark.parametrize("locale", ["en", "zh"])
    def test_the_open_list_spells_the_label_out_without_leaving_the_cell(
        self, browser, tmp_path, locale
    ):
        with use_page(
            lambda b, t: _make_geometry_page(b, t, locale), browser, tmp_path
        ) as (page, errors):
            _open_ramp_row(page)
            got = page.evaluate(_GEOMETRY)
            assert "error" not in got, got

            method_list = got["methodList"]
            assert method_list, "the method popup did not open"
            # The row ellipsizes the label on purpose, so the popup reclaims the
            # width it needs — and stops at the cell's right edge.
            assert method_list["w"] >= got["method"]["w"] - 0.5, (method_list, got)
            assert method_list["right"] <= got["control"]["right"] + 0.5, (
                method_list,
                got,
            )
            truncated = [o["text"] for o in method_list["labels"] if o["truncated"]]
            assert truncated == [], (
                "the open method list truncates the very label the row implies "
                f"it can show: {truncated}"
            )

            # A data-driven label (a field name) can be wider than the cell: the
            # popup then stops at the cell instead of growing past the panel.
            field_list = got["fieldList"]
            assert field_list, "the field popup did not open"
            assert field_list["right"] <= field_list["controlRight"] + 0.5, (
                field_list,
            )
            assert not errors, f"JS errors: {errors}"


class TestDropdownListTouchBrowser:
    """A touch drag over an open dropdown list scrolls the list, not the map."""

    def test_touch_drag_over_the_enum_dropdown_does_not_pan_the_map(
        self, touch_browser, tmp_path
    ):
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="Touch scroll",
        )
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        layer.add_to(m)
        html = m.get_root().render()
        with use_page(make_browser_page, touch_browser, tmp_path, html, "dropdown") as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                "document.querySelector('.foliplus-layer-ctrl .foliplus-toggle-btn')?.click()"
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(200)
            assert page.evaluate(snippet("LayerControl/open_enum_dropdown")) is True
            page.wait_for_selector(
                ".foliplus-dropdown-list", state="visible", timeout=5000
            )
            rect = page.evaluate(
                f"({snippet_fn('common/element_rect')})('.foliplus-dropdown-list')"
            )
            scrolled = (
                f"({snippet_fn('common/read_scroll_top')})('.foliplus-dropdown-list')"
            )
            st0 = page.evaluate(scrolled)
            before = map_center_zoom(page)
            touch_drag(
                page,
                rect["x"] + rect["w"] / 2,
                rect["y"] + rect["h"] / 2,
                rect["y"] + rect["h"] / 2 - 80,
            )
            page.wait_for_timeout(300)
            assert_map_unchanged(before, map_center_zoom(page))
            # The list itself scrolls: 12 options overflow the capped height.
            assert page.evaluate(scrolled) != st0
            assert not errors, f"JS errors: {errors}"
