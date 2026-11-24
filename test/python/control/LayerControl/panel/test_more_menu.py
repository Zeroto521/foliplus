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
    def test_menu_shell_keeps_design_padding_under_bootstrap(self, browser, tmp_path):
        """The layer more-menu shell keeps its design padding on a host
        Bootstrap page.

        Bootstrap ships an unlayered `ol,ul{padding-left:2rem}` reset. After
        #568 wrapped foliplus CSS in @layer, that reset outranked the shell at
        any specificity and pushed the icon column inward. The @layer wrap was
        reverted, restoring the specificity order: the shell selector
        (0,2,0) beats `ul` (0,0,1), so the icon column stays flush with the
        shell's left padding. This pins the computed padding-left in the real
        folium page (Bootstrap included), which the plain unit tests cannot
        see.
        """
        layer = folium.FeatureGroup(name="Menu shell", overlay=True, show=True)
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="menu_shell_padding"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(400)
            page.evaluate(_js("LayerControl/click_first_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            padding_left = page.evaluate(_js("LayerControl/read_more_menu_padding"))
            assert padding_left == "0px", (
                f"menu shell padding-left drifted under Bootstrap: {padding_left!r}"
            )
            assert not errors, f"JS errors: {errors}"
    def test_row_more_button_keeps_native_activation_keys(self, browser, tmp_path):
        """Enter/Space on a row's ⋮ button still open its menu natively.

        The ownership table now lets a focused <button> keep Enter/Space, so
        the row shortcut no longer runs for these keys: the menu has to open
        through the button's own click, the same native activation the panel
        close × relies on. The checkbox must not flip either way.

        This is a regression guard, not a fail-before-fix case: the previous
        handler carried its own "activeElement is the ⋮ button" branch, so the
        test also passed on the old head. It pins that the native path replaced
        that branch without losing the keyboard affordance.
        """
        geo = folium.GeoJson(_geo_mixed, name="Point layer")
        with use_page(
            self._make_page, browser, tmp_path, geo, slug="row_more_button_keys"
        ) as (page, errors):
            panel_ready(page)
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

            for key in ("Space", "Enter"):
                arm = page.evaluate(_js("LayerControl/row_more_button_arm"))
                assert arm.get("error") is None, f"{key}: setup failed: {arm}"
                assert "foliplus-layer-more-btn" in arm["focusedClass"], (
                    f"{key}: the ⋮ button did not take focus: {arm}"
                )

                page.keyboard.press(key)

                read = page.evaluate(_js("LayerControl/row_more_button_read"))
                assert read["menuOpen"] is True, (
                    f"{key}: the native activation did not open the menu: {read}"
                )
                assert read["checkboxAfter"] == arm["checkboxBefore"], (
                    f"{key}: the row shortcut flipped the layer checkbox: "
                    f"before={arm['checkboxBefore']} after={read['checkboxAfter']}"
                )

                # Close the menu and hand focus back to the row before the
                # next activation key.
                page.keyboard.press("Escape")
                page.wait_for_selector(
                    ".foliplus-layer-more-menu.open",
                    state="detached",
                    timeout=5000,
                )
            assert not errors, f"JS errors: {errors}"
    def test_menu_item_activation_keys_run_their_own_action(self, browser, tmp_path):
        """Enter/Space on a ⋮ menu entry runs that entry's action.

        Regression: the keyboard handler knew three of the six actions and sent
        Style, Attributes and Filter to focus-layer, so those entries showed the
        "layer has no geographic extent" hint instead of opening the panel,
        while a click on the same entry worked. The entry is an
        <button role=menuitem>, so Chromium fires a native click for Enter/Space and
        the interaction manager stands aside for the button — one
        real key press proves the whole chain. Mouse and keyboard are compared on
        the same entries, then each surface is reached through both activation
        keys, and the two-step delete is exercised from both inputs.
        """
        first = folium.GeoJson(_geo_mixed, name="Point layer A")
        second = folium.GeoJson(_geo_mixed, name="Point layer B")
        with use_page(
            self._make_page, browser, tmp_path, first, second, slug="menu_item_keys"
        ) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )

            def arm(action: str, row_index: int = 0) -> dict:
                state = page.evaluate(
                    _js("LayerControl/menu_keyboard_arm"),
                    {"action": action, "rowIndex": row_index},
                )
                assert state.get("error") is None, f"{action}: arm failed: {state}"
                assert state["menuOpen"], f"{action}: menu did not open: {state}"
                assert state["focused"], f"{action}: entry did not take focus: {state}"
                assert not state["disabled"], f"{action}: entry is disabled: {state}"
                return state

            def read() -> dict:
                return page.evaluate(_js("LayerControl/menu_keyboard_read"))

            style_entry = '.foliplus-layer-more-menu button[data-action="style-layer"]'
            attrs_entry = (
                '.foliplus-layer-more-menu button[data-action="layer-attributes"]'
            )
            delete_entry = (
                '.foliplus-layer-more-menu button[data-action="delete-layer"]'
            )

            # Mouse baseline: each entry opens its own panel from a click, so
            # the keyboard cases below can assert identical outcomes.
            arm("style-layer")
            page.click(style_entry)
            state = read()
            assert state["styleOpen"] and not state["menuOpen"], (
                f"mouse click on Style did not open the panel: {state}"
            )

            arm("layer-attributes")
            page.click(attrs_entry)
            state = read()
            assert state["attrsOpen"] and not state["menuOpen"], (
                f"mouse click on Attributes did not open the panel: {state}"
            )

            # Keyboard: the entry runs its own action, never focus-layer.
            for action, key, probe in (
                ("style-layer", "Enter", "styleOpen"),
                ("style-layer", "Space", "styleOpen"),
                ("layer-attributes", "Enter", "attrsOpen"),
                ("layer-attributes", "Space", "attrsOpen"),
            ):
                arm(action)
                page.keyboard.press(key)
                state = read()
                assert state[probe] is True, f"{key} on {action}: panel closed: {state}"
                assert state["menuOpen"] is False, (
                    f"{key} on {action}: menu stayed open: {state}"
                )

            # Keyboard rename opens the inline editor and closes the menu.
            arm("rename-layer")
            page.keyboard.press("Enter")
            state = read()
            assert state["renameInput"] is True, f"Enter on Rename: no input: {state}"
            assert state["menuOpen"] is False, f"Enter on Rename: menu open: {state}"
            # Escape finishes the rename and returns focus to the row.
            page.keyboard.press("Escape")

            # Keyboard delete keeps the two-step arm/confirm contract.
            before = read()["rows"]
            arm("delete-layer")
            page.keyboard.press("Enter")
            state = read()
            assert state["deleteArmed"] is True, f"Enter on Delete: not armed: {state}"
            assert state["menuOpen"] is True, f"Enter on Delete: menu closed: {state}"
            page.keyboard.press("Enter")
            state = read()
            assert state["menuOpen"] is False, f"Enter on Delete: menu open: {state}"
            assert state["rows"] == before - 1, f"Enter on Delete: row kept: {state}"

            # Mouse delete on the remaining row follows the same two steps.
            before = state["rows"]
            arm("delete-layer")
            page.click(delete_entry)
            state = read()
            assert state["deleteArmed"] is True, f"click on Delete: not armed: {state}"
            assert state["menuOpen"] is True, f"click on Delete: menu closed: {state}"
            page.click(delete_entry)
            state = read()
            assert state["menuOpen"] is False, f"click on Delete: menu open: {state}"
            assert state["rows"] == before - 1, f"click on Delete: row kept: {state}"

            assert not errors, f"JS errors: {errors}"
