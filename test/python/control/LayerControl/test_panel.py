"""Browser tests for foliplus.LayerControl — panel lifecycle, keydown/focus, register/pane, reload/persist, drag."""

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

from ._browser_base import LayerControlBrowserBase
from .helper import _expand_panel, _geo_mixed, _write_html


class TestPanelBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — panel lifecycle, keydown/focus, register/pane, reload/persist, drag."""

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

    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base role should show blocked hint."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        # The gate reads the hint's English wording, so pin the page locale
        # rather than depending on the machine's ambient language.
        with use_page(
            self._make_page, browser, tmp_path, overlay, base, locale="en"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/dispatch_cross_group_dragover"))
            assert ok, "Failed to dispatch simulated cross-role dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(_js("LayerControl/read_hint_text"))
            assert ("same group" in hint_text.lower()) or ("同分组" in hint_text)

    def test_remove_readd_restores_layer_api(self, browser, tmp_path):
        """Re-add after removeControl upgrades LayerAPI back to full and re-attaches panel."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/destroy_readd"))
            assert state["afterRemoveStub"] is True
            assert state["afterAddFull"] is True
            assert state["panelAttached"] is True
            panel_ready(page)  # rebuilt panel completes its init pass again
            assert not errors, f"JS errors: {errors}"

    def test_remove_readd_leaves_no_listener_residue(self, browser, tmp_path):
        """N=3 remove → add cycles must not grow map._events listener sum.

        Hard regression gate: baseline round[0] is captured right after the
        initial addControl (harness already ran that in page setup);
        rounds[1] and rounds[2] follow remove → add. Any drift — whether on
        round[0] or in a later round — fails the assertion.

        The gate is what caught the `dismissFocus` → `ensureModes` first-call
        side effect leaking a `map.on('unload', ...)` handler at round[1]
        (fix in foliplus/js/control/LayerControl/ui/focus/index.ts). See the probe comment
        in test/js/browser/LayerControl/probe_listener_residue.js for the
        historical note.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/probe_listener_residue"))
            rounds = state["rounds"]
            assert len(rounds) == 3, f"expected 3 rounds, got {rounds!r}"
            for i, n in enumerate(rounds[1:], start=1):
                assert n == rounds[0], (
                    f"LayerControl: map._events listener sum grew on round {i}: "
                    f"{rounds!r}"
                )
            panel_ready(page)
            assert not errors, f"JS errors: {errors}"

    def test_probe_leak_listener_control_group_grows(self, browser, tmp_path):
        """A single bare map.on() must register as a +1 in the listener sum.

        Control group for the drift gate above: if this control fails, the
        sumMapEvents measure is measuring nothing and the drift assertion
        in test_remove_readd_leaves_no_listener_residue has no teeth.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/probe_leak_listener"))
            assert result["delta"] > 0, (
                f"Leak control group: expected a positive delta, got {result!r}"
            )
            assert not errors, f"JS errors: {errors}"

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
            result = page.evaluate(
                _js("LayerControl/add_graph_sets_pane"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["pane"] == "__pane_test_graph__", f"got {result['pane']}"
            assert result["hasRenderer"] is True, "renderer not set"
            assert result["registered"] is True, "not registered after addLayer"

    def test_clear_all_unregisters(self, browser, tmp_path):
        """clearAll clears content and unregisters the layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/clear_all_unregisters"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None
            assert result["beforeRegistered"] is True
            assert result["afterRegistered"] is False

    def test_geojson_group_pins_children_to_declared_pane(self, browser, tmp_path):
        """A GeoJSON group's child paths render into the declared data pane.

        ``addLayer`` writes ``options.pane`` on the node it is handed, and
        Leaflet ignores a group's pane for its children — each child joins the
        map on its own.  Without the recursive pin the shapes would draw into
        the map's default pane even though every option says otherwise.
        """
        with use_page(self._make_page, browser, tmp_path, slug="geojson_pane") as (
            page,
            errors,
        ):
            result = page.evaluate(
                _js("LayerControl/geojson_group_pins_children_pane"),
                load_geojson("LayerControl", "line_polygon_panes"),
            )
            assert result is not None, "LayerAPI not found"
            assert result["paneExists"], f"declared pane was never created: {result}"
            assert result["groupPane"] == "__geojson_pane__", result
            assert len(result["kids"]) == 2, f"unexpected child count: {result}"
            for kid in result["kids"]:
                assert kid["pane"] == "__geojson_pane__", f"child not pinned: {kid}"
                assert kid["hasRendererOpt"], f"child has no renderer option: {kid}"
                assert kid["hasRenderer"], f"child has no _renderer: {kid}"
                assert kid["isPath"], f"child has no renderer container: {kid}"
                # DOM truth: the SVG container's parent must be the declared pane element.
                assert kid["inDeclaredPane"] is True, (
                    f"child renders outside declared pane "
                    f"(parent: {kid['parentTag']}."
                    f"{kid['parentClass']}): {kid}"
                )
            assert not errors, f"JS errors: {errors}"

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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item",
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/rename_first_layer"))
            assert ok, "failed to open the inline rename input"
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )

            m = page.evaluate(_js("LayerControl/read_rename_input_geom"))
            assert m is not None, "no renaming row found"
            # Row's vertical padding is dropped while renaming…
            assert m["padTop"] == "0px", f"row padTop={m['padTop']}"
            assert m["padBottom"] == "0px", f"row padBottom={m['padBottom']}"
            # …so the input fills the whole row, not a 19.6px line-box.
            assert abs(m["inputH"] - m["rowH"]) <= 1, (
                f"input height {m['inputH']} != row height {m['rowH']}"
            )

    def test_unregister_layer_in_browser(self, browser, tmp_path):
        """unregisterLayer removes a dynamically registered layer."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/unregister_layer_flow"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
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
            assert api["hasSetVisible"]
            assert api["hasGetSize"]
            assert api["canvasTag"] == "CANVAS"
            assert api["canvasClass"], "canvas should carry foliplus-canvas-layer"
            assert api["parentIsPane"], "canvas should live in a foliplus-layer-pane"
            assert api["paneRegistered"], "canvas pane should be on the map"

    def test_canvas_register_unregister(self, browser, tmp_path):
        """Canvas register() creates a layer item; unregister() removes it.

        Also asserts the pane model: canvas mounts in its own pane, the ordering
        pass prices the pane from the layer stack, and only destroy() drops the
        pane from the map.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(_js("LayerControl/canvas_register_unregister_dom"))
            assert result is not None
            assert result["hasItem"], "Canvas layer item should exist after register"
            assert not result["hasItemAfter"], (
                "Canvas layer item should be removed after unregister"
            )
            assert result["inPane"], "canvas pane should have foliplus-layer-pane"
            assert result["canvasParent"], "canvas parent should be the dedicated pane"
            assert result["expectedPaneZ"], "canvas should hold a registry slot"
            assert result["paneZ"] == result["expectedPaneZ"], (
                "the ordering pass should price the canvas pane from the layer stack"
            )
            assert result["registeredPaneName"] == "foliplus-canvas-__test_canvas_reg__"
            assert result["paneAfterUnregister"], (
                "unregister keeps the pane for re-register"
            )
            assert not result["paneAfterDestroy"], "destroy drops the pane"

    def test_migrate_layers_marker_pane(self, browser, tmp_path):
        """pinLateContent moves Markers to per-layer panes."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_marker_pane"),
                {"point": leaflet_points("common", "point_1193_2608")[0]},
            )
            assert result is not None
            assert result["pane"] == "__test_marker_pane_graph__"

    def test_migrate_layers_path_pane(self, browser, tmp_path):
        """pinLateContent moves Path layers to the target pane."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_path_pane"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
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

    def test_row_panel_close_x_keeps_native_activation_keys(self, browser, tmp_path):
        """Space/Enter on a row panel's close × activate it, not the row checkbox.

        Regression: the close × is a real <button>, but the input-ownership
        table did not classify buttons as consuming Enter/Space. The
        document-level row-toggle shortcut therefore cancelled the key and
        flipped the layer checkbox behind the panel. Real keyboard presses go
        through Chromium — synthetic dispatchEvent cannot prove that the
        browser's own activation ran — and both row panels that exist today
        (attributes and style) are covered for both activation keys. The
        capture log reports whether foliplus cancelled the key; the checkbox
        state proves the row shortcut did not run.
        """
        geo = folium.GeoJson(_geo_mixed, name="Point layer")
        with use_page(
            self._make_page, browser, tmp_path, geo, slug="row_panel_close_x"
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

            for kind in ("attrs", "style"):
                for key in ("Space", "Enter"):
                    arm = page.evaluate(_js("LayerControl/row_panel_close_arm"), kind)
                    assert arm.get("error") is None, f"{kind}: setup failed: {arm}"
                    assert arm["focusedTag"] == "button", (
                        f"{kind}: the close × did not take focus: {arm}"
                    )
                    assert "foliplus-close-btn" in arm["focusedClass"], (
                        f"{kind}: focus is not on the close ×: {arm}"
                    )

                    page.keyboard.press(key)

                    read = page.evaluate(_js("LayerControl/row_panel_close_read"))
                    presses = [
                        r for r in (read["records"] or []) if r["tag"] == "button"
                    ]
                    assert len(presses) == 1, (
                        f"{kind}/{key}: expected one button keydown, "
                        f"got {read['records']}"
                    )
                    assert presses[0]["prevented"] is False, (
                        f"{kind}/{key}: foliplus cancelled the button's native "
                        f"activation key: {read['records']}"
                    )
                    assert not read["attrsOpen"] and not read["styleOpen"], (
                        f"{kind}/{key}: the close × did not close its panel: {read}"
                    )
                    assert read["checkboxAfter"] == arm["checkboxBefore"], (
                        f"{kind}/{key}: the row shortcut flipped the layer "
                        f"checkbox: before={arm['checkboxBefore']} "
                        f"after={read['checkboxAfter']}"
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

    def test_registry_matches_map_after_reload(self, browser, tmp_path):
        """The registry holds one entry per rendered row, and its ids are stable.

        Confirms the reload page's CONFIG data lands with one id per feature group
        and that the registry view and the map's own layer set agree, before any
        hiding happens. Anything the persistence funnel drops would show here.

        The page declares one overlay with ``show=False``, but that is honored
        by folium's own renderer, not by LayerControl: folium 0.14.0 emits
        ``.addTo(map)`` unconditionally and never removes it, so on that version
        every declared layer starts on the map. What this test pins is therefore
        the registry <-> map agreement itself, not the declared visibility --
        a mismatch shows up the same way either way.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_registry_ids.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            info = page.evaluate(_js("LayerControl/read_hidden_state"))
            # Overlays only: the two TileLayers are base rows, which the
            # selector excludes by class. A [data-layer-id] selector would count
            # each layer twice, since renderLayerItem stamps the id on the row
            # and again on its count cell.
            assert len(info["rows"]) == 2, f"expected 2 overlay rows, got {info}"
            ids = [r["id"] for r in info["rows"]]
            # Distinct ids: a duplicate would make the persisted hidden set apply
            # to only one of the two.
            assert len(set(ids)) == len(ids), f"duplicate layer ids in registry: {ids}"
            # The fixture throws if a rendered row has no registry entry, since
            # such a row's state has no source of truth. A null here means the
            # manager's own resolver could not find the Leaflet layer -- that
            # row cannot be added or removed, so no state on it can be honored
            # after a reload.
            unresolved = [r for r in info["rows"] if r["onMap"] is None]
            assert not unresolved, f"unresolved layers in registry: {unresolved}"
            # The registry's own flag and the Leaflet attachment agree per row.
            # Declared show=False is deliberately not asserted here: folium 0.14
            # adds every layer regardless, so the declared visibility differs
            # across folium versions while the registry/map agreement never does.
            for r in info["rows"]:
                assert r["checked"] == r["visible"] == r["onMap"], (
                    f"{r['id']}: checkbox, registry and map disagree: {info}"
                )

    def test_hidden_layers_survive_reload(self, browser, tmp_path):
        """A layer hidden by checkbox stays hidden across a reload.

        Regression guard for the persistence funnel: the write is debounced at
        100ms, so a reload inside that window previously landed on stale
        storage. Hiding happens here, the reload there -- the two pages are
        distinct so nothing survives except localStorage.

        Base layers plus a hidden-from-the-start overlay mirror a real folium
        page, where ``TileLayer(show=False)`` and the map's own theme layers
        share the panel with the data overlays.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 2, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "both overlays should be unchecked"

            # Let the debounce commit, then reload -- a reload inside the
            # window is what used to drop the write.
            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Re-checked rows, rows whose registry entry still claims visible,
            # and layers that are still attached to the map -- each half of the
            # projection, so the assertion cannot be satisfied by faking one.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is False, (
                    f"{row['id']}: row was re-checked after reload\n{rows}"
                )
                assert row["visible"] is False, (
                    f"{row['id']}: registry says visible but the user hid it\n{rows}"
                )
                assert row["onMap"] is False, (
                    f"{row['id']}: still attached to the map after reload\n{rows}"
                )

    def test_showing_author_hidden_layers_survives_reload(self, browser, tmp_path):
        """A layer the author declared ``show=False`` and the user checked ON
        comes back ON after a reload.

        This is the reported regression: the old hidden-mirror model recorded
        ``hiddenLayerIds`` as *which layers the user hid* rather than *which layers
        are hidden*, so an id that
        folium had rendered off-map was never in the set. Checking it on
        therefore removed nothing from nothing, storage stayed ``[]``, and the
        reload restored the author's defaults.

        It is also the inverse of test_hidden_layers_survive_reload: that one
        proves the hide half of the round trip, this one proves the unhide
        half. A sweep that only walks the hidden-intent values can never reach a
        layer the
        user left visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_show_hidden_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Observe the pre-state rather than assuming folium rendered the
            # declared show=False: folium 0.14.0 adds every layer and never
            # removes it, so the rows that start off-map differ across versions.
            # The point is the round trip -- whatever starts hidden must come
            # back checked -- not which folium produced the hidden set.
            before = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert before and len(before["rows"]) == 2, f"unexpected rows: {before}"
            for row in before["rows"]:
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree at load\n{before}"
                )

            show = page.evaluate(_js("LayerControl/show_author_hidden"))
            assert show is not None and show["rows"] == 2, f"unexpected rows: {show}"
            hidden_before = sum(1 for r in before["rows"] if not r["checked"])
            assert show["checked"] == hidden_before, (
                f"expected the {hidden_before} off-map layer(s) to be shown\n{show}"
            )
            assert show["stillUnchecked"] == 0, f"rows left unchecked\n{show}"

            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Each half of the projection is asserted separately, mirroring
            # test_hidden_layers_survive_reload: a UI-only fix (rows re-checked)
            # or a data-only fix (registry says visible) would not put the layer
            # back on the map.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is True, (
                    f"{row['id']}: row lost its check after reload\n{rows}"
                )
                assert row["visible"] is True, (
                    f"{row['id']}: registry reverted to the author default\n{rows}"
                )
                assert row["onMap"] is True, (
                    f"{row['id']}: never re-added to the map after reload\n{rows}"
                )

    def test_author_defaults_survive_a_reload_with_no_toggle(self, browser, tmp_path):
        """Author ``show=False`` layers stay hidden when the user never touched
        the panel, and reload repeatedly.

        Guards the other half of the same change: with no visibility key in
        storage the user has made no choice, so the unhide sweep must not
        override the author's defaults. Without that guard the first reload of
        a map like the quickstart re-added every hidden overlay.

        "Author defaults" here means whatever folium rendered at load, which is
        read rather than assumed: folium 0.14.0 adds every layer regardless of
        show=False, so the default is visible on that version. The user never
        touched the panel, so storage stays empty and the invariant is that a
        reload leaves the load state untouched -- whatever it was.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_author_defaults_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # No interaction at all -- the panel merely opened on load.
            initial = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert initial and len(initial["rows"]) == 1, (
                f"expected 1 row, got {initial}"
            )
            load_checked = initial["rows"][0]["checked"]
            load_storage = dict(initial["storage"])

            for _ in range(2):
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector(
                    ".foliplus-layer-ctrl", state="attached", timeout=10000
                )
                page.wait_for_selector(
                    ".foliplus-layer-ctrl.foliplus-is-expanded",
                    state="attached",
                    timeout=10000,
                )
                page.wait_for_timeout(500)

                rows = page.evaluate(_js("LayerControl/read_hidden_state"))
                assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
                row = rows["rows"][0]
                # The load state is untouched, and the three projections of it
                # still agree -- so a reload neither re-added a hidden layer
                # nor dropped one the author left on.
                assert row["checked"] is load_checked, (
                    f"reload with no user choice changed the load state\n{rows}"
                )
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree\n{rows}"
                )
                # Nothing may be persisted when the user never toggled: the
                # unhide sweep must not synthesise a choice and write it down,
                # and a runtime-created row (the color basemap) must not
                # rewrite the order the user arranged.
                assert rows["storage"] == load_storage, (
                    f"reload with no user choice wrote a stored record\n{rows}"
                )

    def test_hidden_layers_persist_across_reload(self, browser, tmp_path):
        """A hidden layer that re-registers later comes back hidden, not reset.

        HeatmapControl and MeasureControl register in their own constructor,
        which runs after the LayerControl IIFE has attached, so a hidden id can
        precede its row. The reload must leave the stored record alone -- a
        missing registry entry is not evidence that the state should go, only
        a delete is -- so when the component re-registers the layer returns the
        way the user left it instead of resurrecting visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Seed", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload_dynamic.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Register through LayerAPI, as a component's constructor would.
            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(100)

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 3, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "all overlays should be unchecked"
            assert len(set(hide["ids"])) == 3, f"duplicate row ids: {hide}"

            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # The probes were only registered at runtime, so they are gone
            # until re-registered -- and their ids survive the reload in
            # storage: nothing pruned them merely because their registry
            # entries did not.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
            assert rows["rows"][0]["checked"] is False
            assert rows["rows"][0]["visible"] is False
            assert rows["rows"][0]["onMap"] is False
            key = next(k for k in rows["storage"] if "layer_state" in k)
            layers = json.loads(rows["storage"][key]).get("layers", {})
            assert {lid for lid in layers if lid.startswith("__probe")} == {
                "__probeA__",
                "__probeB__",
            }, f"reload pruned ids it had no right to drop: {rows['storage']}"
            for lid in ("__probeA__", "__probeB__"):
                assert layers[lid]["visible"] is False, (
                    f"{lid}: reload changed a stored hidden state: {rows['storage']}"
                )

            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(300)

            # Re-registration restores the stored state instead of resetting
            # it: the probes come back off the map, unchecked, and the three
            # projections of their state still agree.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 3, f"expected 3 rows, got {rows}"
            for row in rows["rows"]:
                if row["id"].startswith("__probe"):
                    assert row["checked"] is False, (
                        f"{row['id']}: re-register reset a stored hidden state\n{rows}"
                    )
                    assert row["visible"] is False, (
                        f"{row['id']}: registry lost a stored hidden state\n{rows}"
                    )
                    assert row["onMap"] is False, (
                        f"{row['id']}: re-entered the map while hidden\n{rows}"
                    )

    def test_third_party_component_rename_survives_reload(self, browser, tmp_path):
        """A rename on a late-registering component (HeatmapControl) survives reload.

        Third-party components (HeatmapControl, MeasureControl) call
        ``registerLayer`` in their own constructors, which run after LayerControl
        has attached its panel. On the first attach the sweep runs before the
        component registers; on a later attach the component registers while
        ``applyUserState`` is replaying stored state. Without id-scoped replay the
        component's own ``name`` clobbers the user's rename on the reload -- the
        exact symptom of "renaming a third-party component does not stick
        across reload".

        This test seeds a HeatmapControl row with a user rename, reloads, and
        asserts the renamed label is the one the row paints (not the author
        default).
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08, {"val": 26.08})))
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html = m.get_root().render()
        match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
        assert match, "map variable not found in rendered HTML"

        # The persisted record the previous visit would have written: the heatmap
        # row is renamed to "My Heat" by the user. Id is the stable component id,
        # not a per-map suffix.
        seed = {
            "order": None,
            "foldedRoles": [],
            "renamedNames": {"foliplus_heatmap": "My Heat"},
            "annotations": {},
            "layers": {},
        }
        html_path = tmp_path / "test_third_party_rename_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.add_init_script(
                _js("LayerControl/seed_layer_state")
                .replace("__KEY__", match.group(1))
                .replace("__SEED__", json.dumps(json.dumps(seed)))
            )
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(300)

            after_attach = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_attach["rowPresent"] is True, (
                f"heatmap row missing after attach: {after_attach}"
            )
            assert after_attach["storedRename"] == "My Heat", (
                f"attach dropped the stored rename: {after_attach}"
            )
            assert after_attach["label"] == "My Heat", (
                f"attach painted the author default instead of the rename: "
                f"{after_attach}"
            )

            # A second reload must land the same way: a late-registered component
            # that runs its own `registerLayer` on the second attach used to
            # clobber the rename at the point where the sweep replayed it.
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(300)

            after_reload = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_reload["rowPresent"] is True, (
                f"heatmap row missing after reload: {after_reload}"
            )
            assert after_reload["storedRename"] == "My Heat", (
                f"reload dropped the stored rename: {after_reload}"
            )
            assert after_reload["label"] == "My Heat", (
                f"reload reverted the third-party component's rename to the "
                f"author default: {after_reload}"
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

    def test_base_basemap_reorder_repaints_z(self, browser, tmp_path):
        """Every base basemap repaints when its row moves.

        The z ladder is written onto each base layer's own pane
        (synthesized for tile layers, dedicated for the color basemap).
        Reordering two tile basemaps must flip their pane z-indexes AND the
        tiles must actually live in those panes — if they were still in the
        shared .leaflet-tile-pane (z fixed at 200 by Leaflet CSS), the swap
        would change numbers nothing draws on top of.
        """
        tile_a = folium.TileLayer("CartoDB positron", name="Tiles A", overlay=False)
        tile_b = folium.TileLayer("OpenStreetMap", name="Tiles B", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile_a, tile_b) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(600)

            state = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state["ok"] is True, state
            assert len(state["bases"]) >= 2, f"need two base layers, got {state}"

            # Tiles must paint inside each base layer's own pane, not the
            # shared tilePane — otherwise reorder cannot change the stack.
            assert state["sharedTilePaneImages"] == 0, (
                f"tiles still in shared tilePane: {state}"
            )
            for b in state["bases"]:
                if b["id"] == "foliplus_color_map":
                    continue
                assert b["paintsHere"] > 0, (
                    f"tile layer {b['name']} paints nothing in its own pane: {state}"
                )
                assert b["z"] is not None, (
                    f"tile layer {b['name']} has no ladder z: {state}"
                )

            # Swap the last tile above the first; the two tile panes' z must
            # flip with the row order.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "swap-tiles"})
            state2 = page.evaluate(_js("LayerControl/base_zorder_reorder"))
            assert state2["ok"] is True, state2
            zs2 = {b["id"]: b["z"] for b in state2["bases"]}
            moved = [b for b in state2["bases"] if b["id"] != "foliplus_color_map"]
            first_z2 = moved[0]["z"]
            last_z2 = moved[-1]["z"]
            # The tile that moved to the top must now sit above the other.
            assert first_z2 > last_z2, f"reordered tile panes did not flip z: {moved}"

    def test_register_layer_preserves_visible_on_reentry(self, browser, tmp_path):
        """registerLayer preserves the visible state from a previous registration.

        Intent is the single source of truth (#498): a hide recorded through
        setVisible survives unregisterLayer — which is a teardown, not a
        delete — and is replayed on the next registerLayer of the same id.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/register_preserves_visible_on_reentry")
            )
            assert result is not None
            assert result["defaultVisible"] is True, "Default visible should be true"
            assert result["newVisible"] is False, (
                "the hide recorded by setVisible must survive unregister/re-register; "
                f"got {result}"
            )

    def test_canvas_setvisible_emits_layer_change(self, browser, tmp_path):
        """setVisible on a canvas layer emits LAYER_CHANGE, matching native layers.

        Canvas-only surfaces (heatmap / measure / color face) have no Leaflet
        layer to add/remove; their visibility carrier is the canvas element's
        HIDDEN class. The executor's write of that class is the write that
        rides the bus alongside the native branch's map-membership writes —
        without it, subscribers (label, controller) would see canvas
        layers appear/disappear silently. A repeated setVisible that does
        not flip the class must not re-emit.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/create_canvas_visibility_emits"))
            assert result is not None, result
            assert not errors, f"JS errors: {errors}"

            # Registration itself emits one LAYER_CHANGE (layer entered the map).
            # That is a distinct lifecycle event from the setVisible writes we
            # are guarding; the counter is baselined past it.
            assert result["registerEmits"] == 1, result

            # setVisible(false): canvas gains HIDDEN and one LAYER_CHANGE rides
            # the bus — the canvas carrier flip matching native add/remove.
            assert result["hiddenAfterFalse"] is True, result
            assert result["eventsAfterFalse"] == 1, result
            assert result["lastAfterFalse"] == {
                "id": "__test_canvas_vis__",
                "kind": "canvas",
            }, result

            # setVisible(true): class removed and another LAYER_CHANGE.
            assert result["hiddenAfterTrue"] is False, result
            assert result["eventsAfterTrue"] == 2, result
            assert result["lastAfterTrue"] == {
                "id": "__test_canvas_vis__",
                "kind": "canvas",
            }, result

            # Re-hide flips the class again: still one event per flip.
            assert result["eventsAfterSecondFalse"] == 3, result

    def test_register_re_register_preserves_fields(self, browser, tmp_path):
        """A partial re-register never drops previously registered fields.

        createLayerInfo is idempotent: fields absent from the second opts
        (layer/paneName/iconSvg/name/role) fall back to
        the existing layerInfo instead of being reset to defaults.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            # The icon the fixture registers. Degenerate markup is rejected
            # by the sanitizer, so it must be real SVG.
            svg = '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>'
            result = page.evaluate(_js("LayerControl/re_register_preserves_fields"))
            assert result is not None and "error" not in result, result
            for phase in ("before", "after"):
                r = result[phase]
                # `name` never leaves the registry's own values: the initial
                # registration falls back to the id, and the partial one
                # keeps it.
                assert r["name"] in ("Keep Me", "__keep__"), f"{phase}: name lost"
                assert r["role"] == "base", f"{phase}: role lost"
                assert r["layerSame"] is True, f"{phase}: layer lost"
                assert r["paneName"] == "customPane", f"{phase}: paneName lost"
                # The value must be the registered icon, unchanged by the
                # partial re-register.
                assert r["iconSvg"] == svg, f"{phase}: iconSvg lost"

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

    def test_click_one_overlay_no_sibling_checkbox_flash(self, browser, tmp_path):
        """Clicking one overlay row's checkbox must not flash its role siblings'
        checkboxes to an intermediate state.

        Regression for "sibling checkbox flashes when clicking one overlay
        row": a sibling checkbox
        briefly showing a state it was not already in means an intermediate
        sweep rewrote the row's cell between the click and its final paint. The
        single-writer path records intent for the clicked row and diffs once, so
        every sibling's checkbox stays at its start value until the browser
        settles.
        """
        overlays = [
            folium.FeatureGroup(name="Overlay A", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay B", overlay=True, show=True),
            folium.FeatureGroup(name="Overlay C", overlay=True, show=True),
        ]
        with use_page(self._make_page, browser, tmp_path, *overlays) as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/sample_overlay_checkbox_click"))
            assert not result.get("error"), f"probe error: {result}"
            assert not errors, f"JS errors: {errors}"
            # Only the first row flipped; its two siblings kept their start
            # state throughout the click, no intermediate frame.
            assert result["finalState"][0] is False, (
                f"clicked row did not uncheck, got {result}"
            )
            for i in (1, 2):
                assert result["finalState"][i] is True, (
                    f"sibling {i} ended unchecked -- the click reached it: {result}"
                )
            # The regression: some frame between the click and the settle
            # painted a sibling's checkbox at a value different from its start.
            sibling_flips = []
            for sample in result["samples"]:
                if (
                    sample[1] != result["startState"][1]
                    or sample[2] != result["startState"][2]
                ):
                    sibling_flips.append(sample)
            assert not sibling_flips, (
                f"a sibling's checkbox flipped to an unexpected value during "
                f"the click -- checkbox flash. Samples: {sibling_flips}"
            )

    def test_paneset_reset_after_hide_show(self, browser, tmp_path):
        """Hiding and re-showing a layer re-pins the leaf marker to its sub-pane.

        Uses a FeatureGroup with a child marker — the marker (leaf) is what
        gets pinned, so the pane value is asserted on the leaf layer. An empty
        container has no DOM to pin, so the assertion is meaningless there.
        """
        fg = folium.FeatureGroup(name="TestLayer", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="test_marker").add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="paneset_reset") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Step 1: enforceOrder pins the leaf marker to the group's sub-pane
            result = page.evaluate(_js("LayerControl/read_leaf_paneset"))
            assert result is not None, "Layer not found"
            assert result["pane"], (
                f"Expected non-empty pane on leaf after enforceOrder, got {result['pane']}"
            )

            # Step 2: Hide the layer by unchecking checkbox
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 3: Show the layer again
            page.evaluate(_js("LayerControl/click_first_checkbox"))
            page.wait_for_timeout(300)

            # Step 4: handleChange resets the container pane; enforceOrder
            # re-pins the leaf marker to the group's sub-pane
            paneset = page.evaluate(_js("LayerControl/read_leaf_paneset_value"))
            assert paneset, (
                f"Expected non-empty pane on leaf after re-show, got {paneset}"
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
            folium.GeoJson(load_geojson("common", "shanghai_polygon"), name="Polygons"),
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

        pinLateContent must skip container nodes when writing pane options.
        The container's own pane stays whatever registerLayer assigned
        (paneName), and must NOT be overwritten with a fallback
        `foliplus-pane-*` name during migration.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            result = page.evaluate(
                _js("LayerControl/migrate_container_clean_options"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
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
            result = page.evaluate(
                _js("LayerControl/register_idempotent_keeps_order"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
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
            result = page.evaluate(
                _js("LayerControl/render_initial_list_incremental"),
                {"line": leaflet_path("common", "line_fuzhou_diag")},
            )
            assert result is not None, "LayerAPI not found"
            # After the initial attachUI render (1 call), dynamic registrations
            # must not trigger additional full rebuilds.
            assert result["afterSecond"] <= 1, (
                f"registerLayer triggered full rebuilds: {result['afterSecond']}"
            )

    def test_handle_change_resets_paneset_on_show(self, browser, tmp_path):
        """Checkbox toggle triggers handleChange which re-pins layers."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/keydown_down_moves_focus"))
            assert result is not None, "keydown_down_moves_focus failed"
            assert result["focusedElement"] == result["expectedElement"], (
                f"ArrowDown should focus next item, got {result}"
            )

    def test_outside_mousedown_clears_cursor(self, browser, tmp_path):
        """Clicking outside the panel drops the keyboard cursor.

        The .foliplus-is-focused-row marker is a panel-local navigation cursor, so
        clicking the map / another control must clear it rather than leaving the
        last navigated row highlighted. Uses mousedown so a panel-internal click
        that rebuilds the list (a fold button, a checkbox) is unaffected.
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
            result = page.evaluate(_js("LayerControl/outside_mousedown_clears_cursor"))
            assert result is not None, "outside_mousedown_clears_cursor failed"
            assert result["before"] is True, (
                f"cursor should be set before outside mousedown, got {result}"
            )
            assert result["after"] is False, (
                f"outside mousedown must clear the cursor, got {result}"
            )

    def test_keydown_space_toggles_visibility(self, browser, tmp_path):
        """Space toggles the focused layer's checkbox."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            # After keyboard nav the browser may still treat the next mouse
            # focus as :focus-visible, so focusin can light the row — allowed.
            # The hard contract is Enter targets the clicked row (`toggled`).

    def test_keydown_ctrl_up_moves_layer(self, browser, tmp_path):
        """Ctrl+ArrowUp moves the focused layer one position up."""
        overlay1 = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        overlay2 = folium.FeatureGroup(name="Overlay B", overlay=True, show=True)
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # The style assertions below need the init pass done: rows render
            # checked by default and initLayerItem (on an init timer) is what
            # adds the .foliplus-active class and the per-state titles.
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/keydown_escape_clears_focus"))
            assert result is not None, "keydown_escape_clears_focus failed"
            assert result["beforeEscape"] is True, "ArrowDown should first set focus"
            assert result["focusCleared"] is True, (
                f"Escape should clear focus, got {result}"
            )
            assert result["focusRetained"] is True, (
                "Escape must not blur to <body>, got " + str(result)
            )
            assert result["checkedRetainedFocus"] is True, (
                "the checked row must keep DOM focus through Escape, got " + str(result)
            )
            assert result["glowVisibleBefore"] is True, (
                "the cursor glow must be drawn before Escape (the JS class was "
                "on the row), got " + str(result)
            )
            assert result["washRestored"] is True, (
                "a checked row gets its selected wash back through Escape, got "
                + str(result)
            )
            assert result["iconKeptBlack"] is True, (
                "a checked row keeps its black type icon through Escape, got "
                + str(result)
            )
            assert result["glowCleared"] is True, (
                "Escape must clear the cursor-only glow, got " + str(result)
            )
            assert result["outlineCleared"] is True, (
                "Escape must not leave the browser default dark outline on the "
                "still-focused row, got " + str(result)
            )

            # A real hover must still light the recipe on the cancelled row:
            # the recipe keys on :hover + the JS class, and Escape only lifts
            # the class. Cancel the cursor again for a deterministically
            # cancelled row, hover with the real pointer, then move it away
            # and assert the fall-back.
            page.evaluate(_js("LayerControl/dispatch_escape_on_active"))
            page.hover(".foliplus-layer-item.foliplus-active")
            # The grip is the one recipe property with an opacity transition
            # (color/box-shadow are transition: none), so wait it out before
            # measuring or the computed value is mid-flight.
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-drag-cell .drag-handle",
                    0,
                    "1",
                ],
                timeout=2000,
            )
            on_hover = page.evaluate(_js("LayerControl/read_active_row_lit"))
            page.mouse.move(5, 400)
            page.wait_for_function(
                _js("LayerControl/wait_drag_handle_opacity"),
                arg=[
                    ".foliplus-layer-item.foliplus-active .foliplus-drag-cell .drag-handle",
                    0,
                    "0",
                ],
                timeout=2000,
            )
            off_hover = page.evaluate(_js("LayerControl/read_active_row_state"))
            assert on_hover["grip"] == "1", (
                "hovering the cancelled row must show the drag grip, got "
                + str(on_hover)
            )
            assert on_hover["glow"] is True, (
                "hovering the cancelled row must light the glow, got " + str(on_hover)
            )
            assert on_hover["more"] == off_hover["more"], (
                "a checked row keeps the more button in the action color at "
                "rest and on hover alike (its .foliplus-active leg), got "
                + str(on_hover)
                + " vs "
                + str(off_hover)
            )
            assert off_hover["grip"] == "0", (
                "leaving the row must hide the grip again, got " + str(off_hover)
            )
            assert off_hover["bg"] not in ("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"), (
                "leaving the row must fall back to the selected wash, got "
                + str(off_hover)
            )

    def test_keydown_escape_restores_rest_state(self, browser, tmp_path):
        """Escape leaves the row indistinguishable from a never-touched row.

        The rest state depends on the layer's checked state, so both are
        pinned against a live reference row instead of hardcoded colors: a
        checked row falls back to the selected wash and the black type icon,
        an unchecked row to the plain surface and the muted icon. The drag
        grip stays hidden at rest either way — only the cursor recipe (arrow
        keys, Tab) and a real hover show it — and the more button returns to
        exactly the color it has on any resting row.
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
            white = self._sample_surface(page)

            def snapshot():
                return page.evaluate(_js("LayerControl/read_all_row_state"))

            def escape_first_row():
                page.evaluate(_js("LayerControl/dispatch_escape_on_first_row"))

            # ── checked rows: the restored row must equal the reference ──
            escape_first_row()
            page.mouse.move(5, 400)  # pointer away: no hover may mask rest
            page.wait_for_timeout(300)  # let the grip opacity transition settle
            checked = snapshot()
            # The reference row proves the selected wash is the live rest
            # state, so the equality below is not two rows broken alike.
            assert checked[1]["bg"] != "rgba(0, 0, 0, 0)", (
                "the untouched checked row must show the selected wash, got "
                + str(checked)
            )
            assert checked[0] == checked[1], (
                "an Escape-restored checked row must be indistinguishable "
                "from a never-touched row, got " + str(checked)
            )

            # ── unchecked rows: same contract against the plain surface ──
            page.evaluate(_js("LayerControl/uncheck_all_row_checkboxes"))
            escape_first_row()
            page.wait_for_timeout(300)
            unchecked = snapshot()
            assert unchecked[0] == unchecked[1], (
                "an Escape-restored unchecked row must be indistinguishable "
                "from a never-touched row, got " + str(unchecked)
            )
            assert unchecked[0]["bg"] == white, (
                "an unchecked row's rest state is the explicit white surface, got "
                + str(unchecked)
            )
            assert unchecked[0]["grip"] == "0", (
                "the drag grip stays hidden at rest, got " + str(unchecked)
            )
            # The more button does not rest the same color everywhere: a
            # checked row keeps it in the action color, an unchecked row in
            # the primary text color — so Esc must return it to different
            # colors depending on the checkbox, never to one uniform value.
            assert unchecked[1]["more"] != checked[1]["more"], (
                "a checked row rests the more button in the action color "
                "while an unchecked row rests it black, got "
                + str(checked)
                + " vs "
                + str(unchecked)
            )

    def test_keydown_escape_keeps_focus_in_row(self, browser, tmp_path):
        """Escape while the row holds DOM focus lifts the cursor class in place.

        The rename-cancel path is covered by the vitest suite; this browser
        probe pins the real-Chromium contract: class off, focus still inside
        the row, no residual suppress marker.
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
                _js("LayerControl/keydown_escape_keeps_focus_in_row")
            )
            assert result is not None, "keydown_escape_keeps_focus_in_row failed"
            assert result["cursorCleared"] is True, (
                "Escape should clear the cursor, got " + str(result)
            )
            assert result["focused"] is True, (
                "Escape must keep DOM focus inside the row, got " + str(result)
            )
            assert result["suppressLeft"] is False, (
                "the FOCUS_SUPPRESSED mechanism is gone, got " + str(result)
            )

    def test_native_gate_checkbox_space(self, browser, tmp_path):
        """Space on a focused row checkbox flips it exactly once, via the native path.

        Row 2 of the table. foliplus owns no key of a checkbox, so its own
        row-toggle shortcut must not run alongside the native flip — otherwise
        the layer would be applied twice. A real keypress again, with the
        final ``defaultPrevented`` read from a capture listener.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            arm = page.evaluate(
                _js("LayerControl/native_gate_arm"),
                load_geojson("common", "point_1193_2608"),
            )
            assert arm.get("error") is None, f"setup failed: {arm}"
            mid = page.evaluate(_js("LayerControl/native_gate_mid"))
            assert mid["cbType"] == "checkbox", f"not a checkbox: {mid}"
            assert mid["focusedType"] == "checkbox", f"checkbox not focused: {mid}"

            page.keyboard.press(" ")

            read = page.evaluate(_js("LayerControl/native_gate_read"))
            recs = [r for r in (read["records"] or []) if r["type"] == "checkbox"]
            assert recs, "no keydown reached document while the checkbox was focused"
            assert len(recs) == 1, (
                f"Space observed {len(recs)} times: {read['records']}"
            )
            assert recs[0]["prevented"] is False, (
                "foliplus cancelled the Space the checkbox was flipping on: "
                + str(read["records"])
            )
            assert read["cbAfter"] is not None, str(read)
            assert read["cbAfter"] != mid["cbBefore"], (
                "the checkbox did not flip: before="
                + str(mid["cbBefore"])
                + " after="
                + str(read["cbAfter"])
            )
            # Baseline is the cursor left by the checkbox focus itself, which is
            # the cursor by design: only a change caused by the keypress counts.
            assert read["rowFocused"] == mid["rowFocusedAfterFocus"], (
                "the row keyboard cursor moved on the Space that the checkbox "
                "was flipping on: after-focus="
                + str(mid["rowFocusedAfterFocus"])
                + " after-press="
                + str(read["rowFocused"])
            )
            assert not errors, f"JS errors: {errors}"

    def test_base_basemap_quiet_focus(self, browser, tmp_path):
        """Base basemap / color rows show no cursor glow; overlay rows still do.

        Basemaps are stack slots, not data layers — click / keyboard focus
        must not paint the white+glow recipe. Mouse cursor stays default.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("OpenStreetMap", name="OSM", overlay=False)
        with use_page(self._make_page, browser, tmp_path, overlay, base) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.mouse.move(0, 0)
            result = page.evaluate(_js("LayerControl/base_basemap_quiet_focus"))
            assert result is not None and "error" not in result, (
                f"base basemap snippet failed: {result}"
            )
            # Checked base row: no glow, not white — keep the visibility wash.
            assert result["baseCheckedHover"]["glow"] is False, (
                "base basemap must not show the cursor glow, got " + str(result)
            )
            assert result["baseCheckedHover"]["cursor"] == "default", (
                "base basemap hover must keep the default cursor, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] == result["wash"], (
                "checked base row must keep the wash on hover, got " + str(result)
            )
            assert result["baseCheckedHover"]["bg"] != result["white"], (
                "checked base row must not flash white on hover, got " + str(result)
            )
            # Overlay data row still gets the full recipe.
            assert result["overlayAfter"]["glow"] is True, (
                "overlay row must still show the cursor glow, got " + str(result)
            )
            # Color picker row is quiet when present.
            if result["colorAfter"] is not None:
                assert result["colorAfter"]["glow"] is False, (
                    "color picker row must not show the cursor glow, got " + str(result)
                )

    def test_checkbox_dblclick_does_not_focus_layer(self, browser, tmp_path):
        """Two quick checkbox toggles must not zoom the map (focusLayer).

        The browser fires `dblclick` after the second click. That event used
        to bubble to the panel handler and open the focus-layer overlay.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/checkbox_dblclick_no_focus_layer"))
            assert result is not None and "error" not in result, (
                f"checkbox dblclick snippet failed: {result}"
            )
            assert result["focusing"] is False, (
                "double-click on checkbox must not mark the row as focusing, got "
                + str(result)
            )
            assert result["mask"] is False, (
                "double-click on checkbox must not draw the focus mask, got "
                + str(result)
            )
            assert result["focusActive"] is False, (
                "double-click on checkbox must not activate the focus overlay, got "
                + str(result)
            )

    def test_focus_layer_draws_rect_and_mask(self, browser, tmp_path):
        """Double-clicking an overlay draws the dashed rect + inverse mask."""
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(self._make_page, browser, tmp_path, fg, slug="focus_overlay") as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_layer_draws_overlay"))
            assert result is not None, "focus_layer_draws_overlay failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"
            assert result["maskDrawn"] is True, f"focus mask missing, got {result}"
            assert result["rowHighlighted"] is True, (
                f"row not highlighted, got {result}"
            )

    def test_focus_mask_covers_viewport_after_fitbounds_zoomout(
        self, browser, tmp_path
    ):
        """A small container at high zoom focusing a wide layer must not leave
        un-dimmed strips outside the mask.

        The mask's outer ring is drawn once from
        ``map.getBounds().pad(1)`` *before* ``fitBounds`` runs. When
        ``fitBounds`` zooms out to fit a wide layer into a small container,
        the new viewport spans far more geography than the pre-animation
        outer ring — the dim stops at the old boundary and bright strips
        leak around the corners. The fix draws the outer ring as the
        Web-Mercator world envelope so it covers any viewport at any zoom.
        """
        # 20°x20° polygon: much wider than a small container at zoom 16,
        # so ``fitBounds`` must zoom out to fit it.
        fg = folium.FeatureGroup(name="Wide", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_world_box"),
        ).add_to(fg)
        m = folium.Map(location=[26.08, 119.30], zoom_start=16)
        LayerControl().add_to(m)
        fg.add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        with use_page(
            make_browser_page, browser, tmp_path, html, "focus_mask_ghost"
        ) as (page, _):
            page.set_viewport_size({"width": 320, "height": 240})
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            item = page.query_selector(".foliplus-layer-item")
            assert item is not None, "no layer row rendered"
            # Register a one-shot signal: the fitBounds `moveend` is the
            # deterministic "animation settled" marker. The mask is drawn
            # synchronously *before* fitBounds (drawFocusMask), so by this
            # moveend the post-fitBounds viewport is live and the mask is
            # still shown — registerAutoCancel dismisses it only 1050ms
            # after this same moveend. Reading right at the signal removes
            # the fixed-sleep race against that dismiss window.
            page.evaluate(snippet("LayerControl/arm_fit_settled"))
            item.dispatch_event("dblclick")
            try:
                page.wait_for_function(
                    snippet("LayerControl/fit_settled"), timeout=5000
                )
            except TimeoutError:
                pytest.fail(
                    "fitBounds did not settle (__fitSettled) within 5s — "
                    "the focus mask read window raced; probe was not run"
                )
            result = page.evaluate(_js("LayerControl/focus_mask_covers_viewport"))
            assert result is not None, "focus_mask_covers_viewport failed"
            assert "error" not in result, f"probe error: {result}"
            assert result["coversViewport"] is True, (
                f"focus mask outer ring must cover the post-fitBounds "
                f"viewport: outer={result['outer']} vs view={result['view']} "
                f"at zoom={result['zoom']}"
            )

    def test_focus_rect_is_marching_ants(self, browser, tmp_path):
        """The focus rect paints the shared marching-ants look, live.

        Pins the three cascade facts a regression can silently drop: accent
        stroke (not Leaflet's default, not a black fallback), the shared
        ``--foliplus-dash-rhythm``, and the march animation. Tokens are
        sampled from the live page — never hardcoded — so a broken custom
        property fails here instead of only in a human eye.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="focus_rect_ants"
        ) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_rect_marching_ants"))
            assert result is not None, "focus_rect_marching_ants failed"
            assert result["rectDrawn"] is True, f"focus rect missing, got {result}"

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["stroke"] == accent, (
                f"focus rect stroke must be the accent token, "
                f"got {result['stroke']} vs {accent}"
            )
            assert result["fill"] in ("none", "rgba(0, 0, 0, 0)"), (
                f"focus rect must stay unfilled, got {result['fill']}"
            )
            # strokeDasharray is normalized ("6px, 4px"); the token is
            # space-separated ("6px 4px"). Compare as token lists.
            got_dash = result["strokeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"focus rect dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["animationName"] == "foliplus-focus-march", (
                f"focus rect must keep the march animation, got {result}"
            )

    def test_geometry_focus_drops_ua_ring_for_marching_ants(self, browser, tmp_path):
        """A focused map path paints a marching-ants bbox, not a stroke restyle.

        The UA ring is black on Windows Chrome and system-blue on macOS Chrome
        (outline-style: auto + Highlight). The selection signal is the same
        marquee as the LayerControl focus rect, so line data keeps its stroke.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_ants"
        ) as (page, _):
            page.emulate_media(reduced_motion="no-preference")
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/geometry_focus_marching_ants"))
            assert result is not None, "geometry_focus_marching_ants failed"
            assert result["focused"] is True, f"path never took focus, got {result}"
            assert result["outlineStyle"] == "none", (
                f"focused geometry must not paint the UA outline, got {result}"
            )
            assert result["marqueePresent"] is True, (
                f"focused geometry must draw the marching-ants bbox, got {result}"
            )

            accent = self._sample_token(page, "--foliplus-accent-primary")
            dash = page.evaluate(_js("LayerControl/read_dash_rhythm"))
            assert result["marqueeStroke"] == accent, (
                f"marquee stroke must be accent, "
                f"got {result['marqueeStroke']} vs {accent}"
            )
            got_dash = result["marqueeDasharray"].replace(",", " ").split()
            want_dash = dash.replace(",", " ").split()
            assert got_dash == want_dash, (
                f"marquee dash rhythm must be {want_dash}, got {got_dash}"
            )
            assert result["marqueeAnimation"] == "foliplus-focus-march", (
                f"marquee must keep the march animation, got {result}"
            )

    def test_geometry_focus_marquee_survives_zoom(self, browser, tmp_path):
        """Focused geometry's marching-ants bbox stays locked to the geometry
        across a zoom change.

        #668 wired the marquee to re-derive from the live bbox on `moveend`,
        but `getBBox()` is cached by the browser's SVG layout engine and only
        refreshes on the next frame. A synchronous redraw inside `moveend`
        reads the pre-zoom bbox and the marquee freezes at the old position.
        The fix defers the redraw with `requestAnimationFrame`. This test
        captures real pixel bboxes before and after a zoom and asserts the
        marquee tracks the geometry within 1px (plus the 4px pad).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page, browser, tmp_path, fg, slug="geom_focus_zoom_lock"
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/geometry_focus_zoom_stays_locked"))
            assert result is not None and "before" in result, (
                f"geometry_focus_zoom_stays_locked failed: {result}"
            )
            before, after = result["before"], result["after"]
            assert after is not None, f"zoom moveend never fired within 5s: {result}"
            assert after["marqueeBB"] is not None, (
                f"marquee vanished after zoom: {result}"
            )
            # The marquee is the geometry bbox + 4px pad on all sides.
            pad = 4
            tol = 1.0
            gb, mb = before["geomBB"], before["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"before zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad}"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"before zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad}"
            )
            gb, mb = after["geomBB"], after["marqueeBB"]
            assert abs(mb["x"] - (gb["x"] - pad)) <= tol, (
                f"AFTER zoom: marquee left edge {mb['x']} != geom {gb['x']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["y"] - (gb["y"] - pad)) <= tol, (
                f"AFTER zoom: marquee top edge {mb['y']} != geom {gb['y']} - pad {pad} "
                f"(marquee froze at old position)"
            )
            assert abs(mb["w"] - (gb["w"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee width {mb['w']} != geom {gb['w']} + 2*pad"
            )
            assert abs(mb["h"] - (gb["h"] + 2 * pad)) <= tol, (
                f"AFTER zoom: marquee height {mb['h']} != geom {gb['h']} + 2*pad"
            )

    def test_focus_overlay_pane_keeps_spotlight_visible(self, browser, tmp_path):
        """The focus overlay pane carries both the base and exclusion classes.

        Every foliplus-owned pane goes through ``PaneManager.ensurePane``, so
        the overlay pane carries ``foliplus-layer-pane`` — the semantic marker
        that the pane belongs to us and the interaction rules in focus.css
        apply uniformly. The focused-layer rule
        ``.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane)``
        would hide it too without the exclusion tag, so ``drawFocusMask`` adds
        ``foliplus-focus-pane`` alongside the base class. This gate reads the
        pane as the code left it, then toggles the exclusion class to prove
        the risk is real (dropping the tag collapses the spotlight).
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_pane",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(
                _js("LayerControl/focus_overlay_pane_hides_with_base_class")
            )
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["focusActive"] is True, (
                f"container must carry foliplus-is-focus-mode during focus: {result}"
            )
            state = result["state"]
            assert state["base"] is True, (
                "the focus overlay pane must carry the base "
                f"foliplus-layer-pane class: {state}"
            )
            assert state["exclusion"] is True, (
                "the focus overlay pane must carry the foliplus-focus-pane "
                f"exclusion tag so the spotlight is not hidden: {state}"
            )
            assert state["visibility"] == "visible", (
                f"the spotlight pane must stay visible during focus: {state}"
            )
            # Q2 gate: the overlay pane is not in childPaneSpecs, so
            # ensurePane skips its provisional-z branch and drawFocusMask pins
            # FOCUS_Z.overlay itself. Assert the pin held AND that no other
            # owned pane has climbed to or above it — otherwise the mask would
            # be covered by a data layer and the dim would be silent.
            assert state["zIndex"] == "9000", (
                f"focus overlay pane must sit at FOCUS_Z.overlay (9000), got "
                f"{state['zIndex']!r}"
            )
            assert result["maxPeerZ"] < 9000, (
                "no other foliplus-layer-pane may sit at or above the focus "
                f"overlay pane (highest peer z={result['maxPeerZ']})"
            )
            # Risk 1, proven: base class alone would hide the pane.
            assert result["withoutExclusion"] == "hidden", (
                "dropping the exclusion tag must hide the overlay pane — this is "
                f"the risk the exclusion tag neutralises: {result}"
            )
            assert result["restored"] == "visible", (
                f"restoring the tag must make the pane visible again: {result}"
            )

    def test_focus_overlay_pane_click_through(self, browser, tmp_path):
        """The focus overlay pane must not intercept pointer events.

        The base ``foliplus-layer-pane`` class carries ``pointer-events: none``
        from focus.css, so the pane div — which the SVG renderer fills across
        the whole map while a focus is live — never eats a click. Without the
        base class the div defaults to ``auto`` and, sitting above every other
        layer pane, it blocks every hit on the focused layer's own features
        during focus: a silent regression the previous shape of the pane
        produced. This gate pins the CSS invariant directly: drop the base
        class (or the rule) and the assertion fires.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="focus_overlay_click",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            result = page.evaluate(_js("LayerControl/focus_overlay_pane_click_through"))
            assert result is not None and result.get("pane") is True, (
                f"focus overlay pane missing after dblclick: {result}"
            )
            assert result["panePointerEvents"] == "none", (
                "the focus overlay pane div must inherit pointer-events: none "
                f"from the base class, got {result['panePointerEvents']!r}"
            )

    def test_focus_keeps_base_panes_visible(self, browser, tmp_path):
        """Basemaps stay visible during focus — they are dimmed, not hidden.

        Before this fix, ``.foliplus-is-focus-mode`` hid every
        ``.foliplus-layer-pane`` except the focused one. The active basemap
        (topmost base layer that is effectiveShown) is exempted via
        `.foliplus-focus-basemap` and stays visible; other base panes and
        overlay data panes are hidden so the focused layer stands out. The
        dim mask on top preserves spatial context.

        The color basemap is created lazily on first show, so we toggle its
        checkbox on before focusing — this also exercises the ``!layer``
        branch of the ordering pass (color basemaps have no Leaflet layer).
        """
        # A tile basemap + an overlay polygon so focus has a target.
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_keeps_base_visible",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Turn the color basemap on so its lazily-created pane is in the
            # DOM before we focus.
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle.get("ok") is True, toggle
            page.wait_for_timeout(200)
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"
            assert result["maskPanePresent"] is True, (
                f"focus mask pane must exist: {result}"
            )
            # Classify the panes: active basemap, focused layer, and others.
            focus_basemap_panes = [p for p in result["panes"] if p["focusBasemap"]]
            focus_panes = [p for p in result["panes"] if p["focusExcl"]]
            other_panes = [
                p
                for p in result["panes"]
                if not p["focusBasemap"] and not p["focusExcl"]
            ]
            # The active basemap must be present and visible.
            assert len(focus_basemap_panes) >= 1, (
                "the active basemap's pane must be present and marked with "
                f"foliplus-focus-basemap: {result['panes']}"
            )
            for pane in focus_basemap_panes:
                assert pane["visibility"] == "visible", (
                    "the active basemap's pane must stay visible during focus "
                    f"— the dim mask does the dimming, not visibility:hidden: "
                    f"{pane}"
                )
            # The focused layer's pane and the focus overlay pane must be
            # visible.
            assert len(focus_panes) >= 2, (
                "the focused layer's pane and the focus overlay pane must both "
                f"carry foliplus-focus-pane: {result['panes']}"
            )
            for pane in focus_panes:
                assert pane["visibility"] == "visible", (
                    f"a foliplus-focus-pane pane must stay visible: {pane}"
                )
            # Any other pane (including non-active base panes and overlay data
            # layers) must be hidden — otherwise the focused layer is not
            # visually isolated.
            for pane in other_panes:
                assert pane["visibility"] == "hidden", (
                    "a non-focus, non-active-basemap foliplus-layer-pane must "
                    f"be hidden during focus so the focused layer stands out: "
                    f"{pane}"
                )

    def test_focus_basemap_dim_direction(self, browser, tmp_path):
        """The focused basemap interior must NOT be darker than unfocused.

        The dim rule uses `opacity`, which blends the basemap toward the map
        container's background color — the result is lighter, not darker.
        A `filter: brightness(...)` would darken the pane uniformly (including
        the interior), which is the wrong direction: the user expects the
        basemap to fade into the background, not to sink into shadow. This
        pixel-level gate catches a regression where someone changes the rule
        back to a filter.

        The test enables the solid-color basemap because OSM tiles are 404 in
        browser tests — a transparent tile pane makes `opacity` a no-op on the
        pixel, so the gate cannot distinguish the two rules. It samples a pixel
        in the focus rectangle's padding ring: outside the polygon (no overlay
        contamination) but inside the focus rect (no mask), so the delta
        reflects only the basemap's opacity change. The padding ring is 32px
        (FOCUS.PADDING); 15px inside it gives a comfortable margin.
        """
        base = folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="OSM",
            attr="OSM",
            overlay=False,
        )
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            base,
            fg,
            slug="focus_basemap_direction",
        ) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # Pan the map to center the polygon so the sample point is inside
            # the viewport. The polygon's top edge is north of the default map
            # center; without panning, the padding-ring sample would be above
            # the viewport (negative y) and the pixel read would be out-of-bounds.
            page.evaluate(_js("LayerControl/pan_to_foliplus"))
            page.wait_for_timeout(500)

            # Enable the solid-color basemap so there is a visible basemap to
            # dim. OSM tiles are 404 in browser tests, so the tile pane is
            # transparent and `opacity` on it would have no visible effect.
            color_result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert color_result.get("ok") is True, (
                f"failed to enable color basemap: {color_result}"
            )
            # Wait for the color basemap canvas to paint.
            page.wait_for_timeout(300)

            import io

            from PIL import Image

            # Sample the polygon center — inside the polygon (definitely inside
            # the focus rect, so the mask does not apply) and on the basemap
            # underneath (the polygon's fill_opacity=0.5 lets the basemap show
            # through at 50%). The pixel is a blend of polygon fill and basemap;
            # the delta comes only from the basemap's opacity change.
            box = page.evaluate(_js("LayerControl/project_foliplus_latlng"))
            px, py = int(box["x"]), int(box["y"])

            # Capture before focus.
            screenshot_before = page.screenshot()
            img_before = Image.open(io.BytesIO(screenshot_before))
            pixel_before = img_before.getpixel((px, py))

            # Trigger focus by dblclicking the first overlay layer row.
            result = page.evaluate(_js("LayerControl/focus_keeps_base_panes_visible"))
            assert result is not None and not result.get("error"), (
                f"focus probe failed: {result}"
            )
            assert result["focusActive"] is True, f"focus mode must be active: {result}"

            # Capture after focus.
            page.wait_for_timeout(200)  # let the opacity transition settle
            screenshot_after = page.screenshot()
            img_after = Image.open(io.BytesIO(screenshot_after))
            pixel_after = img_after.getpixel((px, py))

            # The focused basemap interior must not be darker than unfocused.
            # With opacity, the pixel blends toward the container background
            # (#ddd ≈ 221), so the focused pixel is lighter. With a filter,
            # it would be darker.
            before_r, before_g, before_b = pixel_before[:3]
            after_r, after_g, after_b = pixel_after[:3]
            for channel, b, a in [
                ("R", before_r, after_r),
                ("G", before_g, after_g),
                ("B", before_b, after_b),
            ]:
                delta = a - b
                assert delta >= 0, (
                    f"the focused basemap interior must not be darker than "
                    f"unfocused in channel {channel}: before={b}, after={a}, "
                    f"delta={delta} — the dim rule must use `opacity` "
                    f"(which blends toward the container background), not "
                    f"`filter` (which darkens uniformly)"
                )

    def test_focus_overlay_renderer_lifecycle(self, browser, tmp_path):
        """Each focus owns exactly one SVG renderer in the overlay pane.

        ``L.svg({ pane })`` builds a fresh renderer that mounts its own ``<svg>``
        into the pane, which lives for the whole map's life. ``dismissFocus``
        uses the public Leaflet teardown path (``map.removeLayer`` on the
        renderer), so every focus cycle must leave the pane empty — the pane
        itself persists (ensurePane memoises it), the renderer does not. The
        control-teardown path (``removeControl`` + ``addControl`` on the same
        control, documented in CLAUDE.md) runs ``dismissFocus`` inside
        ``unbindEvents``, so an in-flight focus must not outlive the removal.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            slug="focus_overlay_lifecycle",
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/focus_overlay_renderer_lifecycle"))
            assert result is not None and result.get("ctrl") is True, (
                f"lifecycle probe failed to run: {result}"
            )
            assert result["before"] == 0, (
                f"the overlay pane should start empty: {result}"
            )
            # One renderer per focus, cleanly removed on cancel.
            for cycle in result["cycles"]:
                assert cycle["row"] is True, f"missing row for {cycle['id']}: {cycle}"
                assert cycle["svg"] == 1, (
                    f"focus should mount exactly one SVG renderer: {cycle}"
                )
                assert cycle["rendererLive"] is True, cycle
                assert cycle["after"]["svg"] == 0, (
                    f"cancel must remove the SVG renderer — a non-zero count is a "
                    f"leak: {cycle}"
                )
                assert cycle["after"]["rendererNull"] is True, cycle
            teardown = result["teardown"]
            assert teardown["svgAtRemove"] == 1, (
                f"an in-flight focus must hold one SVG at the moment of "
                f"removeControl: {teardown}"
            )
            assert teardown["svgAfterRemove"] == 0, (
                f"removeControl must dismiss the in-flight focus, leaving no "
                f"leaked renderer: {teardown}"
            )
            assert teardown["svgAfterAdd"] == 0, (
                f"addControl must not resurrect the removed renderer: {teardown}"
            )
            assert not errors, f"JS errors: {errors}"

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
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
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
            page.evaluate(_js("LayerControl/set_test_layer_name_beta"))
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
                arg=[ROW + " .foliplus-drag-cell .drag-handle", 1, "1"],
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

    def test_input_skin_computed_parity(self, browser, tmp_path):
        """The LayerControl style-panel inputs resolve one computed skin
        from .foliplus-input-skin.

        The method select and label-size number must both resolve the same
        height, frame, radius, ink, type size and box model (the Heatmap layer
        select has its own test in test_panel.py). jsdom never loads the
        stylesheet cascade, so only a browser can prove the parity: a missing
        foliplus-input-skin on a call site reads UA defaults (e.g.
        height: auto) and fails here.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._declared_ramp_layer(),
            slug="input_skin",
        ) as (page, errors):
            self._open_style_ramp(page)
            # The layer declares a value fill, so the panel opens on the
            # by-value mode and the method select is present; the probe reveals
            # the label body under its toggle before reading the label-size
            # number.
            data = page.evaluate(_js("LayerControl/read_input_skin"))
            assert data["lc"]["ok"], f"method/number not found: {data}"
            t = data["tokens"]
            assert t["ctrlSize"], f"ctrl-size token unresolved: {data}"
            assert t["borderThin"], f"border-thin token unresolved: {data}"
            assert t["radiusSm"], f"radius-sm token unresolved: {data}"
            assert t["fontSizeMd"], f"font-size-md token unresolved: {data}"
            assert t["inputBg"], f"input-bg token unresolved: {data}"
            assert t["textPrimary"], f"text-primary token unresolved: {data}"
            for name, got in (
                ("method", data["lc"]["method"]),
                ("number", data["lc"]["number"]),
            ):
                assert got["height"] == t["ctrlSize"], (name, data)
                assert got["borderTopWidth"] == t["borderThin"], (name, data)
                assert got["borderRadius"] == t["radiusSm"], (name, data)
                assert got["backgroundColor"] == t["inputBg"], (name, data)
                assert got["fontSize"] == t["fontSizeMd"], (name, data)
                assert got["color"] == t["textPrimary"], (name, data)
                assert got["boxSizing"] == "border-box", (name, data)
            assert not errors, f"JS errors: {errors}"

    def test_row_panels_pin_only_on_request(self, browser, tmp_path):
        """Pinning is opt-in: this PR's panels pin, a plain row panel does not.

        The shared `.foliplus-row-panel` shell defaults to the plain
        row-anchored absolute card. Only a caller that knows the card would be
        clipped by the layer list's scroll box opts into `pinRowPanel`, which
        adds the pinned marker and places the fixed card from the row's rect.
        A caller that skips the helper (an unmerged filter panel builds one) must
        therefore keep its plain behaviour instead of landing at the viewport
        corner — the regression this test pins.
        """
        layer = folium.FeatureGroup(name="Row panel pin")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="row_panel_pin"
        ) as (page, errors):
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
            page.wait_for_timeout(300)

            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            style = page.evaluate(_js("LayerControl/row_panel_pin_state"))
            assert not errors, f"JS errors: {errors}"
            assert style["style"]["pinned"] is True, style
            assert style["style"]["position"] == "fixed", style
            assert style["style"]["inViewport"] is True, (
                f"the pinned style panel left the viewport: {style['style']}"
            )

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="detached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_first_overlay_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="visible", timeout=5000
            )
            attrs = page.evaluate(_js("LayerControl/row_panel_pin_state"))
            assert attrs["attrs"]["pinned"] is True, attrs
            assert attrs["attrs"]["position"] == "fixed", attrs
            assert attrs["attrs"]["inViewport"] is True, attrs
            assert attrs["fixture"]["pinned"] is False, (
                "a never-pinned row panel must not carry the pinned marker"
            )
            assert attrs["fixture"]["position"] == "absolute", (
                "a never-pinned row panel must keep its row-anchored absolute "
                f"box, got {attrs['fixture']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_initlayeritem_updates_only_the_id_match_row(self, browser, tmp_path):
        """initLayerItem stamps the row named by data-layer-id, not the one at
        the layer's registry index."""
        with use_page(self._make_page, browser, tmp_path, slug="initlayeritem") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/initlayeritem_scrambled_dom"))
            assert state is not None, "LayerControl instance not reachable"
            # The precondition the assertion depends on: the row sitting at
            # alpha's registry index is a different layer, so only an id lookup
            # can find alpha's row.
            assert state["alphaRegistryIndex"] != state["alphaDomIndex"]
            # initLayerItem wrote alpha's name into alpha's own checkbox.
            assert state["labels"]["alpha"] == "A"
            # ...and left the neighbors' checkboxes alone. An index-based
            # lookup would have stamped "A" onto whoever sat at alpha's
            # registry index.
            assert state["labels"]["beta"] == "B", (
                "a neighbor's row was rewritten with alpha's name "
                f"({state['staleIndexWouldHaveHit']!r}) — row resolved by index"
            )
            assert state["labels"]["gamma"] == "C"
            # Ids the registry does not know about are declined.
            assert state["unknownReturnsFalse"] is False
            assert not errors, f"JS errors: {errors}"

    def test_dragdrop_relocates_only_the_id_match_row(self, browser, tmp_path):
        """handleDrop resolves the drop target by data-layer-id: a DOM-position
        read would have seen a self-drop and left the registry behind the
        panel."""
        with use_page(self._make_page, browser, tmp_path, slug="dragrow") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(
                _js("LayerControl/drag_scrambled_dom_only_updates_correct_row")
            )
            assert state is not None, "LayerControl instance not reachable"
            # The drop actually moved the registry. A DOM-position lookup reads
            # the target at the dragged layer's own index and aborts as a
            # self-drop, leaving the registry behind the panel.
            assert state["registryMoved"] is True, (
                f"the drop aborted: the target row was resolved by DOM position, "
                f"not id (registry stayed {state['beforeRegistry']})"
            )
            # Panel and registry agree once the drop has settled.
            assert state["panelMatchesRegistry"] is True, (
                f"panel {state['domIds']} drifted from registry "
                f"{state['afterRegistry']}"
            )
            assert state["dragDisarmed"] is True
            assert not errors, f"JS errors: {errors}"

    def test_focus_closes_map_popup(self, browser, tmp_path):
        """A feature-bound Leaflet popup (folium GeoJsonPopup) closes when
        focusLayer runs — closeOverlays sweeps eachLayer so the popup
        survives on a sublayer-bound surface (not just map._popup) is still
        dropped.

        This is the end-to-end repro of the original bug: click a GeoJson
        feature to open its popup, then focus the layer, and the popup must
        disappear. jsdom/vitest cannot verify this because map is a mock;
        only a real Leaflet map proves the sweep closes the popup.
        """
        fg = folium.FeatureGroup(name="Features", overlay=True, show=True)
        folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_zone_a")),
            name="GeoJson",
            layer_name="GeoJson",
            popup=folium.GeoJsonPopup(
                fields=["name", "value"],
                aliases=["Name", "Value"],
            ),
        ).add_to(fg)

        with use_page(self._make_page, browser, tmp_path, fg, slug="popup_focus") as (
            page,
            errors,
        ):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/popup_closes_on_focus"))
            assert result is not None and "error" not in result, (
                f"popup_closes_on_focus snippet failed: {result}"
            )
            # The popup must have opened on feature click.
            assert result["popupOpenBefore"] is True, (
                f"popup did not open on feature click: {result}"
            )
            # After focus, the popup must be gone.
            assert result["popupStillOpen"] is False, f"popup survived focus: {result}"
            # Focus must be active — proves closeOverlays ran, not a no-op.
            assert result["focusing"] is True, f"focus did not activate: {result}"
            assert not errors, f"JS errors: {errors}"

    def test_focus_hides_native_ui_panes(self, browser, tmp_path):
        """Focus-mode CSS hides Leaflet's remaining UI panes: hover tooltips
        and popups — and, through the layer-pane rule, every non-focused
        marker layer's shadows.

        Marker shadows are foliplus panes now: each marker layer carries its
        own shadow pane (`PaneRole.SHADOW`, `PaneManager.pinLateContent`
        moves `_shadow` in and writes `options.shadowPane`), so the
        `.foliplus-layer-pane` hide rule reaches them and the focused layer's
        own shadows stay in its spotlight. The blanket
        `.leaflet-shadow-pane { visibility: hidden }` rule this test used to
        pin is gone — it was the workaround for shadows living outside any
        layer pane, and it took the focused marker layer's shadows down with
        everyone else's. Hover tooltips and popups still live in Leaflet's
        own `leaflet-{tooltip,popup}-pane` divs, so their two dedicated
        selectors in `focus.css` each `visibility: hidden` under
        `.foliplus-is-focus-mode`; `dismissFocus`'s class removal restores
        them. Companion teardown sweeps `.leaflet-tooltip` alongside
        `.leaflet-popup` so hover residue does not reappear on hover-out
        after focus ends.

        The probe drives focus by dblclicking the polygon row and samples
        `getComputedStyle(pane).visibility` before, during, and after. The
        tooltip is opened programmatically via `openTooltip()` (hover timing
        is unreliable in headless) and the marker layer's shadow pane is
        seeded with a synthetic shadow — folium's default awesome-marker
        icon does not carry a shadow, but the CSS rule is pane-scoped so the
        element inside just has to exist for the assertion to be meaningful.
        """
        # Polygon layer: focus target. Marker layer: produces a tooltip on
        # hover, and its shadow pane hosts the seeded probe element.
        fg_polygon = folium.FeatureGroup(name="Zones", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
        ).add_to(fg_polygon)
        fg_marker = folium.FeatureGroup(name="Points", overlay=True, show=True)
        folium.Marker([26.05, 119.25], name="P1", tooltip="Tooltip text").add_to(
            fg_marker
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg_polygon,
            fg_marker,
            slug="focus_native_panes",
        ) as (page, errors):
            panel_ready(page)

            # Expose the test marker to the snippet so it can `openTooltip()`
            # deterministically, and so the probe can locate the marker
            # layer's shadow pane. The var name is the folium hash suffix.
            marker_var = page.evaluate(_js("LayerControl/find_marker_var"))
            assert marker_var is not None, "could not find the folium marker var"
            page.evaluate(_js("LayerControl/set_test_marker"), marker_var)

            result = page.evaluate(_js("LayerControl/focus_hides_native_panes"))
            assert result is not None and "error" not in result, (
                f"focus_hides_native_panes snippet failed: {result}"
            )
            shadow_pane_id = result.get("shadowPaneId")
            assert shadow_pane_id, (
                f"marker layer shadow pane not found: {result['shadowPaneId']}"
            )

            # Pre-focus: the seeded shadow is in the marker layer's shadow
            # pane and the opened tooltip is in the DOM, so the hide
            # assertions below aren't vacuous.
            assert result["before"]["shadowProbe"]["present"] is True, (
                "the marker layer's shadow pane must carry the seeded probe "
                f"element before focus (else the assertions are vacuous): "
                f"{result['before']}"
            )
            assert result["before"]["shadowProbe"]["visibility"] == "visible", (
                f"shadow probe must be visible before focus: {result['before']}"
            )
            assert result["before"]["tooltipEl"] is True, (
                f"openTooltip() must have produced a .leaflet-tooltip element "
                f"before focus: {result['before']}"
            )
            assert result["before"]["containerFocus"] is False, (
                "focus must not be active before the dblclick"
            )

            # During focus: the two native UI panes must be `visibility:
            # hidden` (their dedicated rules), and the non-focused marker
            # layer's shadow pane must be hidden through the layer-pane rule —
            # while Leaflet's shared shadow pane stays visible: the blanket
            # hide is gone, and a focused marker layer keeps its own shadows.
            assert result["during"]["containerFocus"] is True, (
                f"focus mode did not activate: {result['during']}"
            )
            for name in ("tooltipPane", "popupPane"):
                pane = result["during"][name]
                assert pane["present"] is True, f"{name} must exist on the map: {pane}"
                assert pane["visibility"] == "hidden", (
                    f"{name} must be `visibility: hidden` during focus "
                    f"— focus.css must hide Leaflet's own UI panes: {pane}"
                )
            marker_shadow_pane = result["during"]["markerShadowPane"]
            assert marker_shadow_pane["present"] is True, (
                f"marker layer shadow pane must exist on the map: {marker_shadow_pane}"
            )
            assert marker_shadow_pane["visibility"] == "hidden", (
                "the non-focused marker layer's shadow pane must be hidden "
                f"during focus through the layer-pane rule: {marker_shadow_pane}"
            )
            assert result["during"]["shadowProbe"]["visibility"] == "hidden", (
                f"the seeded shadow must be hidden with its pane: {result['during']}"
            )
            shared_shadow_pane = result["during"]["shadowPane"]
            assert shared_shadow_pane["present"] is True, (
                f"Leaflet's shared shadow pane must exist on the map: {shared_shadow_pane}"
            )
            assert shared_shadow_pane["visibility"] == "visible", (
                "Leaflet's shared shadow pane must NOT be hidden during focus "
                f"— the blanket hide rule is removed: {shared_shadow_pane}"
            )

            # After cancel: the `.foliplus-is-focus-mode` class must be gone,
            # so the CSS rule releases the panes. The tooltip DOM element may
            # have been removed by `closeOverlays`' `.leaflet-tooltip` sweep
            # during focus (intentional — hover residue must not resurrect on
            # hover-out after focus ends), so only the container focus and
            # the shadow-pane restoration are asserted.
            assert result["after"]["containerFocus"] is False, (
                f"focus mode must be released after cancelFocus: {result['after']}"
            )
            assert result["after"]["markerShadowPane"]["present"] is True, (
                f"marker layer shadow pane must survive cancelFocus: {result['after']}"
            )
            assert result["after"]["markerShadowPane"]["visibility"] == "visible", (
                f"marker layer shadow pane must be restored to `visibility: "
                f"visible` after focus is cancelled: {result['after']}"
            )
            assert result["after"]["shadowProbe"]["visibility"] == "visible", (
                f"the seeded shadow must be visible again after cancelFocus: "
                f"{result['after']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_hidden_base_does_not_raise_max_zoom(self, browser, tmp_path):
        """A hidden base layer must not raise ``map.getMaxZoom()``.

        foliplus used to write a static union of *all registered*
        layers' native ``options.maxZoom`` into ``map.options.maxZoom``
        on every ``enforceOrder`` pass — including layers the user had
        checked off. Since Leaflet's ``getMaxZoom`` returns
        ``options.maxZoom ?? <max of on-map layers>`,` removing the
        static write lets a hidden base stop raising the ceiling. This
        pins that behavior in a real browser so a future regression
        doesn't quietly come back.
        """
        # Two base layers with distinct native max_zoom values. Both
        # start checked (folium's default for overlay=False). `tiles=None`
        # suppresses folium's own default OSM tile layer, which would
        # otherwise sit on the map outside LayerControl's registry and
        # keep its native 18 in the ceiling regardless of what the user
        # checked off.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="High",
            attr="High",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Low",
            attr="Low",
            overlay=False,
            max_zoom=10,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "hidden_base_maxzoom.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'hidden_base_maxzoom.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            # Both checked: the ceiling is the union of on-map
            # layers' native max_zoom.
            both = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert both["entries"] == {"High": 1}, both
            assert both["zoom"] == 20, both
            # Uncheck "High" — the ceiling must drop to "Low"'s native
            # 10. Before the fix, "High" was still registered and its
            # native max_zoom would have kept the ceiling at 20.
            page.click("input[aria-label='High']")
            page.wait_for_timeout(300)
            low_only = page.evaluate(_js("LayerControl/read_zoom_and_entries"))
            assert low_only["entries"] == {"Low": 1}, low_only
            assert low_only["zoom"] == 10, (
                f"a hidden base must not raise getMaxZoom, got {low_only['zoom']} "
                "(expected 10 from the visible 'Low' layer's native max_zoom): "
                f"{low_only}"
            )


class TestStylePanelTouchBrowser:
    """A touch drag over the style panel body scrolls it, not the map."""

    def test_touch_drag_over_the_style_panel_does_not_pan_the_map(
        self, touch_browser, tmp_path
    ):
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_value_1")),
            name="Polygon data",
        )
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        layer.add_to(m)
        html = m.get_root().render()
        with use_page(make_browser_page, touch_browser, tmp_path, html, "style") as (
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
            # Open the row menu, then the Style panel on the first overlay row.
            page.evaluate(snippet("LayerControl/open_layer_style_panel"))
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            rect = page.evaluate(
                f"({snippet_fn('common/element_rect')})"
                "('.foliplus-layer-style-panel .foliplus-panel-content')"
            )
            before = map_center_zoom(page)
            touch_drag(
                page,
                rect["x"] + rect["w"] / 2,
                rect["y"] + rect["h"] / 2,
                rect["y"] + rect["h"] / 2 - 80,
            )
            page.wait_for_timeout(300)
            assert_map_unchanged(before, map_center_zoom(page))
            assert not errors, f"JS errors: {errors}"
