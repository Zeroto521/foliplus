"""Split of test_panel.py by dimension."""

from __future__ import annotations

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
